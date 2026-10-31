import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { useSession } from "@/src/ctx/session";
import { api } from "@/src/utils/api";
import { getCachedOperatorHistory, saveCachedOperatorHistory } from "@/src/utils/offlineQueue";

type Filter = "all" | "accepted" | "duplicate";
type AuditItem = { event_type: string; data?: { cedula?: string; nombre?: string }; created_at: string };
type Entry = { id: string; name: string; document: string; time: string; duplicate: boolean };
type ScanRow = { id: string; cedula: string; nombre?: string; created_at: string; operator_id?: string };
const blue = "#0867E8";
const HISTORY_PAGE_SIZE = 100;

export default function HistorialScreen() {
  const router = useRouter();
  const { eventoId, registros, totalRegistros } = useEvento();
  const { user } = useSession();
  const isOperator = user?.role === "operator";
  const [filter, setFilter] = useState<Filter>("all");
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [operatorRows, setOperatorRows] = useState<ScanRow[]>([]);
  const [operatorScanCount, setOperatorScanCount] = useState(0);
  const [operatorOffset, setOperatorOffset] = useState(0);
  const [hasMoreOperatorScans, setHasMoreOperatorScans] = useState(false);

  const load = useCallback(async () => {
    if (!eventoId) {
      setAudit([]); setOperatorRows([]); setOperatorScanCount(0); setOperatorOffset(0); setHasMoreOperatorScans(false); setLoadError("");
      return;
    }
    setLoading(true);
    const auditRequest = isOperator
      ? Promise.resolve(setAudit([]))
      : api.auditoria(eventoId).then((rows) => { setAudit(rows as AuditItem[]); setLoadError(""); }).catch(() => {
          setLoadError("No se pudo actualizar el historial. Se conservan los registros cargados; revisa tu conexión y vuelve a intentar.");
        });
    const operatorRequest = isOperator && user?.id
      ? (async () => {
          // Restore the last successful page from the encrypted on-device database
          // first. This keeps the operator's history visible after reopening while
          // offline, and the server remains the source of truth when reachable.
          const cached = await getCachedOperatorHistory(eventoId, user.id).catch(() => null);
          if (cached && cached.rows.length) {
            setOperatorRows(cached.rows as ScanRow[]);
            setOperatorScanCount(cached.count);
            setOperatorOffset(cached.rows.length);
            setHasMoreOperatorScans(cached.rows.length < cached.count);
          }
          try {
            const [rows, count] = await Promise.all([
              api.registros(eventoId, HISTORY_PAGE_SIZE, 0, user.id),
              api.misEscaneos(eventoId, user.id),
            ]);
            setOperatorRows(rows as ScanRow[]);
            setOperatorScanCount(count);
            setOperatorOffset(rows.length);
            setHasMoreOperatorScans(rows.length < count);
            setLoadError("");
            await saveCachedOperatorHistory(eventoId, user.id, rows as ScanRow[], count).catch(() => undefined);
          } catch {
            // Retain the cache and the last successful state; a network or policy
            // failure must not turn saved history into an empty list.
            setLoadError("No se pudo actualizar el historial. Se muestran los registros guardados en este dispositivo; revisa tu conexión y vuelve a intentar.");
          }
        })()
      : Promise.resolve();
    try { await Promise.all([auditRequest, operatorRequest]); }
    finally { setLoading(false); }
  }, [eventoId, isOperator, user?.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const loadMoreOperatorScans = useCallback(async () => {
    if (!eventoId || !user?.id || loadingMore || !hasMoreOperatorScans) return;
    setLoadingMore(true);
    try {
      const next = await api.registros(eventoId, HISTORY_PAGE_SIZE, operatorOffset, user.id) as ScanRow[];
      const mergedRows = [...operatorRows, ...next.filter((row) => !operatorRows.some((existing) => existing.id === row.id))];
      await saveCachedOperatorHistory(eventoId, user.id, mergedRows, operatorScanCount);
      setOperatorRows((previous) => {
        const known = new Set(previous.map((row) => row.id));
        return [...previous, ...next.filter((row) => !known.has(row.id))];
      });
      setOperatorOffset((previous) => previous + next.length);
      setHasMoreOperatorScans(next.length === HISTORY_PAGE_SIZE && operatorOffset + next.length < operatorScanCount);
      setLoadError("");
    } catch {
      setLoadError("No se pudieron cargar más registros. Los que ya ves siguen guardados; vuelve a intentar.");
    } finally { setLoadingMore(false); }
  }, [eventoId, user?.id, loadingMore, hasMoreOperatorScans, operatorOffset, operatorScanCount, operatorRows]);

  const duplicates = useMemo(() => audit.filter((item) => /DUPLICADO|DUPLICATE|REJECT/i.test(item.event_type)).map((item, index) => ({
    id: `dup-${item.created_at}-${index}`, name: item.data?.nombre || "Intento duplicado", document: item.data?.cedula || "—", time: item.created_at, duplicate: true,
  })), [audit]);
  const accepted: Entry[] = useMemo(() => {
    if (!isOperator || !user?.id) return registros.map((item, index) => ({
      id: `ok-${item.id}-${index}`, name: item.nombre || "Nombre no disponible", document: item.cedula, time: item.created_at, duplicate: false,
    }));
    const persistedDocuments = new Set(operatorRows.map((row) => row.cedula));
    const pendingRows = registros.filter((row) => row.id.startsWith("local_") && row.operator_id === user.id && !persistedDocuments.has(row.cedula));
    return [...operatorRows, ...pendingRows].map((item, index) => ({
      id: `ok-${item.id}-${index}`, name: item.nombre || "Nombre no disponible", document: item.cedula, time: item.created_at, duplicate: false,
    }));
  }, [isOperator, user?.id, registros, operatorRows]);
  const acceptedCount = isOperator ? operatorScanCount + registros.filter((row) => row.id.startsWith("local_") && row.operator_id === user?.id).length : totalRegistros;
  const all = useMemo(() => [...accepted, ...duplicates].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()), [accepted, duplicates]);
  const data = filter === "accepted" ? accepted : filter === "duplicate" ? duplicates : all;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headingRow}><TouchableOpacity style={styles.back} onPress={() => router.push("/(app)/eventos" as any)} accessibilityLabel="Volver al inicio"><Ionicons name="arrow-back" size={21} color={theme.text} /></TouchableOpacity><Text style={styles.title}>Historial</Text></View>
        {!!loadError && <TouchableOpacity style={styles.errorNotice} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Reintentar carga del historial"><Ionicons name="cloud-offline-outline" size={18} color="#A34B00" /><View style={{ flex: 1 }}><Text style={styles.errorTitle}>No se pudo actualizar</Text><Text style={styles.errorText}>{loadError}</Text></View><Ionicons name="refresh" size={18} color="#A34B00" /></TouchableOpacity>}
        <View style={styles.filters}>
          <FilterButton title={`Todos (${acceptedCount + duplicates.length})`} active={filter === "all"} onPress={() => setFilter("all")} />
          <FilterButton title={`Aceptados (${acceptedCount})`} active={filter === "accepted"} onPress={() => setFilter("accepted")} />
          <FilterButton title={`Duplicados (${duplicates.length})`} active={filter === "duplicate"} onPress={() => setFilter("duplicate")} />
        </View>
      </View>

      {!eventoId ? <View style={styles.empty}><Ionicons name="calendar-outline" size={40} color={theme.textDisabled} /><Text style={styles.emptyTitle}>No hay evento activo</Text><Text style={styles.emptyText}>Vuelve al inicio y selecciona un evento.</Text></View> : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={blue} />}
          ListFooterComponent={isOperator && hasMoreOperatorScans ? <TouchableOpacity style={styles.loadMore} onPress={() => void loadMoreOperatorScans()} disabled={loadingMore}><Text style={styles.loadMoreText}>{loadingMore ? "Cargando…" : "Cargar más escaneos"}</Text></TouchableOpacity> : null}
          ListEmptyComponent={loading ? <ActivityIndicator color={blue} style={{ marginTop: 30 }} /> : loadError ? <View style={styles.empty}><Ionicons name="cloud-offline-outline" size={40} color={theme.warning} /><Text style={styles.emptyTitle}>No se pudo cargar el historial</Text><Text style={styles.emptyText}>No se borraron registros. Comprueba la conexión y vuelve a intentar.</Text><TouchableOpacity style={styles.retryButton} onPress={() => void load()}><Text style={styles.retryText}>Reintentar</Text></TouchableOpacity></View> : <View style={styles.empty}><Ionicons name="documents-outline" size={40} color={theme.textDisabled} /><Text style={styles.emptyTitle}>Sin registros todavía</Text></View>}
          renderItem={({ item }) => <View style={styles.row}>
            <View style={styles.personIcon}><Ionicons name="person" size={17} color={blue} /></View>
            <View style={styles.rowCopy}><Text style={styles.name} numberOfLines={1}>{item.name}</Text><Text style={styles.document}>{item.document}</Text></View>
            <View style={styles.rowStatus}><Text style={styles.time}>{item.time ? new Date(item.time).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—"}</Text><View style={[styles.status, item.duplicate ? styles.duplicateStatus : styles.acceptedStatus]}><Text style={[styles.statusText, item.duplicate ? styles.duplicateText : styles.acceptedText]}>{item.duplicate ? "DUPLICADO" : "ACEPTADO"}</Text></View></View>
          </View>}
        />
      )}
    </SafeAreaView>
  );
}

function FilterButton({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.filterBtn, active && styles.filterActive]} onPress={onPress}><Text style={[styles.filterText, active && styles.filterActiveText]}>{title}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg }, header: { paddingHorizontal: 16, paddingTop: 5, paddingBottom: 11, gap: 14 }, headingRow: { flexDirection: "row", alignItems: "center", gap: 9 }, back: { width: 30, height: 34, justifyContent: "center" }, title: { color: theme.text, fontSize: 21, fontWeight: "900" },
  filters: { flexDirection: "row", gap: 6 }, filterBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, paddingHorizontal: 4, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }, filterActive: { backgroundColor: blue, borderColor: blue }, filterText: { color: theme.textSecondary, fontSize: 9, fontWeight: "800" }, filterActiveText: { color: "#fff" },
  list: { paddingHorizontal: 15, paddingTop: 2, paddingBottom: 28 }, row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderColor: theme.border }, personIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: "#E8F1FF", alignItems: "center", justifyContent: "center" }, rowCopy: { flex: 1, minWidth: 0 }, name: { color: theme.text, fontSize: 11, fontWeight: "800" }, document: { color: theme.textSecondary, fontSize: 10, marginTop: 3 }, rowStatus: { alignItems: "flex-end", gap: 4 }, time: { color: theme.textSecondary, fontSize: 9 }, status: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }, acceptedStatus: { backgroundColor: "#C8F4E2" }, duplicateStatus: { backgroundColor: "#FFDCD7" }, statusText: { fontSize: 8, fontWeight: "900" }, acceptedText: { color: "#087F55" }, duplicateText: { color: "#C63D30" },
  loadMore: { marginTop: 14, marginBottom: 20, alignSelf: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: blue }, loadMoreText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  errorNotice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: "#FFF2D8", borderWidth: 1, borderColor: "#F1D29A" }, errorTitle: { color: "#783900", fontSize: 12, fontWeight: "900" }, errorText: { color: "#783900", fontSize: 11, marginTop: 2 }, retryButton: { marginTop: 8, backgroundColor: blue, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 }, retryText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 26, gap: 8 }, emptyTitle: { color: theme.text, fontSize: 16, fontWeight: "900" }, emptyText: { color: theme.textSecondary, fontSize: 12, textAlign: "center" },
});
