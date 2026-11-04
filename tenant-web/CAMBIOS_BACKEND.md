# Cambios de backend aplicados al código fuente
Las cuatro correcciones descritas aquí ya están integradas en `backend/` y `supabase/functions/` de este repositorio. Deben quedar desplegadas en Render y en el proyecto Supabase `sjmjgfimnwvepghoqjgh` antes de probar el portal; la publicación de funciones se verifica desde el panel de Supabase de la cuenta `alfregon1112@gmail.com`.

| Parche | Problema verificado en el código | Efecto si no se aplica |
|---|---|---|
| `01-admin-user-status-cors` | La función no responde `OPTIONS` ni envía cabeceras CORS (las demás sí). | El preflight del navegador falla: **desactivar, activar y eliminar usuarios no funciona desde el portal**. |
| `02-admin-user-resend-redirect` | Reenvío usa `https://jmservicetec.com/accept-invite.html` fijo. | El enlace lleva al dominio histórico, no al portal. |
| `03-admin-user-invite-redirect` | Acepta cualquier `https://` o `localhost` como `redirect_to`; la rama de recuperación usa el dominio fijo. | Redirección abierta potencial y dominio histórico. |
| `04-api-stats-hoy-y-privacidad` | `hoy` usa `setUTCHours(5)` sobre la fecha UTC: de 19:00 a 24:00 (Colombia) el inicio queda en el futuro y devuelve 0. `/stats` devuelve `recientes` (documento y nombre de todos los operadores) a cualquier rol y `0` fijos en duplicados/dispositivos activos. | Cifra de hoy errónea por la noche; un operador podría leer registros ajenos llamando a la API. |

Las funciones permiten por defecto el dominio `https://ccscanjmcservice.netlify.app` y redirigen a la raíz del portal. Se pueden sustituir estos valores con los secretos `PORTAL_ORIGINS` (orígenes separados por coma) y `DEFAULT_PORTAL_URL`. Supabase Auth debe permitir ese origen en *Authentication → URL Configuration → Redirect URLs*. El portal ya envía `redirect_to` para invitaciones nuevas. El reenvío usa el destino seguro predeterminado. El cálculo “hoy” usa la fecha de Colombia y la interfaz lo muestra durante todo el día.

Otros hallazgos sin parche: `GET /v1/events/:id/count` cuenta solo al usuario que consulta (también para admin); el portal lo usa solo en la vista de operador. La RLS de la migración de tenants aísla correctamente por `tenant_id` (superadmin solo ve su empresa interna en datos operativos; todos los `tenants` por `is_platform_admin()`); falta probarla con cuentas reales. Falta función para regenerar el PIN del administrador de una empresa.
