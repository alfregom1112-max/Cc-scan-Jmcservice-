// Capa de datos REAL. Cada función documenta el contrato que consume
// (tabla con RLS, Edge Function o ruta de la API de asistencia en Render).
import { getClient } from "./supabase.js";
import { config } from "./config.js";

export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

/* ───────── API de asistencia (Render → MongoDB Atlas) ───────── */
const API_TIMEOUT_MS = 45000; // Render puede tardar en "despertar"
async function api(path, { method = "GET", query, retry = method === "GET" } = {}) {
  const { data } = await getClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Tu sesión venció. Inicia sesión de nuevo.", 401);
  const url = new URL(config.apiBase + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (retry && attempt === 0) continue;
      throw new ApiError(e.name === "AbortError" ? "La API de asistencia tardó demasiado en responder. Inténtalo de nuevo." : "No se pudo contactar la API de asistencia. Revisa tu conexión.", 0);
    }
    clearTimeout(timer);
    let payload = null;
    try { payload = await res.json(); } catch { /* cuerpo vacío o no JSON */ }
    if (!res.ok) {
      const fallback = { 401: "Tu sesión venció. Inicia sesión de nuevo.", 402: "La membresía de la empresa está vencida o inactiva.", 403: "No tienes permiso para esta operación.", 404: "No se encontró el recurso.", 429: "Demasiadas solicitudes. Espera un momento." }[res.status] || `La API respondió con error ${res.status}.`;
      throw new ApiError(payload?.error || fallback, res.status);
    }
    return payload;
  }
}

/* ───────── Edge Functions ───────── */
async function invoke(name, body) {
  const { data, error } = await getClient().functions.invoke(name, { body });
  if (error) {
    let detail = "";
    try { detail = (await error.context?.json?.())?.error || ""; } catch { /* sin cuerpo */ }
    if (!detail && /Failed to send a request|fetch/i.test(error.message || "")) {
      detail = "No se pudo contactar la función. Si ocurre siempre en esta acción, el backend debe responder el preflight CORS (ver CAMBIOS_BACKEND.md).";
    }
    throw new Error(detail || error.message || "No se pudo completar la operación.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const must = ({ data, error }, msg) => { if (error) throw new Error(msg || error.message); return data; };
const safeTerm = (s) => String(s || "").replace(/[,()%*_\\"'`]/g, " ").trim().slice(0, 80);

const normScan = (s) => ({
  id: s.id, eventId: s.evento_id, document: s.cedula || "", name: s.nombre || "",
  capturedAt: Number.isFinite(s.timestamp) ? s.timestamp : null, receivedAt: s.created_at || null,
  deviceId: s.device_id || "", operatorId: s.operator_id || "", result: s.result || "",
});

export const realRepo = {
  mode: "real",
  trash: {
    async list() { return must(await getClient().from("recycle_bin").select("entity_type,entity_id,label,deleted_at").order("deleted_at", {ascending:false}).limit(1000)); },
    async move(type,id) { return must(await getClient().rpc("recycle_item",{p_type:type,p_id:id,p_restore:false})); },
    async restore(type,id) { return must(await getClient().rpc("recycle_item",{p_type:type,p_id:id,p_restore:true})); },
  },

  auth: {
    async init() { await getClient().auth.getSession(); }, // espera a que se procese el enlace de retorno
    async getSession() { const { data } = await getClient().auth.getSession(); return data.session ? { userId: data.session.user.id, email: data.session.user.email } : null; },
    onChange(cb) {
      // El callback de supabase-js corre dentro de un candado: no se debe esperar
      // ninguna otra llamada de supabase aquí. Solo se reenvía el evento de forma síncrona.
      const { data } = getClient().auth.onAuthStateChange((event, session) => cb(event, session ? { userId: session.user.id, email: session.user.email } : null));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) { const { error } = await getClient().auth.signInWithPassword({ email, password }); if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message); },
    async signOut() { await getClient().auth.signOut(); },
    async sendRecovery(email) {
      const redirectTo = `${location.origin}${location.pathname}`; // sin fragmento: Supabase agrega #access_token
      const { error } = await getClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
    },
    async updatePassword(password) { const { error } = await getClient().auth.updateUser({ password }); if (error) throw new Error(error.message); },
    // Edge Function pública activate-user-pin (body: pin, email, full_name, password)
    activatePin: ({ pin, email, fullName, password }) => invoke("activate-user-pin", { pin, email, full_name: fullName, password }),
  },

  /** profiles (propio) + tenants (propio; el superadmin lee todos). */
  async loadContext(userId) {
    const c = getClient();
    const { data: profile, error } = await c.from("profiles").select("id,email,full_name,role,status,tenant_id,is_platform_admin").is("deleted_at", null).eq("id", userId).maybeSingle();
    if (error || !profile) throw new Error("No se pudo cargar tu perfil.");
    if (profile.status !== "active") throw new Error("Tu cuenta está inactiva. Contacta al administrador de tu empresa.");
    const { data: tenant, error: tenantError } = await c.from("tenants").select("id,name,slug,billing_mode,subscription_status,current_period_ends_at,billing_period,subscription_plan_id,subscription_event_limit,subscription_operator_limit,subscription_events_used").is("deleted_at", null).eq("id", profile.tenant_id).maybeSingle();
    if (tenantError) throw new Error("No se pudo consultar la membresía de tu empresa. Actualiza e inténtalo de nuevo.");
    return { profile, tenant };
  },

  tenants: {
    async list() { return must(await getClient().from("tenants").select("id,name,slug,billing_mode,billing_period,subscription_status,price_cop,current_period_starts_at,current_period_ends_at,subscription_plan_id,subscription_event_limit,subscription_operator_limit,subscription_events_used,created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(1000), "No se pudieron cargar las empresas."); },
    async plans() { return must(await getClient().from("subscription_plan_catalog").select("id,billing_period,operators_limit,included_events,price_cop").eq("active", true).order("operators_limit"), "No se pudieron cargar los planes de membresía."); },
    create: ({ name, ownerEmail, billingMode, planId }) => invoke("platform-tenant-create", { name, owner_email: ownerEmail, billing_mode: billingMode, ...(planId ? { plan_id: planId } : {}) }),
    update: (tenantId, action, extra = {}) => invoke("platform-tenant-update", { tenant_id: tenantId, action, ...extra }),
  },

  events: {
    async list({ search = "", status = "", offset = 0, limit = 20 }) {
      let q = getClient().from("events").select("id,name,starts_at,place,description,status,created_at", { count: "exact" }).is("deleted_at", null).order("starts_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) q = q.eq("status", status);
      const term = safeTerm(search);
      if (term) q = q.or(`name.ilike.%${term}%,place.ilike.%${term}%`);
      const { data, error, count } = await q;
      if (error) throw new Error("No se pudieron cargar los eventos.");
      return { rows: data || [], total: count ?? (data || []).length };
    },
    async statusCounts() {
      const c = getClient();
      const res = await Promise.all(["active", "inactive", "closed"].map((s) => c.from("events").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", s)));
      if (res.some((r) => r.error)) throw new Error("No se pudieron contar los eventos.");
      return { active: res[0].count || 0, inactive: res[1].count || 0, closed: res[2].count || 0 };
    },
    async upcoming(limit = 5) {
      return must(await getClient().from("events").select("id,name,starts_at,place,status").is("deleted_at", null).eq("status", "active").gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(limit), "No se pudieron cargar los próximos eventos.");
    },
    async options() { return must(await getClient().from("events").select("id,name,status,starts_at").is("deleted_at", null).order("starts_at", { ascending: false }).limit(500), "No se pudieron cargar los eventos."); },
    async get(id) { const { data, error } = await getClient().from("events").select("id,name,starts_at,place,description,status,created_at,created_by").is("deleted_at", null).eq("id", id).maybeSingle(); if (error) throw new Error("No se pudo cargar el evento."); return data; },
    async create(values, userId) { return must(await getClient().from("events").insert({ ...values, created_by: userId, status: "active" }).select("id").single(), "No se pudo crear el evento."); },
    async update(id, patch) { return must(await getClient().from("events").update(patch).eq("id", id).select("id").single(), "No se pudo guardar el evento."); },
    /** DELETE /v1/events/:id → archiva (status=closed) y registra auditoría; conserva los registros. */
    close: (id) => api(`/v1/events/${id}`, { method: "DELETE" }),
    /** GET /v1/events/counts → { [eventId]: total } (admin: todos; operador: solo asignados). */
    async counts() { return (await api("/v1/events/counts")) || {}; },
    async operators(eventId) {
      const rows = must(await getClient().from("event_operators").select("operator_id,status,created_at,profiles:operator_id(full_name,email)").eq("event_id", eventId).limit(500), "No se pudieron cargar los operadores del evento.");
      return rows.map((r) => ({ operatorId: r.operator_id, status: r.status, since: r.created_at, name: r.profiles?.full_name || "", email: r.profiles?.email || "" }));
    },
    /** audit_log (Supabase, RLS admin del tenant): cambios de datos del evento con autor. */
    async changeLog(eventId) {
      const rows = must(await getClient().from("audit_log").select("id,action,created_at,actor:actor_id(full_name,email)").eq("entity_type", "events").eq("entity_id", eventId).order("created_at", { ascending: false }).limit(200), "No se pudo cargar el historial de cambios.");
      return rows.map((r) => ({ id: r.id, action: r.action, at: r.created_at, actor: r.actor?.full_name || r.actor?.email || "" }));
    },
  },

  scans: {
    /** GET /v1/events/:id/scans?limit&offset&operatorId → arreglo plano (sin total). Se pide limit+1 para saber si hay más. */
    async page(eventId, { limit = 25, offset = 0, operatorId } = {}) {
      const rows = await api(`/v1/events/${eventId}/scans`, { query: { limit: Math.min(500, limit + 1), offset, operatorId } });
      if (!Array.isArray(rows)) throw new Error("Respuesta inesperada de la API de asistencia.");
      return { rows: rows.slice(0, limit).map(normScan), hasMore: rows.length > limit };
    },
    /** Página de 500 (máximo del servidor) para exportaciones completas. */
    async chunk(eventId, { offset, operatorId }) {
      const rows = await api(`/v1/events/${eventId}/scans`, { query: { limit: 500, offset, operatorId } });
      if (!Array.isArray(rows)) throw new Error("Respuesta inesperada de la API de asistencia.");
      return rows.map(normScan);
    },
    /** GET /v1/events/:id/stats → cifras de TODO el evento (no del operador). */
    async stats(eventId) {
      const s = await api(`/v1/events/${eventId}/stats`);
      return { total: s.total ?? 0, today: s.hoy ?? 0, devicesRecent: s.dispositivos_usados ?? null, recent: (s.recientes || []).map((r) => ({ id: r.id, document: r.cedula || "", name: r.nombre || "", receivedAt: r.created_at })) };
    },
    /** GET /v1/events/:id/count → total de registros del USUARIO que consulta. */
    async myCount(eventId) { return (await api(`/v1/events/${eventId}/count`)).total ?? 0; },
    remove: (eventId, scanId) => api(`/v1/events/${eventId}/scans/${scanId}`, { method: "DELETE" }),
    async clear(eventId) { return (await api(`/v1/events/${eventId}/scans`, { method: "DELETE" })).registros_borrados ?? 0; },
    /** GET /v1/events/:id/audit → hasta 500 eventos { event_type, created_at } (sin autor ni detalle). */
    async audit(eventId) {
      const rows = await api(`/v1/events/${eventId}/audit`);
      return (rows || []).map((r) => ({ id: r.id, action: r.event_type, at: r.created_at }));
    },
  },

  /** GET /v1/admin/metrics → solo se usa `global` (conteos reales). El resto viene vacío o fijo. */
  async globalMetrics() { const m = await api("/v1/admin/metrics"); return { events: m.global?.eventos ?? 0, activeEvents: m.global?.eventos_activos ?? 0, scans: m.global?.registros ?? 0 }; },

  users: {
    async list() { return must(await getClient().from("profiles").select("id,email,full_name,role,status,created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(1000), "No se pudieron cargar los usuarios."); },
    async operators() { return must(await getClient().from("profiles").select("id,email,full_name,status").is("deleted_at", null).eq("role", "operator").order("full_name").limit(1000), "No se pudieron cargar los operadores."); },
    invite: ({ email, fullName, role }) => invoke("admin-user-invite", { email, full_name: fullName, role, redirect_to: `${location.origin}${location.pathname}` }),
    resend: (email) => invoke("admin-user-resend", { email }),
    setStatus: (userId, status) => invoke("admin-user-status", { user_id: userId, status, action: "status" }),
    remove: (userId) => invoke("admin-user-status", { user_id: userId, action: "delete" }),
    createPin: () => invoke("admin-user-pin-create", {}),
  },

  assignments: {
    async list() {
      const rows = must(await getClient().from("event_operators").select("event_id,operator_id,status,created_at,events:event_id(name,status,starts_at),profiles:operator_id(full_name,email)").order("created_at", { ascending: false }).limit(1000), "No se pudieron cargar las asignaciones.");
      return rows.map((r) => ({ eventId: r.event_id, operatorId: r.operator_id, status: r.status, since: r.created_at, eventName: r.events?.name || "", eventStatus: r.events?.status || "", eventStart: r.events?.starts_at || null, operatorName: r.profiles?.full_name || "", operatorEmail: r.profiles?.email || "" }));
    },
    async assign(eventId, operatorId, assignedBy) { must(await getClient().from("event_operators").upsert({ event_id: eventId, operator_id: operatorId, assigned_by: assignedBy, status: "active" }, { onConflict: "event_id,operator_id" }), "No se pudo asignar al operador."); },
    async setStatus(eventId, operatorId, status) { must(await getClient().from("event_operators").update({ status }).eq("event_id", eventId).eq("operator_id", operatorId), "No se pudo actualizar la asignación."); },
  },

  operator: {
    async events(userId) {
      const rows = must(await getClient().from("event_operators").select("event_id,status,events:event_id(id,name,starts_at,place,description,status)").eq("operator_id", userId).limit(500), "No se pudieron cargar tus eventos.");
      return rows.filter((r) => r.status === "active" && r.events).map((r) => r.events);
    },
  },
};
