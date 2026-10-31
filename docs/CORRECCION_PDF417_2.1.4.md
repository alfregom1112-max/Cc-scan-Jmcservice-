# Corrección PDF417 — piloto 2.1.4

Fecha: 27 de octubre de 2026.

## Fallo reproducido

La cámara transmite el contenido PDF417 binario como una cadena Latin-1 que conserva los bytes. El intérprete clásico lee documento, apellidos y nombres en posiciones fijas. Tanto el intérprete como los normalizadores de la pantalla aplicaban `trim()` antes de interpretar el contenido. Bytes como tabulación, salto de línea, espacio o espacio no separable al principio del contenido se eliminaban; el resto de los campos quedaba desplazado. La pantalla podía rechazar esa identidad antes de llegar al registro.

El problema es independiente de la resolución de la cámara. Restaurar el módulo de Pro no corregía este tratamiento de los bytes en la integración local. Pro además dispone de un backend de lectura por foto, mientras que esa ruta está deshabilitada en la piloto.

La comparación adicional del intérprete del servidor de Pro encontró una omisión de funcionalidad: `parse_pdf417_bytes` intenta primero el formato fijo y después `_parse_classic_pdf417_split`, una variante compacta con campos separados por bytes nulos. El intérprete local de la piloto solo incluía el formato fijo. Se reprodujo el rechazo del formato compacto en la pantalla anterior y se incorporó su equivalente local. Se ejecutó también el intérprete real de Pro sobre las dos variantes compactas sintéticas para confirmar el número y los nombres esperados.

Se añadieron primero 60 comprobaciones sobre las funciones de producción anteriores: 37 fallaron y 23 pasaron. Las pruebas usan cargas sintéticas de 531 bytes del formato posicional que ya soportaba la aplicación, variando la cabecera, relleno y presencia de marcador. No se utilizan documentos personales reales. El resultado previo se conserva en `.tmp/pdf417-antes-2.1.4.log`.

## Cambios

- `parsePdf417` y `extractCedula` intentan la lectura posicional sobre el contenido original, antes de cualquier limpieza de texto.
- La normalización de QR conserva intactos los PDF417 binarios. La comprobación de confiabilidad de la pantalla también interpreta el contenido original.
- Se incorpora el formato compacto del servidor Pro, con número unido a la ficha o en un campo separado. Se admite relleno nulo repetido y ausencia del segundo nombre, comprobando la estructura de metadatos, el número y los campos de nombre antes de aceptarlo.
- Se conserva el número completo y los campos de nombre y apellidos, incluyendo tildes y Ñ en Latin-1.
- Si un contenido binario no se reconoce, no se convierte en una búsqueda genérica de números.
- El campo documental posicional debe contener dígitos: ya no se eliminan letras o bytes corruptos para fabricar un número.
- Si la cámara detecta PDF417 pero el intérprete no acepta su contenido, se muestra un aviso explícito, con frecuencia limitada. No se imprime ni se sube el contenido del documento a un registro de diagnóstico.
- El motor de cámara de Pro, su resolución y los cuatro manejadores nativos/JS permanecen como en 2.1.3.

## Verificación

`node scripts/test-pdf417-flow.cjs`: 112 comprobaciones aprobadas:

- 60 comprobaciones del intérprete y de las funciones reales de normalización y filtro de la pantalla, con seis cabeceras y dos variantes de relleno/marcador.
- Tres comprobaciones de rechazo de contenido binario corrupto o truncado.
- 32 comprobaciones de formato compacto: dos variantes, dos tipos de relleno y segundo nombre presente/ausente, verificando interpretación y paso por los filtros reales de la pantalla.
- Tres comprobaciones de rechazo de formato compacto con número, sexo o fecha dañados.
- Ocho comprobaciones que ejecutan la función real handleScan, con ambos formatos, y verifican el número y el nombre completo entregados al guardado. La red, la vibración y el almacenamiento se simulan; no se escribieron datos de prueba en Supabase.
- Seis comprobaciones adicionales recorren todos los casos MRZ válidos tanto con separadores normales como con variantes OCR, a través de parsePdf417 y extractCedula. La clasificación de MRZ precede al rechazo genérico de datos binarios.

También pasan los 337 casos de MRZ, 51 de identidad, las pruebas de flujo de escaneo, TypeScript y ESLint del intérprete. La prueba de paridad confirma los 11 archivos del lector/configuración y los cuatro manejadores de eventos de Pro.

## Alcance

La corrección cubre la pérdida de bytes del formato binario posicional y la variante compacta que soportaba el servidor Pro. No demuestra que todos los formatos PDF417 existentes sean compatibles ni qué formato contiene el documento concreto del usuario. No hubo un teléfono conectado para capturar su contenido o probar físicamente la cámara. Si se muestra el aviso de formato no interpretable, se necesita identificar ese formato con una muestra de prueba autorizada antes de ampliar el intérprete; no deben adivinarse campos.

## Respaldo e instalación

Fuentes previas: `respaldos/pdf417-2026-10-27/fuentes-previas.zip`.

Instalar la APK como actualización sobre la piloto, sin desinstalar ni borrar datos. No se modificaron las credenciales, el esquema de Supabase ni los registros existentes.

## Entrega final verificada

- APK: `D:\CedulaScan_V2_Piloto\entregas\2.1.4\CedulaScan-Piloto-2.1.4-PDF417-Corregido.apk`.
- Paquete `com.cedulascan.estandar`, versión 2.1.4, código 15.
- Firma válida e idéntica a la piloto 2.0.9.
- SHA-256: `7F3C6C0E093C7851E1900720F4D3D336CDCD3A0FE8DA1984F97E8129189C3020`.
- Compilación final: BUILD SUCCESSFUL. Registro `.tmp/pdf417-2.1.4-entrega.log`. Un intento previo de empaquetado falló y fue resuelto al repetir ese paso; no se entrega la salida del intento fallido.
- Se comprobó que el bundle dentro de la APK coincide por SHA-256 con el bundle compilado final, incluye la variante compacta y corresponde a las fuentes actuales del intérprete y la pantalla.
- 37 pruebas nativas aprobadas; el lector y su configuración conservan la paridad con Pro. El cambio de esta versión está en el intérprete local y su integración.
