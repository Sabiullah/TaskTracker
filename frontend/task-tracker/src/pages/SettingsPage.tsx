import { useEffect, useState } from "react";
import IntegrationsTab from "@/components/settings/IntegrationsTab";

type Toast =
  | { kind: "ok"; msg: string }
  | { kind: "err"; msg: string }
  | null;

export default function SettingsPage() {
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (!gcal) return;
    if (gcal === "connected") {
      setToast({ kind: "ok", msg: "Google Calendar connected." });
    } else if (gcal === "error") {
      const reason = params.get("reason") || "unknown";
      setToast({ kind: "err", msg: `Couldn't connect: ${reason}.` });
    }
    // Strip query params so a refresh doesn't re-trigger the toast.
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
