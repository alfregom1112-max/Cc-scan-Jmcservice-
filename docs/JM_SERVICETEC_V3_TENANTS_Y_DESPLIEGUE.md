# JM ServiceTec v3: tenants, membresías y despliegue

## Roles

- **Administración de JM ServiceTec** (`is_platform_admin=true`): crea y consulta empresas, genera el PIN inicial y administra el estado de sus membresías. Esta cuenta mantiene acceso operativo únicamente a su tenant interno; la consola de cartera no entrega registros de asistencia de otras empresas.
- **Administrador de empresa** (`role=admin`): administra eventos, carga opcional de personas, operadores y dispositivos dentro de su tenant.
- **Operador** (`role=operator`): trabaja en los eventos que se le asignan dentro de su tenant.

## Estados y periodos

- Periodos soportados: mensual y anual.
- Estados: pendiente de pago, activa, prueba, pago vencido, suspendida y cancelada.
- Crear empresa deja el estado `pending_payment`; el PIN vence en 30 minutos y queda ligado al correo ingresado.
- JM ServiceTec activa el plan después de verificar el pago. `activate` inicia un periodo; `renew` suma otro periodo, respetando la vigencia actual.
- La expiración se valida en los permisos de datos y en la RPC de escaneo. El teléfono conserva las lecturas offline; al suspender o expirar, la sincronización queda rechazada sin borrar la cola local.
- No se captura pago, no se genera factura, y no se renueva automáticamente en esta entrega.

## Separación de datos

La migración agrega `tenant_id` a perfiles, eventos, escaneos, operadores de eventos, directorios de personas, importaciones, dispositivos, métricas y auditoría. `profiles` conserva el rol `admin/operator`, pero el antiguo índice que permitía un solo admin activo se elimina. Cada registro preexistente se asigna al tenant interno JM ServiceTec para conservar la app piloto ya activa.

Las políticas RLS filtran por tenant. Las funciones `record_scan`, `lookup_person_for_scan` e `import_people_directory` también validan el tenant, de modo que no dependen de los filtros de la interfaz. Las cuentas internas de plataforma no obtienen acceso global a escaneos de clientes.

## Despliegue y claves

La APK solo necesita `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. El `service role key` se guarda únicamente en Supabase Edge Functions. No compartirlo por chat, incorporarlo a `.env` distribuido, ni compilarlo dentro de la APK.

En el proyecto de Supabase, configurar los secretos de Edge Functions y desplegar las funciones tenant antes de activar membresías. No aplicar la migración al proyecto en uso hasta revisar el backup y confirmar la estructura real de producción.

Render no forma parte de la ruta de escaneo heredada de la piloto 2.2.0. La persistencia y autenticación usan Supabase. Si luego se agrega pago en línea, Render podrá recibir webhooks mediante secretos del servidor; el proveedor, monedas y precios aún deben definirse.

## Límites pendientes antes de comercializar

1. Definir precios mensual/anual y si incluyen IVA.
2. Elegir pasarela y especificar renovaciones, reembolsos, suspensión y cobranza.
3. Configurar correo transaccional/recuperación de cuenta y dominios de enlaces.
4. Probar aislamiento con tenants de ensayo y dos operadores distintos.
5. Aprobar aviso y contrato de tratamiento de datos para la operación real.
6. Confirmar logo vectorial oficial y corregir detalles visuales si la marca ya dispone de manual.
