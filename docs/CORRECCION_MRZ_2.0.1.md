# Corrección de lectura MRZ — APK piloto 2.0.1

Fecha: 26 de octubre de 2026.
Proyecto: D:\CedulaScan_V2_Piloto.

## Entrega

- APK: `D:\CedulaScan_V2_Piloto\entregas\2.0.1\CedulaScan-Piloto-2.0.1-MRZ-corregido.apk`.
- Paquete Android: `com.cedulascan.estandar`.
- Versión: 2.0.1, código 2.
- SHA-256: `9BBD1B24DD02A0F83207882ADA4ACF9AA7D78E305DEB8D15289439E00F3C6002`.
- Firma verificada y certificado idéntico al de la APK 2.0.0 respaldada. Esta entrega permite actualizar esa instalación compatible sin desinstalarla. No corresponde al paquete de CedulaScan Pro.

## Problemas reproducidos

1. La cámara y la pantalla utilizaban intérpretes diferentes. El intérprete antiguo podía seleccionar el serial interno de nueve dígitos cuando el NUIP de una MRZ ICCOL tenía entre cinco y nueve dígitos. La prueba falló antes de corregir el código: devolvía el serial 123456789 en lugar del NUIP sintético 76543.
2. Una heurística de limpieza de nombres podía eliminar letras iniciales de apellidos.
3. La pantalla daba prioridad silenciosa al nombre de la base sobre el nombre del documento. También podía mostrar GUARDADO antes de terminar la operación y comunicar éxito a la cámara aunque no se hubiera guardado.

## Cambios aplicados

- Un único validador estricto alimenta parseMrz, parsePdf417 y extractCedula cuando el contenido es MRZ. Una MRZ reconocida que no supera la validación no se convierte en una búsqueda genérica de números.
- Se conserva la regla específica del piloto para IDCOL: no se reemplaza por la regla de NUIP de ICCOL.
- Se eliminan las heurísticas que recortaban letras de apellidos. Se conserva el nombre completo para su revisión y registro.
- Antes de consultar y guardar una identidad proveniente de MRZ, se presenta una revisión editable del número y del nombre completo. Cancelar no guarda. Si se cambia el número, se vuelve a consultar ese número y se descartan los metadatos de identidad asociados al anterior.
- Una diferencia entre el nombre confirmado y el nombre de la base exige resolver el conflicto; el nombre no se sustituye silenciosamente.
- La cámara recibe el resultado real de la operación. El aviso de guardado aparece después del éxito. Se comprueba que el evento y la sesión de lectura sigan vigentes antes de escribir; salir o poner la aplicación en segundo plano cancela la revisión pendiente.
- Se conserva el lector local y sus modelos incluidos en la APK. No se añade una licencia comercial ni una dependencia de Gemini a esta corrección.

## Por qué se requiere revisar los nombres

Los controles de MRZ TD1 no incluyen la línea de nombres. Una lectura con un nombre equivocado puede pasar los dígitos de control, y repetirla en varios fotogramas no demuestra que sea correcta. Las pruebas reproducen esta limitación y comprueban que el candidato sigue exigiendo revisión. Los dígitos de control tampoco autentican por sí solos un documento.

Referencia de formato y posiciones: [ICAO Doc 9303, Parte 5](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p5_cons_en.pdf). Convenciones de nombres: [ICAO Doc 9303, Parte 3](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf).

## Verificación realizada

- 337 casos compartidos de MRZ, paridad del intérprete y consenso: aprobados.
- 51 comprobaciones de regresión de identidad: aprobadas. Cubren NUIP de cinco a diez dígitos, conservación de apellidos, rechazo de MRZ inválidas, validación del formulario y comparación del nombre con la base.
- 37 pruebas nativas del lector: aprobadas, sin fallos ni errores.
- Comprobación TypeScript: aprobada.
- ESLint de los utilitarios modificados y el nuevo componente de revisión: aprobado.
- La pantalla de escaneo mantiene siete errores de reglas de hooks que ya existían antes de esta corrección. No se declara aprobado el lint completo de esa pantalla.
- Compilación final de release: BUILD SUCCESSFUL. Registro: `.tmp/mrz-correction-2.0.1-final.log`.
- Firma y paquete Android verificados. La APK incluye el bundle de la aplicación y 21 archivos de modelos OCR locales.

No había un teléfono conectado. No se ha validado físicamente la cámara, la interacción del formulario ni una instalación sobre el teléfono del usuario. No se garantiza un tiempo inferior a 150 ms ni ausencia absoluta de errores.

## Respaldo y datos existentes

- Fuentes anteriores respaldadas: `D:\CedulaScan_V2_Piloto\respaldos\correccion-mrz-2026-10-26\codigo-anterior.zip`.
- APK anterior: `D:\CedulaScan_V2_Piloto\respaldos\correccion-mrz-2026-10-26\APK_anterior_2.0.0.apk`.
- Estos archivos son un respaldo de código y APK; no son una copia de la base de datos.
- No se modificaron las credenciales, el esquema ni los registros de Supabase. No se desplegó el servidor de otro proyecto.
- Los registros históricos que ya contengan datos equivocados requieren revisión separada; no se borraron ni se corrigieron automáticamente.
- Para instalar, usar la APK 2.0.1 sobre la piloto compatible y aceptar la actualización. No desinstalar la aplicación para instalar esta entrega. Si Android informa incompatibilidad de firma, conservar la instalación y revisar qué APK está instalada.

## Validación pendiente en el teléfono

1. Leer una cédula con NUIP corto y comparar cada dígito y todo el nombre con el documento físico.
2. Cancelar la revisión y comprobar que no aparece un registro nuevo.
3. Confirmar datos correctos y comprobar el resultado guardado; verificar también el funcionamiento sin conexión y la posterior sincronización.
4. Probar un conflicto con el nombre de la base y confirmar que se presenta la decisión al operador.

Usar un evento de prueba para estas comprobaciones. No publicar fotos, nombres ni números reales en informes de errores.
