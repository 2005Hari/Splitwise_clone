import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatMoney, SUPPORTED_CURRENCIES } from '../utils/money';

function OverallSummary({ overview }) {
  const [targetCurrency, setTargetCurrency] = useState(null);
  const [converted, setConverted] = useState(null);
  const [converting, setConverting] = useState(false);

  const balances = overview?.balances || [];
  const currencies = [...new Set(balances.map((b) => b.currency))];
  const multiCurrency = currencies.length > 1;

  useEffect(() => {
    if (!multiCurrency) return;
    const target = targetCurrency || currencies[0];
    setConverting(true);
    api
      .get(`/api/overview?in=${target}`)
      .then((res) => setConverted(res.converted))
      .finally(() => setConverting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCurrency, multiCurrency]);

  if (!overview) return null;
  if (balances.length === 0) {
    return (
      <div className="card overall-summary">
        <p className="hint">You're all settled up everywhere. 🎉</p>
      </div>
    );
  }

  return (
    <div className="card overall-summary">
      <h3>Overall</h3>
      <ul className="overall-list">
        {balances.map((b) => (
          <li key={b.currency} className={b.netCents > 0 ? 'overall-positive' : 'overall-negative'}>
            {b.netCents > 0
              ? `You are owed ${formatMoney(b.netCents, b.currency)}`
              : `You owe ${formatMoney(-b.netCents, b.currency)}`}
          </li>
        ))}
      </ul>

      {multiCurrency && (
        <div className="fx-convert">
          <label>
            Combine into
            <select value={targetCurrency || currencies[0]} onChange={(e) => setTargetCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {converting && <span className="hint">Converting…</span>}
          {!converting && converted && (
            <p className={converted.totalCents >= 0 ? 'overall-positive fx-total' : 'overall-negative fx-total'}>
              ≈ {formatMoney(Math.abs(converted.totalCents), converted.currency)}
              {converted.totalCents >= 0 ? ' owed to you' : ' you owe'}
              <span className="hint fx-note"> (live rates, approximate)</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [overview, setOverview] = useState(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const [{ groups }, overview] = await Promise.all([
      api.get('/api/groups'),
      api.get('/api/overview'),
    ]);
    setGroups(groups);
    setOverview(overview);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const createGroup = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/groups', { name, currency });
      setName('');
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <div className="page">
      <OverallSummary overview={overview} />

      <div className="card">
        <h2>Your groups</h2>
        {groups.length === 0 && (
          <p className="hint">No groups yet. Create one below to add your first expense.</p>
        )}
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`}>{g.name}</Link>
              <span className="hint"> · {g.currency}</span>
            </li>
          ))}
        </ul>
      </div>

      <form className="card" onSubmit={createGroup}>
        <h3>New group</h3>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa Trip" required />
          </label>
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="hint hint-error">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Create group
        </button>
      </form>
    </div>
  );
}
