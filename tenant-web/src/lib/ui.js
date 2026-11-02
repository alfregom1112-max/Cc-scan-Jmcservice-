import { icon } from "./icons.js";

/* ───────── DOM ───────── */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "indeterminate") node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export const clear = (node) => { node.replaceChildren(); return node; };
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
let uid = 0;
export const nextId = (p = "f") => `${p}-${++uid}`;

/* ───────── Botones y etiquetas ───────── */
export function btn({ label, icon: ic, variant = "secondary", onClick, type = "button", disabled, title, small, ariaLabel, href, cls = "" }) {
  const classes = `btn btn-${variant}${small ? " btn-sm" : ""}${label ? "" : " btn-icon"} ${cls}`.trim();
  const children = [ic ? icon(ic, small ? 16 : 18) : null, label ? el("span", {}, label) : null];
  if (href) return el("a", { class: classes, href, title, "aria-label": ariaLabel }, children);
  return el("button", { class: classes, type, onClick, disabled, title, "aria-label": ariaLabel || (label ? null : title) }, children);
}
export function pill(label, tone = "neutral") { return el("span", { class: `pill pill-${tone}` }, [el("span", { class: "pill-dot", "aria-hidden": "true" }), label]); }

/** Deshabilita el botón mientras corre la promesa y muestra estado de progreso. */
export async function withBusy(button, task, busyLabel) {
  const label = button.querySelector("span");
  const prev = label?.textContent;
  button.disabled = true; button.setAttribute("aria-busy", "true"); button.classList.add("is-busy");
  if (label && busyLabel) label.textContent = busyLabel;
  try { return await task(); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); button.classList.remove("is-busy"); if (label && prev !== undefined) label.textContent = prev; }
}

/* ───────── Toasts ───────── */
export function toast(message, tone = "info") {
  let host = document.getElementById("toast-host");
  if (!host) { host = el("div", { id: "toast-host", class: "toast-host", role: "status", "aria-live": "polite" }); document.body.append(host); }
  const ic = tone === "ok" ? "check" : tone === "danger" || tone === "warn" ? "alert" : "info";
  const node = el("div", { class: `toast toast-${tone}` }, [icon(ic, 18), el("span", {}, message)]);
  host.append(node);
  const ttl = tone === "danger" || tone === "warn" ? 7000 : 4000;
  setTimeout(() => { node.classList.add("leaving"); setTimeout(() => node.remove(), 220); }, ttl);
}

/* ───────── Diálogos ───────── */
export function openDialog({ title, description, body, actions = [], size = "md", dismissible = true }) {
  const titleId = nextId("dlg-t");
  const closeBtn = dismissible ? el("button", { class: "btn btn-icon btn-ghost dialog-x", type: "button", "aria-label": "Cerrar", onClick: () => dialog.close() }, icon("x", 18)) : null;
  const dialog = el("dialog", { class: `dialog dialog-${size}`, "aria-labelledby": titleId }, [
    el("div", { class: "dialog-head" }, [el("div", {}, [el("h2", { id: titleId, class: "dialog-title" }, title), description ? el("p", { class: "dialog-desc" }, description) : null]), closeBtn]),
    body ? el("div", { class: "dialog-body" }, body) : null,
    actions.length ? el("div", { class: "dialog-actions" }, actions) : null,
  ]);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("cancel", (e) => { if (!dismissible) e.preventDefault(); });
  if (dismissible) dialog.addEventListener("mousedown", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close: () => dialog.close() };
}

export function confirmDialog({ title = "Confirmar acción", message, confirmLabel = "Confirmar", danger = false, requireText = null }) {
  return new Promise((resolve) => {
    let result = false;
    const input = requireText ? el("input", { class: "input", type: "text", autocomplete: "off", "aria-label": `Escribe ${requireText} para confirmar` }) : null;
    const confirm = btn({ label: confirmLabel, variant: danger ? "danger" : "primary", disabled: Boolean(requireText), onClick: () => { result = true; ref.close(); } });
    if (input) input.addEventListener("input", () => { confirm.disabled = input.value.trim() !== requireText; });
    const body = [el("p", { class: "dialog-text" }, message)];
    if (input) body.push(el("label", { class: "field" }, [el("span", { class: "field-label" }, `Escribe ${requireText} para confirmar`), input]));
    const ref = openDialog({ title, body, size: "sm", actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), confirm] });
    ref.dialog.addEventListener("close", () => resolve(result));
    (input || confirm).focus();
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = el("textarea", { style: "position:fixed;opacity:0", "aria-hidden": "true" }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; } ta.remove(); return ok;
  }
}

/** Muestra un secreto de un solo uso (PIN) con cuenta regresiva de vigencia. */
export function secretDialog({ title, description, secret, expiresMinutes, note }) {
  const deadline = Date.now() + (expiresMinutes || 30) * 60000;
  const countdown = el("p", { class: "secret-expiry", role: "timer" });
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    countdown.textContent = left > 0 ? `Vigente ${m}:${String(s).padStart(2, "0")} min` : "El PIN venció. Genera uno nuevo.";
    countdown.classList.toggle("is-expired", left === 0);
  };
  tick(); const timer = setInterval(tick, 1000);
  const code = el("div", { class: "secret-code", "aria-label": `PIN ${secret.split("").join(" ")}` }, secret.split("").map((c) => el("span", {}, c)));
  const copy = btn({ label: "Copiar PIN", icon: "copy", onClick: async () => { toast((await copyText(secret)) ? "PIN copiado" : "No se pudo copiar. Cópialo a mano.", "ok"); } });
  const ref = openDialog({
    title, description, size: "sm", dismissible: true,
    body: [code, countdown, el("p", { class: "dialog-text muted" }, note || "Se muestra una sola vez. Si lo pierdes, genera otro.")],
    actions: [copy, btn({ label: "Listo", variant: "primary", onClick: () => ref.close() })],
  });
  ref.dialog.addEventListener("close", () => clearInterval(timer));
  return ref;
}

/* ───────── Formularios ───────── */
export function field({ label, control, wrap, hint, required, error }) {
  const id = control.id || nextId("fld");
  control.id = id;
  const hintEl = hint ? el("span", { class: "field-hint", id: `${id}-hint` }, hint) : null;
  const errEl = el("span", { class: "field-error", id: `${id}-err`, role: "alert" });
  const described = [hintEl ? `${id}-hint` : null, `${id}-err`].filter(Boolean).join(" ");
  control.setAttribute("aria-describedby", described);
  const root = el("div", { class: "field" }, [
    el("label", { class: "field-label", for: id }, [label, required ? el("span", { class: "req", "aria-hidden": "true" }, " *") : null]),
    wrap || control, hintEl, errEl,
  ]);
  const setError = (msg) => { errEl.textContent = msg || ""; if (msg) control.setAttribute("aria-invalid", "true"); else control.removeAttribute("aria-invalid"); };
  if (error) setError(error);
  return { root, control, setError };
}
export function input(opts = {}) { const { class: c, ...rest } = opts; return el("input", { class: `input ${c || ""}`.trim(), ...rest }); }
export function textarea(opts = {}) { return el("textarea", { class: "input textarea", rows: 3, ...opts }); }
export function select(options, opts = {}) {
  const { value, ...rest } = opts;
  const s = el("select", { class: "input select", ...rest }, options.map((o) => el("option", { value: o.value }, o.label)));
  if (value !== undefined) s.value = value;
  return s;
}
export function passwordInput(opts = {}) {
  const i = input({ type: "password", ...opts });
  const toggle = el("button", { class: "btn btn-icon btn-ghost pw-toggle", type: "button", "aria-label": "Mostrar contraseña", "aria-pressed": "false" }, icon("eye", 18));
  toggle.addEventListener("click", () => {
    const show = i.type === "password"; i.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show)); toggle.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    toggle.replaceChildren(icon(show ? "eye-off" : "eye", 18));
  });
  const wrap = el("div", { class: "input-wrap" }, [i, toggle]);
  return { wrap, input: i };
}
export function formMessage() { return el("p", { class: "form-message", role: "alert" }); }
export function setMessage(node, text, tone = "danger") { node.textContent = text || ""; node.className = `form-message${text ? ` is-${tone}` : ""}`; }

/* ───────── Bloques de página ───────── */
export function pageHeader({ title, subtitle, back, actions = [], status }) {
  return el("header", { class: "page-header" }, [
    el("div", { class: "page-header-main" }, [
      back ? el("a", { class: "back-link", href: back.href }, [icon("chevron-left", 16), back.label]) : null,
      el("div", { class: "page-title-row" }, [el("h1", { class: "page-title", tabindex: "-1" }, title), status || null]),
      subtitle ? el("p", { class: "page-subtitle" }, subtitle) : null,
    ]),
    actions.length ? el("div", { class: "page-actions" }, actions) : null,
  ]);
}
export function card(children, { cls = "", title, subtitle, actions } = {}) {
  const head = title ? el("div", { class: "card-head" }, [el("div", {}, [el("h2", { class: "card-title" }, title), subtitle ? el("p", { class: "card-sub" }, subtitle) : null]), actions ? el("div", { class: "card-actions" }, actions) : null]) : null;
  return el("section", { class: `card ${cls}`.trim() }, [head, ...[].concat(children)]);
}
export function kpi({ label, value, note, unavailable = false, tone }) {
  return el("article", { class: `kpi${unavailable ? " is-unavailable" : ""}${tone ? ` kpi-${tone}` : ""}` }, [
    el("div", { class: "kpi-label" }, label),
    el("div", { class: "kpi-value" }, unavailable ? "No disponible" : value),
    note ? el("p", { class: "kpi-note" }, note) : null,
  ]);
}
export function banner({ tone = "info", title, text, action }) {
  const ic = tone === "danger" || tone === "warn" ? "alert" : tone === "ok" ? "check" : "info";
  return el("div", { class: `banner banner-${tone}`, role: tone === "danger" ? "alert" : "status" }, [
    icon(ic, 20, "banner-icon"),
    el("div", { class: "banner-body" }, [title ? el("strong", {}, title) : null, text ? el("p", {}, text) : null]),
    action || null,
  ]);
}
export function emptyState({ icon: ic = "inbox", title, text, action }) {
  return el("div", { class: "state state-empty" }, [el("div", { class: "state-icon" }, icon(ic, 26)), el("h3", { class: "state-title" }, title), text ? el("p", { class: "state-text" }, text) : null, action || null]);
}
export function errorState({ title = "No se pudo cargar", message, retry }) {
  return el("div", { class: "state state-error", role: "alert" }, [el("div", { class: "state-icon" }, icon("alert", 26)), el("h3", { class: "state-title" }, title), message ? el("p", { class: "state-text" }, message) : null, retry ? btn({ label: "Reintentar", icon: "refresh", onClick: retry }) : null]);
}
export function skeletonBlock(lines = 3) {
  return el("div", { class: "skeleton-block", "aria-busy": "true", "aria-label": "Cargando" }, Array.from({ length: lines }, (_, i) => el("div", { class: "skeleton", style: `width:${92 - i * 14}%` })));
}
export function kpiSkeleton(n = 3) { return el("div", { class: "kpi-grid", "aria-busy": "true", "aria-label": "Cargando indicadores" }, Array.from({ length: n }, () => el("div", { class: "kpi skeleton-kpi" }, [el("div", { class: "skeleton", style: "width:50%" }), el("div", { class: "skeleton skeleton-lg", style: "width:36%" })]))); }

/* ───────── Tabla ───────── */
export function dataTable({ columns, rows, caption, empty, loading = false, rowClass }) {
  const wrap = el("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": caption || "Tabla de datos" });
  if (!loading && !rows.length) { wrap.classList.add("is-empty"); wrap.append(empty || emptyState({ title: "Sin resultados" })); return wrap; }
  const thead = el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.class || "", style: c.width ? `width:${c.width}` : null }, c.label))));
  const tbody = el("tbody", {});
  if (loading) {
    for (let i = 0; i < 5; i++) tbody.append(el("tr", { class: "row-skeleton" }, columns.map(() => el("td", {}, el("div", { class: "skeleton", style: `width:${50 + ((i * 17) % 40)}%` })))));
  } else {
    for (const row of rows) {
      tbody.append(el("tr", { class: rowClass ? rowClass(row) : "" }, columns.map((c) => {
        const content = c.render ? c.render(row) : row[c.key];
        return el("td", { "data-label": c.label, class: c.class || "" }, content === undefined || content === null || content === "" ? "—" : content);
      })));
    }
  }
  wrap.append(el("table", { class: "table" }, [caption ? el("caption", { class: "sr-only" }, caption) : null, thead, tbody]));
  return wrap;
}
export function pager({ page, pageSize, total, hasMore, shown, onChange }) {
  const from = shown ? page * pageSize + 1 : 0;
  const to = page * pageSize + (shown || 0);
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const label = shown ? `${from}–${to}${total != null ? ` de ${total}` : ""}` : "Sin registros";
  const canNext = total != null ? page + 1 < pages : Boolean(hasMore);
  return el("nav", { class: "pager", "aria-label": "Paginación" }, [
    el("span", { class: "pager-info" }, [label, pages ? ` · página ${page + 1} de ${pages}` : ` · página ${page + 1}`]),
    el("div", { class: "pager-actions" }, [
      btn({ label: "Anterior", icon: "chevron-left", small: true, disabled: page <= 0, onClick: () => onChange(page - 1) }),
      btn({ label: "Siguiente", small: true, disabled: !canNext, onClick: () => onChange(page + 1), cls: "btn-next" }),
    ]),
  ]);
}
export function subnav(items, active) {
  return el("nav", { class: "subnav", "aria-label": "Secciones" }, items.map((it) => el("a", { class: `subnav-link${it.id === active ? " is-active" : ""}`, href: it.href, "aria-current": it.id === active ? "page" : null }, [it.icon ? icon(it.icon, 16) : null, it.label, it.count !== undefined ? el("span", { class: "subnav-count" }, String(it.count)) : null])));
}

/* ───────── Menú de acciones ───────── */
export function menuButton({ label = "Más acciones", items }) {
  const trigger = el("button", { class: "btn btn-icon btn-ghost", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": label, title: label }, icon("more", 18));
  const list = el("div", { class: "menu", role: "menu", hidden: true }, items.filter(Boolean).map((it) => el("button", { class: `menu-item${it.danger ? " is-danger" : ""}`, type: "button", role: "menuitem", onClick: () => { close(); it.onClick(); } }, [it.icon ? icon(it.icon, 16) : null, it.label])));
  const root = el("div", { class: "menu-wrap" }, [trigger, list]);
  const outside = (e) => { if (!root.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { close(); trigger.focus(); return; }
    const entries = [...list.querySelectorAll("button")]; const i = entries.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); entries[(i + 1) % entries.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); entries[(i - 1 + entries.length) % entries.length]?.focus(); }
  };
  function open() { list.hidden = false; trigger.setAttribute("aria-expanded", "true"); document.addEventListener("mousedown", outside); root.addEventListener("keydown", onKey); list.querySelector("button")?.focus(); }
  function close() { list.hidden = true; trigger.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", outside); root.removeEventListener("keydown", onKey); }
  trigger.addEventListener("click", () => (list.hidden ? open() : close()));
  return root;
}

/* ───────── Gráfico de barras (conteos reales) ───────── */
export function barList(rows, { emptyText = "Sin datos para mostrar.", formatter = (v) => String(v) } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => r.value === 0)) return el("p", { class: "muted small" }, emptyText);
  return el("ul", { class: "barlist" }, rows.map((r) => el("li", { class: "barlist-row" }, [
    el("span", { class: "barlist-label" }, r.label),
    el("span", { class: "barlist-track", "aria-hidden": "true" }, el("span", { class: `barlist-fill${r.tone ? ` tone-${r.tone}` : ""}`, style: `width:${r.value === 0 ? 0 : Math.max(3, Math.round((r.value / max) * 100))}%` })),
    el("span", { class: "barlist-value" }, formatter(r.value)),
  ])));
}
