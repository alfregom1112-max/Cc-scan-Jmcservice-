// Captura los parámetros de retorno de Supabase Auth (invitación, recuperación, errores)
// ANTES de que el cliente los consuma y limpie la URL. Debe importarse primero en app.js.
const hashRaw = location.hash.startsWith("#") && !location.hash.startsWith("#/") ? location.hash.slice(1) : "";
const hash = new URLSearchParams(hashRaw);
const query = new URLSearchParams(location.search);

export const authCallback = Object.freeze({
  type: hash.get("type") || query.get("type") || null,
  error: hash.get("error_description") || query.get("error_description") || null,
  errorCode: hash.get("error_code") || query.get("error_code") || null,
  present: Boolean(hashRaw || query.has("code") || query.has("error")),
});

export function callbackErrorMessage() {
  if (!authCallback.error && !authCallback.errorCode) return "";
  if (authCallback.errorCode === "otp_expired") return "El enlace venció o ya se usó. Pide uno nuevo desde «Recuperar acceso» o solicita otra invitación a tu administrador.";
  return "No se pudo completar el enlace de acceso. Pide uno nuevo e inténtalo otra vez.";
}

export const needsPasswordFromCallback = authCallback.type === "invite" || authCallback.type === "recovery" || authCallback.type === "signup";
