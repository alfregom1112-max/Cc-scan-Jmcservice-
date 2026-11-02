import { el, btn, card, kpi, pageHeader, dataTable, pager, emptyState, errorState, banner, field, select, input, toast, barList } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { EVENT_STATUS, fmtDateTime, fmtNumber, bogotaDay, bogotaHour, slugify } from "../lib/format.js";
import { loadAllScans, exportScans, MAX_ROWS } from "../lib/export.js";

const PAGE = 25;

export function renderReports(container, { query }) {
  let data = null; // { eventId, eventName, rows, complete, error, apiTotal }
  let page = 0, cancelled = false, loading = false;
  const results = el("div", { class: "stack-lg" });
  const evSel = select([{ value: "", label: "Cargando eventos…" }]);
  const evField = field({ label: "Evento", required: true, control: evSel });
  const opSel = select([{ value: "", label: "Todos los operadores" }]);
  const opField = field({ label: "Operador", hint: "Filtra en el servidor.", control: opSel });
  const from = field({ label: "Desde", control: input({ type: "date" }) });
  const to = field({ label: "Hasta", control: input({ type: "date" }) });
  const text = field({ label: "Buscar", hint: "Documento o nombre.", control: input({ type: "search", autocomplete: "off" }) });
  const run = btn({ label: "Generar reporte", icon: "chart", variant: "primary", onClick: generate });
  const cancel = btn({ label: "Cancelar", variant: "ghost", onClick: () => { cancelled = true; } });
  let opNames = new Map();

  container.replaceChildren(
    pageHeader({ title: "Reportes", subtitle: "Carga todos los registros de un evento, filtra y exporta a CSV." }),
    card(el("div", { class: "report-filters" }, [evField.root, opField.root, from.root, to.root, text.root, el("div", { class: "report-run" }, run)]), { title: "Filtros" }),
    results,
  );

  async function init() {
    try {
      const evs = await repo.events.options();
      evSel.replaceChildren(el("option", { value: "" }, evs.length ? "Elige un evento" : "No hay eventos"), ...evs.map((e) => el("option", { value: e.id }, `${e.name} (${(EVENT_STATUS[e.status]?.label || e.status).toLowerCase()})`)));
      const pre = query?.get("event"); if (pre && evs.some((e) => e.id === pre)) { evSel.value = pre; await loadOperators(); }
      if (!evs.length) results.replaceChildren(emptyState({ icon: "calendar", title: "Aún no hay eventos", text: "Crea un evento para poder generar reportes.", action: btn({ label: "Crear evento", variant: "primary", href: "#/events?new=1" }) }));
      else if (!evSel.value) results.replaceChildren(emptyState({ icon: "report", title: "Elige un evento", text: "El reporte descarga todas las páginas de asistencia y te deja filtrar y exportar sin límite de página." }));
    } catch (e) { results.replaceChildren(errorState({ message: e.message, retry: init })); }
  }
  async function loadOperators() {
    opSel.replaceChildren(el("option", { value: "" }, "Todos los operadores")); opNames = new Map();
    if (!evSel.value) return;
    try { const ops = await repo.events.operators(evSel.value); opNames = new Map(ops.map((o) => [o.operatorId, o.name || o.email])); opSel.replaceChildren(el("option", { value: "" }, "Todos los operadores"), ...ops.map((o) => el("option", { value: o.operatorId }, o.name || o.email))); }
    catch { /* los nombres quedan como identificadores abreviados */ }
  }
  evSel.addEventListener("change", () => { data = null; results.replaceChildren(evSel.value ? emptyState({ icon: "report", title: "Listo para generar", text: "Pulsa «Generar reporte» para cargar los registros." }) : emptyState({ icon: "report", title: "Elige un evento" })); loadOperators(); });
  const opName = (id) => opNames.get(id) || (id ? `Usuario ${id.slice(0, 6)}` : "—");

  async function generate() {
    if (loading) return;
    evField.setError("");
    if (!evSel.value) { evField.setError("Elige un evento."); evSel.focus(); return; }
    loading = true; cancelled = false; run.disabled = true; page = 0;
    const count = el("strong", {}, "0");
    const loadingBanner = banner({ tone: "info", title: "Cargando registros del evento", text: " ", action: cancel });
    loadingBanner.querySelector(".banner-body p").replaceChildren("Recibidos: ", count, ` (máximo ${fmtNumber(MAX_ROWS)})`);
    results.replaceChildren(loadingBanner);
    const eventName = evSel.selectedOptions[0]?.textContent.replace(/ \([^)]*\)$/, "") || "evento";
    const [res, stats] = await Promise.all([loadAllScans(evSel.value, { operatorId: opSel.value || undefined, onProgress: (n) => { count.textContent = fmtNumber(n); }, shouldCancel: () => cancelled }), repo.scans.stats(evSel.value).catch(() => null)]);
    loading = false; run.disabled = false;
    data = { eventId: evSel.value, eventName, rows: res.rows, complete: res.complete, error: res.error, apiTotal: stats?.total ?? null, operatorFiltered: Boolean(opSel.value) };
    if (!res.rows.length && !res.complete) { results.replaceChildren(errorState({ title: "No se pudo generar el reporte", message: res.error, retry: generate })); return; }
    render();
  }
  function filtered() {
    const q = text.control.value.trim().toLowerCase(); const f = from.control.value, t = to.control.value;
    return data.rows.filter((r) => { const d = bogotaDay(r.receivedAt); return (!f || (d && d >= f)) && (!t || (d && d <= t)) && (!q || r.document.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)); });
  }
  function render() {
    if (!data) return;
    const rows = filtered();
    const parts = [];
    if (!data.complete) parts.push(banner({ tone: "danger", title: "Reporte incompleto", text: `Se cargaron ${fmtNumber(data.rows.length)} registros y la carga se detuvo. ${data.error} Las cifras y el CSV solo cubren lo cargado.`, action: btn({ label: "Reintentar", small: true, onClick: generate }) }));
    else if (data.apiTotal != null && !data.operatorFiltered && data.apiTotal !== data.rows.length) parts.push(banner({ tone: "warn", text: `La API reporta ${fmtNumber(data.apiTotal)} registros y se cargaron ${fmtNumber(data.rows.length)}: llegaron o se borraron registros durante la carga. Genera el reporte de nuevo para cuadrarlos.` }));
    const ops = new Set(rows.map((r) => r.operatorId)).size;
    const times = rows.map((r) => new Date(r.receivedAt).getTime()).filter(Number.isFinite);
    parts.push(el("div", { class: "kpi-grid kpi-grid-4" }, [
      kpi({ label: "Registros en el reporte", value: fmtNumber(rows.length), note: rows.length === data.rows.length ? "Sin filtros de fecha ni texto." : `De ${fmtNumber(data.rows.length)} cargados.` }),
      kpi({ label: "Operadores que registraron", value: fmtNumber(ops), note: "Distintos dentro del reporte." }),
      kpi({ label: "Primer registro", value: times.length ? fmtDateTime(Math.min(...times)) : "—", note: "Hora de recepción." }),
      kpi({ label: "Último registro", value: times.length ? fmtDateTime(Math.max(...times)) : "—", note: "Hora de recepción." }),
    ]));
    // Distribuciones calculadas en el navegador con los registros cargados (no vienen de la API).
    const byHour = new Map(); const byOp = new Map();
    for (const r of rows) { const h = bogotaHour(r.receivedAt); if (h !== null) byHour.set(h, (byHour.get(h) || 0) + 1); byOp.set(r.operatorId, (byOp.get(r.operatorId) || 0) + 1); }
    const hourRows = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({ label: `${String(h).padStart(2, "0")}:00`, value: v }));
    const opRows = [...byOp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, v]) => ({ label: opName(id), value: v }));
    const scope = data.complete ? "Calculado en tu navegador con los registros cargados." : "Calculado solo con los registros cargados: el reporte está incompleto.";
    parts.push(el("div", { class: "grid-2" }, [card(barList(hourRows, { emptyText: "Sin registros para graficar." }), { title: "Registros por hora", subtitle: `Hora de Colombia. ${scope}` }), card(barList(opRows, { emptyText: "Sin registros para graficar." }), { title: "Registros por operador", subtitle: `Hasta 8 operadores. ${scope}` })]));
    const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
    parts.push(card([
      dataTable({ caption: "Registros del reporte", columns: [{ label: "Documento", class: "num", render: (r) => r.document }, { label: "Nombre", render: (r) => r.name || el("span", { class: "muted" }, "Sin nombre") }, { label: "Operador", render: (r) => opName(r.operatorId) }, { label: "Dispositivo", render: (r) => r.deviceId }, { label: "Registrado", render: (r) => fmtDateTime(r.receivedAt) }], rows: slice, empty: emptyState({ icon: "search", title: "Ningún registro coincide", text: "Ajusta las fechas o la búsqueda y pulsa «Aplicar filtros»." }) }),
      rows.length ? pager({ page, pageSize: PAGE, total: rows.length, shown: slice.length, onChange: (p) => { page = p; render(); } }) : null,
    ], { cls: "card-flush", title: "Registros", actions: [btn({ label: "Aplicar filtros", variant: "ghost", onClick: () => { page = 0; render(); } }), btn({ label: `Exportar CSV (${fmtNumber(rows.length)})`, icon: "download", variant: "primary", disabled: !rows.length, onClick: () => { exportScans({ rows, operatorName: opName, baseName: `reporte-${slugify(data.eventName)}`, complete: data.complete }); toast(data.complete ? "CSV descargado" : "CSV descargado, marcado como PARCIAL", data.complete ? "ok" : "warn"); } })] }));
    results.replaceChildren(...parts);
  }
  void init();
}
