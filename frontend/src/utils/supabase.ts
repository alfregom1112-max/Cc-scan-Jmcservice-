import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && publishableKey);

const authStorage = {
  getItem: async (key: string) => SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: async (key: string) => SecureStore.deleteItemAsync(key),
};
const serverAuthMemory = new Map<string, string>();
const webAuthStorage = {
  getItem: async (key: string) => typeof window === "undefined" ? serverAuthMemory.get(key) ?? null : window.localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (typeof window === "undefined") serverAuthMemory.set(key, value);
    else window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window === "undefined") serverAuthMemory.delete(key);
    else window.localStorage.removeItem(key);
  },
};

// Node 20 (used by some local Expo builds) does not expose a global WebSocket.
// Native and browser builds keep their platform WebSocket implementation.
const serverWebSocket = typeof window === "undefined" ? require("ws") : undefined;

// Keep the module importable before .env is configured; every data call checks
// isSupabaseConfigured and returns a clear setup error instead of hitting a fake URL.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  publishableKey || "placeholder-publishable-key",
  {
    auth: {
      storage: Platform.OS === "web" ? webAuthStorage : authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
    },
    realtime: serverWebSocket ? { transport: serverWebSocket } : undefined,
  },
);

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export function requireSupabaseConfig(): void {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Configura EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en frontend/.env antes de probar.",
    );
  }
}
