import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("CEDULASCAN_SERVICE_ROLE_KEY") || "";
    if (!service) throw new Error("Falta configurar el secreto CEDULASCAN_SERVICE_ROLE_KEY");
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await client.auth.getUser();
    const { data: me } = user ? await client.from("profiles").select("role,status,tenant_id,is_platform_admin").eq("id", user.id).single() : { data: null };
    if (!me || me.role !== "admin" || me.status !== "active") throw new Error("Solo administradores activos");
    const { user_id, status, role, action } = await req.json();
    const admin = createClient(url, service);
    if (!user_id) throw new Error("Solicitud inválida");
    const { data: target } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
    if (!target || (target.tenant_id !== me.tenant_id)) throw new Error("No puedes administrar una cuenta de otra empresa");
    if (action === "delete") {
      if (user_id === user.id) throw new Error("No puedes eliminar tu propio usuario");
      const { error: deleteError } = await admin.auth.admin.deleteUser(user_id);
      if (deleteError) throw deleteError;
      return new Response(JSON.stringify({ ok: true, deleted: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (!user_id || !["active", "inactive"].includes(status)) throw new Error("Solicitud inválida");
    if (user_id === user.id && status === "inactive") throw new Error("No puedes bloquear tu propio acceso");
    const { error } = await admin.from("profiles").update({ status, ...(role === "admin" || role === "operator" ? { role } : {}) }).eq("id", user_id);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "No se pudo actualizar" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
});
