import { describe, expect, it } from "vitest";
import { BLANK_NOTICE_ROW, dtoToNoticeRow } from "@/utils/notice";
import type { NoticeDto } from "@/types/api";

const baseDto: NoticeDto = {
  id: 10,
  uid: "not-1",
  serial_no: 7,
  client: "cli-1",
  client_detail: {
    id: 1,
    uid: "cli-1",
    name: "Acme Ltd",
    type: "client",
    color: "#2563eb",
  },
  dispute_nature: "GST audit",
  fy: "2024-25",
  status: "Open",
  remarks: "Awaiting response",
  received_date: "2025-03-01",
  replied_date: null,
  next_target_date: "2025-04-10",
  created_by_detail: null,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-05T00:00:00Z",
};

describe("dtoToNoticeRow", () => {
  it("maps every field from DTO to row shape", () => {
    const row = dtoToNoticeRow(baseDto);
    expect(row.id).toBe("not-1");
    expect(row.serialNo).toBe(7);
    expect(row.client_uid).toBe("cli-1");
    expect(row.client_name).toBe("Acme Ltd");
    expect(row.dispute_nature).toBe("GST audit");
    expect(row.fy).toBe("2024-25");
    expect(row.status).toBe("Open");
    expect(row.remarks).toBe("Awaiting response");
    expect(row.received_date).toBe("2025-03-01");
    expect(row.replied_date).toBe("");
    expect(row.next_target_date).toBe("2025-04-10");
  });

  it("uses empty strings when optional date fields are null", () => {
    const dto: NoticeDto = {
      ...baseDto,
      received_date: null,
      replied_date: null,
      next_target_date: null,
    };
    const row = dtoToNoticeRow(dto);
    expect(row.received_date).toBe("");
    expect(row.replied_date).toBe("");
    expect(row.next_target_date).toBe("");
  });

  it("uses empty client_name when client_detail is absent", () => {
    const dto: NoticeDto = {
      ...baseDto,
      client: null,
      client_detail: null,
    };
    const row = dtoToNoticeRow(dto);
    expect(row.client_uid).toBeNull();
    expect(row.client_name).toBe("");
  });
});

describe("BLANK_NOTICE_ROW", () => {
  it("is a safe default for the add-row form", () => {
    expect(BLANK_NOTICE_ROW.id).toBe("");
    expect(BLANK_NOTICE_ROW.serialNo).toBe(0);
    expect(BLANK_NOTICE_ROW.status).toBe("Open");
    expect(BLANK_NOTICE_ROW.client_uid).toBeNull();
  });
});
