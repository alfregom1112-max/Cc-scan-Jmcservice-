import { el, btn, card, kpi, kpiSkeleton, pageHeader, dataTable, pager, emptyState, errorState, banner, pill, skeletonBlock } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, fmtDateTime, fmtLongDate, fmtNumber, relativeDays } from "../lib/format.js";
import { todayIsReliable, TODAY_UNRELIABLE } from "./dashboard.js";

export function renderOperatorHome(container, { ctx }) {
  const host = el("div", {});
  container.replaceChildren(pageHeader({ title: "Mis eventos", subtitle: "Eventos activos en los que estás asignado.", actions: [btn({ label: "Actualizar", icon: "refresh", onClick: () => load() })] }), host);
  async function load() {
    host.replaceChildren(skeletonBlock(4));
    try {
      const events = await repo.operator.events(ctx.profile.id);
      host.replaceChildren(events.length
        ? el("div", { class: "card-grid" }, events.map((e) => el("a", { class: "event-card", href: `#/my-events/${e.id}` }, [el("div", { class: "event-card-top" }, [pill(EVENT_STATUS[e.status]?.label || e.status, EVENT_STATUS[e.status]?.tone || "neutral"), el("span", { class: "muted small" }, relativeDays(e.starts_at))]), el("h2", { class: "event-card-title" }, e.name), el("p", { class: "event-card-meta" }, fmtLongDate(e.starts_at)), el("p", { class: "event-card-meta" }, e.place || "Sin lugar definido"), el("span", { class: "event-card-cta" }, "Ver mi actividad")])))
        : card(emptyState({ icon: "calendar", title: "No tienes eventos asignados", text: "Cuando tu administrador te asigne a un evento activo, aparecerá aquí. Si esperabas uno, confirma con él que el evento esté activo." })));
    } catch (e) { host.replaceChildren(errorState({ message: e.message, retry: load })); }
  }
  void load();
}

const PAGE = 20;
export async function renderOperatorEvent(container, { ctx, params }) {
  const id = params[0];
  let events;
  try { events = await repo.operator.events(ctx.profile.id); } catch (e) { container.replaceChildren(errorState({ message: e.message })); return; }
  const event = events.find((e) => e.id === id);
  if (!event) { container.replaceChildren(errorState({ title: "Evento no disponible", message: "No estás asignado a este evento, o ya no está activo." }), btn({ label: "Volver a mis eventos", href: "#/my-events" })); return; }
  const kpis = el("div", {}, kpiSkeleton(3)); const host = el("div", {}); let page = 0;
  container.replaceChildren(
    pageHeader({ title: event.name, back: { href: "#/my-events", label: "Mis eventos" }, status: pill(EVENT_STATUS[event.status]?.label || event.status, EVENT_STATUS[event.status]?.tone || "neutral"), subtitle: `${fmtLongDate(event.starts_at)} · ${event.place || "Sin lugar definido"}`, actions: [btn({ label: "Actualizar", icon: "refresh", onClick: () => { loadKpis(); loadScans(); } })] }),
    banner({ tone: "info", text: "El escaneo de documentos se hace desde la app móvil de JM ServiceTec. Aquí ves tu propia actividad." }),
    event.description ? el("p", { class: "lead-text" }, event.description) : null, kpis,
    el("h2", { class: "section-title" }, "Mi actividad"), host,
  );
  async function loadKpis() {
    kpis.replaceChildren(kpiSkeleton(3));
    const [mine, stats] = await Promise.allSettled([repo.scans.myCount(id), repo.scans.stats(id)]);
    const ok = todayIsReliable();
    kpis.replaceChildren(el("div", { class: "kpi-grid" }, [
      kpi({ label: "Mis registros en este evento", value: mine.status === "fulfilled" ? fmtNumber(mine.value) : "", unavailable: mine.status !== "fulfilled", note: "Solo los que tú registraste." , tone: "brand" }),
      kpi({ label: "Total del evento (todos los operadores)", value: stats.status === "fulfilled" ? fmtNumber(stats.value.total) : "", unavailable: stats.status !== "fulfilled", note: "Incluye a todo el equipo, no solo a ti." }),
      kpi({ label: "Hoy en el evento (todos los operadores)", value: stats.status === "fulfilled" ? fmtNumber(stats.value.today) : "", unavailable: stats.status !== "fulfilled" || !ok, note: ok ? "Del equipo completo, desde las 00:00 de Colombia." : TODAY_UNRELIABLE }),
    ]));
  }
  async function loadScans() {
    host.replaceChildren(card(dataTable({ columns: [{ label: "Documento" }, { label: "Nombre" }, { label: "Registrado" }], rows: [], loading: true }), { cls: "card-flush" }));
    try {
      const res = await repo.scans.page(id, { limit: PAGE, offset: page * PAGE }); // el servidor limita a tus registros
      host.replaceChildren(card([dataTable({ caption: "Mis registros", columns: [{ label: "Documento", class: "num", render: (r) => r.document }, { label: "Nombre", render: (r) => r.name || el("span", { class: "muted" }, "Sin nombre") }, { label: "Registrado", render: (r) => fmtDateTime(r.receivedAt) }], rows: res.rows, empty: emptyState({ icon: "users", title: "Aún no has registrado asistencia", text: "Tus lecturas desde la app aparecerán aquí." }) }), res.rows.length ? pager({ page, pageSize: PAGE, hasMore: res.hasMore, shown: res.rows.length, onChange: (p) => { page = p; loadScans(); } }) : null], { cls: "card-flush" }));
    } catch (e) { host.replaceChildren(errorState({ message: e.message, retry: loadScans })); }
  }
  loadKpis(); loadScans();
}
