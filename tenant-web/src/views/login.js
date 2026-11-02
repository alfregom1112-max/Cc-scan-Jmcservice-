import { icon } from "../lib/icons.js";
import { el, btn, field, input, passwordInput, formMessage, setMessage, withBusy, banner } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { isDemo } from "../lib/config.js";

// Barras tipo PDF417 (el código del reverso de la cédula): decoración determinista, sin datos.
function barcode() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 480 150"); svg.setAttribute("class", "auth-barcode"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("preserveAspectRatio", "none");
  let seed = 7; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let row = 0; row < 6; row++) {
    let x = 0;
    while (x < 480) {
      const w = 2 + Math.floor(r() * 7); const gap = 2 + Math.floor(r() * 5);
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", row * 25); rect.setAttribute("width", w); rect.setAttribute("height", 21);
      svg.append(rect); x += w + gap;
    }
  }
  return svg;
}

export function renderLogin(root, { callbackError, onActivate }) {
  let mode = "login"; // login | recover
  const form = el("div", { class: "auth-form-area" });
  const panelFor = () => (mode === "login" ? loginPanel() : recoverPanel());
  const swap = (m) => { mode = m; form.replaceChildren(panelFor()); form.querySelector("input")?.focus(); };

  function loginPanel() {
    const email = field({ label: "Correo", required: true, control: input({ type: "email", autocomplete: "username", required: true, placeholder: "nombre@empresa.com" }) });
    const pw = passwordInput({ autocomplete: "current-password", required: true });
    const password = field({ label: "Contraseña", required: true, control: pw.input, wrap: pw.wrap }); // el control queda dentro del contenedor con el botón de ver
    const msg = formMessage();
    const submit = btn({ label: "Entrar", variant: "primary", type: "submit", cls: "btn-block" });
    const f = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
      e.preventDefault(); setMessage(msg, "");
      email.setError(""); password.setError("");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.control.value.trim())) { email.setError("Escribe un correo válido."); email.control.focus(); return; }
      if (!pw.input.value) { password.setError("Escribe tu contraseña."); pw.input.focus(); return; }
      try { await withBusy(submit, () => repo.auth.signIn(email.control.value.trim(), pw.input.value), "Verificando"); }
      catch (err) { setMessage(msg, err.message); }
    } }, [
      callbackError ? banner({ tone: "warn", title: "Enlace no válido", text: callbackError }) : null,
      email.root, password.root, msg, submit,
      el("div", { class: "auth-links" }, [
        el("button", { class: "link-btn", type: "button", onClick: () => swap("recover") }, "Recuperar acceso"),
        el("button", { class: "link-btn", type: "button", onClick: onActivate }, "Tengo un PIN de activación"),
      ]),
    ]);
    return el("div", {}, [el("h1", { class: "auth-title" }, "Inicia sesión"), el("p", { class: "auth-lead" }, "Usa la cuenta que te dio tu administrador."), f]);
  }

  function recoverPanel() {
    const email = field({ label: "Correo de tu cuenta", required: true, control: input({ type: "email", autocomplete: "username", required: true }) });
    const msg = formMessage();
    const submit = btn({ label: "Enviar enlace", variant: "primary", type: "submit", cls: "btn-block" });
    const f = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
      e.preventDefault(); setMessage(msg, ""); email.setError("");
      const v = email.control.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { email.setError("Escribe un correo válido."); return; }
      try { await withBusy(submit, () => repo.auth.sendRecovery(v), "Enviando"); setMessage(msg, "Si el correo tiene una cuenta, recibirás un enlace para crear una contraseña nueva. Revisa también el correo no deseado.", "ok"); }
      catch (err) { setMessage(msg, err.message); }
    } }, [email.root, msg, submit, el("div", { class: "auth-links" }, [el("button", { class: "link-btn", type: "button", onClick: () => swap("login") }, "Volver a iniciar sesión")])]);
    return el("div", {}, [el("h1", { class: "auth-title" }, "Recupera tu acceso"), el("p", { class: "auth-lead" }, "Te enviamos un enlace para definir una contraseña nueva."), f]);
  }
  form.append(panelFor());

  const demoBox = isDemo ? el("div", { class: "demo-box" }, [
    el("p", { class: "demo-box-title" }, "Entrar como (demostración)"),
    el("p", { class: "demo-box-text" }, "No se piden credenciales. Los datos son ficticios."),
    el("div", { class: "demo-box-actions" }, [
      btn({ label: "Superadministrador", onClick: () => repo.demoSignInAs("superadmin") }),
      btn({ label: "Administrador de empresa", onClick: () => repo.demoSignInAs("admin") }),
      btn({ label: "Operador", onClick: () => repo.demoSignInAs("operator") }),
    ]),
  ]) : null;

  root.replaceChildren(el("div", { class: "auth" }, [
    el("aside", { class: "auth-aside" }, [
      el("div", { class: "auth-brand" }, [el("span", { class: "brand-mark" }, icon("scan", 22)), el("strong", {}, "JM ServiceTec")]),
      el("div", { class: "auth-pitch" }, [
        el("p", { class: "auth-kicker" }, "Eventos"),
        el("h2", {}, "Quién llegó, a qué hora y con qué operador, sin hojas de cálculo."),
        el("ul", { class: "auth-points" }, [
          el("li", {}, [icon("shield", 18), "Los documentos se guardan cifrados y cada empresa solo ve lo suyo."]),
          el("li", {}, [icon("users", 18), "Administradores y operadores trabajan con permisos distintos."]),
          el("li", {}, [icon("download", 18), "Exporta la asistencia completa a CSV cuando la necesites."]),
        ]),
      ]),
      el("div", { class: "auth-scan" }, [barcode(), el("span", { class: "auth-scan-line" })]),
    ]),
    el("main", { class: "auth-main" }, [el("div", { class: "auth-card" }, [
      el("div", { class: "auth-brand auth-brand-mobile" }, [el("span", { class: "brand-mark" }, icon("scan", 22)), el("strong", {}, "JM ServiceTec")]),
      form, demoBox,
    ])]),
  ]));
  form.querySelector("input")?.focus();
}
