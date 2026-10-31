/**
 * API client for JM ServiceTec.
 */
import { storage } from "@/src/utils/storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  createEvent as createSupabaseEvent,
  deleteEvent as deleteSupabaseEvent,
  getEventStats,
  getAdminMetrics as getSupabaseAdminMetrics,
  listEvents as listSupabaseEvents,
  listScans as listSupabaseScans,
  listAudit,
  clearEventScans,
  deleteScan,
  recordScan,
  countMyEventScans,
  lookupPerson,
  listPeople,
  importPeopleDirectory,
} from "@/src/services/supabaseApi";

const TOKEN_KEY = "cs_token";
const API_TIMEOUT_MS = 45000;

export type ApiError = { status: number; detail: any };

async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, withAuth = true, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  void path; void options; void withAuth; void timeoutMs;
  throw { status: 0, detail: "Esta versión no usa backend intermedio; la operación debe implementarse con Supabase o localmente." } as ApiError;
}

export const api = {
  register: (body: { email: string; password: string; nombre: string }) =>
    request<{ access_token: string; user: any }>("/auth/register", { method: "POST", body: JSON.stringify(body) }, false),
  login: (body: { email: string; password: string }) =>
    request<{ access_token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify(body) }, false),
  me: () => request<any>("/auth/me"),

  // Eventos
  listEventos: () => listSupabaseEvents(),
  createEvento: (body: { nombre: string; fecha: string; lugar?: string; descripcion?: string }) =>
    createSupabaseEvent(body),
  deleteEvento: (id: string) => deleteSupabaseEvent(id),
  getEvento: async (id: string) => (await listSupabaseEvents()).find((event) => event.id === id),
  estado: (id: string) => getEventStats(id),
  registros: (id: string, limit = 500, skip = 0, operatorId?: string) =>
    listSupabaseScans(id, limit, skip, operatorId),
  misEscaneos: (eventId: string, operatorId: string) =>
    countMyEventScans(eventId, operatorId),
  registroCedulas: async (id: string) => (await listSupabaseScans(id, 1000, 0)).map((row) => row.cedula),
  auditoria: (id: string) => listAudit(id),
  buscarEnBase: (eventId: string, documentNumber: string) => lookupPerson(eventId, documentNumber),
  listarBase: (search = "") => listPeople(search),
  cargarBase: (fileName: string, rows: Array<Record<string, string>>) => importPeopleDirectory(fileName, rows),

  adminMetrics: (eventoId?: string) => getSupabaseAdminMetrics(eventoId),
  adminIaStatus: async () => ({ configured: false, enabled: false, mode: "local" }),

  // Escaneo
  escanear: (body: any, idempotencyKey: string) =>
    recordScan({
      evento_id: body.evento_id,
      cedula: body.cedula,
      nombre: body.nombre || "",
      device_id: body.device_id,
      timestamp: body.timestamp,
      idempotency_key: idempotencyKey,
      operator_id: body.operator_id,
    }).then((result) => ({ ...result, registro: { ...body, ...result.registro } })),

  // OCR del frente
  ocrCedula: async (_imageBase64: string, _options: { forceGemini?: boolean } = {}): Promise<{ ok: boolean; cedula: string; parsed?: any; pipeline_usado?: string; mrz_valido?: boolean; error?: string }> => {
    throw new Error("MRZ/OCR por foto requiere un lector local instalado; esta versión no envía imágenes a ningún servidor.");
  },
  barcodeCedula: async (_imageBase64: string, _options: { preferMrz?: boolean; timeoutMs?: number } = {}): Promise<{ ok: boolean; cedula: string; parsed?: any; mrz_valido?: boolean; error?: string }> => {
    throw new Error("La lectura rápida debe realizarse desde los datos locales de la cámara; no se usa backend.");
  },

  // Admin registros
  patchRegistro: async (_eventoId: string, _registroId: string, _body: any) => { throw new Error("La edición de escaneos no está habilitada en la versión segura"); },
  deleteRegistro: (eventoId: string, registroId: string) => deleteScan(eventoId, registroId),
  clearEventoRegistros: (eventoId: string) => clearEventScans(eventoId),

  // Exportaci?n: devuelve una URL completa con el token para abrirla en el navegador
  exportUrl: async (eventoId: string) => {
    const rows = await listSupabaseScans(eventoId, 5000, 0);
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["documento", "nombre", "dispositivo", "fecha_registro"].map(escape).join(","),
      ...rows.map((row: any) => [row.cedula, row.nombre, row.device_id, row.created_at].map(escape).join(",")),
    ].join("\n");
    const uri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}registros_${eventoId}.csv`;
    await FileSystem.writeAsStringAsync(uri, `\ufeff${csv}`);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Exportar registros" });
    return uri;
  },
  exportBlob: async (eventoId: string): Promise<{ blob: Blob; filename: string }> => {
    const rows = await listSupabaseScans(eventoId, 5000, 0);
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["documento", "nombre", "dispositivo", "fecha_registro"].map(escape).join(","),
      ...rows.map((row: any) => [row.cedula, row.nombre, row.device_id, row.created_at].map(escape).join(",")),
    ].join("\n");
    return { blob: new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), filename: `registros_${eventoId}.csv` };
  },

};

export function wsUrl(eventoId: string, token: string, deviceId: string): string {
  void eventoId; void token; void deviceId;
  throw new Error("Esta versión consulta los registros mediante HTTPS al API de Railway.");
}

export { getToken };

export function parsePeopleCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) {
      row.push(cell.trim()); cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value.length)) rows.push(row);
  if (rows.length < 2) throw new Error("El CSV debe incluir encabezados y al menos una persona");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = rows[0].map(normalize);
  const find = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const docIdx = find(["documento", "numerodocumento", "cedula", "ceduladeciudadania", "cc", "nuip", "identificacion"]);
  if (docIdx < 0) throw new Error("No encuentro una columna de documento (documento, cedula o CC)");
  const nameIdx = find(["nombre", "nombres", "nombrecompleto", "displayname", "persona"]);
  const typeIdx = find(["tipodocumento", "documenttype", "tipo"]);
  const siteIdx = find(["sede", "lugardetrabajo", "worksite", "centrotrabajo"]);
  const cityIdx = find(["municipio", "ciudad", "municipality"]);
  const positionIdx = find(["cargo", "puesto", "position"]);
  const value = (values: string[], idx: number) => idx < 0 ? "" : String(values[idx] || "").trim();
  return rows.slice(1).map((values) => ({
    document_type: value(values, typeIdx).toUpperCase() || "CC",
    document_number: value(values, docIdx).replace(/\D/g, ""),
    display_name: value(values, nameIdx), work_site: value(values, siteIdx),
    municipality: value(values, cityIdx), position: value(values, positionIdx),
  })).filter((item) => item.document_number.length > 0);
}
