import db from '../db/index.js';

const insertActivity = db.prepare(
  `INSERT INTO activity_log (group_id, actor_id, type, payload) VALUES (?, ?, ?, ?)`
);

export function logActivity(groupId, actorId, type, payload = {}) {
  insertActivity.run(groupId, actorId, type, JSON.stringify(payload));
}
