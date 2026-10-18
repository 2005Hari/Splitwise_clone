import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatMoney } from '../utils/money';

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export function RecurringExpenses({ groupId, members, currency, onFired }) {
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(members[0]?.id ?? '');
  const [frequency, setFrequency] = useState('monthly');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const { recurring } = await api.get(`/api/groups/${groupId}/recurring`);
    setRecurring(recurring);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/groups/${groupId}/recurring`, {
        description,
        amountCents: Math.round(Number(amount) * 100),
        paidBy: Number(paidBy),
        category: 'general',
        splitType: 'equal',
        participantIds: members.map((m) => m.id),
        frequency,
      });
      setDescription('');
      setAmount('');
      setShowForm(false);
      await load();
      onFired?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (r) => {
    await api.patch(`/api/groups/${groupId}/recurring/${r.id}`, { active: !r.active });
    await load();
  };

  const remove = async (r) => {
    if (!window.confirm(`Stop the recurring charge "${r.description}"?`)) return;
    await api.del(`/api/groups/${groupId}/recurring/${r.id}`);
    await load();
  };

  if (loading) return null;

  return (
    <div className="card">
      <h3>Recurring expenses</h3>
      <p className="hint">Rent, subscriptions, anything that repeats — split equally between everyone, automatically.</p>
      {recurring.length === 0 && <p className="hint">None set up yet.</p>}
      <ul className="recurring-list">
        {recurring.map((r) => (
          <li key={r.id} className="recurring-row">
            <div>
              <strong>{r.description}</strong>
              <span className="hint">
                {' '}
                {formatMoney(r.amount_cents, currency)} · {FREQUENCY_LABELS[r.frequency]} · paid by {r.paid_by_name}
                {!r.active && ' · paused'}
              </span>
              <div className="hint">next: {new Date(r.next_run_at).toLocaleDateString()}</div>
            </div>
            <div className="recurring-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>
                {r.active ? 'Pause' : 'Resume'}
              </button>
              <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => remove(r)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!showForm && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(true)}>
          + Add a recurring expense
        </button>
      )}
      {showForm && (
        <form className="recurring-form" onSubmit={create}>
          <div className="form-row">
            <label>
              Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rent" required />
            </label>
            <label>
              Amount
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Paid by
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repeats
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          <p className="hint">Split equally among all {members.length} current members.</p>
          {error && <p className="hint hint-error">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Start repeating'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
