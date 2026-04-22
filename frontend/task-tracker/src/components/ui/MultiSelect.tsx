import React, { useEffect, useRef, useState } from "react";

export interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel?: string;
  labels?: Record<string, string>;
}

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = "All",
  labels,
}: MultiSelectProps) {
  const display = (v: string): string => labels?.[v] ?? v;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val: string): void => {
    if (selected.includes(val)) onChange(selected.filter((v) => v !== val));
    else onChange([...selected, val]);
  };
  const selectAll = (): void => onChange([...options]);
  const clearAll = (): void => onChange([]);
  const isAll = selected.length === 0;
  const displayText = isAll
    ? allLabel
    : selected.length === 1
      ? display(selected[0])
      : `${selected.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 160 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "6px 10px",
          border: `1.5px solid ${open ? "#2563eb" : "#e2e8f0"}`,
          borderRadius: 6,
          fontSize: 13,
          background: "#fff",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          color: isAll ? "#94a3b8" : "#1e293b",
          fontWeight: isAll ? 400 : 600,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 500,
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            minWidth: 200,
            maxHeight: 260,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 10px",
              borderBottom: "1px solid #f1f5f9",
              flexShrink: 0,
            }}
          >
            <button
              onClick={selectAll}
              style={{
                flex: 1,
                padding: "3px 0",
                fontSize: 11,
                fontWeight: 600,
                color: "#2563eb",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              ✓ All
            </button>
            <button
              onClick={clearAll}
              style={{
                flex: 1,
                padding: "3px 0",
                fontSize: 11,
                fontWeight: 600,
                color: "#64748b",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              ✕ Clear
            </button>
          </div>
          <div style={{ overflowY: "auto", maxHeight: 200 }}>
            {options.map((opt) => (
              <label
                key={opt}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  cursor: "pointer",
                  background: selected.includes(opt)
                    ? "#eff6ff"
                    : "transparent",
                  borderBottom: "1px solid #f8fafc",
                  fontSize: 13,
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) => {
                  e.currentTarget.style.background = selected.includes(opt)
                    ? "#dbeafe"
                    : "#f8fafc";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) => {
                  e.currentTarget.style.background = selected.includes(opt)
                    ? "#eff6ff"
                    : "transparent";
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  style={{
                    width: 14,
                    height: 14,
                    accentColor: "#2563eb",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: selected.includes(opt) ? "#1d4ed8" : "#374151",
                    fontWeight: selected.includes(opt) ? 600 : 400,
                  }}
                >
                  {display(opt)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
