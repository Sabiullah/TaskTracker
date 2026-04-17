import type { CSSProperties } from "react";

// Dense table styles used across attendance, invoice, notice, growth-plan and
// pace-goals tables. Forms with taller inputs (employee, holidays) keep their
// own bigger-padding variants locally.

export const thS: CSSProperties = {
  padding: "7px 10px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};

export const tdS: CSSProperties = {
  padding: "7px 10px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};

export const inpS: CSSProperties = {
  padding: "5px 7px",
  border: "1.5px solid #cbd5e1",
  borderRadius: 5,
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};

export const lblS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: ".5px",
};
