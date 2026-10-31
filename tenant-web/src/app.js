import { createClient } from "@supabase/supabase-js";

const config = window.JM_CONFIG;
if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error("Falta configurar el portal de JM ServiceTec");
const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = (id) => document.getElementById(id);
const statusLabels = { internal: "Interna", trial: "Prueba", pending_payment: "Pendiente de pago", active: "Activa", past_due: "Pago vencido", suspended: "Suspendida", cancelled: "Cancelada" };
let currentPin = "";

function message(node, text = "", success = false) { node.textContent = text; node.classList.toggle("success", success); }
function money(value) { return value == null ? "Precio por definir" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value); }
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message || "No se pudo completar la operación");
  if (data?.error) throw new Error(data.error);
  return data;
}
async function ensurePlatformAdmin(user) {
  const { data, error } = await supabase.from("profiles").select("role,status,is_platform_admin").eq("id", user.id).single();
  if (error) throw error;
  return data?.role === "admin" && data.status === "active" && data.is_platform_admin === true;
}
async function renderTenants() {
  const list = $("tenant-list");
  list.replaceChildren();
  const { data, error } = await supabase.from("tenants").select("id,name,slug,billing_period,subscription_status,price_cop,current_period_ends_at,created_at").order("created_at", { ascending: false });
  if (error) throw error;
  if (!data?.length) { list.innerHTML = '<p class="empty">Todavía no hay empresas registradas.</p>'; return; }
  for (const tenant of data) {
    const card = document.createElement("article");
    card.className = "tenant-card";
    const active = ["active", "internal", "trial"].includes(tenant.subscription_status) && (!tenant.current_period_ends_at || new Date(tenant.current_period_ends_at) > new Date());
    const periodEnd = tenant.current_period_ends_at ? new Date(tenant.current_period_ends_at).toLocaleDateString("es-CO") : "Sin periodo activo";
    const canActivate = ["pending_payment", "suspended", "cancelled", "past_due"].includes(tenant.subscription_status);
    card.innerHTML = `<div class="tenant-top"><div><div class="tenant-name">${safeText(tenant.name)}</div><div class="tenant-meta">${tenant.billing_period === "annual" ? "Anual" : "Mensual"} · ${money(tenant.price_cop)} · ${safeText(periodEnd)}</div><div class="tenant-meta">${safeText(tenant.slug)}</div></div><span class="pill ${active ? "active" : ""}">${safeText(statusLabels[tenant.subscription_status] || tenant.subscription_status)}</span></div><div class="actions"></div>`;
    const actions = card.querySelector(".actions");
    if (canActivate) actions.append(button("Activar", () => change(tenant.id, "activate")));
    if (active) actions.append(button("Renovar", () => change(tenant.id, "renew")), button("Suspender", () => change(tenant.id, "suspend")), button("Cancelar", () => change(tenant.id, "cancel")));
    list.append(card);
  }
}
function button(label, handler) { const element = document.createElement("button"); element.className = "secondary"; element.type = "button"; element.textContent = label; element.addEventListener("click", handler); return element; }
async function change(tenantId, action) {
  const messages = { activate: "Activa la membresía solo después de confirmar el pago.", renew: "Renueva después de confirmar el pago.", suspend: "La empresa perderá acceso de sincronización. Los registros almacenados no se borran.", cancel: "La membresía se cancelará. Los registros almacenados no se borran." };
  if (!window.confirm(messages[action])) return;
  try { await invoke("platform-tenant-update", { tenant_id: tenantId, action }); await renderTenants(); }
  catch (error) { window.alert(error.message); }
}
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  const loggedIn = Boolean(data.session);
  $("login").hidden = loggedIn;
  $("app").hidden = !loggedIn;
  if (!loggedIn) return;
  $("workspace").hidden = true;
  $("access-denied").hidden = true;
  try {
    const allowed = await ensurePlatformAdmin(data.session.user);
    if (!allowed) { $("access-denied").hidden = false; return; }
    $("workspace").hidden = false;
    await renderTenants();
  } catch (error) { message($("tenant-message"), error.message); }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  message($("login-message"));
  const { error } = await supabase.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
  if (error) { message($("login-message"), error.message); return; }
  await refreshSession();
});
$("logout").addEventListener("click", async () => { await supabase.auth.signOut(); await refreshSession(); });
$("refresh").addEventListener("click", () => renderTenants().catch((error) => message($("tenant-message"), error.message)));
$("tenant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  message($("tenant-message"));
  const priceText = $("price-cop").value.trim();
  try {
    const result = await invoke("platform-tenant-create", {
      name: $("tenant-name").value.trim(), owner_email: $("owner-email").value.trim(),
      billing_period: $("billing-period").value, price_cop: priceText ? Number(priceText) : null,
    });
    currentPin = result.pin;
    $("pin-value").textContent = currentPin;
    $("pin-dialog").showModal();
    $("tenant-form").reset();
    await renderTenants();
  } catch (error) { message($("tenant-message"), error.message); }
});
$("close-pin").addEventListener("click", () => $("pin-dialog").close());
$("copy-pin").addEventListener("click", async () => {
  await navigator.clipboard.writeText(currentPin);
  $("copy-pin").textContent = "Copiado";
  setTimeout(() => { $("copy-pin").textContent = "Copiar PIN"; }, 1500);
});
supabase.auth.onAuthStateChange(() => { void refreshSession(); });
void refreshSession();
