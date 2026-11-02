import { icon } from "../lib/icons.js";
import { el, btn, field, passwordInput, formMessage, setMessage, withBusy } from "../lib/ui.js";
import { repo } from "../lib/repo.js";

export function renderSetPassword(root, { title, description, onDone }) {
  const p1 = passwordInput({ autocomplete: "new-password", required: true, minlength: 8, maxlength: 128 });
  const a = field({ label: "Contraseña nueva", required: true, hint: "Mínimo 8 caracteres.", control: p1.input, wrap: p1.wrap });
  const p2 = passwordInput({ autocomplete: "new-password", required: true });
  const b = field({ label: "Repite la contraseña", required: true, control: p2.input, wrap: p2.wrap });
  const msg = formMessage();
  const submit = btn({ label: "Guardar y entrar", variant: "primary", type: "submit", cls: "btn-block" });
  const f = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
    e.preventDefault(); setMessage(msg, ""); a.setError(""); b.setError("");
    if (p1.input.value.length < 8) { a.setError("Usa al menos 8 caracteres."); p1.input.focus(); return; }
    if (p1.input.value !== p2.input.value) { b.setError("Las contraseñas no coinciden."); p2.input.focus(); return; }
    try { await withBusy(submit, () => repo.auth.updatePassword(p1.input.value), "Guardando"); onDone(); }
    catch (err) { setMessage(msg, err.message); }
  } }, [a.root, b.root, msg, submit]);
  root.replaceChildren(el("div", { class: "auth auth-single" }, el("main", { class: "auth-main" }, el("div", { class: "auth-card" }, [
    el("div", { class: "auth-brand auth-brand-solo" }, [el("span", { class: "brand-mark" }, icon("scan", 22)), el("strong", {}, "JM ServiceTec")]),
    el("h1", { class: "auth-title" }, title), el("p", { class: "auth-lead" }, description), f,
  ]))));
  p1.input.focus();
}
