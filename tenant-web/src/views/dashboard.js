import { el, btn, kpi, kpiSkeleton, card, pageHeader, barList, dataTable, emptyState, errorState, banner, select, field, skeletonBlock } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, fmtDateTime, fmtNumber, maskDoc, relativeDays } from "../lib/format.js";

/** El backend calcula el inicio de día usando la fecha local de Colombia (UTC-5). */
export function todayIsReliable() { return true; }
export const TODAY_NOTE = "Desde las 00:00 de Colombia, según la hora de captura del dispositivo.";
export const TODAY_UNRELIABLE = "El conteo de hoy no está disponible.";

export function renderDashboard(container, { ctx, role }) {
  const body = el("div", { class: "stack-lg" });
  container.replaceChildren(pageHeader({ title: role === "superadmin" ? "Panel de la empresa interna" : "Panel de la empresa", subtitle: `${ctx.tenant?.name || ""}. Cifras tomadas de los datos reales; las que el sistema no calcula se marcan como no disponibles.`, actions: [btn({ label: "Actualizar", icon: "refresh", onClick: () => load() }), btn({ label: "Nuevo evento", icon: "plus", variant: "primary", href: "#/events?new=1" })] }), body);

  async function load() {
    body.replaceChildren(kpiSkeleton(3), skeletonBlock(5));
    const [metrics, counts, upcoming, options] = await Promise.allSettled([repo.globalMetrics(), repo.events.statusCounts(), repo.events.upcoming(5), repo.events.options()]);
    const parts = [];
    let first = null;
    const failed = [metrics, counts, upcoming, options].filter((r) => r.status === "rejected");
    if (failed.length) parts.push(banner({ tone: "warn", title: "Algunos datos no se pudieron cargar", text: [...new Set(failed.map((f) => f.reason.message))].join(" "), action: btn({ label: "Reintentar", small: true, onClick: () => load() }) }));

    const m = metrics.status === "fulfilled" ? metrics.value : null;
    parts.push(el("div", { class: "kpi-grid" }, [
      kpi({ label: "Eventos creados", value: m ? fmtNumber(m.events) : "", unavailable: !m, note: "Histórico de la empresa, todos los estados." }),
      kpi({ label: "Eventos activos", value: m ? fmtNumber(m.activeEvents) : "", unavailable: !m, note: "Reciben registros ahora." }),
      kpi({ label: "Registros de asistencia", value: m ? fmtNumber(m.scans) : "", unavailable: !m, note: "Histórico de todos los eventos, desde la API de asistencia." }),
    ]));

    const c = counts.status === "fulfilled" ? counts.value : null;
    const chart = card(c ? barList([{ label: "Activos", value: c.active, tone: "ok" }, { label: "Pausados", value: c.inactive, tone: "warn" }, { label: "Cerrados", value: c.closed, tone: "neutral" }], { emptyText: "Todavía no hay eventos." }) : el("p", { class: "muted" }, "No disponible."), { title: "Eventos por estado", subtitle: "Conteo actual." });
    const up = upcoming.status === "fulfilled" ? upcoming.value : [];
    const upCard = card(up.length ? el("ul", { class: "event-list" }, up.map((e) => el("li", {}, el("a", { class: "event-list-item", href: `#/events/${e.id}` }, [el("div", {}, [el("strong", {}, e.name), el("span", { class: "muted small" }, e.place || "Sin lugar")]), el("div", { class: "event-list-when" }, [fmtDateTime(e.starts_at), el("span", { class: "muted small" }, relativeDays(e.starts_at))])])))) : emptyState({ icon: "calendar", title: "Sin eventos próximos", text: "Los eventos activos con fecha futura aparecen aquí.", action: btn({ label: "Crear evento", href: "#/events?new=1" }) }), { title: "Próximos eventos activos" });
    parts.push(el("div", { class: "grid-2" }, [chart, upCard]));

    // Detalle de un evento (KPIs reales de /stats)
    const evs = options.status === "fulfilled" ? options.value : [];
    const detailHost = el("div", { class: "stack" });
    if (evs.length) {
      const pickable = [...evs].sort((a, b) => (a.status === "active" ? -1 : 0) - (b.status === "active" ? -1 : 0));
      const sel = select(pickable.map((e) => ({ value: e.id, label: `${e.name}${e.status !== "active" ? ` (${EVENT_STATUS[e.status]?.label.toLowerCase()})` : ""}` })));
      const f = field({ label: "Evento", control: sel });
      sel.addEventListener("change", () => showEvent(sel.value));
      parts.push(card([el("div", { class: "toolbar" }, [f.root]), detailHost], { title: "Actividad de un evento", subtitle: "Las cifras corresponden a todo el evento, sin importar qué operador registró." }));
      first = pickable[0].id;
    } else parts.push(card(emptyState({ icon: "calendar", title: "Aún no hay eventos", text: "Cuando crees un evento verás aquí su actividad.", action: btn({ label: "Crear evento", variant: "primary", href: "#/events?new=1" }) }), { title: "Actividad de un evento" }));

    parts.push(card(el("ul", { class: "plain-list" }, [
      el("li", {}, [el("strong", {}, "Tendencia por hora y operadores destacados: "), "la API los devuelve vacíos. Puedes calcularlos sobre los registros de un evento en Reportes."]),
      el("li", {}, [el("strong", {}, "Duplicados detectados y dispositivos activos: "), "la API todavía no mide estos valores." ]),
      el("li", {}, [el("strong", {}, "Dispositivos usados: "), "se calcula solo con los últimos 8 registros, es un mínimo aproximado."]),
    ]), { title: "Métricas no disponibles", subtitle: "No se muestran valores inventados." }));
    body.replaceChildren(...parts);
    if (first) void showEvent(first);

    async function showEvent(id) {
      detailHost.replaceChildren(kpiSkeleton(3));
      try {
        const s = await repo.scans.stats(id);
        const ok = todayIsReliable();
        detailHost.replaceChildren(
          el("div", { class: "kpi-grid" }, [
            kpi({ label: "Registros del evento", value: fmtNumber(s.total), note: "Total histórico, todos los operadores." }),
            kpi({ label: "Registros de hoy", value: fmtNumber(s.today), unavailable: !ok, note: ok ? TODAY_NOTE : TODAY_UNRELIABLE }),
            kpi({ label: "Dispositivos usados (aprox.)", value: s.devicesRecent == null ? "—" : fmtNumber(s.devicesRecent), unavailable: s.devicesRecent == null, note: s.devicesRecent == null ? "No disponible para este rol." : "Distintos en los últimos 8 registros." }),
          ]),
          el("h3", { class: "subhead" }, "Últimos registros"),
          dataTable({ caption: "Últimos registros", columns: [{ label: "Documento", render: (r) => el("span", { class: "num" }, maskDoc(r.document)) }, { label: "Nombre", key: "name" }, { label: "Recibido", render: (r) => fmtDateTime(r.receivedAt) }], rows: s.recent, empty: emptyState({ title: "Sin registros todavía", text: "Aparecerán cuando los operadores empiecen a registrar asistencia." }) }),
          el("a", { class: "link", href: `#/events/${id}/attendance` }, "Ver asistencia completa"),
        );
      } catch (e) { detailHost.replaceChildren(errorState({ message: e.message, retry: () => showEvent(id) })); }
    }
  }
  void load();
}
