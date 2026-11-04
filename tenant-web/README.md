# JM ServiceTec Eventos — portal web (tenant-web)

Portal para Netlify: JavaScript + Supabase JS + esbuild. Rediseño completo sobre los contratos reales del paquete (`referencia-backend/`). No toca producción ni usa claves privadas.

## Construir
```bash
npm ci
SUPABASE_URL=https://TU-PROYECTO.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... npm run build   # → dist/ (index.html incluido)
npm run build:demo     # → dist-demo/ SOLO para vista previa visual (datos ficticios, sin credenciales)
npm run check          # sintaxis de todos los módulos
npm test               # pruebas unitarias (CSV, membresía, formatos)
```
Variables públicas: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; opcional `API_BASE_URL` (por defecto `https://jm-servicetec-api.onrender.com`). Netlify: `netlify.toml` ya define `npm run build` y `dist`. El ZIP **no** trae `dist`, `node_modules` ni `.env`.

**Modo demostración**: existe solo en `build:demo` (`JM_DEMO=1`). El build normal elimina ese código (verificado: el `app.js` de producción no contiene datos demo). Muestra una franja amarilla permanente y la pantalla de acceso ofrece «Entrar como…». El PIN de activación demo es `123456`.

## Supabase Auth: configuración necesaria
Añade el origen del portal en *Authentication → URL Configuration → Redirect URLs* (p. ej. `https://tu-sitio.netlify.app/`). Las invitaciones y la recuperación redirigen a `origen + ruta` **sin fragmento** y el portal procesa `#access_token…&type=invite|recovery` antes de que Supabase lo limpie, mostrando «Crea tu contraseña». Ver `CAMBIOS_BACKEND.md` para los dominios históricos fijos.

## Arquitectura
- `src/lib/repo.real.js`: **única** capa que habla con Supabase (RLS), Edge Functions y la API de Render; cada función documenta su contrato. `src/demo/repo.demo.js`: misma interfaz en memoria.
- `src/app.js`: shell, router por hash con guardas por rol, máquina de sesión. `onAuthStateChange` solo recibe el evento de forma síncrona y despacha fuera del candado de supabase-js (sin deadlocks); `TOKEN_REFRESHED`/`INITIAL_SESSION` no redibujan nada.
- `src/views/*`: una vista por módulo. `src/lib/ui.js` componentes accesibles; `icons.js` iconos SVG propios; tipografía Schibsted Grotesk autoalojada (`@fontsource-variable`).

## Roles (la UI no sustituye la autorización del servidor)
| Rol | Navegación |
|---|---|
| Superadmin (`admin` + `is_platform_admin`) | Plataforma (resumen, empresas) + operación de su empresa interna |
| Administrador | Panel, eventos, usuarios, asignaciones, reportes, perfil |
| Operador | Mis eventos (solo asignados y activos), su actividad, perfil |

Membresía vencida/inactiva: los admins y operadores ven una pantalla explicativa (la RLS y la API ya niegan los datos).

## Qué corrige
- **events.js**: reescrito. Listado con búsqueda/estado/paginación en servidor, alta y edición, estados (activo/pausado/cerrado/reabrir), detalle con pestañas Resumen · Asistencia (paginada con `limit+1`, filtro por operador, borrado, vaciado con confirmación escrita) · Operadores · Auditoría (API + historial `audit_log` con autor).
- **Router/sesión**: recuperación de sesión, callback de invitación/recuperación, errores de enlace caducado y navegación sin recargas por refresco de token.
- **Usuarios**: solo `active`/`inactive`; «suspendida» es de la membresía.
- **Estadísticas**: `/stats` se rotula «todo el evento»; «mis registros» sale de `/count`; el operador nunca ve `recientes` de otros.
- **KPIs**: duplicados y dispositivos activos se muestran como *no disponibles* porque la API todavía no los mide; tendencia/top operadores también se calculan en Reportes sobre los datos cargados. «Dispositivos usados» se rotula aproximado (últimos 8). «Hoy» se calcula desde las 00:00 de Colombia y ya está disponible durante todo el día.
- **Reportes/CSV**: descarga todas las páginas (500 c/u, tope 50 000), progreso, cancelar, filtros, error parcial visible y archivo marcado `-PARCIAL`; neutralización de fórmulas (`= + - @ TAB CR`).
- **Activación por PIN** integrada en el portal (`#/activar`); `activate-pin.html` redirige.

## Pendientes reales
1. **Probar con cuentas reales** (superadmin, admin, operador, y un segundo tenant) contra Supabase/Render: aquí no hubo credenciales. La RLS se auditó leyendo las migraciones, no ejecutándolas.
2. **Cambios de backend** (`CAMBIOS_BACKEND.md`): CORS de `admin-user-status` (sin él, activar/desactivar/eliminar usuarios fallan desde el navegador), dominios fijos en reenvío de invitaciones, cálculo de «hoy», `recientes` visibles para operadores.
3. **PIN del administrador de una empresa nueva**: vence a los 30 min y no hay función para regenerarlo (`admin-user-pin-create` solo crea PIN de operador). Falta contrato.
4. **Reenviar invitación** a un usuario que aún no aceptó borra y recrea la cuenta (pierde asignaciones). El portal lo advierte; es comportamiento del backend.
5. **Importación de personas**: no implementada a propósito. `import_people_directory` existe pero el historial de migraciones alterna si el directorio se usa, no se puede verificar sin base real y implica datos personales masivos.
6. La auditoría de asistencia no incluye autor ni detalle (la API devuelve `data: {}`).
7. Sin pasarela de pagos: activar/renovar solo registra que el pago se confirmó fuera del portal.
8. `npm audit`: 1 advertencia baja en esbuild (herramienta de build, no se publica).
