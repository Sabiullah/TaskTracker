import type { CSSProperties } from "react";
import type { CalendarLayers } from "@/utils/calendarLayers";

interface CalendarToolbarProps {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;

  layers: CalendarLayers;
  onLayersChange: (v: CalendarLayers) => void;

  subtasksOnly: boolean;
  onSubtasksOnlyChange: (v: boolean) => void;

  clientOptions: string[];
  memberOptions: string[];
  mainCategoryOptions: string[];
  fClient: string;
  fMember: string;
  fMainCategory: string;
  onClientChange: (v: string) => void;
  onMemberChange: (v: string) => void;
  onMainCategoryChange: (v: string) => void;
  onClear: () => void;
}

const navBtn: CSSProperties = {
  padding: "6px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#f8fafc",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const selectStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  color: "#475569",
  background: "#fff",
  cursor: "pointer",
  width: 150,
};

const LAYERS: Array<{ v: CalendarLayers; label: string }> = [
  { v: "both", label: "Both" },
  { v: "tasks", label: "Tasks" },
  { v: "plans", label: "Plans" },
];

export default function CalendarToolbar(props: CalendarToolbarProps) {
  const {
    monthLabel,
    onPrev,
    onNext,
    onToday,
    layers,
    onLayersChange,
    subtasksOnly,
    onSubtasksOnlyChange,
    clientOptions,
    memberOptions,
    mainCategoryOptions,
    fClient,
    fMember,
    fMainCategory,
    onClientChange,
    onMemberChange,
    onMainCategoryChange,
    onClear,
  } = props;

  const filterActive = !!(fClient || fMember || fMainCategory);

  return (
    <div
      className="cal-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      {/* Desktop month nav — mobile uses the compact single-line bar the
          page renders above the week strip (display:contents keeps the
          desktop flex layout identical). */}
      <div className="cal-nav-group">
        <button onClick={onPrev} style={navBtn}>
          ‹ Prev
        </button>
        <span
          className="page-title"
          style={{ fontSize: 20, minWidth: 180, textAlign: "center" }}
        >
          {monthLabel}
        </span>
        <button onClick={onNext} style={navBtn}>
          Next ›
        </button>
        <button onClick={onToday} style={{ ...navBtn, fontSize: 12 }}>
          Today
        </button>
      </div>

      {/* Layer toggle — radio-style group, not a tablist (no arrow-key nav). */}
      <div
        role="group"
        aria-label="Calendar layers"
        style={{
          display: "flex",
          border: "1.5px solid #e2e8f0",
          borderRadius: 6,
          overflow: "hidden",
          marginLeft: 6,
        }}
      >
        {LAYERS.map(({ v, label }) => {
          const active = layers === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onLayersChange(v)}
              style={{
                padding: "5px 12px",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                background: active ? "#2563eb" : "#fff",
                color: active ? "#fff" : "#475569",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Subtasks-only filter — orthogonal to the layer toggle. */}
      <button
        type="button"
        aria-pressed={subtasksOnly}
        aria-label="Show subtasks only"
        disabled={layers === "plans"}
        onClick={() => onSubtasksOnlyChange(!subtasksOnly)}
        style={{
          padding: "5px 12px",
          border: `1.5px solid ${subtasksOnly ? "#d97706" : "#cbd5e1"}`,
          borderRadius: 6,
          background: subtasksOnly ? "#f59e0b" : "#fff",
          color: subtasksOnly ? "#fff" : "#475569",
          fontSize: 12,
          fontWeight: 700,
          cursor: layers === "plans" ? "not-allowed" : "pointer",
          opacity: layers === "plans" ? 0.45 : 1,
        }}
      >
        Subtasks only
      </button>

      <select
        value={fClient}
        onChange={(e) => onClientChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by client"
      >
        <option value="">All Clients</option>
        {clientOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMainCategory}
        onChange={(e) => onMainCategoryChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by main category"
      >
        <option value="">All Main Categories</option>
        {mainCategoryOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMember}
        onChange={(e) => onMemberChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by member"
      >
        <option value="">All Members</option>
        {memberOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {filterActive && (
        <button
          onClick={onClear}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid #fca5a5",
            background: "#fee2e2",
            color: "#dc2626",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}
