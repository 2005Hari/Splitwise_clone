import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useYoupiScript } from '../hooks/useYoupiScript';
import { currencySymbol } from '../utils/money';

const POLL_MS = 2500;
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED']);

// "Settle up" for one simplified debt (transfer.fromUserId owes transfer.toUserId
// transfer.amountCents). Only rendered for the signed-in user's own debts.
// Two ways to record it, same as Splitwise itself offers:
//  - "Pay via UPI": real money, through YouPI-PG's in-app checkout. Only the
//    signed webhook (never the browser success event) ever marks it paid.
//  - "Mark as paid": a cash/offline payment recorded directly — the person
//    doing it is asserting the money already changed hands, so it's SUCCESS
//    immediately, same as Splitwise's own "record a payment" button.
// The amount defaults to the full suggested transfer but can be edited down
// for a partial settlement.
export function SettleUpButton({ groupId, transfer, currency, onSettled }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((transfer.amountCents / 100).toFixed(2));
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

  const amountCents = () => Math.round(Number(amount) * 100);

  const markAsPaid = async () => {
    setPhase('creating');
    setMessage(null);
    try {
      await api.post(`/api/groups/${groupId}/settlements`, {
        payeeId: transfer.toUserId,
        amountCents: amountCents(),
        source: 'cash',
      });
      setPhase('done');
      onSettled?.();
    } catch (err) {
      setPhase('error');
      setMessage(err.message);
    }
  };

  const payViaUpi = async () => {
    setPhase('creating');
    setMessage(null);
    try {
      const data = await api.post(`/api/groups/${groupId}/settlements`, {
        payeeId: transfer.toUserId,
        amountCents: amountCents(),
        source: 'youpi',
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

  if (!open) {
    return (
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        Settle up
      </button>
    );
  }

  const busy = phase === 'creating' || phase === 'awaiting' || phase === 'confirming';

  return (
    <div className="settle-up">
      <div className="settle-up-row">
        <span className="settle-up-currency">{currencySymbol(currency)}</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          max={(transfer.amountCents / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="settle-up-amount"
        />
      </div>
      <div className="settle-up-buttons">
        <button className="btn btn-primary btn-sm" onClick={payViaUpi} disabled={busy}>
          {phase === 'creating' && 'Opening…'}
          {phase === 'awaiting' && (scriptReady ? 'Pay via UPI' : 'Loading widget…')}
          {phase === 'confirming' && 'Confirming…'}
          {(phase === 'idle' || phase === 'error') && 'Pay via UPI'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={markAsPaid} disabled={busy}>
          Mark as paid (cash)
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {(message || scriptError) && <p className="hint hint-error">{scriptError || message}</p>}
    </div>
  );
}
