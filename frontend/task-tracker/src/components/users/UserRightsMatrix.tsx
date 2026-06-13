import { useEffect, useMemo, useState } from "react";
import {
  fetchMenuCatalog,
  fetchUserRights,
  saveUserRights,
} from "@/lib/menuRightsApi";
import type {
  MenuNodeDto,
  RightLevel,
  RightsMap,
  UserRightsResponse,
} from "@/types/menuRights";

interface Props {
  /** Org uid whose matrix to edit. */
  orgUid: string;
}

type Draft = Record<string, RightsMap>; // user_uid -> code -> level

const EMPTY: RightLevel = { view: false, edit: false };

function buildDraft(r: UserRightsResponse): Draft {
  const d: Draft = {};
  for (const u of r.users) d[u.user_uid] = { ...u.rights };
  return d;
}

function btn(disabled: boolean, color: string, bg: string) {
  return {
    padding: "7px 16px",
    borderRadius: 6,
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    color,
    background: bg,
    opacity: disabled ? 0.6 : 1,
  } as const;
}

export default function UserRightsMatrix({ orgUid }: Props) {
  const [catalog, setCatalog] = useState<MenuNodeDto[]>([]);
  const [data, setData] = useState<UserRightsResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load catalog + rights whenever the org changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [cat, rights] = await Promise.all([
        fetchMenuCatalog(),
        fetchUserRights(orgUid),
      ]);
      if (cancelled) return;
      setCatalog(cat);
      setData(rights);
      setDraft(buildDraft(rights));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgUid]);

  const dirty = useMemo(
    () =>
      data ? JSON.stringify(draft) !== JSON.stringify(buildDraft(data)) : false,
    [draft, data],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    const matches = (n: MenuNodeDto) => n.label.toLowerCase().includes(q);
    const keepParents = new Set(
      catalog.filter((n) => n.parent && matches(n)).map((n) => n.parent!),
    );
    return catalog.filter(
      (n) =>
        matches(n) ||
        keepParents.has(n.code) ||
        (n.parent !== null && keepParents.has(n.parent)),
    );
  }, [catalog, search]);

  if (loading || !data)
    return <div style={{ padding: 24 }}>Loading rights…</div>;
  const grid = data;

  const cell = (uid: string, code: string): RightLevel =>
    draft[uid]?.[code] ?? EMPTY;

  const setCell = (uid: string, code: string, next: RightLevel) => {
    // Edit implies View; clearing View clears Edit.
    const norm: RightLevel = next.edit
      ? { view: true, edit: true }
      : { view: next.view, edit: false };
    setDraft((d) => ({
      ...d,
      [uid]: { ...(d[uid] ?? {}), [code]: norm },
    }));
  };

  const toggleSubtree = (
    uid: string,
    parent: string,
    level: "view" | "edit",
  ) => {
    const subs = catalog.filter((n) => n.parent === parent).map((n) => n.code);
    const all = [parent, ...subs];
    const turnOn = !all.every((c) => cell(uid, c)[level]);
    setDraft((d) => {
      const userMap = { ...(d[uid] ?? {}) };
      for (const c of all) {
        userMap[c] =
          level === "edit"
            ? { view: turnOn, edit: turnOn }
            : {
                view: turnOn,
                edit: turnOn ? (userMap[c]?.edit ?? false) : false,
              };
      }
      return { ...d, [uid]: userMap };
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const base = buildDraft(grid);
      const changes: Draft = {};
      for (const uid of Object.keys(draft)) {
        if (JSON.stringify(draft[uid]) !== JSON.stringify(base[uid] ?? {})) {
          changes[uid] = draft[uid];
        }
      }
      const fresh = await saveUserRights(orgUid, changes);
      setData(fresh);
      setDraft(buildDraft(fresh));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <input
          type="search"
          placeholder="Search menu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 10px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13,
            width: 260,
          }}
        />
        <span style={{ marginLeft: "auto" }} />
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setDraft(buildDraft(grid))}
          style={btn(!dirty || saving, "#64748b", "#f1f5f9")}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          style={btn(!dirty || saving, "#fff", "#16a34a")}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}
        >
          <thead>
            <tr style={{ background: "#1e293b", color: "#fff" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  position: "sticky",
                  left: 0,
                  background: "#1e293b",
                }}
              >
                Menu
              </th>
              {grid.users.map((u) => (
                <th key={u.user_uid} style={{ padding: "8px 10px", minWidth: 96 }}>
                  <div>{u.full_name}</div>
                  {u.is_admin && (
                    <div style={{ fontSize: 10, opacity: 0.8 }}>admin · full</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((node) => (
              <tr key={node.code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td
                  style={{
                    padding: "6px 12px",
                    paddingLeft: node.parent ? 32 : 12,
                    position: "sticky",
                    left: 0,
                    background: "#fff",
                    fontWeight: node.parent ? 400 : 600,
                    color: node.parent ? "#475569" : "#1e293b",
                  }}
                >
                  {node.label}
                </td>
                {grid.users.map((u) => {
                  const c = cell(u.user_uid, node.code);
                  const locked = u.is_admin;
                  const isParent =
                    !node.parent &&
                    catalog.some((n) => n.parent === node.code);
                  return (
                    <td
                      key={u.user_uid}
                      style={{ textAlign: "center", padding: "4px 6px" }}
                    >
                      <label
                        style={{ marginRight: 6, opacity: locked ? 0.5 : 1 }}
                        title="View"
                      >
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={locked || c.view}
                          onChange={(e) =>
                            isParent
                              ? toggleSubtree(u.user_uid, node.code, "view")
                              : setCell(u.user_uid, node.code, {
                                  ...c,
                                  view: e.target.checked,
                                })
                          }
                        />{" "}
                        V
                      </label>
                      <label style={{ opacity: locked ? 0.5 : 1 }} title="Edit">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={locked || c.edit}
                          onChange={(e) =>
                            isParent
                              ? toggleSubtree(u.user_uid, node.code, "edit")
                              : setCell(u.user_uid, node.code, {
                                  ...c,
                                  edit: e.target.checked,
                                })
                          }
                        />{" "}
                        E
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
