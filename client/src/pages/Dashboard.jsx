import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadGroups = async () => {
    const { groups } = await api.get('/api/groups');
    setGroups(groups);
    setLoading(false);
  };

  useEffect(() => {
    loadGroups();
  }, []);

  const createGroup = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/groups', { name });
      setName('');
      await loadGroups();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Your groups</h2>
        {loading && <p className="hint">Loading…</p>}
        {!loading && groups.length === 0 && (
          <p className="hint">No groups yet. Create one below to add your first expense.</p>
        )}
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`}>{g.name}</Link>
            </li>
          ))}
        </ul>
      </div>

      <form className="card" onSubmit={createGroup}>
        <h3>New group</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa Trip" required />
        </label>
        {error && <p className="hint hint-error">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Create group
        </button>
      </form>
    </div>
  );
}
