# Infraestructura JM ServiceTec v3

## Flujo

```text
APK: lectura local + cola offline
       │ token de Supabase
       ▼
Railway API: valida usuario, empresa, evento y membresía en Supabase
       │ cifra campos sensibles
       ▼
MongoDB Atlas: registros de asistencia y auditoría de escaneos

Netlify: panel de tenants (Supabase Auth + Edge Functions)
GitHub: repo privado conectado a Railway y Netlify
```

Supabase conserva usuarios, permisos, membresías y eventos. Atlas guarda los registros de asistencia; no se replica cada escaneo en Supabase para evitar dos fuentes de verdad.

## Estado de cuentas

La captura de Chrome mostró Railway, GitHub, Supabase y Netlify. GitHub estaba en registro y Netlify en inicio de sesión. No creé ni conecté recursos remotos. La conexión de GitHub accesible en Codex está bajo `ryuk1122`; no subiré el código a esa cuenta hasta que confirmes que es el GitHub de Alfredo/JM ServiceTec.

## GitHub

1. Inicia sesión o crea la cuenta de JM ServiceTec y crea un repo **privado** llamado `jm-servicetec-eventos-v3`.
2. Sube el contenido de esta carpeta, con `frontend/`, `backend/`, `supabase/`, `tenant-web/`, `.gitignore`, `netlify.toml` y `README.md`.
3. No subas `.env`, bases de eventos, exportaciones, APKs con claves ni llaves de firma.
4. Conecta ese mismo repo en Railway y Netlify. No hacen falta secretos de deploy de GitHub Actions.

## Supabase

1. Usa un proyecto de pruebas dedicado. No migres producción sin respaldo y ensayo.
2. Ejecuta `supabase/migrations/` en orden y despliega `admin-user-pin-create`, `activate-user-pin`, `admin-user-status`, `admin-user-invite`, `admin-user-resend`, `platform-tenant-create` y `platform-tenant-update`.
3. Verifica que la cuenta interna JM ServiceTec tenga `role=admin`, `status=active` e `is_platform_admin=true` en `profiles`.
4. Cuando Netlify entregue dominio, agrégalo en Auth → URL Configuration como Redirect URL y Site URL.
5. La app y Netlify usan URL + publishable key. Railway requiere además la `service_role` para validar permisos; esa clave va solo en Railway.

## MongoDB Atlas

1. Crea un proyecto y base dedicada llamada `jm_servicetec_events`.
2. Crea usuario de aplicación con permisos mínimos de lectura/escritura sobre esa base y copia la URI `mongodb+srv://...`.
3. Configura el acceso de red desde Railway. **No uses `0.0.0.0/0`** como configuración de producción. Railway ofrece IP saliente estática en Pro; revisa el costo antes de elegirlo. No he abierto compras ni un plan de pago.
4. La URI se guarda exclusivamente en Railway como `MONGODB_URI`.

## Railway

1. Conecta el repo y configura el directorio raíz del servicio como `/backend`; ahí detecta `Dockerfile`.
2. Publica el API por HTTPS; el health check es `/v1/health`.
3. Crea dos claves independientes ejecutando `node backend/scripts/generate-keys.mjs`. Guarda `SCAN_DATA_ENCRYPTION_KEY` y `SCAN_LOOKUP_HMAC_KEY` en un gestor seguro y como variables de Railway. Sin ellas no se pueden descifrar ni deduplicar datos.
4. Configura las variables del archivo `backend/.env.example`, reemplazando todos los ejemplos. `CORS_ORIGINS` debe ser el dominio final de Netlify.
5. Usa el dominio Railway HTTPS como `EXPO_PUBLIC_RAILWAY_API_URL` al compilar la APK.

| Variable de Railway | Dónde obtenerla | ¿Secreto? |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase → Project URL | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys | **Sí** |
| `MONGODB_URI` | Atlas → Connect → Drivers | **Sí** |
| `MONGODB_DB_NAME` | `jm_servicetec_events` | No |
| `SCAN_DATA_ENCRYPTION_KEY` | Script de generación local | **Sí, crítico** |
| `SCAN_LOOKUP_HMAC_KEY` | Script de generación local | **Sí, crítico** |
| `CORS_ORIGINS` | Dominio HTTPS de Netlify | No |
| `PORT` | Railway lo proporciona | No |

No se habilitó retención automática. Define el plazo legalmente con el responsable de datos, respalda cifrado y ensaya restauración antes de cargar información real.

### Conservar escaneos existentes al migrar

Si el Supabase de origen ya contiene registros de eventos que deban aparecer en la v3, usa `backend/scripts/migrate-supabase-scans-to-atlas.mjs`. Primero ejecuta el script sin `--apply`: solo cuenta y compara. Antes de importar, respalda el origen, detén temporalmente los escaneos en el cliente viejo y confirma la fecha de corte. Luego ejecuta con `--apply`; la carga es idempotente y no borra ni modifica Supabase. Compara `read` e `inserted_or_would_insert` con los totales del origen antes de habilitar el nuevo cliente. Si hay filas sin tenant, resuelve su asignación en Supabase antes de importar; el script las reporta y no las adivina.

## Netlify

1. Importa el repo desde GitHub.
2. `netlify.toml` ya fija el directorio base `tenant-web`, el comando de construcción y `tenant-web/dist` como publicación.
3. Configura solo `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` como variables de construcción. Nunca coloques service role, URI Atlas, claves AES/HMAC o contraseñas en Netlify.
4. Añade el dominio generado a `CORS_ORIGINS` de Railway y a las Redirect URLs de Supabase.

## APK y primera prueba

Completa `frontend/.env.example` en la estación de compilación con:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_RAILWAY_API_URL`

Son valores públicos de cliente. Luego prueba dos empresas aisladas, escaneo en línea, cola sin red, reconexión, idempotencia, expiración/reactivación de membresía y restauración de respaldo. No distribuyas la APK de venta hasta revisar privacidad, contrato de tratamiento, soporte y proceso manual de cobro/renovación.
