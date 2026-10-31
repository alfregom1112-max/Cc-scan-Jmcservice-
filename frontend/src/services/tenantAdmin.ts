import { supabase } from "@/src/utils/supabase";

export type TenantRecord = {
  id: string; name: string; slug: string; brand_name: string; billing_period: "monthly" | "annual";
  subscription_status: "internal" | "trial" | "pending_payment" | "active" | "past_due" | "suspended" | "cancelled";
  price_cop: number | null; current_period_starts_at: string | null; current_period_ends_at: string | null; created_at: string;
};

export async function listTenants(): Promise<TenantRecord[]> {
  const { data, error } = await supabase.from("tenants")
    .select("id,name,slug,brand_name,billing_period,subscription_status,price_cop,current_period_starts_at,current_period_ends_at,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as TenantRecord[];
}

export async function createTenant(input: { name: string; owner_email: string; billing_period: "monthly" | "annual"; price_cop?: number | null }) {
  const { data, error } = await supabase.functions.invoke("platform-tenant-create", { body: input });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { tenant: TenantRecord; owner_email: string; pin: string; expires_in_minutes: number };
}

export async function updateTenantSubscription(tenantId: string, action: "activate" | "renew" | "suspend" | "cancel" | "pending") {
  const { data, error } = await supabase.functions.invoke("platform-tenant-update", { body: { tenant_id: tenantId, action } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.tenant as TenantRecord;
}
