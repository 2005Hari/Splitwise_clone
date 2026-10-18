import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bump this whenever schema.sql changes in a way SQLite can't apply with a
// plain additive `CREATE TABLE IF NOT EXISTS` (a changed CHECK constraint, a
// column that needs to become NOT NULL/nullable, etc). This app has no real
// deployed users yet, so rather than hand-writing SQLite's awkward
// rebuild-the-table migrations, an out-of-date dev database is safely
// rotated aside (renamed, never deleted) and recreated fresh from
// schema.sql. Bump it again the next time schema.sql changes shape.
const SCHEMA_VERSION = 3;

const dbPath = process.env.SQLITE_DB_PATH || './data/splitwise.sqlite';
const resolvedPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

function currentVersion(database) {
  const hasMeta = database
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    .get();
  if (!hasMeta) return 0;
  const row = database.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get();
  return row ? Number(row.value) : 0;
}

if (fs.existsSync(resolvedPath)) {
  const probe = new Database(resolvedPath);
  const existingVersion = currentVersion(probe);
  probe.close();
  if (existingVersion !== SCHEMA_VERSION) {
    const backupPath = `${resolvedPath}.v${existingVersion}.bak-${Date.now()}`;
    fs.renameSync(resolvedPath, backupPath);
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(resolvedPath + ext)) fs.rmSync(resolvedPath + ext);
    }
    console.warn(
      `Database schema changed (v${existingVersion} -> v${SCHEMA_VERSION}). ` +
        `Old database backed up to ${backupPath}; starting fresh. ` +
        `Run 'npm run db:seed' again if you want demo data.`
    );
  }
}

export const db = new Database(resolvedPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION));

export default db;
