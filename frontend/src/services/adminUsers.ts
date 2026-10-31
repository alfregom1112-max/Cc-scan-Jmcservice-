import { supabase } from "@/src/utils/supabase";

export type ManagedUser = { id: string; email: string; full_name: string; role: "admin" | "operator"; status: "active" | "inactive"; created_at: string };

export async function listManagedUsers(tenantId: string): Promise<ManagedUser[]> {
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,role,status,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as ManagedUser[];
}

export async function inviteManagedUser(role: "admin" | "operator") {
  const { data, error } = await supabase.functions.invoke("admin-user-pin-create", {
    body: { role },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateManagedUser(userId: string, status: "active" | "inactive", role?: "admin" | "operator") {
  const { data, error } = await supabase.functions.invoke("admin-user-status", { body: { user_id: userId, status, role } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function deleteManagedUser(userId: string) {
  const { data, error } = await supabase.functions.invoke("admin-user-status", { body: { user_id: userId, action: "delete" } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function resendManagedInvite(email: string) {
  const { data, error } = await supabase.functions.invoke("admin-user-resend", { body: { email } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
