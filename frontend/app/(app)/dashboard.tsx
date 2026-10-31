import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { useEvento } from "@/src/ctx/evento";
import { api } from "@/src/utils/api";
import { useSession } from "@/src/ctx/session";

type Estado = { total: number; hoy: number; duplicados_detectados: number; dispositivos_usados: number; dispositivos_activos: number };
const blue = "#0867E8";

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { eventoId, eventoNombre, wsStatus, queueSize, totalRegistros, activos, registros } = useEvento();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!eventoId) { setEstado(null); return; }
    setLoading(true);
    try { setEstado(await api.estado(eventoId)); } catch { /* El panel conserva la lectura local disponible. */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [eventoId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!eventoId) return;
    const interval = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(interval);
  }, [eventoId, load]);

  const total = estado?.total ?? totalRegistros;
  const duplicates = estado?.duplicados_detectados ?? 0;
  const accepted = Math.max(total - duplicates, 0);
  const connected = wsStatus === "online";
  const statusColor = connected ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={blue} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}><Text style={styles.brand}>JM ServiceTec</Text><Text style={{ color: theme.text, fontSize: 27, fontWeight: "800", marginTop: 18 }}>Hola, {user?.nombre?.split(" ")[0] || "bienvenido"}</Text><Text style={{ color: theme.textSecondary, marginTop: 5, fontSize: 14 }}>{user?.tenant_name || "Tu empresa"}</Text><View style={styles.adminTag}><Text style={styles.adminTagText}>{user?.is_platform_admin ? "Superadministrador" : "Administrador"}</Text></View></View>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.push("/(app)/usuarios" as any)} accessibilityLabel="Administrar usuarios"><Ionicons name="settings-outline" size={21} color={theme.text} /></TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Operación de hoy</Text>
        <TouchableOpacity style={styles.eventSelect} onPress={() => router.push("/(app)/eventos" as any)} activeOpacity={0.85}>
          <View style={styles.eventIcon}><Ionicons name="calendar-outline" size={20} color={blue} /></View>
          <View style={{ flex: 1 }}><Text style={styles.eventName} numberOfLines={1}>{eventoNombre || "Seleccionar evento"}</Text><Text style={styles.eventMeta}>{eventoId ? "Evento operativo activo" : "Elige una jornada para ver su resumen"}</Text></View>
          <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          testID="admin-start-scan"
          style={[styles.scanButton, !eventoId && styles.scanButtonDisabled]}
          onPress={() => eventoId ? router.push("/(app)/escanear" as any) : router.push("/(app)/eventos" as any)}
          activeOpacity={0.88}
        >
          <Ionicons name="scan-outline" size={22} color="#fff" />
          <Text style={styles.scanButtonText}>{eventoId ? "Empezar a escanear" : "Elegir evento para escanear"}</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}><View style={styles.kpiTop}><View style={[styles.kpiIcon, { backgroundColor: "#E7F0FF" }]}><Ionicons name="people-outline" size={17} color={blue} /></View><Text style={styles.kpiLabel}>Total registros</Text></View><Text style={styles.kpiValue}>{total.toLocaleString("es-CO")}</Text></View>
          <View style={styles.kpiCard}><View style={styles.kpiTop}><View style={[styles.kpiIcon, { backgroundColor: theme.successBg }]}><Ionicons name="checkmark-circle-outline" size={17} color={theme.success} /></View><Text style={styles.kpiLabel}>Aceptados</Text></View><Text style={styles.kpiValue}>{accepted.toLocaleString("es-CO")}</Text></View>
          <View style={styles.kpiCard}><View style={styles.kpiTop}><View style={[styles.kpiIcon, { backgroundColor: theme.errorBg }]}><Ionicons name="alert-circle-outline" size={17} color={theme.error} /></View><Text style={styles.kpiLabel}>Duplicados</Text></View><Text style={styles.kpiValue}>{duplicates.toLocaleString("es-CO")}</Text></View>
          <View style={styles.kpiCard}><View style={styles.kpiTop}><View style={[styles.kpiIcon, { backgroundColor: "#FFF3E0" }]}><Ionicons name="warning-outline" size={17} color="#D98A00" /></View><Text style={styles.kpiLabel}>Pendientes</Text></View><Text style={styles.kpiValue}>{queueSize.toLocaleString("es-CO")}</Text></View>
        </View>

        <View style={styles.operatorCard}>
          <View style={styles.operatorIcon}><Ionicons name="people" size={19} color={blue} /></View>
          <View style={{ flex: 1 }}><Text style={styles.operatorLabel}>Operadores conectados</Text><Text style={styles.operatorValue}>{estado?.dispositivos_activos ?? activos} <Text style={styles.operatorMuted}>de {estado?.dispositivos_usados ?? activos}</Text></Text></View>
          <View style={styles.onlineState}><View style={[styles.onlineDot, { backgroundColor: statusColor }]} /><Text style={[styles.onlineText, { color: statusColor }]}>{connected ? "En línea" : wsStatus === "connecting" ? "Conectando" : "Sin conexión"}</Text></View>
        </View>

        <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Actividad reciente</Text><TouchableOpacity onPress={() => router.push("/(app)/auditoria" as any)}><Text style={styles.seeAll}>Ver todo</Text></TouchableOpacity></View>
        <View style={styles.activityList}>
          {loading && !registros.length ? <ActivityIndicator color={blue} style={{ padding: 20 }} /> : registros.slice(0, 4).map((row, index) => (
            <View key={`${row.id}-${index}`} style={[styles.activityRow, index > 0 && styles.activityBorder]}>
              <View style={styles.activityIcon}><Ionicons name="checkmark-circle" size={18} color={theme.success} /></View>
              <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.activityName} numberOfLines={1}>{row.nombre || "Registro aceptado"}</Text><Text style={styles.activityDocument}>{row.cedula}</Text></View>
              <Text style={styles.activityTime}>{row.created_at ? new Date(row.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "Ahora"}</Text>
            </View>
          ))}
          {!loading && !registros.length && <Text style={styles.emptyText}>{eventoId ? "Aún no hay registros en este evento." : "Selecciona un evento para ver la actividad."}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg }, content: { padding: 20, paddingBottom: 32, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 2 }, brand: { color: theme.text, fontSize: 23, fontWeight: "900", letterSpacing: -0.6 },
  adminTag: { alignSelf: "flex-start", backgroundColor: "#DCEBFF", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginTop: 4 }, adminTagText: { color: blue, fontSize: 10, fontWeight: "800" },
  iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  sectionTitle: { color: theme.text, fontSize: 19, fontWeight: "800" }, eventSelect: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 17 },
  scanButton: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 15, backgroundColor: "#0867E8", borderRadius: 14 }, scanButtonDisabled: { backgroundColor: theme.brand }, scanButtonText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "900" },
  eventIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#E7F0FF", alignItems: "center", justifyContent: "center" }, eventName: { color: theme.text, fontSize: 12, fontWeight: "900" }, eventMeta: { color: theme.textSecondary, fontSize: 10, marginTop: 3 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, kpiCard: { width: "48.5%", minHeight: 100, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 16, padding: 13 },
  kpiTop: { flexDirection: "row", alignItems: "center", gap: 8 }, kpiIcon: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center" }, kpiLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: "700", flexShrink: 1 }, kpiValue: { color: theme.text, fontSize: 23, fontWeight: "900", marginTop: 7 },
  operatorCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EAF4FF", borderRadius: 15, padding: 12 }, operatorIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#D8E9FF", alignItems: "center", justifyContent: "center" }, operatorLabel: { color: theme.text, fontSize: 11, fontWeight: "800" }, operatorValue: { color: theme.text, fontSize: 13, fontWeight: "900", marginTop: 2 }, operatorMuted: { color: theme.textSecondary, fontWeight: "600", fontSize: 11 }, onlineState: { flexDirection: "row", alignItems: "center", gap: 5 }, onlineDot: { width: 7, height: 7, borderRadius: 4 }, onlineText: { fontSize: 9, fontWeight: "800" },
  activityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }, seeAll: { color: blue, fontSize: 12, fontWeight: "800" }, activityList: { backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 13 }, activityRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10 }, activityBorder: { borderTopWidth: 1, borderColor: theme.border }, activityIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: theme.successBg, alignItems: "center", justifyContent: "center" }, activityName: { color: theme.text, fontSize: 12, fontWeight: "800" }, activityDocument: { color: theme.textSecondary, fontSize: 11, marginTop: 3 }, activityTime: { color: theme.textDisabled, fontSize: 11 }, emptyText: { color: theme.textSecondary, fontSize: 13, textAlign: "center", padding: 20 },
});
