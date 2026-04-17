import type { Task } from "@/types";

export interface RecentCompletionsProps {
  tasks: Task[];
}

export default function RecentCompletions({ tasks }: RecentCompletionsProps) {
  const completed = tasks
    .filter((t) => ["Ontime", "Completed Delay"].includes(t.status))
    .slice(-5)
    .reverse();
  if (!completed.length)
    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No completions yet</p>;
  return (
    <div>
      {completed.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "8px 0",
            borderBottom: "1px solid #f1f5f9",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>{t.description}</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            {t.client} · {t.completedDate || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
