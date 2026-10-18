function formatRupees(cents) {
  return `₹${(cents / 100).toFixed(2)}`;
}

export function ExpenseList({ expenses }) {
  if (expenses.length === 0) {
    return <p className="hint">No expenses yet — add the first one below.</p>;
  }

  return (
    <ul className="expense-list">
      {expenses.map((e) => (
        <li key={e.id} className="expense-row">
          <div className="expense-main">
            <span className="expense-description">{e.description}</span>
            <span className="expense-meta">
              {e.paid_by_name} paid {formatRupees(e.amount_cents)}
            </span>
          </div>
          <ul className="expense-shares">
            {e.shares.map((s) => (
              <li key={s.user_id}>
                {s.name}: {formatRupees(s.share_cents)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
