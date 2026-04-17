import type { Task } from "@/types";

export interface ClientDistProps {
  tasks: Task[];
  onSelectClient: (client: string) => void;
}

export default function ClientDist({ tasks, onSelectClient }: ClientDistProps) {
  const map: Record<string, number> = {};
  tasks.forEach((t) => {
    if (t.client) map[t.client] = (map[t.client] || 0) + 1;
  });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  if (!entries.length)
    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No data</p>;
  return (
    <div
      style={{
        maxHeight: 320,
        overflowY: entries.length > 8 ? "auto" : "visible",
        paddingRight: entries.length > 8 ? 4 : 0,
      }}
    >
      {entries.map(([name, cnt]) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <button
            onClick={() => onSelectClient(name)}
            style={{
              width: 130,
              fontSize: 11,
              color: "#2563eb",
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              fontWeight: 600,
              textDecoration: "underline",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </button>
          <div
            style={{
              flex: 1,
              height: 8,
              background: "#e5e7eb",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: `${Math.round((cnt / max) * 100)}%`,
                height: "100%",
                background: "#2563eb",
                borderRadius: 4,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              minWidth: 24,
              textAlign: "right",
            }}
          >
            {cnt}
          </span>
        </div>
      ))}
    </div>
  );
}
