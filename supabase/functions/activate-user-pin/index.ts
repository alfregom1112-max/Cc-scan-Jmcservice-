import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const jsonHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pinDigest(pin: string, serverSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(serverSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`cedulascan-pin-v1:${pin}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let admin: ReturnType<typeof createClient> | null = null;
  let reservationId: string | null = null;
  let createdUserId: string | null = null;
  let completed = false;
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: jsonHeaders });
  try {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 8_192) throw new Error("invalid_request");
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!service) throw new Error("service_unavailable");
    const body = await req.json();
    const pin = String(body.pin || "").replace(/\D/g, "");
    const requestedEmail = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const password = String(body.password || "");
    if (!/^\d{6}$/.test(pin) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail) || requestedEmail.length > 254 || !fullName || password.length < 8 || password.length > 128) {
      throw new Error("invalid_request");
    }

    admin = createClient(url, service);
    const ip = req.headers.get("cf-connecting-ip") || "unknown-client";
    const [ipHash, emailHash] = await Promise.all([
      sha256(`cedulascan-activation-ip-v1:${ip}`),
      sha256(`cedulascan-activation-email-v1:${requestedEmail}`),
    ]);
    const { data: withinLimit, error: limitError } = await admin.rpc("check_pin_activation_rate_limit", {
      p_ip_hash: ipHash, p_email_hash: emailHash,
    });
    if (limitError) throw new Error("rate_limit_unavailable");
    if (!withinLimit) return new Response(JSON.stringify({ error: "Demasiados intentos. Espera un tiempo e inténtalo de nuevo." }), { status: 429, headers: { ...jsonHeaders, "Retry-After": "900" } });

    const digest = await pinDigest(pin, service);
    reservationId = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("claim_account_pin", {
      p_pin_hash: digest, p_reservation_id: reservationId,
    });
    if (claimError) throw new Error("activation_failed");
    const invite = Array.isArray(claimed) ? claimed[0] : null;
    if (!invite || !["operator", "admin"].includes(invite.assigned_role)) throw new Error("activation_failed");
    const { data: inviteTenant, error: tenantError } = await admin.from("account_pin_invites").select("tenant_id,email").eq("id", invite.invite_id).single();
    if (tenantError || !inviteTenant?.tenant_id || (inviteTenant.email && inviteTenant.email !== "pending@cedulascan.local" && inviteTenant.email.toLowerCase() !== requestedEmail)) throw new Error("activation_failed");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: requestedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) throw new Error("activation_failed");
    createdUserId = created.user.id;

    const { error: profileError } = await admin.from("profiles").upsert({
      id: createdUserId, email: requestedEmail, full_name: fullName, role: invite.assigned_role, status: "active", tenant_id: inviteTenant.tenant_id, is_platform_admin: false,
    });
    if (profileError) throw new Error("activation_failed");

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_account_pin_claim", { p_reservation_id: reservationId });
    if (finalizeError || finalized !== true) throw new Error("activation_failed");

    completed = true;
    return new Response(JSON.stringify({ ok: true, email: requestedEmail, full_name: fullName }), { headers: jsonHeaders });
  } catch {
    if (admin && reservationId && !completed) {
      try { await admin.rpc("release_account_pin_claim", { p_reservation_id: reservationId }); } catch { /* keep response generic */ }
    }
    if (admin && createdUserId && !completed) {
      try { await admin.auth.admin.deleteUser(createdUserId); } catch { /* best-effort cleanup */ }
    }
    return new Response(JSON.stringify({ error: "No se pudo activar la cuenta. Verifica el PIN, el correo y la contraseña e inténtalo de nuevo." }), { status: 400, headers: jsonHeaders });
  }
});
