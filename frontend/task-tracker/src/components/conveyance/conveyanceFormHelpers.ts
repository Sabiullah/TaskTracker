/**
 * Pure helper functions for ConveyanceFormDialog.
 *
 * Kept in a separate file so the dialog component file exports only the
 * component (required by react-refresh/only-export-components).
 */

import type { ConveyanceFrequency } from "@/types/api/conveyance";

export interface FileRow {
  file: File;
  label: string;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export function validateFormInputs(input: {
  reason: string;
  amount: string;
  client: string;
  org: string;
  files: { file: File }[];
  frequency?: ConveyanceFrequency;
  start_month?: string;  // YYYY-MM
  end_month?: string;    // YYYY-MM
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.reason.trim().length < 3) errors.push("Reason must be at least 3 characters.");
  const amt = Number(input.amount);
  if (Number.isNaN(amt) || amt <= 0) errors.push("Amount must be greater than 0.");
  if (!input.client) errors.push("Client is required.");
  if (!input.org) errors.push("Organisation is required.");
  for (const { file } of input.files) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`File "${file.name}" exceeds 20 MB limit.`);
    }
  }

  const frequency = input.frequency ?? "one_time";
  if (frequency !== "one_time") {
    if (!input.start_month) errors.push("Start month is required for recurring entries.");
    if (!input.end_month) errors.push("End month is required for recurring entries.");
    if (input.start_month && input.end_month && input.end_month < input.start_month) {
      errors.push("End month must be on or after start month.");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildCreateFormData(input: {
  date: string;
  client: string;
  reason: string;
  amount: string;
  claimable: boolean;
  org?: string;
  files: FileRow[];
  frequency?: ConveyanceFrequency;
  start_month?: string;  // YYYY-MM
  end_month?: string;    // YYYY-MM
}): FormData {
  const form = new FormData();
  form.append("date", input.date);
  form.append("client", input.client);
  form.append("reason", input.reason.trim());
  form.append("amount", input.amount);
  form.append("claimable", input.claimable ? "true" : "false");
  if (input.org) form.append("org", input.org);
  const frequency = input.frequency ?? "one_time";
  form.append("frequency", frequency);
  if (frequency !== "one_time") {
    if (input.start_month) form.append("start_month", `${input.start_month}-01`);
    if (input.end_month) form.append("end_month", `${input.end_month}-01`);
  }
  for (const { file, label } of input.files) {
    form.append("attachments", file);
    form.append("attachment_labels", label);
  }
  return form;
}
