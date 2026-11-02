import { repo } from "./repo.js";
import { fmtIso } from "./format.js";
import { downloadCsv } from "./csv.js";

export const RESULT_LABEL = { found: "En base", not_found: "Sin coincidencia", registered: "Registrado" };
export const SCAN_CSV_HEADERS = ["Documento", "Nombre", "Operador", "Dispositivo", "Fecha de lectura", "Fecha de recepción", "Resultado"];
export const MAX_ROWS = 50000;

/**
 * Descarga TODAS las páginas de /scans (500 por página, el máximo del servidor).
 * Si una página falla devuelve lo recibido con `complete:false` y el error: nunca oculta el recorte.
 */
export async function loadAllScans(eventId, { operatorId, max = MAX_ROWS, onProgress, shouldCancel } = {}) {
  const rows = [];
  let offset = 0;
  for (;;) {
    if (shouldCancel?.()) return { rows, complete: false, reason: "cancelled", error: "Cancelaste la carga." };
    let chunk;
    try { chunk = await repo.scans.chunk(eventId, { offset, operatorId }); }
    catch (e) { return { rows, complete: false, reason: "error", error: e.message }; }
    rows.push(...chunk);
    onProgress?.(rows.length);
    if (chunk.length < 500) return { rows, complete: true, reason: null, error: null };
    offset += 500;
    if (rows.length >= max) return { rows, complete: false, reason: "limit", error: `Se alcanzó el límite de ${max.toLocaleString("es-CO")} registros por exportación.` };
  }
}

export function scanCsvRows(rows, operatorName) {
  return rows.map((s) => [s.document, s.name, operatorName(s.operatorId), s.deviceId, fmtIso(s.capturedAt), fmtIso(s.receivedAt), RESULT_LABEL[s.result] || s.result || ""]);
}
export function exportScans({ rows, operatorName, baseName, complete }) {
  const stamp = fmtIso(Date.now()).slice(0, 10);
  downloadCsv(`${baseName}-${stamp}${complete ? "" : "-PARCIAL"}.csv`, SCAN_CSV_HEADERS, scanCsvRows(rows, operatorName));
}
