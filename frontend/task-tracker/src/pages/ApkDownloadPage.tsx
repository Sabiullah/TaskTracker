import { APP_VERSION } from "@/appVersion";

/** Served from `public/` — Vite copies it into `dist/` unchanged, so it's
 *  downloadable at this path in every deployed build. */
const APK_PATH = "/TaskTracker-debug.apk";

export default function ApkDownloadPage() {
  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 24, textAlign: "center" }}>
      <img
        src="/logo.png"
        alt="TaskTracker"
        style={{ width: 96, height: 96, objectFit: "contain", marginBottom: 16 }}
      />
      <h2 style={{ margin: "0 0 4px" }}>TaskTracker Android App</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Version {APP_VERSION}</p>
      <a
        href={APK_PATH}
        download
        style={{
          display: "inline-block",
          marginTop: 16,
          padding: "10px 24px",
          background: "#2563eb",
          color: "#fff",
          borderRadius: 6,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        ⬇ Download APK (v{APP_VERSION})
      </a>
      <p style={{ marginTop: 16, fontSize: 13, color: "#6b7280" }}>
        Debug build for internal use. Enable &quot;Install unknown apps&quot;
        on your device if prompted. If you're replacing an older install and
        it fails, uninstall the previous app first.
      </p>
    </div>
  );
}
