// Replays recurring_expenses templates into real expenses as they come due.
// Runs in-process (setInterval) — no external cron service or account
// needed, and the server process already needs to be running for the app
// to work at all, so this adds no new deployment dependency.
import db from '../db/index.js';
import { createExpense } from './expenseCreation.js';

const MAX_CATCHUP_RUNS = 366; // one calendar year of daily occurrences, as a sanity cap

export function computeNextRunAt(frequency, fromIso) {
  const d = new Date(fromIso);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else throw new Error(`Unknown frequency: ${frequency}`);
  return d.toISOString();
}

function fireOnce(template) {
  const splitConfig = JSON.parse(template.split_config);
  const rawInput = {
    description: template.description,
    amountCents: template.amount_cents,
    paidBy: template.paid_by,
    category: template.category,
    splitType: template.split_type,
    ...splitConfig,
  };
  createExpense(template.group_id, template.created_by, rawInput, {
    activityType: 'expense_added',
    activityNote: 'recurring charge',
  });
}

// Runs every due template, catching up every missed occurrence (e.g. the
// server was down for three days on a daily charge) rather than only
// advancing one step per scheduler tick.
export function runDueRecurringExpenses(nowIso = new Date().toISOString()) {
  const due = db.prepare(`SELECT * FROM recurring_expenses WHERE active = 1 AND next_run_at <= ?`).all(nowIso);
  let fired = 0;

  for (const template of due) {
    let nextRunAt = template.next_run_at;
    let runs = 0;
    try {
      while (nextRunAt <= nowIso && runs < MAX_CATCHUP_RUNS) {
        fireOnce(template);
        nextRunAt = computeNextRunAt(template.frequency, nextRunAt);
        runs += 1;
        fired += 1;
      }
      db.prepare(`UPDATE recurring_expenses SET next_run_at = ?, last_run_at = ? WHERE id = ?`).run(
        nextRunAt,
        nowIso,
        template.id
      );
    } catch (err) {
      // A split participant may have left the group, the payer may no
      // longer be a member, etc. Pause it (rather than retry-loop forever
      // or silently drop it) and say why, so it's visible in the UI.
      db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ?`).run(template.id);
      console.warn(`Recurring expense ${template.id} paused: ${err.message}`);
    }
  }

  return fired;
}

let timer = null;

export function startRecurringExpenseScheduler(intervalMs = 5 * 60 * 1000) {
  runDueRecurringExpenses();
  timer = setInterval(() => runDueRecurringExpenses(), intervalMs);
  timer.unref?.(); // don't keep the process alive on its own in tests/scripts
  return timer;
}

export function stopRecurringExpenseScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
