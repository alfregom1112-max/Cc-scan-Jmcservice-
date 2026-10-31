import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY como variables de construcción en Netlify.");
}
await mkdir(dist, { recursive: true });
for (const file of ["index.html", "styles.css"]) await cp(path.join(root, "src", file), path.join(dist, file));
await build({ entryPoints: [path.join(root, "src", "app.js")], bundle: true, minify: true, format: "esm", outfile: path.join(dist, "app.js") });
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
};
await writeFile(path.join(dist, "config.js"), `window.JM_CONFIG = Object.freeze(${JSON.stringify(config)});\n`, { mode: 0o644 });
