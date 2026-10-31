import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
  Animated,
  ActivityIndicator,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import { CameraView, useCameraPermissions } from "expo-camera";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { useSession } from "@/src/ctx/session";
import { api } from "@/src/utils/api";
import { extractCedula, parsePdf417 } from "@/src/utils/cedula";
import { errorMessage } from "@/src/utils/errors";
import { analizarConGemini } from "@/src/services/geminiService";
import { LocalCedulaCamera, localScannerAvailable, type LocalCameraRef } from "@/src/components/LocalCedulaCamera";
import { isMrzText } from "@/src/utils/mrzValidation";
import { mrzIdentityCandidate } from "@/src/utils/mrzIdentityReview";
import { useMrzIdentityReview } from "@/src/components/MrzIdentityReview";

const PILL_TIMEOUT = 2500;
const RAW_SCAN_COOLDOWN_MS = 900;
const SCANNER_REARM_DELAY_MS = 450;
const ABSOLUTE_FILL = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };
const COLOMBIAN_DASH_PAYLOAD_RE = /(?:^|[^A-Z0-9])([A-Z])-\d{5,8}-\d{5,10}-([MF])-(\d{5,11})-((?:19|20)\d{6})(?:[^0-9]|$)/i;
const QR_ID_KEY_RE = /(?:^|[?&#;,\s{\["'])\s*(?:nuip|cedula|c[eé]dula|cc|doc|documento|document_number|documentnumber|numero_documento|identificacion|identificaci[oó]n)\s*["']?\s*[:=/#-]\s*["']?([0-9][0-9\s.,-]{3,20}[0-9])/i;
const QR_PREFIX_RE = /(?:^|[^A-Z0-9])(?:CC|NUIP|DOC|CEDULA|DOCUMENTO)\s*[:#-]?\s*([0-9][0-9\s.,-]{3,20}[0-9])(?:[^0-9]|$)/i;

type DocumentPreview = {
  cedula: string;
  nombre: string;
  fecha: string;
  fechaExpiracion?: string;
  fuente?: string;
  mrzValido?: boolean;
  duplicate?: boolean;
  baseStatus?: string;
};

type Mode = "camera" | "manual";
type ParsedCedulaResult = ReturnType<typeof parsePdf417>;
type ServerParsedCedula = Partial<Pick<
  ParsedCedulaResult,
  | "cedula"
  | "nombres"
  | "primer_apellido"
  | "segundo_apellido"
  | "genero"
  | "fecha_nacimiento"
  | "fecha_expiracion"
  | "tipo_sangre"
  | "mrz_valido"
>>;
type OcrReadResult = { raw: string; serverParsed?: ServerParsedCedula };
function scannedPayload(raw?: string | null, data?: string | null): string {
  for (const value of [raw, data]) {
    const text = String(value || "").trim();
    if (text && !/^(null|undefined)$/i.test(text)) return text;
  }
  return "";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanQrDigits(value: string): string {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!/^\d{5,11}$/.test(digits)) return "";
  if (/^(19|20)\d{2}$/.test(digits)) return "";
  if (/^(19|20)\d{6}$/.test(digits)) return "";
  return digits;
}

function cleanCedulaNumber(value: string | null | undefined): string {
  return cleanQrDigits(String(value || ""));
}

function parsedFullName(parsed: ParsedCedulaResult): string {
  return [
    parsed.nombres,
    parsed.primer_apellido,
    parsed.segundo_apellido,
  ].filter(Boolean).join(" ").trim();
}

function extractQrCedulaPayload(raw: string): string {
  const original = String(raw || "").trim();
  if (!original) return "";

  const variants = Array.from(new Set([
    original,
    safeDecodeURIComponent(original),
    original.replace(/&amp;/gi, "&"),
    safeDecodeURIComponent(original.replace(/&amp;/gi, "&")),
  ])).filter(Boolean);

  for (const value of variants) {
    if (/^\s*\d[\d\s.,-]*\s*$/.test(value)) {
      const direct = cleanQrDigits(value);
      if (direct) return direct;
    }

    const keyMatch = value.match(QR_ID_KEY_RE);
    if (keyMatch) {
      const digits = cleanQrDigits(keyMatch[1]);
      if (digits) return digits;
    }

    const prefixed = value.match(QR_PREFIX_RE);
    if (prefixed) {
      const digits = cleanQrDigits(prefixed[1]);
      if (digits) return digits;
    }

    if (/^\s*\{/.test(value)) {
      try {
        const json = JSON.parse(value);
        const findLabeledId = (node: unknown): string => {
          if (Array.isArray(node)) {
            for (const child of node) {
              if (child && typeof child === "object") {
                const found = findLabeledId(child);
                if (found) return found;
              }
            }
          } else if (node && typeof node === "object") {
            for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
              if (/^(nuip|cedula|c[eé]dula|cc|doc|documento|document_number|documentnumber|numero_documento|identificacion|identificaci[oó]n)$/i.test(key)
                && (typeof child === "string" || typeof child === "number")
                && /^\s*\d[\d\s.,-]*\s*$/.test(String(child))) {
                const found = cleanQrDigits(String(child));
                if (found) return found;
              }
              if (child && typeof child === "object") {
                const found = findLabeledId(child);
                if (found) return found;
              }
            }
          }
          return "";
        };
        const found = findLabeledId(json);
        if (found) return found;
      } catch {
        // ignore malformed QR JSON
      }
    }
  }

  return "";
}

function isReliableBarcode(raw: string, currentMode: Mode): boolean {
  if (parsePdf417(raw).formato_detectado?.startsWith("pdf417_binario")) return true;
  const value = String(raw || "").trim();
  if (!value) return false;
  if (currentMode === "manual") return true;
  if (extractQrCedulaPayload(value)) return true;
  if (/^\d{5,11}$/.test(value)) return true;
  if (/[?&](nuip|cedula|cc|doc)[=:]?\d{5,11}/i.test(value)) return true;
  if (/^(?:CC|NUIP|DOC|CEDULA)[:\s]?\d{5,11}$/i.test(value)) return true;
  if (value.includes("PubDSK_") || (value.includes("\u0000") && value.length >= 120)) return true;
  const parsed = parsePdf417(value);
  if (parsed.formato_detectado?.startsWith("pdf417_binario")) return true;
  if (
    currentMode === "camera"
    && parsed.cedula
    && (
      value.includes("IDCOL")
      || value.includes("ICCOL")
      || value.includes("<<")
      || value.includes("|")
      || /C[EÉ]DULA|CC|NUIP|DOCUMENTO|NUMERO|NÚMERO|IDENTIFIC/i.test(value)
      || COLOMBIAN_DASH_PAYLOAD_RE.test(value)
    )
  ) return true;
  if (/^\d{5,11}$/.test(value)) return true;
  if (value.includes("IDCOL") || value.includes("ID<COL") || value.includes("ICCOL") || value.includes("IC<COL")) return true;
  if (COLOMBIAN_DASH_PAYLOAD_RE.test(value)) return true;
  if (/^\d{5,11}\|/.test(value)) return true;
  // No inferir el NUIP de QR oficiales cifrados/opacos.
  if (/[?&](nuip|cedula|cc|doc)[=:]?\d{5,11}/i.test(value)) return true;
  // QR con solo número precedido de prefijo (ej. "CC1023456789" o "NUIP:1023456789")
  if (/^(?:CC|NUIP|DOC|CEDULA)[:\s]?\d{5,11}$/i.test(value)) return true;
  return false;
}

function normalizeQrCedulaPayload(raw: string): string {
  // This helper also receives PDF417. Never normalize or trim its positional bytes as QR text.
  if (raw.includes("\u0000") || raw.includes("PubDSK_")
    || parsePdf417(raw).formato_detectado?.startsWith("pdf417_binario")) return raw;
  const value = String(raw || "").trim();
  const extracted = extractQrCedulaPayload(value);
  if (extracted) return extracted;
  const qrUrlMatch = value.match(/[?&](?:nuip|cedula|cc|doc)[=:]?(\d{5,11})/i);
  if (qrUrlMatch) return qrUrlMatch[1];

  const prefixedMatch = value.match(/^(?:CC|NUIP|DOC|CEDULA)[:\s]?(\d{5,11})$/i);
  if (prefixedMatch) return prefixedMatch[1];

  return value;
}

function extractCedulaFromCameraPayload(raw: string, type?: string): string {
  if (/qr|datamatrix/i.test(String(type || ""))) {
    return extractQrCedulaPayload(raw);
  }
  const normalized = normalizeQrCedulaPayload(raw);
  const parsed = parsePdf417(normalized);
  return cleanCedulaNumber(parsed.cedula || extractCedula(normalized) || "");
}

export default function EscanearScreen() {
  const router = useRouter();
  const { user } = useSession();
  const membershipActive = user?.subscription_status === "internal" ||
    ((user?.subscription_status === "active" || user?.subscription_status === "trial") &&
      !!user.current_period_ends_at && Date.parse(user.current_period_ends_at) > Date.now());
  const [isFocused, setIsFocused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const cameraReadBusy = useRef(false);
  const localCameraRef = useRef<LocalCameraRef | null>(null);
  const {
    eventoId,
    eventoNombre,
    registros,
    totalRegistros,
    misEscaneos,
    scan,
    wsStatus,
    activos,
    duplicadosBloqueados,
    queueSize,
    clearEvento,
  } = useEvento();

  const [mode, setMode] = useState<Mode>("camera");
  const [cedulaInput, setCedulaInput] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const { requestReview, cancelReview, dialog } = useMrzIdentityReview();
  const scanGeneration = useRef(0);
  useEffect(() => { scanGeneration.current++; cancelReview(); }, [eventoId, isFocused, mode, cancelReview]);


  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState<{ kind: "ok" | "dup" | "err"; text: string } | null>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastRawScanRef = useRef<{ value: string; at: number } | null>(null);
  const scanBusyRef = useRef(false);
  const iaLoadingRef = useRef(false);
  const ocrLoadingRef = useRef(false);
  const barcodeLoadingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerRearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef<any>(null);
  // Android usa LocalCedulaCamera (CameraX), no Expo CameraView. Las rutinas
  // de captura deben aceptar cualquiera de las dos referencias.
  const hasCamera = useCallback(() => !!(localCameraRef.current || cameraRef.current), []);
  const [reticleHeight, setReticleHeight] = useState(0);

  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  const showToast = useCallback((kind: "ok" | "dup" | "err", text: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ kind, text });
    toastTimerRef.current = setTimeout(() => setToast(null), PILL_TIMEOUT);
  }, []);

  const flashDuplicate = useCallback(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: false }).start();
  }, [flashAnim]);

  const rearmScanner = useCallback((delay = SCANNER_REARM_DELAY_MS) => {
    if (scannerRearmTimerRef.current) clearTimeout(scannerRearmTimerRef.current);
    scannerRearmTimerRef.current = setTimeout(() => {
      scannerRearmTimerRef.current = null;
      setScannerEnabled(true);
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (documentPreviewTimerRef.current) clearTimeout(documentPreviewTimerRef.current);
      if (scannerRearmTimerRef.current) clearTimeout(scannerRearmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setScannerEnabled(mode === "camera");
  }, [mode]);

  const buildDocumentPreview = useCallback((cedula: string, parsed: ReturnType<typeof parsePdf417>, fuente?: string): DocumentPreview => {
    const nombre = [
      parsed.nombres,
      parsed.primer_apellido,
      parsed.segundo_apellido,
    ].filter(Boolean).join(" ").trim();
    return {
      cedula,
      nombre,
      fecha: parsed.fecha_nacimiento || parsed.fecha_expiracion || "",
      fechaExpiracion: parsed.fecha_expiracion,
      fuente,
      mrzValido: parsed.mrz_valido,
    };
  }, []);

  useEffect(() => {
  if (mode === "camera" && !permission?.granted && permission?.canAskAgain !== false) {
      requestPermission();
    }
  }, [mode, permission, requestPermission]);

  useEffect(() => {
    if (mode !== "camera") {
      scanLineAnim.stopAnimation();
      scanLineAnim.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [mode, scanLineAnim]);

  const captureCameraBase64 = useCallback(async (quality: number, skipProcessing = true): Promise<string> => {
    if (localCameraRef.current) return await localCameraRef.current.capture();
    if (!cameraRef.current) return "";
    if (typeof cameraRef.current.takePhoto === "function") {
      const photo = await cameraRef.current.takePhoto({ flash: "off" });
      const path = photo?.path ? String(photo.path) : "";
      if (!path) return "";
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    }

    const photo = await cameraRef.current.takePictureAsync({
      quality,
      base64: true,
      skipProcessing,
    });
    return photo?.base64 || "";
  }, []);

  const readCameraWithGemini = useCallback(async (imageBase64?: string): Promise<ServerParsedCedula | null> => {
    if ((!imageBase64 && !hasCamera()) || iaLoadingRef.current) return null;
    iaLoadingRef.current = true;
    setIaLoading(true);
    try {
      const b64 = imageBase64 || await captureCameraBase64(0.78, false);
      if (!b64) return null;
      const iaResult = await analizarConGemini(b64);
      return iaResult?.cedula ? iaResult : null;
    } catch {
      return null;
    } finally {
      iaLoadingRef.current = false;
      setIaLoading(false);
    }
  }, [captureCameraBase64, hasCamera]);

  const readCameraWithOcr = useCallback(async (imageBase64?: string): Promise<OcrReadResult> => {
    if ((!imageBase64 && !hasCamera()) || ocrLoadingRef.current) return { raw: "" };
    ocrLoadingRef.current = true;
    setOcrLoading(true);
    try {
      const b64 = imageBase64 || await captureCameraBase64(0.72, false);
      if (!b64) return { raw: "" };
      const res = await api.ocrCedula(b64);
      if (res.ok && res.cedula) {
        const raw = res.cedula;
        const serverParsed = { ...res.parsed, cedula: res.cedula, mrz_valido: res.mrz_valido ?? res.parsed?.mrz_valido };
        return { raw, serverParsed };
      }
      return { raw: "" };
    } catch {
      return { raw: "" };
    } finally {
      ocrLoadingRef.current = false;
      setOcrLoading(false);
    }
  }, [captureCameraBase64, hasCamera]);

  const readCameraBarcode = useCallback(
    async (silent = false, imageBase64?: string, options: { preferMrz?: boolean; timeoutMs?: number } = {}): Promise<OcrReadResult> => {
      if ((!imageBase64 && !hasCamera()) || barcodeLoadingRef.current) return { raw: "" };
      barcodeLoadingRef.current = true;
      setBarcodeLoading(true);
      try {
        const b64 = imageBase64 || await captureCameraBase64(options.preferMrz ? 0.78 : 0.68);
        if (!b64) return { raw: "" };
        const res = await api.barcodeCedula(b64, { preferMrz: !!options.preferMrz, timeoutMs: options.timeoutMs });
        if (res.ok && res.cedula) {
          const raw = res.cedula;
          const serverParsed = { ...res.parsed, cedula: res.cedula, mrz_valido: res.mrz_valido ?? res.parsed?.mrz_valido };
          return { raw, serverParsed };
        }
        return { raw: "" };
      } catch (e: any) {
        if (!silent) showToast("err", errorMessage(e, "Error leyendo barras"));
        return { raw: "" };
      } finally {
        barcodeLoadingRef.current = false;
        setBarcodeLoading(false);
      }
    },
    [captureCameraBase64, hasCamera, showToast],
  );

  const handleScan = useCallback(
    async (raw: string, options: { skipBarcodeFallback?: boolean; serverParsed?: ServerParsedCedula } = {}): Promise<boolean> => {
      if (!membershipActive) {
        showToast("err", "La membresía de esta empresa no está activa. Contacta a JM ServiceTec.");
        return false;
      }
      if (scanBusyRef.current) return false;
      const ticket = scanGeneration.current;
      const current = () => ticket === scanGeneration.current && AppState.currentState === 'active';
      scanBusyRef.current = true;
      setScannerEnabled(false);
      try {
        const candidate = mrzIdentityCandidate(raw);
        if (isMrzText(raw) && !candidate) {
          showToast("err", "MRZ incompleta o con controles incorrectos. Vuelve a leerla.");
          return false;
        }
        const binary = raw.includes('\u0000') || raw.includes('PubDSK_');
        let rawToUse = candidate || binary ? raw : normalizeQrCedulaPayload(raw);
        let reviewedName: string | undefined;
        let inheritedServerParsed = options.serverParsed;
        const hasServerParsed = () => !!inheritedServerParsed && Object.keys(inheritedServerParsed).length > 0;
        const canUseServerParsed = () => hasServerParsed() && !!cleanCedulaNumber(inheritedServerParsed?.cedula);
        const buildParsed = (): ParsedCedulaResult => candidate ? parsePdf417(rawToUse) : canUseServerParsed()
          ? {
              cedula: inheritedServerParsed?.cedula || "",
              nombres: inheritedServerParsed?.nombres || "",
              primer_apellido: inheritedServerParsed?.primer_apellido || "",
              segundo_apellido: inheritedServerParsed?.segundo_apellido || "",
              genero: inheritedServerParsed?.genero || "",
              fecha_nacimiento: inheritedServerParsed?.fecha_nacimiento || "",
              fecha_expiracion: inheritedServerParsed?.fecha_expiracion || "",
              tipo_sangre: inheritedServerParsed?.tipo_sangre || "",
              formato_detectado: "ocr_servidor",
              mrz_valido: inheritedServerParsed?.mrz_valido,
              raw_mrz: [],
              raw: rawToUse,
            }
          : parsePdf417(rawToUse);
        // Fallback real para fotos/códigos incompletos. La versión anterior
        // tenía esta ruta activa; dejarla en `false` hacía que una foto nunca
        // llegara al lector de PDF417/MRZ del backend.
        const tryImageFallback = async (startMessage: string): Promise<boolean> => {
          if (mode !== "camera" || options.skipBarcodeFallback) return false;
          showToast("err", startMessage);
          const imageBase64 = await captureCameraBase64(0.78, false);
          if (!imageBase64) return false;
          const recovered = await readCameraBarcode(true, imageBase64, { preferMrz: true, timeoutMs: 9000 });
          if (!recovered.raw && !recovered.serverParsed?.cedula) return false;
          rawToUse = recovered.raw ? normalizeQrCedulaPayload(recovered.raw) : rawToUse;
          inheritedServerParsed = recovered.serverParsed;
          return true;
        };
        if (!canUseServerParsed() && !isReliableBarcode(rawToUse, mode)) {
          if (mode === "camera") {
            const recovered = await tryImageFallback("Codigo incompleto. Intentando con IA...");
            if (!recovered) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              showToast("err", "No pude leerla. Alinea la cedula completa y evita reflejos.");
              return false;
            }
          } else {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            showToast("err", "No pude confirmar la cédula.");
            return false;
          }
        }

        let parsed = buildParsed();
        let cedula = cleanCedulaNumber(parsed.cedula || extractCedula(rawToUse) || "");
        if (!cedula && mode === "camera") {
          const recovered = await tryImageFallback("Codigo sin NUIP. Intentando con IA...");
          if (recovered) {
            parsed = buildParsed();
            cedula = cleanCedulaNumber(parsed.cedula || extractCedula(rawToUse) || "");
          }
        }
        if (!cedula) {
          showToast("err", "No pude confirmar la cédula. Usa la camara completa o manual.");
          return false;
        }
        if (candidate) {
          const confirmed = await requestReview(candidate);
          if (!confirmed || !current()) return false;
          const identityChanged = confirmed.cedula !== cedula;
          cedula = confirmed.cedula; reviewedName = confirmed.nombre;
          parsed = { ...parsed, cedula, nombres: confirmed.nombre, primer_apellido: "", segundo_apellido: "",
            mrz_valido: identityChanged ? false : parsed.mrz_valido, formato_detectado: "MRZ revisada",
            ...(identityChanged ? { fecha_nacimiento: "", fecha_expiracion: "", genero: "" } : {}) };
        }
        if (!current()) return false;
        const now = Date.now();
        if (lastScanRef.current && lastScanRef.current.value === cedula && now - lastScanRef.current.at < 1500) {
          return false;
        }
        lastScanRef.current = { value: cedula, at: now };

        const nombre = reviewedName || parsedFullName(parsed);

        const res = await scan(cedula, {
          nombre,
        });
        if (res.ok) {
          setDocumentPreview(buildDocumentPreview(cedula, { ...parsed, nombres: nombre, primer_apellido: "", segundo_apellido: "" }, parsed.formato_detectado || "camara"));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (documentPreviewTimerRef.current) clearTimeout(documentPreviewTimerRef.current);
          documentPreviewTimerRef.current = setTimeout(() => setDocumentPreview(null), 4500);
          // La base es opcional: guardar primero el escaneo y consultar después,
          // sin afectar el registro si no hay base o la consulta falla.
          if (eventoId) void api.buscarEnBase(eventoId, cedula).then((match) => {
            if (!match.base_available || !match.found) return;
            setDocumentPreview((current) => current?.cedula === cedula
              ? { ...current, baseStatus: `En base · ${[match.work_site, match.municipality].filter(Boolean).join(" · ") || match.display_name}` }
              : current);
          }).catch(() => undefined);
          if (mode !== "camera") showToast("ok", `Cédula ${cedula} registrada`);
        } else if (res.duplicate) {
          setDocumentPreview({ ...buildDocumentPreview(cedula, { ...parsed, nombres: nombre, primer_apellido: "", segundo_apellido: "" }, parsed.formato_detectado || "camara"), duplicate: true });
          if (documentPreviewTimerRef.current) clearTimeout(documentPreviewTimerRef.current);
          documentPreviewTimerRef.current = setTimeout(() => setDocumentPreview(null), 2200);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          flashDuplicate();
          if (mode !== "camera") showToast("dup", `Atención: ${cedula} ya registrada`);
        } else {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast("err", res.mensaje);
        }
        return !!(res.ok || res.duplicate);
      } catch {
        showToast("err", "No se confirmó el registro. Revisa la conexión y vuelve a intentarlo.");
        return false;
      } finally {
        scanBusyRef.current = false;
        if (mode === "camera") rearmScanner();
      }
    },
    [mode, eventoId, scan, showToast, flashDuplicate, buildDocumentPreview, rearmScanner, captureCameraBase64, readCameraBarcode, requestReview, membershipActive],
  );

  const captureAndDecodeBarcode = useCallback(async () => {
    if (!hasCamera() || cameraReadBusy.current || scanBusyRef.current) return;
    const ticket = scanGeneration.current;
    cameraReadBusy.current = true;
    try {
      if (localCameraRef.current) {
        setBarcodeLoading(true);
        const result = await localCameraRef.current.readPdf417();
        if (ticket !== scanGeneration.current || AppState.currentState !== 'active') return;
        if (!result.raw) {
          showToast("err", "PDF417 no detectado. Incluye toda la barra, evita reflejos y toca para enfocar.");
          return;
        }
        if (!extractCedulaFromCameraPayload(result.raw, 'pdf417')) {
          showToast("err", "PDF417 detectado, pero su formato no se pudo interpretar. No se guardó el registro.");
          return;
        }
        await handleScan(result.raw, { skipBarcodeFallback: true });
        return;
      }
      const imageBase64 = await captureCameraBase64(0.65);
      if (!imageBase64) {
        showToast("err", "No pude tomar la foto. Intenta de nuevo.");
        return;
      }

      showToast("err", "Leyendo PDF417...");
      const barcodeResult = await readCameraBarcode(false, imageBase64, { preferMrz: false, timeoutMs: 7000 });
      if (barcodeResult.raw) {
        await handleScan(barcodeResult.raw, {
          skipBarcodeFallback: true,
          serverParsed: barcodeResult.serverParsed,
        });
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showToast("err", "PDF417 no detectado. Alinea el código completo y vuelve a intentar.");
    } catch (error) {
      showToast("err", errorMessage(error, "No se pudo completar la lectura del PDF417."));
    } finally {
      cameraReadBusy.current = false;
      setBarcodeLoading(false);
    }
  }, [captureCameraBase64, handleScan, hasCamera, readCameraBarcode, showToast]);

  const onManualSubmit = async () => {
    const cedula = extractCedula(cedulaInput);
    if (!cedula) {
      Alert.alert("Cédula inválida", "Ingresa un número entre 6 y 11 dígitos");
      return;
    }
    await handleScan(cedula);

  };


  const statusColor = wsStatus === "online" ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;
  const statusLabel = wsStatus === "online" ? "En linea" : wsStatus === "connecting" ? "Conectando..." : "Sin tiempo real";
  const recientes = useMemo(() => registros.slice(0, 5), [registros]);

  if (!eventoId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="calendar-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.emptyTitle}>Selecciona un evento</Text>
          <Text style={styles.emptySub}>Necesitas un evento activo para escanear cédulas.</Text>
          <TouchableOpacity testID="go-to-eventos" style={styles.primaryBtn} onPress={() => router.push("/(app)/eventos")}>
            <Text style={styles.primaryBtnText}>Ir a Eventos</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const flashBg = flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,59,48,0)", "rgba(255,59,48,0.35)"] });
  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(reticleHeight - 3, 0)],
  });

  return (
    <SafeAreaView style={[styles.container, mode === "camera" && styles.cameraContainer]} edges={["top", "left", "right"]}>
      <Animated.View pointerEvents="none" style={[ABSOLUTE_FILL, { backgroundColor: flashBg, zIndex: 100 }]} />

      {mode === "camera" ? <View style={styles.cameraTopBar}>
        <TouchableOpacity testID="change-event-button" style={styles.cameraHeaderButton} onPress={() => router.back()} accessibilityLabel="Cerrar escáner"><Ionicons name="close" size={23} color="#fff" /><Text style={styles.cameraHeaderButtonLabel}>Salir</Text></TouchableOpacity>
        <View style={styles.cameraHeaderTitle}><Text style={styles.cameraBrand}>JM ServiceTec</Text><Text style={styles.cameraEventName} numberOfLines={1}>{eventoNombre}</Text></View>
        <TouchableOpacity style={styles.cameraHeaderButton} onPress={() => setTorchEnabled((value) => !value)} accessibilityLabel={torchEnabled ? "Apagar luz" : "Encender luz"}><Ionicons name={torchEnabled ? "flash" : "flash-outline"} size={21} color="#fff" /><Text style={styles.cameraHeaderButtonLabel}>{torchEnabled ? "Luz ON" : "Luz"}</Text></TouchableOpacity>
      </View> : <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{eventoNombre}</Text>
          <View style={styles.statusRow}><View style={[styles.dot, { backgroundColor: statusColor }]} /><Text testID="sync-status-indicator" style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text><Text style={styles.statusMeta}> · {activos} dispositivos · cola {queueSize}</Text></View>
        </View>
        <View style={styles.topActions}><TouchableOpacity style={styles.switchEventBtn} onPress={clearEvento}><Ionicons name="swap-horizontal" size={18} color={theme.text} /></TouchableOpacity><View style={styles.counterPill}><Text testID="scan-counter" style={styles.counterValue}>{misEscaneos}</Text><Text style={styles.counterLabel}>tus escaneos</Text></View></View>
      </View>}

      {mode === "manual" && <View style={styles.modeRow}>
        <TouchableOpacity
          testID="mode-camera-toggle"
          style={styles.modeBtn}
          onPress={() => setMode("camera")}
        >
          <Ionicons name="scan" size={16} color={theme.textSecondary} />
          <Text style={styles.modeText}>Camara</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="manual-entry-toggle"
          style={[styles.modeBtn, mode === "manual" && styles.modeBtnActive]}
          onPress={() => setMode("manual")}
        >
          <Ionicons name="keypad" size={16} color={mode === "manual" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.modeText, mode === "manual" && { color: "#fff" }]}>Manual</Text>
        </TouchableOpacity>
      </View>}

      {mode === "camera" && isFocused ? (
        <View style={styles.cameraWrap} testID="scanner-camera-view">
          {!permission ? (
            <View style={styles.camPlaceholder}><Text style={styles.permText}>Iniciando cámara...</Text></View>
          ) : !permission.granted ? (
            <View style={styles.camPlaceholder}>
              <Ionicons name="camera-outline" size={56} color={theme.textSecondary} />
              <Text style={styles.permTitle}>Acceso a la cámara</Text>
              <Text style={styles.permText}>Para leer PDF417, QR, MRZ o numero impreso.</Text>
              <TouchableOpacity testID="grant-camera-permission" style={styles.primaryBtn} onPress={() => requestPermission()}>
                <Text style={styles.primaryBtnText}>Otorgar permiso</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
            {Platform.OS === "android" && localScannerAvailable ? (
              <LocalCedulaCamera
                ref={localCameraRef}
                style={ABSOLUTE_FILL}
                active={isFocused && scannerEnabled}
                torch={torchEnabled}
                onTorchChange={setTorchEnabled}
                onMrz={(raw) => cameraReadBusy.current ? Promise.resolve(false) : handleScan(raw, { skipBarcodeFallback: true })}
                onBarcode={(raw, type) => {
                  if (!raw || scanBusyRef.current || cameraReadBusy.current) return false;
                  if (!extractCedulaFromCameraPayload(raw, type)) {
                    if (type === "pdf417" && (!lastRawScanRef.current || Date.now() - lastRawScanRef.current.at > 2500)) {
                      lastRawScanRef.current = { value: raw, at: Date.now() };
                      showToast("err", "PDF417 detectado, pero su contenido no se pudo interpretar. No se guardó una cédula supuesta.");
                    }
                    return false;
                  }
                  void handleScan(raw, { skipBarcodeFallback: true });
                  return true;
                }}
              >
                <View pointerEvents="none" style={styles.reticleOverlay}>
                  <View style={[styles.reticle, styles.backReticle]}>
                    <View style={[styles.reticleCorner, styles.reticleCornerTopLeft]} /><View style={[styles.reticleCorner, styles.reticleCornerTopRight]} />
                    <View style={[styles.reticleCorner, styles.reticleCornerBottomLeft]} /><View style={[styles.reticleCorner, styles.reticleCornerBottomRight]} />
                  </View>
                </View>
              </LocalCedulaCamera>
            ) : (
            <CameraView
  ref={cameraRef}
  onCameraReady={() => setCameraReady(true)}
  style={ABSOLUTE_FILL}
  enableTorch={torchEnabled}
  facing="back"
  autofocus="on"
  barcodeScannerSettings={{
    barcodeTypes: ["pdf417", "qr", "datamatrix"],
  }}
  onBarcodeScanned={scannerEnabled ? ({ raw, data, type }) => {
    const payload = scannedPayload(raw, data);
    if (!payload) return;
    const normalized = normalizeQrCedulaPayload(payload);
    const now = Date.now();
    if (
      lastRawScanRef.current
      && lastRawScanRef.current.value === normalized
      && now - lastRawScanRef.current.at < RAW_SCAN_COOLDOWN_MS
    ) {
      return;
    }
    lastRawScanRef.current = { value: normalized, at: now };
    const hasDirectCedula = !!extractCedulaFromCameraPayload(normalized, type);
    if (!hasDirectCedula) {
      if (type === "qr") {
        showToast("err", "QR cifrado o no compatible. No se adivina la cédula: usa MRZ o registro manual.");
      }
      return;
    }
    void handleScan(normalized, { skipBarcodeFallback: true });
              } : undefined}>
              <View style={styles.reticleOverlay} pointerEvents="none">
                <View
                  style={[styles.reticle, styles.backReticle]}
                  onLayout={({ nativeEvent }) => setReticleHeight(nativeEvent.layout.height)}
                >
                  <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerTopLeft]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerTopRight]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerBottomLeft]} />
                  <View style={[styles.reticleCorner, styles.reticleCornerBottomRight]} />
                </View>
              </View>
            </CameraView>
            )}
            </>
          )}
          {permission?.granted && !localScannerAvailable && <View pointerEvents="none" style={styles.cameraInstructions}>
            <Ionicons name="scan" size={22} color="#062D2A" />
            <View style={styles.cameraInstructionsText}>
              <Text style={styles.cameraInstructionsTitle}>Alinea la cédula dentro del marco</Text>
              <Text style={styles.cameraInstructionsDetail}>Acerca el documento, evita reflejos y manténlo quieto.</Text>
            </View>
          </View>}
          <View style={styles.cameraBottomControls}>
            <TouchableOpacity style={styles.cameraSideControl} onPress={() => setMode("manual")} accessibilityLabel="Ingreso manual"><Ionicons name="keypad-outline" size={24} color="#fff" /><Text style={styles.cameraControlLabel}>Manual</Text></TouchableOpacity>
            <View style={styles.cameraReadControl}>
              <TouchableOpacity testID="decode-pdf417-photo-btn" style={[styles.shutterButton, (barcodeLoading || ocrLoading || iaLoading) && { opacity: 0.6 }]} onPress={captureAndDecodeBarcode} disabled={barcodeLoading || ocrLoading || iaLoading} accessibilityLabel="Leer documento">
                {barcodeLoading || ocrLoading || iaLoading ? <ActivityIndicator color={theme.brand} /> : <Ionicons name="scan-outline" size={30} color={theme.brand} />}
              </TouchableOpacity>
              <Text style={styles.cameraControlLabel}>{barcodeLoading || ocrLoading || iaLoading ? "Leyendo…" : "Leer ahora"}</Text>
            </View>
            <View testID="scan-counter" accessibilityLabel={`Tus escaneos: ${misEscaneos}`} style={styles.cameraCounterBadge}>
              <Text style={styles.cameraCounterValue}>{misEscaneos}</Text>
              <Text style={styles.cameraCounterLabel}>TUS REGISTROS</Text>
            </View>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.manualScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.manualCard}>
              <Text style={styles.manualLabel}>Cédula</Text>
              <TextInput
                testID="manual-cedula-input"
                style={[styles.manualInput, { fontSize: 28, fontWeight: "900", letterSpacing: 2, textAlign: "center" }]}
                value={cedulaInput}
                onChangeText={(t) => setCedulaInput(t.replace(/\D/g, ""))}
                placeholder="123456789"
                placeholderTextColor={theme.textDisabled}
                keyboardType="number-pad"
                autoFocus
                maxLength={11}
              />

              <TouchableOpacity testID="manual-submit-button" style={styles.submitBtn} onPress={onManualSubmit}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={styles.submitBtnText}>Registrar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {dialog}

      {documentPreview && (
        <View style={[styles.documentPreview, mode === "camera" && styles.documentPreviewOverlay, documentPreview.duplicate && styles.documentPreviewDuplicate]}>
          <View style={styles.documentPreviewHeader}>
            <Ionicons name={documentPreview.duplicate ? "alert-circle" : "checkmark-circle"} size={22} color={documentPreview.duplicate ? "#FF604D" : "#13D390"} />
            <Text style={styles.documentPreviewTitle}>{documentPreview.duplicate ? "Documento ya registrado" : documentPreview.mrzValido === false ? "Documento leído" : "Registro realizado"}</Text>
            <TouchableOpacity style={styles.previewClose} onPress={() => setDocumentPreview(null)} accessibilityLabel="Cerrar aviso"><Ionicons name="close" size={18} color="#fff" /></TouchableOpacity>
          </View>
          <View style={styles.previewFooter}><View style={{ flex: 1 }}><Text style={styles.documentPreviewValue}>Documento: {documentPreview.cedula}</Text>{!!documentPreview.baseStatus && <Text style={styles.documentPreviewValue}>{documentPreview.baseStatus}</Text>}</View><View style={[styles.previewBadge, documentPreview.duplicate && styles.previewBadgeDuplicate]}><Text style={styles.previewBadgeText}>{documentPreview.duplicate ? "DUPLICADO" : "GUARDADO"}</Text></View></View>
        </View>
      )}

      {/* Recientes */}
      {mode !== "camera" && <View style={styles.recentWrap}>
        <View style={styles.recentHeader}>
          <Text style={styles.recentTitle}>Recientes</Text>
          <Text style={styles.recentMeta}>{duplicadosBloqueados} duplicados bloqueados</Text>
        </View>
        <FlatList
          data={recientes}
          keyExtractor={(it) => it.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.recentEmpty}>Aún no hay escaneos.</Text>}
          renderItem={({ item }) => (
            <View style={styles.recentChip}>
              <Text style={styles.recentCedula}>{item.cedula}</Text>
              <Text style={[styles.recentField, { fontSize: 19, fontWeight: "900" }]}>Registrado</Text>
              {!!item.nombre && <Text style={styles.recentName} numberOfLines={1}>{item.nombre}</Text>}
              {!!item.cargo && <Text style={styles.recentField} numberOfLines={1}>{item.cargo}</Text>}
              {!!item.municipio && <Text style={styles.recentField} numberOfLines={1}>{item.municipio}</Text>}
            </View>
          )}
        />
      </View>}

      {toast && (
        <View
          testID="scan-toast"
          style={[
            styles.toast,
            toast.kind === "ok" && { backgroundColor: theme.successBg, borderColor: theme.success },
            toast.kind === "dup" && { backgroundColor: theme.errorBg, borderColor: theme.error },
            toast.kind === "err" && { backgroundColor: theme.warningBg, borderColor: theme.warning },
          ]}
        >
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  teacherCard: { marginHorizontal: 16, marginVertical: 8, padding: 16, borderRadius: 16, gap: 5 },
  teacherAnswer: { color: "#fff", fontSize: 30, fontWeight: "900" },
  teacherDetail: { color: "#fff", fontSize: 15 },
  teacherMunicipality: { color: "#fff", fontSize: 20, fontWeight: "700" },
  container: { flex: 1, backgroundColor: theme.bg },
  cameraContainer: { backgroundColor: "#090B0D" },
  cameraTopBar: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, backgroundColor: "#11191B", borderBottomWidth: 1, borderBottomColor: "#344649" },
  cameraHeaderButton: { minWidth: 48, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 1 },
  cameraHeaderButtonLabel: { color: "#E4F4F2", fontSize: 10, fontWeight: "800" },
  cameraHeaderTitle: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  cameraBrand: { color: "#fff", fontSize: 17, fontWeight: "900" },
  cameraEventName: { color: "#C8D7D8", fontSize: 11, fontWeight: "700", marginTop: 2, maxWidth: "100%" },
  topBar: { flexDirection: "row", paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8, alignItems: "center", gap: 10 },
  eventTitle: { color: theme.text, fontSize: 17, fontWeight: "900" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontWeight: "700", fontSize: 12 },
  statusMeta: { color: theme.textDisabled, fontSize: 11 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchEventBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  counterPill: { minWidth: 86, backgroundColor: "#087F72", borderWidth: 1, borderColor: "#17B8A4", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, alignItems: "center", elevation: 4 },
  counterValue: { color: "#fff", fontSize: 24, lineHeight: 27, fontWeight: "900", fontVariant: ["tabular-nums"] },
  counterLabel: { color: "#D7FFF8", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  modeRow: { flexDirection: "row", marginHorizontal: 14, marginBottom: 8, backgroundColor: theme.surface, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.border },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 6, gap: 6 },
  modeBtnActive: { backgroundColor: theme.brand },
  modeText: { color: theme.textSecondary, fontWeight: "700", fontSize: 13 },
  cameraWrap: { flex: 1, marginHorizontal: 8, borderRadius: 8, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: theme.border },
  camPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  permTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  permText: { color: theme.textSecondary, fontSize: 13, textAlign: "center" },
  reticleOverlay: { ...ABSOLUTE_FILL, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  reticle: { width: "100%", maxWidth: 720, aspectRatio: 1.586, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.12)" },
  backReticle: { justifyContent: "space-between", padding: 16 },
  scanLine: { position: "absolute", top: 0, left: 0, right: 0, height: 3, backgroundColor: theme.brandNeon, opacity: 0.95, shadowColor: theme.brandNeon, shadowOpacity: 0.8, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, zIndex: 3 },
  reticleCorner: { position: "absolute", width: 38, height: 38, borderColor: "#14E6D1", zIndex: 4 },
  reticleCornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  reticleCornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  reticleCornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  reticleCornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  qrGuide: { alignSelf: "flex-end", width: "22%", aspectRatio: 1, borderWidth: 2, borderColor: "#fff", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  mrzGuide: { gap: 5 },
  mrzGuideLine: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.75)" },
  reticleHint: { color: "#fff", marginTop: 12, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, fontSize: 12 },
  // Keep this below LocalCedulaCamera's live status pill, so scan/reader errors stay visible.
  cameraInstructions: { position: "absolute", top: 66, left: 14, right: 14, minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, backgroundColor: "rgba(238,255,252,0.96)", borderWidth: 2, borderColor: "#55E2CF", elevation: 8 },
  cameraInstructionsText: { flex: 1 },
  cameraInstructionsTitle: { color: "#062D2A", fontSize: 14, lineHeight: 18, fontWeight: "900" },
  cameraInstructionsDetail: { color: "#244B4A", fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 2 },
  cameraBottomControls: { position: "absolute", bottom: 12, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 92, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(8,15,18,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  cameraSideControl: { width: 76, minHeight: 68, alignItems: "center", justifyContent: "center", gap: 3 },
  cameraReadControl: { alignItems: "center", justifyContent: "center", gap: 3 },
  cameraControlLabel: { color: "#fff", fontSize: 12, lineHeight: 16, fontWeight: "900" },
  cameraCounterBadge: { minWidth: 122, minHeight: 76, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#075E57", borderWidth: 2, borderColor: "#63F2DD", elevation: 10 },
  cameraCounterValue: { color: "#fff", fontSize: 34, lineHeight: 38, fontWeight: "900", fontVariant: ["tabular-nums"] },
  cameraCounterLabel: { color: "#E0FFFA", fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 0.5 },
  shutterButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "rgba(255,255,255,0.65)" },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    shadowColor: theme.brand,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  captureBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  manualScroll: { padding: 16, paddingBottom: 24 },
  manualCard: { backgroundColor: theme.surface, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 8 },
  manualLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 10 },
  manualInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 16, color: theme.text, fontSize: 15 },
  previewWrap: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8, gap: 4 },
  previewTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  previewName: { color: theme.text, fontWeight: "800", fontSize: 16, marginTop: 4 },
  previewMeta: { color: theme.textSecondary, fontSize: 13 },
  submitBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: theme.brand, paddingVertical: 16, borderRadius: 8, marginTop: 16 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  documentPreview: { marginHorizontal: 14, marginTop: 10, padding: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, gap: 8 },
  documentPreviewOverlay: { position: "absolute", left: 14, right: 14, bottom: 96, marginHorizontal: 0, marginTop: 0, zIndex: 150, backgroundColor: "rgba(12,16,18,0.92)", borderColor: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 15, shadowColor: "#000", shadowOpacity: 0.32, shadowRadius: 12, elevation: 8 },
  documentPreviewDuplicate: { borderColor: "rgba(255,96,77,0.35)" },
  documentPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  documentPreviewTitle: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 },
  previewClose: { width: 25, height: 25, alignItems: "center", justifyContent: "center" },
  previewFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 },
  previewBadge: { backgroundColor: "#087D59", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  previewBadgeDuplicate: { backgroundColor: "#8B2D22" },
  previewBadgeText: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  documentPreviewSource: { marginLeft: "auto", color: theme.textDisabled, fontWeight: "700", fontSize: 11 },
  documentPreviewGrid: { flexDirection: "row", gap: 8 },
  documentPreviewCell: { flex: 1, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  documentPreviewLabel: { color: theme.textDisabled, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  documentPreviewValue: { color: "#fff", fontSize: 12, fontWeight: "700", marginTop: 2 },
  documentPreviewName: { color: theme.textSecondary, fontSize: 13, fontWeight: "700" },
  documentPreviewMeta: { color: theme.textDisabled, fontSize: 11 },
  recentWrap: { paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 8 },
  recentTitle: { color: theme.text, fontWeight: "800", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  recentMeta: { color: theme.error, fontSize: 11, fontWeight: "700" },
  recentEmpty: { color: theme.textDisabled, fontSize: 12, paddingHorizontal: 16 },
  recentChip: { backgroundColor: theme.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.border, minWidth: 148, maxWidth: 220 },
  recentCedula: { color: theme.text, fontWeight: "800", fontSize: 14 },
  recentName: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  recentField: { color: theme.textDisabled, fontSize: 10, marginTop: 1 },
  toast: { position: "absolute", top: 80, left: 20, right: 20, padding: 14, borderRadius: 14, borderWidth: 1, zIndex: 200 },
  toastText: { color: theme.text, fontWeight: "800", fontSize: 14, textAlign: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  emptySub: { color: theme.textSecondary, textAlign: "center" },
  primaryBtn: { backgroundColor: theme.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
