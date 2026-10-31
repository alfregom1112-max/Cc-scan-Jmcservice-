import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { theme } from "@/src/theme";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";

export default function PerfilScreen() {
  const { user, signOut } = useSession();
  const { eventoNombre, wsStatus, clearEvento } = useEvento();
  const router = useRouter();
  const isAdmin = user?.role === "admin";
  const version = Constants.expoConfig?.version || "1.0.0";
  const syncLabel = wsStatus === "online" ? "En tiempo real" : wsStatus === "connecting" ? "Conectando" : "Sin conexión";
  const syncColor = wsStatus === "online" ? theme.success : wsStatus === "connecting" ? theme.warning : theme.error;

  const handleLogout = () => Alert.alert("Cerrar sesión", "¿Deseas cerrar sesión?", [
    { text: "Cancelar", style: "cancel" },
    { text: "Cerrar sesión", style: "destructive", onPress: async () => { clearEvento(); await signOut(); router.replace("/sign-in"); } },
  ]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityLabel="Volver"><Ionicons name="arrow-back" size={21} color={theme.text} /></TouchableOpacity>
          <Text style={styles.headerTitle}>Mi perfil</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.profileCard}>
          <View style={styles.avatar}><Ionicons name="person-outline" size={31} color="#12325B" /></View>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.name} numberOfLines={1}>{user?.nombre || "Usuario"}</Text><Text style={styles.role}>{isAdmin ? "Administrador" : "Operador"}</Text><Text style={styles.email} numberOfLines={1}>{user?.email}</Text></View>
        </View>

        <View style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingRow} onPress={async () => { await clearEvento(); router.push("/(app)/eventos" as any); }}>
            <View style={styles.settingIcon}><Ionicons name="calendar-outline" size={18} color={theme.info} /></View>
            <View style={styles.settingCopy}><Text style={styles.settingTitle}>Evento actual</Text><Text style={styles.settingValue} numberOfLines={1}>{eventoNombre || "Sin evento seleccionado"}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={styles.settingIcon}><Ionicons name="phone-portrait-outline" size={18} color={theme.info} /></View>
            <View style={styles.settingCopy}><Text style={styles.settingTitle}>Dispositivo</Text><Text style={styles.settingValue}>Este dispositivo</Text></View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={styles.settingIcon}><Ionicons name="cloud-outline" size={18} color={theme.info} /></View>
            <View style={styles.settingCopy}><Text style={styles.settingTitle}>Sincronización</Text><View style={styles.syncRow}><View style={[styles.dot, { backgroundColor: syncColor }]} /><Text style={[styles.settingValue, { color: syncColor }]}>{syncLabel}</Text></View></View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={styles.settingIcon}><Ionicons name="shield-checkmark-outline" size={18} color={theme.info} /></View>
            <View style={styles.settingCopy}><Text style={styles.settingTitle}>Versión de la app</Text><Text style={styles.settingValue}>{version}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </View>
        </View>

        <TouchableOpacity testID="logout-button" style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={19} color={theme.error} /><Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg }, content: { padding: 16, paddingBottom: 28, gap: 15 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }, back: { width: 40, height: 40, justifyContent: "center" }, headerTitle: { color: theme.text, fontSize: 20, fontWeight: "900" },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#DCEBFF", alignItems: "center", justifyContent: "center" }, name: { color: theme.text, fontSize: 14, fontWeight: "900" }, role: { color: theme.textSecondary, fontSize: 11, marginTop: 2 }, email: { color: theme.textDisabled, fontSize: 10, marginTop: 2 },
  settingsCard: { paddingHorizontal: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 17 }, settingRow: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 10 }, settingIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#EAF2FF", alignItems: "center", justifyContent: "center" }, settingCopy: { flex: 1, minWidth: 0 }, settingTitle: { color: theme.text, fontSize: 11, fontWeight: "800" }, settingValue: { color: theme.textSecondary, fontSize: 10, marginTop: 4 }, syncRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 }, dot: { width: 7, height: 7, borderRadius: 4 }, divider: { height: 1, backgroundColor: theme.border, marginLeft: 44 },
  logoutBtn: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: theme.error, borderRadius: 13, backgroundColor: theme.surface, marginTop: 1 }, logoutText: { color: theme.error, fontSize: 13, fontWeight: "900" },
});
