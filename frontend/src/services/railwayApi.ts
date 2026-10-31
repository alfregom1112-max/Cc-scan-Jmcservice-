import { supabase, requireSupabaseConfig } from "@/src/utils/supabase";

export class RailwayApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status = 0, detail?: unknown) {
    super(message);
    this.name = "RailwayApiError";
    this.status = status;
    this.detail = detail;
  }
}

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_RAILWAY_API_URL?.trim().replace(/\/+$/, "");
  if (!value) throw new RailwayApiError("Configura EXPO_PUBLIC_RAILWAY_API_URL para habilitar la sincronización segura", 0);
  return value;
}

export async function railwayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireSupabaseConfig();
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new RailwayApiError("Inicia sesión para sincronizar con el servidor", 401, error?.message);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new RailwayApiError("No hay conexión con el servidor. La lectura puede quedar en cola para sincronizar después.", 0, error);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new RailwayApiError(payload?.error || `Error del servidor (${response.status})`, response.status, payload);
  return payload as T;
}
