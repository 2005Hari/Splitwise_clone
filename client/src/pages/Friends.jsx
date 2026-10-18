import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import { api } from '../api/client';
import { formatMoney } from '../utils/money';

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function FriendBalance({ balances }) {
  if (balances.length === 0) return <span className="pill">settled up</span>;
  return (
    <span className="friend-balances">
      {balances.map((b) => (
        <span
          key={b.currency}
          className={`pill ${b.netCents > 0 ? 'pill-success' : 'pill-danger'}`}
        >
          {b.netCents > 0 ? `owes you ${formatMoney(b.netCents, b.currency)}` : `you owe ${formatMoney(-b.netCents, b.currency)}`}
        </span>
      ))}
    </span>
  );
}

export function Friends() {
  const [friends, setFriends] = useState([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { friends } = await api.get('/api/friends');
    setFriends(friends);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addFriend = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/friends', { email });
      setEmail('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <div className="page">
      <div className="card">
        <h2>Friends</h2>
        <p className="hint">Balances combined across every group and direct expense you share with each person.</p>
        {friends.length === 0 && (
          <div className="empty-state">
            <UsersThree size={32} weight="bold" className="empty-state-icon" />
            <span className="empty-state-title">No friends yet</span>
            <span className="hint">Add one below, or invite someone to a group.</span>
          </div>
        )}
        <ul className="friend-list">
          {friends.map((f) => (
            <li key={f.id} className="friend-row">
              <Link to={`/friends/${f.id}`}>
                <span className="friend-avatar">{initials(f.name)}</span>
                {f.name}
              </Link>
              <FriendBalance balances={f.balances} />
            </li>
          ))}
        </ul>
      </div>

      <form className="card" onSubmit={addFriend}>
        <h3>Add a friend</h3>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" required />
        </label>
        {error && <p className="hint hint-error">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Add friend
        </button>
      </form>
    </div>
  );
}
