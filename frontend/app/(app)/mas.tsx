import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";
import { theme } from "@/src/theme";

export default function ResourcesScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { queueSize, wsStatus } = useEvento();
  const admin = user?.role === "admin";
  const syncColor = queueSize ? theme.warning : wsStatus === "online" ? theme.success : theme.textSecondary;
  const resources = [
    ...(admin && user?.is_platform_admin ? [{ title: "Empresas y membresías", detail: "Tenants, planes y estado de las cuentas", icon: "business-outline", route: "/(app)/tenants" }] : []),
    ...(admin ? [
      { title: "Auditoría", detail: "Trazabilidad de lecturas y acciones", icon: "shield-checkmark-outline", route: "/(app)/auditoria" },
      { title: "Equipo y operadores", detail: "Invitaciones, permisos y eventos asignados", icon: "people-outline", route: "/(app)/usuarios" },
      { title: "Reportes y registros", detail: "Métricas, exportación y base de personas", icon: "bar-chart-outline", route: "/(app)/admin" },
    ] : []),
    { title: "Historial de escaneos", detail: admin ? "Lecturas y resultados del evento activo" : "Tus lecturas y registros pendientes", icon: "time-outline", route: "/(app)/historial" },
    { title: "Perfil y dispositivo", detail: "Cuenta, evento activo y sincronización", icon: "person-circle-outline", route: "/(app)/perfil" },
  ];
  return <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.brand}>JM ServiceTec</Text>
      <Text style={styles.title}>Recursos</Text>
      <Text style={styles.subtitle}>{user?.tenant_name || "Tu empresa"} · {user?.is_platform_admin && admin ? "Superadministrador" : admin ? "Administrador" : "Operador"}</Text>
      <TouchableOpacity style={styles.scan} onPress={() => router.push("/(app)/escanear" as any)} accessibilityRole="button">
        <Ionicons name="scan-outline" size={22} color="#fff" />
        <Text style={styles.scanText}>Abrir escáner</Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.groupTitle}>{admin ? "ADMINISTRACIÓN Y CONTROL" : "MI JORNADA"}</Text>
      <View style={[styles.sync, { backgroundColor: queueSize ? theme.warningBg : wsStatus === "online" ? theme.successBg : theme.surface }]}>
        <Ionicons name={wsStatus === "online" ? "cloud-done-outline" : "cloud-offline-outline"} color={syncColor} size={25} />
        <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{queueSize ? `${queueSize} registros por sincronizar` : "Sin registros pendientes"}</Text><Text style={styles.detail}>{wsStatus === "online" ? "Conexión disponible" : "La cola local conserva los registros pendientes"}</Text></View>
      </View>
      <View style={styles.list}>{resources.map(item => <TouchableOpacity key={item.route} accessibilityRole="button" style={styles.row} onPress={() => router.push(item.route as any)}>
        <View style={styles.icon}><Ionicons name={item.icon as any} size={23} color={theme.brand} /></View>
        <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </TouchableOpacity>)}</View>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg }, content: { padding: 20, gap: 14, paddingBottom: 32 },
  brand: { color: theme.brand, fontSize: 20, fontWeight: "800" }, title: { color: theme.text, fontSize: 30, fontWeight: "800", marginTop: 12 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 21 }, sync: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.successBg, borderRadius: 16, padding: 16 },
  scan: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, backgroundColor: theme.brand, borderRadius: 15 }, scanText: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 }, groupTitle: { color: theme.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1.1, marginTop: 5 },
  list: { backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1, borderColor: theme.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, minHeight: 82, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  icon: { backgroundColor: theme.brandLight, width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: theme.text, fontSize: 15, fontWeight: "700" }, detail: { color: theme.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
