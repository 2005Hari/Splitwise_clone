import { Bell, BellSlash } from '@phosphor-icons/react';
import { usePushNotifications } from '../hooks/usePushNotifications';

export function NotificationToggle() {
  const { supported, subscribed, busy, enable, disable, error } = usePushNotifications();
  if (!supported) return null;

  return (
    <span className="notification-toggle">
      <button
        className="icon-btn"
        onClick={subscribed ? disable : enable}
        disabled={busy}
        aria-label={subscribed ? 'Turn off notifications' : 'Turn on notifications'}
        title={subscribed ? 'Turn off browser notifications' : 'Get notified about new expenses, comments and payments'}
      >
        {subscribed ? <Bell size={18} weight="bold" /> : <BellSlash size={18} weight="bold" />}
      </button>
      {error && <span className="hint hint-error notification-error">{error}</span>}
    </span>
  );
}
