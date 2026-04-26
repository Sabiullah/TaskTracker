import { useState, type CSSProperties } from "react";
import { CELL_LABEL, CELL_STYLE, type CellCode } from "@/utils/matrixCells";

const ORDER: CellCode[] = [
  "P", "H", "A", "L", "L½", "L½+H", "WFH", "WP", "HW", "?", "HD",
];

const wrap: CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  marginBottom: 10,
};

const toggleBtn: CSSProperties = {
  background: "none",
  border: "none",
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  color: "#1e293b",
};

const grid: CSSProperties = {
  padding: "0 12px 10px",
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const item: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
};

export default function MatrixLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={wrap}>
      <button onClick={() => setOpen((v) => !v)} style={toggleBtn}>
        {open ? "▾" : "▸"} Legend
      </button>
      {open && (
        <div style={grid}>
          {ORDER.map((code) => {
            const s = CELL_STYLE[code];
            return (
              <div key={code} style={item}>
                <span
                  style={{
                    background: s.bg,
                    color: s.color,
                    border: s.outline ? `1px solid ${s.outline}` : "1px solid transparent",
                    width: 32,
                    height: 22,
                    lineHeight: "22px",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 11,
                    borderRadius: 3,
                    display: "inline-block",
                  }}
                >
                  {code}
                </span>
                <span style={{ color: "#475569" }}>{CELL_LABEL[code]}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
