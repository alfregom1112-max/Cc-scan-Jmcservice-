import { el, btn, card, pageHeader, dataTable, emptyState, errorState, pill, field, input, select, formMessage, setMessage, withBusy, openDialog, confirmDialog, secretDialog, toast, debounce, menuButton, banner } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { TENANT_STATUS, fmtDate, fmtMoney, relativeDays, membershipActive } from "../lib/format.js";

const ACTIONS = {
  activate: { label: "Activar membresía", text: "Confirma que recibiste el pago fuera del portal. Se activará la empresa y empezará un periodo nuevo desde hoy. El portal no cobra nada." },
  renew: { label: "Renovar periodo", text: "Confirma que recibiste el pago fuera del portal. Si el periodo sigue vigente, el nuevo se suma al final; si ya venció, cuenta desde hoy." },
  suspend: { label: "Suspender", text: "Los usuarios de la empresa pierden acceso hasta que la actives de nuevo. Los registros guardados no se borran.", danger: true },
  cancel: { label: "Cancelar membresía", text: "La membresía queda cancelada y los usuarios pierden acceso. Los registros guardados no se borran.", danger: true },
};

export function renderCompanies(container) {
  const tableHost = el("div", {});
  let tenants = [];
  const search = input({ type: "search", placeholder: "Buscar empresa", "aria-label": "Buscar empresa" });
  const status = select([{ value: "", label: "Todos los estados" }, ...Object.entries(TENANT_STATUS).map(([v, s]) => ({ value: v, label: s.label }))], { "aria-label": "Filtrar por estado" });
  const create = btn({ label: "Nueva empresa", icon: "plus", variant: "primary", onClick: openCreate });
  container.replaceChildren(
    pageHeader({ title: "Empresas", subtitle: "Administra empresas, planes mensuales y anuales, y cupos de operación.", actions: [btn({ label: "Actualizar", icon: "refresh", onClick: () => load() }), create] }),
    banner({ tone: "info", text: "Activar o renovar desde estas acciones registra un pago confirmado manualmente. Los pagos de la página pública se consultan en Ventas y pagos." }),
    el("div", { class: "toolbar" }, [el("div", { class: "toolbar-search" }, [search]), status]),
    tableHost,
  );

  function paint() {
    const q = search.value.trim().toLowerCase();
    const rows = tenants.filter((t) => (!status.value || t.subscription_status === status.value) && (!q || t.name.toLowerCase().includes(q) || t.slug.includes(q)));
    tableHost.replaceChildren(card(dataTable({
      caption: "Empresas registradas",
      columns: [
        { label: "Empresa", render: (t) => el("div", { class: "cell-stack" }, [el("strong", {}, t.name), el("span", { class: "muted small" }, t.slug)]) },
        { label: "Estado", render: (t) => { const s = TENANT_STATUS[t.subscription_status] || { label: t.subscription_status, tone: "neutral" }; return pill(membershipActive(t) || t.subscription_status === "internal" ? s.label : (["active", "trial"].includes(t.subscription_status) ? `${s.label} · vencida` : s.label), ["active", "trial"].includes(t.subscription_status) && !membershipActive(t) ? "danger" : s.tone); } },
        { label: "Plan y cupos", render: (t) => el("div", { class: "cell-stack" }, [el("strong", {}, t.billing_mode === "per_event" ? "Por evento" : t.billing_mode === "internal" ? "Interna" : t.billing_mode === "lifetime" ? "Licencia permanente" : t.billing_period === "annual" ? "Anual" : "Mensual"), el("span", { class: "muted small" }, t.subscription_plan_id ? `${t.subscription_events_used || 0} / ${t.subscription_event_limit} eventos · hasta ${t.subscription_operator_limit} operadores por evento` : "Sin cupo de membresía asignado")]) },
        { label: "Valor acordado", render: (t) => el("span", { class: t.price_cop == null ? "muted" : "" }, fmtMoney(t.price_cop)) },
        { label: "Vence", render: (t) => (t.subscription_status === "internal" ? el("span", { class: "muted" }, "No vence") : t.current_period_ends_at ? el("span", {}, [fmtDate(t.current_period_ends_at), el("span", { class: "muted small" }, ` · ${relativeDays(t.current_period_ends_at)}`)]) : el("span", { class: "muted" }, "Sin periodo")) },
        { label: "Acciones", class: "col-actions", render: actionsFor },
      ],
      rows,
      empty: tenants.length ? emptyState({ icon: "search", title: "Ninguna empresa coincide", text: "Cambia la búsqueda o el filtro de estado." }) : emptyState({ icon: "building", title: "Aún no hay empresas", text: "Crea la primera empresa cliente para generar el PIN de su administrador.", action: btn({ label: "Nueva empresa", icon: "plus", variant: "primary", onClick: openCreate }) }),
    }), { cls: "card-flush" }));
  }

  function actionsFor(t) {
    const s = t.subscription_status;
    if (s === "internal") return el("span", { class: "muted small" }, "Empresa interna");
    const run = (a) => () => change(t, a);
    const primary = ["pending_payment", "suspended", "cancelled", "past_due"].includes(s) ? btn({ label: "Activar", small: true, variant: "primary", onClick: run("activate") }) : btn({ label: "Renovar", small: true, onClick: run("renew") });
    const more = [{ label: t.subscription_plan_id ? "Cambiar plan" : "Asignar membresía", icon: "calendar", onClick: () => openPlan(t) }];
    if (["active", "trial", "past_due"].includes(s)) more.push({ label: "Suspender", icon: "ban", onClick: run("suspend"), danger: true });
    if (s !== "cancelled") more.push({ label: "Cancelar membresía", icon: "x", onClick: run("cancel"), danger: true });
    more.push({label:"Enviar a papelera",icon:"trash",danger:true,onClick:()=>trash(t)});
    return el("div", { class: "row-actions" }, [primary, more.length ? menuButton({ label: `Más acciones para ${t.name}`, items: more }) : null]);
  }

  async function trash(t) {
    if (!(await confirmDialog({title:`Enviar ${t.name} a papelera`,message:"Se suspenderá el acceso de esta empresa. Se conservan sus pagos, usuarios y eventos. Restaurarla no renueva su membresía.",confirmLabel:"Enviar a papelera",danger:true}))) return;
    try { await repo.trash.move("tenants",t.id); await load(true); } catch(e) { toast(e.message,"danger"); }
  }
  async function change(t, action) {
    const a = ACTIONS[action];
    if (!(await confirmDialog({ title: `${a.label}: ${t.name}`, message: a.text, confirmLabel: a.label, danger: a.danger }))) return;
    try { await repo.tenants.update(t.id, action); toast("Membresía actualizada", "ok"); await load(true); }
    catch (e) { toast(e.message, "danger"); }
  }

  function planOptions(plans) {
    return plans.map((p) => ({ value: p.id, label: `${p.billing_period === "annual" ? "Anual" : "Mensual"} · hasta ${p.operators_limit} operadores · ${p.included_events} eventos · ${fmtMoney(p.price_cop)}` }));
  }

  async function openPlan(t) {
    try {
      const plans = await repo.tenants.plans();
      if (!plans.length) throw new Error("No hay planes disponibles. Revisa el catálogo de membresías en Supabase.");
      const plan = field({ label: "Membresía", control: select(planOptions(plans)) });
      if (t.subscription_plan_id) plan.control.value = t.subscription_plan_id;
      const msg = formMessage();
      const save = btn({ label: "Asignar plan", variant: "primary", onClick: async () => {
        try {
          await withBusy(save, () => repo.tenants.update(t.id, "set_plan", { plan_id: plan.control.value }), "Guardando");
          ref.close(); await load(true); toast("Plan asignado. Confirma el pago y activa la membresía.", "ok");
        } catch (e) { setMessage(msg, e.message); }
      } });
      const ref = openDialog({ title: `Plan de ${t.name}`, description: "El cambio deja la membresía pendiente de pago, reinicia el cupo y pausa la operación hasta su activación.", body: el("div", { class: "stack" }, [plan.root, msg]), actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), save] });
    } catch (e) { toast(e.message, "danger"); }
  }

  async function openCreate() {
    let plans;
    try { plans = await repo.tenants.plans(); }
    catch (e) { toast(e.message, "danger"); return; }
    const name = field({ label: "Nombre de la empresa", required: true, control: input({ maxlength: 120, required: true, autocomplete: "off" }) });
    const email = field({ label: "Correo del administrador", required: true, hint: "Recibirá el PIN de activación. No puede tener una cuenta existente.", control: input({ type: "email", required: true, autocomplete: "off" }) });
    const mode = field({ label: "Modalidad", control: select([{ value: "subscription", label: "Membresía mensual o anual" }, { value: "per_event", label: "Pago por evento" }]) });
    const plan = field({ label: "Plan", control: select(planOptions(plans)), hint: "El cupo y el precio se asignan desde el catálogo. La membresía empieza al confirmar el pago." });
    mode.control.addEventListener("change", () => { plan.root.hidden = mode.control.value !== "subscription"; });
    const msg = formMessage();
    const submit = btn({ label: "Crear empresa y generar PIN", variant: "primary" });
    const form = el("form", { class: "stack", novalidate: true, onSubmit: async (e) => {
      e.preventDefault(); setMessage(msg, ""); [name, email, plan].forEach((x) => x.setError(""));
      let bad = null;
      if (name.control.value.trim().length < 2) { name.setError("Escribe el nombre (mínimo 2 caracteres)."); bad ||= name; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.control.value.trim())) { email.setError("Escribe un correo válido."); bad ||= email; }
      if (mode.control.value === "subscription" && !plan.control.value) { plan.setError("Selecciona un plan disponible."); bad ||= plan; }
      if (bad) { bad.control.focus(); return; }
      try {
        const res = await withBusy(submit, () => repo.tenants.create({ name: name.control.value.trim(), ownerEmail: email.control.value.trim(), billingMode: mode.control.value, planId: mode.control.value === "subscription" ? plan.control.value : null }), "Creando");
        ref.close(); await load(true);
        secretDialog({ title: "Empresa creada", description: `PIN para ${res.owner_email}. Entrégaselo por un canal seguro.`, secret: res.pin, expiresMinutes: res.expires_in_minutes, note: "El administrador lo usa en «Tengo un PIN de activación». Vence a los 30 minutos y no se puede volver a ver. La empresa queda pendiente hasta que actives su membresía." });
      } catch (err) { setMessage(msg, err.message); }
    } }, [name.root, email.root, mode.root, plan.root, msg]);
    const ref = openDialog({ title: "Nueva empresa", description: "Se crea pendiente de activación y se genera un PIN para su administrador.", body: form, actions: [btn({ label: "Cancelar", variant: "ghost", onClick: () => ref.close() }), el("span", { class: "spacer" }), submit] });
    submit.addEventListener("click", () => form.requestSubmit());
    name.control.focus();
  }

  async function load(silent = false) {
    if (!silent) tableHost.replaceChildren(card(dataTable({ columns: [{ label: "Empresa" }, { label: "Estado" }, { label: "Periodo" }, { label: "Valor acordado" }, { label: "Vence" }, { label: "Acciones" }], rows: [], loading: true }), { cls: "card-flush" }));
    try { tenants = await repo.tenants.list(); paint(); }
    catch (e) { tableHost.replaceChildren(errorState({ message: e.message, retry: () => load() })); }
  }
  search.addEventListener("input", debounce(paint, 150)); status.addEventListener("change", paint);
  void load();
}
