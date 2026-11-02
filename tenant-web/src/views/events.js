import { el, btn, card, pageHeader, dataTable, pager, emptyState, errorState, pill, field, input, textarea, select, formMessage, setMessage, withBusy, openDialog, toast, debounce } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, fmtDateTime, fmtNumber, toLocalInput, relativeDays } from "../lib/format.js";

const PAGE = 15;

/** Formulario de alta/edición de evento (diálogo). `event` null = alta. */
export function openEventForm({ event, ctx, onSaved }) {
  const editing = Boolean(event);
  const name = field({ label: "Nombre del evento", required: true, control: input({ maxlength: 120, required: true, value: event?.name || "", autocomplete: "off" }) });
  const starts = field({ label: "Fecha y hora de inicio", required: true, hint: "Hora local de tu dispositivo.", control: input({ type: "datetime-local", required: true, value: toLocalInput(event?.starts_at) }) });
  const place = field({ label: "Lugar", control: input({ maxlength: 160, value: event?.place || "", autocomplete: "off" }) });
  const desc = field({ label: "Descripción", hint: "Opcional. La ven los operadores asignados.", control: textarea({ maxlength: 500, value: event?.description || "" }) });
  const statusSel = editing && event.status !== "closed" ? field({ label: "Estado", hint: "Pausado oculta el evento a los operadores y detiene los registros. Para cerrarlo usa «Cerrar evento».", control: select([{ value: "active", label: "Activo" }, { value: "inactive", label: "Pausado" }], { value: event.status }) }) : null;
  const msg = formMessage();
  const save = btn({ label: editing ? "Guardar cambios" : "Crear evento", variant: "primary" });
  const form = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
    e.preventDefault(); setMessage(msg, ""); [name, starts].forEach((x) => x.setError(""));
    let bad = null;
    if (name.control.value.trim().length < 2) { name.setError("Escribe el nombre del evento."); bad ||= name; }
    const when = new Date(starts.control.value);
    if (!starts.control.value || Number.isNaN(when.getTime())) { starts.setError("Elige una fecha y hora válidas."); bad ||= starts; }
    if (bad) { bad.control.focus(); return; }
    const values = { name: name.control.value.trim(), starts_at: when.toISOString(), place: place.control.value.trim(), description: desc.control.value.trim() };
    if (statusSel) values.status = statusSel.control.value;
    try {
      const res = await withBusy(save, () => (editing ? repo.events.update(event.id, values) : repo.events.create(values, ctx.profile.id)), "Guardando");
      ref.close(); toast(editing ? "Cambios guardados" : "Evento creado", "ok"); onSaved(res);
    } catch (err) { setMessage(msg, err.message); }
  } }, [name.root, starts.root, place.root, desc.root, statusSel?.root, msg]);
  save.addEventListener("click", () => form.requestSubmit());
  const ref = openDialog({ title: editing ? "Editar evento" : "Nuevo evento", body: form, actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), el("span", { class: "spacer" }), save] });
  name.control.focus();
}

export function renderEvents(container, { ctx, query, go }) {
  let page = 0, total = 0, rows = [], counts = null, loadId = 0;
  const search = input({ type: "search", placeholder: "Buscar por nombre o lugar", "aria-label": "Buscar eventos" });
  const status = select([{ value: "", label: "Todos los estados" }, { value: "active", label: "Activos" }, { value: "inactive", label: "Pausados" }, { value: "closed", label: "Cerrados" }], { "aria-label": "Filtrar por estado" });
  const host = el("div", {});
  const newBtn = btn({ label: "Nuevo evento", icon: "plus", variant: "primary", onClick: () => openEventForm({ ctx, onSaved: (r) => go(`#/events/${r.id}`) }) });
  container.replaceChildren(
    pageHeader({ title: "Eventos", subtitle: "Cada evento reúne sus operadores asignados y su registro de asistencia.", actions: [btn({ label: "Actualizar", icon: "refresh", onClick: () => load() }), newBtn] }),
    el("div", { class: "toolbar" }, [el("div", { class: "toolbar-search" }, [search]), status]),
    host,
  );

  async function load() {
    const id = ++loadId;
    host.replaceChildren(card(dataTable({ columns: [{ label: "Evento" }, { label: "Inicio" }, { label: "Estado" }, { label: "Registros" }, { label: "" }], rows: [], loading: true }), { cls: "card-flush" }));
    try {
      const [list, c] = await Promise.all([repo.events.list({ search: search.value, status: status.value, offset: page * PAGE, limit: PAGE }), repo.events.counts().catch(() => null)]);
      if (id !== loadId) return;
      rows = list.rows; total = list.total; counts = c;
      if (!rows.length && page > 0) { page = 0; return load(); }
      paint();
    } catch (e) { if (id === loadId) host.replaceChildren(errorState({ message: e.message, retry: load })); }
  }
  function paint() {
    const filtered = Boolean(search.value.trim() || status.value);
    host.replaceChildren(card([
      dataTable({
        caption: "Eventos",
        columns: [
          { label: "Evento", render: (e) => el("a", { class: "cell-link", href: `#/events/${e.id}` }, [el("strong", {}, e.name), el("span", { class: "muted small" }, e.place || "Sin lugar definido")]) },
          { label: "Inicio", render: (e) => el("div", { class: "cell-stack" }, [fmtDateTime(e.starts_at), el("span", { class: "muted small" }, relativeDays(e.starts_at))]) },
          { label: "Estado", render: (e) => pill(EVENT_STATUS[e.status]?.label || e.status, EVENT_STATUS[e.status]?.tone || "neutral") },
          { label: "Registros", class: "num", render: (e) => (counts ? fmtNumber(counts[e.id] ?? 0) : el("span", { class: "muted", title: "La API de asistencia no respondió" }, "—")) },
          { label: "", class: "col-actions", render: (e) => btn({ label: "Abrir", small: true, href: `#/events/${e.id}` }) },
        ],
        rows,
        empty: filtered ? emptyState({ icon: "search", title: "Ningún evento coincide", text: "Prueba con otra búsqueda o quita el filtro de estado." }) : emptyState({ icon: "calendar", title: "Aún no hay eventos", text: "Crea el primero para asignar operadores y registrar asistencia.", action: btn({ label: "Nuevo evento", icon: "plus", variant: "primary", onClick: () => newBtn.click() }) }),
      }),
      rows.length ? pager({ page, pageSize: PAGE, total, shown: rows.length, onChange: (p) => { page = p; load(); } }) : null,
    ], { cls: "card-flush" }));
    if (!counts && rows.length) host.prepend(el("p", { class: "muted small inline-note" }, "No se pudieron leer los conteos de registros desde la API de asistencia; se muestran con «—»."));
  }
  const reset = debounce(() => { page = 0; load(); }, 300);
  search.addEventListener("input", reset); status.addEventListener("change", () => { page = 0; load(); });
  void load();
  if (query?.get("new") === "1") { history.replaceState(null, "", "#/events"); setTimeout(() => newBtn.click(), 0); }
}
