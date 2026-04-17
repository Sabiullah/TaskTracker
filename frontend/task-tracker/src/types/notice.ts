import type { NoticeStatusValue } from "./api";

/** Row shape used by the Notice table. */
export interface NoticeRow {
  id: string;
  serialNo: number;
  client_uid: string | null;
  client_name: string;
  dispute_nature: string;
  fy: string;
  status: NoticeStatusValue;
  remarks: string;
  received_date: string;
  replied_date: string;
  next_target_date: string;
}
