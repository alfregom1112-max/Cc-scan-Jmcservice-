import { el, btn, card, kpi, kpiSkeleton, pageHeader, subnav, dataTable, pager, emptyState, errorState, banner, pill, field, select, input, confirmDialog, toast, withBusy, menuButton, skeletonBlock } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, SCAN_ACTIONS, fmtDateTime, fmtLongDate, fmtNumber, relativeDays, slugify } from "../lib/format.js";
import { loadAllScans, exportScans } from "../lib/export.js";
import { openEventForm } from "./events.js";
import { todayIsReliable, TODAY_NOTE, TODAY_UNRELIABLE } from "./dashboard.js";

const PAGE = 25;
const CHANGE_LABEL = { INSERT: "Evento creado", UPDATE: "Datos del evento modificados", DELETE: "Evento eliminado" };

export async function renderEventDetail(container, env) {
  const { ctx, params, go } = env;
  const id = params[0];
  const tab = ["attendance", "operators", "audit"].includes(params[1]) ? params[1] : "summary";
  let event;
  try { event = await repo.events.get(id); } catch (e) { container.replaceChildren(errorState({ message: e.message, retry: () => go(location.hash) })); return; }
  if (!event) { container.replaceChildren(errorState({ title: "Evento no encontrado", message: "No existe o no pertenece a tu empresa." }), btn({ label: "Volver a eventos", href: "#/events" })); return; }

  const st = EVENT_STATUS[event.status] || { label: event.status, tone: "neutral" };
  const statsPromise = repo.scans.stats(id).then((s) => ({ ok: true, s }), (e) => ({ ok: false, error: e.message }));
  const operatorsPromise = repo.events.operators(id).then((o) => ({ ok: true, o }), (e) => ({ ok: false, error: e.message }));
  const reload = () => go(location.hash);

  async function setStatus(status, title, message, danger) {
    if (!(await confirmDialog({ title, message, confirmLabel: title, danger }))) return;
    try { await repo.events.update(id, { status }); toast("Estado actualizado", "ok"); reload(); } catch (e) { toast(e.message, "danger"); }
  }
  async function closeEvent() {
    if (!(await confirmDialog({ title: "Cerrar evento", message: "El evento deja de aceptar registros y los operadores dejan de verlo. El historial se conserva y puedes reabrirlo después.", confirmLabel: "Cerrar evento", danger: true }))) return;
    try { await repo.events.close(id); toast("Evento cerrado", "ok"); reload(); } catch (e) { toast(e.message, "danger"); }
  }
  const actions = [btn({ label: "Editar", icon: "edit", onClick: () => openEventForm({ event, ctx, onSaved: reload }) })];
  if (event.status === "active") actions.push(btn({ label: "Pausar", icon: "ban", onClick: () => setStatus("inactive", "Pausar evento", "Los operadores dejan de verlo y no pueden registrar hasta que lo actives de nuevo.", false) }));
  if (event.status === "inactive") actions.push(btn({ label: "Activar", icon: "play", variant: "primary", onClick: () => setStatus("active", "Activar evento", "Los operadores asignados podrán verlo y registrar asistencia.", false) }));
  if (event.status === "closed") actions.push(btn({ label: "Reabrir", icon: "refresh", variant: "primary", onClick: () => setStatus("active", "Reabrir evento", "El evento volverá a estar activo y aceptará registros de nuevo.", false) }));
  if (event.status !== "closed") actions.push(menuButton({ label: "Más acciones del evento", items: [{ label: "Cerrar evento", icon: "archive", danger: true, onClick: closeEvent }] }));

  const content = el("div", { class: "stack-lg" });
  container.replaceChildren(
    pageHeader({ title: event.name, back: { href: "#/events", label: "Eventos" }, status: pill(st.label, st.tone), subtitle: `${fmtLongDate(event.starts_at)} · ${event.place || "Sin lugar definido"}`, actions }),
    subnav([{ id: "summary", label: "Resumen", href: `#/events/${id}`, icon: "chart" }, { id: "attendance", label: "Asistencia", href: `#/events/${id}/attendance`, icon: "users" }, { id: "operators", label: "Operadores", href: `#/events/${id}/operators`, icon: "link" }, { id: "audit", label: "Auditoría", href: `#/events/${id}/audit`, icon: "history" }], tab),
    content,
  );
  const helpers = { id, event, content, ctx, statsPromise, operatorsPromise, reload };
  ({ summary: tabSummary, attendance: tabAttendance, operators: tabOperators, audit: tabAudit })[tab](helpers);
}

/* ───────── Resumen ───────── */
async function tabSummary({ id, event, content, statsPromise, operatorsPromise }) {
  content.replaceChildren(kpiSkeleton(4));
  const [st, ops] = await Promise.all([statsPromise, operatorsPromise]);
  const parts = [];
  if (!st.ok) parts.push(banner({ tone: "warn", title: "No se pudieron cargar las cifras de asistencia", text: st.error }));
  const s = st.s; const reliable = todayIsReliable();
  const active = ops.ok ? ops.o.filter((o) => o.status === "active").length : null;
  parts.push(el("div", { class: "kpi-grid kpi-grid-4" }, [
    kpi({ label: "Registros del evento", value: s ? fmtNumber(s.total) : "", unavailable: !s, note: "Total histórico de todos los operadores." }),
    kpi({ label: "Registros de hoy", value: s ? fmtNumber(s.today) : "", unavailable: !s || !reliable, note: reliable ? TODAY_NOTE : TODAY_UNRELIABLE }),
    kpi({ label: "Dispositivos usados (aprox.)", value: s?.devicesRecent == null ? "—" : fmtNumber(s.devicesRecent), unavailable: !s || s.devicesRecent == null, note: s?.devicesRecent == null ? "No disponible." : "Distintos en los últimos 8 registros; es un mínimo." }),
    kpi({ label: "Operadores asignados", value: active === null ? "" : fmtNumber(active), unavailable: active === null, note: "Asignaciones activas." }),
  ]));
  parts.push(el("div", { class: "grid-2" }, [
    card(el("dl", { class: "defs" }, [
      el("dt", {}, "Inicio"), el("dd", {}, [fmtDateTime(event.starts_at), el("span", { class: "muted" }, ` · ${relativeDays(event.starts_at)}`)]),
      el("dt", {}, "Lugar"), el("dd", {}, event.place || "Sin lugar definido"),
      el("dt", {}, "Descripción"), el("dd", {}, event.description || "Sin descripción"),
      el("dt", {}, "Creado"), el("dd", {}, fmtDateTime(event.created_at)),
    ]), { title: "Datos del evento" }),
    card(el("ul", { class: "plain-list" }, [
      el("li", {}, "Duplicados detectados y dispositivos activos: la API todavía no mide estos valores."),
      el("li", {}, "Registros por hora y por operador: disponibles en Reportes, calculados sobre los registros cargados."),
    ]), { title: "No disponible en esta pantalla" }),
  ]));
  if (s?.recent?.length) parts.push(card(el("p", { class: "muted" }, "Los últimos registros están en la pestaña Asistencia."), { title: "Actividad reciente" }));
  content.replaceChildren(...parts);
}

/* ───────── Asistencia ───────── */
async function tabAttendance({ id, event, content, statsPromise, operatorsPromise }) {
  let page = 0, operatorId = "", filter = "", loadId = 0, lastRes = null;
  const opsRes = await operatorsPromise;
  const opMap = new Map((opsRes.ok ? opsRes.o : []).map((o) => [o.operatorId, o.name || o.email]));
  const opName = (oid) => opMap.get(oid) || (oid ? `Usuario ${oid.slice(0, 6)}` : "—");
  const stRes = await statsPromise;
  const opSel = select([{ value: "", label: "Todos los operadores" }, ...(opsRes.ok ? opsRes.o : []).map((o) => ({ value: o.operatorId, label: o.name || o.email }))], { "aria-label": "Filtrar por operador" });
  const filterIn = input({ type: "search", placeholder: "Filtrar en esta página", "aria-label": "Filtrar registros de la página actual" });
  const exportBtn = btn({ label: "Exportar CSV", icon: "download", onClick: doExport });
  const clearBtn = menuButton({ label: "Más acciones de asistencia", items: [{ label: "Vaciar asistencia", icon: "trash", danger: true, onClick: clearAll }] });
  const host = el("div", {});
  const note = el("div", {});
  content.replaceChildren(
    ...(opsRes.ok ? [] : [banner({ tone: "warn", title: "No se pudieron cargar los operadores", text: `${opsRes.error} Los nombres de operador pueden aparecer incompletos.` })]),
    el("div", { class: "toolbar" }, [select_wrap(opSel), el("div", { class: "toolbar-search" }, [filterIn]), el("div", { class: "toolbar-end" }, [btn({ icon: "refresh", variant: "ghost", title: "Actualizar", onClick: () => load() }), exportBtn, clearBtn])]),
    note, host,
  );
  function select_wrap(s) { return el("div", { class: "toolbar-select" }, s); }

  async function load() {
    const my = ++loadId;
    host.replaceChildren(card(dataTable({ columns: [{ label: "Documento" }, { label: "Nombre" }, { label: "Operador" }, { label: "Registrado" }, { label: "" }], rows: [], loading: true }), { cls: "card-flush" }));
    try {
      const res = await repo.scans.page(id, { limit: PAGE, offset: page * PAGE, operatorId: operatorId || undefined });
      if (my !== loadId) return;
      if (!res.rows.length && page > 0) { page = 0; return load(); }
      paint(res);
    } catch (e) { if (my === loadId) host.replaceChildren(errorState({ message: e.message, retry: load })); }
  }
  function paint(res) {
    lastRes = res;
    const q = filter.trim().toLowerCase();
    const shown = q ? res.rows.filter((r) => r.document.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) : res.rows;
    const total = !operatorId && stRes.ok ? stRes.s.total : null;
    host.replaceChildren(card([
      dataTable({
        caption: "Registros de asistencia",
        columns: [
          { label: "Documento", class: "num", render: (r) => r.document },
          { label: "Nombre", render: (r) => r.name || el("span", { class: "muted" }, "Sin nombre") },
          { label: "Operador", render: (r) => opName(r.operatorId) },
          { label: "Registrado", render: (r) => fmtDateTime(r.receivedAt) },
          { label: "", class: "col-actions", render: (r) => btn({ icon: "trash", variant: "ghost", small: true, title: `Eliminar registro ${r.document}`, onClick: () => removeOne(r) }) },
        ],
        rows: shown,
        empty: q ? emptyState({ icon: "search", title: "Sin coincidencias en esta página", text: "El filtro solo busca en los registros de la página visible." }) : emptyState({ icon: "users", title: operatorId ? "Este operador no tiene registros" : "Aún no hay asistencia", text: operatorId ? "Prueba con otro operador." : "Los registros aparecerán cuando los operadores asignados empiecen a escanear." }),
      }),
      res.rows.length ? pager({ page, pageSize: PAGE, total, hasMore: res.hasMore, shown: res.rows.length, onChange: (p) => { page = p; load(); } }) : null,
    ], { cls: "card-flush" }));
  }
  async function removeOne(r) {
    if (!(await confirmDialog({ title: "Eliminar registro", message: `Se elimina de forma permanente el registro del documento ${r.document}. Queda anotado en la auditoría.`, confirmLabel: "Eliminar", danger: true }))) return;
    try { await repo.scans.remove(id, r.id); toast("Registro eliminado", "ok"); load(); } catch (e) { toast(e.message, "danger"); }
  }
  async function clearAll() {
    if (!(await confirmDialog({ title: "Vaciar asistencia", message: `Se eliminan TODOS los registros de «${event.name}». No se puede deshacer; la acción queda en la auditoría.`, confirmLabel: "Vaciar asistencia", danger: true, requireText: "VACIAR" }))) return;
    try { const n = await repo.scans.clear(id); toast(`${fmtNumber(n)} registros eliminados`, "ok"); page = 0; load(); } catch (e) { toast(e.message, "danger"); }
  }
  async function doExport() {
    note.replaceChildren();
    const progress = el("span", {}, "0");
    const status = banner({ tone: "info", title: "Descargando todas las páginas", text: " " }); status.querySelector(".banner-body p").replaceChildren("Registros recibidos: ", progress);
    note.replaceChildren(status);
    const res = await withBusy(exportBtn, () => loadAllScans(id, { operatorId: operatorId || undefined, onProgress: (n) => { progress.textContent = fmtNumber(n); } }), "Exportando");
    if (!res.rows.length && res.complete) { note.replaceChildren(banner({ tone: "info", text: "No hay registros para exportar con este filtro." })); return; }
    if (!res.rows.length) { note.replaceChildren(banner({ tone: "danger", title: "No se pudo exportar", text: res.error })); return; }
    exportScans({ rows: res.rows, operatorName: opName, baseName: `asistencia-${slugify(event.name)}`, complete: res.complete });
    note.replaceChildren(res.complete ? banner({ tone: "ok", title: "Exportación completa", text: `${fmtNumber(res.rows.length)} registros en el CSV.` }) : banner({ tone: "danger", title: "Exportación incompleta", text: `El CSV tiene ${fmtNumber(res.rows.length)} registros y se marcó como PARCIAL. ${res.error}` }));
  }
  filterIn.addEventListener("input", () => { filter = filterIn.value; if (lastRes) paint(lastRes); });
  opSel.addEventListener("change", () => { operatorId = opSel.value; page = 0; load(); });
  load();
}

/* ───────── Operadores ───────── */
async function tabOperators({ id, ctx, content, operatorsPromise }) {
  content.replaceChildren(skeletonBlock(4));
  const res = await operatorsPromise;
  if (!res.ok) { content.replaceChildren(errorState({ message: res.error })); return; }
  let all; try { all = await repo.users.operators(); } catch (e) { content.replaceChildren(errorState({ message: e.message })); return; }
  let assigned = res.o;
  const host = el("div", {});
  async function refresh() { try { assigned = await repo.events.operators(id); } catch (e) { toast(e.message, "danger"); } paint(); }
  async function setStatus(o, status) {
    if (!(await confirmDialog({ title: status === "active" ? "Reactivar asignación" : "Retirar operador", message: status === "active" ? "El operador volverá a ver el evento y podrá registrar asistencia." : "El operador deja de ver este evento. Sus registros anteriores se conservan.", confirmLabel: status === "active" ? "Reactivar" : "Retirar", danger: status !== "active" }))) return;
    try { await repo.assignments.setStatus(id, o.operatorId, status); toast("Asignación actualizada", "ok"); await refresh(); } catch (e) { toast(e.message, "danger"); }
  }
  function paint() {
    const taken = new Set(assigned.filter((a) => a.status === "active").map((a) => a.operatorId));
    const candidates = all.filter((o) => o.status === "active" && !taken.has(o.id));
    const sel = select([{ value: "", label: candidates.length ? "Elige un operador" : "No hay operadores disponibles" }, ...candidates.map((o) => ({ value: o.id, label: o.full_name || o.email }))]);
    const f = field({ label: "Asignar operador", control: sel });
    const add = btn({ label: "Asignar", icon: "plus", variant: "primary", disabled: !candidates.length, onClick: async () => {
      if (!sel.value) { f.setError("Elige un operador."); sel.focus(); return; } f.setError("");
      try { await withBusy(add, () => repo.assignments.assign(id, sel.value, ctx.profile.id), "Asignando"); toast("Operador asignado", "ok"); await refresh(); } catch (e) { f.setError(e.message); }
    } });
    host.replaceChildren(
      card(el("div", { class: "inline-form" }, [f.root, add]), { title: "Asignar", subtitle: "Solo operadores activos de tu empresa. Crea más desde Usuarios." }),
      card(dataTable({
        caption: "Operadores del evento",
        columns: [
          { label: "Operador", render: (o) => el("div", { class: "cell-stack" }, [el("strong", {}, o.name || "Sin nombre"), el("span", { class: "muted small" }, o.email)]) },
          { label: "Estado", render: (o) => pill(o.status === "active" ? "Activo" : "Retirado", o.status === "active" ? "ok" : "neutral") },
          { label: "Desde", render: (o) => fmtDateTime(o.since) },
          { label: "", class: "col-actions", render: (o) => (o.status === "active" ? btn({ label: "Retirar", small: true, onClick: () => setStatus(o, "inactive") }) : btn({ label: "Reactivar", small: true, onClick: () => setStatus(o, "active") })) },
        ],
        rows: assigned,
        empty: emptyState({ icon: "link", title: "Sin operadores asignados", text: "Asigna al menos un operador para que pueda registrar asistencia en este evento." }),
      }), { cls: "card-flush", title: "Operadores del evento" }),
    );
  }
  content.replaceChildren(host); paint();
}

/* ───────── Auditoría ───────── */
async function tabAudit({ id, content }) {
  const a = el("div", {}), b = el("div", {});
  content.replaceChildren(banner({ tone: "info", text: "La auditoría de asistencia viene de la API (máximo 500 eventos recientes) y no incluye quién hizo cada acción. Los cambios del evento sí muestran el autor." }), a, b);
  a.replaceChildren(skeletonBlock(3)); b.replaceChildren(skeletonBlock(3));
  repo.events.changeLog(id).then((rows) => {
    a.replaceChildren(card(dataTable({ caption: "Cambios del evento", columns: [{ label: "Fecha", render: (r) => fmtDateTime(r.at) }, { label: "Cambio", render: (r) => CHANGE_LABEL[r.action] || r.action }, { label: "Autor", render: (r) => r.actor || el("span", { class: "muted" }, "No registrado") }], rows, empty: emptyState({ icon: "history", title: "Sin cambios registrados" }) }), { title: "Cambios del evento", subtitle: "Fuente: historial de Supabase.", cls: "card-flush" }));
  }, (e) => a.replaceChildren(card(errorState({ title: "No se pudo cargar el historial de cambios", message: e.message, retry: () => tabAudit({ id, content }) }), { title: "Cambios del evento" })));
  repo.scans.audit(id).then((rows) => {
    let page = 0;
    const paint = () => {
      const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
      b.replaceChildren(card([dataTable({ caption: "Actividad de asistencia", columns: [{ label: "Fecha", render: (r) => fmtDateTime(r.at) }, { label: "Acción", render: (r) => SCAN_ACTIONS[r.action] || r.action }, { label: "Referencia", render: (r) => el("span", { class: "num muted" }, String(r.id || "").slice(0, 8) || "—") }], rows: slice, empty: emptyState({ icon: "history", title: "Sin actividad registrada" }) }), rows.length ? pager({ page, pageSize: PAGE, total: rows.length, shown: slice.length, onChange: (p) => { page = p; paint(); } }) : null], { title: "Actividad de asistencia", subtitle: rows.length >= 500 ? "Se muestran los 500 eventos más recientes." : "Fuente: API de asistencia.", cls: "card-flush" }));
    };
    paint();
  }, (e) => b.replaceChildren(card(errorState({ title: "No se pudo cargar la auditoría de asistencia", message: e.message, retry: () => tabAudit({ id, content }) }), { title: "Actividad de asistencia" })));
}
