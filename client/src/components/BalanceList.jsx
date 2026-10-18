import { SettleUpButton } from './SettleUpButton';

function formatRupees(cents) {
  return `₹${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function BalanceList({ groupId, currentUserId, balances, transfers, onSettled }) {
  return (
    <div className="card">
      <h3>Balances</h3>
      <ul className="balance-list">
        {balances.map((b) => (
          <li key={b.id} className="balance-row">
            <span>{b.id === currentUserId ? `${b.name} (you)` : b.name}</span>
            {b.netCents === 0 && <span className="pill">settled up</span>}
            {b.netCents > 0 && <span className="pill pill-success">gets back {formatRupees(b.netCents)}</span>}
            {b.netCents < 0 && <span className="pill pill-danger">owes {formatRupees(b.netCents)}</span>}
          </li>
        ))}
      </ul>

      <h3>Suggested payments</h3>
      {transfers.length === 0 && <p className="hint">Everyone is settled up.</p>}
      <ul className="transfer-list">
        {transfers.map((t) => (
          <li key={`${t.fromUserId}-${t.toUserId}`} className="transfer-row">
            <span>
              <strong>{t.fromName}</strong> owes <strong>{t.toName}</strong> {formatRupees(t.amountCents)}
            </span>
            {t.fromUserId === currentUserId ? (
              <SettleUpButton groupId={groupId} transfer={t} onSettled={onSettled} />
            ) : (
              <span className="hint">waiting on {t.fromName}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
