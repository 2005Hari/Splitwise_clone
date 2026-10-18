import { CheckCircle } from '@phosphor-icons/react';
import { SettleUpButton } from './SettleUpButton';
import { formatMoney } from '../utils/money';

export function BalanceList({ groupId, currentUserId, currency, balances, transfers, onSettled }) {
  const mine = balances.find((b) => b.id === currentUserId);

  return (
    <div className="card">
      {mine && (
        <div className="hero-balance">
          <div className="hero-balance-label">
            {mine.netCents === 0 ? "You're all settled up" : mine.netCents > 0 ? 'You are owed' : 'You owe'}
          </div>
          <div
            className={`hero-balance-amount money ${
              mine.netCents === 0 ? 'is-settled' : mine.netCents > 0 ? 'is-positive' : 'is-negative'
            }`}
          >
            {mine.netCents === 0 ? '—' : formatMoney(Math.abs(mine.netCents), currency)}
          </div>
        </div>
      )}
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
      {transfers.length === 0 && (
        <div className="empty-state">
          <CheckCircle size={32} weight="bold" className="empty-state-icon" />
          <span className="empty-state-title">Everyone is settled up</span>
        </div>
      )}
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
