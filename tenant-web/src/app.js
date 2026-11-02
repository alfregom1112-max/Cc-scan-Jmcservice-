import { authCallback, needsPasswordFromCallback, callbackErrorMessage } from "./lib/callback.js"; // primero: captura la URL
import { isDemo, configError } from "./lib/config.js";
import { icon } from "./lib/icons.js";
import { el, btn, errorState, skeletonBlock } from "./lib/ui.js";
import { membershipActive, ROLE_LABEL, initials, fmtDate, TENANT_STATUS } from "./lib/format.js";
import { pill } from "./lib/ui.js";
import { repo } from "./lib/repo.js";
import { renderLogin } from "./views/login.js";
import { renderActivate } from "./views/activate.js";
import { renderSetPassword } from "./views/set-password.js";
import { renderBlocked } from "./views/blocked.js";
import { renderPlatformDashboard } from "./views/platform-dashboard.js";
import { renderCompanies } from "./views/companies.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderEvents } from "./views/events.js";
import { renderEventDetail } from "./views/event-detail.js";
import { renderUsers } from "./views/users.js";
import { renderAssignments } from "./views/assignments.js";
import { renderReports } from "./views/reports.js";
import { renderOperatorHome, renderOperatorEvent } from "./views/operator.js";
import { renderProfile } from "./views/profile.js";

const root = document.getElementById("app-root");

/* ───────── Estado ───────── */
const state = { ctx: null, mustSetPassword: needsPasswordFromCallback, starting: null, shell: null };
const roleOf = (ctx) => (ctx.profile.role === "admin" ? (ctx.profile.is_platform_admin ? "superadmin" : "admin") : "operator");
const HOME = { superadmin: "#/platform", admin: "#/dashboard", operator: "#/my-events" };

/* ───────── Rutas y navegación por rol ───────── */
const ALL = ["superadmin", "admin", "operator"];
const OPS = ["superadmin", "admin"];
const ROUTES = {
  platform: { roles: ["superadmin"], view: renderPlatformDashboard },
  companies: { roles: ["superadmin"], view: renderCompanies },
  dashboard: { roles: OPS, view: renderDashboard },
  events: { roles: OPS, view: (c, env) => (env.params[0] ? renderEventDetail(c, env) : renderEvents(c, env)) },
  users: { roles: OPS, view: renderUsers },
  assignments: { roles: OPS, view: renderAssignments },
  reports: { roles: OPS, view: renderReports },
  "my-events": { roles: ["operator"], view: (c, env) => (env.params[0] ? renderOperatorEvent(c, env) : renderOperatorHome(c, env)) },
  profile: { roles: ALL, view: renderProfile },
};
const NAV = {
  superadmin: [
    { group: "Plataforma", items: [{ to: "platform", label: "Resumen", icon: "chart" }, { to: "companies", label: "Empresas", icon: "building" }] },
    { group: "Operación interna", items: [{ to: "dashboard", label: "Panel", icon: "dashboard" }, { to: "events", label: "Eventos", icon: "calendar" }, { to: "users", label: "Usuarios", icon: "users" }, { to: "assignments", label: "Asignaciones", icon: "link" }, { to: "reports", label: "Reportes", icon: "report" }] },
    { group: "Cuenta", items: [{ to: "profile", label: "Mi perfil", icon: "user" }] },
  ],
  admin: [
    { group: "Empresa", items: [{ to: "dashboard", label: "Panel", icon: "dashboard" }, { to: "events", label: "Eventos", icon: "calendar" }, { to: "users", label: "Usuarios", icon: "users" }, { to: "assignments", label: "Asignaciones", icon: "link" }, { to: "reports", label: "Reportes", icon: "report" }] },
    { group: "Cuenta", items: [{ to: "profile", label: "Mi perfil", icon: "user" }] },
  ],
  operator: [{ group: "Trabajo", items: [{ to: "my-events", label: "Mis eventos", icon: "calendar" }, { to: "profile", label: "Mi perfil", icon: "user" }] }],
};

function parseHash() {
  const full = location.hash.startsWith("#/") ? location.hash.slice(2) : "";
  const [path, qs = ""] = full.split("?");
  const [section = "", ...params] = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
  return { section, params, query: new URLSearchParams(qs) };
}
const go = (hash) => { if (location.hash === hash) void route(); else location.hash = hash; };

/* ───────── Pantallas sin sesión ───────── */
function showPublic() {
  state.ctx = null; state.shell = null;
  document.title = "Acceso · JM ServiceTec Eventos";
  const { section } = parseHash();
  if (section === "activar") renderActivate(root, { onBack: () => go("#/") });
  else renderLogin(root, { callbackError: callbackErrorMessage(), onActivate: () => go("#/activar") });
}
function showFatal(message) {
  root.replaceChildren(el("main", { class: "center-screen" }, [errorState({ title: "No se pudo abrir el portal", message })]));
}
function showBoot() { root.replaceChildren(el("div", { class: "boot", role: "status", "aria-label": "Cargando el portal" }, [el("span", { class: "boot-mark" }, icon("scan", 26)), el("span", { class: "boot-text" }, "Abriendo el portal")])); }

/* ───────── Sesión (sin esperar llamadas de supabase dentro del callback) ───────── */
async function start(session) {
  if (state.ctx?.profile.id === session.userId) return;
  if (state.starting === session.userId) return;
  state.starting = session.userId;
  showBoot();
  try {
    state.ctx = await repo.loadContext(session.userId);
    if (state.mustSetPassword) {
      renderSetPassword(root, { title: needsPasswordFromCallback && authCallback.type === "invite" ? "Crea tu contraseña" : "Define tu nueva contraseña", description: "Después de guardarla entrarás al portal con tu cuenta.", onDone: () => { state.mustSetPassword = false; renderShell(); go(HOME[roleOf(state.ctx)]); } });
    } else {
      renderShell();
      if (!location.hash.startsWith("#/")) location.hash = HOME[roleOf(state.ctx)]; else void route();
    }
  } catch (error) {
    state.ctx = null;
    root.replaceChildren(el("main", { class: "center-screen" }, [errorState({ title: "No se pudo abrir tu cuenta", message: error.message }), btn({ label: "Cerrar sesión", icon: "logout", onClick: () => repo.auth.signOut() })]));
  } finally { state.starting = null; }
}

function handleAuthEvent(event, session) {
  if (event === "SIGNED_OUT") { state.ctx = null; state.mustSetPassword = false; showPublic(); return; }
  if (event === "PASSWORD_RECOVERY") { state.mustSetPassword = true; if (session) { state.ctx = null; void start(session); } return; }
  if (event === "SIGNED_IN" && session) { void start(session); return; }
  // INITIAL_SESSION, TOKEN_REFRESHED, USER_UPDATED: no requieren redibujar nada.
}

/* ───────── Shell ───────── */
function renderShell() {
  const ctx = state.ctx; const role = roleOf(ctx);
  const active = membershipActive(ctx.tenant);
  const navGroups = NAV[role].map((g) => el("div", { class: "nav-group" }, [
    el("p", { class: "nav-group-label" }, g.group),
    ...g.items.map((it) => el("a", { class: "nav-link", href: `#/${it.to}`, "data-to": it.to }, [icon(it.icon, 20), el("span", {}, it.label)])),
  ]));
  const scrim = el("div", { class: "scrim", hidden: true });
  const sidebar = el("aside", { class: "sidebar", id: "sidebar", "aria-label": "Navegación principal" }, [
    el("div", { class: "sidebar-brand" }, [el("span", { class: "brand-mark" }, icon("scan", 22)), el("div", {}, [el("strong", {}, "JM ServiceTec"), el("span", {}, "Eventos")])]),
    el("nav", { class: "nav", "aria-label": "Secciones" }, navGroups),
    el("div", { class: "sidebar-user" }, [
      el("span", { class: "avatar", "aria-hidden": "true" }, initials(ctx.profile.full_name || ctx.profile.email)),
      el("div", { class: "sidebar-user-text" }, [el("strong", {}, ctx.profile.full_name || ctx.profile.email), el("span", {}, ROLE_LABEL[role])]),
      btn({ icon: "logout", variant: "ghost", title: "Cerrar sesión", onClick: () => repo.auth.signOut(), cls: "sidebar-signout" }),
    ]),
  ]);
  const toggle = btn({ icon: "menu", variant: "ghost", title: "Abrir menú", cls: "menu-toggle" });
  toggle.setAttribute("aria-controls", "sidebar"); toggle.setAttribute("aria-expanded", "false");
  const setOpen = (open) => { sidebar.classList.toggle("is-open", open); scrim.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) sidebar.querySelector(".nav-link")?.focus(); };
  toggle.addEventListener("click", () => setOpen(!sidebar.classList.contains("is-open")));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidebar.classList.contains("is-open")) { setOpen(false); toggle.focus(); } });

  const st = TENANT_STATUS[ctx.tenant?.subscription_status] || { label: "Sin estado", tone: "neutral" };
  const topbar = el("header", { class: "topbar" }, [
    toggle,
    el("div", { class: "topbar-context" }, [
      icon("building", 16), el("strong", {}, ctx.tenant?.name || "Sin empresa"),
      role === "superadmin" ? el("span", { class: "topbar-note" }, "empresa interna") : null,
      pill(active ? st.label : `Membresía ${st.label.toLowerCase()}`, active ? st.tone : "danger"),
      ctx.tenant?.subscription_status !== "internal" && ctx.tenant?.current_period_ends_at ? el("span", { class: "topbar-note" }, `vence ${fmtDate(ctx.tenant.current_period_ends_at)}`) : null,
    ]),
  ]);
  const main = el("main", { class: "content", id: "main", tabindex: "-1" });
  root.replaceChildren(
    el("a", { class: "skip-link", href: "#main", onClick: (e) => { e.preventDefault(); main.focus(); } }, "Saltar al contenido"),
    isDemo ? el("div", { class: "demo-strip", role: "note" }, [icon("info", 16), el("span", {}, "Modo demostración: todos los datos son ficticios y no hay conexión con Supabase ni con la API.")]) : null,
    el("div", { class: "shell" }, [sidebar, scrim, el("div", { class: "shell-main" }, [topbar, main])]),
  );
  state.shell = { main, sidebar, setOpen, cleanup: null };
}

/* ───────── Router ───────── */
async function route() {
  if (!state.ctx || state.mustSetPassword) return;
  if (!state.shell || !document.body.contains(state.shell.main)) renderShell();
  const { main, setOpen } = state.shell;
  const ctx = state.ctx; const role = roleOf(ctx);
  const { section, params, query } = parseHash();
  if (!section) { go(HOME[role]); return; }
  setOpen(false);
  state.shell.cleanup?.(); state.shell.cleanup = null;
  for (const a of state.shell.sidebar.querySelectorAll(".nav-link")) { const on = a.dataset.to === section; a.classList.toggle("is-active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }

  const container = el("div", { class: "view" });
  main.replaceChildren(container);
  const def = ROUTES[section];
  if (!def) { container.append(errorState({ title: "Página no encontrada", message: "La dirección no existe en el portal.", retry: null }), btn({ label: "Ir al inicio", variant: "primary", href: HOME[role] })); document.title = "No encontrada · JM ServiceTec"; return; }
  if (!def.roles.includes(role)) { container.append(errorState({ title: "Sin acceso", message: "Tu rol no tiene permiso para esta sección." }), btn({ label: "Ir al inicio", variant: "primary", href: HOME[role] })); return; }
  // Membresía vencida: la RLS y la API ya niegan los datos; aquí se explica el motivo.
  if (role !== "superadmin" && !membershipActive(ctx.tenant) && section !== "profile") { renderBlocked(container, { role, tenant: ctx.tenant }); document.title = "Membresía inactiva · JM ServiceTec"; return; }

  const env = { ctx, role, params, query, go, tenantActive: membershipActive(ctx.tenant) };
  container.append(skeletonBlock(4));
  try {
    const result = def.view(container, env);
    if (result && typeof result.then === "function") {
      const out = await result; if (typeof out === "function") state.shell.cleanup = out;
    } else if (typeof result === "function") state.shell.cleanup = result;
  } catch (error) {
    container.replaceChildren(errorState({ message: error.message, retry: () => route() }));
  }
  const h1 = container.querySelector("h1");
  document.title = `${h1?.textContent || "Portal"} · JM ServiceTec`;
  if (!route.first) route.first = true; else main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", () => { if (state.ctx) void route(); else if (!state.starting) showPublic(); });

/* ───────── Arranque ───────── */
async function boot() {
  if (configError) { showFatal(configError); return; }
  showBoot();
  repo.auth.onChange(handleAuthEvent);
  try {
    await repo.auth.init();
    const session = await repo.auth.getSession();
    if (session) await start(session);
    else { state.mustSetPassword = false; showPublic(); }
  } catch (error) { showFatal(error.message || "Error inesperado al iniciar."); }
}
void boot();
