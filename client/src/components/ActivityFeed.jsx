import { formatMoney } from '../utils/money';

function describe(entry) {
  const { type, actor_name, payload } = entry;
  switch (type) {
    case 'expense_added':
      return `${actor_name} added "${payload.description}" (${formatMoney(payload.amountCents, payload.currency)})`;
    case 'expense_updated':
      return payload.note
        ? `${actor_name} ${payload.note} on "${payload.description}"`
        : `${actor_name} edited "${payload.description}"`;
    case 'expense_deleted':
      return `${actor_name} deleted "${payload.description}" (${formatMoney(payload.amountCents, 'INR')})`;
    case 'member_joined':
      return `${actor_name} added ${payload.name} to the group`;
    case 'member_left':
      return payload.removed ? `${actor_name} removed ${payload.name}` : `${payload.name} left the group`;
    case 'settlement_started':
      return `${actor_name} started a ${formatMoney(payload.amountCents, payload.currency)} UPI payment`;
    case 'settlement_succeeded':
      return `${actor_name} paid ${formatMoney(payload.amountCents, payload.currency)}${payload.source === 'cash' ? ' in cash' : ' via UPI'}`;
    case 'settlement_failed':
      return `${actor_name}'s ${formatMoney(payload.amountCents, payload.currency)} payment ${payload.status?.toLowerCase() || 'failed'}`;
    case 'comment_added':
      return `${actor_name} commented on "${payload.description}": "${payload.preview}"`;
    default:
      return `${actor_name} did something`;
  }
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityFeed({ activity }) {
  if (activity.length === 0) return <p className="hint">No activity yet.</p>;
  return (
    <ul className="activity-list">
      {activity.map((entry) => (
        <li key={entry.id} className="activity-row">
          <span>{describe(entry)}</span>
          <span className="hint">{timeAgo(entry.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
