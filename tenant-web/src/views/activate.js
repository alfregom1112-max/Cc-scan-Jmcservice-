import { icon } from "../lib/icons.js";
import { el, btn, field, input, passwordInput, formMessage, setMessage, withBusy } from "../lib/ui.js";
import { repo } from "../lib/repo.js";

export function renderActivate(root, { onBack }) {
  const pin = field({ label: "PIN de 6 dígitos", required: true, hint: "Te lo entregó tu administrador. Funciona una sola vez y vence a los 30 minutos.", control: input({ inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, pattern: "[0-9]{6}", required: true }) });
  const email = field({ label: "Correo", required: true, hint: "Debe ser el correo que registró tu administrador (para el PIN genérico de operador puede ser cualquier correo tuyo).", control: input({ type: "email", autocomplete: "email", required: true }) });
  const name = field({ label: "Nombre completo", required: true, control: input({ autocomplete: "name", required: true, maxlength: 120 }) });
  const p1 = passwordInput({ autocomplete: "new-password", required: true, minlength: 8, maxlength: 128 });
  const pass = field({ label: "Contraseña", required: true, hint: "Mínimo 8 caracteres.", control: p1.input, wrap: p1.wrap });
  const p2 = passwordInput({ autocomplete: "new-password", required: true });
  const confirm = field({ label: "Repite la contraseña", required: true, control: p2.input, wrap: p2.wrap });
  const msg = formMessage();
  const submit = btn({ label: "Activar cuenta", variant: "primary", type: "submit", cls: "btn-block" });
  pin.control.addEventListener("input", () => { pin.control.value = pin.control.value.replace(/\D/g, "").slice(0, 6); });

  const f = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
    e.preventDefault(); setMessage(msg, "");
    [pin, email, name, pass, confirm].forEach((x) => x.setError(""));
    let bad = null;
    if (!/^\d{6}$/.test(pin.control.value)) { pin.setError("El PIN tiene 6 dígitos."); bad ||= pin; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.control.value.trim())) { email.setError("Escribe un correo válido."); bad ||= email; }
    if (!name.control.value.trim()) { name.setError("Escribe tu nombre."); bad ||= name; }
    if (p1.input.value.length < 8) { pass.setError("Usa al menos 8 caracteres."); bad ||= pass; }
    else if (p1.input.value !== p2.input.value) { confirm.setError("Las contraseñas no coinciden."); bad ||= confirm; }
    if (bad) { bad.control.focus(); return; }
    try {
      await withBusy(submit, () => repo.auth.activatePin({ pin: pin.control.value, email: email.control.value.trim(), fullName: name.control.value.trim(), password: p1.input.value }), "Activando");
      card.replaceChildren(el("div", { class: "success-block" }, [el("span", { class: "success-icon" }, icon("check", 28)), el("h1", { class: "auth-title" }, "Cuenta activada"), el("p", { class: "auth-lead" }, `Ya puedes entrar con ${email.control.value.trim()} y la contraseña que acabas de crear.`), btn({ label: "Ir a iniciar sesión", variant: "primary", onClick: onBack, cls: "btn-block" })]));
    } catch (err) { setMessage(msg, err.message); }
  } }, [pin.root, email.root, name.root, pass.root, confirm.root, msg, submit, el("div", { class: "auth-links" }, [el("button", { class: "link-btn", type: "button", onClick: onBack }, "Volver a iniciar sesión")])]);

  const card = el("div", { class: "auth-card" }, [el("div", { class: "auth-brand auth-brand-solo" }, [el("span", { class: "brand-mark" }, icon("scan", 22)), el("strong", {}, "JM ServiceTec")]), el("h1", { class: "auth-title" }, "Activa tu cuenta"), el("p", { class: "auth-lead" }, "Usa el PIN que te dio tu administrador para crear tu acceso."), f]);
  root.replaceChildren(el("div", { class: "auth auth-single" }, el("main", { class: "auth-main" }, card)));
  pin.control.focus();
}
