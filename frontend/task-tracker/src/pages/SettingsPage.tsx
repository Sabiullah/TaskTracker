import { useEffect, useState } from "react";
import IntegrationsTab from "@/components/settings/IntegrationsTab";

type Toast =
  | { kind: "ok"; msg: string }
  | { kind: "err"; msg: string }
  | null;

function readToastFromUrl(): Toast {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const gcal = params.get("gcal");
  if (gcal === "connected") {
    return { kind: "ok", msg: "Google Calendar connected." };
  }
  if (gcal === "error") {
    const reason = params.get("reason") || "unknown";
    return { kind: "err", msg: `Couldn't connect: ${reason}.` };
  }
  return null;
}

export default function SettingsPage() {
  // Initial state computed once from the URL so we don't setState in an
  // effect (which triggers a cascading render and trips the lint rule).
  const [toast] = useState<Toast>(readToastFromUrl);

  // Strip the query params after first paint so a refresh doesn't re-trigger
  // the toast. This is a pure side-effect on the DOM/URL — no React state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("gcal") && !params.has("reason")) return;
    params.delete("gcal");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (rest ? `?${rest}` : ""),
    );
  }, []);

  return (
    <div style={{ padding: "16px 20px" }}>
      <h1 className="page-title" style={{ marginBottom: 14 }}>
        Settings
      </h1>

      {toast && (
        <div
          style={{
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 6,
            background: toast.kind === "ok" ? "#dcfce7" : "#fee2e2",
            color: toast.kind === "ok" ? "#166534" : "#991b1b",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {toast.msg}
        </div>
      )}

      <IntegrationsTab />
    </div>
  );
}
