const TZ = "America/Bogota";
const dateFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const longFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const numFmt = new Intl.NumberFormat("es-CO");
const moneyFmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const valid = (v) => { if (v === null || v === undefined || v === "") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

export const fmtDate = (v) => { const d = valid(v); return d ? dateFmt.format(d) : "—"; };
export const fmtDateTime = (v) => { const d = valid(v); return d ? dateTimeFmt.format(d) : "—"; };
export const fmtTime = (v) => { const d = valid(v); return d ? timeFmt.format(d) : "—"; };
export const fmtLongDate = (v) => { const d = valid(v); return d ? longFmt.format(d) : "—"; };
export const fmtNumber = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : numFmt.format(Number(n)));
export const fmtMoney = (n) => (n === null || n === undefined ? "Sin precio definido" : moneyFmt.format(n));

/** Fecha/hora estable para CSV (hora de Colombia, sin caracteres que Excel interprete). */
export function fmtIso(v) {
  const d = valid(v);
  if (!d) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Hora (0-23) y día (YYYY-MM-DD) en hora de Colombia. */
export function bogotaHour(v) { const d = valid(v); return d ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d)) : null; }
export function bogotaDay(v) { const d = valid(v); return d ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d) : null; }

export function daysUntil(v) {
  const d = valid(v);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
export function relativeDays(v) {
  const n = daysUntil(v);
  if (n === null) return "";
  if (n === 0) return "vence hoy";
  if (n > 0) return n === 1 ? "en 1 día" : `en ${n} días`;
  return n === -1 ? "hace 1 día" : `hace ${Math.abs(n)} días`;
}

export function toLocalInput(v) {
  const d = valid(v) || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function maskDoc(doc) {
  const s = String(doc || "");
  return s.length <= 4 ? s : `${"•".repeat(Math.min(6, s.length - 4))}${s.slice(-4)}`;
}
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
export function slugify(v) {
  return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "reporte";
}

export const TENANT_STATUS = {
  internal: { label: "Interna", tone: "brand" },
  trial: { label: "Prueba", tone: "info" },
  pending_payment: { label: "Pendiente de activación", tone: "warn" },
  active: { label: "Activa", tone: "ok" },
  past_due: { label: "Pago vencido", tone: "warn" },
  suspended: { label: "Suspendida", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};
export const EVENT_STATUS = {
  active: { label: "Activo", tone: "ok" },
  inactive: { label: "Pausado", tone: "warn" },
  closed: { label: "Cerrado", tone: "neutral" },
};
export const ROLE_LABEL = { superadmin: "Superadministrador", admin: "Administrador", operator: "Operador" };

/** Misma regla que el backend (authenticate) y la RLS (tenant_subscription_active). */
export function membershipActive(tenant) {
  if (!tenant) return false;
  if (tenant.billing_mode === "internal" || tenant.subscription_status === "internal") return true;
  if (["per_event", "lifetime"].includes(tenant.billing_mode)) return !["suspended", "cancelled"].includes(tenant.subscription_status);
  return ["active", "trial"].includes(tenant.subscription_status) && Boolean(tenant.current_period_ends_at) && new Date(tenant.current_period_ends_at) > new Date();
}

export const SCAN_ACTIONS = {
  scan_saved: "Registro de asistencia guardado",
  scan_deleted: "Registro eliminado",
  event_scans_cleared: "Asistencia vaciada",
  event_archived: "Evento cerrado",
};
