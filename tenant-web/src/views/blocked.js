import { el, banner, card, pageHeader, pill } from "../lib/ui.js";
import { TENANT_STATUS, fmtDate } from "../lib/format.js";

export function renderBlocked(container, { role, tenant }) {
  const st = TENANT_STATUS[tenant?.subscription_status] || { label: "Sin estado", tone: "neutral" };
  const reason = {
    pending_payment: "La empresa fue creada pero JM ServiceTec aún no activa su membresía.",
    suspended: "La membresía fue suspendida por JM ServiceTec.",
    cancelled: "La membresía fue cancelada.",
    past_due: "La membresía tiene un pago vencido.",
  }[tenant?.subscription_status] || (tenant?.current_period_ends_at ? `El periodo contratado terminó el ${fmtDate(tenant.current_period_ends_at)}.` : "La empresa no tiene un periodo vigente.");
  container.replaceChildren(
    pageHeader({ title: "Membresía inactiva", subtitle: tenant?.name }),
    banner({ tone: "warn", title: "El acceso a los datos está pausado", text: `${reason} Mientras tanto no se pueden ver ni registrar eventos. La información guardada no se borra.` }),
    card([el("dl", { class: "defs" }, [
      el("dt", {}, "Empresa"), el("dd", {}, tenant?.name || "—"),
      el("dt", {}, "Estado"), el("dd", {}, pill(st.label, st.tone)),
      el("dt", {}, "Fin del periodo"), el("dd", {}, fmtDate(tenant?.current_period_ends_at)),
    ]), el("p", { class: "muted" }, role === "admin" ? "Escribe a JM ServiceTec para activar o renovar la membresía. Los pagos se confirman fuera del portal." : "Avisa a tu administrador. Él gestiona la membresía con JM ServiceTec.")], { cls: "card-narrow" }),
  );
}
