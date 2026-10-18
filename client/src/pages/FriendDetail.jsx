import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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

export function FriendDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingDirect, setCreatingDirect] = useState(false);

  useEffect(() => {
    api.get(`/api/friends/${userId}`).then((data) => {
      setData(data);
      setLoading(false);
    });
  }, [userId]);

  const addDirectExpense = async () => {
    setCreatingDirect(true);
    try {
      const { groupId } = await api.post(`/api/friends/${userId}/direct-group`);
      navigate(`/groups/${groupId}`);
    } finally {
      setCreatingDirect(false);
    }
  };

  if (loading) return <div className="page-loading">Loading…</div>;
  const { friend, balances, groups } = data;

  return (
    <div className="page">
      <div className="card">
        <div className="friend-detail-header">
          <span className="friend-avatar friend-avatar-lg">{initials(friend.name)}</span>
          <div>
            <h2>{friend.name}</h2>
            <p className="hint">{friend.email}</p>
          </div>
        </div>
        {balances.length === 0 && <p className="pill">Settled up</p>}
        <ul className="overall-list">
          {balances.map((b) => (
            <li key={b.currency} className={b.netCents > 0 ? 'overall-positive' : 'overall-negative'}>
              {b.netCents > 0
                ? `${friend.name} owes you ${formatMoney(b.netCents, b.currency)}`
                : `You owe ${friend.name} ${formatMoney(-b.netCents, b.currency)}`}
            </li>
          ))}
        </ul>
        <button className="btn btn-primary btn-sm" onClick={addDirectExpense} disabled={creatingDirect}>
          {creatingDirect ? 'Opening…' : 'Add a direct expense'}
        </button>
      </div>

      <div className="card">
        <h3>Shared groups</h3>
        {groups.length === 0 && <p className="hint">No shared groups yet.</p>}
        <ul className="friend-group-list">
          {groups.map((g) => (
            <li key={g.id} className="transfer-row">
              <Link to={`/groups/${g.id}`}>{g.kind === 'friend' ? 'Direct expenses' : g.name}</Link>
              <span className={g.netCents > 0 ? 'overall-positive' : g.netCents < 0 ? 'overall-negative' : 'hint'}>
                {g.netCents === 0
                  ? 'settled up'
                  : g.netCents > 0
                  ? `owes you ${formatMoney(g.netCents, g.currency)}`
                  : `you owe ${formatMoney(-g.netCents, g.currency)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
