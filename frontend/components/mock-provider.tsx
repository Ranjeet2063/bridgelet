'use client';

import { useEffect } from 'react';

export function MockProvider() {
  useEffect(() => {
    const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
    // Opt-in only. Previously this ran on every `npm run dev`, which silently
    // replaced the real backend with MSW fixtures. Set NEXT_PUBLIC_USE_MOCKS=true
    // (or visit any page with ?demo=true) to get the mocked API.
    if (process.env.NEXT_PUBLIC_USE_MOCKS === 'true' || isDemo) {
      import('@/mocks').then(({ initMocks }) => initMocks());
    }
  }, []);

  return null;
}
