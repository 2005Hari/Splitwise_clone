import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatMoney } from '../utils/money';
import { ExpenseForm } from './ExpenseForm';

function CategoryIcon({ categoryId, categories }) {
  const cat = categories.find((c) => c.id === categoryId);
  return <span className="category-icon" title={cat?.label || categoryId}>{cat?.icon || '🧾'}</span>;
}

function ExpenseComments({ groupId, expenseId }) {
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const { comments } = await api.get(`/api/groups/${groupId}/expenses/${expenseId}/comments`);
    setComments(comments);
  }, [groupId, expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (comments === null) {
    return <p className="hint">Loading comments…</p>;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/groups/${groupId}/expenses/${expenseId}/comments`, { body });
      setBody('');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="comments">
      {comments.length === 0 && <p className="hint">No comments yet.</p>}
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id}>
            <strong>{c.user_name}</strong> {c.body}
          </li>
        ))}
      </ul>
      <form className="comment-form" onSubmit={onSubmit}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          disabled={submitting}
        />
        <button className="btn btn-ghost btn-sm" type="submit" disabled={submitting}>
          Post
        </button>
      </form>
    </div>
  );
}

export function ExpenseList({ groupId, expenses, members, categories, currentUserId, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  if (expenses.length === 0) {
    return <p className="hint">No expenses yet — add the first one below.</p>;
  }

  const deleteExpense = async (expense) => {
    if (!window.confirm(`Delete "${expense.description}"? This can't be undone.`)) return;
    setDeletingId(expense.id);
    try {
      await api.del(`/api/groups/${groupId}/expenses/${expense.id}`);
      onChanged?.();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <ul className="expense-list">
      {expenses.map((e) => (
        <li key={e.id} className="expense-row-wrap">
          {editingId === e.id ? (
            <ExpenseForm
              groupId={groupId}
              members={members}
              categories={categories}
              initialExpense={e}
              onSaved={() => {
                setEditingId(null);
                onChanged?.();
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="expense-row">
                <CategoryIcon categoryId={e.category} categories={categories} />
                <div className="expense-main">
                  <span className="expense-description">{e.description}</span>
                  <span className="expense-meta">
                    {e.paid_by_name} paid {formatMoney(e.amount_cents, e.currency)}
                    {e.updated_at !== e.created_at && ' · edited'}
                  </span>
                </div>
                <ul className="expense-shares">
                  {e.shares.map((s) => (
                    <li key={s.user_id}>
                      {s.name}: {formatMoney(s.share_cents, e.currency)}
                    </li>
                  ))}
                </ul>
                <div className="expense-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    {expandedId === e.id ? 'Hide' : `Comments${e.comment_count ? ` (${e.comment_count})` : ''}`}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(e.id)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger-text"
                    onClick={() => deleteExpense(e)}
                    disabled={deletingId === e.id}
                  >
                    {deletingId === e.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              {expandedId === e.id && <ExpenseComments groupId={groupId} expenseId={e.id} />}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
