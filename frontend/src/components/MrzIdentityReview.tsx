import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { validateReviewedIdentity, type ReviewedIdentity } from '../utils/mrzIdentityReview';

/** No record is written here. Only an explicit confirmation resolves an identity. */
export function useMrzIdentityReview() {
  const [form, setForm] = useState<ReviewedIdentity | null>(null);
  const [error, setError] = useState('');
  const resolver = useRef<((identity: ReviewedIdentity | null) => void) | null>(null);
  const finish = useCallback((value: ReviewedIdentity | null) => {
    const resolve = resolver.current; resolver.current = null;
    setForm(null); setError(''); resolve?.(value);
  }, []);
  const cancelReview = useCallback(() => finish(null), [finish]);
  const requestReview = useCallback((value: ReviewedIdentity) => {
    resolver.current?.(null);
    setError(''); setForm({ ...value });
    return new Promise<ReviewedIdentity | null>(resolve => { resolver.current = resolve; });
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') cancelReview(); });
    return () => { listener.remove(); resolver.current?.(null); resolver.current = null; };
  }, [cancelReview]);
  const dialog = <Modal visible={!!form} transparent animationType="fade" onRequestClose={cancelReview}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.panel}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Confirma los datos de la cédula</Text>
          <Text style={styles.help}>Compara el número y el nombre con el documento físico. Puedes corregirlos aquí. Todavía no se ha guardado el registro.</Text>
          <Text style={styles.label}>Número de cédula</Text>
          <TextInput accessibilityLabel="Número de cédula por confirmar" value={form?.cedula || ''}
            onChangeText={cedula => setForm(current => current && ({ ...current, cedula }))}
            keyboardType="number-pad" maxLength={10} style={styles.input} />
          <Text style={styles.label}>Nombres y apellidos completos</Text>
          <TextInput accessibilityLabel="Nombre completo por confirmar" value={form?.nombre || ''}
            onChangeText={nombre => setForm(current => current && ({ ...current, nombre }))}
            autoCorrect={false} autoCapitalize="characters" maxLength={160} multiline style={styles.input} />
          {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.confirm} onPress={() => {
            if (!form) return;
            const validation = validateReviewedIdentity(form);
            if (validation.valid) finish(validation.identity); else setError(validation.error);
          }}><Text style={styles.confirmText}>Datos correctos y continuar</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancel} onPress={cancelReview}><Text style={styles.cancelText}>Cancelar y volver a leer</Text></TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
  return { requestReview, cancelReview, dialog };
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.75)', justifyContent: 'center', padding: 20 },
  panel: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '90%' },
  title: { fontSize: 21, fontWeight: '700', color: '#111827', marginBottom: 12 },
  help: { color: '#374151', fontSize: 15, lineHeight: 21, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 6, marginTop: 8 },
  input: { color: '#111827', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#9ca3af', borderRadius: 8, padding: 12, fontSize: 18, minHeight: 48 },
  error: { color: '#991b1b', marginTop: 12 },
  confirm: { backgroundColor: '#14532d', padding: 14, borderRadius: 8, marginTop: 20 },
  confirmText: { color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: 16 },
  cancel: { padding: 14, marginTop: 6 },
  cancelText: { color: '#1f2937', textAlign: 'center', fontSize: 15 },
});
