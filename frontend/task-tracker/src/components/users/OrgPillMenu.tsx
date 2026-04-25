import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { ProfileOrg } from "@/types";

interface AccessDef {
  readonly key:
    | "invoice_access"
    | "notice_access"
    | "masters_access"
    | "attendance_access"
    | "employee_access"
    | "leads_access";
  readonly label: string;
}

const ACCESS_DEFS: readonly AccessDef[] = [
  { key: "invoice_access", label: "Invoice" },
  { key: "notice_access", label: "Notice" },
  { key: "masters_access", label: "Masters" },
  { key: "attendance_access", label: "Attendance" },
  { key: "employee_access", label: "Employees" },
  { key: "leads_access", label: "Leads" },
];

const ROLES = ["admin", "manager", "employee"] as const;

export interface OrgPillMenuProps {
  org: ProfileOrg;
  /** ``true`` when this is the user's only membership — disables "Remove". */
  isOnlyOrg: boolean;
  onSetRole: (orgUid: string, role: string) => void;
  onToggleAccess: (
    orgUid: string,
    key: AccessDef["key"],
    enabled: boolean,
  ) => void;
  onSetDefault: (orgUid: string) => void;
  onRemove: (orgUid: string, orgName: string) => void;
}

/** Clickable org pill with a popover for per-org role/access editing. */
export default function OrgPillMenu({
  org,
  isOnlyOrg,
  onSetRole,
  onToggleAccess,
  onSetDefault,
  onRemove,
}: OrgPillMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the pill's viewport-relative position so the portal-rendered
  // popover can pin itself below (or above, near the bottom of the screen)
  // without being subject to any table ``overflow: auto`` clipping.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const menuW = 260;
      // Flip to above when near the bottom edge so the popover never runs
      // off-screen.
      const openUp = window.innerHeight - r.bottom < 280;
      const top = openUp ? r.top - 8 : r.bottom + 4;
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - menuW - 8),
      );
      setPos({ top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: org.is_default ? "#dbeafe" : "#f1f5f9",
    color: org.is_default ? "#1d4ed8" : "#475569",
    border: org.is_default ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
    cursor: "pointer",
    userSelect: "none",
  };

  const popover = open && pos && (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 12,
        boxShadow: "0 10px 32px rgba(0,0,0,.14)",
        zIndex: 10000,
        minWidth: 240,
        maxWidth: 260,
        fontSize: 12,
      }}
    >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>
              {org.name}
            </div>
            {org.is_default && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#1d4ed8",
                  background: "#dbeafe",
                  padding: "1px 7px",
                  borderRadius: 999,
                }}
              >
                ★ default
              </span>
            )}
          </div>

          {/* Role */}
          <label
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 700,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 3,
            }}
          >
            Role
          </label>
          <select
            value={org.role}
            onChange={(e) => onSetRole(org.uid, e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 12,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>

          {/* Access */}
          {org.role !== "admin" ? (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                Access
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginBottom: 12,
                }}
              >
                {ACCESS_DEFS.map((a) => (
                  <label
                    key={a.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      cursor: "pointer",
                      padding: "2px 0",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={org[a.key]}
                      onChange={(e) =>
                        onToggleAccess(org.uid, a.key, e.target.checked)
                      }
                      style={{ cursor: "pointer" }}
                    />
                    <span style={{ color: "#475569" }}>{a.label}</span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                background: "#f8fafc",
                padding: "6px 10px",
                borderRadius: 6,
                marginBottom: 12,
              }}
            >
              Admins have full access — no toggles needed.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 6 }}>
            {!org.is_default && (
              <button
                type="button"
                onClick={() => {
                  onSetDefault(org.uid);
                  setOpen(false);
                }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ★ Set as default
              </button>
            )}
            <button
              type="button"
              disabled={isOnlyOrg}
              onClick={() => {
                onRemove(org.uid, org.name);
                setOpen(false);
              }}
              title={
                isOnlyOrg
                  ? "Cannot remove — this is the user's only org"
                  : `Remove from ${org.name}`
              }
              style={{
                flex: 1,
                padding: "6px 10px",
                border: "1px solid #fecaca",
                background: isOnlyOrg ? "#f8fafc" : "#fff1f2",
                color: isOnlyOrg ? "#cbd5e1" : "#dc2626",
                borderRadius: 6,
                cursor: isOnlyOrg ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              🗑 Remove
            </button>
          </div>
    </div>
  );

  return (
    <span ref={rootRef} style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${org.role}${org.is_default ? " • default" : ""} — click to edit`}
        style={{ ...pillStyle, border: "1px solid transparent", padding: 0 }}
      >
        <span style={pillStyle}>
          {org.is_default && <span style={{ fontSize: 9 }}>★</span>}
          {org.name}
          <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
        </span>
      </button>
      {popover && createPortal(popover, document.body)}
    </span>
  );
}
