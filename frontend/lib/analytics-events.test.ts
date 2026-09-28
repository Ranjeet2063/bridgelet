import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_COUNT,
  isAnalyticsEventName,
  type AnalyticsEventName,
} from '@/lib/analytics-events';

/**
 * #677 – spec-to-type drift lint.
 *
 * Parses `docs/analytics-spec.md` Sections 4-6 `#### \`Event Name\`` headings
 * (the same source the generator uses) and asserts the checked-in
 * `ANALYTICS_EVENTS` tuple matches exactly, so the spec and the type system
 * cannot silently diverge on names.
 */
function extractSpecEvents(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // lib/analytics-events.test.ts -> frontend/ -> repo root docs/
  const candidates = [
    resolve(here, '..', '..', 'docs', 'analytics-spec.md'),
    resolve(process.cwd(), '..', 'docs', 'analytics-spec.md'),
  ];
  let text: string | null = null;
  for (const p of candidates) {
    try {
      text = readFileSync(p, 'utf8');
      break;
    } catch {
      // try next candidate
    }
  }
  if (text === null) throw new Error('Could not locate docs/analytics-spec.md from test');
  const lines = text.split(/\r?\n/);
  let section: number | null = null;
  const events: string[] = [];
  for (const line of lines) {
    const sm = line.match(/^##\s+(\d+)\./);
    if (sm?.[1] !== undefined) section = Number.parseInt(sm[1], 10);
    const hm = line.match(/^####\s+`([^`]+)`/);
    if (hm?.[1] !== undefined && section !== null && section >= 4 && section <= 6) {
      const name = hm[1].trim();
      if (name && !events.includes(name)) events.push(name);
    }
  }
  return events;
}

describe('analytics spec event names single source-of-truth (#677)', () => {
  it(`contains exactly ${ANALYTICS_EVENT_COUNT} events`, () => {
    expect(ANALYTICS_EVENTS).toHaveLength(ANALYTICS_EVENT_COUNT);
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('matches docs/analytics-spec.md Sections 4-6 headings exactly', () => {
    const specEvents = extractSpecEvents();
    expect(specEvents).toHaveLength(ANALYTICS_EVENT_COUNT);
    expect([...ANALYTICS_EVENTS].sort()).toEqual([...specEvents].sort());
  });

  it('keeps spec order (generator output is deterministic)', () => {
    const specEvents = extractSpecEvents();
    expect([...ANALYTICS_EVENTS]).toEqual(specEvents);
  });

  it('type-checks every tuple member as AnalyticsEventName', () => {
    const check: readonly AnalyticsEventName[] = ANALYTICS_EVENTS;
    expect(check.length).toBeGreaterThan(0);
  });

  it('runtime guard accepts spec names and rejects unknown strings', () => {
    for (const name of ANALYTICS_EVENTS) expect(isAnalyticsEventName(name)).toBe(true);
    expect(isAnalyticsEventName('Payment Settled')).toBe(false);
    expect(isAnalyticsEventName('')).toBe(false);
    expect(isAnalyticsEventName(null)).toBe(false);
    expect(isAnalyticsEventName(undefined)).toBe(false);
  });
});
