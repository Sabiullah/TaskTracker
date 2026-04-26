import type { CSSProperties } from "react";
import { CELL_STYLE, tooltipFor, type CellPayload } from "@/utils/matrixCells";

interface Props {
  date: string;
  payload: CellPayload;
  outlined?: boolean;
  onClick?: () => void;
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

export default function MatrixCell({ date, payload, outlined, onClick }: Props) {
  const s = CELL_STYLE[payload.code];
  const border = outlined
    ? `2px solid ${s.outline ?? s.color}`
    : s.outline
      ? `1px solid ${s.outline}`
      : "1px solid transparent";
  return (
    <div
      onClick={onClick}
      title={tooltipFor(date, payload)}
      style={{
        ...baseStyle,
        background: s.bg,
        color: s.color,
        border,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {payload.code}
    </div>
  );
}
