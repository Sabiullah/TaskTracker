import type React from "react";
import { parseOrg } from "@/utils/org";

interface OrgBadgesProps {
  org: string | null | undefined;
}

export function OrgBadges({ org }: OrgBadgesProps): React.JSX.Element | null {
  const orgs = parseOrg(org);
  if (!orgs.length) return null;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
      {orgs.map((o) => (
        <span
          key={o}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: 10,
            background: "#eff6ff",
            color: "#2563eb",
            border: "1px solid #bfdbfe",
          }}
        >
          {o}
        </span>
      ))}
    </div>
  );
}
