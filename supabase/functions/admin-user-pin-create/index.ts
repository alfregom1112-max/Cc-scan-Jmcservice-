import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const jsonHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const encoder = new TextEncoder();

function randomPin(): string {
  const ceiling = Math.floor(0x1_0000_0000 / 900_000) * 900_000;
  const sample = new Uint32Array(1);
  do crypto.getRandomValues(sample); while (sample[0] >= ceiling);
  return String(100_000 + (sample[0] % 900_000));
}

async function pinDigest(pin: string, serverSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(serverSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`cedulascan-pin-v1:${pin}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: jsonHeaders });
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!service) throw new Error("service_unavailable");
    const auth = req.headers.get("Authorization") || "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user: caller } } = await client.auth.getUser();
    if (!caller) throw new Error("not_authorized");
    const { data: callerProfile } = await client.from("profiles").select("role,status,tenant_id").eq("id", caller.id).single();
    if (!callerProfile || callerProfile.role !== "admin" || callerProfile.status !== "active") throw new Error("not_authorized");
    const admin = createClient(url, service);
    const { data: tenant } = await client.from("tenants").select("subscription_status,current_period_ends_at").eq("id", callerProfile.tenant_id).single();
    const membershipActive = tenant?.subscription_status === "internal" || ((tenant?.subscription_status === "active" || tenant?.subscription_status === "trial") && !!tenant.current_period_ends_at && new Date(tenant.current_period_ends_at) > new Date());
    if (!membershipActive) throw new Error("membership_inactive");
    const pin = randomPin();
    const pinHash = await pinDigest(pin, service);
    const { error: revokeError } = await admin.from("account_pin_invites").update({ used_at: new Date().toISOString(), reservation_id: null, reserved_at: null, claim_expires_at: null }).is("used_at", null).eq("created_by", caller.id).eq("tenant_id", callerProfile.tenant_id);
    if (revokeError) throw new Error("pin_create_failed");
    const { error: insertError } = await admin.from("account_pin_invites").insert({ email: "pending@cedulascan.local", full_name: "", role: "operator", pin_hash: pinHash, created_by: caller.id, tenant_id: callerProfile.tenant_id });
    if (insertError) throw new Error("pin_create_failed");
    return new Response(JSON.stringify({ ok: true, role: "operator", pin, expires_in_minutes: 30 }), { headers: jsonHeaders });
  } catch {
    return new Response(JSON.stringify({ error: "No se pudo generar el PIN. Inicia sesión como administrador e inténtalo de nuevo." }), { status: 400, headers: jsonHeaders });
  }
});
