// CSV seguro: comillas RFC 4180, CRLF, BOM UTF-8 y neutralización de fórmulas.
// Las celdas que empiezan por = + - @ tab o CR se prefijan con apóstrofo para que
// Excel/Sheets las traten como texto (inyección de fórmulas CSV).
export function neutralizeCell(value) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
export function toCsv(headers, rows) {
  const esc = (v) => `"${neutralizeCell(v).replace(/"/g, '""')}"`;
  return "﻿" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}
export function downloadCsv(filename, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
