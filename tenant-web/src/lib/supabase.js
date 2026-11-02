import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

let client = null;
/** Cliente creado de forma diferida: en modo demo nunca se instancia. */
export function getClient() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
