import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";
import { createTenant, listTenants, updateTenantSubscription, type TenantRecord } from "@/src/services/tenantAdmin";

const periods = [{ value: "monthly", label: "Mensual" }, { value: "annual", label: "Anual" }] as const;
const statusLabel: Record<string, string> = { internal: "Cuenta JM ServiceTec", trial: "Prueba", pending_payment: "Pendiente de pago", active: "Activa", past_due: "Pago vencido", suspended: "Suspendida", cancelled: "Cancelada" };
const fmtDate = (value: string | null) => value ? new Date(value).toLocaleDateString("es-CO") : "Sin fecha de vencimiento";
const fmtMoney = (value: number | null) => value == null ? "Tarifa por definir" : `$${value.toLocaleString("es-CO")} COP`;

export default function TenantAdminScreen() {
  const router = useRouter();
  const { user } = useSession();
  const [items, setItems] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [price, setPrice] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await listTenants()); }
    catch (error: any) { Alert.alert("No se pudo cargar", error?.message || "Revisa la conexión y los permisos."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    const numericPrice = price.trim() ? Number(price.replace(/[^0-9]/g, "")) : undefined;
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim()) || (price.trim() && (!Number.isSafeInteger(numericPrice) || Number(numericPrice) < 0))) {
      Alert.alert("Revisa los datos", "Indica el nombre de la empresa, un correo válido y, si quieres, la tarifa en pesos sin separadores.");
      return;
    }
    setCreating(true);
    try {
      const result = await createTenant({ name: name.trim(), owner_email: ownerEmail.trim().toLowerCase(), billing_period: period, price_cop: numericPrice });
      setName(""); setOwnerEmail(""); setPrice("");
      await load();
      Alert.alert("Empresa creada", `${result.tenant.name} quedó pendiente de pago. Comparte este PIN con su responsable para activar la cuenta de administrador: ${result.pin}. Vence en ${result.expires_in_minutes} minutos. Activa la membresía cuando confirmes el pago.`);
    } catch (error: any) { Alert.alert("No se pudo crear", error?.message || "Revisa Supabase y vuelve a intentar."); }
    finally { setCreating(false); }
  };

  const changeStatus = (tenant: TenantRecord, action: "activate" | "renew" | "suspend" | "cancel") => {
    const title = action === "activate" ? "Activar membresía" : action === "renew" ? "Renovar membresía" : action === "suspend" ? "Suspender empresa" : "Cancelar membresía";
    const message = action === "activate"
      ? `Confirma primero que recibiste el pago. Se activará el plan ${tenant.billing_period === "annual" ? "anual" : "mensual"}.`
      : action === "renew" ? "Confirma el pago antes de extender el periodo." : action === "suspend" ? "Se detendrá la lectura sincronizada para esta empresa. Sus registros no se borran." : "La membresía se cancelará. Los datos existentes no se borran.";
    Alert.alert(title, message, [
      { text: "Volver", style: "cancel" },
      { text: title, style: action === "suspend" || action === "cancel" ? "destructive" : "default", onPress: async () => {
        setBusyId(tenant.id);
        try { await updateTenantSubscription(tenant.id, action); await load(); }
        catch (error: any) { Alert.alert("No se pudo actualizar", error?.message || "Revisa los permisos del administrador."); }
        finally { setBusyId(""); }
      } },
    ]);
  };

  const canManage = user?.is_platform_admin === true;
  const counts = useMemo(() => ({ total: items.length, active: items.filter((item) => item.subscription_status === "active" || item.subscription_status === "internal").length }), [items]);
  if (!canManage) return <SafeAreaView style={styles.center}><Ionicons name="lock-closed" size={42} color={theme.error} /><Text style={styles.title}>Acceso exclusivo de JM ServiceTec</Text><Text style={styles.sub}>Esta sección administra las empresas y membresías del servicio.</Text></SafeAreaView>;

  return <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.brand} />}
      ListHeaderComponent={<View>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={18} color={theme.brand} /><Text style={styles.backText}>Volver a gestión</Text></TouchableOpacity>
        <Text style={styles.kicker}>JM SERVICETEC · PLATAFORMA</Text>
        <Text style={styles.title}>Empresas y membresías</Text>
        <Text style={styles.sub}>Registra clientes, genera el PIN de su administrador y activa el plan mensual o anual después de confirmar el pago.</Text>
        <View style={styles.stats}><Text style={styles.statsText}>{counts.total} empresas</Text><Text style={styles.statsText}>{counts.active} activas</Text></View>
        <View style={styles.form}>
          <Text style={styles.formTitle}>Crear empresa cliente</Text>
          <Text style={styles.label}>Nombre comercial o razón social</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Empresa de eventos" placeholderTextColor={theme.textDisabled} style={styles.input} maxLength={120} />
          <Text style={styles.label}>Correo del responsable</Text>
          <TextInput value={ownerEmail} onChangeText={setOwnerEmail} placeholder="responsable@empresa.com" placeholderTextColor={theme.textDisabled} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.label}>Periodo de membresía</Text>
          <View style={styles.periodRow}>{periods.map((item) => <TouchableOpacity key={item.value} style={[styles.periodBtn, period === item.value && styles.periodSelected]} onPress={() => setPeriod(item.value)}><Text style={[styles.periodText, period === item.value && styles.periodSelectedText]}>{item.label}</Text></TouchableOpacity>)}</View>
          <Text style={styles.label}>Tarifa del periodo en COP (opcional)</Text>
          <TextInput value={price} onChangeText={(value) => setPrice(value.replace(/[^0-9]/g, ""))} placeholder="Pendiente de definir" placeholderTextColor={theme.textDisabled} style={styles.input} keyboardType="number-pad" />
          <TouchableOpacity style={styles.createBtn} onPress={() => void create()} disabled={creating}>{creating ? <ActivityIndicator color="#fff" /> : <><Ionicons name="add-circle-outline" size={18} color="#fff" /><Text style={styles.createText}>Crear empresa y PIN</Text></>}</TouchableOpacity>
          <Text style={styles.note}>La cuenta queda pendiente de pago. No hay cobro automático configurado en esta versión; la activación y renovación se registran manualmente.</Text>
        </View>
        <Text style={styles.listTitle}>Cartera de empresas</Text>
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={theme.brand} style={{ margin: 24 }} /> : <Text style={styles.empty}>Todavía no hay empresas cliente.</Text>}
      renderItem={({ item }) => {
        const active = item.subscription_status === "active";
        const canActivate = ["pending_payment", "suspended", "cancelled", "past_due"].includes(item.subscription_status);
        const busy = busyId === item.id;
        return <View style={styles.card}>
          <View style={styles.cardTop}><View style={styles.cardIcon}><Ionicons name="business" size={18} color={theme.brand} /></View><View style={{ flex: 1 }}><Text style={styles.cardName}>{item.name}</Text><Text style={styles.slug}>{item.slug}</Text></View><View style={[styles.badge, active && styles.badgeActive]}><Text style={[styles.badgeText, active && styles.badgeActiveText]}>{statusLabel[item.subscription_status] || item.subscription_status}</Text></View></View>
          <Text style={styles.meta}>{item.billing_period === "annual" ? "Membresía anual" : "Membresía mensual"} · {fmtMoney(item.price_cop)}</Text>
          <Text style={styles.meta}>Vigencia: {fmtDate(item.current_period_ends_at)}</Text>
          <View style={styles.actions}>
            {canActivate && <TouchableOpacity style={styles.actionPrimary} disabled={busy} onPress={() => changeStatus(item, "activate")}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionPrimaryText}>Activar tras pago</Text>}</TouchableOpacity>}
            {active && <TouchableOpacity style={styles.actionPrimary} disabled={busy} onPress={() => changeStatus(item, "renew")}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionPrimaryText}>Renovar</Text>}</TouchableOpacity>}
            {active && <TouchableOpacity style={styles.actionSecondary} disabled={busy} onPress={() => changeStatus(item, "suspend")}><Text style={styles.actionSecondaryText}>Suspender</Text></TouchableOpacity>}
          </View>
        </View>;
      }}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg }, content: { padding: 18, paddingBottom: 32 }, center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 28 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }, backText: { color: theme.brand, fontSize: 13, fontWeight: "800" }, kicker: { color: theme.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginBottom: 7 },
  title: { color: theme.ink, fontSize: 24, lineHeight: 30, fontWeight: "900" }, sub: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 }, stats: { flexDirection: "row", gap: 9, marginTop: 14 }, statsText: { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, fontSize: 11, fontWeight: "800" },
  form: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 15 }, formTitle: { color: theme.ink, fontSize: 16, fontWeight: "900", marginBottom: 9 }, label: { color: theme.textSecondary, fontSize: 11, fontWeight: "800", marginTop: 10, marginBottom: 5 }, input: { borderWidth: 1, borderColor: theme.border, borderRadius: 11, paddingHorizontal: 12, height: 45, color: theme.text, backgroundColor: "#FFFFFF", fontSize: 14 }, periodRow: { flexDirection: "row", gap: 9 }, periodBtn: { flex: 1, alignItems: "center", padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 11, backgroundColor: "#FFFFFF" }, periodSelected: { backgroundColor: theme.brand, borderColor: theme.brand }, periodText: { color: theme.textSecondary, fontWeight: "800", fontSize: 13 }, periodSelectedText: { color: "#FFFFFF" },
  createBtn: { marginTop: 13, minHeight: 46, borderRadius: 12, backgroundColor: theme.brandDark, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, createText: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 }, note: { color: theme.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 9 }, listTitle: { color: theme.ink, fontWeight: "900", fontSize: 17, marginTop: 21, marginBottom: 8 }, empty: { color: theme.textSecondary, textAlign: "center", padding: 22 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 14, marginBottom: 10 }, cardTop: { flexDirection: "row", alignItems: "center", gap: 9 }, cardIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.brandLight, alignItems: "center", justifyContent: "center" }, cardName: { color: theme.ink, fontSize: 14, fontWeight: "900" }, slug: { color: theme.textDisabled, fontSize: 10, marginTop: 2 }, badge: { borderRadius: 15, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: theme.warningBg }, badgeActive: { backgroundColor: theme.successBg }, badgeText: { color: theme.warning, fontSize: 9, fontWeight: "900" }, badgeActiveText: { color: theme.success }, meta: { color: theme.textSecondary, fontSize: 11, marginTop: 7 }, actions: { flexDirection: "row", gap: 8, marginTop: 12 }, actionPrimary: { backgroundColor: theme.brandDark, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 }, actionPrimaryText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" }, actionSecondary: { borderWidth: 1, borderColor: theme.error, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 }, actionSecondaryText: { color: theme.error, fontSize: 11, fontWeight: "800" },
});
