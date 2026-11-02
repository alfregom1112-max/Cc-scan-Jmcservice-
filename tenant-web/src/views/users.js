import { el, btn, card, pageHeader, dataTable, pager, emptyState, errorState, pill, field, input, select, formMessage, setMessage, withBusy, openDialog, confirmDialog, secretDialog, toast, debounce, menuButton, banner } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { fmtDate } from "../lib/format.js";

const PAGE = 15;
const ROLE = { admin: "Administrador", operator: "Operador" };
// El estado de usuario solo admite active/inactive (enum account_status). «Suspendida» es estado de la MEMBRESÍA de la empresa.
const USTATUS = { active: { label: "Activo", tone: "ok" }, inactive: { label: "Inactivo", tone: "neutral" } };

export function renderUsers(container, { ctx }) {
  let users = [], assignCount = {}, page = 0;
  const host = el("div", {});
  const search = input({ type: "search", placeholder: "Buscar por nombre o correo", "aria-label": "Buscar usuarios" });
  const role = select([{ value: "", label: "Todos los roles" }, { value: "admin", label: "Administradores" }, { value: "operator", label: "Operadores" }], { "aria-label": "Filtrar por rol" });
  container.replaceChildren(
    pageHeader({ title: "Usuarios", subtitle: "Invita personas por correo o entrega un PIN a operadores sin correo.", actions: [btn({ label: "Generar PIN de operador", icon: "key", onClick: createPin }), btn({ label: "Invitar usuario", icon: "mail", variant: "primary", onClick: openInvite })] }),
    el("div", { class: "toolbar" }, [el("div", { class: "toolbar-search" }, [search]), role]),
    host,
  );

  async function createPin() {
    if (!(await confirmDialog({ title: "Generar PIN de operador", message: "Se crea un PIN de un solo uso (30 minutos) para que un operador active su cuenta. Si ya generaste otro PIN sin usar, queda anulado.", confirmLabel: "Generar PIN" }))) return;
    try { const r = await repo.users.createPin(); secretDialog({ title: "PIN de operador", description: "Quien lo use podrá crear su cuenta de operador con cualquier correo.", secret: String(r.pin), expiresMinutes: r.expires_in_minutes, note: "Se activa en «Tengo un PIN de activación», en la pantalla de acceso. Vence a los 30 minutos y no se puede volver a ver." }); }
    catch (e) { toast(e.message, "danger"); }
  }
  function openInvite() {
    const email = field({ label: "Correo", required: true, control: input({ type: "email", required: true, autocomplete: "off" }) });
    const name = field({ label: "Nombre completo", control: input({ maxlength: 120, autocomplete: "off" }) });
    const r = field({ label: "Rol", control: select([{ value: "operator", label: "Operador: registra asistencia en sus eventos" }, { value: "admin", label: "Administrador: gestiona toda la empresa" }]) });
    const msg = formMessage(); const send = btn({ label: "Enviar invitación", icon: "mail", variant: "primary" });
    const form = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
      e.preventDefault(); setMessage(msg, ""); email.setError("");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.control.value.trim())) { email.setError("Escribe un correo válido."); email.control.focus(); return; }
      try { await withBusy(send, () => repo.users.invite({ email: email.control.value.trim(), fullName: name.control.value.trim(), role: r.control.value }), "Enviando"); ref.close(); toast("Invitación enviada", "ok"); await load(true); }
      catch (err) { setMessage(msg, err.message); }
    } }, [email.root, name.root, r.root, msg]);
    send.addEventListener("click", () => form.requestSubmit());
    const ref = openDialog({ title: "Invitar usuario", description: "Recibirá un correo para crear su contraseña.", body: form, actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), el("span", { class: "spacer" }), send] });
    email.control.focus();
  }
  async function resend(u) {
    if (!(await confirmDialog({ title: "Reenviar invitación", message: `Se envía de nuevo el acceso a ${u.email}. Si la persona aún no aceptó la primera invitación, su cuenta se vuelve a crear y pierde las asignaciones a eventos; tendrás que asignarla otra vez.`, confirmLabel: "Reenviar" }))) return;
    try { await repo.users.resend(u.email); toast("Invitación reenviada", "ok"); } catch (e) { toast(e.message, "danger"); }
  }
  async function toggle(u) {
    const next = u.status === "active" ? "inactive" : "active";
    if (!(await confirmDialog({ title: next === "inactive" ? "Desactivar usuario" : "Activar usuario", message: next === "inactive" ? `${u.full_name || u.email} no podrá entrar al portal ni a la app. Su cuenta y su historial se conservan.` : `${u.full_name || u.email} volverá a tener acceso.`, confirmLabel: next === "inactive" ? "Desactivar" : "Activar", danger: next === "inactive" }))) return;
    try { await repo.users.setStatus(u.id, next); toast("Usuario actualizado", "ok"); await load(true); } catch (e) { toast(e.message, "danger"); }
  }
  async function remove(u) {
    if (!(await confirmDialog({ title: "Eliminar usuario", message: `Se elimina la cuenta de ${u.full_name || u.email} y sus asignaciones. No se puede deshacer. Para conservar el acceso bloqueado, mejor desactívala.`, confirmLabel: "Eliminar cuenta", danger: true, requireText: "ELIMINAR" }))) return;
    try { await repo.users.remove(u.id); toast("Usuario eliminado", "ok"); await load(true); } catch (e) { toast(e.message, "danger"); }
  }
  function paint() {
    const q = search.value.trim().toLowerCase();
    const list = users.filter((u) => (!role.value || u.role === role.value) && (!q || (u.full_name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
    const slice = list.slice(page * PAGE, page * PAGE + PAGE);
    host.replaceChildren(card([
      dataTable({
        caption: "Usuarios de la empresa",
        columns: [
          { label: "Usuario", render: (u) => el("div", { class: "cell-stack" }, [el("strong", {}, [u.full_name || "Sin nombre", u.id === ctx.profile.id ? el("span", { class: "tag" }, "Tú") : null]), el("span", { class: "muted small" }, u.email)]) },
          { label: "Rol", render: (u) => ROLE[u.role] || u.role },
          { label: "Estado", render: (u) => pill(USTATUS[u.status]?.label || u.status, USTATUS[u.status]?.tone || "neutral") },
          { label: "Eventos asignados", class: "num", render: (u) => (u.role === "operator" ? el("a", { class: "link", href: `#/assignments/${u.id}` }, String(assignCount[u.id] ?? 0)) : el("span", { class: "muted" }, "No aplica")) },
          { label: "Alta", render: (u) => fmtDate(u.created_at) },
          { label: "", class: "col-actions", render: (u) => (u.id === ctx.profile.id ? el("span", { class: "muted small" }, "Tu cuenta") : menuButton({ label: `Acciones para ${u.full_name || u.email}`, items: [{ label: "Reenviar invitación", icon: "mail", onClick: () => resend(u) }, u.role === "operator" ? { label: "Ver asignaciones", icon: "link", onClick: () => { location.hash = `#/assignments/${u.id}`; } } : null, { label: u.status === "active" ? "Desactivar" : "Activar", icon: u.status === "active" ? "ban" : "check", onClick: () => toggle(u) }, { label: "Eliminar cuenta", icon: "trash", danger: true, onClick: () => remove(u) }] })) },
        ],
        rows: slice,
        empty: users.length ? emptyState({ icon: "search", title: "Nadie coincide", text: "Cambia la búsqueda o el filtro de rol." }) : emptyState({ icon: "users", title: "Aún no hay usuarios", text: "Invita a tu equipo por correo o genera un PIN para operadores.", action: btn({ label: "Invitar usuario", variant: "primary", icon: "mail", onClick: openInvite }) }),
      }),
      list.length ? pager({ page, pageSize: PAGE, total: list.length, shown: slice.length, onChange: (p) => { page = p; paint(); } }) : null,
    ], { cls: "card-flush" }));
  }
  async function load(silent) {
    if (!silent) host.replaceChildren(card(dataTable({ columns: [{ label: "Usuario" }, { label: "Rol" }, { label: "Estado" }, { label: "Eventos asignados" }, { label: "Alta" }, { label: "" }], rows: [], loading: true }), { cls: "card-flush" }));
    try {
      const [u, a] = await Promise.all([repo.users.list(), repo.assignments.list().catch(() => null)]);
      users = u; assignCount = {};
      for (const x of a || []) if (x.status === "active") assignCount[x.operatorId] = (assignCount[x.operatorId] || 0) + 1;
      paint();
      if (!a) host.prepend(banner({ tone: "warn", text: "No se pudieron leer las asignaciones; el conteo de eventos puede aparecer en 0." }));
    } catch (e) { host.replaceChildren(errorState({ message: e.message, retry: () => load() })); }
  }
  search.addEventListener("input", debounce(() => { page = 0; paint(); }, 150)); role.addEventListener("change", () => { page = 0; paint(); });
  void load();
}
