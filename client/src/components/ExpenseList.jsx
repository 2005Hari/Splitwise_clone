import { useCallback, useEffect, useState } from 'react';
import { CaretDown, FileText, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { api } from '../api/client';
import { formatMoney } from '../utils/money';
import { ExpenseForm } from './ExpenseForm';
import { CategoryIcon } from '../utils/categoryIcons';

function ExpenseCategoryIcon({ categoryId, categories }) {
  const cat = categories.find((c) => c.id === categoryId);
  return (
    <span className="category-icon" title={cat?.label || categoryId}>
      <CategoryIcon categoryId={categoryId} size={18} />
    </span>
  );
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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function ExpenseReceipts({ groupId, expenseId }) {
  const [receipts, setReceipts] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { receipts } = await api.get(`/api/groups/${groupId}/expenses/${expenseId}/receipts`);
    setReceipts(receipts);
  }, [groupId, expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.upload(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, formData);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (receiptId) => {
    if (!window.confirm('Remove this receipt?')) return;
    await api.del(`/api/groups/${groupId}/expenses/${expenseId}/receipts/${receiptId}`);
    await load();
  };

  if (receipts === null) return <p className="hint">Loading receipts…</p>;

  return (
    <div className="receipts">
      {receipts.length === 0 && <p className="hint">No receipts attached.</p>}
      <ul className="receipt-list">
        {receipts.map((r) => (
          <li key={r.id} className="receipt-item">
            {r.content_type.startsWith('image/') ? (
              <a
                href={`${API_URL}/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}/file`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className="receipt-thumb"
                  src={`${API_URL}/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}/file`}
                  alt={r.original_name}
                />
              </a>
            ) : (
              <a
                href={`${API_URL}/api/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="receipt-file-link"
              >
                <FileText size={16} weight="bold" /> {r.original_name}
              </a>
            )}
            <button className="icon-btn is-danger receipt-remove" aria-label="Remove receipt" title="Remove" onClick={() => remove(r.id)}>
              <X size={14} weight="bold" />
            </button>
          </li>
        ))}
      </ul>
      <label className="btn btn-ghost btn-sm receipt-upload-btn">
        {uploading ? 'Uploading…' : 'Attach a receipt'}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={onFileChosen} disabled={uploading} hidden />
      </label>
      {error && <p className="hint hint-error">{error}</p>}
    </div>
  );
}

export function ExpenseList({ groupId, expenses, members, categories, currentUserId, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  if (expenses.length === 0) {
    return (
      <div className="empty-state">
        <FileText size={32} weight="bold" className="empty-state-icon" />
        <span className="empty-state-title">No expenses yet</span>
        <span className="hint">Add the first one below.</span>
      </div>
    );
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
                <ExpenseCategoryIcon categoryId={e.category} categories={categories} />
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
                    {expandedId === e.id
                      ? 'Hide'
                      : `Details${e.comment_count || e.receipt_count ? ` (${e.comment_count + e.receipt_count})` : ''}`}
                    <CaretDown size={14} weight="bold" style={{ transform: expandedId === e.id ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  <button className="icon-btn" aria-label="Edit expense" title="Edit" onClick={() => setEditingId(e.id)}>
                    <PencilSimple size={16} weight="bold" />
                  </button>
                  <button
                    className="icon-btn is-danger"
                    aria-label="Delete expense"
                    title="Delete"
                    onClick={() => deleteExpense(e)}
                    disabled={deletingId === e.id}
                  >
                    <Trash size={16} weight="bold" />
                  </button>
                </div>
              </div>
              {expandedId === e.id && (
                <div className="expense-details">
                  <div>
                    <h4>Receipts</h4>
                    <ExpenseReceipts groupId={groupId} expenseId={e.id} />
                  </div>
                  <div>
                    <h4>Comments</h4>
                    <ExpenseComments groupId={groupId} expenseId={e.id} />
                  </div>
                </div>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
