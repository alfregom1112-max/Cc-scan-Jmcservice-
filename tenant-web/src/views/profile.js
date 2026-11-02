import { el, btn, card, pageHeader, field, passwordInput, formMessage, setMessage, withBusy, toast, pill } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { ROLE_LABEL, TENANT_STATUS, fmtDate, membershipActive } from "../lib/format.js";

export function renderProfile(container, { ctx, role }) {
  const t = ctx.tenant; const st = TENANT_STATUS[t?.subscription_status] || { label: "Sin estado", tone: "neutral" };
  const p1 = passwordInput({ autocomplete: "new-password", required: true, minlength: 8, maxlength: 128 });
  const a = field({ label: "Contraseña nueva", required: true, hint: "Mínimo 8 caracteres.", control: p1.input, wrap: p1.wrap });
  const p2 = passwordInput({ autocomplete: "new-password", required: true });
  const b = field({ label: "Repite la contraseña", required: true, control: p2.input, wrap: p2.wrap });
  const msg = formMessage(); const save = btn({ label: "Cambiar contraseña", variant: "primary", type: "submit" });
  const form = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
    e.preventDefault(); setMessage(msg, ""); a.setError(""); b.setError("");
    if (p1.input.value.length < 8) { a.setError("Usa al menos 8 caracteres."); p1.input.focus(); return; }
    if (p1.input.value !== p2.input.value) { b.setError("Las contraseñas no coinciden."); p2.input.focus(); return; }
    try { await withBusy(save, () => repo.auth.updatePassword(p1.input.value), "Guardando"); form.reset(); toast("Contraseña actualizada", "ok"); }
    catch (err) { setMessage(msg, err.message); }
  } }, [a.root, b.root, msg, el("div", {}, save)]);
  container.replaceChildren(
    pageHeader({ title: "Mi perfil", subtitle: "Datos de tu cuenta y de tu empresa." }),
    el("div", { class: "grid-2" }, [
      card(el("dl", { class: "defs" }, [
        el("dt", {}, "Nombre"), el("dd", {}, ctx.profile.full_name || "Sin nombre"),
        el("dt", {}, "Correo"), el("dd", {}, ctx.profile.email),
        el("dt", {}, "Rol"), el("dd", {}, ROLE_LABEL[role]),
        el("dt", {}, "Empresa"), el("dd", {}, t?.name || "—"),
        el("dt", {}, "Membresía"), el("dd", {}, [pill(st.label, membershipActive(t) ? st.tone : "danger"), t?.subscription_status !== "internal" && t?.current_period_ends_at ? el("span", { class: "muted" }, ` vence ${fmtDate(t.current_period_ends_at)}`) : null]),
      ]), { title: "Cuenta" }),
      card(form, { title: "Contraseña", subtitle: "Cambiarla no cierra tus otras sesiones." }),
    ]),
    el("div", {}, btn({ label: "Cerrar sesión", icon: "logout", onClick: () => repo.auth.signOut() })),
  );
}
