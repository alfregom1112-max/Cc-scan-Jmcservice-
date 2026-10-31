import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" } });
function addPeriod(from: Date, period: "monthly" | "annual"): Date {
  const next = new Date(from);
  if (period === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!url || !anon || !service) return json({ error: "Falta configuración segura de Supabase" }, 503);
    const auth = req.headers.get("Authorization") || "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user: caller } } = await client.auth.getUser();
    if (!caller) return json({ error: "Inicia sesión" }, 401);
    const { data: profile } = await client.from("profiles").select("role,status,is_platform_admin").eq("id", caller.id).single();
    if (!profile?.is_platform_admin || profile.role !== "admin" || profile.status !== "active") return json({ error: "Solo JM ServiceTec puede cambiar membresías" }, 403);
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const action = String(body.action || "");
    if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !["activate", "renew", "suspend", "cancel", "pending"].includes(action)) return json({ error: "Solicitud inválida" }, 400);
    const admin = createClient(url, service);
    const { data: tenant, error: readError } = await admin.from("tenants").select("id,name,billing_period,subscription_status,current_period_starts_at,current_period_ends_at").eq("id", tenantId).single();
    if (readError || !tenant) return json({ error: "No se encontró la empresa" }, 404);
    const now = new Date();
    const patch: Record<string, unknown> = { updated_at: now.toISOString() };
    if (action === "activate" || action === "renew") {
      patch.subscription_status = "active";
      const currentEnd = tenant.current_period_ends_at ? new Date(tenant.current_period_ends_at) : null;
      const starts = action === "renew" && currentEnd && currentEnd > now ? currentEnd : now;
      if (action === "activate" || !tenant.current_period_starts_at) patch.current_period_starts_at = now.toISOString();
      patch.current_period_ends_at = addPeriod(starts, tenant.billing_period).toISOString();
    } else {
      patch.subscription_status = action === "suspend" ? "suspended" : action === "cancel" ? "cancelled" : "pending_payment";
    }
    const { data: updated, error } = await admin.from("tenants").update(patch).eq("id", tenantId)
      .select("id,name,billing_period,subscription_status,current_period_starts_at,current_period_ends_at,price_cop").single();
    if (error || !updated) throw new Error("No se pudo guardar la membresía");
    await admin.from("audit_log").insert({
      tenant_id: tenantId, actor_id: caller.id, action: `subscription_${action}`, entity_type: "tenant_subscription", entity_id: tenantId,
      details: { billing_period: updated.billing_period, current_period_ends_at: updated.current_period_ends_at },
    });
    return json({ ok: true, tenant: updated });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo actualizar la membresía" }, 400);
  }
});
