import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { House, UsersThree, Plus, SignOut } from '@phosphor-icons/react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { NotificationToggle } from './NotificationToggle';

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    if (!user) return;
    api
      .get('/api/groups')
      .then(({ groups }) => setGroups(groups))
      .catch(() => {});
  }, [user]);

  if (!user) return null;

  return (
    <aside className="sidebar">
      <Link to="/" className="sidebar-brand">
        <span className="sidebar-brand-mark">S</span>
        <span className="sidebar-brand-text">splitwise clone</span>
      </Link>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <House size={18} weight="bold" />
          Dashboard
        </NavLink>
        <NavLink to="/friends" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <UsersThree size={18} weight="bold" />
          Friends
        </NavLink>
      </nav>

      <div className="sidebar-heading">
        <span>Your groups</span>
        <NavLink to="/" aria-label="Create a group" title="Create a group">
          <Plus size={16} weight="bold" />
        </NavLink>
      </div>
      <ul className="sidebar-groups">
        {groups.map((g) => (
          <li key={g.id} className="sidebar-group-item">
            <NavLink to={`/groups/${g.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="sidebar-group-name">{g.name}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span>{user.name}</span>
          <NotificationToggle />
        </div>
        <button
          className="sidebar-link"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <SignOut size={18} weight="bold" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
