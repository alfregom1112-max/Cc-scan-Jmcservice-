import { randomBytes } from "node:crypto";
console.log("Crea dos variables separadas en Railway y pega un valor distinto en cada una:\n");
console.log(`SCAN_DATA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`SCAN_LOOKUP_HMAC_KEY=${randomBytes(32).toString("base64")}`);
console.log("\nGuárdalas en un gestor seguro; sin ellas no se pueden descifrar ni buscar los registros.");
