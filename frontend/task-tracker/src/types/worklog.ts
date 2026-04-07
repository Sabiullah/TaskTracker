export interface WorkLog {
  id: string;
  name: string;
  day?: string;
  date: string;
  client?: string;
  task_description?: string;
  hours_worked?: string;
  priority?: string;
  sort_order?: number;
  created_at?: string;
  user_id?: string;
}

export interface WorkPlan {
  id: string;
  assigned_to: string;
  assigned_to_id?: string;
  created_by?: string;
  created_by_id?: string;
  day?: string;
  date: string;
  client?: string;
  task_description?: string;
  planned_hours?: string;
}

export interface NewWorkLog {
  _new: boolean;
  _id?: number;
  date: string;
  client: string;
  task_description: string;
  hours_worked: string;
  priority: string;
}

export interface NewWorkPlan {
  _id?: number;
  date: string;
  client: string;
  task_description: string;
  planned_hours: string;
  assigned_to: string;
}

export interface ManagedMember {
  id: string;
  name: string;
}

export interface DrillState {
  title: string;
  rows: WorkLog[];
}
