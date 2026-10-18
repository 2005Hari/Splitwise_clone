import { Link, useNavigate } from 'react-router-dom';
import { SignOut } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { NotificationToggle } from './NotificationToggle';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <span className="brand-mark">S</span>
        <span className="brand-text">splitwise clone</span>
      </Link>
      {user && (
        <nav className="navbar-right">
          <Link to="/" className="nav-link">Dashboard</Link>
          <Link to="/friends" className="nav-link">Friends</Link>
          <NotificationToggle />
          <span className="navbar-user">{user.name}</span>
          <button
            className="icon-btn"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <SignOut size={18} weight="bold" />
          </button>
        </nav>
      )}
    </header>
  );
}
