import type { ReactNode } from "react";
import type { Task } from "./task";
import type { Profile } from "./auth";

export type DashboardTask = Task;
export type DashboardProfile = Profile;

export type DrillDownState =
  | { type: "member"; value: string }
  | { type: "status"; value: string }
  | { type: "client"; value: string }
  | { type: "today" }
  | { type: "active" }
  | { type: "report" };

export interface TaskDetailTableProps {
  tasks: Task[];
  title: string | ReactNode;
  onBack?: () => void;
  filename?: string;
}

export interface StatusDistProps {
  tasks: Task[];
  onSelectStatus: (status: string) => void;
}

export interface ClientDistProps {
  tasks: Task[];
  onSelectClient: (client: string) => void;
}

export interface TaskDrillModalProps {
  title: string;
  tasks: Task[];
  onClose: () => void;
  onTaskUpdated?: () => void;
}

export interface TeamTableProps {
  tasks: Task[];
  teamNames: string[];
  onSelectMember: (name: string) => void;
  onTaskUpdated?: () => void;
}

export interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel?: string;
}

export interface ReportViewProps {
  tasks: Task[];
  onBack: () => void;
}

export interface RecentCompletionsProps {
  tasks: Task[];
}

export interface DashboardPageProps {
  tasks: Task[];
  profile?: Profile;
  profiles?: Profile[];
}
