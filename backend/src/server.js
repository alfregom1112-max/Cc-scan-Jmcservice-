import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { decryptField, digestDocument, encryptField } from "./scanCrypto.js";

const env = process.env;
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MONGODB_URI", "MONGODB_DB_NAME", "SCAN_DATA_ENCRYPTION_KEY", "SCAN_LOOKUP_HMAC_KEY"];
const missing = required.filter((key) => !env[key]);
if (missing.length) throw new Error(`Faltan variables del servidor: ${missing.join(", ")}`);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const mongoClient = new MongoClient(env.MONGODB_URI, {
  appName: "jm-servicetec-scan-api",
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 10000,
  retryWrites: true,
});
await mongoClient.connect();
const db = mongoClient.db(env.MONGODB_DB_NAME);
const scans = db.collection("scans");
const audit = db.collection("scan_audit");
await Promise.all([
  scans.createIndex({ tenant_id: 1, event_id: 1, idempotency_key: 1 }, { unique: true, name: "tenant_event_idempotency_uq" }),
  scans.createIndex({ tenant_id: 1, event_id: 1, document_type: 1, document_lookup: 1 }, { unique: true, name: "tenant_event_document_uq" }),
  scans.createIndex({ tenant_id: 1, legacy_source_id: 1 }, { unique: true, partialFilterExpression: { legacy_source_id: { $exists: true } }, name: "tenant_legacy_scan_uq" }),
  scans.createIndex({ tenant_id: 1, event_id: 1, received_at: -1 }, { name: "tenant_event_received_idx" }),
  scans.createIndex({ tenant_id: 1, event_id: 1, operator_id: 1, received_at: -1 }, { name: "tenant_operator_received_idx" }),
  audit.createIndex({ tenant_id: 1, event_id: 1, created_at: -1 }, { name: "tenant_event_audit_idx" }),
]);

const app = Fastify({
  logger: { redact: ["req.headers.authorization", "req.headers.cookie"] },
  bodyLimit: 64 * 1024,
  disableRequestLogging: true,
});
const origins = (env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
await app.register(cors, { origin: origins.length ? origins : false, methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type"] });
await app.register(rateLimit, { global: true, max: Number(env.SCAN_RATE_LIMIT_PER_MINUTE || 600), timeWindow: "1 minute" });

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
function bearer(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
  return match?.[1] || "";
}
function relationOne(value) { return Array.isArray(value) ? value[0] : value; }

async function authenticate(request, reply) {
  const token = bearer(request);
  if (!token) return reply.code(401).send({ error: "Inicia sesión para continuar" });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return reply.code(401).send({ error: "La sesión no es válida o venció" });
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,email,full_name,role,status,tenant_id,is_platform_admin")
    .eq("id", user.id).maybeSingle();
  if (error || !profile || profile.status !== "active" || !profile.tenant_id) return reply.code(403).send({ error: "La cuenta está inactiva o no tiene empresa asignada" });
  const { data: tenant } = await supabase.from("tenants")
    .select("id,name,subscription_status,current_period_ends_at,billing_period")
    .eq("id", profile.tenant_id).maybeSingle();
  if (!tenant) return reply.code(403).send({ error: "La empresa no está activa" });
  const active = tenant.subscription_status === "internal" ||
    (["active", "trial"].includes(tenant.subscription_status) && tenant.current_period_ends_at && new Date(tenant.current_period_ends_at) > new Date());
  request.actor = { id: profile.id, email: profile.email, name: profile.full_name, role: profile.role, tenant_id: profile.tenant_id, is_platform_admin: Boolean(profile.is_platform_admin), tenant, membership_active: Boolean(active) };
}
async function activeMembership(request, reply) {
  if (!request.actor?.membership_active) return reply.code(402).send({ error: "La membresía está vencida o inactiva" });
}
async function authorizeEvent(request, reply) {
  const eventId = request.params.eventId || request.body?.event_id;
  if (!eventId) return reply.code(400).send({ error: "Falta el evento" });
  const { data: event, error } = await supabase.from("events")
    .select("id,name,tenant_id,status,starts_at")
    .eq("id", eventId).maybeSingle();
  if (error || !event || event.tenant_id !== request.actor.tenant_id) return reply.code(404).send({ error: "El evento no existe o no pertenece a esta empresa" });
  if (request.actor.role !== "admin") {
    if (event.status !== "active") return reply.code(404).send({ error: "El evento no está disponible" });
    const { data: assignment } = await supabase.from("event_operators")
      .select("event_id").eq("event_id", event.id).eq("operator_id", request.actor.id).eq("status", "active").maybeSingle();
    if (!assignment) return reply.code(403).send({ error: "No tienes acceso a este evento" });
  }
  request.event = event;
}
async function verifyAdmin(request, reply) {
  if (request.actor?.role !== "admin") return reply.code(403).send({ error: "Se requiere un administrador de la empresa" });
}
function asScan(doc) {
  return {
    id: doc.id,
    evento_id: doc.event_id,
    cedula: decryptField(doc.document_number_enc),
    nombre: decryptField(doc.display_name_enc),
    timestamp: new Date(doc.captured_at).getTime(),
    created_at: doc.received_at,
    device_id: doc.device_id,
    operator_id: doc.operator_id,
    result: doc.result,
  };
}
async function wasInDirectory(tenantId, type, number) {
  const { data, error } = await supabase.from("people").select("id")
    .eq("tenant_id", tenantId).eq("document_type", type).eq("document_number", number).limit(1);
  if (error) throw fail(503, "No se pudo consultar el directorio opcional");
  return Boolean(data?.length);
}

app.get("/v1/health", async () => ({ ok: true, service: "jm-servicetec-scan-api", version: "3.0.0" }));
app.get("/v1/me", { preHandler: authenticate }, async (request) => ({
  id: request.actor.id, email: request.actor.email, nombre: request.actor.name, role: request.actor.role,
  tenant_id: request.actor.tenant_id, tenant_name: request.actor.tenant.name,
  subscription_status: request.actor.tenant.subscription_status,
  current_period_ends_at: request.actor.tenant.current_period_ends_at,
  is_platform_admin: request.actor.is_platform_admin,
}));
app.get("/v1/events/counts", { preHandler: [authenticate, activeMembership] }, async (request) => {
  const { data: events, error } = await supabase.from("events").select("id,status").eq("tenant_id", request.actor.tenant_id);
  if (error) throw fail(503, "No se pudieron cargar los eventos");
  let eventIds = (events || []).map((event) => event.id);
  if (request.actor.role !== "admin") {
    eventIds = (events || []).filter((event) => event.status === "active").map((event) => event.id);
    if (!eventIds.length) return {};
    const { data: assigned, error: assignmentError } = await supabase.from("event_operators")
      .select("event_id").eq("operator_id", request.actor.id).eq("status", "active").in("event_id", eventIds);
    if (assignmentError) throw fail(503, "No se pudieron consultar las asignaciones");
    eventIds = (assigned || []).map((assignment) => assignment.event_id);
  }
  if (!eventIds.length) return {};
  const counts = await scans.aggregate([
    { $match: { tenant_id: request.actor.tenant_id, event_id: { $in: eventIds } } },
    { $group: { _id: "$event_id", count: { $sum: 1 } } },
  ]).toArray();
  return Object.fromEntries(counts.map((row) => [row._id, row.count]));
});

app.post("/v1/scans", { preHandler: [authenticate, activeMembership, authorizeEvent] }, async (request, reply) => {
  const body = request.body || {};
  if (request.event.status !== "active") return reply.code(409).send({ error: "El evento está cerrado" });
  const docType = String(body.document_type || "CC").trim().toUpperCase();
  const docNumber = String(body.document_number || body.cedula || "").replace(/[\s.-]/g, "").toUpperCase();
  const idempotency = String(body.idempotency_key || "").toLowerCase();
  const capturedMs = Number(body.captured_at ?? body.timestamp);
  const deviceId = String(body.device_id || "").slice(0, 160);
  const displayName = String(body.display_name || body.nombre || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!/^[0-9a-f-]{36}$/.test(idempotency) || !["CC", "TI", "CE", "PPT", "PEP", "NUIP"].includes(docType) || !/^[A-Z0-9]{4,24}$/.test(docNumber) || !Number.isFinite(capturedMs) || capturedMs <= 0) {
    return reply.code(400).send({ error: "Datos de lectura inválidos" });
  }
  const lookup = digestDocument(request.actor.tenant_id, request.event.id, docType, docNumber);
  const scope = { tenant_id: request.actor.tenant_id, event_id: request.event.id };
  const byKey = await scans.findOne({ ...scope, idempotency_key: idempotency });
  if (byKey) return { ok: true, duplicate: true, registro: asScan(byKey) };
  const existing = await scans.findOne({ ...scope, document_type: docType, document_lookup: lookup });
  if (existing) return { ok: true, duplicate: true, registro: asScan(existing) };
  let result = "not_found";
  try { if (await wasInDirectory(request.actor.tenant_id, docType, docNumber)) result = "found"; }
  catch (error) { request.log.warn({ err: error }, "Directory lookup unavailable; scan is still saved"); }
  const now = new Date();
  const scan = {
    id: randomUUID(), ...scope, document_type: docType, document_lookup: lookup,
    document_number_enc: encryptField(docNumber), display_name_enc: encryptField(displayName),
    result, captured_at: new Date(capturedMs), received_at: now, device_id: deviceId,
    operator_id: request.actor.id, idempotency_key: idempotency,
  };
  try {
    await scans.insertOne(scan);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const duplicate = await scans.findOne({ ...scope, $or: [{ idempotency_key: idempotency }, { document_type: docType, document_lookup: lookup }] });
    if (!duplicate) throw error;
    return { ok: true, duplicate: true, registro: asScan(duplicate) };
  }
  await audit.insertOne({ tenant_id: request.actor.tenant_id, event_id: request.event.id, actor_id: request.actor.id, action: "scan_saved", entity_id: scan.id, created_at: now });
  return { ok: true, duplicate: false, registro: asScan(scan) };
});

app.get("/v1/events/:eventId/scans", { preHandler: [authenticate, activeMembership, authorizeEvent] }, async (request) => {
  const limit = Math.max(1, Math.min(500, Number(request.query.limit) || 200));
  const offset = Math.max(0, Math.min(1000000, Number(request.query.offset) || 0));
  const filter = { tenant_id: request.actor.tenant_id, event_id: request.event.id };
  if (request.actor.role !== "admin") filter.operator_id = request.actor.id;
  else if (request.query.operatorId) filter.operator_id = String(request.query.operatorId);
  const rows = await scans.find(filter).sort({ received_at: -1 }).skip(offset).limit(limit).toArray();
  return rows.map(asScan);
});
app.get("/v1/events/:eventId/count", { preHandler: [authenticate, activeMembership, authorizeEvent] }, async (request) => ({
  total: await scans.countDocuments({ tenant_id: request.actor.tenant_id, event_id: request.event.id, operator_id: request.actor.id }),
}));
app.get("/v1/events/:eventId/stats", { preHandler: [authenticate, activeMembership, authorizeEvent] }, async (request) => {
  const scope = { tenant_id: request.actor.tenant_id, event_id: request.event.id };
  const dayStart = new Date(); dayStart.setUTCHours(5, 0, 0, 0);
  const [total, today, recent] = await Promise.all([
    scans.countDocuments(scope),
    scans.countDocuments({ ...scope, captured_at: { $gte: dayStart } }),
    scans.find(scope).sort({ received_at: -1 }).limit(8).toArray(),
  ]);
  return { total, hoy: today, duplicados_detectados: 0, dispositivos_usados: new Set(recent.map((x) => x.device_id).filter(Boolean)).size, dispositivos_activos: 0,
    recientes: recent.map((x) => ({ id: x.id, cedula: decryptField(x.document_number_enc), nombre: decryptField(x.display_name_enc), created_at: x.received_at })) };
});
app.get("/v1/admin/metrics", { preHandler: [authenticate, activeMembership, verifyAdmin] }, async (request) => {
  const { data: events, error } = await supabase.from("events").select("id,status").eq("tenant_id", request.actor.tenant_id);
  if (error) throw fail(503, "No se pudieron cargar las jornadas");
  const scope = { tenant_id: request.actor.tenant_id };
  const total = await scans.countDocuments(scope);
  const eventId = String(request.query.eventId || "");
  let eventStats = { registros: 0, hoy: 0, duplicados: 0, dispositivos_usados: 0, dispositivos_activos: 0, calidad_nombre_pct: 0, calidad_fecha_pct: 0 };
  let recientes = [];
  if (eventId) {
    const { data: event } = await supabase.from("events").select("id,tenant_id,status").eq("id", eventId).maybeSingle();
    if (!event || event.tenant_id !== request.actor.tenant_id) throw fail(404, "La jornada no está disponible");
    const stats = await app.inject({ method: "GET", url: `/v1/events/${eventId}/stats`, headers: { authorization: request.headers.authorization } });
    const payload = stats.json();
    eventStats = { ...eventStats, registros: payload.total || 0, hoy: payload.hoy || 0, dispositivos_usados: payload.dispositivos_usados || 0 };
    recientes = payload.recientes || [];
  }
  return { global: { eventos: events?.length || 0, eventos_activos: (events || []).filter((event) => event.status === "active").length, registros: total }, evento_actual: eventStats, top_operadores: [], por_hora: [], recientes, ia: { configured: false, enabled: false, model: "", mode: "", min_confidence: 0 } };
});
app.get("/v1/events/:eventId/audit", { preHandler: [authenticate, activeMembership, authorizeEvent, verifyAdmin] }, async (request) => {
  const rows = await audit.find({ tenant_id: request.actor.tenant_id, event_id: request.event.id }).sort({ created_at: -1 }).limit(500).toArray();
  return rows.map((row) => ({ id: row.entity_id, event_type: row.action, aggregate_id: row.event_id, data: {}, timestamp: new Date(row.created_at).getTime(), created_at: row.created_at }));
});
app.delete("/v1/events/:eventId", { preHandler: [authenticate, activeMembership, authorizeEvent, verifyAdmin] }, async (request) => {
  const { data, error } = await supabase.from("events").update({ status: "closed" })
    .eq("id", request.event.id).eq("tenant_id", request.actor.tenant_id).select("id").single();
  if (error || !data) throw fail(503, "No se pudo archivar el evento");
  await audit.insertOne({ tenant_id: request.actor.tenant_id, event_id: request.event.id, actor_id: request.actor.id, action: "event_archived", created_at: new Date() });
  return { ok: true, archived: true, records_preserved: true };
});
app.delete("/v1/events/:eventId/scans", { preHandler: [authenticate, activeMembership, authorizeEvent, verifyAdmin] }, async (request, reply) => {
  const result = await scans.deleteMany({ tenant_id: request.actor.tenant_id, event_id: request.event.id });
  await audit.insertOne({ tenant_id: request.actor.tenant_id, event_id: request.event.id, actor_id: request.actor.id, action: "event_scans_cleared", created_at: new Date(), details: { count: result.deletedCount } });
  return { ok: true, registros_borrados: result.deletedCount };
});
app.delete("/v1/events/:eventId/scans/:scanId", { preHandler: [authenticate, activeMembership, authorizeEvent, verifyAdmin] }, async (request, reply) => {
  const result = await scans.deleteOne({ tenant_id: request.actor.tenant_id, event_id: request.event.id, id: request.params.scanId });
  if (!result.deletedCount) return reply.code(404).send({ error: "No se encontró el registro" });
  await audit.insertOne({ tenant_id: request.actor.tenant_id, event_id: request.event.id, actor_id: request.actor.id, action: "scan_deleted", entity_id: request.params.scanId, created_at: new Date() });
  return { ok: true };
});
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, route: request.routeOptions?.url }, "API request failed");
  const status = Number(error.statusCode) || 500;
  return reply.code(status).send({ error: status >= 500 ? "Error interno del servicio. Intenta de nuevo." : error.message });
});
app.addHook("onClose", async () => { await mongoClient.close(); });
const port = Number(env.PORT || 8080);
await app.listen({ host: "0.0.0.0", port });
