import { realRepo } from "./repo.real.js";

// En el build normal __JM_DEMO__ vale false: esbuild elimina esta rama y el módulo
// de demostración NO entra al bundle de producción.
let impl = realRepo;
if (typeof __JM_DEMO__ !== "undefined" && __JM_DEMO__ === true) {
  impl = (await import("../demo/repo.demo.js")).demoRepo;
}
export const repo = impl;
