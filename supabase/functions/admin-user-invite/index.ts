import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

// Orígenes del portal permitidos para los enlaces (secret PORTAL_ORIGINS="https://portal.ejemplo.com,https://otro.netlify.app").
const allowedOrigins = (Deno.env.get("PORTAL_ORIGINS") || "https://coruscating-truffle-13663a.netlify.app").split(",").map((v) => v.trim()).filter(Boolean);
const FALLBACK_REDIRECT = Deno.env.get("DEFAULT_PORTAL_URL") || "https://coruscating-truffle-13663a.netlify.app/";
function safeRedirect(value: unknown): string {
  try { const u = new URL(String(value || "")); if (allowedOrigins.includes(u.origin)) return u.origin + u.pathname; } catch { /* usa el valor por defecto */ }
  return FALLBACK_REDIRECT;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!service) throw new Error("Falta configurar el secreto CEDULASCAN_SERVICE_ROLE_KEY");
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sesión requerida");
    const { data: profile } = await client.from("profiles").select("role,status,tenant_id,is_platform_admin").eq("id", user.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") throw new Error("Solo un administrador activo puede invitar usuarios");
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || "").trim().slice(0, 120);
    const role = body.role === "admin" ? "admin" : "operator";
    const redirectTo = safeRedirect(body.redirect_to);
    if (!email || !email.includes("@")) throw new Error("Correo inválido");
    const admin = createClient(url, service);
    const inviteOptions: { data: { full_name: string }; redirectTo?: string } = { data: { full_name: fullName } };
    inviteOptions.redirectTo = redirectTo; // validado contra PORTAL_ORIGINS; nunca un destino arbitrario
    let data: any;
    let error: any;
    ({ data, error } = await admin.auth.admin.inviteUserByEmail(email, inviteOptions));
    if (error && /already registered|already exists|already been registered/i.test(error.message || "")) {
      // El correo puede haber quedado creado por un intento anterior. En vez de devolver
      // 400, reutilizamos la cuenta: recuperación si ya confirmó o nueva invitación si no.
      let existing: any = null;
      for (let page = 1; page <= 5 && !existing; page++) {
        const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (listed.error) throw listed.error;
        existing = listed.data.users.find((item: any) => item.email?.toLowerCase() === email) || null;
        if (!listed.data.users.length || listed.data.users.length < 1000) break;
      }
      if (!existing) throw error;
      const { data: existingProfile } = await admin.from("profiles").select("tenant_id").eq("id", existing.id).maybeSingle();
      if (!existingProfile || existingProfile.tenant_id !== profile.tenant_id) throw new Error("Ese correo ya pertenece a otra empresa");
      if (existing.email_confirmed_at) {
        const recovery = await admin.auth.resetPasswordForEmail(email, { redirectTo });
        if (recovery.error) throw recovery.error;
        return new Response(JSON.stringify({ ok: true, id: existing.id, email, mode: "recovery" }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      await admin.auth.admin.deleteUser(existing.id);
      ({ data, error } = await admin.auth.admin.inviteUserByEmail(email, inviteOptions));
    }
    if (error) throw error;
    if (data.user) await admin.from("profiles").update({ full_name: fullName, role, status: "active", tenant_id: profile.tenant_id, is_platform_admin: false }).eq("id", data.user.id);
    return new Response(JSON.stringify({ ok: true, id: data.user?.id, email }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo invitar";
    console.error(`[admin-user-invite] ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
