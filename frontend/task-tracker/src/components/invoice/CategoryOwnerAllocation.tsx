import { useMemo, useState } from "react";
import AttributionChips, {
  type AttributionChipOption,
  type AttributionChipValue,
} from "./AttributionChips";

export interface CategoryOwnerAllocationCategory {
  category_uid: string;
  category_name: string;
  color?: string;
  contribution_pct: number;
  owners: {
    user_uid: string;
    user_name: string;
    contribution_pct: number;
  }[];
}

export interface CategoryOwnerAllocationProps {
  /** Available categories the user can pick from. */
  categoryOptions: AttributionChipOption[];
  /** Available owners (users) the user can pick from inside each category. */
  ownerOptions: AttributionChipOption[];
  value: CategoryOwnerAllocationCategory[];
  onChange: (next: CategoryOwnerAllocationCategory[]) => void;
  onCreateCategory?: (
    name: string,
  ) => Promise<AttributionChipOption | null>;
}

/** Two-level allocation editor: an outer list of categories with %, plus
 *  a nested owner allocation under each category that must also sum to 100%
 *  (or be empty, in which case that slice is unattributed in owner-mode
 *  reports). Replaces the old "flat owners on the plan" model where owner %
 *  was independent of category %.
 */
export default function CategoryOwnerAllocation({
  categoryOptions,
  ownerOptions,
  value,
  onChange,
  onCreateCategory,
}: CategoryOwnerAllocationProps) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const totalCatPct = useMemo(
    () => value.reduce((s, v) => s + (v.contribution_pct || 0), 0),
    [value],
  );
  const catSumOk = value.length === 0 || Math.abs(totalCatPct - 100) < 0.005;

  const available = categoryOptions.filter(
    (o) =>
      !value.some((v) => v.category_uid === o.id) &&
      o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const exactMatch = categoryOptions.some(
    (o) => o.label.toLowerCase() === lower,
  );
  const showCreate =
    Boolean(onCreateCategory) && trimmed.length > 0 && !exactMatch;

  const addCategory = (opt: AttributionChipOption) => {
    const remaining = Math.max(0, 100 - totalCatPct);
    onChange([
      ...value,
      {
        category_uid: opt.id,
        category_name: opt.label,
        color: opt.color,
        contribution_pct: remaining || 0,
        owners: [],
      },
    ]);
    setSearch("");
  };

  const updateCatPct = (uid: string, pct: number) =>
    onChange(
      value.map((v) =>
        v.category_uid === uid ? { ...v, contribution_pct: pct } : v,
      ),
    );

  const removeCategory = (uid: string) =>
    onChange(value.filter((v) => v.category_uid !== uid));

  const updateOwners = (uid: string, ownersNext: AttributionChipValue[]) =>
    onChange(
      value.map((v) =>
        v.category_uid === uid
          ? {
              ...v,
              owners: ownersNext.map((o) => ({
                user_uid: o.id,
                user_name: o.label,
                contribution_pct: o.contribution_pct,
              })),
            }
          : v,
      ),
    );

  const handleCreate = async () => {
    if (!onCreateCategory || !trimmed) return;
    setCreating(true);
    try {
      const created = await onCreateCategory(trimmed);
      if (created) addCategory(created);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {value.length === 0 && (
        <div
          style={{
            fontSize: 11,
            color: "#64748b",
            marginBottom: 6,
            fontStyle: "italic",
          }}
        >
          No categories — entries will be unattributed
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {value.map((cat) => {
          const ownerChips: AttributionChipValue[] = cat.owners.map((o) => ({
            id: o.user_uid,
            label: o.user_name,
            contribution_pct: o.contribution_pct,
          }));
          return (
            <div
              key={cat.category_uid}
              style={{
                border: "1px solid #e2e8f0",
                borderLeft: `3px solid ${cat.color || "#6366f1"}`,
                borderRadius: 8,
                padding: "8px 10px",
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    background: cat.color || "#e0e7ff",
                    color: "#1e293b",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {cat.category_name}
                </span>
                <input
                  type="number"
                  value={cat.contribution_pct}
                  onChange={(e) =>
                    updateCatPct(cat.category_uid, Number(e.target.value))
                  }
                  min={0}
                  max={100}
                  style={{
                    width: 64,
                    padding: "2px 6px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 12,
                    background: "#fff",
                  }}
                />
                <span style={{ fontSize: 12, color: "#475569" }}>%</span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => removeCategory(cat.category_uid)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#64748b",
                    padding: 0,
                  }}
                  title="Remove category"
                >
                  ×
                </button>
              </div>
              <div style={{ paddingLeft: 4 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#475569",
                    marginBottom: 4,
                  }}
                >
                  Owners for {cat.category_name}
                </div>
                <AttributionChips
                  options={ownerOptions}
                  value={ownerChips}
                  onChange={(next) => updateOwners(cat.category_uid, next)}
                  emptyHint="No owners"
                  placeholder="Add an owner…"
                />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "relative", marginTop: 8 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Add a category…"
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
                onClick={() => addCategory(o)}
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
                {creating ? `Creating "${trimmed}"…` : `+ Create "${trimmed}"`}
              </div>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          marginTop: 4,
          color: catSumOk ? "#16a34a" : "#dc2626",
        }}
      >
        {value.length === 0
          ? ""
          : catSumOk
            ? `✓ Categories ${totalCatPct.toFixed(2)}%`
            : `✗ Categories ${totalCatPct.toFixed(2)}% — must equal 100%`}
      </div>
    </div>
  );
}
