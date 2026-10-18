import { SettleUpButton } from './SettleUpButton';
import { formatMoney } from '../utils/money';

export function BalanceList({ groupId, currentUserId, currency, balances, transfers, onSettled }) {
  return (
    <div className="card">
      <h3>Balances</h3>
      <ul className="balance-list">
        {balances.map((b) => (
          <li key={b.id} className="balance-row">
            <span>{b.id === currentUserId ? `${b.name} (you)` : b.name}</span>
            {b.netCents === 0 && <span className="pill">settled up</span>}
            {b.netCents > 0 && <span className="pill pill-success">gets back {formatMoney(b.netCents, currency)}</span>}
            {b.netCents < 0 && <span className="pill pill-danger">owes {formatMoney(-b.netCents, currency)}</span>}
          </li>
        ))}
      </ul>

      <h3>Suggested payments</h3>
      {transfers.length === 0 && <p className="hint">Everyone is settled up.</p>}
      <ul className="transfer-list">
        {transfers.map((t) => (
          <li key={`${t.fromUserId}-${t.toUserId}`} className="transfer-row">
            <span>
              <strong>{t.fromName}</strong> owes <strong>{t.toName}</strong> {formatMoney(t.amountCents, currency)}
            </span>
            {t.fromUserId === currentUserId ? (
              <SettleUpButton groupId={groupId} transfer={t} currency={currency} onSettled={onSettled} />
            ) : (
              <span className="hint">waiting on {t.fromName}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
