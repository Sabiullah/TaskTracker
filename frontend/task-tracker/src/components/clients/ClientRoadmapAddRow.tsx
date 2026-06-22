import { useMemo, useState } from "react";
import { filterClientsForAdd } from "@/utils/clientFilters";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";
import type { ClientRoadmapWrite, Priority } from "@/types/api/clients";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

interface Props {
  clients: readonly MasterItem[];
  profiles: Profile[];
  /** Pre-fill the client picker (page-level selected client). "" = none. */
  defaultClientUid?: string;
  /** Persist a new roadmap item. The parent adds the owning `org`. */
  onAdd: (body: ClientRoadmapWrite) => Promise<void>;
}

const emptyDraft = (clientUid: string): ClientRoadmapWrite => ({
  client: clientUid,
  title: "",
  priority: "Medium",
});

export default function ClientRoadmapAddRow({
  clients,
  profiles,
  defaultClientUid,
  onAdd,
}: Props) {
  const [draft, setDraft] = useState<ClientRoadmapWrite>(() =>
    emptyDraft(defaultClientUid ?? ""),
  );
  const [adding, setAdding] = useState(false);

  const visibleClients = useMemo(() => filterClientsForAdd(clients), [clients]);

  const canAdd = !!draft.client && (draft.title ?? "").trim().length > 0;

  const submit = async (): Promise<void> => {
    if (!canAdd) return;
    setAdding(true);
    try {
      await onAdd({ ...draft, title: (draft.title ?? "").trim() });
      // Keep the chosen client so the user can add several rows quickly.
      setDraft(emptyDraft(draft.client));
    } finally {
      setAdding(false);
    }
  };

  return (
    <tr style={{ background: "#fafafa", borderTop: "2px solid #e2e8f0" }}>
      <td style={tdStyle}>
        <select
          aria-label="Client"
          value={draft.client}
          onChange={(e) => setDraft({ ...draft, client: e.target.value })}
          style={cellInput}
        >
          <option value="">— Select a client —</option>
          {visibleClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          placeholder="New roadmap item…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <select
          aria-label="Owner"
          value={draft.owner ?? ""}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value || null })}
          style={cellInput}
        >
          <option value="">—</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Category"
          value={draft.category ?? ""}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Description"
          value={draft.description ?? ""}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Start date"
          type="date"
          value={draft.start_date ?? ""}
          onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Target date"
          type="date"
          value={draft.target_date ?? ""}
          onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Expected date"
          type="date"
          value={draft.expected_date ?? ""}
          onChange={(e) => setDraft({ ...draft, expected_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Completion date"
          type="date"
          value={draft.completion_date ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, completion_date: e.target.value || null })
          }
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <select
          aria-label="Priority"
          value={draft.priority}
          onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
          style={cellInput}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Progress notes"
          value={draft.progress_notes ?? ""}
          onChange={(e) => setDraft({ ...draft, progress_notes: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <button
          type="button"
          onClick={submit}
          disabled={adding || !canAdd}
          style={btnSmall}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </td>
    </tr>
  );
}

const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 13,
  background: "#fff",
};
const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
