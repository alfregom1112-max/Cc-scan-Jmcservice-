/**
 * Selected-event + WebSocket + local registry context.
 * - Keeps `Set<cedula>` for instant client-side duplicate detection
 * - Reconnects WS automatically when token/event changes
 * - Pushes scans to backend; queues if offline
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { api } from "@/src/utils/api";
import { countMyEventScans, subscribeScans } from "@/src/services/supabaseApi";
import { useSession } from "@/src/ctx/session";
import { storage } from "@/src/utils/storage";
import { enqueuePendingScan, incrementPendingAttempts, listPendingScans, removePendingScan } from "@/src/utils/offlineQueue";
import type { PendingScan } from "@/src/utils/offlineQueue.types";
import { getDeviceId, newNonce } from "@/src/utils/device";

type Registro = {
  id: string;
  evento_id: string;
  cedula: string;
  nombre?: string;
  sede?: string;
  municipio?: string;
  cargo?: string;
  device_id: string;
  operator_email?: string;
  operator_id?: string;
  timestamp: number;
  created_at: string;
};

type EventoCtxValue = {
  eventoId: string | null;
  eventoNombre: string;
  registros: Registro[];
  totalRegistros: number;
  misEscaneos: number;
  cedulasSet: Set<string>;
  wsStatus: "idle" | "connecting" | "online" | "offline";
  activos: number;
  duplicadosBloqueados: number;
  queueSize: number;
  lastDuplicate: { cedula: string; ts: number } | null;
  lastSuccess: { cedula: string; ts: number } | null;
  selectEvento: (id: string, nombre: string) => Promise<void>;
  clearEvento: () => void;
  scan: (
    cedula: string,
    extras?: Partial<Registro>,
  ) => Promise<{ ok: boolean; mensaje: string; duplicate?: boolean; registro?: Registro }>;
  refreshRegistros: () => Promise<void>;
};

const EventoCtx = createContext<EventoCtxValue | undefined>(undefined);

const SELECTED_EVENT_KEY = "cs_selected_event";
const REGISTROS_RECENT_LIMIT = 200;

type StoredEvento = {
  id: string;
  nombre: string;
};

function shouldQueueAfterError(err: any): boolean {
  const status = Number(err?.status || 0);
  return status === 0 || status === 408 || status === 502 || status === 503 || status === 504;
}

function scanErrorMessage(err: any, fallback: string): string {
  const detail = err?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof detail?.detail === "string" && detail.detail.trim()) return detail.detail;
  return fallback;
}

export function EventoProvider({ children }: { children: ReactNode }) {
  const { token, user } = useSession();
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [eventoNombre, setEventoNombre] = useState("");
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [misEscaneos, setMisEscaneos] = useState(0);
  const cedulasSetRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const [wsStatus, setWsStatus] = useState<EventoCtxValue["wsStatus"]>("idle");
  const [activos, setActivos] = useState(0);
  const [duplicadosBloqueados, setDuplicadosBloqueados] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [lastDuplicate, setLastDuplicate] = useState<EventoCtxValue["lastDuplicate"]>(null);
  const [lastSuccess, setLastSuccess] = useState<EventoCtxValue["lastSuccess"]>(null);
  const flushingQueueRef = useRef(false);

  const deviceIdRef = useRef<string>("");

  useEffect(() => {
    getDeviceId().then((d) => (deviceIdRef.current = d));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await storage.getItem<StoredEvento | null>(SELECTED_EVENT_KEY, null);
      if (cancelled || !saved?.id) return;
      const pending = await listPendingScans().catch(() => [] as PendingScan[]);
      const localRecords: Registro[] = pending.filter((item) => item.evento_id === saved.id).map((item) => ({
        id: `local_${item.idempotency_key}`,
        evento_id: item.evento_id,
        cedula: item.cedula,
        nombre: item.nombre,
        sede: item.sede,
        municipio: item.municipio,
        cargo: item.cargo,
        device_id: item.device_id,
        operator_email: "(pendiente)",
        operator_id: item.operator_id,
        timestamp: item.timestamp,
        created_at: new Date(item.timestamp).toISOString(),
      }));
      setEventoId(saved.id);
      setEventoNombre(saved.nombre || "");
      cedulasSetRef.current = new Set(localRecords.map((r) => r.cedula));
      setRegistros(localRecords);
      setQueueSize(pending.length);
      setTotalRegistros(0);
      forceRender((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addRegistro = useCallback((r: Registro, countAsNew = true, countAsMine = true) => {
    if (cedulasSetRef.current.has(r.cedula)) return false;
    cedulasSetRef.current.add(r.cedula);
    setRegistros((prev) => {
      return [r, ...prev].slice(0, REGISTROS_RECENT_LIMIT);
    });
    if (countAsNew) {
      setTotalRegistros((prev) => prev + 1);
    }
    if (countAsMine && r.operator_id && r.operator_id === user?.id) setMisEscaneos((prev) => prev + 1);
    forceRender((n) => n + 1);
    return true;
  }, [user?.id]);

  const refreshRegistros = useCallback(async () => {
    if (!eventoId || !token) return;
    try {
      const [serverList, est, cedulas, pending, ownCount] = await Promise.all([
        api.registros(eventoId, REGISTROS_RECENT_LIMIT, 0),
        api.estado(eventoId),
        api.registroCedulas(eventoId),
        listPendingScans(),
        user?.id ? countMyEventScans(eventoId, user.id) : Promise.resolve(0),
      ]);
      const localList: Registro[] = pending.filter((item) => item.evento_id === eventoId).map((item) => ({
        id: `local_${item.idempotency_key}`, evento_id: item.evento_id, cedula: item.cedula,
        nombre: item.nombre, sede: item.sede, municipio: item.municipio, cargo: item.cargo,
        device_id: item.device_id, operator_email: "(pendiente)", timestamp: item.timestamp,
        operator_id: item.operator_id,
        created_at: new Date(item.timestamp).toISOString(),
      }));
      const list = [...localList, ...(serverList as Registro[])].slice(0, REGISTROS_RECENT_LIMIT);
      const set = new Set<string>([...cedulas.map(String), ...localList.map((r) => r.cedula)]);
      cedulasSetRef.current = set;
      setRegistros(list);
      setTotalRegistros(Number(est.total ?? list.length));
      setMisEscaneos(ownCount + localList.filter((r) => r.operator_id === user?.id).length);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch {
      // ignore
    }
  }, [eventoId, token, user?.id]);

  // Railway polling subscription; refreshRegistros remains the recovery path
  // after reconnect so the UI does not depend on receiving every live update.
  useEffect(() => {
    if (!eventoId) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    setWsStatus("connecting");
    void subscribeScans(
      eventoId,
      (registro) => addRegistro(registro),
      (status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setWsStatus("online");
          void refreshRegistros();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setWsStatus("offline");
        } else {
          setWsStatus("connecting");
        }
      },
    ).then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    }).catch(() => setWsStatus("offline"));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [eventoId, token, addRegistro, refreshRegistros]);

  // Offline queue flusher
  const flushQueue = useCallback(async () => {
    if (flushingQueueRef.current) return;
    flushingQueueRef.current = true;
    try {
      const queue = await listPendingScans();
      setQueueSize(queue.length);
      for (const item of queue) {
        try {
          const result = await api.escanear({
            cedula: item.cedula,
            evento_id: item.evento_id,
            device_id: item.device_id,
            timestamp: item.timestamp,
            nonce: item.nonce,
            nombre: item.nombre,
            operator_id: item.operator_id,
            sede: item.sede,
            municipio: item.municipio,
            cargo: item.cargo,
          }, item.idempotency_key);
          if (result?.duplicate) {
            setLastDuplicate({ cedula: item.cedula, ts: Date.now() });
            setDuplicadosBloqueados((n) => n + 1);
          } else if (result?.registro) {
            addRegistro(result.registro, false, !result.duplicate);
          }
          await removePendingScan(item.idempotency_key);
        } catch {
          // Preserve every failed operation and retry it later without a cap.
          await incrementPendingAttempts(item.idempotency_key);
        }
      }
    } finally {
      flushingQueueRef.current = false;
      const remaining = await listPendingScans().catch(() => [] as PendingScan[]);
      setQueueSize(remaining.length);
    }
  }, [addRegistro]);

  useEffect(() => {
    if (wsStatus === "online") {
      flushQueue();
    }
  }, [wsStatus, flushQueue]);

  // Periodic queue retry
  useEffect(() => {
    if (wsStatus !== "online") return;
    const id = setInterval(() => {
      void flushQueue();
    }, 15000);
    return () => clearInterval(id);
  }, [flushQueue, wsStatus]);

  const selectEvento = useCallback(async (id: string, nombre: string) => {
    setEventoId(id);
    setEventoNombre(nombre);
    await storage.setItem(SELECTED_EVENT_KEY, { id, nombre });
    cedulasSetRef.current = new Set();
    setRegistros([]);
    setDuplicadosBloqueados(0);
    setActivos(0);
    setLastDuplicate(null);
    setLastSuccess(null);
    setTotalRegistros(0);
    // Load initial
    try {
      const [list, est, cedulas, ownCount, pending] = await Promise.all([
        api.registros(id, REGISTROS_RECENT_LIMIT, 0),
        api.estado(id),
        api.registroCedulas(id),
        user?.id ? countMyEventScans(id, user.id) : Promise.resolve(0),
        listPendingScans(),
      ]);
      const set = new Set<string>((cedulas.length ? cedulas : list.map((r) => r.cedula)).map(String));
      cedulasSetRef.current = set;
      setRegistros(list as Registro[]);
      setTotalRegistros(Number(est.total ?? list.length));
      setMisEscaneos(ownCount + pending.filter((item) => item.evento_id === id && item.operator_id === user?.id).length);
      setDuplicadosBloqueados(est.duplicados_detectados ?? 0);
      setActivos(est.dispositivos_activos ?? 0);
    } catch {
      // ignore
    }
  }, [user?.id]);

  const clearEvento = useCallback(() => {
    setEventoId(null);
    setEventoNombre("");
    setRegistros([]);
    setTotalRegistros(0);
    setMisEscaneos(0);
    cedulasSetRef.current = new Set();
    void storage.removeItem(SELECTED_EVENT_KEY);
  }, []);

  useEffect(() => {
    if (eventoId && token) {
      void refreshRegistros();
    }
  }, [eventoId, token, refreshRegistros]);

  const scan = useCallback(
    async (cedulaRaw: string, extras: Partial<Registro> = {}) => {
      if (!eventoId) return { ok: false, mensaje: "Selecciona un evento primero" };
      const cedula = cedulaRaw.replace(/\D/g, "");
      if (!cedula) return { ok: false, mensaje: "Cédula inválida" };

      // Nivel 1: cliente local
      if (cedulasSetRef.current.has(cedula)) {
        setLastDuplicate({ cedula, ts: Date.now() });
        setDuplicadosBloqueados((n) => n + 1);
        return { ok: false, duplicate: true, mensaje: `Atención: ya registrado: ${cedula}` };
      }

      const nonce = newNonce();
      const ts = Date.now();
      const device_id = deviceIdRef.current || (await getDeviceId());
      const idempotency_key = `${cedula}-${eventoId}-${device_id}-${nonce}`;

      const payload: any = {
        cedula,
        evento_id: eventoId,
        device_id,
        timestamp: ts,
        nonce,
        nombre: (extras as any).nombre || "",
        operator_id: user?.id,
        sede: (extras as any).sede || "",
        municipio: (extras as any).municipio || "",
        cargo: (extras as any).cargo || "",
      };

      try {
        const res = await api.escanear(payload, idempotency_key);
        if (res?.duplicate) {
          setLastDuplicate({ cedula, ts: Date.now() });
          setDuplicadosBloqueados((n) => n + 1);
          if (res.registro) addRegistro(res.registro, false, false);
          return { ok: false, duplicate: true, mensaje: `Atención: ya registrado: ${cedula}` };
        }
        if (res?.ok && res.registro) {
          addRegistro(res.registro);
          setLastSuccess({ cedula, ts: Date.now() });
          return { ok: true, mensaje: "Registrado correctamente", registro: res.registro };
        }
        return { ok: false, mensaje: "Supabase no confirmó el escaneo" };
      } catch (err: any) {
        if (err?.status === 409) {
          // Duplicado servidor
          const existing = err?.detail?.registro_existente;
          if (existing) {
            addRegistro(existing as Registro, false, false);
          } else {
            cedulasSetRef.current.add(cedula);
          }
          setLastDuplicate({ cedula, ts: Date.now() });
          setDuplicadosBloqueados((n) => n + 1);
          return { ok: false, duplicate: true, mensaje: `Atención: ya registrado: ${cedula}` };
        }
        if (!shouldQueueAfterError(err)) {
          return { ok: false, mensaje: scanErrorMessage(err, "No se pudo registrar") };
        }

        // Sin conexion o backend temporalmente no disponible -> encolar
        await enqueuePendingScan({ ...payload, idempotency_key, attempts: 0 });
        const q = await listPendingScans();
        setQueueSize(q.length);
        // Optimistic local add
        addRegistro({
          id: `local_${nonce}`,
          evento_id: eventoId,
          cedula,
          nombre: payload.nombre,
          sede: payload.sede,
          municipio: payload.municipio,
          cargo: payload.cargo,
          device_id,
          operator_email: "(pendiente)",
          operator_id: user?.id,
          timestamp: ts,
          created_at: new Date().toISOString(),
        }, false);
        setLastSuccess({ cedula, ts: Date.now() });
        return {
          ok: true,
          mensaje: "En cola de sincronizacion. Se enviara cuando vuelva la conexion.",
          registro: {
            id: `local_${nonce}`,
            evento_id: eventoId,
            cedula,
            nombre: payload.nombre,
            sede: payload.sede,
            municipio: payload.municipio,
            cargo: payload.cargo,
            device_id,
            operator_email: "(pendiente)",
            operator_id: user?.id,
            timestamp: ts,
            created_at: new Date().toISOString(),
          },
        };
      }
    },
    [eventoId, addRegistro, user?.id],
  );

  // Load queue size at startup
  useEffect(() => {
    listPendingScans().then((q) => setQueueSize(q.length)).catch(() => setQueueSize(0));
  }, []);

  return (
    <EventoCtx.Provider
      value={{
        eventoId,
        eventoNombre,
        registros,
        totalRegistros,
        misEscaneos,
        cedulasSet: cedulasSetRef.current,
        wsStatus,
        activos,
        duplicadosBloqueados,
        queueSize,
        lastDuplicate,
        lastSuccess,
        selectEvento,
        clearEvento,
        scan,
        refreshRegistros,
      }}
    >
      {children}
    </EventoCtx.Provider>
  );
}

export function useEvento(): EventoCtxValue {
  const ctx = useContext(EventoCtx);
  if (!ctx) throw new Error("useEvento must be inside EventoProvider");
  return ctx;
}
