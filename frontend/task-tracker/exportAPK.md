# Exporting the TaskTracker Android APK

How to build `TaskTracker-debug.apk` from the React/Vite frontend using
Capacitor. All commands run from `frontend/task-tracker/` unless noted.

## Prerequisites (one-time)

- **Node.js** 20+ and npm
- **Java JDK** 17 or 21
- **Android SDK** (install via Android Studio; `ANDROID_HOME` must point to it,
  e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`)

## One-time project setup (already done on this branch)

1. Install dependencies and Capacitor:

   ```sh
   npm ci
   npm install @capacitor/core @capacitor/cli @capacitor/android
   ```

2. `capacitor.config.ts` — app identity, plus two settings that matter:

   - `server.cleartext: true` — allows plain-HTTP if the backend is ever
     addressed by raw IP.
   - `plugins.CapacitorHttp.enabled: true` — routes fetch/XHR through the
     native HTTP client. **Required**: the WebView's origin is
     `https://localhost`, which is not in the backend's
     `CORS_ALLOWED_ORIGINS`, so without this every API call fails with
     "Failed to fetch".

3. `.env.production` — the backend baked into the build:

   ```ini
   VITE_API_BASE_URL=https://tasktracker.fourdadvisory.com/api
   VITE_WS_URL=wss://tasktracker.fourdadvisory.com/ws/
   ```

   The server (49.12.190.43) force-redirects HTTP→HTTPS and its TLS
   certificate covers `*.fourdadvisory.com` only, so the domain — not the raw
   IP — must be used.

4. Add the Android platform:

   ```sh
   npx cap add android
   ```

5. App icons — generated from `asset/logo.png` (repo root) into 1024px
   sources under `assets/`, then:

   ```sh
   npx capacitor-assets generate --android
   ```

## Building the APK (every release)

```sh
npm run build              # 1. build web bundle (bakes in .env.production)
npx cap sync android       # 2. copy dist/ + config into android/
cd android
./gradlew assembleDebug    # 3. compile the APK
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Changing the backend URL later

Edit `.env.production`, then repeat the three build steps above. The URL is
baked in at `npm run build` time — editing the file alone does nothing.

## Installing on a phone

Copy the APK to the device and open it (enable "Install unknown apps" if
prompted). When replacing a build that changed `capacitor.config.ts` or the
icons, **uninstall the old app first**.

## Troubleshooting

- **"Failed to fetch"** — CapacitorHttp is disabled or the backend URL is
  wrong. Check `capacitor.config.ts` and `.env.production`, then rebuild.
- **Gradle: "Could not read workspace metadata"** — corrupted cache; delete
  `C:\Users\<you>\.gradle\caches\<version>\transforms` and rebuild.
- **Chat realtime not updating** — Django Channels validates the WebSocket
  `Origin: https://localhost` against server `ALLOWED_HOSTS`; add `localhost`
  to that env var on the server and restart the backend.

## Release (Play Store) builds

`assembleDebug` produces a debug-signed APK, fine for internal use. For a
release build you need a signing keystore and `./gradlew assembleRelease`
(or `bundleRelease` for an AAB) — see
https://capacitorjs.com/docs/android/deploying-to-google-play
