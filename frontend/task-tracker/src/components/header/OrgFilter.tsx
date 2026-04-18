import { useAuth } from "@/hooks/useAuth";

/**
 * Header org filter. Single-org users see their org name as a read-only
 * badge (no chips to click, since there's nothing to toggle). Multi-org
 * users get ``All / OrgA / OrgB`` chips and can narrow the merged view by
 * clicking one.
 *
 * ``selectedOrg`` is the org's UID (empty string = "All").
 */
export interface OrgFilterProps {
  /** UID of the selected org, or empty string for "All". */
  selectedOrg: string;
  onOrgChange: (orgUid: string) => void;
}

export default function OrgFilter({
  selectedOrg,
  onOrgChange,
}: OrgFilterProps) {
  const { orgs } = useAuth();
  if (orgs.length === 0) return null;

  if (orgs.length === 1) {
    return (
      <div className="header-org-filter">
        <span className="header-org-label">Org:</span>
        <span className="org-chip active" style={{ cursor: "default" }}>
          {orgs[0].name}
        </span>
      </div>
    );
  }

  return (
    <div className="header-org-filter">
      <span className="header-org-label">Org:</span>
      <button
        onClick={() => onOrgChange("")}
        className={`org-chip${!selectedOrg ? " active" : ""}`}
      >
        All
      </button>
      {orgs.map((org) => {
        const active = selectedOrg === org.uid;
        return (
          <button
            key={org.uid}
            onClick={() => onOrgChange(active ? "" : org.uid)}
            className={`org-chip${active ? " active" : ""}`}
          >
            {org.name}
          </button>
        );
      })}
    </div>
  );
}
