import React from "react";
import { Tabs, Redirect, useSegments } from "expo-router";
import { View, type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";

type TabIconProps = { color: ColorValue; size: number };

const DashboardIcon = ({ color, size }: TabIconProps) => <Ionicons name="stats-chart" size={size} color={String(color)} />;
const ScanTabIcon = () => <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", marginTop: -14, borderWidth: 3, borderColor: theme.surfaceElevated }}><Ionicons name="scan-outline" size={22} color="#FFFFFF" /></View>;

export default function AppLayout() {
  const { user, isLoading } = useSession();
  const segments = useSegments();
  if (isLoading) return null;
  if (!user) return <Redirect href="/sign-in" />;
  const isAdmin = user.role === "admin";
  const activeRoute = segments[segments.length - 1];
  const hideTabBar = ["escanear", "perfil", "usuarios", "tenants"].includes(activeRoute);
  return (
    <Tabs
      initialRouteName={isAdmin ? "dashboard" : "eventos"}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: hideTabBar ? { display: "none" } : {
          backgroundColor: theme.surfaceElevated,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          borderRadius: 0,
          height: 72,
          marginHorizontal: 0,
          marginBottom: 0,
          paddingBottom: 8,
          paddingTop: 8,
          elevation: 3,
          shadowColor: theme.brandDark,
          shadowOpacity: 0.04,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarItemStyle: { paddingHorizontal: 2, borderRadius: 16 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "800", marginTop: 3 },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ href: isAdmin ? "/(app)/dashboard" : null, title: "Inicio", tabBarIcon: DashboardIcon }} />
      <Tabs.Screen name="eventos" options={{ title: isAdmin ? "Eventos" : "Mi jornada", tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="escanear" options={{ title: "Escanear", tabBarIcon: ScanTabIcon, tabBarLabelStyle: { fontSize: 10, fontWeight: "800", marginTop: 2 } }} />
      <Tabs.Screen name="auditoria" options={{ href: null }} />
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="perfil" options={{ href: null }} />
      <Tabs.Screen name="usuarios" options={{ href: null }} />
      <Tabs.Screen name="tenants" options={{ href: null }} />
      <Tabs.Screen name="historial" options={{ title: "Historial", tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={String(color)} /> }} />
      <Tabs.Screen name="mas" options={{ title: "Más", tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
