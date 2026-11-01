# Android delivery — JM ServiceTec Eventos

## Current state

- The Android source and mockup-aligned navigation are in GitHub `main`.
- TypeScript passed and Expo generated the Android JavaScript bundle.
- Scanner capture, PDF417, and MRZ logic were left unchanged; scanner changes are visual.
- A working APK has not been built yet because `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is not present in the local build environment.

## Configure the one missing value

In Supabase project `sjmjgfimnwvepghoqjgh`, open **Project Settings → API Keys**, copy the **Publishable key** (`sb_publishable_...`), and put it in `frontend/.env` as `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Use `frontend/.env.example` as the starting point. It already contains the correct Supabase project URL and Render API URL. Do not commit `frontend/.env`, share the key in chat, or use a `service_role` key in the mobile app.

## Build a test APK on Windows

From the repository root in PowerShell:

```powershell
Copy-Item .\frontend\.env.example .\frontend\.env
notepad .\frontend\.env
cd .\frontend
npm install --legacy-peer-deps
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p .\android assembleDebug
```

The APK is created at:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

This debug APK is for direct installation and internal testing. Before publishing through Google Play, link the Expo project to the company Expo/EAS account and configure a production signing key that JM ServiceTec retains for future app updates.

## User acceptance check

1. Install the APK on an Android phone with a camera.
2. Sign in with the active JM ServiceTec superadmin.
3. Check Inicio, Eventos, scanner, and Más → Auditoría/Equipo/Reportes; check Empresas as superadmin.
4. Sign in with an operator and confirm that only the operator's jornada, scanner, history, and profile are available.
5. Scan a test document and verify the result and server sync.

Web portal: https://coruscating-truffle-13663a.netlify.app/
API health endpoint: https://jm-servicetec-api.onrender.com/v1/health
