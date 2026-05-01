// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import TaskDrillModal from "@/components/dashboard/TaskDrillModal";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    serialNo: 1,
    client: "Acme",
    category: "Audit",
    description: "Review Q1 ledger",
    status: "Overdue",
    targetDate: "2026-04-25",
    expectedDate: "",
    completedDate: "",
    responsible: "Akilan",
    reportingManager: "",
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
    ...overrides,
  };
}

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("TaskDrillModal — module shape", () => {
  it("is a function component", () => {
    expect(typeof TaskDrillModal).toBe("function");
  });
});
