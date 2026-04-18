import { useAuth } from "@/hooks/useAuth";

/**
 * Header org filter — shown when the signed-in user belongs to more than
 * one org. Clicking an org chip narrows the merged view to rows of that
 * org (matched by org uid); clicking "All" or the active chip again clears
 * the filter. For single-org users nothing renders.
 *
 * ``selectedOrg`` is the org's UID (or empty string for "All"). This used
 * to be the org's display name, which broke when the localStorage cache it
 * relied on was stale — switching to uid matches the row-level
 * ``task.organization`` field directly.
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
  // Single-org users don't need a filter — everything is "their" org.
  if (orgs.length < 2) return null;

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
