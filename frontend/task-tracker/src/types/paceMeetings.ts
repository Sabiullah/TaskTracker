import type {
  PaceActionItem,
  PaceMeetingStatusValue,
  PaceMeetingTypeValue,
} from "./api";

/** Draft shape used by the add/edit modal. Matches `PaceMeetingCreate` plus optional `id` for edit mode. */
export interface MeetingForm {
  id?: string;
  /** Org uid the meeting belongs to. Required on create when the user
   *  belongs to multiple orgs; immutable on edit. */
  org: string;
  title: string;
  meeting_type: PaceMeetingTypeValue;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  status: PaceMeetingStatusValue;
  agenda: string;
  minutes: string;
  attendees: string[];
  action_items: PaceActionItem[];
  conducted_by: string;
}
