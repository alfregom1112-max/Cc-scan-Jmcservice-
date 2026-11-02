# Comprobaciones locales de esta entrega

- `npm ci --cache .npm-cache --prefer-offline`: correcto. npm indicó una vulnerabilidad baja en una dependencia de desarrollo.
- `npm run check`: sintaxis de los módulos JavaScript correcta. Se corrigió el uso de `URL.pathname` en Windows para que el verificador resuelva bien la carpeta fuente.
- `npm test`: 4 grupos de pruebas correctos (CSV, neutralización de fórmulas, membresía y formatos).
- `npm run build`: correcto con valores públicos de prueba para verificar el empaquetado. No se usaron las credenciales reales de producción en el build local.
- `git diff --check`: sin errores de espacios en los cambios.

## Pendiente de validar con servicios reales

- Inicio de sesión, RLS y roles reales de superadministrador, administrador y operador.
- Invitaciones, recuperación de contraseña y acciones de gestión de usuarios en Supabase.
- Sincronización y permisos de lectura reales con Render/MongoDB.
- Publicación de las Edge Functions en el proyecto Supabase de producción y confirmación del deploy de Netlify/Render.

Estas comprobaciones requieren que las credenciales estén configuradas en sus proveedores. El build de prueba no contiene claves privadas ni datos de clientes.
