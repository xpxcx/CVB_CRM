import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";
import { suggestSlots } from "./slotEngine.js";
import { registerClassmateRoutes } from "./classmateApi.js";
import {
  listAppointments,
  listAppointmentsInPeriod,
  insertAppointment,
  listServices,
  insertService,
  getDbPath,
} from "./db.js";
import { registerIntegrationRoutes } from "./integration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const openApiSpec = JSON.parse(readFileSync(join(__dirname, "openapi.json"), "utf8"));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const getMiniCrmBaseUrl = () =>
  (process.env.PUBLIC_BASE_URL || process.env.MINICRM_BASE_URL || `http://127.0.0.1:${PORT}`).replace(
    /\/$/,
    ""
  );

registerClassmateRoutes(app);
registerIntegrationRoutes(app, { getMiniCrmBaseUrl });

/**
 * GET — получение данных (требование задания)
 * Примеры: /api/services, /api/appointments
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "MiniCRM Booking API", version: "1.0.0" });
});

app.get("/api/services", (req, res) => {
  res.json({ data: listServices() });
});

app.post("/api/services", (req, res) => {
  const { title, defaultDurationMin, price, id } = req.body || {};
  if (!title || String(title).trim() === "") {
    return res.status(400).json({ error: "Укажите title" });
  }
  const dur = Number(defaultDurationMin);
  const pr = Number(price);
  if (!Number.isFinite(dur) || dur <= 0 || dur > 24 * 60) {
    return res.status(400).json({ error: "Укажите defaultDurationMin (1…1440)" });
  }
  if (!Number.isFinite(pr) || pr < 0) {
    return res.status(400).json({ error: "Укажите price (число ≥ 0)" });
  }
  try {
    const sid = insertService({ id, title, defaultDurationMin: dur, price: pr });
    res.status(201).json({
      data: { id: sid, title: String(title).trim(), defaultDurationMin: dur, price: pr },
      message: "Услуга добавлена",
    });
  } catch (e) {
    if (e && e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: "Услуга с таким id уже есть" });
    }
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/appointments", (req, res) => {
  const data = listAppointments();
  res.json({ data, count: data.length });
});

function parseIsoOrNull(v) {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function short100(s) {
  const x = s == null ? "" : String(s);
  if (x.length <= 100) return x;
  return x.slice(0, 100);
}

app.get("/api/calendar/events", (req, res) => {
  const startIso = parseIsoOrNull(req.query.start);
  const endIso = parseIsoOrNull(req.query.end);
  if (!startIso || !endIso) {
    return res.status(400).json({ error: "Укажите query-параметры start и end (ISO 8601)" });
  }
  if (new Date(startIso) >= new Date(endIso)) {
    return res.status(400).json({ error: "start должен быть меньше end" });
  }

  const rows = listAppointmentsInPeriod({ startIso, endIso });
  const data = rows.map((a) => {
    const fallbackText = [a.clientName, a.clientPhone, a.serviceId].filter(Boolean).join(" · ");
    const text = a.description && String(a.description).trim() ? a.description : fallbackText;
    return {
      start: a.start,
      end: a.end,
      summary: short100(text),
    };
  });
  res.json({ data, count: data.length, period: { start: startIso, end: endIso } });
});

app.post("/api/slots/suggest", (req, res) => {
  try {
    const result = suggestSlots(req.body);
    res.status(200).json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});


app.post("/api/appointments", (req, res) => {
  const { clientName, clientPhone, serviceId, start, end, description } = req.body || {};
  if (!clientName || !start || !end) {
    return res.status(400).json({
      error: "Укажите clientName, start, end (ISO 8601). clientPhone и serviceId — опционально.",
    });
  }
  const id = `appt-${Date.now()}`;
  const row = {
    id,
    clientName: String(clientName),
    clientPhone: clientPhone ? String(clientPhone) : null,
    serviceId: serviceId || "svc-1",
    start: String(start),
    end: String(end),
    description: description != null && String(description).trim() ? String(description) : null,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };
  insertAppointment(row);
  res.status(201).json({ data: row, message: "Запись сохранена в SQLite" });
});

app.get("/openapi.json", (req, res) => {
  res.type("application/json").send(openApiSpec);
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "MiniCRM Booking API — Swagger UI",
    customCss: ".swagger-ui .topbar { display: none }",
  })
);

app.use(express.static(join(__dirname, "public")));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }
  next();
});

app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MiniCRM Booking API: http://localhost:${PORT} (при запуске локально)`);
  console.log(`MiniCRM Booking API: https://cvb-crm.onrender.com`);
  console.log(`  GET  /api/health`);
  console.log(`  GET/POST /api/services`);
  console.log(`  GET  /api/appointments`);
  console.log(`  POST /api/slots/suggest`);
  console.log(`  POST /api/appointments`);
  console.log(`  GET  /openapi.json`);
  console.log(`  GET  /api-docs — Swagger UI`);
  console.log(`  GET  /api/integration/status`);
});
