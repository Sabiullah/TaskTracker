import type { Task } from "./task";
import type { Profile } from "./auth";

export interface TaskModalProps {
  task: Task | null;
  defaultStatus?: string;
  onSave: (form: Task) => void;
  onClose: () => void;
}

export interface TaskCardProps {
  task: Task;
  statusColor: string;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  isOverlay?: boolean;
}

export interface ColumnProps {
  column: { id: string; color: string; title: string };
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (columnId: string) => void;
}

export interface AdminDashboardProps {
  tasks: Task[];
  profiles: Profile[] | null;
  onFilterEmployee: (employee: string) => void;
  activeEmployee: string;
  onClose: () => void;
}

export interface BoardProps {
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onAddTask: (status: string) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  availableMonths: string[] | null;
}

export interface CalendarPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles: Profile[];
}

// Re-export chat types so existing imports from components.ts keep working
export type {
  ChatMessage,
  ChatRoom,
  ChatRoomRow,
  ChatMemberRow,
  ChatMember,
  ChatPageProps,
} from "./chat";
