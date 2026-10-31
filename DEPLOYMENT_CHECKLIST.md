# Puesta en marcha

El repositorio remoto `alfregom1112-max/Cc-scan-Jmcservice-` está creado pero vacío. Esta carpeta contiene el primer commit listo para subir.

## Antes de subir

- [ ] Confirmar que el repositorio de GitHub es el correcto y mantenerlo privado.
- [ ] No subir `.env`, claves, APKs firmadas, respaldos ni datos reales.
- [ ] Revisar que los archivos `.env.example` solo tengan marcadores.

## Credenciales que debes introducir en cada proveedor

### Supabase

Crear un proyecto de prueba y ejecutar las migraciones de `supabase/migrations/` en orden. Luego desplegar las funciones de `supabase/functions/`. Copiar únicamente la URL y la publishable key a la app y a Netlify. La service-role key solo va en Railway.

### MongoDB Atlas

Crear una base `jm_servicetec_events`, un usuario de aplicación con permisos mínimos y una URI `mongodb+srv://...`. Restringir el acceso de red a la salida de Railway cuando el plan lo permita; no usar `0.0.0.0/0` en producción.

### Railway

Conectar este repositorio, usar `backend` como servicio y cargar exactamente las variables de `backend/.env.example`. Generar las dos claves locales con:

```powershell
node backend/scripts/generate-keys.mjs
```

No pegar esas claves en GitHub, Netlify ni la aplicación móvil.

### Netlify

Importar el repositorio, conservar la configuración de `netlify.toml` y definir:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

El comando genera `tenant-web/dist/config.js` durante el build. Esa configuración contiene solo valores públicos; nunca poner allí service-role, MongoDB, AES/HMAC ni contraseñas.

### Aplicación Android

Para el build local o EAS, copiar `frontend/.env.example` a `frontend/.env` y completar URL pública de Supabase, publishable key y dominio HTTPS de Railway. Las imágenes se procesan localmente; la aplicación no debe recibir claves privadas.

## Verificación mínima

1. `GET https://<railway-domain>/v1/health` responde `ok: true`.
2. Netlify publica el panel sin error de configuración.
3. Supabase tiene las migraciones aplicadas y el usuario administrador activo.
4. Un evento de prueba permite registrar una lectura y evita duplicados.
5. La prueba offline sincroniza después de recuperar la red.
