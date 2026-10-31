# CedulaScan Piloto — documentación de la APK 2.1.9

**Fecha de revisión:** 28 de octubre de 2026  
**Paquete Android:** `com.cedulascan.estandar`  
**Versión:** 2.1.9 (versionCode 20)  
**Plataforma:** Android; usa Supabase para autenticación y datos. La app procesa la lectura de documentos localmente.

## 1. Para qué sirve

CedulaScan registra el ingreso de personas a eventos mediante lectura de cédula. La asistencia se guarda aunque no exista una base de personas; si el administrador carga un directorio opcional, la app muestra una coincidencia básica después del registro y permite al administrador gestionar eventos, operadores, personas, escaneos y reportes. El administrador también puede escanear. La aplicación no autentica oficialmente la cédula ni reemplaza la verificación de la Registraduría.

## 2. Roles y permisos funcionales

### Administrador

- Crear y gestionar eventos.
- Escanear documentos, igual que un operador.
- Consultar métricas y administrar usuarios y datos.
- Crear operadores mediante PIN de autorización.
- Bloquear, reactivar o eliminar cuentas de usuario, según las acciones habilitadas por la versión.
- Exportar registros del evento y, según configuración, gestionar la base de personas.

### Operador

- Crear su cuenta en la app con nombre, correo, contraseña y PIN entregado por el administrador.
- Seleccionar los eventos a los que fue asignado y registrar ingresos.
- Consultar su propio historial y contador por evento.
- No debe ver auditoría ni historial de otros operadores. La política de lectura de `scans` en Supabase fue ajustada el 28-10-2026 para permitir al operador ver sus filas propias y al administrador ver todas.

Los permisos reales se deben imponer en Supabase (RLS y funciones), no únicamente ocultando botones en la interfaz.

## 3. Puesta en marcha

1. Instalar la APK sobre la versión anterior para conservar el historial y la cola sin conexión del dispositivo. **No desinstalar ni borrar los datos de la app durante la actualización.**
2. Abrir CedulaScan e iniciar sesión. Para un nuevo operador, el administrador genera y entrega un PIN desde la gestión de usuarios; el operador elige **Activar cuenta** dentro de la app y completa nombre, correo, PIN y contraseña.
3. Conceder permiso de cámara cuando Android lo solicite. Bluetooth solo se requiere si se utilizará impresora compatible.
4. El administrador crea el evento y asigna operadores. El operador selecciona el evento vigente antes de iniciar el escaneo.
5. Mantener conexión a internet para cargar eventos, validar accesos y sincronizar. Si se escanea sin conexión, los pendientes quedan en el almacenamiento local cifrado y se sincronizan al recuperar conexión. Verificar el indicador de pendientes antes de cerrar la operación.

## 4. Flujo de escaneo

1. Abrir **Escáner** y seleccionar evento.
2. Enfocar el código PDF417 o la zona MRZ con iluminación suficiente y mantener la cédula dentro del marco.
3. La app interpreta localmente los datos legibles y registra la asistencia. Si un administrador carga un directorio opcional, la app puede mostrar una coincidencia básica después de guardar; la falta de base o de coincidencia nunca impide registrar.
4. El resultado se registra con evento, operador, dispositivo y fecha/hora. La app evita duplicados según las reglas del registro.
5. Confirmar el resultado en pantalla. Si la lectura falla, limpiar lente, mejorar luz, volver a encuadrar y usar el mecanismo manual disponible.

La lectura es una ayuda de captura. El operador debe resolver ambigüedades visuales; no usar una lectura automática como prueba de identidad auténtica.

## 5. Historial y sincronización

- Los registros confirmados se guardan en Supabase.
- La app conserva una caché local del historial propio por evento y una cola de escaneos pendientes; la base local Android usa SQLCipher y la llave se guarda con SecureStore.
- El historial local es una copia de consulta, no reemplaza la base central ni constituye respaldo independiente.
- La salida de sesión no debe usarse como método de borrado. La desinstalación sí puede eliminar datos locales; no desinstalar si hay pendientes o historial que se necesite conservar.
- Una cola antigua de versiones previas se migra desde AsyncStorage. Si no se puede interpretar, se conserva para recuperación y puede permanecer en almacenamiento anterior sin cifrar. Resolverla antes de tratar datos reales.
- El administrador puede borrar datos del servidor mediante las acciones de gestión disponibles. La eliminación central no garantiza por sí misma la purga de cachés locales, CSV compartidos, registros técnicos o respaldos.

## 6. Exportar e imprimir

- La exportación CSV contiene documento, nombre, dispositivo y fecha de registro. No incluye afiliación ni aportes.
- En Android el CSV se escribe en el directorio de caché y se abre el menú Compartir. Copias que otras apps guarden quedan bajo control de esas apps; la APK no elimina automáticamente el archivo luego de compartir.
- Enviar el archivo solo a personas autorizadas, proteger el dispositivo y borrar copias cuando ya no sean necesarias.
- La impresión Bluetooth depende de impresora y permisos compatibles; no es necesaria para escanear.

## 7. Datos que se procesan

| Categoría | Ejemplos | Dónde / propósito |
|---|---|---|
| Cuenta | nombre, correo, identificador de usuario, rol, estado | Supabase Auth y `profiles`; acceso y administración |
| PIN de alta | PIN, correo asociado, caducidad/uso | Función de activación y tabla de invitaciones; autorizar creación de cuenta |
| Identificación | número de cédula y nombre | Se extraen localmente de la lectura y se comparan/registran para control de ingreso |
| Directorio opcional | documento, nombre, sede, municipio y cargo cuando el cliente carga un CSV | Base `people`; solo administradores pueden importar y buscar. Sin aportes ni condición de afiliación |
| Escaneo | evento, operador, identificador de dispositivo, fecha/hora, datos de asistencia | Supabase `scans`, historial local y cola offline |
| Auditoría y telemetría | acción, usuario, IP, región aproximada, agente del cliente, marcas de tiempo | registros de auditoría y logs del proveedor; seguridad, diagnóstico y operación |
| Exportación | documento, nombre, dispositivo, fecha | CSV temporal local y destinos elegidos al compartir |

La app no envía imágenes del documento a OCR remoto en esta versión: los lectores activos procesan localmente y las funciones antiguas de OCR remoto devuelven error indicando que no se envía imagen. Los archivos temporales de captura se eliminan al terminar el procesamiento normal. Debe comprobarse en pruebas del dispositivo toda ruta de error antes de afirmar borrado perfecto.

## 8. Seguridad y permisos Android

- Sesión y llave de SQLCipher usan SecureStore.
- La base SQLite offline usa SQLCipher cuando el build incluye soporte cifrado.
- `allowBackup=false` en la configuración Android de esta versión.
- Permisos previstos: cámara, internet, vibración y Bluetooth para impresión. Ubicación fina se conserva únicamente para compatibilidad de búsqueda Bluetooth en Android antiguos (API 30 o menor).
- Se retiraron permisos no requeridos directamente como almacenamiento externo, ventana superpuesta, coarse location y Bluetooth advertise. Confirmar el manifiesto combinado final del APK después del build, porque librerías pueden aportar permisos.
- TLS protege el transporte a Supabase. RLS limita el acceso a tablas. No se debe colocar `service_role` ni secretos de servidor dentro de la APK.

## 9. Configuración y operación

- Proyecto de datos auditado: Supabase `jpgutodasjltatrotgdq`; región observada en logs: `us-east-1`.
- La APK debe contener solamente la URL del proyecto y clave pública anon/publishable. Las claves administrativas permanecen en Edge Functions.
- Funciones observadas: `admin-user-pin-create`, `activate-user-pin`, `admin-user-status`; endpoints heredados `admin-user-invite` y `admin-user-resend` están retirados y responden 410.
- Se revocó acceso directo a `account_pin_invites` para `anon`/`authenticated` y ejecución pública de funciones internas de trigger.
- No hay equipo Android conectado en este entorno; el flujo de cámara, Bluetooth, actualización y conservación de la cola debe validarse en teléfonos físicos antes de producción.

## 10. Actualización y recuperación

- Instalar la nueva APK encima de la existente, con el mismo paquete y firma compatible.
- Antes de actualizar, sincronizar la cola pendiente y exportar solo si el procedimiento autorizado lo exige.
- No borrar datos ni desinstalar como solución de errores si se necesita recuperar histórico offline.
- Si se bloquea una cuenta, cerrar sesión y volver a validar acceso; las reglas activas de backend deben impedir nuevas lecturas/escrituras. Revocar sesiones existentes es una medida operativa que debe verificarse en la función administrativa.
- Reportar problemas al administrador incluyendo versión, modelo Android, hora y mensaje de error; no enviar fotos de cédulas por canales no aprobados.

## 11. Funciones conocidas como limitadas

- El alta pública por correo está cerrada; el mecanismo vigente es PIN de administrador.
- La importación opcional de directorio está disponible para administradores mediante CSV y solo admite datos básicos de identificación y ubicación laboral.
- El enlace web de activación heredado no forma parte del flujo móvil; completar alta dentro de la APK.
- El contador/historial local depende de la caché sincronizada con servidor y no debe considerarse backup permanente.
- Persisten riesgos del PIN, retención, exportación y formalización legal; revisar el documento de auditoría antes de producción.

## 12. Lista operativa de salida

- [ ] Probar instalación como actualización en Android real y confirmar que no borra historial/pendientes.
- [ ] Probar cuenta nueva mediante PIN, límites de intentos y expiración.
- [ ] Probar bloqueo de operador durante una sesión activa y que no pueda seguir consultando ni registrando.
- [ ] Probar lectura MRZ y PDF417 con documentos de prueba autorizados y corregir manualmente cualquier discrepancia.
- [ ] Confirmar que el operador solo consulta su historial y que el administrador ve lo necesario.
- [ ] Probar cola offline, reconexión, duplicados, cierre de sesión y recuperación de errores.
- [ ] Revisar permisos efectivos del APK con herramientas Android y probar impresión si se ofrece.
- [ ] Publicar política, aviso, canal de derechos, autorización y acuerdo de encargo de cada cliente antes de datos reales.
- [ ] Definir retención, purga del servidor, caché local, exportaciones y respaldos.
- [ ] Obtener revisión legal y de seguridad independiente; este documento no es certificación.


