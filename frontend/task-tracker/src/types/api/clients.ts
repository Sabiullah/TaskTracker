import type { MasterDto } from "./master";

export interface UserMinDto {
  readonly id: number;
  readonly uid: string;
  readonly full_name: string;
  readonly username: string;
  readonly avatar_color?: string;
}

export type RoadmapStatus =
  | "Not Started"
  | "In Progress"
  | "Achieved"
  | "At Risk"
  | "Cancelled";

export type Priority = "High" | "Medium" | "Low";

export type MeetingType = "Review" | "Kickoff" | "Escalation" | "Strategic" | "Ad-hoc";
export type MeetingMode = "In-person" | "Video" | "Phone";

export type ActionPointStatus =
  | "Open"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export interface ClientAttendee {
  readonly name: string;
  readonly designation?: string;
  readonly email?: string;
}

export interface ClientRoadmapDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly title: string;
  readonly description: string;
  readonly owner: string | null;
  readonly owner_detail: UserMinDto | null;
  readonly target_date: string | null;
  readonly completion_date: string | null;
  readonly status: RoadmapStatus;
  readonly priority: Priority;
  readonly progress_notes: string;
  readonly category: string;
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientRoadmapWrite {
  readonly client: string;
  readonly title: string;
  readonly description?: string;
  readonly owner?: string | null;
  readonly target_date?: string | null;
  readonly completion_date?: string | null;
  readonly status?: RoadmapStatus;
  readonly priority?: Priority;
  readonly progress_notes?: string;
  readonly category?: string;
  readonly org?: string;
}

export interface ClientActionPointDto {
  readonly id: number;
  readonly uid: string;
  readonly meeting: number;
  readonly description: string;
  readonly responsibility: string | null;
  readonly responsibility_detail: UserMinDto | null;
  readonly target_date: string | null;
  readonly completion_date: string | null;
  readonly status: ActionPointStatus;
  readonly priority: Priority;
  readonly remarks: string;
  readonly roadmap_link: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientActionPointWrite {
  readonly description: string;
  readonly responsibility?: string | null;
  readonly target_date?: string | null;
  readonly completion_date?: string | null;
  readonly status?: ActionPointStatus;
  readonly priority?: Priority;
  readonly remarks?: string;
  readonly roadmap_link?: string | null;
}

export interface ClientMeetingAttachmentDto {
  readonly id: number;
  readonly uid: string;
  readonly meeting: number;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_by_detail: UserMinDto | null;
  readonly uploaded_at: string;
  readonly download_url: string;
}

export interface ClientMeetingDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly meeting_date: string;
  readonly meeting_time: string | null;
  readonly meeting_type: MeetingType;
  readonly mode: MeetingMode;
  readonly venue: string;
  readonly conducted_by: string | null;
  readonly conducted_by_detail: UserMinDto | null;
  readonly our_attendees: readonly string[];
  readonly our_attendees_detail: readonly UserMinDto[];
  readonly client_attendees: readonly ClientAttendee[];
  readonly agenda: string;
  readonly minutes: string;
  readonly next_meeting_date: string | null;
  readonly action_points: readonly ClientActionPointDto[];
  readonly attachments: readonly ClientMeetingAttachmentDto[];
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientMeetingWrite {
  readonly client: string;
  readonly meeting_date: string;
  readonly meeting_time?: string | null;
  readonly meeting_type?: MeetingType;
  readonly mode?: MeetingMode;
  readonly venue?: string;
  readonly conducted_by?: string | null;
  readonly our_attendees?: readonly string[];
  readonly client_attendees?: readonly ClientAttendee[];
  readonly agenda?: string;
  readonly minutes?: string;
  readonly next_meeting_date?: string | null;
  readonly org?: string;
}
