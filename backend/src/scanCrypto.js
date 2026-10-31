import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function getKey(name) {
  const key = Buffer.from(process.env[name] || "", "base64");
  if (key.length !== 32) throw new Error(`${name} debe ser una clave Base64 de 32 bytes`);
  return key;
}
const dataKey = getKey("SCAN_DATA_ENCRYPTION_KEY");
const lookupKey = getKey("SCAN_LOOKUP_HMAC_KEY");

export function encryptField(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") };
}
export function decryptField(value) {
  if (!value || value.v !== 1) return "";
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
}
export function digestDocument(tenantId, eventId, type, number) {
  return createHmac("sha256", lookupKey).update(`${tenantId}:${eventId}:${type}:${number}`).digest("hex");
}
