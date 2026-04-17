interface RatingBarProps {
  value: number;
  max?: number;
}

export function RatingBar({ value, max = 5 }: RatingBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  const clr = value >= 4 ? "#16a34a" : value >= 3 ? "#d97706" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "#e5e7eb",
          borderRadius: 3,
          overflow: "hidden",
          minWidth: 60,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: clr,
            borderRadius: 3,
            transition: "width .3s",
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: clr, minWidth: 20 }}>
        {value || 0}
      </span>
    </div>
  );
}
