import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || join(__dirname, "data", "minicrm.sqlite");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    client_phone TEXT,
    service_id TEXT NOT NULL,
    start_iso TEXT NOT NULL,
    end_iso TEXT NOT NULL,
    description_text TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL
  );
`);

function ensureAppointmentsDescriptionColumn() {
  const cols = db.prepare(`PRAGMA table_info(appointments)`).all();
  const has = cols.some((c) => c && c.name === "description_text");
  if (has) return;
  db.exec(`ALTER TABLE appointments ADD COLUMN description_text TEXT;`);
}

ensureAppointmentsDescriptionColumn();

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    default_duration_min INTEGER NOT NULL,
    price REAL NOT NULL
  );
`);

const seedServices = db.prepare(
  `INSERT INTO services (id, title, default_duration_min, price) VALUES (?, ?, ?, ?)`
);
const serviceCount = db.prepare("SELECT COUNT(*) AS n FROM services").get();
if (serviceCount.n === 0) {
  seedServices.run("svc-1", "Индивидуальное занятие", 60, 1500);
  seedServices.run("svc-2", "Консультация", 30, 800);
}

export function getDbPath() {
  return dbPath;
}

export function listAppointments() {
  return db
    .prepare(
      `SELECT id, client_name AS clientName, client_phone AS clientPhone,
              service_id AS serviceId, start_iso AS "start", end_iso AS "end",
              description_text AS "description",
              status, created_at AS createdAt
       FROM appointments ORDER BY datetime(created_at) DESC`
    )
    .all();
}

export function listAppointmentsInPeriod({ startIso, endIso }) {
  return db
    .prepare(
      `SELECT id, client_name AS clientName, client_phone AS clientPhone,
              service_id AS serviceId, start_iso AS "start", end_iso AS "end",
              description_text AS "description",
              status, created_at AS createdAt
       FROM appointments
       WHERE start_iso < @endIso AND end_iso > @startIso
       ORDER BY datetime(start_iso) ASC`
    )
    .all({ startIso, endIso });
}

export function listServices() {
  return db
    .prepare(
      `SELECT id, title, default_duration_min AS defaultDurationMin, price FROM services ORDER BY title`
    )
    .all();
}

export function insertService({ id, title, defaultDurationMin, price }) {
  const sid = id && String(id).trim() ? String(id).trim() : `svc-${Date.now()}`;
  db.prepare(
    `INSERT INTO services (id, title, default_duration_min, price) VALUES (@id, @title, @defaultDurationMin, @price)`
  ).run({
    id: sid,
    title: String(title).trim(),
    defaultDurationMin: Number(defaultDurationMin),
    price: Number(price),
  });
  return sid;
}

export function insertAppointment(row) {
  db.prepare(
    `INSERT INTO appointments (id, client_name, client_phone, service_id, start_iso, end_iso, description_text, status, created_at)
     VALUES (@id, @clientName, @clientPhone, @serviceId, @start, @end, @description, @status, @createdAt)`
  ).run({
    id: row.id,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    serviceId: row.serviceId,
    start: row.start,
    end: row.end,
    description: row.description || null,
    status: row.status,
    createdAt: row.createdAt,
  });
}
