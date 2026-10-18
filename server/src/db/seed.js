// Optional: realistic fake data for local development. No real people.
// Run with: npm run db:seed
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './index.js';

const people = [
  { name: 'Asha Rao', email: 'asha@example.com' },
  { name: 'Vikram Shah', email: 'vikram@example.com' },
  { name: 'Priya Nair', email: 'priya@example.com' },
];

const insertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)
   ON CONFLICT(email) DO NOTHING`
);

const passwordHash = bcrypt.hashSync('password123', 10);
for (const p of people) {
  insertUser.run(p.name, p.email, passwordHash);
}

const getUserByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
const [asha, vikram, priya] = people.map((p) => getUserByEmail.get(p.email));

const existingGroup = db
  .prepare('SELECT id FROM groups WHERE name = ?')
  .get('Goa Trip');

let groupId = existingGroup?.id;
if (!groupId) {
  const result = db
    .prepare('INSERT INTO groups (name, created_by) VALUES (?, ?)')
    .run('Goa Trip', asha.id);
  groupId = result.lastInsertRowid;

  const addMember = db.prepare(
    `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)`
  );
  addMember.run(groupId, asha.id, 'owner');
  addMember.run(groupId, vikram.id, 'member');
  addMember.run(groupId, priya.id, 'member');

  const insertExpense = db.prepare(
    `INSERT INTO expenses (group_id, description, amount_cents, paid_by, created_by, split_type)
     VALUES (?, ?, ?, ?, ?, 'equal')`
  );
  const insertShare = db.prepare(
    `INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)`
  );

  const expenseId = insertExpense.run(
    groupId,
    'Beach resort, 2 nights',
    900000,
    asha.id,
    asha.id
  ).lastInsertRowid;
  const share = Math.round(900000 / 3);
  insertShare.run(expenseId, asha.id, share);
  insertShare.run(expenseId, vikram.id, share);
  insertShare.run(expenseId, priya.id, 900000 - 2 * share);
}

console.log('Seeded users (password123): asha@example.com, vikram@example.com, priya@example.com');
console.log(`Seeded group "Goa Trip" (id ${groupId}) with one shared expense.`);
