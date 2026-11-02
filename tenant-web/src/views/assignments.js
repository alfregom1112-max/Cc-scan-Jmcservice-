import { el, btn, card, pageHeader, dataTable, pager, emptyState, errorState, pill, field, select, formMessage, setMessage, withBusy, openDialog, confirmDialog, toast, banner } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, fmtDateTime } from "../lib/format.js";

const PAGE = 20;

export function renderAssignments(container, { ctx, params }) {
  let rows = [], events = [], operators = [], page = 0;
  const host = el("div", {});
  const evSel = select([{ value: "", label: "Todos los eventos" }], { "aria-label": "Filtrar por evento" });
  const opSel = select([{ value: "", label: "Todos los operadores" }], { "aria-label": "Filtrar por operador" });
  const state = select([{ value: "active", label: "Solo activas" }, { value: "", label: "Activas y retiradas" }], { "aria-label": "Filtrar por estado" });
  const addBtn = btn({ label: "Nueva asignación", icon: "plus", variant: "primary", onClick: openAdd });
  container.replaceChildren(pageHeader({ title: "Asignaciones", subtitle: "Define qué operador puede registrar asistencia en cada evento.", actions: [addBtn] }), el("div", { class: "toolbar" }, [el("div", { class: "toolbar-select" }, evSel), el("div", { class: "toolbar-select" }, opSel), el("div", { class: "toolbar-select" }, state)]), host);

  function openAdd() {
    const open = events.filter((e) => e.status !== "closed");
    const e = field({ label: "Evento", required: true, control: select([{ value: "", label: "Elige un evento" }, ...open.map((x) => ({ value: x.id, label: x.name }))], { value: evSel.value || "" }) });
    const o = field({ label: "Operador", required: true, hint: "Solo operadores activos.", control: select([{ value: "", label: "Elige un operador" }, ...operators.filter((x) => x.status === "active").map((x) => ({ value: x.id, label: x.full_name || x.email }))], { value: opSel.value || "" }) });
    const msg = formMessage(); const save = btn({ label: "Asignar", variant: "primary" });
    const form = el("form", { class: "stack", novalidate: true, onSubmit: async (ev) => {
      ev.preventDefault(); setMessage(msg, ""); e.setError(""); o.setError("");
      if (!e.control.value) { e.setError("Elige un evento."); e.control.focus(); return; }
      if (!o.control.value) { o.setError("Elige un operador."); o.control.focus(); return; }
      try { await withBusy(save, () => repo.assignments.assign(e.control.value, o.control.value, ctx.profile.id), "Asignando"); ref.close(); toast("Operador asignado", "ok"); await load(true); } catch (err) { setMessage(msg, err.message); }
    } }, [e.root, o.root, msg]);
    save.addEventListener("click", () => form.requestSubmit());
    const ref = openDialog({ title: "Nueva asignación", description: "Si el operador ya estaba retirado de ese evento, se reactiva.", body: form, actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), el("span", { class: "spacer" }), save] });
    e.control.focus();
  }
  async function setStatus(r, status) {
    if (!(await confirmDialog({ title: status === "active" ? "Reactivar asignación" : "Retirar operador", message: status === "active" ? `${r.operatorName || r.operatorEmail} podrá registrar asistencia en «${r.eventName}».` : `${r.operatorName || r.operatorEmail} deja de ver «${r.eventName}». Sus registros anteriores se conservan.`, confirmLabel: status === "active" ? "Reactivar" : "Retirar", danger: status !== "active" }))) return;
    try { await repo.assignments.setStatus(r.eventId, r.operatorId, status); toast("Asignación actualizada", "ok"); await load(true); } catch (e) { toast(e.message, "danger"); }
  }
  function paint() {
    const list = rows.filter((r) => (!evSel.value || r.eventId === evSel.value) && (!opSel.value || r.operatorId === opSel.value) && (!state.value || r.status === state.value));
    const slice = list.slice(page * PAGE, page * PAGE + PAGE);
    host.replaceChildren(card([
      dataTable({
        caption: "Asignaciones",
        columns: [
          { label: "Evento", render: (r) => el("a", { class: "cell-link", href: `#/events/${r.eventId}/operators` }, [el("strong", {}, r.eventName || "Evento"), el("span", { class: "muted small" }, [pill(EVENT_STATUS[r.eventStatus]?.label || "—", EVENT_STATUS[r.eventStatus]?.tone || "neutral")])]) },
          { label: "Operador", render: (r) => el("div", { class: "cell-stack" }, [el("strong", {}, r.operatorName || "Sin nombre"), el("span", { class: "muted small" }, r.operatorEmail)]) },
          { label: "Estado", render: (r) => pill(r.status === "active" ? "Activa" : "Retirada", r.status === "active" ? "ok" : "neutral") },
          { label: "Desde", render: (r) => fmtDateTime(r.since) },
          { label: "", class: "col-actions", render: (r) => (r.status === "active" ? btn({ label: "Retirar", small: true, onClick: () => setStatus(r, "inactive") }) : btn({ label: "Reactivar", small: true, onClick: () => setStatus(r, "active") })) },
        ],
        rows: slice,
        empty: rows.length ? emptyState({ icon: "search", title: "Sin asignaciones con estos filtros", text: "Cambia los filtros o crea una asignación nueva." }) : emptyState({ icon: "link", title: "Aún no hay asignaciones", text: "Asigna operadores a un evento para que puedan registrar asistencia.", action: btn({ label: "Nueva asignación", icon: "plus", variant: "primary", onClick: openAdd }) }),
      }),
      list.length ? pager({ page, pageSize: PAGE, total: list.length, shown: slice.length, onChange: (p) => { page = p; paint(); } }) : null,
    ], { cls: "card-flush" }));
  }
  async function load(silent) {
    if (!silent) host.replaceChildren(card(dataTable({ columns: [{ label: "Evento" }, { label: "Operador" }, { label: "Estado" }, { label: "Desde" }, { label: "" }], rows: [], loading: true }), { cls: "card-flush" }));
    try {
      [rows, events, operators] = await Promise.all([repo.assignments.list(), repo.events.options(), repo.users.operators()]);
      const keepE = evSel.value, keepO = opSel.value;
      evSel.replaceChildren(el("option", { value: "" }, "Todos los eventos"), ...events.map((e) => el("option", { value: e.id }, e.name)));
      opSel.replaceChildren(el("option", { value: "" }, "Todos los operadores"), ...operators.map((o) => el("option", { value: o.id }, o.full_name || o.email)));
      evSel.value = keepE; opSel.value = keepO || (silent ? "" : params[0] || "");
      if (opSel.value !== (keepO || (silent ? "" : params[0] || ""))) opSel.value = "";
      paint();
    } catch (e) { host.replaceChildren(errorState({ message: e.message, retry: () => load() })); }
  }
  for (const s of [evSel, opSel, state]) s.addEventListener("change", () => { page = 0; paint(); });
  void load();
}
