import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, RefreshControl, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Animated, { FadeInDown } from "react-native-reanimated";
import { theme } from "@/src/theme";
import { useSession } from "@/src/ctx/session";
import { deleteManagedUser, inviteManagedUser, listManagedUsers, updateManagedUser, type ManagedUser } from "@/src/services/adminUsers";
import { listAssignableEvents, listOperatorEventAssignments, setOperatorEventAssignment, type AppEvent } from "@/src/services/supabaseApi";

type Filter = "all" | "active" | "blocked";
const blue = "#0867E8";

export default function UsuariosScreen() {
  const router = useRouter();
  const { user } = useSession();
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinExpiresAt, setPinExpiresAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [actionUser, setActionUser] = useState<ManagedUser | null>(null);
  const [assignUser, setAssignUser] = useState<ManagedUser | null>(null);
  const [assignEvents, setAssignEvents] = useState<AppEvent[]>([]);
  const [assignedEventIds, setAssignedEventIds] = useState<Set<string>>(new Set());
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignBusyEvent, setAssignBusyEvent] = useState("");

  const load = useCallback(async () => {
    try { if (user?.tenant_id) setItems(await listManagedUsers(user.tenant_id)); }
    catch (error: any) { Alert.alert("No se pudo cargar", error?.message || "Revisa la conexión e inténtalo otra vez."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.tenant_id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!pinExpiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((pinExpiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pinExpiresAt]);

  const activeCount = useMemo(() => items.filter((item) => item.status === "active").length, [items]);
  const blockedCount = items.length - activeCount;
  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => item.status === (filter === "active" ? "active" : "inactive")), [filter, items]);
  if (user?.role !== "admin") return <SafeAreaView style={styles.center}><Ionicons name="lock-closed" size={42} color={theme.error} /><Text style={styles.title}>Acceso solo para administradores</Text></SafeAreaView>;

  const createPin = async () => {
    setBusy(true);
    try {
      const result = await inviteManagedUser("operator");
      const expiry = Date.now() + Number(result?.expires_in_minutes || 30) * 60_000;
      setPin(String(result?.pin || "")); setPinExpiresAt(expiry); setCopied(false);
    } catch (error: any) {
      Alert.alert("No se pudo generar", error?.message || "Comprueba la conexión e inténtalo de nuevo.");
    } finally { setBusy(false); }
  };

  const closePin = () => { setShowPin(false); setPin(""); setPinExpiresAt(0); setSecondsLeft(0); };
  const copyPin = async () => {
    if (!pin || secondsLeft <= 0) return;
    await Clipboard.setStringAsync(pin);
    setCopied(true);
  };
  const sharePin = async () => {
    if (!pin || secondsLeft <= 0) return;
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    await Share.share({ message: `Tu PIN de JM ServiceTec es ${pin}. Es válido durante ${mins}:${String(secs).padStart(2, "0")} y se usa una sola vez. Abre la aplicación y crea tu cuenta de operador.` });
  };

  const change = (item: ManagedUser, nextStatus: "active" | "inactive", nextRole?: "admin" | "operator") => {
    if (item.id === user.id && nextStatus === "inactive") return Alert.alert("Acción no permitida", "No puedes bloquear tu propio usuario.");
    Alert.alert(nextStatus === "active" ? "Reactivar usuario" : "Bloquear usuario", `${item.email}\n\n¿Confirmas esta acción?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", style: nextStatus === "inactive" ? "destructive" : "default", onPress: async () => { try { await updateManagedUser(item.id, nextStatus, nextRole); await load(); } catch (error: any) { Alert.alert("No se pudo actualizar", error?.message || "Error de permisos"); } } },
    ]);
  };
  const remove = (item: ManagedUser) => {
    if (item.id === user.id) return Alert.alert("Acción no permitida", "No puedes eliminar tu propio usuario.");
    Alert.alert("Eliminar usuario", `${item.email}\n\nSe eliminará su acceso. ¿Continuar?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => { try { await deleteManagedUser(item.id); await load(); } catch (error: any) { Alert.alert("No se pudo eliminar", error?.message || "Error de permisos"); } } },
    ]);
  };
  const openAssignments = async (item: ManagedUser) => {
    setActionUser(null);
    setAssignUser(item);
    setAssignLoading(true);
    try {
      const [events, assignments] = await Promise.all([
        listAssignableEvents(),
        listOperatorEventAssignments(item.id),
      ]);
      setAssignEvents(events);
      setAssignedEventIds(new Set(assignments.filter((entry) => entry.status === "active").map((entry) => entry.event_id)));
    } catch (error: any) {
      Alert.alert("No se pudieron cargar los eventos", error?.message || "Revisa tu conexión y vuelve a intentarlo.");
    } finally { setAssignLoading(false); }
  };

  const toggleAssignment = async (event: AppEvent) => {
    if (!assignUser || assignBusyEvent) return;
    const wasAssigned = assignedEventIds.has(event.id);
    setAssignBusyEvent(event.id);
    try {
      await setOperatorEventAssignment(assignUser.id, event.id, !wasAssigned);
      setAssignedEventIds((previous) => {
        const next = new Set(previous);
        if (wasAssigned) next.delete(event.id); else next.add(event.id);
        return next;
      });
    } catch (error: any) {
      Alert.alert("No se pudo actualizar el evento", error?.message || "Revisa los permisos del administrador.");
    } finally { setAssignBusyEvent(""); }
  };

  const openActions = (item: ManagedUser) => setActionUser(item);

  const formattedPin = pin.length > 3 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
  const clock = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={blue} />}
      ListHeaderComponent={<>
        <View style={styles.header}><TouchableOpacity style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={21} color={theme.text} /></TouchableOpacity><Text style={styles.heading}>Usuarios y accesos</Text></View>
        <TouchableOpacity style={styles.generateButton} onPress={() => { setPin(""); setShowPin(true); }} activeOpacity={0.86}><Ionicons name="person-add-outline" size={19} color="#fff" /><Text style={styles.generateText}>Generar PIN</Text></TouchableOpacity>
        <View style={styles.filters}>
          <FilterButton title={`Todos (${items.length})`} active={filter === "all"} onPress={() => setFilter("all")} />
          <FilterButton title={`Activos (${activeCount})`} active={filter === "active"} onPress={() => setFilter("active")} />
          <FilterButton title={`Bloqueados (${blockedCount})`} active={filter === "blocked"} onPress={() => setFilter("blocked")} />
        </View>
      </>}
      renderItem={({ item, index }) => <Animated.View entering={FadeInDown.delay(Math.min(index * 30, 180)).duration(180)} style={styles.userRow}>
        <View style={styles.avatar}><Ionicons name="person" size={17} color="#38516C" /></View>
        <View style={styles.userCopy}><Text style={styles.userName} numberOfLines={1}>{item.full_name || "Sin nombre"}</Text><Text style={styles.userRole}>{item.role === "admin" ? "Administrador" : "Operador"}</Text></View>
        <View style={[styles.statusPill, item.status === "active" ? styles.activePill : styles.blockedPill]}><Text style={[styles.statusText, item.status === "active" ? styles.activeText : styles.blockedText]}>{item.status === "active" ? "Activo" : "Bloqueado"}</Text></View>
        <TouchableOpacity style={styles.moreButton} onPress={() => openActions(item)} accessibilityLabel="Opciones de usuario"><Ionicons name="ellipsis-vertical" size={18} color={theme.textSecondary} /></TouchableOpacity>
      </Animated.View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={blue} style={{ marginTop: 35 }} /> : <Text style={styles.empty}>No hay usuarios en esta categoría.</Text>}
    />

    <Modal visible={showPin} transparent animationType="fade" onRequestClose={closePin}>
      <View style={styles.modalBackdrop}><View style={styles.pinModal}>
        <View style={styles.modalHeader}><View style={{ width: 30 }} /><Text style={styles.modalTitle}>{pin ? "Activa tu cuenta" : "Generar PIN"}</Text><TouchableOpacity style={styles.closeButton} onPress={closePin}><Ionicons name="close" size={20} color={theme.textSecondary} /></TouchableOpacity></View>
        <View style={styles.pinIcon}><Ionicons name="person-outline" size={26} color={blue} /></View>
        <Text style={styles.pinDescription}>{pin ? "Comparte este código con el operador para que active su cuenta en la app." : "Autoriza un nuevo operador. La persona creará su nombre, correo y contraseña desde la aplicación."}</Text>
        {pin ? <>
          <View style={styles.pinCodeBox}><Text style={styles.pinCode}>{formattedPin}</Text></View>
          <Text style={styles.expiresLabel}>Este código expira en:</Text><Text style={styles.countdown}>{clock}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={() => void copyPin()} disabled={secondsLeft <= 0}><Ionicons name={copied ? "checkmark" : "copy-outline"} size={17} color={blue} /><Text style={styles.copyText}>{copied ? "Código copiado" : "Copiar código"}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.shareButton} onPress={() => void sharePin()} disabled={secondsLeft <= 0}><Ionicons name="share-social-outline" size={17} color="#fff" /><Text style={styles.shareText}>Compartir código</Text></TouchableOpacity>
          <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={17} color={blue} /><Text style={styles.infoText}>Válido por 30 minutos y solo puede usarse una vez.</Text></View>
        </> : <>
          <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={17} color={blue} /><Text style={styles.infoText}>El PIN es de un solo uso y vence en 30 minutos.</Text></View>
          <TouchableOpacity style={styles.shareButton} onPress={() => void createPin()} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="keypad-outline" size={18} color="#fff" /><Text style={styles.shareText}>Generar PIN</Text></>}</TouchableOpacity>
        </>}
      </View></View>
    </Modal>

    <Modal visible={!!actionUser} transparent animationType="fade" onRequestClose={() => setActionUser(null)}>
      <View style={styles.modalBackdrop}><View style={styles.actionsModal}>
        <View style={styles.modalHeader}><View style={{ width: 30 }} /><Text style={styles.modalTitle} numberOfLines={1}>{actionUser?.full_name || actionUser?.email}</Text><TouchableOpacity style={styles.closeButton} onPress={() => setActionUser(null)}><Ionicons name="close" size={20} color={theme.textSecondary} /></TouchableOpacity></View>
        {actionUser?.role === "operator" && <ActionButton icon="calendar-outline" label="Asignar eventos" onPress={() => void openAssignments(actionUser)} />}
        {actionUser && <ActionButton icon={actionUser.status === "active" ? "lock-closed-outline" : "lock-open-outline"} label={actionUser.status === "active" ? "Bloquear acceso" : "Reactivar acceso"} danger={actionUser.status === "active"} onPress={() => { const target = actionUser; setActionUser(null); change(target, target.status === "active" ? "inactive" : "active"); }} />}
        {actionUser && <ActionButton icon="swap-horizontal-outline" label={actionUser.role === "admin" ? "Cambiar a operador" : "Hacer administrador"} onPress={() => { const target = actionUser; setActionUser(null); change(target, target.status, target.role === "admin" ? "operator" : "admin"); }} />}
        {actionUser && <ActionButton icon="trash-outline" label="Eliminar usuario" danger onPress={() => { const target = actionUser; setActionUser(null); remove(target); }} />}
        <TouchableOpacity style={styles.cancelAction} onPress={() => setActionUser(null)}><Text style={styles.cancelActionText}>Cancelar</Text></TouchableOpacity>
      </View></View>
    </Modal>

    <Modal visible={!!assignUser} transparent animationType="slide" onRequestClose={() => setAssignUser(null)}>
      <View style={styles.modalBackdrop}><View style={styles.assignModal}>
        <View style={styles.modalHeader}><View style={{ width: 30 }} /><Text style={styles.modalTitle}>Eventos de {assignUser?.full_name || "operador"}</Text><TouchableOpacity style={styles.closeButton} onPress={() => setAssignUser(null)}><Ionicons name="close" size={20} color={theme.textSecondary} /></TouchableOpacity></View>
        <Text style={styles.assignHint}>Activa los eventos que esta persona podrá abrir y escanear.</Text>
        {assignLoading ? <ActivityIndicator color={blue} style={{ padding: 24 }} /> : assignEvents.length ? assignEvents.map((event) => {
          const enabled = assignedEventIds.has(event.id);
          const updating = assignBusyEvent === event.id;
          return <TouchableOpacity key={event.id} style={styles.assignRow} onPress={() => void toggleAssignment(event)} disabled={!!assignBusyEvent}>
            <View style={styles.assignEventIcon}><Ionicons name="calendar-outline" size={17} color={blue} /></View>
            <View style={{ flex: 1 }}><Text style={styles.assignEventName} numberOfLines={1}>{event.nombre}</Text><Text style={styles.assignEventMeta}>{event.fecha}{event.lugar ? ` · ${event.lugar}` : ""}</Text></View>
            {updating ? <ActivityIndicator color={blue} /> : <Ionicons name={enabled ? "checkmark-circle" : "ellipse-outline"} size={22} color={enabled ? theme.success : theme.textDisabled} />}
          </TouchableOpacity>;
        }) : <Text style={styles.empty}>No hay eventos activos. Crea un evento primero.</Text>}
        <TouchableOpacity style={styles.doneButton} onPress={() => setAssignUser(null)}><Text style={styles.doneText}>Listo</Text></TouchableOpacity>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

function FilterButton({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) { return <TouchableOpacity style={[styles.filterButton, active && styles.filterButtonActive]} onPress={onPress}><Text style={[styles.filterButtonText, active && styles.filterButtonTextActive]}>{title}</Text></TouchableOpacity>; }

function ActionButton({ icon, label, onPress, danger = false }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; danger?: boolean }) {
  return <TouchableOpacity style={styles.actionRow} onPress={onPress}><Ionicons name={icon} size={19} color={danger ? theme.error : blue} /><Text style={[styles.actionLabel, danger && { color: theme.error }]}>{label}</Text><Ionicons name="chevron-forward" size={17} color={theme.textDisabled} /></TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg }, content: { padding: 16, paddingBottom: 30, gap: 10 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, gap: 10, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }, back: { width: 28, height: 35, justifyContent: "center" }, heading: { color: theme.text, fontSize: 19, fontWeight: "900" },
  generateButton: { height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: blue, borderRadius: 12 }, generateText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  filters: { flexDirection: "row", gap: 6, marginTop: 2, marginBottom: 1 }, filterButton: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 9 }, filterButtonActive: { backgroundColor: blue, borderColor: blue }, filterButtonText: { color: theme.textSecondary, fontSize: 9, fontWeight: "800" }, filterButtonTextActive: { color: "#fff" },
  userRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 7 }, avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#DFEAF4", alignItems: "center", justifyContent: "center" }, userCopy: { flex: 1, minWidth: 0 }, userName: { color: theme.text, fontSize: 11, fontWeight: "900" }, userRole: { color: theme.textSecondary, fontSize: 9, marginTop: 3 }, statusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 }, activePill: { backgroundColor: "#C8F4E2" }, blockedPill: { backgroundColor: "#FFDCD7" }, statusText: { fontSize: 8, fontWeight: "900" }, activeText: { color: "#087F55" }, blockedText: { color: "#C63D30" }, moreButton: { width: 26, height: 36, alignItems: "center", justifyContent: "center" }, empty: { textAlign: "center", color: theme.textSecondary, padding: 30 }, title: { color: theme.text, fontSize: 19, fontWeight: "900", textAlign: "center" },
  modalBackdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(10,25,43,0.52)" }, pinModal: { width: "100%", maxWidth: 430, backgroundColor: theme.surface, borderRadius: 22, padding: 17, alignItems: "center", borderWidth: 1, borderColor: theme.border }, modalHeader: { width: "100%", minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, modalTitle: { color: theme.text, fontSize: 13, fontWeight: "900" }, closeButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, pinIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: "#E4F0FF", alignItems: "center", justifyContent: "center", marginTop: 10 }, pinDescription: { color: theme.textSecondary, textAlign: "center", fontSize: 11, lineHeight: 16, marginTop: 9, marginHorizontal: 12 }, pinCodeBox: { width: "100%", backgroundColor: "#E8F2FF", borderRadius: 13, paddingVertical: 11, marginTop: 14, alignItems: "center" }, pinCode: { color: blue, fontSize: 27, fontWeight: "900", letterSpacing: 2 }, expiresLabel: { color: theme.textSecondary, fontSize: 10, marginTop: 8 }, countdown: { color: theme.text, fontSize: 20, fontWeight: "900", marginTop: 1 },
  copyButton: { width: "100%", minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: blue, borderRadius: 10, marginTop: 12 }, copyText: { color: blue, fontSize: 11, fontWeight: "900" }, shareButton: { width: "100%", minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: blue, borderRadius: 10, marginTop: 7 }, shareText: { color: "#fff", fontSize: 11, fontWeight: "900" }, infoBox: { width: "100%", minHeight: 41, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EAF4FF", borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 }, infoText: { flex: 1, color: "#426485", fontSize: 9, lineHeight: 13 },
  actionsModal: { width: "100%", maxWidth: 430, backgroundColor: theme.surface, borderRadius: 20, padding: 15, borderWidth: 1, borderColor: theme.border }, actionRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderColor: theme.border }, actionLabel: { flex: 1, color: theme.text, fontSize: 12, fontWeight: "800" }, cancelAction: { minHeight: 42, alignItems: "center", justifyContent: "center", marginTop: 5 }, cancelActionText: { color: theme.textSecondary, fontSize: 12, fontWeight: "800" },
  assignModal: { width: "100%", maxWidth: 440, maxHeight: "82%", backgroundColor: theme.surface, borderRadius: 20, padding: 15, borderWidth: 1, borderColor: theme.border }, assignHint: { color: theme.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 6, marginBottom: 8 }, assignRow: { minHeight: 57, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderColor: theme.border }, assignEventIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#E7F0FF", alignItems: "center", justifyContent: "center" }, assignEventName: { color: theme.text, fontSize: 11, fontWeight: "900" }, assignEventMeta: { color: theme.textSecondary, fontSize: 9, marginTop: 3 }, doneButton: { minHeight: 42, alignItems: "center", justifyContent: "center", backgroundColor: blue, borderRadius: 10, marginTop: 12 }, doneText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});
