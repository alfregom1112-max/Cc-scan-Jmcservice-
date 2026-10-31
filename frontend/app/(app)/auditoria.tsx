import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { useSession } from "@/src/ctx/session";
import { api } from "@/src/utils/api";

type AuditEvent = {
  event_type: string;
  aggregate_id: string;
  data: any;
  timestamp: number;
  created_at: string;
  dedup_hash?: string;
};

export default function AuditoriaScreen() {
  const router = useRouter();
  const { eventoId, eventoNombre } = useEvento();
  const { user } = useSession();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!eventoId || user?.role !== "admin") return;
    try {
      const r = await api.auditoria(eventoId);
      setItems(r as AuditEvent[]);
      setLoadError("");
    } catch (error: any) {
      setLoadError(error?.message || "No se pudo actualizar la auditoría. Desliza para volver a intentar.");
    } finally {
      setRefreshing(false);
    }
  }, [eventoId, user?.role]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!eventoId) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [eventoId, load]);

  if (user?.role !== "admin") {
    return <SafeAreaView style={styles.container} edges={["top", "left", "right"]}><View style={styles.emptyWrap}><Ionicons name="lock-closed-outline" size={48} color={theme.textSecondary} /><Text style={styles.emptyTitle}>Solo administradores</Text><Text style={styles.sub}>La auditoría contiene información de control de la empresa.</Text></View></SafeAreaView>;
  }

  if (!eventoId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={64} color={theme.textDisabled} />
          <Text style={styles.emptyTitle}>Sin evento</Text>
          <TouchableOpacity testID="audit-go-eventos" style={styles.btn} onPress={() => router.push("/(app)/eventos")}>
            <Text style={styles.btnText}>Seleccionar evento</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>CONTROL DE LA EMPRESA</Text>
        <Text style={styles.title}>Auditoría</Text>
        <Text style={styles.sub} numberOfLines={1}>Registro de acciones · {eventoNombre}</Text>
      </View>

      <FlatList
        testID="audit-log-list"
        data={items}
        keyExtractor={(it, idx) => `${it.timestamp}_${idx}`}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={theme.info}
          />
        }
        ListHeaderComponent={loadError ? <View style={styles.errorNotice}><Ionicons name="cloud-offline-outline" size={19} color={theme.warning} /><Text style={styles.errorText}>{loadError}</Text></View> : null}
        ListEmptyComponent={<View style={styles.emptyWrap}><Ionicons name={loadError ? "cloud-offline-outline" : "documents-outline"} size={42} color={theme.textDisabled} /><Text style={styles.emptyTitle}>{loadError ? "Auditoría sin actualizar" : "Sin actividad todavía"}</Text><Text style={styles.sub}>{loadError ? "Tus registros no se borraron. Desliza para reintentar." : "Las lecturas y cambios del evento aparecerán aquí."}</Text></View>}
        renderItem={({ item }) => {
          const action = String(item.event_type || "").toLowerCase();
          const isDup = action.includes("duplic");
          const isDestructive = action.includes("delet") || action.includes("clear");
          const color = isDup || isDestructive ? theme.error : theme.brand;
          const bg = isDup || isDestructive ? theme.errorBg : theme.brandLight;
          const label = action === "scan_saved" ? "Asistencia registrada" : action === "event_archived" ? "Evento archivado" : action === "event_scans_cleared" ? "Registros del evento eliminados" : action === "scan_deleted" ? "Registro eliminado" : isDup ? "Intento duplicado" : String(item.event_type || "Actividad").replace(/[_-]+/g, " ");
          return (
            <View testID="audit-log-item" style={styles.item}>
              <View style={[styles.iconBox, { backgroundColor: bg }]}>
                <Ionicons name={isDup || isDestructive ? "alert-circle-outline" : "document-text-outline"} size={20} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemType, { color }]}>{label}</Text>
                <Text style={styles.itemMeta}>{new Date(item.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: 12, gap: 4 },
  eyebrow: { color: theme.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  title: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.6 },
  sub: { color: theme.textSecondary, fontSize: 13, lineHeight: 19 },
  item: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border },
  iconBox: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  itemType: { fontSize: 14, fontWeight: "800" },
  itemMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 5 },
  empty: { color: theme.textDisabled, textAlign: "center", padding: 40 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  errorNotice: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, marginBottom: 10, backgroundColor: theme.warningBg, borderRadius: 13 }, errorText: { flex: 1, color: theme.warning, fontSize: 12, lineHeight: 18 },
  btn: { backgroundColor: theme.info, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: "#fff", fontWeight: "800" },
});
