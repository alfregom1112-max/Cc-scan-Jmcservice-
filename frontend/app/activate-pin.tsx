import React, { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/src/utils/supabase";
import { theme } from "@/src/theme";

export default function ActivatePin() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    if (!fullName.trim() || !email.trim() || !/^\d{6}$/.test(pin) || password.length < 8) return Alert.alert("Datos incompletos", "Escribe nombre, correo, PIN de 6 dígitos y una contraseña de mínimo 8 caracteres.");
    if (password !== confirm) return Alert.alert("Contraseñas diferentes", "Las contraseñas no coinciden.");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("activate-user-pin", { body: { full_name: fullName.trim(), email: email.trim().toLowerCase(), pin, password } });
      if (error || data?.error) throw new Error(data?.error || error?.message || "No se pudo activar la cuenta");
      Alert.alert("Cuenta activada", "Ya puedes iniciar sesión con tu correo y la nueva contraseña.", [{ text: "Ir a iniciar sesión", onPress: () => router.replace("/sign-in") }]);
    } catch (e: any) {
      let message = e?.message || "Verifica el PIN y vuelve a intentarlo.";
      const response = e?.context;
      if (response && typeof response.clone === "function") {
        try {
          const details = await response.clone().json();
          message = details?.error || details?.message || message;
        } catch {
          try { message = (await response.clone().text()) || message; } catch { /* use SDK message */ }
        }
      }
      Alert.alert("No se pudo activar", message);
    }
    finally { setBusy(false); }
  };
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}><SafeAreaView style={styles.flex}><ScrollView contentContainerStyle={styles.content}><View style={styles.logo}><Ionicons name="keypad" size={34} color="#fff" /></View><Text style={styles.kicker}>ACCESO SEGURO</Text><Text style={styles.title}>Activa tu cuenta</Text><Text style={styles.sub}>El administrador te entregó un PIN. Úsalo para crear tus credenciales.</Text><View style={styles.card}><Text style={styles.label}>Nombre completo</Text><TextInput accessibilityLabel="Nombre completo" style={styles.input} value={fullName} onChangeText={setFullName} autoCapitalize="words" autoCorrect={false} textContentType="name" placeholder="Escribe tu nombre y apellido" placeholderTextColor={theme.textDisabled} returnKeyType="next" /><Text style={styles.label}>Correo de acceso</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="operador@ejemplo.com" placeholderTextColor={theme.textDisabled} /><Text style={styles.label}>PIN del administrador</Text><TextInput style={[styles.input, styles.pin]} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="000000" maxLength={6} placeholderTextColor={theme.textDisabled} /><Text style={styles.label}>Crea tu contraseña</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Mínimo 8 caracteres" placeholderTextColor={theme.textDisabled} /><Text style={styles.label}>Repite la contraseña</Text><TextInput style={styles.input} value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Repite la contraseña" placeholderTextColor={theme.textDisabled} /><TouchableOpacity style={styles.button} disabled={busy} onPress={() => void activate()}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Activar cuenta</Text>}</TouchableOpacity><TouchableOpacity style={styles.back} onPress={() => router.replace("/sign-in")}><Text style={styles.backText}>Volver a iniciar sesión</Text></TouchableOpacity></View></ScrollView></SafeAreaView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: theme.bg }, content: { flexGrow: 1, justifyContent: "center", padding: 24, maxWidth: 560, width: "100%", alignSelf: "center" }, logo: { alignSelf: "center", width: 70, height: 70, borderRadius: 22, backgroundColor: theme.brandDark, alignItems: "center", justifyContent: "center", marginBottom: 16 }, kicker: { color: theme.brand, textAlign: "center", fontWeight: "900", fontSize: 11, letterSpacing: 2 }, title: { color: theme.text, fontSize: 32, fontWeight: "900", textAlign: "center", marginTop: 5 }, sub: { color: theme.textSecondary, textAlign: "center", lineHeight: 21, marginTop: 8, marginBottom: 22 }, card: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 22, padding: 22, gap: 7 }, label: { color: theme.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginTop: 8 }, input: { borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14, color: theme.text, backgroundColor: theme.surfaceElevated, fontSize: 16 }, pin: { letterSpacing: 7, textAlign: "center", fontWeight: "900", fontSize: 23 }, button: { backgroundColor: theme.brand, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 14 }, buttonText: { color: "#fff", fontWeight: "900", fontSize: 16 }, back: { alignItems: "center", padding: 10, marginTop: 4 }, backText: { color: theme.info, fontWeight: "800" } });
