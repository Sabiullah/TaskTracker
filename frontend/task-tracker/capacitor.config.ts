import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tasktracker.app",
  appName: "TaskTracker",
  webDir: "dist",
  server: {
    // Allow plain-HTTP fallback if the backend is ever addressed by raw IP.
    cleartext: true,
  },
  plugins: {
    // Route fetch/XHR through the native HTTP client so the backend's CORS
    // allowlist (which doesn't include the WebView's https://localhost
    // origin) doesn't block API calls.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
