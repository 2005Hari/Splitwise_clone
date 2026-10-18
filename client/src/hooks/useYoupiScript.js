import { useEffect, useState } from 'react';

// Loads YouPI-PG's checkout widget script exactly as documented
// (docs/DEVELOPER_INTEGRATION.md "Universal One-Script Integration"):
// a single <script src="{checkoutHost}/youpi.js" data-youpi-key="...">
// which exposes window.Youpi.pay(...) for an in-app modal checkout. We load
// it on demand, once per (checkoutHost, merchantKey) pair, and reuse it if
// another settle-up attempt asks for the same gateway.
export function useYoupiScript(checkoutHost, merchantKey) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.Youpi);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!checkoutHost || !merchantKey) return;
    if (window.Youpi) {
      setReady(true);
      return;
    }

    const existing = document.querySelector('script[data-youpi-loader]');
    if (existing) {
      existing.addEventListener('load', () => setReady(true));
      existing.addEventListener('error', () => setError('Could not load the payment widget'));
      return;
    }

    const script = document.createElement('script');
    script.src = `${checkoutHost}/youpi.js`;
    script.async = true;
    script.dataset.youpiKey = merchantKey;
    script.dataset.youpiLoader = 'true';
    script.onload = () => setReady(true);
    script.onerror = () =>
      setError(
        `Could not reach the checkout script at ${checkoutHost}/youpi.js — is your ` +
          'YouPI-PG checkout portal running?'
      );
    document.body.appendChild(script);
  }, [checkoutHost, merchantKey]);

  return { ready, error };
}
