// Configuración pública del portal. Solo variables públicas de construcción.
const raw = (typeof window !== "undefined" && window.JM_CONFIG) || {};

/** true únicamente en el build de demostración (npm run build:demo). */
export const isDemo = typeof __JM_DEMO__ !== "undefined" && __JM_DEMO__ === true && raw.demo === true;

export const config = {
  supabaseUrl: raw.supabaseUrl || "",
  supabasePublishableKey: raw.supabasePublishableKey || "",
  apiBase: (raw.apiBase || "https://jm-servicetec-api.onrender.com").replace(/\/+$/, ""),
};

export const configError = isDemo || (config.supabaseUrl && config.supabasePublishableKey)
  ? null
  : "Falta configurar SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY al construir el portal.";
