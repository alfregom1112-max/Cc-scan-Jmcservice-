# Comparación de Pro SES y piloto: lector e integración

Fecha: 27 de octubre de 2026.

Pro: `D:\CcScanSes`. Piloto: `D:\CedulaScan_V2_Piloto`.

## Conclusión

No falta el motor nativo de Pro en la piloto. Se encontraron diferencias de integración entre la pantalla, la lectura manual y el servicio de datos. La recuperación añadida en 2.1.1 atiende un posible bloqueo del análisis, pero por sí sola no demuestra la causa de la regresión comunicada después de 2.0.9.

Se corrigen en 2.1.2 dos problemas demostrables: el botón local que invocaba una ruta de foto deshabilitada y la espera de red sin límite que mantenía pausado el escáner.

## Comparación comprobada

| Componente | Pro SES | Piloto | Resultado |
| --- | --- | --- | --- |
| Registro del módulo nativo, manifiesto y dependencias del lector | CameraX y ML Kit | Mismos archivos | No falta el módulo de Pro. |
| MrzLineLocator, FrameLease, ReadingQuality, ScanPerformance y UprightLuma | Implementación local | Archivos idénticos por SHA-256 | El cambio de base de datos no sustituyó estos lectores. |
| CedulaScannerView | Análisis en vivo | Mismo núcleo; comentario de resolución y vigilante añadido en 2.1.1 | El vigilante protege de un análisis bloqueado; no detecta una espera de red cuando la cámara está pausada. |
| Botón de foto/lectura manual | Cuenta con endpoints del backend | La pantalla invocaba api.barcodeCedula, que lanza un error deliberadamente porque no hay backend de fotos | Fallo reproducido en el código anterior. |
| Consulta y guardado | El cliente del backend tiene AbortController y tiempo máximo | Las RPC de Supabase no tenían un límite propio de la aplicación | Si una RPC no terminaba, handleScan mantenía scanBusyRef=true y scannerEnabled=false. |
| Identidad MRZ | Regla de documento/NUIP y rutas antiguas del intérprete | Validador canónico y revisión editable | No copiar el intérprete antiguo de Pro: reintroduciría interpretaciones que ya se corrigieron. Se preserva la regla del piloto para IDCOL. |
| Base de datos | Backend y MongoDB | Supabase directo y cola local cifrada | Son integraciones diferentes. Los endpoints de foto de Pro no están disponibles en el cliente de la piloto. |

## Evidencia sobre 2.0.9 y 2.1.0

Las APK se compararon entrada por entrada. Cambian el manifiesto, el perfil de optimización, el bundle y classes3.dex. El desensamblado de ese DEX únicamente difiere en versionCode/versionName, además de los nombres de archivo usados al inspeccionarlo. Los otros DEX son idénticos. En el bundle aparecen cambios de presentación de la pantalla.

No se dispone de una captura de ejecución del teléfono que demuestre qué condición ocurrió. Los fallos de integración encontrados no deben presentarse como prueba de que se introdujeron exactamente en 2.1.0: la ruta deshabilitada ya existía en el código previo. El diagnóstico distingue un defecto comprobado de una causa histórica aún no demostrada.

## Correcciones 2.1.2

- «Leer ahora» en Android con módulo local reinicia los lectores instalados y reactiva la lectura en vivo. Ya no toma una foto para llamar al servicio deshabilitado. La confirmación MRZ y la revisión de identidad siguen vigentes.
- La consulta de identidad tiene un límite de 6 segundos y el guardado de 10 segundos por intento. Si se necesita el intento de compatibilidad con el esquema anterior, tiene su propio límite de 10 segundos y conserva la misma clave de operación.
- El límite cubre también una espera anterior a la petición y redes que no resuelven al abortar. Se solicita la cancelación de la petición y se libera la espera de la pantalla.
- El error temporal mantiene status=0 para que el flujo existente entregue el registro a la cola. Se conserva la cédula, el nombre, el evento y la clave de idempotencia para evitar duplicaciones al reenviar. Un timeout no prueba si el servidor recibió el registro; por eso se reutiliza esa clave.
- Se mantienen las correcciones de 2.1.1 y los cambios de presentación existentes. No se cambian credenciales, tablas ni datos remotos.

## Pruebas de integración

`frontend/scripts/test-scanner-flow.cjs` ejecuta las funciones reales de producción extraídas de la pantalla y del contexto, con red y almacenamiento simulados:

1. En el código anterior, la prueba del botón falla: cero invocaciones del lector local en vez de una.
2. En el código corregido, el botón inicia el lector local y no toma fotos ni llama a la ruta deshabilitada.
3. Una consulta o guardado que nunca responde termina con error temporal y señal de cancelación.
4. Los errores de autorización se propagan; no se transforman en éxitos.
5. El intento de compatibilidad conserva la clave de idempotencia.
6. El contexto entrega a la cola el registro con su evento y nombre.
7. La función real handleScan libera el bloqueo y rearma el escáner después de una consulta que no responde.

Además: 337 casos compartidos de MRZ y 51 de identidad aprobados; TypeScript aprobado. ESLint de archivos revisados: cero errores, tres advertencias de estilo preexistentes en supabaseApi. Se conserva el conjunto de 43 pruebas nativas de la 2.1.1.

La entrega requiere comprobar cámara real, lectura de cédulas y sincronización en el teléfono. Las pruebas simuladas no certifican foco, iluminación, rendimiento o compatibilidad del dispositivo.

## Respaldo

Fuentes previas a este cambio: `respaldos/comparacion-pro-piloto-2026-10-27/fuentes-previas-2.1.2.zip`. La 2.1.1 se conserva en entregas. No desinstalar ni borrar los datos para actualizar.

## Entrega verificada

- APK: `D:\CedulaScan_V2_Piloto\entregas\2.1.2\CedulaScan-2.1.2-Lector-Local-Integrado.apk`.
- Paquete: `com.cedulascan.estandar`; versión 2.1.2; código 13.
- Firma válida e idéntica a la APK 2.0.9.
- SHA-256: `EAD0A9E6F01DC998E4090582E209823906ADF1C7F9C80D5201E3F798DF67AD5F`.
- Compilación final: BUILD SUCCESSFUL. Registro: `.tmp/comparacion-pro-piloto-2.1.2-final.log`.
- Se compararon las fuentes incluidas en el mapa del bundle final con los archivos actuales de scanDeadline, supabaseApi, LocalCedulaCamera y la pantalla escanear: coinciden.
- Las 43 pruebas nativas no tienen fallos ni errores. La prueba de integración final pasa. No había dispositivos conectados al terminar la verificación.
