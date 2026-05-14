import TaskFormFields from "./TaskFormFields";
import type { OrgOption } from "./TaskFormFields";
import type { MasterEntry } from "@/utils/masters";

interface FormState {
  client: string;
  category: string;
  description: string;
  status: string;
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  responsible: string;
  reportingManager: string;
  remarks: string;
  recurrence: string;
  organization: string;
}

interface Props {
  form: FormState;
  orgs: readonly OrgOption[];
  filteredClients: { name: string; inactive: boolean }[];
  categories: string[];
  members: string[];
  clientObjects: MasterEntry[];
  set: (k: string, v: unknown) => void;
  onOrgChange: (orgUid: string) => void;
  onClientChange: (client: string) => void;
  isCreate?: boolean;
}

export default function MainGoalFields(props: Props) {
  // Wrapping rather than duplicating keeps a single source of layout for
  // the Main panel; if we later want Main-only field tweaks (e.g., hide
  // Completed Date when subs exist), do it here without forking.
  return <TaskFormFields {...props} />;
}
