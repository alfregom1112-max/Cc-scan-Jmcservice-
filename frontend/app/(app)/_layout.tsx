import React from "react";
import { Tabs, Redirect, useSegments } from "expo-router";
import type { ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";

type TabIconProps = { color: ColorValue; size: number };

const DashboardIcon = ({ color, size }: TabIconProps) => <Ionicons name="stats-chart" size={size} color={String(color)} />;
const AuditoriaIcon = ({ color, size }: TabIconProps) => <Ionicons name="document-text" size={size} color={String(color)} />;
const AdminIcon = ({ color, size }: TabIconProps) => <Ionicons name="shield-checkmark" size={size} color={String(color)} />;
const PerfilIcon = ({ color, size }: TabIconProps) => <Ionicons name="person-circle" size={size} color={String(color)} />;

export default function AppLayout() {
  const { user, isLoading } = useSession();
  if (isLoading) return null;
  if (!user) return <Redirect href="/sign-in" />;
  const isAdmin = user.role === "admin";
  const segments = useSegments();
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
          borderRadius: 24,
          height: 72,
          marginHorizontal: 16,
          marginBottom: 12,
          paddingBottom: 8,
          paddingTop: 8,
          elevation: 20,
          shadowColor: theme.brandDark,
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarItemStyle: { paddingHorizontal: 2, borderRadius: 16 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "800", marginTop: 3 },
      }}
    >
      <Tabs.Screen name="eventos" options={{ href: isAdmin ? null : "/(app)/eventos", title: "Inicio", tabBarIcon: DashboardIcon }} />
      <Tabs.Screen name="escanear" options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ href: isAdmin ? "/(app)/dashboard" : null, title: "Inicio", tabBarIcon: DashboardIcon }} />
      <Tabs.Screen name="auditoria" options={{ href: null, title: "Auditoría", tabBarIcon: AuditoriaIcon }} />
      <Tabs.Screen name="admin" options={{ href: isAdmin ? "/(app)/admin" : null, title: "Gestión", tabBarIcon: AdminIcon }} />
      <Tabs.Screen name="perfil" options={{ href: isAdmin ? "/(app)/perfil" : null, title: "Perfil", tabBarIcon: PerfilIcon }} />
      <Tabs.Screen name="usuarios" options={{ href: null }} />
      <Tabs.Screen name="tenants" options={{ href: null }} />
      <Tabs.Screen name="historial" options={{ href: isAdmin ? null : "/(app)/historial" as any, title: "Historial", tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={String(color)} /> }} />
    </Tabs>
  );
}
