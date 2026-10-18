import db from '../db/index.js';

// Splits amountCents equally among participantIds, giving any leftover paise
// to the first participants so the shares always sum exactly to amountCents.
export function equalSplit(amountCents, participantIds) {
  const base = Math.floor(amountCents / participantIds.length);
  let remainder = amountCents - base * participantIds.length;
  return participantIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { userId, shareCents: base + extra };
  });
}

// Per-group net balance for every member who has ever paid, owed, or settled.
// net > 0  => the group owes this person money (they are a creditor)
// net < 0  => this person owes the group money (they are a debtor)
export function computeGroupBalances(groupId) {
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?`
    )
    .all(groupId);

  const net = new Map(members.map((m) => [m.id, 0]));

  const paid = db
    .prepare(
      `SELECT paid_by AS userId, SUM(amount_cents) AS total
       FROM expenses WHERE group_id = ? GROUP BY paid_by`
    )
    .all(groupId);
  for (const row of paid) {
    net.set(row.userId, (net.get(row.userId) || 0) + row.total);
  }

  const owed = db
    .prepare(
      `SELECT es.user_id AS userId, SUM(es.share_cents) AS total
       FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ? GROUP BY es.user_id`
    )
    .all(groupId);
  for (const row of owed) {
    net.set(row.userId, (net.get(row.userId) || 0) - row.total);
  }

  // Successful settlements move the debt itself, not an "expense": the payer's
  // debt shrinks and the payee's credit shrinks by the same amount.
  const settled = db
    .prepare(`SELECT payer_id, payee_id, amount_cents FROM settlements WHERE group_id = ? AND status = 'SUCCESS'`)
    .all(groupId);
  for (const row of settled) {
    net.set(row.payer_id, (net.get(row.payer_id) || 0) + row.amount_cents);
    net.set(row.payee_id, (net.get(row.payee_id) || 0) - row.amount_cents);
  }

  return members.map((m) => ({ ...m, netCents: net.get(m.id) || 0 }));
}

// Greedy debt simplification: repeatedly match the biggest debtor to the
// biggest creditor. Minimises the number of payments needed to zero everyone out.
export function simplifyDebts(balances) {
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ userId: b.id, name: b.name, amount: -b.netCents }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ userId: b.id, name: b.name, amount: b.netCents }))
    .sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amountCents: amount,
      });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }
  return transfers;
}
