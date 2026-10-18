import { useState } from 'react';
import { api } from '../api/client';

export function AddExpense({ groupId, members, onAdded }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(members[0]?.id ?? '');
  const [participantIds, setParticipantIds] = useState(() => new Set(members.map((m) => m.id)));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleParticipant = (id) => {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (participantIds.size === 0) {
      setError('Pick at least one participant to split with.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/groups/${groupId}/expenses`, {
        description,
        amountCents: Math.round(Number(amount) * 100),
        paidBy: Number(paidBy),
        splitType: 'equal',
        participantIds: [...participantIds],
      });
      setDescription('');
      setAmount('');
      onAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <h3>Add an expense</h3>
      <label>
        Description
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner at the beach shack"
          required
        />
      </label>
      <label>
        Amount (INR)
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
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
      <fieldset>
        <legend>Split equally between</legend>
        {members.map((m) => (
          <label key={m.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={participantIds.has(m.id)}
              onChange={() => toggleParticipant(m.id)}
            />
            {m.name}
          </label>
        ))}
      </fieldset>
      {error && <p className="hint hint-error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add expense'}
      </button>
    </form>
  );
}
