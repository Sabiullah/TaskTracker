import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CELL_STYLE, tooltipFor, type CellPayload } from "@/utils/matrixCells";

interface Props {
  date: string;
  payload: CellPayload;
  outlined?: boolean;
  /** When true, clicking the cell opens an inline status picker. The
   *  parent receives the chosen status via ``onStatusChange``. The picker
   *  is suppressed for non-status cells (open punch '?'). */
  editable?: boolean;
  onStatusChange?: (
    status: "Present" | "Absent" | "Half Day" | "Leave" | "Holiday",
  ) => void;
}

const baseStyle: CSSProperties = {
  width: 32,
  height: 28,
  lineHeight: "28px",
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  userSelect: "none",
  boxSizing: "border-box",
};

const PICKER_OPTIONS: {
  code: "P" | "H" | "A" | "L" | "HD";
  status: "Present" | "Half Day" | "Absent" | "Leave" | "Holiday";
  label: string;
}[] = [
  { code: "P", status: "Present", label: "Present" },
  { code: "H", status: "Half Day", label: "Half Day" },
  { code: "A", status: "Absent", label: "Absent" },
  { code: "L", status: "Leave", label: "Leave" },
  { code: "HD", status: "Holiday", label: "Holiday" },
];

export default function MatrixCell({
  date,
  payload,
  outlined,
  editable,
  onStatusChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const s = CELL_STYLE[payload.code];
  const border = outlined
    ? `2px solid ${s.outline ?? s.color}`
    : s.outline
      ? `1px solid ${s.outline}`
      : "1px solid transparent";

  const canEdit = Boolean(editable && onStatusChange) && payload.code !== "?";
  const onClick = canEdit ? () => setOpen((v) => !v) : undefined;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div
        onClick={onClick}
        title={
          canEdit
            ? `${tooltipFor(date, payload)} · click to change status`
            : tooltipFor(date, payload)
        }
        style={{
          ...baseStyle,
          background: s.bg,
          color: s.color,
          border,
          cursor: canEdit ? "pointer" : "default",
        }}
      >
        {payload.code}
      </div>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            zIndex: 30,
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            boxShadow: "0 6px 18px rgba(15,23,42,0.18)",
            padding: 4,
            minWidth: 110,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {PICKER_OPTIONS.map((opt) => {
            const ostyle = CELL_STYLE[opt.code];
            const isCurrent = payload.code === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onStatusChange?.(opt.status);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "5px 8px",
                  background: isCurrent ? "#f1f5f9" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    background: ostyle.bg,
                    color: ostyle.color,
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    border: ostyle.outline
                      ? `1px solid ${ostyle.outline}`
                      : "1px solid transparent",
                    minWidth: 18,
                    textAlign: "center",
                  }}
                >
                  {opt.code}
                </span>
                <span style={{ color: "#334155" }}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
