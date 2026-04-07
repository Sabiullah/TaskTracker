// Matches the Django Task model fields returned by the API
export interface Task {
  id: string;
  s_no: number | null;
  client: string;
  category: string;
  description: string;
  status: string;
  target_date: string;
  expected_date: string;
  comp_date: string;
  responsible: string;
  remarks: string;
  recurrence: string;
  created_by: string | null;
  created_at: string | null;
  updated_at?: string | null;
}

// Legacy aliases kept for components that still use camelCase converters
export type DbTaskRow = Task;
export type DbTaskInsert = Omit<
  Task,
  "id" | "created_by" | "created_at" | "updated_at"
>;
