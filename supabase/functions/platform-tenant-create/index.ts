import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" } });
const encoder = new TextEncoder();

function makePin(): string {
  const sample = new Uint32Array(1);
  const ceiling = Math.floor(0x1_0000_0000 / 900_000) * 900_000;
  do crypto.getRandomValues(sample); while (sample[0] >= ceiling);
  return String(100_000 + sample[0] % 900_000);
}
async function digestPin(pin: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // Keep the same HMAC namespace as activate-user-pin so the owner can redeem it.
  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(`cedulascan-pin-v1:${pin}`));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
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
    if (!caller) return json({ error: "Inicia sesión como administrador de JM ServiceTec" }, 401);
    const { data: callerProfile } = await client.from("profiles").select("role,status,is_platform_admin").eq("id", caller.id).single();
    if (!callerProfile?.is_platform_admin || callerProfile.role !== "admin" || callerProfile.status !== "active") return json({ error: "Solo la administración de JM ServiceTec puede crear empresas" }, 403);

    const body = await req.json();
    const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const email = String(body.owner_email || "").trim().toLowerCase();
    const billingPeriod = body.billing_period === "annual" ? "annual" : body.billing_period === "monthly" ? "monthly" : "";
    const price = body.price_cop === null || body.price_cop === undefined || body.price_cop === "" ? null : Number(body.price_cop);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !billingPeriod || (price !== null && (!Number.isSafeInteger(price) || price < 0))) {
      return json({ error: "Revisa el nombre, correo, periodo y valor mensual/anual" }, 400);
    }
    const admin = createClient(url, service);
    const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existingProfile) return json({ error: "Ese correo ya tiene una cuenta. Usa otro correo para el administrador de esta empresa." }, 409);
    const slug = `${slugify(name) || "empresa"}-${crypto.randomUUID().slice(0, 6)}`;
    const { data: tenant, error: tenantError } = await admin.from("tenants").insert({
      name, slug, brand_name: name, billing_period: billingPeriod, subscription_status: "pending_payment", price_cop: price, created_by: caller.id,
    }).select("id,name,slug,billing_period,subscription_status,price_cop,current_period_ends_at,created_at").single();
    if (tenantError || !tenant) throw new Error("No se pudo crear la empresa");
    const pin = makePin();
    const pinHash = await digestPin(pin, service);
    const { error: inviteError } = await admin.from("account_pin_invites").insert({
      email, full_name: "", role: "admin", pin_hash: pinHash, created_by: caller.id, tenant_id: tenant.id,
    });
    if (inviteError) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      throw new Error("La empresa no se creó porque no fue posible generar el PIN de acceso");
    }
    await admin.from("audit_log").insert({
      tenant_id: tenant.id, actor_id: caller.id, action: "tenant_created", entity_type: "tenant", entity_id: tenant.id,
      details: { tenant_name: name, billing_period: billingPeriod, status: "pending_payment" },
    });
    return json({ ok: true, tenant, owner_email: email, pin, expires_in_minutes: 30, subscription_status: "pending_payment" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo crear la empresa" }, 400);
  }
});
