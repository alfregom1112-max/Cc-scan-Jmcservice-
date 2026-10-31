import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!service) throw new Error("Falta configurar CEDULASCAN_SERVICE_ROLE_KEY");
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user: caller } } = await client.auth.getUser();
    if (!caller) throw new Error("Sesión requerida");
    const { data: profile } = await client.from("profiles").select("role,status,tenant_id,is_platform_admin").eq("id", caller.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") throw new Error("Solo un administrador activo puede reenviar invitaciones");
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Correo inválido");
    const admin = createClient(url, service);
    let found: any = null;
    for (let page = 1; page <= 5 && !found; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      found = data.users.find((item: any) => item.email?.toLowerCase() === email) || null;
      if (!data.users.length || data.users.length < 1000) break;
    }
    if (!found) throw new Error("No existe una invitación pendiente para ese correo");
    const { data: targetProfile } = await admin.from("profiles").select("tenant_id").eq("id", found.id).maybeSingle();
    if (!targetProfile || targetProfile.tenant_id !== profile.tenant_id) throw new Error("No puedes reenviar invitaciones de otra empresa");
    if (found.email_confirmed_at) {
      const { error: recoveryError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: "https://jmservicetec.com/accept-invite.html",
      });
      if (recoveryError) throw recoveryError;
      return new Response(JSON.stringify({ ok: true, email, mode: "recovery" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    const { data: profileData } = await admin.from("profiles").select("full_name").eq("id", found.id).single();
    await admin.auth.admin.deleteUser(found.id);
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: profileData?.full_name || found.user_metadata?.full_name || "" },
      redirectTo: "https://jmservicetec.com/accept-invite.html",
    });
    if (inviteError) throw inviteError;
    if (invited.user) {
      await admin.from("profiles").update({ full_name: profileData?.full_name || "", status: "active" }).eq("id", invited.user.id);
    }
    return new Response(JSON.stringify({ ok: true, email }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reenviar";
    console.error(`[admin-user-resend] ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
