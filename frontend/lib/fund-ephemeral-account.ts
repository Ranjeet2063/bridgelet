import { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { signFreighterTransaction } from '@/lib/wallet';

/**
 * Step 2 of the send flow.
 *
 * `POST /accounts` only provisions the ephemeral account on-chain (the backend
 * covers its 2 XLM base reserve) and initialises the Soroban contract. It does
 * NOT move the sender's money: the account is returned in `pending_payment`
 * and waits for an inbound Stellar payment to `publicKey`. The backend's
 * payment monitor (30s poll) then records it on the contract and flips the
 * account to `pending_claim`.
 *
 * This helper builds that payment from the sender's wallet, has Freighter sign
 * it, and submits it to Horizon directly from the browser.
 */

export class FundingError extends Error {
  readonly code: 'UNSUPPORTED_ASSET' | 'USER_REJECTED' | 'SIGNER_MISMATCH' | 'SUBMIT_FAILED';

  constructor(code: FundingError['code'], message: string) {
    super(message);
    this.name = 'FundingError';
    this.code = code;
  }
}

const HORIZON_URLS: Record<string, string> = {
  'stellar-testnet': 'https://horizon-testnet.stellar.org',
  'stellar-mainnet': 'https://horizon.stellar.org',
};

function horizonUrl(): string {
  const override = process.env['NEXT_PUBLIC_HORIZON_URL'];
  if (override && override.trim()) return override.trim();
  const network = process.env['NEXT_PUBLIC_CRYPTO_NETWORK'] ?? 'stellar-testnet';
  return HORIZON_URLS[network] ?? HORIZON_URLS['stellar-testnet']!;
}

export interface FundEphemeralAccountParams {
  /** Sender's connected wallet (the `fundingSource` sent to POST /accounts). */
  from: string;
  /** `publicKey` from the POST /accounts response. */
  to: string;
  /** Decimal string, max 7 decimal places. */
  amount: string;
  /** 'XLM' only for now — see note below. */
  assetCode: string;
}

export async function fundEphemeralAccount(
  params: FundEphemeralAccountParams,
): Promise<{ txHash: string }> {
  // The backend creates the ephemeral account with a plain 2 XLM createAccount and
  // never adds a trustline, so an issued asset (e.g. USDC) payment would fail
  // on-chain with op_no_trust. Refuse early with a clear message instead.
  if (params.assetCode !== 'XLM') {
    throw new FundingError(
      'UNSUPPORTED_ASSET',
      `${params.assetCode} is not supported yet — the ephemeral account has no trustline. Please send XLM.`,
    );
  }

  const server = new Horizon.Server(horizonUrl());

  let unsignedXdr: string;
  let networkPassphrase: string;
  try {
    const sourceAccount = await server.loadAccount(params.from);
    const fee = String(BASE_FEE);
    networkPassphrase =
      (process.env['NEXT_PUBLIC_CRYPTO_NETWORK'] ?? 'stellar-testnet') === 'stellar-mainnet'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015';

    unsignedXdr = new TransactionBuilder(sourceAccount, { fee, networkPassphrase })
      .addOperation(
        Operation.payment({
          destination: params.to,
          asset: Asset.native(),
          amount: params.amount,
        }),
      )
      .setTimeout(180)
      .build()
      .toXDR();
  } catch (err) {
    throw new FundingError(
      'SUBMIT_FAILED',
      err instanceof Error
        ? `Could not build the payment: ${err.message}`
        : 'Could not build the payment.',
    );
  }

  let signed;
  try {
    signed = await signFreighterTransaction(unsignedXdr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|declin|denied|cancel/i.test(msg)) {
      throw new FundingError(
        'USER_REJECTED',
        'Payment was not approved in Freighter. Approve it to fund the claim link.',
      );
    }
    throw new FundingError('SUBMIT_FAILED', msg);
  }

  if (signed.signerAddress !== params.from) {
    throw new FundingError(
      'SIGNER_MISMATCH',
      'The connected Freighter account does not match the wallet you selected. Reconnect and try again.',
    );
  }

  try {
    const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, networkPassphrase);
    const result = await server.submitTransaction(tx);
    return { txHash: result.hash };
  } catch (err) {
    // Horizon puts the useful reason (e.g. op_underfunded) in result_codes.
    const codes = (
      err as { response?: { data?: { extras?: { result_codes?: unknown } } } }
    )?.response?.data?.extras?.result_codes;
    throw new FundingError(
      'SUBMIT_FAILED',
      codes
        ? `Payment failed on the network: ${JSON.stringify(codes)}`
        : err instanceof Error
          ? err.message
          : 'Payment failed on the network.',
    );
  }
}
