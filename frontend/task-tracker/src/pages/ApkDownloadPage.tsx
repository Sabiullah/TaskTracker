import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { APP_VERSION } from "@/appVersion";
import { API_BASE, fetchApkVersion, type ApkVersionDto } from "@/lib/api";

/** Served from `public/` — Vite copies it into `dist/` unchanged, so it's
 *  downloadable at this path in every deployed build. Inside the exported
 *  APK the page's own origin has no copy (it's stripped at build time), so
 *  anchor the link to the API origin instead — that's the deployed web app. */
const APK_PATH = "/TaskTracker-debug.apk";
const apkHref = /^https?:\/\//.test(API_BASE)
  ? new URL(API_BASE).origin + APK_PATH
  : APK_PATH;

/** Inside the exported app the WebView has no download handler, so an anchor
 *  with a `download` attribute silently does nothing. Omit the attribute and
 *  hand the external URL to the system browser instead — Capacitor routes
 *  off-origin navigations there, and the browser performs the download. */
const isNative = Capacitor.isNativePlatform();

export default function ApkDownloadPage() {
  const [latest, setLatest] = useState<ApkVersionDto | null>(null);

  // The APP_VERSION constant is baked in at build time, so an installed APK
  // can only learn about newer builds from the backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await fetchApkVersion();
        if (!cancelled) setLatest(v);
      } catch {
        // Offline / endpoint missing — page still works with baked-in info.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestVersion = latest?.version ?? null;
  const lastUpdated = latest?.updated_at
    ? new Date(latest.updated_at).toLocaleString()
    : null;
  const updateAvailable = latestVersion !== null && latestVersion !== APP_VERSION;

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 24, textAlign: "center" }}>
      <img
        src="/logo.png"
        alt="TaskTracker"
        style={{ width: 96, height: 96, objectFit: "contain", marginBottom: 16 }}
      />
      <h2 style={{ margin: "0 0 4px" }}>TaskTracker Android App</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Version {APP_VERSION}</p>
      {latestVersion && (
        <p style={{ color: "#6b7280", marginTop: 4, fontSize: 13 }}>
          Latest release: v{latestVersion}
          {lastUpdated ? ` — updated ${lastUpdated}` : ""}
        </p>
      )}
      {updateAvailable && (
        <p
          style={{
            display: "inline-block",
            marginTop: 4,
            padding: "6px 12px",
            background: "#fef3c7",
            color: "#92400e",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          A newer version (v{latestVersion}) is available — download it below.
        </p>
      )}
      <br />
      <a
        href={apkHref}
        {...(isNative ? {} : { download: true })}
        onClick={
          isNative
            ? (e) => {
                // A same-tab navigation is the one path the WebView handles
                // reliably: Capacitor sees the off-origin URL and hands it to
                // the system browser, which performs the download. `download`
                // and `target="_blank"` anchors both dead-end in the WebView.
                e.preventDefault();
                window.location.href = apkHref;
              }
            : undefined
        }
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
        ⬇ Download APK (v{latestVersion ?? APP_VERSION})
      </a>
      <p style={{ marginTop: 16, fontSize: 13, color: "#6b7280" }}>
        Debug build for internal use. Enable &quot;Install unknown apps&quot;
        on your device if prompted. If you're replacing an older install and
        it fails, uninstall the previous app first.
      </p>

      {latest !== null && latest.releases.length > 0 && (
        <div style={{ marginTop: 24, textAlign: "left" }}>
          <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Release history</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  <th style={th}>Version</th>
                  <th style={th}>Updated</th>
                  <th style={th}>What changed</th>
                </tr>
              </thead>
              <tbody>
                {latest.releases.map((r) => (
                  <tr key={r.version}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>
                      v{r.version}
                      {r.version === APP_VERSION && (
                        <span
                          style={{
                            marginLeft: 6,
                            padding: "1px 6px",
                            background: "#dcfce7",
                            color: "#166534",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          installed
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "#6b7280" }}>
                      {new Date(r.updated_at).toLocaleString()}
                    </td>
                    <td style={{ ...td, whiteSpace: "pre-wrap" }}>{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 600,
  color: "#475569",
};
const td: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};
