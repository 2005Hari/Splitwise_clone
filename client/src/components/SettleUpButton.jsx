import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useYoupiScript } from '../hooks/useYoupiScript';

const POLL_MS = 2500;
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED']);

// "Settle up" for one simplified debt (transfer.fromUserId owes transfer.toUserId
// transfer.amountCents). Only rendered for the signed-in user's own debts.
// Flow: ask the backend to open a YouPI-PG payment session for this debt, then
// drive YouPI-PG's own in-app checkout modal (Youpi.pay) with that order id.
// The modal's `handler` callback is only ever used for optimistic UI — the
// balance itself is refreshed from the backend, which only flips a settlement
// to SUCCESS once YouPI-PG's signed webhook confirms the bank transfer.
export function SettleUpButton({ groupId, transfer, onSettled }) {
  const [phase, setPhase] = useState('idle'); // idle | creating | awaiting | confirming | done | error
  const [settlement, setSettlement] = useState(null);
  const [youpi, setYoupi] = useState(null);
  const [message, setMessage] = useState(null);
  const pollRef = useRef(null);

  const { ready: scriptReady, error: scriptError } = useYoupiScript(
    youpi?.checkoutHost,
    youpi?.merchantKey
  );

  useEffect(() => () => clearInterval(pollRef.current), []);

  const pollStatus = (settlementId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { settlement: fresh } = await api.get(
          `/api/groups/${groupId}/settlements/${settlementId}`
        );
        if (TERMINAL.has(fresh.status)) {
          clearInterval(pollRef.current);
          if (fresh.status === 'SUCCESS') {
            setPhase('done');
            onSettled?.();
          } else {
            setPhase('error');
            setMessage(`Payment ${fresh.status.toLowerCase()}. You can try again.`);
          }
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
  };

  const startPayment = async () => {
    setPhase('creating');
    setMessage(null);
    try {
      const data = await api.post(`/api/groups/${groupId}/settlements`, {
        payeeId: transfer.toUserId,
        amountCents: transfer.amountCents,
      });
      setSettlement(data.settlement);
      setYoupi(data.youpi);
      setPhase('awaiting');
    } catch (err) {
      setPhase('error');
      setMessage(err.message);
    }
  };

  // Once the widget script is ready and we have an open settlement, launch
  // YouPI-PG's own modal (dim/blur background, centered card / mobile sheet).
  useEffect(() => {
    if (phase !== 'awaiting' || !scriptReady || !settlement || !window.Youpi) return;

    window.Youpi.pay({
      order_id: settlement.orderId,
      amount: Number(settlement.amount),
      currency: settlement.currency,
      metadata: { settlementId: settlement.id },
      handler: () => {
        setPhase('confirming');
        setMessage('Payment submitted — confirming with the bank…');
        pollStatus(settlement.id);
      },
      onFailed: (response) => {
        setPhase('error');
        setMessage(response?.reason || 'Payment failed.');
      },
      onClose: () => {
        if (phase === 'awaiting') {
          setPhase('idle');
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scriptReady, settlement]);

  if (phase === 'done') {
    return <span className="pill pill-success">Settled ✓</span>;
  }

  return (
    <div className="settle-up">
      <button
        className="btn btn-primary btn-sm"
        onClick={startPayment}
        disabled={phase === 'creating' || phase === 'awaiting' || phase === 'confirming'}
      >
        {phase === 'creating' && 'Opening payment…'}
        {phase === 'awaiting' && (scriptReady ? 'Pay via UPI' : 'Loading payment widget…')}
        {phase === 'confirming' && 'Confirming…'}
        {(phase === 'idle' || phase === 'error') && 'Settle up via UPI'}
      </button>
      {(message || scriptError) && <p className="hint hint-error">{scriptError || message}</p>}
    </div>
  );
}
