import React, { useCallback, useRef, useState } from 'react';
import { Button, Platform, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { LocalCedulaCamera, localScannerAvailable } from './LocalCedulaCamera';
import { validateMrz } from '../utils/mrzValidation';

export type PilotMrzReading = {
  cedula: string;
  nombres: string;
  primer_apellido: string;
  segundo_apellido: string;
  genero: string;
  fecha_nacimiento: string;
  fecha_expiracion: string;
  raw_barcode: string;
  capture_source: 'mrz_local';
};

type Props = {
  active?: boolean;
  // Resolve persisted=true only after the pilot's own durable queue or server confirms storage.
  onRead: (reading: PilotMrzReading) => Promise<{ persisted: boolean }>;
  // Return true only when this code was routed as an identity. Opaque QR must return false.
  onBarcode?: (raw: string, type: string) => boolean;
};

/** Example integration, without another CameraView, network client or storage implementation. */
export function PilotCedulaReader({ active = true, onRead, onBarcode }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const acceptMrz = useCallback(async (raw: string): Promise<boolean> => {
    if (busy.current) return false;
    const result = validateMrz(raw);
    if (!result.valid || !result.cedula) return false;
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await onRead({
        cedula: result.cedula, nombres: result.names || '',
        primer_apellido: result.surname?.[0] || '',
        segundo_apellido: result.surname?.slice(1).join(' ') || '',
        genero: result.gender === 'M' || result.gender === 'F' ? result.gender : '',
        fecha_nacimiento: result.birth || '', fecha_expiracion: result.expiry || '',
        raw_barcode: result.lines.join('\n'), capture_source: 'mrz_local',
      });
      if (!response.persisted) setError('El registro no fue guardado. Vuelve a intentarlo.');
      return response.persisted;
    } catch {
      setError('No se confirmó el guardado. Conserva el pendiente y vuelve a intentarlo.');
      return false;
    } finally { busy.current = false; setSaving(false); }
  }, [onRead]);

  if (Platform.OS !== 'android' || !localScannerAvailable) return <View style={styles.center}>
    <Text>Este lector necesita una compilación Android con el módulo JM ServiceTecner. Expo Go no incluye el módulo.</Text>
  </View>;
  if (!permission) return <View style={styles.center}><Text>Comprobando permiso de cámara…</Text></View>;
  if (!permission.granted) return <View style={styles.center}>
    <Text>Autoriza la cámara para leer el reverso del documento.</Text>
    <Button title="Autorizar cámara" onPress={() => { void requestPermission(); }} />
  </View>;
  return <View style={styles.root}>
    <LocalCedulaCamera style={styles.root} active={active && !saving} onMrz={acceptMrz}
      onBarcode={(raw, type) => busy.current ? false : onBarcode?.(raw, type) ?? false} />
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  error: { position: 'absolute', bottom: 16, left: 12, right: 12, color: '#fff', backgroundColor: '#7f1d1d', padding: 12 },
});
