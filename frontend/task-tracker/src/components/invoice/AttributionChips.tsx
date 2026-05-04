import { useMemo, useState } from "react";

export interface AttributionChipOption {
  id: string;
  label: string;
  color?: string;
}

export interface AttributionChipValue {
  id: string;
  label: string;
  color?: string;
  contribution_pct: number;
}

export interface AttributionChipsProps {
  options: AttributionChipOption[];
  value: AttributionChipValue[];
  onChange: (next: AttributionChipValue[]) => void;
  /** Label shown when the list is empty (e.g. "No categories"). */
  emptyHint?: string;
  placeholder?: string;
  /** When provided, a "+ Create '<typed>'" option appears in the dropdown
   *  if no exact match exists. Returns the newly-created option (or null
   *  on failure) and the chip is added automatically. */
  onCreate?: (name: string) => Promise<AttributionChipOption | null>;
}

export default function AttributionChips({
  options,
  value,
  onChange,
  emptyHint = "No items",
  placeholder = "Add…",
  onCreate,
}: AttributionChipsProps) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const totalPct = useMemo(
    () => value.reduce((s, v) => s + (v.contribution_pct || 0), 0),
    [value],
  );
  const ok = value.length === 0 || Math.abs(totalPct - 100) < 0.005;

  const available = options.filter(
    (o) =>
      !value.some((v) => v.id === o.id) &&
      o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const exactMatch = options.some((o) => o.label.toLowerCase() === lower);
  const showCreate = Boolean(onCreate) && trimmed.length > 0 && !exactMatch;

  const add = (opt: AttributionChipOption) => {
    const remaining = Math.max(0, 100 - totalPct);
    onChange([
      ...value,
      {
        id: opt.id,
        label: opt.label,
        color: opt.color,
        contribution_pct: remaining || 0,
      },
    ]);
    setSearch("");
  };

  const update = (id: string, pct: number) =>
    onChange(
      value.map((v) => (v.id === id ? { ...v, contribution_pct: pct } : v)),
    );

  const remove = (id: string) => onChange(value.filter((v) => v.id !== id));

  const handleCreate = async () => {
    if (!onCreate || !trimmed) return;
    setCreating(true);
    try {
      const created = await onCreate(trimmed);
      if (created) {
        add(created);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 6,
        }}
      >
        {value.map((v) => (
          <span
            key={v.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: v.color || "#e0e7ff",
              color: "#1e293b",
              padding: "3px 6px 3px 10px",
              borderRadius: 999,
              fontSize: 12,
            }}
          >
            <b>{v.label}</b>
            <input
              type="number"
              value={v.contribution_pct}
              onChange={(e) => update(v.id, Number(e.target.value))}
              min={0}
              max={100}
              style={{
                width: 56,
                padding: "1px 4px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 12,
                background: "#fff",
              }}
            />
            <span>%</span>
            <button
              onClick={() => remove(v.id)}
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                color: "#64748b",
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative", marginBottom: 4 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "5px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        {search && (available.length > 0 || showCreate) && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              maxHeight: 160,
              overflowY: "auto",
              zIndex: 10,
              marginTop: 2,
            }}
          >
            {available.map((o) => (
              <div
                key={o.id}
                onClick={() => add(o)}
                style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12 }}
              >
                {o.label}
              </div>
            ))}
            {showCreate && (
              <div
                onClick={handleCreate}
                style={{
                  padding: "5px 10px",
                  cursor: creating ? "wait" : "pointer",
                  fontSize: 12,
                  color: "#2563eb",
                  borderTop:
                    available.length > 0 ? "1px solid #e2e8f0" : "none",
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating
                  ? `Creating "${trimmed}"…`
                  : `+ Create "${trimmed}"`}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: ok ? "#16a34a" : "#dc2626" }}>
        {value.length === 0
          ? `${emptyHint} — entries will be unattributed`
          : ok
            ? `✓ ${totalPct.toFixed(2)}%`
            : `✗ ${totalPct.toFixed(2)}% — must equal 100%`}
      </div>
    </div>
  );
}
