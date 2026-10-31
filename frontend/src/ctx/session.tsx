/**
 * Session context: holds JWT + user. Persists in SecureStore via @/src/utils/storage.
 * Exposes signIn / signUp / signOut and isLoading for splash gating.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import { clearToken, setToken } from "@/src/utils/api";
import { requireSupabaseConfig, supabase } from "@/src/utils/supabase";
import { getMyAccountStatus, getMyProfile, type AppProfile } from "@/src/services/supabaseApi";

type User = AppProfile;

type SessionContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, nombre: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const revokingRef = React.useRef(false);

  useEffect(() => {
    let alive = true;
    const loadProfile = async (accessToken: string | null) => {
      if (!accessToken) {
        if (alive) setUser(null);
        await clearToken();
        return;
      }
      try {
        const profile = await getMyProfile();
        if (alive) setUser(profile);
        await setToken(accessToken); // kept only for the still-legacy document OCR endpoint
      } catch (error) {
        if (alive) setUser(null);
        console.warn("No se pudo cargar el perfil Supabase", error);
      }
    };

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.warn("No se pudo restaurar la sesión Supabase", error);
      const accessToken = data.session?.access_token || null;
      if (alive) setTokenState(accessToken);
      await loadProfile(accessToken);
      if (alive) setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const accessToken = session?.access_token || null;
      if (alive) setTokenState(accessToken);
      // Defer Supabase profile queries until the auth event callback has returned.
      setTimeout(() => { void loadProfile(accessToken); }, 0);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // A valid JWT can remain cached on the phone after an administrator blocks
  // the account. Watch the database status while signed in and revoke the local
  // session promptly; scanning RPCs independently enforce the same status.
  useEffect(() => {
    const userId = user?.id;
    if (!userId || user.status !== "active") return;
    let alive = true;
    let checking = false;
    const revokeIfBlocked = async () => {
      if (checking || revokingRef.current || AppState.currentState !== "active") return;
      checking = true;
      try {
        const status = await getMyAccountStatus(userId);
        if (!alive || (status !== "inactive" && status !== null)) return;
        revokingRef.current = true;
        setUser(null);
        setTokenState(null);
        await clearToken();
        // Local sign-out must still happen when the network is unavailable.
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        if (alive) Alert.alert("Acceso bloqueado", "El administrador desactivó esta cuenta. El escáner se ha detenido.");
      } catch {
        // A transient connection error is not evidence that the account was blocked.
      } finally {
        checking = false;
      }
    };

    void revokeIfBlocked();
    const timer = setInterval(() => void revokeIfBlocked(), 5000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void revokeIfBlocked();
    });
    const channel = supabase
      .channel(`profile-status-${userId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      }, (payload) => {
        if (payload.new?.status === "inactive") void revokeIfBlocked();
      })
      .subscribe();

    return () => {
      alive = false;
      clearInterval(timer);
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [user?.id, user?.status]);

  const signIn = useCallback(async (email: string, password: string): Promise<User> => {
    requireSupabaseConfig();
    revokingRef.current = false;
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.session) throw error || new Error("Supabase no creó una sesión");
    const profile = await getMyProfile();
    if (profile.status !== "active") throw new Error("La cuenta está bloqueada. Contacta al administrador.");
    await setToken(data.session.access_token);
    setTokenState(data.session.access_token);
    setUser(profile);
    return profile;
  }, []);

  const signUp = useCallback(async (_email: string, _password: string, _nombre: string) => {
    throw new Error("El registro público está cerrado. Solicita al administrador que cree o invite tu cuenta.");
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, token, isLoading, signIn, signUp, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be inside SessionProvider");
  return ctx;
}
