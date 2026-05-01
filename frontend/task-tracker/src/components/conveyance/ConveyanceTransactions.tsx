import { useCallback, useEffect, useMemo, useState } from "react";

import { ws } from "@/lib/api";
import type { ConveyanceAttachment, ConveyanceEntry } from "@/types/api/conveyance";
import {
  type EntryScope,
  type ListFilters,
  approveEntry,
  deleteEntry,
  listEntries,
} from "@/utils/conveyanceApi";

import ConveyanceAttachmentList from "./ConveyanceAttachmentList";
import ConveyanceFilters from "./ConveyanceFilters";
import ConveyanceFormDialog from "./ConveyanceFormDialog";
import ConveyanceRejectDialog from "./ConveyanceRejectDialog";
import ConveyanceScopeDialog, { type ScopeAction } from "./ConveyanceScopeDialog";
import {
  formatSeriesBadge,
  groupBySeries,
  pickHeadline,
} from "./conveyanceRecurrenceHelpers";

interface Props {
  filters: ListFilters;
  onFiltersChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string; orgs: string[] }[];
  orgOptions: { uid: string; name: string }[];
  /** Header-selected org uid (empty string = "All"). */
  selectedOrg: string;
  /** UUID of the authenticated user, from profile.id */
  currentUserUid: string;
  /** True when the current user is admin in at least one org */
  currentUserIsAdminInAny: boolean;
  /** True when the current user is manager or admin in at least one org */
  currentUserCanApprove: boolean;
}

type DialogState =
  | { type: null }
  | { type: "create" }
  | { type: "edit"; entry: ConveyanceEntry }
  | { type: "reject"; entry: ConveyanceEntry };

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

function formatAmount(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return INR.format(n);
}

export default function ConveyanceTransactions({
  filters,
  onFiltersChange,
  canFilterByEmployee,
  employeeOptions,
  clientOptions,
  orgOptions,
  selectedOrg,
  currentUserUid,
  currentUserIsAdminInAny,
  currentUserCanApprove,
}: Props) {
  const [entries, setEntries] = useState<ConveyanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState>({ type: null });
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [scopeDialog, setScopeDialog] = useState<{ action: ScopeAction; entry: ConveyanceEntry } | null>(null);
  const [editScope, setEditScope] = useState<EntryScope | null>(null);

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listEntries(filters);
        if (signal.cancelled) return;
        setEntries(rows);
      } catch (err: unknown) {
        if (signal.cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load entries");
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    const unsubscribe = ws.subscribe<ConveyanceEntry>("conveyance-entries", () => {
      const reloadSignal = { cancelled: false };
      void load(reloadSignal);
    });
    return () => {
      signal.cancelled = true;
      unsubscribe();
    };
  }, [load]);

  // ---------------------------------------------------------------------------
  // Local state mutations
  // ---------------------------------------------------------------------------

  function replaceEntry(updated: ConveyanceEntry) {
    setEntries((prev) =>
      prev.map((e) => (e.uid === updated.uid ? updated : e)),
    );
  }

  function appendEntry(created: ConveyanceEntry) {
    setEntries((prev) => [created, ...prev]);
  }

  function removeEntry(uid: string) {
    setEntries((prev) => prev.filter((e) => e.uid !== uid));
  }

  function patchEntryAttachments(
    entryUid: string,
    fn: (prev: ConveyanceAttachment[]) => ConveyanceAttachment[],
  ) {
    setEntries((prev) =>
      prev.map((e) =>
        e.uid === entryUid ? { ...e, attachments: fn(e.attachments) } : e,
      ),
    );
  }

  function toggleExpand(seriesUid: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesUid)) next.delete(seriesUid);
      else next.add(seriesUid);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Row action handlers
  // ---------------------------------------------------------------------------

  async function handleApprove(row: ConveyanceEntry) {
    try {
      const updated = await approveEntry(row.uid);
      replaceEntry(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    }
  }

  async function handleDelete(row: ConveyanceEntry) {
    if (!confirm("Delete this entry?")) return;
    try {
      await deleteEntry(row.uid);
      removeEntry(row.uid);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function handleScopedDelete(row: ConveyanceEntry, scope: EntryScope) {
    const confirmMsg =
      scope === "row"
        ? "Delete this entry?"
        : scope === "series"
          ? "Delete the entire series?"
          : "Delete this entry and all later siblings?";
    if (!confirm(confirmMsg)) return;
    try {
      await deleteEntry(row.uid, scope);
      // Remove every affected row from local state. The realtime broadcast
      // will reconcile if anything else changed.
      setEntries((prev) =>
        prev.filter((e) => {
          if (scope === "series") return e.series_uid !== row.series_uid;
          if (scope === "series_forward")
            return !(e.series_uid === row.series_uid && e.date >= row.date);
          return e.uid !== row.uid;
        }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  // ---------------------------------------------------------------------------
  // Row visibility rules
  // ---------------------------------------------------------------------------

  function rowActions(row: ConveyanceEntry): { canEdit: boolean; canApprove: boolean } {
    const isOwner = row.employee_detail.uid === currentUserUid;
    const isPending = row.status === "pending";

    // Edit/Delete: owner of pending entry, OR any admin (server enforces real rules)
    const canEdit = (isPending && isOwner) || currentUserIsAdminInAny;

    // Approve/Reject: any pending entry where the caller is admin (admins
    // may self-approve); managers can approve only entries they don't own.
    // Server enforces the real per-org rules.
    const canApprove =
      isPending &&
      currentUserCanApprove &&
      (!isOwner || currentUserIsAdminInAny);

    return { canEdit, canApprove };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // ConveyanceFilters doesn't care about orgs — strip the field to match its
  // narrower prop type.
  const filterClientOptions = useMemo(
    () => clientOptions.map(({ uid, label }) => ({ uid, label })),
    [clientOptions],
  );

  function renderRow(
    row: ConveyanceEntry,
    indent: boolean,
    _isHeadline: boolean,
    badge?: { seriesUid: string; total: number; isOpen: boolean; onToggle: () => void },
  ) {
    const actions = rowActions(row);
    return (
      <tr key={row.uid} style={indent ? { background: "#f9fafb" } : undefined}>
        <td style={{ paddingLeft: indent ? 24 : undefined }}>
          {badge && (
            <button
              type="button"
              aria-label={badge.isOpen ? "Collapse series" : "Expand series"}
              onClick={badge.onToggle}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                marginRight: 4,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {badge.isOpen ? "▾" : "▸"}
            </button>
          )}
          {row.date}
        </td>
        <td>{row.employee_detail.full_name}</td>
        <td>{row.client_detail.name}</td>
        <td title={row.reason} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.reason}
          {badge && (
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
              {formatSeriesBadge(row, badge.total)}
            </div>
          )}
        </td>
        <td style={{ textAlign: "right" }}>{formatAmount(row.amount)}</td>
        <td style={{ textAlign: "center" }}>{row.claimable ? "Yes" : "No"}</td>
        <td style={{ textAlign: "center" }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 12,
              background:
                row.status === "approved"
                  ? "#d1fae5"
                  : row.status === "rejected"
                    ? "#fee2e2"
                    : "#fef3c7",
              color:
                row.status === "approved"
                  ? "#065f46"
                  : row.status === "rejected"
                    ? "#991b1b"
                    : "#92400e",
            }}
          >
            {row.status}
          </span>
        </td>
        <td style={{ textAlign: "center" }}>
          <ConveyanceAttachmentList attachments={row.attachments} />
        </td>
        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {actions.canApprove && (
              <>
                <button
                  type="button"
                  onClick={() => { void handleApprove(row); }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#d1fae5", color: "#065f46" }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setDialogState({ type: "reject", entry: row })}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#fee2e2", color: "#991b1b" }}
                >
                  Reject
                </button>
              </>
            )}
            {actions.canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (row.series_uid) setScopeDialog({ action: "edit", entry: row });
                    else setDialogState({ type: "edit", entry: row });
                  }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", background: "#f9fafb" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (row.series_uid) setScopeDialog({ action: "delete", entry: row });
                    else { void handleDelete(row); }
                  }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#fee2e2", color: "#991b1b" }}
                >
                  Delete
                </button>
              </>
            )}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Add Entry button */}
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setDialogState({ type: "create" })}
          style={{
            padding: "6px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + Add Entry
        </button>
      </div>

      <ConveyanceFilters
        value={filters}
        onChange={onFiltersChange}
        canFilterByEmployee={canFilterByEmployee}
        employeeOptions={employeeOptions}
        clientOptions={filterClientOptions}
      />

      {error && (
        <div role="alert" style={{ color: "crimson", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-gray-500">No conveyance entries match your filters.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Date</th>
              <th style={{ textAlign: "left" }}>Employee</th>
              <th style={{ textAlign: "left" }}>Client</th>
              <th style={{ textAlign: "left" }}>Reason</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Claimable</th>
              <th>Status</th>
              <th>Attachments</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const groups = groupBySeries(entries);
              const today = new Date();
              const out: React.ReactNode[] = [];
              for (const g of groups) {
                if (g.seriesUid == null) {
                  // One-time — render as a plain row with no series controls.
                  const row = g.entries[0];
                  out.push(renderRow(row, /* indent */ false, /* isHeadline */ false));
                  continue;
                }
                const headline = pickHeadline(g.entries, today);
                const isOpen = expandedSeries.has(g.seriesUid);
                out.push(renderRow(headline, false, true, {
                  seriesUid: g.seriesUid,
                  total: g.entries.length,
                  isOpen,
                  onToggle: () => toggleExpand(g.seriesUid!),
                }));
                if (isOpen) {
                  for (const sib of g.entries) {
                    if (sib.uid === headline.uid) continue;
                    out.push(renderRow(sib, true, false));
                  }
                }
              }
              return out;
            })()}
          </tbody>
        </table>
      )}

      {/* Create dialog */}
      <ConveyanceFormDialog
        open={dialogState.type === "create"}
        onClose={() => setDialogState({ type: null })}
        entry={null}
        clients={clientOptions}
        orgOptions={orgOptions}
        selectedOrg={selectedOrg}
        currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
        onSaved={(entry) => {
          appendEntry(entry);
          // Recurring create materialises N siblings on the backend, but the
          // create response only returns the headline. Trigger a refresh so
          // the rest of the series is visible immediately.
          if (entry.series_uid) {
            void load({ cancelled: false });
          }
          setDialogState({ type: null });
        }}
      />

      {/* Edit dialog */}
      {dialogState.type === "edit" && (
        <ConveyanceFormDialog
          open
          onClose={() => {
            setDialogState({ type: null });
            setEditScope(null);
          }}
          entry={dialogState.entry}
          clients={clientOptions}
          orgOptions={orgOptions}
          selectedOrg={selectedOrg}
          currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
          editScope={editScope ?? undefined}
          onSaved={(updated) => {
            replaceEntry(updated);
            setDialogState({ type: null });
            setEditScope(null);
          }}
          onDeletedAttachment={(entryUid, attachmentUid) => {
            patchEntryAttachments(entryUid, (prev) =>
              prev.filter((a) => a.uid !== attachmentUid),
            );
          }}
          onAddedAttachment={(entryUid, attachment) => {
            patchEntryAttachments(entryUid, (prev) => [...prev, attachment]);
          }}
        />
      )}

      {/* Reject dialog */}
      {dialogState.type === "reject" && (
        <ConveyanceRejectDialog
          open
          onClose={() => setDialogState({ type: null })}
          entryUid={dialogState.entry.uid}
          onRejected={(updated) => {
            replaceEntry(updated);
            setDialogState({ type: null });
          }}
        />
      )}

      <ConveyanceScopeDialog
        key={scopeDialog?.entry.uid ?? "scope-dialog"}
        open={scopeDialog !== null}
        action={scopeDialog?.action ?? "edit"}
        onCancel={() => setScopeDialog(null)}
        onConfirm={(scope) => {
          if (!scopeDialog) return;
          const entry = scopeDialog.entry;
          if (scopeDialog.action === "edit") {
            setEditScope(scope);
            setDialogState({ type: "edit", entry });
          } else {
            void handleScopedDelete(entry, scope);
          }
          setScopeDialog(null);
        }}
      />
    </div>
  );
}
