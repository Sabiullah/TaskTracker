// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LeadAttachmentsModal from "@/components/leads/LeadAttachmentsModal";
import type { Lead } from "@/types";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  listLeadAttachments: vi.fn(async () => []),
  uploadLeadAttachment: vi.fn(),
  deleteLeadAttachment: vi.fn(),
  openAuthenticatedFile: vi.fn(),
}));

import {
  listLeadAttachments,
  uploadLeadAttachment,
} from "@/lib/api";

const baseLead: Lead = {
  id: "lead-1",
  serialNo: 1,
  client: "Acme",
  contact_person: null,
  contact_email: null,
  contact_phone: null,
  lead_source: null,
  reference_from: null,
  status: "Cold",
  priority: "Medium",
  assigned_to: null,
  estimated_value: null,
  action_taken: null,
  next_step: null,
  next_step_date: null,
  remarks: null,
  attachments: [],
  created_by: null,
  created_at: null,
  updated_at: null,
};

function makeFile(name: string, content = "x") {
  return new File([content], name, { type: "text/plain" });
}

describe("LeadAttachmentsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listLeadAttachments as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
  });
  afterEach(() => {
    cleanup();
  });

  it("defaults the display name to the filename without extension", async () => {
    render(
      <LeadAttachmentsModal lead={baseLead} canMutate onClose={() => {}} />,
    );
    const input = screen.getByText(/Add files/i)
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("Quote.pdf")] } });
    const labelInput = await screen.findByPlaceholderText(/Display name/i);
    expect((labelInput as HTMLInputElement).value).toBe("Quote");
  });

  it("disables the upload button when any queued file has a blank label", async () => {
    render(
      <LeadAttachmentsModal lead={baseLead} canMutate onClose={() => {}} />,
    );
    const input = screen.getByText(/Add files/i)
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile("a.txt"), makeFile("b.txt")] },
    });

    const labelInputs = await screen.findAllByPlaceholderText(/Display name/i);
    expect(labelInputs.length).toBe(2);

    // Initially all labels default to non-empty (filename minus ext) → enabled.
    const button = screen.getByRole("button", { name: /Upload 2 files/i });
    expect(button.hasAttribute("disabled")).toBe(false);

    // Blank one of them — button should disable.
    fireEvent.change(labelInputs[0], { target: { value: "   " } });
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    // Fill it back in — button re-enables.
    fireEvent.change(labelInputs[0], { target: { value: "First" } });
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  it("uploads each queued file with its trimmed label", async () => {
    const upload = uploadLeadAttachment as unknown as ReturnType<typeof vi.fn>;
    upload.mockResolvedValue({
      id: 1,
      uid: "att-1",
      label: "x",
      filename: "a.txt",
      file_url: "/media/leads/a.txt",
      download_url: "/api/lead-attachments/att-1/download/",
      size_bytes: 1,
      uploaded_at: "2026-05-07T00:00:00Z",
      uploaded_by_detail: null,
    });

    render(
      <LeadAttachmentsModal lead={baseLead} canMutate onClose={() => {}} />,
    );
    const input = screen.getByText(/Add files/i)
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("a.txt")] } });
    const labelInput = await screen.findByPlaceholderText(/Display name/i);
    fireEvent.change(labelInput, { target: { value: "  Doc 1  " } });

    fireEvent.click(screen.getByRole("button", { name: /Upload 1 file/i }));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    expect(upload.mock.calls[0][0]).toBe("lead-1");
    expect((upload.mock.calls[0][1] as File).name).toBe("a.txt");
    expect(upload.mock.calls[0][2]).toBe("Doc 1");
  });

  it("hides the upload section when canMutate is false", () => {
    render(
      <LeadAttachmentsModal
        lead={baseLead}
        canMutate={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Add files/i)).toBeNull();
  });
});
