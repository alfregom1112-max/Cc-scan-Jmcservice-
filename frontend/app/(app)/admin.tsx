import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
  RefreshControl,
  Platform,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";
import { useSession } from "@/src/ctx/session";
import { useEvento } from "@/src/ctx/evento";
import { api, parsePeopleCsv } from "@/src/utils/api";

type Tab = "panel" | "registros" | "base";
type MetricItem = { label: string; total: number };
type AdminMetrics = {
  global: { eventos: number; eventos_activos: number; registros: number };
  evento_actual: {
    registros: number;
    hoy: number;
    duplicados: number;
    dispositivos_usados: number;
    dispositivos_activos: number;
    calidad_nombre_pct: number;
    calidad_fecha_pct: number;
  };
  top_operadores: MetricItem[];
  por_hora: MetricItem[];
  recientes: any[];
  ia: { configured: boolean; enabled: boolean; model: string; mode: string; min_confidence: number };
};

function fmt(n: unknown): string {
  const value = Number(n || 0);
  return Number.isFinite(value) ? value.toLocaleString("es-CO") : "0";
}

function cleanDisplayName(value: unknown): string {
  const text = String(value || "")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 ? text : "";
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View style={styles.metricBarWrap}>
      <View style={styles.metricBarHeader}>
        <Text style={styles.metricBarLabel}>{label}</Text>
        <Text style={styles.metricBarValue}>{pct.toFixed(1)}%</Text>
      </View>
      <View style={styles.metricTrack}>
        <View style={[styles.metricFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function CountRow({ item, max }: { item: MetricItem; max: number }) {
  const pct = Math.max(6, Math.min(100, (item.total / Math.max(max, 1)) * 100));
  return (
    <View style={styles.countRow}>
      <View style={styles.countTop}>
        <Text style={styles.countLabel} numberOfLines={1}>{item.label || "(sin dato)"}</Text>
        <Text style={styles.countValue}>{fmt(item.total)}</Text>
      </View>
      <View style={styles.countTrack}>
        <View style={[styles.countFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const REG_PAGE_SIZE = 200;

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("panel");
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Registros
  const { eventoId, eventoNombre, refreshRegistros, totalRegistros } = useEvento();
  const [regItems, setRegItems] = useState<any[]>([]);
  const [regTotal, setRegTotal] = useState(0);
  const [regLoading, setRegLoading] = useState(false);
  const [regLoadingMore, setRegLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [importingPeople, setImportingPeople] = useState(false);
  const registrosTotal = metrics?.evento_actual.registros ?? (regTotal || totalRegistros);
  const regHasMore = regItems.length < registrosTotal;

  const loadMetrics = useCallback(async () => {
    if (!isAdmin) return;
    setMetricsLoading(true);
    try {
      const r = await api.adminMetrics(eventoId || undefined);
      setMetrics(r as AdminMetrics);
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudieron cargar las metricas"));
    } finally {
      setMetricsLoading(false);
    }
  }, [eventoId, isAdmin]);

  const loadRegistrosPage = useCallback(async (skip = 0) => {
    if (!isAdmin || !eventoId) {
      setRegItems([]);
      setRegTotal(0);
      return;
    }
    const append = skip > 0;
    if (append) setRegLoadingMore(true);
    else setRegLoading(true);
    try {
      const [items, estado] = await Promise.all([
        api.registros(eventoId, REG_PAGE_SIZE, skip),
        api.estado(eventoId),
      ]);
      const total = Number(estado?.total ?? skip + items.length);
      setRegTotal(total);
      setMetrics((current) => current ? {
        ...current,
        evento_actual: { ...current.evento_actual, registros: total },
      } : current);
      if (append) {
        setRegItems((prev) => {
          const seen = new Set(prev.map((it) => it.id));
          return [...prev, ...items.filter((it) => !seen.has(it.id))];
        });
      } else {
        setRegItems(items);
      }
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudieron cargar los registros"));
    } finally {
      if (append) setRegLoadingMore(false);
      else setRegLoading(false);
    }
  }, [eventoId, isAdmin]);

  const loadRegistros = useCallback(() => {
    void loadRegistrosPage(0);
  }, [loadRegistrosPage]);

  const loadPeople = useCallback(async (search: string) => {
    setPeopleLoading(true);
    try { setPeople(await api.listarBase(search)); }
    catch (e: any) { Alert.alert("No se pudo cargar la base", errorMessage(e, "Revisa tu conexión o permisos de administrador")); }
    finally { setPeopleLoading(false); }
  }, []);

  const importPeople = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        Alert.alert("Formato no compatible", "Guarda tu archivo como CSV e inténtalo de nuevo.");
        return;
      }
      setImportingPeople(true);
      const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const rows = parsePeopleCsv(content);
      if (!rows.length) throw new Error("No hay documentos válidos para cargar");
      const result = await api.cargarBase(file.name, rows);
      Alert.alert("Base cargada", `${result.imported_count.toLocaleString("es-CO")} personas incorporadas o actualizadas. El registro de asistencia funciona también sin esta base.`);
      await loadPeople(peopleSearch);
    } catch (e: any) { Alert.alert("No se pudo importar", errorMessage(e, "Verifica las columnas del CSV")); }
    finally { setImportingPeople(false); }
  }, [loadPeople, peopleSearch]);

  const loadMoreRegistros = useCallback(() => {
    if (regLoading || regLoadingMore || !regHasMore) return;
    void loadRegistrosPage(regItems.length);
  }, [loadRegistrosPage, regHasMore, regItems.length, regLoading, regLoadingMore]);

  useEffect(() => {
    if (tab === "registros") {
      loadRegistros();
    }
  }, [tab, loadRegistros]);

  useEffect(() => { if (tab === "base") void loadPeople(""); }, [tab, loadPeople]);

  useEffect(() => {
    if (tab !== "panel") return;
    void loadMetrics();
    const id = setInterval(loadMetrics, 7000);
    return () => clearInterval(id);
  }, [tab, loadMetrics]);

  const onExport = async () => {
    if (!eventoId) {
      Alert.alert("Selecciona un evento", "Primero ve a Eventos y selecciona uno.");
      return;
    }
    setExporting(true);
    try {
      // Web: trigger blob download. Native: open URL with token (best-effort).
      if (Platform.OS === "web") {
        const { blob, filename } = await api.exportBlob(eventoId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const url = await api.exportUrl(eventoId);
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert("Error al exportar", errorMessage(e, "No se pudo exportar"));
    } finally {
      setExporting(false);
    }
  };

  const onDeleteRegistro = (id: string, cedula: string) => {
    if (!eventoId) return;
    Alert.alert("Borrar registro", `¿Eliminar la cédula ${cedula} de este evento?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar", style: "destructive", onPress: async () => {
          try {
            await api.deleteRegistro(eventoId, id);
            await refreshRegistros();
            loadRegistros();
            void loadMetrics();
          } catch (e: any) { Alert.alert("Error", errorMessage(e)); }
        },
      },
    ]);
  };

  const onClearAllRegistros = () => {
    if (!eventoId) {
      Alert.alert("Selecciona un evento");
      return;
    }
    Alert.alert(
      "Limpiar todos los registros",
      `Vas a borrar TODOS los ${registrosTotal} registros del evento "${eventoNombre}". Esta acción NO se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sí, borrar todos",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await api.clearEventoRegistros(eventoId);
              Alert.alert("Listo", `${r.registros_borrados} registros borrados`);
              setRegItems([]);
              setRegTotal(0);
              setMetrics((current) => current ? {
                ...current,
                evento_actual: {
                  ...current.evento_actual,
                  registros: 0,
                  hoy: 0,
                  duplicados: 0,
                },
                recientes: [],
              } : current);
              await refreshRegistros();
            } catch (e: any) {
              Alert.alert("Error", errorMessage(e));
            }
          },
        },
      ],
    );
  };

  const onDeleteEvento = () => {
    if (!eventoId) return;
    Alert.alert(
      "Archivar evento",
      `El evento "${eventoNombre}" dejará de aceptar escaneos. El evento y sus registros se conservarán.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sí, archivar evento",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteEvento(eventoId);
              Alert.alert("Listo", "Evento archivado. Los registros se conservaron.");
            } catch (e: any) {
              Alert.alert("Error", errorMessage(e));
            }
          },
        },
      ],
    );
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.lockWrap}>
          <Ionicons name="lock-closed" size={64} color={theme.textDisabled} />
          <Text style={styles.lockTitle}>Solo administradores</Text>
          <Text style={styles.lockSub}>Tu cuenta tiene el rol {user?.role || "sin perfil"}. Para abrir este espacio, un administrador debe activar el permiso de gestión y después debes volver a iniciar sesión.</Text>
          {!!user?.email && <Text style={styles.lockSub}>{user.email}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <View style={styles.adminMark}>
            <Ionicons name="grid" size={21} color="#FFFFFF" />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ESPACIO DE GESTIÓN</Text>
            <Text style={styles.title}>Resumen operativo</Text>
          </View>
          <View style={styles.roleChip}>
            <Ionicons name="shield-checkmark" size={13} color={theme.brand} />
            <Text style={styles.roleChipText}>ADMIN</Text>
          </View>
          {user?.is_platform_admin && <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/(app)/tenants")} accessibilityLabel="Gestionar empresas y membresías">
            <Ionicons name="business-outline" size={19} color={theme.brand} />
          </TouchableOpacity>}
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/(app)/usuarios")} accessibilityLabel="Gestionar usuarios">
            <Ionicons name="person-add-outline" size={19} color={theme.brand} />
          </TouchableOpacity>
        </View>
        <View style={styles.eventLine}>
          <View style={styles.eventDot} />
          <Text style={styles.eventLineName} numberOfLines={1}>{eventoNombre || "Selecciona un evento"}</Text>
          <Text style={styles.eventLineCount}>{fmt(registrosTotal)} lecturas</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          testID="admin-tab-panel"
          style={[styles.tabBtn, tab === "panel" && styles.tabActive]}
          onPress={() => setTab("panel")}
        >
          <Ionicons name="analytics" size={16} color={tab === "panel" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "panel" && { color: "#fff" }]}>Panel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="admin-tab-registros"
          style={[styles.tabBtn, tab === "registros" && styles.tabActive]}
          onPress={() => setTab("registros")}
        >
          <Ionicons name="list" size={16} color={tab === "registros" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "registros" && { color: "#fff" }]}>Evento</Text>
          <Text style={[styles.tabBadge, tab === "registros" && { color: "#fff" }]}>{registrosTotal}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="admin-tab-base" style={[styles.tabBtn, tab === "base" && styles.tabActive]} onPress={() => setTab("base")}>
          <Ionicons name="people-outline" size={16} color={tab === "base" ? "#fff" : theme.textSecondary} />
          <Text style={[styles.tabText, tab === "base" && { color: "#fff" }]}>Base opcional</Text>
        </TouchableOpacity>
      </View>

      {tab === "panel" ? (
        <ScrollView
          contentContainerStyle={styles.panelScroll}
          refreshControl={<RefreshControl tintColor={theme.brand} refreshing={metricsLoading} onRefresh={loadMetrics} />}
        >
          {metricsLoading && !metrics ? (
            <ActivityIndicator color={theme.brand} style={{ marginTop: 24 }} />
          ) : (
            <>
              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="calendar-outline" size={18} color={theme.success} />
                    <Text style={styles.kpiLabel}>Eventos</Text>
                  </View>
                  <Text style={styles.kpiValue}>{fmt(metrics?.global.eventos)}</Text>
                  <Text style={styles.kpiFoot}>{fmt(metrics?.global.eventos_activos)} activos</Text>
                </View>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="scan" size={18} color={theme.info} />
                    <Text style={styles.kpiLabel}>Escaneos evento</Text>
                  </View>
                  <Text style={styles.kpiValue}>{fmt(registrosTotal)}</Text>
                  <Text style={styles.kpiFoot}>{fmt(metrics?.evento_actual.hoy)} hoy</Text>
                </View>
                <View style={styles.kpiCard}>
                  <View style={styles.kpiHeader}>
                    <Ionicons name="shield-checkmark" size={18} color={theme.error} />
                    <Text style={styles.kpiLabel}>Duplicados</Text>
                  </View>
                  <Text style={[styles.kpiValue, { color: theme.error }]}>{fmt(metrics?.evento_actual.duplicados)}</Text>
                  <Text style={styles.kpiFoot}>Bloqueados por evento</Text>
                </View>
              </View>

              <View style={styles.panelCard}>
                <View style={styles.panelCardHeader}>
                  <Text style={styles.panelCardTitle}>IA Gemini</Text>
                  <View style={[styles.statusPill, { borderColor: metrics?.ia.enabled ? theme.success : theme.warning }]}>
                    <View style={[styles.statusDot, { backgroundColor: metrics?.ia.enabled ? theme.success : theme.warning }]} />
                    <Text style={[styles.statusPillText, { color: metrics?.ia.enabled ? theme.success : theme.warning }]}>
                      {metrics?.ia.enabled ? "Activa" : "Pendiente"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.panelText}>
                  {metrics?.ia.enabled
                    ? `Modelo ${metrics.ia.model} · modo ${metrics.ia.mode} · confianza minima ${metrics.ia.min_confidence}`
                    : "Configura GEMINI_API_KEY en el backend para activar vision AI como respaldo de OCR."}
                </Text>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Calidad del evento</Text>
                <MetricBar label="Con nombre" value={metrics?.evento_actual.calidad_nombre_pct || 0} color={theme.success} />
                <MetricBar label="Con fecha nacimiento" value={metrics?.evento_actual.calidad_fecha_pct || 0} color={theme.info} />
                <View style={styles.splitRow}>
                  <View style={styles.splitBox}>
                    <Text style={styles.splitValue}>{fmt(metrics?.evento_actual.dispositivos_activos)}</Text>
                    <Text style={styles.splitLabel}>Activos</Text>
                  </View>
                </View>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Actividad ultimas 24h</Text>
                {(metrics?.por_hora || []).length ? (
                  metrics?.por_hora.map((it) => (
                    <CountRow key={it.label} item={it} max={Math.max(...(metrics?.por_hora || []).map((x) => x.total), 1)} />
                  ))
                ) : (
                  <Text style={styles.emptySmall}>Sin actividad reciente.</Text>
                )}
              </View>

              <View style={styles.dualPanel}>
                <View style={styles.panelCardHalf}>
                  <Text style={styles.panelCardTitle}>Operadores</Text>
                  {(metrics?.top_operadores || []).length ? metrics?.top_operadores.map((it) => (
                    <CountRow key={it.label} item={it} max={Math.max(...(metrics?.top_operadores || []).map((x) => x.total), 1)} />
                  )) : <Text style={styles.emptySmall}>Sin datos.</Text>}
                </View>
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelCardTitle}>Lecturas recientes</Text>
                {(metrics?.recientes || []).length ? metrics?.recientes.map((item) => (
                  <View key={item.id} style={styles.recentAdminRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.afCed}>{item.cedula}</Text>
                      <Text style={styles.afName} numberOfLines={1}>{cleanDisplayName(item.nombre) || "(sin nombre)"}</Text>
                    </View>
                  </View>
                )) : <Text style={styles.emptySmall}>Sin registros.</Text>}
              </View>
            </>
          )}
        </ScrollView>
      ) : tab === "registros" ? (
        <View style={{ flex: 1, padding: 16 }}>
          <View style={styles.eventInfo}>
            <Text style={styles.eventInfoLabel}>Evento actual</Text>
            <Text style={styles.eventInfoName} numberOfLines={1}>{eventoNombre || "(ninguno)"}</Text>
            <Text style={styles.eventInfoMeta}>{fmt(regItems.length)} visibles de {fmt(registrosTotal)} registros</Text>
            <TouchableOpacity testID="admin-export-button" style={styles.exportBtn} onPress={onExport} disabled={exporting || !eventoId}>
              {exporting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="download" size={18} color="#fff" />
                  <Text style={styles.exportBtnText}>Exportar a Excel</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.eventActionRow}>
              <TouchableOpacity
                testID="admin-clear-event-registros"
                style={[styles.dangerBtn, (!eventoId || !registrosTotal) && styles.disabledBtn]}
                onPress={onClearAllRegistros}
                disabled={!eventoId || !registrosTotal}
              >
                <Ionicons name="remove-circle-outline" size={17} color={theme.warning} />
                <Text style={styles.dangerBtnText}>Limpiar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="admin-delete-event"
                style={[styles.dangerBtn, styles.deleteBtn, !eventoId && styles.disabledBtn]}
                onPress={onDeleteEvento}
                disabled={!eventoId}
              >
                <Ionicons name="trash-outline" size={17} color={theme.error} />
                <Text style={[styles.dangerBtnText, { color: theme.error }]}>Evento</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={regItems}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
            refreshControl={<RefreshControl tintColor={theme.brand} refreshing={regLoading} onRefresh={loadRegistros} />}
            onEndReached={loadMoreRegistros}
            onEndReachedThreshold={0.35}
            ListEmptyComponent={regLoading ? <ActivityIndicator color={theme.brand} style={{ marginTop: 24 }} /> : <Text style={styles.empty}>Sin registros en este evento.</Text>}
            ListFooterComponent={
              regHasMore ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMoreRegistros} disabled={regLoadingMore}>
                  {regLoadingMore ? <ActivityIndicator color="#fff" /> : <Text style={styles.loadMoreText}>Cargar más</Text>}
                </TouchableOpacity>
              ) : regItems.length ? (
                <Text style={styles.listCountText}>{fmt(regItems.length)} de {fmt(registrosTotal)} registros</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={styles.afRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.afCed}>{item.cedula}</Text>
                  <Text style={styles.afName} numberOfLines={1}>{cleanDisplayName(item.nombre) || "(sin nombre)"}</Text>
                  <Text style={styles.afMeta}>{new Date(item.created_at).toLocaleString("es-CO")}</Text>
                </View>
                <TouchableOpacity onPress={() => onDeleteRegistro(item.id, item.cedula)} style={styles.afAction}>
                  <Ionicons name="trash-outline" size={18} color={theme.error} />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      ) : (
        <View style={{ flex: 1, padding: 16 }}>
          <View style={styles.eventInfo}>
            <Text style={styles.eventInfoLabel}>Directorio opcional</Text>
            <Text style={styles.eventInfoName}>Base de personas</Text>
            <Text style={styles.eventInfoMeta}>Puedes cargar un CSV para consultar coincidencias. Sin base, los escaneos igual se registran. Se exportan los registros y se conserva la auditoría.</Text>
            <TouchableOpacity testID="admin-import-people" style={styles.exportBtn} onPress={importPeople} disabled={importingPeople}>
              {importingPeople ? <ActivityIndicator color="#fff" /> : <><Ionicons name="cloud-upload-outline" size={18} color="#fff" /><Text style={styles.exportBtnText}>Cargar archivo CSV</Text></>}
            </TouchableOpacity>
            <Text style={styles.eventInfoMeta}>Columnas admitidas: documento, nombre, tipo_documento, sede, municipio y cargo. No se usan datos de aportes.</Text>
          </View>
          <View style={styles.searchRow}>
            <TextInput style={styles.search} value={peopleSearch} onChangeText={setPeopleSearch} placeholder="Buscar nombre o documento" placeholderTextColor={theme.textDisabled} onSubmitEditing={() => void loadPeople(peopleSearch)} returnKeyType="search" />
            <TouchableOpacity style={styles.iconBtn} onPress={() => void loadPeople(peopleSearch)} accessibilityLabel="Buscar en base"><Ionicons name="search" size={18} color="#fff" /></TouchableOpacity>
          </View>
          <FlatList
            data={people}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl tintColor={theme.brand} refreshing={peopleLoading} onRefresh={() => void loadPeople(peopleSearch)} />}
            ListEmptyComponent={peopleLoading ? <ActivityIndicator color={theme.brand} style={{ marginTop: 24 }} /> : <Text style={styles.empty}>No hay personas cargadas. Puedes seguir registrando escaneos sin una base.</Text>}
            renderItem={({ item }) => <View style={styles.afRow}><View style={{ flex: 1 }}><Text style={styles.afCed}>{item.document_number}</Text><Text style={styles.afName}>{item.display_name || "(sin nombre)"}</Text><Text style={styles.afMeta}>{[item.position, item.work_site, item.municipality].filter(Boolean).join(" · ")}</Text></View></View>}
          />
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  headerMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  adminMark: { width: 44, height: 44, borderRadius: 15, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: theme.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: theme.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  roleChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.infoBg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  roleChipText: { color: theme.brand, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  eventLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 13 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.success },
  eventLineName: { flex: 1, minWidth: 0, color: theme.text, fontSize: 12, fontWeight: "700" },
  eventLineCount: { color: theme.textSecondary, fontSize: 10, fontWeight: "700" },
  tabRow: { flexDirection: "row", marginHorizontal: 14, marginVertical: 5, backgroundColor: "#E8EDF5", borderRadius: 15, padding: 4 },
  tabBtn: { flex: 1, flexDirection: "row", paddingVertical: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 5 },
  tabActive: { backgroundColor: theme.brand },
  tabText: { color: theme.textSecondary, fontWeight: "700", fontSize: 12 },
  tabBadge: { color: theme.textDisabled, fontWeight: "900", fontSize: 10 },
  panelScroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 40, gap: 11 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  kpiCard: { flexGrow: 1, flexBasis: "47%", minWidth: 150, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 17, padding: 14 },
  kpiHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  kpiLabel: { color: theme.textSecondary, fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7 },
  kpiValue: { color: theme.text, fontSize: 27, fontWeight: "900", marginTop: 8 },
  kpiFoot: { color: theme.textDisabled, fontSize: 10, marginTop: 3 },
  panelCard: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 17, padding: 15, gap: 10 },
  panelCardHalf: { flex: 1, minWidth: 150, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 17, padding: 13, gap: 10 },
  panelCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelCardTitle: { color: theme.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  panelText: { color: theme.textSecondary, fontSize: 12, lineHeight: 18 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  splitRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  splitBox: { flex: 1, backgroundColor: theme.bg, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 10 },
  splitValue: { color: theme.text, fontSize: 17, fontWeight: "900" },
  splitLabel: { color: theme.textDisabled, fontSize: 9, marginTop: 3 },
  metricBarWrap: { gap: 5 },
  metricBarHeader: { flexDirection: "row", justifyContent: "space-between" },
  metricBarLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  metricBarValue: { color: theme.text, fontSize: 12, fontWeight: "900" },
  metricTrack: { height: 8, backgroundColor: theme.bg, borderRadius: 8, overflow: "hidden" },
  metricFill: { height: 8, borderRadius: 8 },
  dualPanel: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  countRow: { gap: 5 },
  countTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  countLabel: { flex: 1, color: theme.textSecondary, fontSize: 12, fontWeight: "700" },
  countValue: { color: theme.text, fontSize: 12, fontWeight: "900" },
  countTrack: { height: 6, backgroundColor: theme.bg, borderRadius: 6, overflow: "hidden" },
  countFill: { height: 6, backgroundColor: theme.brandLight, borderRadius: 6 },
  recentAdminRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.border },
  recentBadge: { color: theme.success, borderWidth: 1, borderColor: theme.success, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: "900" },
  emptySmall: { color: theme.textDisabled, fontSize: 12, paddingVertical: 8 },
  searchRow: { flexDirection: "row", paddingHorizontal: 14, gap: 8, marginVertical: 6 },
  search: { flex: 1, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: theme.text, fontSize: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  afRow: { flexDirection: "row", alignItems: "center", padding: 13, backgroundColor: theme.surface, borderRadius: 15, borderWidth: 1, borderColor: theme.border, gap: 8 },
  afCed: { color: theme.text, fontWeight: "900", fontSize: 14 },
  afName: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  afMeta: { color: theme.textDisabled, fontSize: 10, marginTop: 3 },
  afAction: { padding: 8 },
  empty: { color: theme.textDisabled, textAlign: "center", padding: 40 },
  loadMoreBtn: { alignSelf: "center", minWidth: 150, marginTop: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 13, backgroundColor: theme.brand, alignItems: "center" },
  loadMoreText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  listCountText: { color: theme.textDisabled, textAlign: "center", fontSize: 12, paddingVertical: 12 },
  eventInfo: { padding: 15, backgroundColor: theme.surface, borderRadius: 17, borderWidth: 1, borderColor: theme.border, marginBottom: 10 },
  eventInfoLabel: { color: theme.textSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  eventInfoName: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 5 },
  eventInfoMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 4 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, backgroundColor: theme.brand, borderRadius: 13, marginTop: 11 },
  exportBtnText: { color: "#fff", fontWeight: "800" },
  eventActionRow: { flexDirection: "row", gap: 8, marginTop: 9 },
  dangerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: theme.warning, backgroundColor: theme.warningBg },
  deleteBtn: { borderColor: theme.error, backgroundColor: theme.errorBg },
  disabledBtn: { opacity: 0.45 },
  dangerBtnText: { color: theme.warning, fontWeight: "800", fontSize: 12 },
  lockWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  lockTitle: { color: theme.text, fontSize: 22, fontWeight: "800" },
  lockSub: { color: theme.textSecondary, textAlign: "center", fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(17,28,48,0.55)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 28, maxHeight: "85%" },
  modalHandle: { alignSelf: "center", width: 42, height: 5, backgroundColor: theme.border, borderRadius: 3, marginBottom: 12 },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 8 },
  formLabel: { color: theme.textSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  formInput: { backgroundColor: theme.surfaceElevated, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 14 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 13, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "800" },
});
