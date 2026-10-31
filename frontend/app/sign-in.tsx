import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";

import { useSession } from "@/src/ctx/session";
import { theme } from "@/src/theme";
import { errorMessage } from "@/src/utils/errors";

export default function SignIn() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Datos requeridos", "Ingresa email y contraseña");
      return;
    }
    setLoading(true);
    try {
      const profile = await signIn(email.trim(), password);
      router.replace(profile.role === "admin" ? "/(app)/dashboard" : "/(app)/eventos");
    } catch (e: any) {
      Alert.alert("Error", errorMessage(e, "No se pudo iniciar sesion"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.duration(220)} style={styles.brand}>
          <View style={styles.logoBox}>
            <Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.kicker}>PLATAFORMA OPERATIVA</Text>
          <Text style={styles.brandTitle}>JM ServiceTec</Text>
          <Text style={styles.brandSub}>Identificación y control de acceso, sin fricción.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(240)} style={styles.card}>
          <View style={styles.titleRow}><View><Text style={styles.title}>Bienvenido</Text><Text style={styles.helper}>Ingresa para continuar</Text></View><Ionicons name="shield-checkmark" size={25} color={theme.brand} /></View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="[email protected]"
            placeholderTextColor={theme.textDisabled}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={theme.textDisabled}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            testID="login-submit-button"
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Entrar</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.linkText}>
            ¿Eres nuevo? El administrador debe entregarte un PIN.
          </Text>
          <TouchableOpacity style={styles.linkBtn} onPress={() => router.push("/activate-pin" as any)}>
            <Text style={styles.linkAccent}>Activar cuenta con PIN</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, maxWidth: 560, width: "100%", alignSelf: "center" },
  brand: { alignItems: "center", marginBottom: 28 },
  logoBox: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: theme.brandDark,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: theme.brandDark,
  },
  logoImage: { width: 82, height: 82 },
  kicker: { color: theme.brand, fontSize: 10, fontWeight: "900", letterSpacing: 2, marginTop: 18 },
  brandTitle: { color: theme.text, fontSize: 34, fontWeight: "900", letterSpacing: -1 },
  brandSub: { color: theme.textSecondary, fontSize: 14, marginTop: 6, textAlign: "center" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 10,
    shadowColor: theme.brandDark,
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { color: theme.text, fontSize: 23, fontWeight: "900" },
  helper: { color: theme.textSecondary, fontSize: 13, marginTop: 3 },
  label: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 8 },
  input: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
    color: theme.text,
    fontSize: 16,
  },
  btn: {
    backgroundColor: theme.brand,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkBtn: { alignItems: "center", marginTop: 8, paddingVertical: 8 },
  linkText: { color: theme.textSecondary, fontSize: 14 },
  linkAccent: { color: theme.info, fontWeight: "700" },
});
