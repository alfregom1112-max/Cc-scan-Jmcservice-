import { el, btn, kpi, kpiSkeleton, card, pageHeader, barList, dataTable, emptyState, errorState, banner, pill } from "../lib/ui.js";
import { repo } from "../lib/repo.js";
import { TENANT_STATUS, fmtDate, relativeDays, daysUntil, fmtNumber } from "../lib/format.js";

export function renderPlatformDashboard(container) {
  const body = el("div", { class: "stack-lg" });
  const refresh = btn({ label: "Actualizar", icon: "refresh", onClick: () => load() });
  container.replaceChildren(pageHeader({ title: "Resumen de la plataforma", subtitle: "Empresas clientes y estado de sus membresías, calculado con los datos actuales.", actions: [refresh, btn({ label: "Ver empresas", icon: "building", variant: "primary", href: "#/companies" })] }), body);

  async function load() {
    body.replaceChildren(kpiSkeleton(4));
    let tenants;
    try { tenants = await repo.tenants.list(); }
    catch (e) { body.replaceChildren(errorState({ message: e.message, retry: load })); return; }
    const now = Date.now();
    const customers = tenants.filter((t) => t.subscription_status !== "internal");
    const count = (s) => customers.filter((t) => t.subscription_status === s).length;
    const live = customers.filter((t) => ["active", "trial"].includes(t.subscription_status) && t.current_period_ends_at && new Date(t.current_period_ends_at) > now);
    const expiring = live.filter((t) => daysUntil(t.current_period_ends_at) <= 30).sort((a, b) => new Date(a.current_period_ends_at) - new Date(b.current_period_ends_at));
    const lapsed = customers.filter((t) => ["active", "trial"].includes(t.subscription_status) && t.current_period_ends_at && new Date(t.current_period_ends_at) <= now);

    const attention = [];
    if (lapsed.length) attention.push(banner({ tone: "danger", title: `${lapsed.length} ${lapsed.length === 1 ? "empresa tiene" : "empresas tienen"} el periodo vencido`, text: "Su estado sigue «activa» o «prueba», pero la fecha de fin ya pasó: el acceso de sus usuarios está bloqueado. Renueva o suspende desde Empresas.", action: btn({ label: "Revisar", href: "#/companies", small: true }) }));

    const kpis = el("div", { class: "kpi-grid" }, [
      kpi({ label: "Empresas cliente", value: fmtNumber(customers.length), note: "Sin contar la empresa interna." }),
      kpi({ label: "Con membresía vigente", value: fmtNumber(live.length), note: "Activas o en prueba con fecha de fin futura." }),
      kpi({ label: "Vencen en 30 días", value: fmtNumber(expiring.length), note: "Desde hoy hasta 30 días." , tone: expiring.length ? "warn" : undefined }),
      kpi({ label: "Pendientes de activación", value: fmtNumber(count("pending_payment")), note: "Creadas, aún sin activar." }),
    ]);
    const chart = card(barList(Object.entries(TENANT_STATUS).filter(([k]) => k !== "internal").map(([k, v]) => ({ label: v.label, value: count(k), tone: v.tone })), { emptyText: "Aún no hay empresas cliente." }), { title: "Empresas por estado", subtitle: "Conteo actual. No es una serie histórica: el sistema no guarda historial de estados." });
    const due = card(dataTable({
      caption: "Próximos vencimientos",
      columns: [
        { label: "Empresa", render: (t) => el("strong", {}, t.name) },
        { label: "Estado", render: (t) => pill(TENANT_STATUS[t.subscription_status].label, TENANT_STATUS[t.subscription_status].tone) },
        { label: "Periodo", render: (t) => (t.billing_period === "annual" ? "Anual" : "Mensual") },
        { label: "Vence", render: (t) => el("span", {}, [fmtDate(t.current_period_ends_at), el("span", { class: "muted" }, ` · ${relativeDays(t.current_period_ends_at)}`)]) },
      ],
      rows: expiring,
      empty: emptyState({ icon: "check", title: "Sin vencimientos próximos", text: "Ninguna membresía vigente termina en los próximos 30 días." }),
    }), { title: "Vencimientos en los próximos 30 días", cls: "card-flush" });
    const unavailable = card(el("ul", { class: "plain-list" }, [
      el("li", {}, "Usuarios, eventos y registros por empresa: el superadministrador no puede leerlos (RLS por empresa) y la API no expone totales por empresa."),
      el("li", {}, "Ingresos o pagos: el portal no cobra ni conoce pagos; las membresías se activan a mano."),
    ]), { title: "No disponible", subtitle: "Cifras que hoy no existen en ningún contrato real y por eso no se muestran." });
    body.replaceChildren(...attention, kpis, el("div", { class: "grid-2" }, [chart, unavailable]), due);
  }
  void load();
}
