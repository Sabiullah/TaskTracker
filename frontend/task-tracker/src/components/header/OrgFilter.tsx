import { getLiveOrgs } from "@/utils/masters";

export interface OrgFilterProps {
  selectedOrg: string;
  onOrgChange: (org: string) => void;
}

export default function OrgFilter({
  selectedOrg,
  onOrgChange,
}: OrgFilterProps) {
  const orgs = getLiveOrgs();
  if (!orgs.length) return null;
  return (
    <div className="header-org-filter">
      <span className="header-org-label">Org:</span>
      <button
        onClick={() => onOrgChange("")}
        className={`org-chip${!selectedOrg ? " active" : ""}`}
      >
        All
      </button>
      {orgs.map((org: string) => (
        <button
          key={org}
          onClick={() => onOrgChange(selectedOrg === org ? "" : org)}
          className={`org-chip${selectedOrg === org ? " active" : ""}`}
        >
          {org}
        </button>
      ))}
    </div>
  );
}
