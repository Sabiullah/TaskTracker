export type NoticeStatus = "Open" | "Replied" | "Appealed" | "Completed";

export type NoticeForm = {
  client_name: string;
  dispute_nature: string;
  fy: string;
  notice_replied_date: string;
  next_target_date: string;
  remarks: string;
  status: string;
};

export type Notice = NoticeForm & {
  id: string;
  s_no?: number;
  created_by?: string;
  updated_at?: string;
};

export type StatusCfg = { color: string; bg: string; icon: string };

export type StatsKey =
  | "total"
  | "open"
  | "replied"
  | "appealed"
  | "completed"
  | "overdue";
