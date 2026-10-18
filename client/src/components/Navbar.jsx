import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

function NotificationToggle() {
  const { supported, subscribed, busy, enable, disable, error } = usePushNotifications();
  if (!supported) return null;

  return (
    <span className="notification-toggle">
      <button
        className="btn btn-ghost btn-sm"
        onClick={subscribed ? disable : enable}
        disabled={busy}
        title={subscribed ? 'Turn off browser notifications' : 'Get notified about new expenses, comments and payments'}
      >
        {subscribed ? '🔔 On' : '🔕 Off'}
      </button>
      {error && <span className="hint hint-error notification-error">{error}</span>}
    </span>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        split<span>wise</span> clone
      </Link>
      {user && (
        <nav className="navbar-right">
          <Link to="/" className="nav-link">Dashboard</Link>
          <Link to="/friends" className="nav-link">Friends</Link>
          <NotificationToggle />
          <span className="navbar-user">{user.name}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
