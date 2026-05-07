import { apiDelete, apiGet, apiPostForm } from "./client";
import type { LeadAttachmentDto } from "@/types/api/lead";

export const listLeadAttachments = (leadUid: string) =>
  apiGet<LeadAttachmentDto[]>(`/leads/${leadUid}/attachments/`);

export function uploadLeadAttachment(
  leadUid: string,
  file: File,
  label: string,
): Promise<LeadAttachmentDto> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("label", label);
  return apiPostForm<LeadAttachmentDto>(
    `/leads/${leadUid}/attachments/`,
    fd,
  );
}

export const deleteLeadAttachment = (attachmentUid: string) =>
  apiDelete(`/lead-attachments/${attachmentUid}/`);
