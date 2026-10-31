import { supabase, requireSupabaseConfig } from "@/src/utils/supabase";
import { withScanDeadline } from "@/src/utils/scanDeadline";
import { railwayRequest } from "@/src/services/railwayApi";

function fail(error: { message: string; code?: string }): never {
  const err = new Error(error.message) as Error & { status?: number; detail?: unknown };
  // Supabase's fetch failures commonly have no Postgres/PostgREST code. Keep
  // them distinguishable so scans are durably queued instead of discarded.
  err.status = error.code === "23505" ? 409 : (!error.code || /fetch|network|offline|timeout/i.test(error.message) ? 0 : 400);
  err.detail = error.message;
  throw err;
}

function requireData<T>(data: T | null, error: { message: string; code?: string } | null): T {
  if (error) fail(error);
  if (data === null) throw new Error("Supabase no devolvió datos");
  return data;
}

function dateOnly(value?: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export type AppProfile = {
  id: string;
  email: string;
  nombre: string;
  role: "admin" | "operator";
  status: "active" | "inactive";
  tenant_id: string;
  is_platform_admin: boolean;
  tenant_name: string;
  billing_period: "monthly" | "annual";
  subscription_status: string;
  current_period_ends_at: string | null;
};

export async function getMyProfile(): Promise<AppProfile> {
  requireSupabaseConfig();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("La sesión de Supabase no está activa");
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,status,tenant_id,is_platform_admin,tenant:tenants(name,billing_period,subscription_status,current_period_ends_at)")
    .eq("id", authData.user.id)
    .single();
  const profile = requireData(data, error);
  // PostgREST may infer the aliased relation as an array from generated schema
  // metadata even though tenant_id references a single tenant.
  const tenant = Array.isArray(profile.tenant) ? profile.tenant[0] : profile.tenant;
  if (profile.status !== "active") throw new Error("La cuenta está desactivada");
  return {
    id: profile.id,
    email: profile.email,
    nombre: profile.full_name,
    role: profile.role,
    status: profile.status,
    tenant_id: profile.tenant_id,
    is_platform_admin: Boolean(profile.is_platform_admin),
    tenant_name: tenant?.name || "",
    billing_period: tenant?.billing_period || "monthly",
    subscription_status: tenant?.subscription_status || "pending_payment",
    current_period_ends_at: tenant?.current_period_ends_at || null,
  };
}

/** Read the server-owned account status for revoking an already-open app session. */
export async function getMyAccountStatus(userId: string): Promise<"active" | "inactive" | null> {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .maybeSingle();
  if (error) fail(error);
  return data?.status === "active" || data?.status === "inactive" ? data.status : null;
}

export type DirectoryMatch = {
  base_available: boolean;
  found: boolean;
  person_id: string | null;
  display_name: string;
  work_site: string;
  municipality: string;
  position: string;
};

export async function lookupPerson(eventId: string, documentNumber: string): Promise<DirectoryMatch> {
  requireSupabaseConfig();
  const { data, error } = await supabase.rpc("lookup_person_for_scan", {
    p_event_id: eventId, p_document_type: "CC", p_document_number: documentNumber,
  });
  const row = (requireData(data, error) as any[])[0];
  if (!row) throw new Error("No se pudo consultar la base opcional");
  return {
    base_available: Boolean(row.base_available), found: Boolean(row.found),
    person_id: row.person_id || null, display_name: row.display_name || "",
    work_site: row.work_site || "", municipality: row.municipality || "", position: row.position || "",
  };
}

export async function listPeople(search = "", limit = 300) {
  requireSupabaseConfig();
  let query = supabase.from("people").select("id,document_type,document_number,display_name,work_site,municipality,position")
    .order("display_name", { ascending: true }).limit(Math.max(1, Math.min(limit, 1000)));
  const term = search.trim();
  if (term) query = query.or(`document_number.ilike.%${term.replace(/[(),]/g, " ")}%,display_name.ilike.%${term.replace(/[(),]/g, " ")}%`);
  const { data, error } = await query;
  return requireData(data, error) as Array<{ id: string; document_type: string; document_number: string; display_name: string; work_site: string; municipality: string; position: string }>;
}

export async function importPeopleDirectory(fileName: string, rows: Array<Record<string, string>>) {
  requireSupabaseConfig();
  const { data, error } = await supabase.rpc("import_people_directory", { p_file_name: fileName, p_rows: rows });
  const row = (requireData(data, error) as any[])[0];
  if (!row) throw new Error("No se recibió confirmación de la carga");
  return { import_id: row.import_id as string, imported_count: Number(row.imported_count || 0) };
}

export type AppEvent = {
  id: string;
  nombre: string;
  fecha: string;
  lugar: string;
  descripcion: string;
  activo: boolean;
  created_at: string;
  total_registros: number;
};

function mapEvent(row: any): AppEvent {
  return {
    id: row.id,
    nombre: row.name,
    fecha: dateOnly(row.starts_at || row.created_at),
    lugar: row.place || "",
    descripcion: row.description || "",
    activo: row.status === "active",
    created_at: row.created_at,
    total_registros: Number(row.scan_count || 0),
  };
}

export async function listEvents(): Promise<AppEvent[]> {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from("events")
    .select("id,name,starts_at,place,description,status,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = requireData(data, error) as any[];
  const counts = await railwayRequest<Record<string, number>>("/v1/events/counts");
  return rows.map((row) => mapEvent({ ...row, scan_count: counts[row.id] || 0 }));
}

export async function listAssignableEvents(): Promise<AppEvent[]> {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from("events")
    .select("id,name,starts_at,place,description,status,created_at")
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(500);
  return (requireData(data, error) as any[]).map((row) => mapEvent({ ...row, scan_count: 0 }));
}

export async function listOperatorEventAssignments(operatorId: string): Promise<Array<{ event_id: string; status: string }>> {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from("event_operators")
    .select("event_id,status")
    .eq("operator_id", operatorId);
  return requireData(data, error) as Array<{ event_id: string; status: string }>;
}

export async function setOperatorEventAssignment(operatorId: string, eventId: string, assigned: boolean): Promise<void> {
  requireSupabaseConfig();
  if (assigned) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) throw new Error("La sesión del administrador expiró");
    const { error } = await supabase.from("event_operators").upsert({
      event_id: eventId,
      operator_id: operatorId,
      assigned_by: authData.user.id,
      status: "active",
    }, { onConflict: "event_id,operator_id" });
    if (error) fail(error);
    return;
  }
  const { error } = await supabase.from("event_operators")
    .update({ status: "inactive" })
    .eq("event_id", eventId)
    .eq("operator_id", operatorId);
  if (error) fail(error);
}

export async function createEvent(input: {
  nombre: string;
  fecha: string;
  lugar?: string;
  descripcion?: string;
}): Promise<AppEvent> {
  requireSupabaseConfig();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Inicia sesión para crear la jornada");
  const startsAt = input.fecha
    ? new Date(`${input.fecha}T00:00:00-05:00`).toISOString()
    : new Date().toISOString();
  const { data, error } = await supabase
    .from("events")
    .insert({
      name: input.nombre.trim(),
      starts_at: startsAt,
      place: input.lugar || "",
      description: input.descripcion || "",
      status: "active",
      created_by: userData.user.id,
    })
    .select("id,name,starts_at,place,description,status,created_at")
    .single();
  return mapEvent(requireData(data, error));
}

export async function getEventStats(eventId: string) {
  return railwayRequest<any>(`/v1/events/${encodeURIComponent(eventId)}/stats`);
}

export async function getAdminMetrics(eventId?: string) {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
  return railwayRequest<any>(`/v1/admin/metrics${query}`);
}

export async function deleteEvent(eventId: string) {
  return railwayRequest<{ ok: boolean; archived: boolean; records_preserved: boolean }>(`/v1/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

export async function recordScan(input: {
  evento_id: string;
  cedula: string;
  nombre?: string;
  device_id: string;
  timestamp: number;
  idempotency_key: string;
  operator_id?: string;
}) {
  const nonce = input.idempotency_key.match(/([0-9a-f]{32})$/i)?.[1];
  if (!nonce) throw new Error("La clave de idempotencia no tiene formato válido");
  const idempotencyKey = `${nonce.slice(0, 8)}-${nonce.slice(8, 12)}-${nonce.slice(12, 16)}-${nonce.slice(16, 20)}-${nonce.slice(20)}`;
  const result = await withScanDeadline((signal) => railwayRequest<any>("/v1/scans", {
    method: "POST",
    signal,
    body: JSON.stringify({
      event_id: input.evento_id, document_type: "CC", document_number: input.cedula,
      display_name: input.nombre || "", captured_at: input.timestamp,
      device_id: input.device_id, idempotency_key: idempotencyKey,
    }),
  }));
  const row = result?.registro;
  if (!row) throw new Error("Railway no devolvió confirmación del escaneo");
  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    registro: {
      id: row.id,
      evento_id: input.evento_id,
      cedula: input.cedula,
      nombre: row.nombre || input.nombre || "",
      timestamp: input.timestamp,
      created_at: row.created_at,
      device_id: input.device_id,
      operator_id: row.operator_id || input.operator_id,
    },
  };
}

export async function listScans(eventId: string, limit = 200, offset = 0, operatorId?: string) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (operatorId) query.set("operatorId", operatorId);
  return railwayRequest<any[]>(`/v1/events/${encodeURIComponent(eventId)}/scans?${query}`);
}

export async function countMyEventScans(eventId: string, operatorId: string) {
  void operatorId;
  const result = await railwayRequest<{ total: number }>(`/v1/events/${encodeURIComponent(eventId)}/count`);
  return result.total || 0;
}

export async function listAudit(eventId: string) {
  return railwayRequest<any[]>(`/v1/events/${encodeURIComponent(eventId)}/audit`);
}

export async function clearEventScans(eventId: string) {
  return railwayRequest<{ ok: boolean; registros_borrados: number }>(`/v1/events/${encodeURIComponent(eventId)}/scans`, { method: "DELETE" });
}

export async function deleteScan(eventId: string, scanId: string) {
  return railwayRequest<{ ok: boolean }>(`/v1/events/${encodeURIComponent(eventId)}/scans/${encodeURIComponent(scanId)}`, { method: "DELETE" });
}

export async function subscribeScans(eventId: string, onScan: (scan: any) => void, onStatus: (status: string) => void) {
  requireSupabaseConfig();
  let stopped = false;
  let initialized = false;
  let seen = new Set<string>();
  onStatus("SUBSCRIBED");
  const poll = async () => {
    try {
      const rows = await listScans(eventId, 100, 0);
      if (stopped) return;
      const fresh = rows.filter((row) => row?.id && !seen.has(String(row.id))).reverse();
      if (initialized) fresh.forEach(onScan);
      rows.forEach((row) => { if (row?.id) seen.add(String(row.id)); });
      if (seen.size > 1000) seen = new Set(rows.map((row) => String(row.id)));
      initialized = true;
      onStatus("SUBSCRIBED");
    } catch {
      if (!stopped) onStatus("CHANNEL_ERROR");
    }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 4000);
  return () => { stopped = true; clearInterval(timer); };
}
