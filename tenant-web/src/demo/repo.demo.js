// MODO DEMOSTRACIÓN — datos 100 % ficticios en memoria. Solo existe en `npm run build:demo`.
// No se conecta a Supabase ni a la API; los documentos usan el prefijo DEMO.
const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const rand = rng(20261031);
const FIRST = ["Camila", "Andrés", "Valentina", "Santiago", "Daniela", "Mateo", "Laura", "Julián", "Sofía", "Felipe", "Natalia", "Esteban", "Paula", "Sebastián", "Mariana", "Tomás"];
const LAST = ["Rojas", "Herrera", "Molina", "Castaño", "Quintero", "Ospina", "Vargas", "Giraldo", "Mejía", "Salazar", "Cárdenas", "Pineda", "Londoño", "Arango", "Duque", "Zapata"];
const pick = (a) => a[Math.floor(rand() * a.length)];

const T = {
  jm: { id: "t-jm", name: "JM ServiceTec", slug: "jm-servicetec", billing_period: "annual", subscription_status: "internal", price_cop: null, current_period_starts_at: null, current_period_ends_at: null, created_at: iso(now - 400 * DAY) },
  andina: { id: "t-andina", name: "Constructora Andina SAS", slug: "constructora-andina-a1b2c3", billing_period: "annual", subscription_status: "active", price_cop: 4800000, current_period_starts_at: iso(now - 303 * DAY), current_period_ends_at: iso(now + 62 * DAY), created_at: iso(now - 310 * DAY) },
  horizonte: { id: "t-horizonte", name: "Fundación Horizonte", slug: "fundacion-horizonte-d4e5f6", billing_period: "monthly", subscription_status: "trial", price_cop: 390000, current_period_starts_at: iso(now - 21 * DAY), current_period_ends_at: iso(now + 9 * DAY), created_at: iso(now - 22 * DAY) },
  caribe: { id: "t-caribe", name: "Logística del Caribe", slug: "logistica-del-caribe-778899", billing_period: "monthly", subscription_status: "pending_payment", price_cop: null, current_period_starts_at: null, current_period_ends_at: null, created_at: iso(now - 2 * DAY) },
  rafael: { id: "t-rafael", name: "Colegio San Rafael", slug: "colegio-san-rafael-0a1b2c", billing_period: "monthly", subscription_status: "active", price_cop: 450000, current_period_starts_at: iso(now - 9 * DAY), current_period_ends_at: iso(now + 21 * DAY), created_at: iso(now - 140 * DAY) },
  altiplano: { id: "t-altiplano", name: "Transportes Altiplano", slug: "transportes-altiplano-3c4d5e", billing_period: "annual", subscription_status: "suspended", price_cop: 3600000, current_period_starts_at: iso(now - 200 * DAY), current_period_ends_at: iso(now + 165 * DAY), created_at: iso(now - 205 * DAY) },
  valle: { id: "t-valle", name: "Eventos del Valle", slug: "eventos-del-valle-9f8e7d", billing_period: "monthly", subscription_status: "active", price_cop: 520000, current_period_starts_at: iso(now - 33 * DAY), current_period_ends_at: iso(now - 3 * DAY), created_at: iso(now - 90 * DAY) },
};
const tenants = Object.values(T);

const PEOPLE = {
  superadmin: { id: "u-super", email: "superadmin@demo.invalid", full_name: "Marcela Duarte", role: "admin", status: "active", tenant_id: T.jm.id, is_platform_admin: true },
  admin: { id: "u-admin", email: "admin@demo.invalid", full_name: "Ricardo Beltrán", role: "admin", status: "active", tenant_id: T.andina.id, is_platform_admin: false },
  operator: { id: "u-op1", email: "operador1@demo.invalid", full_name: "Diana Cortés", role: "operator", status: "active", tenant_id: T.andina.id, is_platform_admin: false },
};

const users = [
  { ...PEOPLE.admin, created_at: iso(now - 300 * DAY) },
  { ...PEOPLE.operator, created_at: iso(now - 250 * DAY) },
  { id: "u-op2", email: "operador2@demo.invalid", full_name: "Julián Mora", role: "operator", status: "active", created_at: iso(now - 240 * DAY) },
  { id: "u-op3", email: "operador3@demo.invalid", full_name: "Carolina Páez", role: "operator", status: "active", created_at: iso(now - 120 * DAY) },
  { id: "u-op4", email: "operador4@demo.invalid", full_name: "Hernán Gil", role: "operator", status: "inactive", created_at: iso(now - 100 * DAY) },
  { id: "u-ad2", email: "coordinacion@demo.invalid", full_name: "Lucía Henao", role: "admin", status: "active", created_at: iso(now - 80 * DAY) },
];
const opName = (id) => users.find((u) => u.id === id);

const events = [
  { id: "e1", name: "Asamblea general de copropietarios", starts_at: iso(now - 2 * 3600000), place: "Centro de convenciones, Medellín", description: "Registro de asistencia para la asamblea ordinaria anual.", status: "active", created_at: iso(now - 20 * DAY), created_by: "u-admin" },
  { id: "e2", name: "Capacitación de seguridad en obra", starts_at: iso(now + 3 * DAY), place: "Sede Envigado", description: "Jornada obligatoria para contratistas.", status: "active", created_at: iso(now - 9 * DAY), created_by: "u-admin" },
  { id: "e3", name: "Feria de proveedores 2026", starts_at: iso(now + 18 * DAY), place: "Plaza Mayor", description: "", status: "active", created_at: iso(now - 4 * DAY), created_by: "u-ad2" },
  { id: "e4", name: "Inducción corporativa de octubre", starts_at: iso(now - 12 * DAY), place: "Auditorio principal", description: "", status: "closed", created_at: iso(now - 40 * DAY), created_by: "u-admin" },
  { id: "e5", name: "Entrega de dotación", starts_at: iso(now - 30 * DAY), place: "Bodega Itagüí", description: "", status: "closed", created_at: iso(now - 60 * DAY), created_by: "u-admin" },
  { id: "e6", name: "Simulacro de evacuación", starts_at: iso(now + 40 * DAY), place: "Sede principal", description: "Pendiente de confirmar fecha.", status: "inactive", created_at: iso(now - 2 * DAY), created_by: "u-ad2" },
];
const assignments = [
  { eventId: "e1", operatorId: "u-op1", status: "active", since: iso(now - 15 * DAY) },
  { eventId: "e1", operatorId: "u-op2", status: "active", since: iso(now - 15 * DAY) },
  { eventId: "e1", operatorId: "u-op3", status: "active", since: iso(now - 14 * DAY) },
  { eventId: "e2", operatorId: "u-op1", status: "active", since: iso(now - 5 * DAY) },
  { eventId: "e3", operatorId: "u-op3", status: "active", since: iso(now - 2 * DAY) },
  { eventId: "e4", operatorId: "u-op2", status: "inactive", since: iso(now - 38 * DAY) },
];

const scansByEvent = {};
function seedScans(eventId, n, opIds, spanHours) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = now - Math.floor(rand() * spanHours * 3600000);
    out.push({ id: `${eventId}-s${i}`, eventId, document: `DEMO${String(10000 + i * 7).padStart(6, "0")}`, name: `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`, capturedAt: t - 2000, receivedAt: iso(t), deviceId: `dispositivo-demo-${1 + (i % 3)}`, operatorId: opIds[i % opIds.length], result: "registered" });
  }
  return out.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}
scansByEvent.e1 = seedScans("e1", 137, ["u-op1", "u-op2", "u-op3"], 2);
scansByEvent.e2 = seedScans("e2", 0, ["u-op1"], 1);
scansByEvent.e4 = seedScans("e4", 64, ["u-op2", "u-op1"], 6);
scansByEvent.e5 = seedScans("e5", 41, ["u-op1"], 5);
const auditByEvent = {};

let session = null;
const listeners = new Set();
const emit = (event) => setTimeout(() => listeners.forEach((cb) => cb(event, session)), 0);
const userOf = (role) => PEOPLE[role];
const can = (role, ...allowed) => { if (!allowed.includes(role)) throw new Error("Sin permiso (simulado)."); };
const addAudit = (eventId, action) => { (auditByEvent[eventId] ||= []).unshift({ id: `a${Date.now()}${Math.random()}`, action, at: iso(Date.now()) }); };

export const demoRepo = {
  mode: "demo",
  /** Exclusivo de demo: entrar sin credenciales con un rol ficticio. */
  demoSignInAs(role) { session = { userId: userOf(role).id, email: userOf(role).email, demoRole: role }; emit("SIGNED_IN"); },

  auth: {
    async init() {},
    async getSession() { return session; },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() { await wait(); throw new Error("En modo demostración no hay credenciales. Usa los botones «Entrar como»."); },
    async signOut() { session = null; emit("SIGNED_OUT"); },
    async sendRecovery() { await wait(); },
    async updatePassword() { await wait(); },
    async activatePin({ pin }) { await wait(500); if (pin !== "123456") throw new Error("No se pudo activar la cuenta. Verifica el PIN, el correo y la contraseña e inténtalo de nuevo. (Demo: usa el PIN 123456)"); return { ok: true }; },
  },
  async loadContext() {
    await wait();
    const p = userOf(session.demoRole);
    const tenant = p.is_platform_admin ? T.jm : T.andina;
    return { profile: { ...p }, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, subscription_status: tenant.subscription_status, current_period_ends_at: tenant.current_period_ends_at, billing_period: tenant.billing_period } };
  },

  tenants: {
    async list() { await wait(); return tenants.map((t) => ({ ...t })).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async create({ name, ownerEmail, billingPeriod, priceCop }) {
      await wait(400);
      const t = { id: `t-${Date.now()}`, name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-demo01`, billing_period: billingPeriod, subscription_status: "pending_payment", price_cop: priceCop, current_period_starts_at: null, current_period_ends_at: null, created_at: iso(Date.now()) };
      tenants.push(t);
      return { ok: true, tenant: t, owner_email: ownerEmail, pin: "482913", expires_in_minutes: 30 };
    },
    async update(id, action) {
      await wait(300);
      const t = tenants.find((x) => x.id === id);
      const add = (from, period) => { const d = new Date(from); if (period === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString(); };
      if (action === "activate" || action === "renew") {
        const end = t.current_period_ends_at ? new Date(t.current_period_ends_at) : null;
        const from = action === "renew" && end && end > new Date() ? end : new Date();
        t.subscription_status = "active"; t.current_period_starts_at ||= iso(Date.now()); t.current_period_ends_at = add(from, t.billing_period);
      } else t.subscription_status = action === "suspend" ? "suspended" : "cancelled";
      return { ok: true };
    },
  },

  events: {
    async list({ search = "", status = "", offset = 0, limit = 20 }) {
      await wait();
      const q = search.trim().toLowerCase();
      const all = events.filter((e) => (!status || e.status === status) && (!q || e.name.toLowerCase().includes(q) || e.place.toLowerCase().includes(q))).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      return { rows: all.slice(offset, offset + limit).map((e) => ({ ...e })), total: all.length };
    },
    async statusCounts() { await wait(); const c = { active: 0, inactive: 0, closed: 0 }; events.forEach((e) => c[e.status]++); return c; },
    async upcoming(limit = 5) { await wait(); return events.filter((e) => e.status === "active" && new Date(e.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, limit); },
    async options() { await wait(); return events.map((e) => ({ id: e.id, name: e.name, status: e.status, starts_at: e.starts_at })); },
    async get(id) { await wait(); const e = events.find((x) => x.id === id); return e ? { ...e } : null; },
    async create(values, userId) { await wait(300); const e = { id: `e${Date.now()}`, ...values, status: "active", created_at: iso(Date.now()), created_by: userId }; events.unshift(e); return { id: e.id }; },
    async update(id, patch) { await wait(250); Object.assign(events.find((x) => x.id === id), patch); return { id }; },
    async close(id) { await wait(300); events.find((x) => x.id === id).status = "closed"; addAudit(id, "event_archived"); return { ok: true }; },
    async counts() { await wait(); return Object.fromEntries(Object.entries(scansByEvent).map(([k, v]) => [k, v.length])); },
    async operators(eventId) { await wait(); return assignments.filter((a) => a.eventId === eventId).map((a) => ({ operatorId: a.operatorId, status: a.status, since: a.since, name: opName(a.operatorId)?.full_name || "", email: opName(a.operatorId)?.email || "" })); },
    async changeLog(eventId) { await wait(); const e = events.find((x) => x.id === eventId); return [{ id: "c2", action: "UPDATE", at: iso(now - 3 * DAY), actor: "Lucía Henao" }, { id: "c1", action: "INSERT", at: e.created_at, actor: opName(e.created_by)?.full_name || "" }]; },
  },

  scans: {
    async page(eventId, { limit = 25, offset = 0, operatorId }) {
      await wait();
      let list = scansByEvent[eventId] || [];
      if (session.demoRole === "operator") list = list.filter((s) => s.operatorId === session.userId);
      else if (operatorId) list = list.filter((s) => s.operatorId === operatorId);
      return { rows: list.slice(offset, offset + limit), hasMore: list.length > offset + limit };
    },
    async chunk(eventId, { offset, operatorId }) { await wait(120); let list = scansByEvent[eventId] || []; if (operatorId) list = list.filter((s) => s.operatorId === operatorId); return list.slice(offset, offset + 500); },
    async stats(eventId) {
      await wait();
      const list = scansByEvent[eventId] || [];
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return { total: list.length, today: list.filter((s) => new Date(s.receivedAt) >= start).length, devicesRecent: new Set(list.slice(0, 8).map((s) => s.deviceId)).size, recent: list.slice(0, 8).map((s) => ({ id: s.id, document: s.document, name: s.name, receivedAt: s.receivedAt })) };
    },
    async myCount(eventId) { await wait(); return (scansByEvent[eventId] || []).filter((s) => s.operatorId === session.userId).length; },
    async remove(eventId, scanId) { await wait(250); can(session.demoRole, "admin", "superadmin"); scansByEvent[eventId] = (scansByEvent[eventId] || []).filter((s) => s.id !== scanId); addAudit(eventId, "scan_deleted"); return { ok: true }; },
    async clear(eventId) { await wait(300); const n = (scansByEvent[eventId] || []).length; scansByEvent[eventId] = []; addAudit(eventId, "event_scans_cleared"); return n; },
    async audit(eventId) {
      await wait();
      const base = (scansByEvent[eventId] || []).slice(0, 60).map((s) => ({ id: s.id, action: "scan_saved", at: s.receivedAt }));
      return [...(auditByEvent[eventId] || []), ...base].sort((a, b) => new Date(b.at) - new Date(a.at));
    },
  },
  async globalMetrics() { await wait(); return { events: events.length, activeEvents: events.filter((e) => e.status === "active").length, scans: Object.values(scansByEvent).reduce((n, l) => n + l.length, 0) }; },

  users: {
    async list() { await wait(); return users.map((u) => ({ ...u })); },
    async operators() { await wait(); return users.filter((u) => u.role === "operator").map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, status: u.status })); },
    async invite({ email, fullName, role }) { await wait(400); users.unshift({ id: `u-${Date.now()}`, email, full_name: fullName, role, status: "active", created_at: iso(Date.now()) }); return { ok: true }; },
    async resend() { await wait(300); return { ok: true }; },
    async setStatus(id, status) { await wait(250); users.find((u) => u.id === id).status = status; return { ok: true }; },
    async remove(id) { await wait(250); users.splice(users.findIndex((u) => u.id === id), 1); return { ok: true }; },
    async createPin() { await wait(300); return { ok: true, role: "operator", pin: "703518", expires_in_minutes: 30 }; },
  },
  assignments: {
    async list() {
      await wait();
      return assignments.map((a) => { const e = events.find((x) => x.id === a.eventId); const u = opName(a.operatorId); return { ...a, eventName: e?.name || "", eventStatus: e?.status || "", eventStart: e?.starts_at || null, operatorName: u?.full_name || "", operatorEmail: u?.email || "" }; });
    },
    async assign(eventId, operatorId) { await wait(250); const f = assignments.find((a) => a.eventId === eventId && a.operatorId === operatorId); if (f) f.status = "active"; else assignments.push({ eventId, operatorId, status: "active", since: iso(Date.now()) }); },
    async setStatus(eventId, operatorId, status) { await wait(200); assignments.find((a) => a.eventId === eventId && a.operatorId === operatorId).status = status; },
  },
  operator: {
    async events(userId) { await wait(); return assignments.filter((a) => a.operatorId === userId && a.status === "active").map((a) => events.find((e) => e.id === a.eventId)).filter((e) => e && e.status === "active"); },
  },
};
