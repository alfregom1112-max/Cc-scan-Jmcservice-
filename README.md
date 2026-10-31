# JM ServiceTec Eventos v3

Aplicación Android independiente para lectura local de documentos y control de acceso a eventos. El monorepo incluye la app, el API de sincronización en Railway y el panel de tenants en Netlify.

## Arquitectura

- **GitHub privado:** repositorio del código fuente.
- **Supabase:** login, perfiles, roles, empresas, eventos, operadores y directorio opcional.
- **Railway:** API autenticada; la app sincroniza con ella los registros de entrada.
- **MongoDB Atlas:** registros de escaneo y auditoría. Números de documento y nombres se cifran en la API con AES-256-GCM; la deduplicación usa HMAC.
- **Netlify:** panel web para crear empresas y administrar membresías mensuales o anuales.

La cámara y el análisis de cédula siguen funcionando localmente. La app envía los campos extraídos para sincronizar; no envía fotografías. La cola offline se mantiene cuando no hay red.

Los eventos archivados dejan de aceptar escaneos y conservan sus registros en Atlas. La eliminación individual o masiva de registros sigue siendo una acción separada del administrador.

## Carpetas

- `frontend/`: app Expo/React Native.
- `backend/`: API Node.js; configúrala como servicio Railway con raíz `/backend`.
- `supabase/`: migraciones y funciones Edge de autenticación y administración de tenants.
- `tenant-web/`: panel estático publicado en Netlify.
- `docs/INICIO_RAPIDO_INFRAESTRUCTURA.md`: orden de configuración, variables y verificaciones antes del primer despliegue.

## Estado

El código y las plantillas están preparados localmente. Todavía no se creó el repositorio remoto ni los recursos de Atlas/Railway/Netlify: la pestaña de GitHub mostraba el alta de cuenta y no hay conexiones de despliegue disponibles para esos proveedores. No se añadió ninguna credencial real. Consulta la guía para conectar cada proveedor sin publicar secretos en el repo.

Las membresías se activan manualmente después de confirmar el pago. No hay pasarela, cobro automático, precios, impuestos ni política de reembolsos configurados.

## Seguridad operativa

- No guardar secretos en GitHub, `.env` distribuido, `frontend/`, configuración pública de Netlify ni APK.
- La clave Supabase de servicio, URI de Atlas y claves AES/HMAC viven solo como variables de Railway.
- Netlify solo usa URL y publishable key de cliente; RLS y las Edge Functions controlan el acceso.
- No se definió eliminación automática de registros; primero hay que aprobar la retención aplicable al evento y a sus datos personales.
