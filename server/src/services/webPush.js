// Browser push notifications via the standard Web Push protocol (VAPID).
// No external push-notification SaaS or account: the browser's own push
// service (part of Chrome/Firefox/etc.) delivers these once we sign
// requests with our own self-generated keypair. If no keypair is configured
// via env, one is generated on first boot and cached to disk so
// subscriptions keep working across restarts — see keysFile below.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import db from '../db/index.js';

const keysFile = path.resolve(
  process.cwd(),
  process.env.SQLITE_DB_PATH ? path.join(path.dirname(process.env.SQLITE_DB_PATH), 'vapid-keys.json') : './data/vapid-keys.json'
);

function loadOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  if (fs.existsSync(keysFile)) {
    return JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2));
  console.warn(
    `Generated a new Web Push VAPID keypair at ${keysFile} (first boot). ` +
      'To keep it stable across deployments, copy VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY into your .env.'
  );
  return keys;
}

const { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY } = loadOrCreateKeys();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export { VAPID_PUBLIC_KEY };

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Browser unsubscribed or the endpoint expired — stop trying it.
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
    } else {
      console.warn('web push delivery failed:', err.message);
    }
  }
}

export async function sendPushToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
}

// Notifies every OTHER member of the group (never the person who triggered
// it) — e.g. "Priya added Dinner ($40)" to everyone but Priya.
export async function notifyGroupMembers(groupId, excludeUserId, payload) {
  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?')
    .all(groupId, excludeUserId);
  await Promise.all(members.map((m) => sendPushToUser(m.user_id, payload)));
}
