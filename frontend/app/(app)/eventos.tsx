import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";
import { api } from "@/src/utils/api";
import { useEvento } from "@/src/ctx/evento";
import { useSession } from "@/src/ctx/session";

type Evento = {
  id: string;
  nombre: string;
  fecha: string;
  lugar: string;
  descripcion: string;
  activo: boolean;
  total_registros: number;
};

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });
}

function normalizeEventDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return todayIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export default function EventosScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { selectEvento, clearEvento, eventoId, totalRegistros, wsStatus, queueSize } = useEvento();
  const isAdmin = user?.role === "admin";
  const membershipActive = user?.subscription_status === "internal" ||
    ((user?.subscription_status === "active" || user?.subscription_status === "trial") &&
      !!user.current_period_ends_at && Date.parse(user.current_period_ends_at) > Date.now());
  const [items, setItems] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", fecha: todayIso(), lugar: "", descripcion: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listEventos();
      setItems(list as Evento[]);
      setLoadError("");
    } catch (error: any) {
      setLoadError(error?.message || "No se pudieron cargar los eventos. Revisa tu conexión o permisos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onCreate = async () => {
    if (!nuevo.nombre) {
      Alert.alert("Faltan datos", "El nombre es obligatorio");
      return;
    }
    const fecha = normalizeEventDate(nuevo.fecha);
    if (!fecha) {
      Alert.alert("Fecha inválida", "Usa YYYY-MM-DD o DD/MM/YYYY");
      return;
    }
    setCreating(true);
    try {
      await api.createEvento({ ...nuevo, fecha });
      setShowCreate(false);
      setNuevo({ nombre: "", fecha: todayIso(), lugar: "", descripcion: "" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo crear"));
    } finally {
      setCreating(false);
    }
  };

  const onSelect = (item: Evento) => {
    // Select the event immediately; record hydration runs in the background so
    // the user is never left waiting on a network round-trip just to continue.
    void selectEvento(item.id, item.nombre);
    if (isAdmin) router.replace("/(app)/dashboard" as any);
  };

  if (eventoId && !isAdmin) {
    const selected = items.find((item) => item.id === eventoId);
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.operatorHome}>
          <View style={styles.operatorHeader}>
            <Text style={styles.brandWord}>JM ServiceTec</Text>
            <TouchableOpacity style={styles.profileShortcut} onPress={() => router.push("/(app)/perfil" as any)} accessibilityLabel="Mi perfil"><Ionicons name="person-outline" size={22} color={theme.text} /></TouchableOpacity>
          </View>
          <View style={styles.connectedCard}>
            <View style={styles.connectedDot} />
            <View style={{ flex: 1 }}><Text style={styles.connectedText}>{wsStatus === "online" ? "Conectado" : wsStatus === "connecting" ? "Conectando" : "Sin conexión"}</Text><Text style={styles.connectedMeta}>{queueSize ? `${queueSize} registros por sincronizar` : "Sincronizando en tiempo real"}</Text></View>
            <Ionicons name={wsStatus === "online" ? "wifi" : "cloud-offline-outline"} size={20} color={wsStatus === "online" ? theme.success : theme.warning} />
          </View>
          <Text style={styles.eventSectionTitle}>Evento actual</Text>
          <TouchableOpacity style={styles.eventHero} activeOpacity={0.88} onPress={() => clearEvento()}>
            <View style={styles.eventHeroIcon}><Ionicons name="calendar-outline" size={24} color={theme.info} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventHeroTitle} numberOfLines={2}>{selected?.nombre || "Evento seleccionado"}</Text>
              <Text style={styles.eventHeroMeta}>{selected?.lugar || "Operativo activo"}{selected?.fecha ? ` · ${selected.fecha}` : ""}</Text>
            </View>
            <Ionicons name="chevron-down" size={19} color={theme.textSecondary} />
          </TouchableOpacity>
          {!membershipActive && <View style={styles.subscriptionNotice}><Ionicons name="alert-circle-outline" size={18} color={theme.warning} /><Text style={styles.subscriptionNoticeText}>La membresía de esta empresa no está activa. Los escaneos se habilitan al activar o renovar el plan.</Text></View>}
          <TouchableOpacity activeOpacity={0.9} disabled={!membershipActive} onPress={() => membershipActive ? router.push("/(app)/escanear") : undefined} style={!membershipActive ? { opacity: 0.45 } : undefined}>
            <LinearGradient colors={["#06BFA5", "#079AA5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.scanHero}>
              <Ionicons name="scan-outline" size={54} color="#fff" />
              <Text style={styles.scanHeroTitle}>Empezar a escanear</Text>
            </LinearGradient>
          </TouchableOpacity>
          <View style={styles.homeCount}><Ionicons name="checkmark-circle" size={17} color={theme.success} /><Text style={styles.homeCountText}>{totalRegistros} registros en este evento</Text></View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.info} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>OPERACIONES</Text>
          <Text style={styles.title}>Tus eventos</Text>
          <Text style={styles.subtitle}>Selecciona un operativo para activar el escáner</Text>
        </View>
        {isAdmin && membershipActive && <TouchableOpacity
          testID="open-create-evento"
          style={styles.addBtn}
          onPress={() => {
            setNuevo((current) => ({ ...current, fecha: current.fecha || todayIso() }));
            setShowCreate(true);
          }}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>}
      </View>

      {!membershipActive && <View style={styles.subscriptionNotice}><Ionicons name="alert-circle-outline" size={18} color={theme.warning} /><Text style={styles.subscriptionNoticeText}>Membresía {user?.subscription_status === "pending_payment" ? "pendiente de pago" : "inactiva"}. Contacta a JM ServiceTec para activarla.</Text></View>}
      <FlatList
        testID="event-list"
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={theme.info}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name={loadError ? "cloud-offline-outline" : "calendar-outline"} size={48} color={theme.textDisabled} />
            <Text style={styles.emptyText}>{loadError || (!membershipActive ? "La membresía debe estar activa para consultar y operar eventos." : isAdmin ? "No hay eventos. Crea el primero." : "No tienes eventos asignados. Pídele al administrador que te asigne uno.")}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void load(); }}><Text style={styles.retryText}>{loadError ? "Reintentar" : "Actualizar"}</Text></TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            testID="event-card-item"
            style={[styles.card, eventoId === item.id && styles.cardActive]}
            onPress={() => onSelect(item)}
            activeOpacity={0.8}
          >
            <View style={styles.cardLeft}>
              <View style={styles.cardIcon}>
                <Ionicons name="qr-code" size={22} color={theme.info} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.nombre}
                </Text>
                <Text style={styles.cardMeta}>
                  {item.fecha}
                  {item.lugar ? ` · ${item.lugar}` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardCount}>{item.total_registros}</Text>
              <Text style={styles.cardCountLabel}>registros</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalWrap}
        >
          <ScrollView contentContainerStyle={[styles.modalSheet, Platform.OS === "web" && styles.modalSheetWeb]} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Nuevo evento</Text>

            <Text style={styles.label}>Nombre</Text>
            <TextInput
              testID="create-evento-nombre"
              style={styles.input}
              value={nuevo.nombre}
              onChangeText={(t) => setNuevo({ ...nuevo, nombre: t })}
              placeholder="Ej: Convención Anual 2026"
              placeholderTextColor={theme.textDisabled}
            />

            <Text style={styles.label}>Fecha</Text>
            <TextInput
              testID="create-evento-fecha"
              style={styles.input}
              value={nuevo.fecha}
              onChangeText={(t) => setNuevo({ ...nuevo, fecha: t })}
              placeholder={todayIso()}
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Lugar</Text>
            <TextInput
              testID="create-evento-lugar"
              style={styles.input}
              value={nuevo.lugar}
              onChangeText={(t) => setNuevo({ ...nuevo, lugar: t })}
              placeholder="Ej: Bogotá - Centro de Convenciones"
              placeholderTextColor={theme.textDisabled}
            />

            <Text style={styles.label}>Descripción</Text>
            <TextInput
              testID="create-evento-descripcion"
              style={[styles.input, { height: 80, textAlignVertical: "top" }]}
              value={nuevo.descripcion}
              onChangeText={(t) => setNuevo({ ...nuevo, descripcion: t })}
              placeholder="Opcional"
              placeholderTextColor={theme.textDisabled}
              multiline
            />

            <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.surfaceElevated }]}
                onPress={() => setShowCreate(false)}
              >
                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="create-evento-submit"
                style={[styles.modalBtn, { backgroundColor: theme.info }]}
                onPress={onCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnText}>Crear evento</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  operatorHome: { padding: 18, paddingTop: 8, paddingBottom: 24, gap: 16 },
  operatorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  brandWord: { color: theme.text, fontSize: 23, fontWeight: "900", letterSpacing: -0.6 },
  profileShortcut: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 },
  connectedCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#EAF8FA", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
  connectedDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: theme.success },
  connectedText: { color: theme.text, fontSize: 12, fontWeight: "900" },
  connectedMeta: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  eventSectionTitle: { color: theme.text, fontSize: 13, fontWeight: "900", marginBottom: -8 },
  eventHero: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#EAF2FF", borderRadius: 16, padding: 13, borderWidth: 1, borderColor: "#DCE9FF" },
  eventHeroIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: "#DDEAFF", alignItems: "center", justifyContent: "center" },
  eventHeroTitle: { color: theme.text, fontSize: 14, fontWeight: "900" },
  eventHeroMeta: { color: theme.textSecondary, fontSize: 10, marginTop: 4 },
  scanHero: { height: 178, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 10, shadowColor: theme.brand, shadowOpacity: 0.2, shadowRadius: 12, elevation: 5 },
  scanHeroTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  homeCount: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  homeCountText: { color: theme.textSecondary, fontSize: 11, fontWeight: "700" },
  container: { flex: 1, backgroundColor: theme.bg },
  subscriptionNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginHorizontal: 16, marginVertical: 9, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#F2D5A4", backgroundColor: theme.warningBg },
  subscriptionNoticeText: { flex: 1, color: theme.warning, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 18,
    paddingHorizontal: 20,
  },
  title: { color: theme.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.8 },
  eyebrow: { color: theme.brand, fontSize: 10, fontWeight: "900", letterSpacing: 2, marginBottom: 5 },
  subtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
  addBtn: {
    backgroundColor: theme.info,
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  empty: { alignItems: "center", justifyContent: "center", padding: 60, gap: 12 },
  emptyText: { color: theme.textSecondary, fontSize: 14 },
  retryButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.info },
  retryText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActive: { borderColor: theme.info },
  cardLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: theme.infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: theme.text, fontWeight: "800", fontSize: 16 },
  cardMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  cardRight: { alignItems: "flex-end" },
  cardCount: { color: theme.text, fontWeight: "900", fontSize: 22 },
  cardCountLabel: { color: theme.textDisabled, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  modalSheetWeb: {
    width: "min(100%, 720px)" as any,
    alignSelf: "center",
    borderRadius: 24,
    marginHorizontal: 20,
    marginBottom: 24,
    maxHeight: "90%" as any,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    backgroundColor: theme.border,
    borderRadius: 2,
    marginBottom: 12,
  },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  label: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
