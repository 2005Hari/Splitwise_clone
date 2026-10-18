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

// Splits amountCents proportionally to each entry's weight (a percentage
// value, a share/ratio count — anything comparable), using the largest-
// remainder method: floor every share, then hand the leftover paise one each
// to the entries with the biggest rounding error, largest first. Exact,
// fair, and deterministic — the standard way to split money by percentage.
export function proportionalSplit(amountCents, weighted) {
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) throw new Error('Split weights must sum to more than zero');

  const raw = weighted.map((w) => {
    const exact = (amountCents * w.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { userId: w.userId, floor, remainder: exact - floor };
  });

  let leftover = amountCents - raw.reduce((sum, r) => sum + r.floor, 0);
  const byRemainderDesc = [...raw].sort((a, b) => b.remainder - a.remainder);
  const bonus = new Map();
  for (const r of byRemainderDesc) {
    if (leftover <= 0) break;
    bonus.set(r.userId, 1);
    leftover -= 1;
  }

  return raw.map((r) => ({ userId: r.userId, shareCents: r.floor + (bonus.get(r.userId) || 0) }));
}

// Per-group net balance for every member who has ever paid, owed, or settled.
// net > 0  => the group owes this person money (they are a creditor)
// net < 0  => this person owes the group money (they are a debtor)
// All expenses in a group share the group's own currency (enforced when an
// expense is created/edited), so one group never mixes currencies.
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
       FROM expenses WHERE group_id = ? AND deleted_at IS NULL GROUP BY paid_by`
    )
    .all(groupId);
  for (const row of paid) {
    net.set(row.userId, (net.get(row.userId) || 0) + row.total);
  }

  const owed = db
    .prepare(
      `SELECT es.user_id AS userId, SUM(es.share_cents) AS total
       FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ? AND e.deleted_at IS NULL GROUP BY es.user_id`
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

// The direct (not simplified-through-a-third-party) balance between exactly
// two people within one group: positive = otherUserId owes userId.
// Used to cap how much a settlement between two specific people can be for.
export function pairwiseGroupBalance(groupId, userId, otherUserId) {
  const theyPaidIOwe = db
    .prepare(
      `SELECT COALESCE(SUM(es.share_cents), 0) AS total
       FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ? AND e.deleted_at IS NULL AND e.paid_by = ? AND es.user_id = ?`
    )
    .get(groupId, otherUserId, userId).total;

  const iPaidTheyOwe = db
    .prepare(
      `SELECT COALESCE(SUM(es.share_cents), 0) AS total
       FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ? AND e.deleted_at IS NULL AND e.paid_by = ? AND es.user_id = ?`
    )
    .get(groupId, userId, otherUserId).total;

  // otherUserId already paying userId shrinks what otherUserId still owes —
  // it subtracts from the net, it does not add to it.
  const theyAlreadyPaidMe = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM settlements
       WHERE group_id = ? AND status = 'SUCCESS' AND payer_id = ? AND payee_id = ?`
    )
    .get(groupId, otherUserId, userId).total;

  // userId already paying otherUserId is money moving the other way — it
  // increases what otherUserId now effectively owes userId back.
  const iAlreadyPaidThem = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM settlements
       WHERE group_id = ? AND status = 'SUCCESS' AND payer_id = ? AND payee_id = ?`
    )
    .get(groupId, userId, otherUserId).total;

  return iPaidTheyOwe - theyPaidIOwe - theyAlreadyPaidMe + iAlreadyPaidThem;
}

// Every other user userId shares a group with (any kind) or has ever split
// an expense or settlement with directly — Splitwise's own definition of
// "friends". Covers co-members who happen to have no *direct* shared
// expense yet (e.g. only ever split through a third person who paid), and
// people from an explicit friend-kind group so a freshly added friend shows
// up even before a first expense.
export function listCounterparties(userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT other.id, other.name, other.email FROM (
         SELECT es.user_id AS other_id FROM expense_shares es
           JOIN expenses e ON e.id = es.expense_id
           WHERE e.deleted_at IS NULL AND e.paid_by = ? AND es.user_id != ?
         UNION
         SELECT e.paid_by AS other_id FROM expenses e
           JOIN expense_shares es ON es.expense_id = e.id
           WHERE e.deleted_at IS NULL AND es.user_id = ? AND e.paid_by != ?
         UNION
         SELECT payee_id AS other_id FROM settlements WHERE payer_id = ?
         UNION
         SELECT payer_id AS other_id FROM settlements WHERE payee_id = ?
         UNION
         SELECT gm2.user_id AS other_id FROM group_members gm1
           JOIN group_members gm2 ON gm2.group_id = gm1.group_id AND gm2.user_id != gm1.user_id
           WHERE gm1.user_id = ?
       ) x JOIN users other ON other.id = x.other_id`
    )
    .all(userId, userId, userId, userId, userId, userId, userId);
  return rows;
}

// Aggregated balance between userId and otherUserId across every group and
// direct expense they've ever shared, bucketed by currency (a trip priced in
// USD and a dinner priced in INR are never silently added together).
// Returns e.g. [{ currency: 'INR', netCents: 50000 }], positive = otherUserId owes userId.
export function friendBalanceByCurrency(userId, otherUserId) {
  const net = new Map();
  const add = (currency, delta) => net.set(currency, (net.get(currency) || 0) + delta);

  for (const row of db
    .prepare(
      `SELECT e.currency, SUM(es.share_cents) AS total FROM expense_shares es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.deleted_at IS NULL AND e.paid_by = ? AND es.user_id = ?
       GROUP BY e.currency`
    )
    .all(userId, otherUserId)) {
    add(row.currency, row.total);
  }
  for (const row of db
    .prepare(
      `SELECT e.currency, SUM(es.share_cents) AS total FROM expense_shares es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.deleted_at IS NULL AND e.paid_by = ? AND es.user_id = ?
       GROUP BY e.currency`
    )
    .all(otherUserId, userId)) {
    add(row.currency, -row.total);
  }
  // Same correction as pairwiseGroupBalance: otherUserId paying userId
  // shrinks the debt (subtract); userId paying otherUserId grows it (add).
  for (const row of db
    .prepare(
      `SELECT currency, SUM(amount_cents) AS total FROM settlements
       WHERE status = 'SUCCESS' AND payer_id = ? AND payee_id = ? GROUP BY currency`
    )
    .all(otherUserId, userId)) {
    add(row.currency, -row.total);
  }
  for (const row of db
    .prepare(
      `SELECT currency, SUM(amount_cents) AS total FROM settlements
       WHERE status = 'SUCCESS' AND payer_id = ? AND payee_id = ? GROUP BY currency`
    )
    .all(userId, otherUserId)) {
    add(row.currency, row.total);
  }

  return [...net.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([currency, netCents]) => ({ currency, netCents }));
}

// Groups both members have shared an expense or settlement in, each with the
// pairwise balance for just that group — the per-group breakdown behind an
// aggregated friend balance.
export function friendGroupBreakdown(userId, otherUserId) {
  const sharedGroups = db
    .prepare(
      `SELECT g.id, g.name, g.kind, g.currency
       FROM groups g
       JOIN group_members gm1 ON gm1.group_id = g.id AND gm1.user_id = ?
       JOIN group_members gm2 ON gm2.group_id = g.id AND gm2.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(userId, otherUserId);

  return sharedGroups
    .map((g) => ({ ...g, netCents: pairwiseGroupBalance(g.id, userId, otherUserId) }))
    .filter((g) => g.netCents !== 0 || g.kind === 'friend');
}
