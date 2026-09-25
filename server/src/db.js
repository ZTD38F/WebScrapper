import Database from "better-sqlite3";
import { config } from "./config.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at TEXT NOT NULL,
  lease_until TEXT,
  worker_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx
  ON jobs(status, run_at);

CREATE INDEX IF NOT EXISTS jobs_lease_idx
  ON jobs(status, lease_until);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_seconds INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_job_id TEXT
);

CREATE INDEX IF NOT EXISTS schedules_due_idx
  ON schedules(enabled, next_run_at);
`);

const nowIso = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? null);

function parseJson(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrateJob(row) {
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    payload_json: undefined,
    result_json: undefined
  };
}

function hydrateSchedule(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    payload: parseJson(row.payload_json),
    payload_json: undefined
  };
}

export function enqueueJob({ type = "scrape", payload, runAt = nowIso(), maxAttempts = 3, id = crypto.randomUUID() }) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO jobs (
      id,type,status,payload_json,attempts,max_attempts,run_at,created_at,updated_at
    ) VALUES (?,?,?,?,0,?,?,?,?)
  `).run(id, type, "queued", json(payload), Math.max(1, Math.floor(maxAttempts)), runAt, now, now);
  return getJob(id);
}

export function getJob(id) {
  return hydrateJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

export function listJobs({ limit = 100, status } = {}) {
  const capped = Math.min(1000, Math.max(1, Number(limit) || 100));
  const rows = status
    ? db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, capped)
    : db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(capped);
  return rows.map(hydrateJob);
}

const claimTx = db.transaction((workerId, leaseSeconds) => {
  const now = nowIso();
  const expired = db.prepare(`
    SELECT * FROM jobs
    WHERE (
      (status = 'queued' AND run_at <= ?)
      OR
      (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?)
    )
    ORDER BY
      CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
      run_at ASC,
      created_at ASC
    LIMIT 1
  `).get(now, now);

  if (!expired) return null;

  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const startedAt = expired.started_at || now;
  const info = db.prepare(`
    UPDATE jobs
    SET status='running',
        attempts=attempts+1,
        worker_id=?,
        lease_until=?,
        started_at=?,
        updated_at=?
    WHERE id=?
      AND (
        status='queued'
        OR (status='running' AND lease_until IS NOT NULL AND lease_until < ?)
      )
  `).run(workerId, leaseUntil, startedAt, now, expired.id, now);

  if (!info.changes) return null;
  return hydrateJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(expired.id));
});

export function claimJob(workerId, leaseSeconds) {
  return claimTx(workerId, leaseSeconds);
}

export function renewLease(id, workerId, leaseSeconds) {
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const info = db.prepare(`
    UPDATE jobs SET lease_until=?, updated_at=?
    WHERE id=? AND status='running' AND worker_id=?
  `).run(leaseUntil, nowIso(), id, workerId);
  return Boolean(info.changes);
}

export function completeJob(id, workerId, result) {
  const now = nowIso();
  const info = db.prepare(`
    UPDATE jobs
    SET status='succeeded', result_json=?, error=NULL, lease_until=NULL,
        worker_id=NULL, finished_at=?, updated_at=?
    WHERE id=? AND status='running' AND worker_id=?
  `).run(json(result), now, now, id, workerId);
  return Boolean(info.changes);
}

export function failJob(id, workerId, error) {
  const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  if (!row || row.status !== "running" || row.worker_id !== workerId) return false;

  const now = nowIso();
  const message = String(error?.stack || error?.message || error || "Unknown error").slice(0, 30000);

  if (row.attempts < row.max_attempts) {
    const delaySeconds = Math.min(300, Math.max(2, 2 ** Math.min(8, row.attempts)));
    const runAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status='queued', error=?, run_at=?, lease_until=NULL, worker_id=NULL, updated_at=?
      WHERE id=?
    `).run(message, runAt, now, id);
  } else {
    db.prepare(`
      UPDATE jobs
      SET status='failed', error=?, lease_until=NULL, worker_id=NULL,
          finished_at=?, updated_at=?
      WHERE id=?
    `).run(message, now, now, id);
  }
  return true;
}

export function cancelJob(id) {
  const now = nowIso();
  const info = db.prepare(`
    UPDATE jobs
    SET status='cancelled', lease_until=NULL, worker_id=NULL, finished_at=?, updated_at=?
    WHERE id=? AND status IN ('queued','running')
  `).run(now, now, id);
  return Boolean(info.changes);
}

export function isJobCancelled(id) {
  return db.prepare("SELECT status FROM jobs WHERE id=?").get(id)?.status === "cancelled";
}

export function createSchedule({ name, intervalSeconds, payload, enabled = true, nextRunAt, id = crypto.randomUUID() }) {
  const now = nowIso();
  const interval = Math.max(60, Math.floor(Number(intervalSeconds) || 3600));
  const next = nextRunAt || new Date(Date.now() + interval * 1000).toISOString();
  db.prepare(`
    INSERT INTO schedules (
      id,name,enabled,interval_seconds,payload_json,next_run_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(id, String(name || "Scheduled scraper"), enabled ? 1 : 0, interval, json(payload), next, now, now);
  return getSchedule(id);
}

export function getSchedule(id) {
  return hydrateSchedule(db.prepare("SELECT * FROM schedules WHERE id=?").get(id));
}

export function listSchedules() {
  return db.prepare("SELECT * FROM schedules ORDER BY created_at DESC").all().map(hydrateSchedule);
}

export function deleteSchedule(id) {
  return Boolean(db.prepare("DELETE FROM schedules WHERE id=?").run(id).changes);
}

export function setScheduleEnabled(id, enabled) {
  const now = nowIso();
  const info = db.prepare("UPDATE schedules SET enabled=?, updated_at=? WHERE id=?").run(enabled ? 1 : 0, now, id);
  return Boolean(info.changes);
}

const enqueueDueTx = db.transaction(() => {
  const now = nowIso();
  const due = db.prepare(`
    SELECT * FROM schedules
    WHERE enabled=1 AND next_run_at <= ?
    ORDER BY next_run_at ASC
    LIMIT 50
  `).all(now);

  const jobs = [];
  for (const schedule of due) {
    const job = enqueueJob({
      type: "scrape",
      payload: parseJson(schedule.payload_json),
      maxAttempts: 3
    });
    const nextRun = new Date(Date.now() + schedule.interval_seconds * 1000).toISOString();
    db.prepare(`
      UPDATE schedules
      SET next_run_at=?, last_job_id=?, updated_at=?
      WHERE id=?
    `).run(nextRun, job.id, now, schedule.id);
    jobs.push(job);
  }
  return jobs;
});

export function enqueueDueSchedules() {
  return enqueueDueTx();
}

export function closeDatabase() {
  db.close();
}
