import { useState, useRef, useEffect } from "react";
import type { Profile } from "@/types";

interface MultiManagerSelectProps {
  options: Profile[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export default function MultiManagerSelect({
  options,
  selected,
  onChange,
  disabled,
}: MultiManagerSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: string): void => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(next);
  };

  const label =
    selected.length === 0
      ? "— None —"
      : options
          .filter((o) => selected.includes(o.id))
          .map((o) => o.full_name || o.email)
          .join(", ");

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 160 }}>
      <div
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          padding: "5px 28px 5px 8px",
          border: "1px solid #e2e8f0",
          borderRadius: 5,
          fontSize: 12,
          cursor: disabled ? "not-allowed" : "pointer",
          background: "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 220,
          position: "relative",
          userSelect: "none",
          color: selected.length ? "#1e293b" : "#94a3b8",
          opacity: disabled ? 0.6 : 1,
        }}
        title={label}
      >
        {label}
        <span
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            fontSize: 10,
          }}
        >
          ▼
        </span>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: 0,
            zIndex: 200,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.14)",
            minWidth: 200,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {/* Clear all */}
          <div
            onClick={() => onChange([])}
            style={{
              padding: "7px 12px",
              fontSize: 12,
              color: "#dc2626",
              cursor: "pointer",
              borderBottom: "1px solid #f1f5f9",
              fontWeight: 600,
            }}
          >
            ✕ Clear all
          </div>
          {options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontSize: 12,
                  background: checked ? "#eff6ff" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.id)}
                  style={{
                    accentColor: "#2563eb",
                    width: 14,
                    height: 14,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontWeight: checked ? 600 : 400,
                    color: checked ? "#2563eb" : "#1e293b",
                  }}
                >
                  {o.full_name || o.email}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  {o.role}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
