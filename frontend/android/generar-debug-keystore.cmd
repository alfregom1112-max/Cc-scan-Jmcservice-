@echo off
setlocal
cd /d "%~dp0app"

where keytool >nul 2>nul
if errorlevel 1 (
  echo ERROR: No se encontro keytool. Instala un JDK y agregalo al PATH.
  exit /b 1
)

if exist "debug.keystore" (
  echo Ya existe app\debug.keystore; no se modifico.
  exit /b 0
)

keytool -genkeypair -v -storetype JKS -keystore debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
if errorlevel 1 exit /b 1

echo Keystore de prueba creado en frontend\android\app\debug.keystore
echo NO usar esta llave para Play Store ni para distribucion formal.
endlocal
