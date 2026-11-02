import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = process.env.JM_DEMO === "1";
const dist = path.join(root, demo ? "dist-demo" : "dist");

if (!demo && (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error("Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY como variables de construcción (públicas). Para una vista previa sin credenciales usa: npm run build:demo");
}
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "fonts"), { recursive: true });
for (const file of ["index.html", "activate-pin.html", "styles.css", "favicon.svg"]) await cp(path.join(root, "src", file), path.join(dist, file));
const fontDir = path.join(root, "node_modules/@fontsource-variable/schibsted-grotesk/files");
for (const f of ["schibsted-grotesk-latin-wght-normal.woff2", "schibsted-grotesk-latin-ext-wght-normal.woff2"]) await cp(path.join(fontDir, f), path.join(dist, "fonts", f));

await build({
  entryPoints: [path.join(root, "src", "app.js")],
  bundle: true, minify: true, format: "esm", target: "es2022", outdir: dist, legalComments: "none",
  define: { __JM_DEMO__: demo ? "true" : "false" },
});

const config = demo
  ? { demo: true }
  : { supabaseUrl: process.env.SUPABASE_URL, supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY, ...(process.env.API_BASE_URL ? { apiBase: process.env.API_BASE_URL } : {}) };
await writeFile(path.join(dist, "config.js"), `window.JM_CONFIG = Object.freeze(${JSON.stringify(config)});\n`);
console.log(`Build ${demo ? "DEMO" : "producción"} listo en ${path.relative(root, dist)}/`);
