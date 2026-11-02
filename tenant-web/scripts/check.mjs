// Valida sintaxis de todos los módulos fuente sin ejecutarlos.
import { readdir } from "node:fs/promises";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const src = fileURLToPath(new URL("../src/", import.meta.url));
async function walk(d) { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else if (p.endsWith(".js")) out.push(p); } return out; }
let bad = 0;
for (const f of await walk(src)) { try { await transform(await readFile(f, "utf8"), { loader: "js", format: "esm", target: "es2022" }); } catch (e) { bad++; console.error(`✗ ${f}\n${e.message}`); } }
if (bad) process.exit(1);
console.log("Sintaxis correcta en todos los módulos.");
