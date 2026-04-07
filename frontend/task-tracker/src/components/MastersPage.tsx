import { useState, useRef } from "react";
import type { MasterItem, ModalState } from "@/types/masters";
import {
  CLIENTS as DEFAULT_CLIENTS,
  CATEGORIES as DEFAULT_CATS,
  TEAM_MEMBERS as DEFAULT_TEAM,
  AVATAR_COLORS,
} from "@/constants";

const SWATCH = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#dc2626",
  "#4f46e5",
  "#0f766e",
  "#b45309",
  "#6d28d9",
  "#059669",
  "#9333ea",
  "#0284c7",
];

function loadLS(key: string, def: MasterItem[]) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}
function saveLS(key: string, val: MasterItem[]) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

// Build default arrays from initialData.js constants (used if localStorage is empty)
const SEED_CLIENTS = DEFAULT_CLIENTS.map((name, i) => ({
  id: "c" + (i + 1),
  name,
}));
const SEED_CATS = DEFAULT_CATS.map((name, i) => ({
  id: "cat" + (i + 1),
  name,
}));
const SEED_TEAM = DEFAULT_TEAM.map((name, i) => ({
  id: "t" + (i + 1),
  name,
  color: AVATAR_COLORS[name] || SWATCH[i % SWATCH.length],
}));

const secBtn = {
  padding: "4px 12px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
const delBtn = {
  padding: "4px 12px",
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#dc2626",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

export default function MastersPage() {
  const [tab, setTab] = useState("clients");
  const [clients, setClients] = useState(() =>
    loadLS("tt_clients", SEED_CLIENTS),
  );
  const [cats, setCats] = useState(() => loadLS("tt_cats", SEED_CATS));
  const [team, setTeam] = useState(() => loadLS("tt_team", SEED_TEAM));
  const [modal, setModal] = useState<ModalState | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(SWATCH[0]);
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const openAdd = () => {
    setFormName("");
    setFormColor(SWATCH[0]);
    setModal({ type: tab, item: null });
  };
  const openEdit = (item: MasterItem) => {
    setFormName(item.name);
    setFormColor(item.color || SWATCH[0]);
    setModal({ type: tab, item });
  };
  const closeModal = () => setModal(null);

  const handleSave = () => {
    const name = formName.trim();
    if (!name) return alert("Name is required");
    const { type, item } = modal!;
    const sortByName = (arr: MasterItem[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name));
    if (type === "clients") {
      const next = sortByName(item
        ? clients.map((c: MasterItem) => c.id === item.id ? { ...c, name } : c)
        : [...clients, { id: "c" + Date.now(), name }]);
      setClients(next);
      saveLS("tt_clients", next);
    } else if (type === "cats") {
      const next = sortByName(item
        ? cats.map((c: MasterItem) => (c.id === item.id ? { ...c, name } : c))
        : [...cats, { id: "c" + Date.now(), name }]);
      setCats(next);
      saveLS("tt_cats", next);
    } else {
      const next = sortByName(item
        ? team.map((t: MasterItem) => t.id === item.id ? { ...t, name, color: formColor } : t)
        : [...team, { id: "t" + Date.now(), name, color: formColor }]);
      setTeam(next);
      saveLS("tt_team", next);
    }
    closeModal();
  };

  const handleDelete = (type: string, id: string) => {
    if (!window.confirm("Delete this item?")) return;
    if (type === "clients") {
      const n = clients.filter((c: MasterItem) => c.id !== id);
      setClients(n);
      saveLS("tt_clients", n);
    } else if (type === "cats") {
      const n = cats.filter((c: MasterItem) => c.id !== id);
      setCats(n);
      saveLS("tt_cats", n);
    } else {
      const n = team.filter((t: MasterItem) => t.id !== id);
      setTeam(n);
      saveLS("tt_team", n);
    }
  };

  // ── Export all Masters data as a JSON backup file ──────────────────────────
  const handleExport = () => {
    const backup = {
      exported: new Date().toISOString(),
      clients,
      cats,
      team,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `masters-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✅ Backup downloaded!");
  };

  // ── Import / Restore from a backup JSON file ───────────────────────────────
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.clients || !data.cats || !data.team)
          return alert(
            "Invalid backup file — missing clients / cats / team fields.",
          );
        if (
          !window.confirm(
            `Restore backup from ${data.exported ? new Date(data.exported).toLocaleString() : "unknown date"}?\n\n` +
              `This will replace:\n  • Clients (${data.clients.length})\n  • Categories (${data.cats.length})\n  • Team Members (${data.team.length})\n\nContinue?`,
          )
        )
          return;
        const sortByName = (arr: MasterItem[]) =>
          [...arr].sort((a, b) => a.name.localeCompare(b.name));
        const sc = sortByName(data.clients);
        setClients(sc);
        saveLS("tt_clients", sc);
        const st = sortByName(data.cats);
        setCats(st);
        saveLS("tt_cats", st);
        const sm = sortByName(data.team);
        setTeam(sm);
        saveLS("tt_team", sm);
        showToast("✅ Backup restored successfully!");
      } catch {
        alert(
          "Failed to read backup file. Make sure it is a valid Masters backup JSON.",
        );
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be imported again
  };

  const tabs = [
    { id: "clients", label: "🏢 Clients", items: clients },
    { id: "cats", label: "🏷️ Categories", items: cats },
    { id: "team", label: "👤 Team Members", items: team },
  ];
  const currentTab = tabs.find((t) => t.id === tab);
  const boxStyle = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 800, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          ⚙️ Masters
        </div>
        {/* Global backup/restore buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleExport}
            title="Download all Masters data as a JSON backup"
            style={{
              ...secBtn,
              fontSize: 12,
              color: "#16a34a",
              borderColor: "#bbf7d0",
              background: "#f0fdf4",
            }}
          >
            ⬇ Export Backup
          </button>
          <button
            onClick={() => (importRef.current as HTMLInputElement).click()}
            title="Restore Masters data from a previously exported backup file"
            style={{
              ...secBtn,
              fontSize: 12,
              color: "#d97706",
              borderColor: "#fde68a",
              background: "#fffbeb",
            }}
          >
            ⬆ Import Backup
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* Sub-tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 14,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#1e293b" : "#64748b",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}{" "}
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              ({t.items.length})
            </span>
          </button>
        ))}
      </div>

      <div style={boxStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            {currentTab?.label}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={openAdd}
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              + Add
            </button>
          </div>
        </div>

        {currentTab?.items.length === 0 && (
          <p style={{ color: "#94a3b8", fontSize: 13 }}>
            No items yet. Click + Add.
          </p>
        )}

        <div
          style={{
            display: tab === "clients" || tab === "cats" ? "grid" : "block",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: 6,
          }}
        >
          {currentTab?.items.map((item: MasterItem) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 7,
                border: "1px solid #f1f5f9",
                background: "#fafafa",
              }}
            >
              {tab === "team" ? (
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: item.color || "#64748b",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {item.name.slice(0, 2).toUpperCase()}
                </div>
              ) : (
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#2563eb",
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                {item.name}
              </span>
              <button onClick={() => openEdit(item)} style={secBtn}>
                Edit
              </button>
              <button onClick={() => handleDelete(tab, item.id)} style={delBtn}>
                Del
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1e293b",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9999,
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,.3)",
          }}
        >
          {toast}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              minWidth: 360,
              maxWidth: 440,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {modal.item ? "Edit" : "Add"} {currentTab?.label}
              </span>
              <button
                onClick={closeModal}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Name *
              </label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter name"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "2px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
            {tab === "team" && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Colour
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SWATCH.map((c) => (
                    <div
                      key={c}
                      onClick={() => setFormColor(c)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: c,
                        cursor: "pointer",
                        border:
                          formColor === c
                            ? "3px solid #1e293b"
                            : "2px solid transparent",
                        boxSizing: "border-box",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button onClick={closeModal} style={secBtn}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                style={{
                  padding: "7px 16px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
