import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const SPLIT_LABELS = {
  equal: 'Equally',
  exact: 'By exact amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

function centsFromRupees(str) {
  const n = Math.round(Number(str) * 100);
  return Number.isFinite(n) ? n : 0;
}

// Builds the per-participant inputs for whichever split type is selected,
// seeded either from scratch (equal shares) or from an existing expense's
// split_meta (edit mode) so the form faithfully round-trips.
function buildInitialRows(members, splitType, initialExpense) {
  const meta = initialExpense?.split_meta;
  const sharesByUser = new Map((initialExpense?.shares || []).map((s) => [s.user_id ?? s.userId, s]));

  return members.map((m) => {
    const row = { userId: m.id, name: m.name, checked: true, exact: '', percent: '', shares: '1' };
    if (initialExpense) {
      const existingShare = sharesByUser.get(m.id);
      row.checked = !!existingShare;
      if (splitType === 'exact' && existingShare) row.exact = (existingShare.share_cents / 100).toFixed(2);
      if (splitType === 'percentage') {
        const v = meta?.values?.find((x) => x.userId === m.id);
        row.percent = v ? String(v.percent) : '';
      }
      if (splitType === 'shares') {
        const v = meta?.values?.find((x) => x.userId === m.id);
        row.shares = v ? String(v.shares) : '1';
      }
    }
    return row;
  });
}

export function ExpenseForm({ groupId, members, categories, initialExpense, prefill, onSaved, onCancel }) {
  const isEdit = !!initialExpense;
  const [description, setDescription] = useState(initialExpense?.description || '');
  const [amount, setAmount] = useState(
    initialExpense ? (initialExpense.amount_cents / 100).toFixed(2) : ''
  );
  const [paidBy, setPaidBy] = useState(initialExpense?.paid_by ?? members[0]?.id ?? '');
  const [category, setCategory] = useState(initialExpense?.category || 'general');
  const [splitType, setSplitType] = useState(initialExpense?.split_type || 'equal');
  const [rows, setRows] = useState(() => buildInitialRows(members, initialExpense?.split_type || 'equal', initialExpense));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setRows(buildInitialRows(members, splitType, splitType === initialExpense?.split_type ? initialExpense : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitType, members]);

  // Pre-fills a fresh (non-edit) form from an AI receipt scan. A new object
  // arrives each time the parent scans a photo, so this re-seeds on every scan.
  useEffect(() => {
    if (!prefill || isEdit) return;
    if (prefill.description) setDescription(prefill.description);
    if (prefill.amountCents) setAmount((prefill.amountCents / 100).toFixed(2));
    if (prefill.category) setCategory(prefill.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const updateRow = (userId, patch) => {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, ...patch } : r)));
  };

  const amountCents = centsFromRupees(amount);
  const checkedRows = rows.filter((r) => r.checked);

  const percentTotal = useMemo(
    () => checkedRows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0),
    [checkedRows]
  );
  const exactTotal = useMemo(
    () => checkedRows.reduce((sum, r) => sum + centsFromRupees(r.exact || '0'), 0),
    [checkedRows]
  );

  const buildPayload = () => {
    const base = { description, amountCents, paidBy: Number(paidBy), category };
    if (splitType === 'equal') {
      return { ...base, splitType: 'equal', participantIds: checkedRows.map((r) => r.userId) };
    }
    if (splitType === 'exact') {
      return {
        ...base,
        splitType: 'exact',
        exactShares: checkedRows.map((r) => ({ userId: r.userId, shareCents: centsFromRupees(r.exact || '0') })),
      };
    }
    if (splitType === 'percentage') {
      return {
        ...base,
        splitType: 'percentage',
        percentages: checkedRows.map((r) => ({ userId: r.userId, percent: Number(r.percent) || 0 })),
      };
    }
    return {
      ...base,
      splitType: 'shares',
      shareWeights: checkedRows.map((r) => ({ userId: r.userId, shares: Number(r.shares) || 0 })),
    };
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (checkedRows.length === 0) {
      setError('Pick at least one participant to split with.');
      return;
    }
    if (splitType === 'exact' && exactTotal !== amountCents) {
      setError(`Exact amounts add up to ${(exactTotal / 100).toFixed(2)}, not ${(amountCents / 100).toFixed(2)}.`);
      return;
    }
    if (splitType === 'percentage' && Math.abs(percentTotal - 100) > 0.01) {
      setError(`Percentages add up to ${percentTotal.toFixed(2)}%, not 100%.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (isEdit) {
        await api.patch(`/api/groups/${groupId}/expenses/${initialExpense.id}`, payload);
        onSaved?.(initialExpense.id);
      } else {
        const { expense } = await api.post(`/api/groups/${groupId}/expenses`, payload);
        setDescription('');
        setAmount('');
        onSaved?.(expense.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={isEdit ? 'expense-edit-form' : 'expense-add-form'} onSubmit={onSubmit}>
      <label>
        Description
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner at the beach shack"
          required
        />
      </label>
      <div className="form-row">
        <label>
          Amount
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        Split
        <div className="segmented" role="group" aria-label="Split type">
          {Object.entries(SPLIT_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`segmented-option${splitType === value ? ' is-active' : ''}`}
              aria-pressed={splitType === value}
              onClick={() => setSplitType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </label>

      <fieldset>
        <legend>
          {splitType === 'equal' && 'Split equally between'}
          {splitType === 'exact' && `Exact amounts (total ${(exactTotal / 100).toFixed(2)} / ${(amountCents / 100).toFixed(2)})`}
          {splitType === 'percentage' && `Percentages (total ${percentTotal.toFixed(2)}% / 100%)`}
          {splitType === 'shares' && 'Shares (ratio — anyone can have more or fewer shares)'}
        </legend>
        {rows.map((r) => (
          <div key={r.userId} className="split-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={r.checked}
                onChange={(e) => updateRow(r.userId, { checked: e.target.checked })}
              />
              {r.name}
            </label>
            {r.checked && splitType === 'exact' && (
              <input
                className="split-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={r.exact}
                onChange={(e) => updateRow(r.userId, { exact: e.target.value })}
                placeholder="0.00"
              />
            )}
            {r.checked && splitType === 'percentage' && (
              <input
                className="split-input"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={r.percent}
                onChange={(e) => updateRow(r.userId, { percent: e.target.value })}
                placeholder="%"
              />
            )}
            {r.checked && splitType === 'shares' && (
              <input
                className="split-input"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={r.shares}
                onChange={(e) => updateRow(r.userId, { shares: e.target.value })}
              />
            )}
          </div>
        ))}
      </fieldset>

      {error && <p className="hint hint-error">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add expense'}
        </button>
        {isEdit && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
