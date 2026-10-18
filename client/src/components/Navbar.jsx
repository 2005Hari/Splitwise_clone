import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
