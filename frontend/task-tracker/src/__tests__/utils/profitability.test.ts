import { describe, it, expect } from "vitest";
import { computeProfitability, computeProfitabilityGrandTotal } from "@/utils/profitability";
import type { CostingEntryDto } from "@/types/api/costing";
import type { Employee, SalaryRecord } from "@/types";
import type { EmployeeSeatCostDto, SeatCostSettingDto } from "@/types/api/seatCost";

function makeCostingEntry(overrides: Partial<CostingEntryDto>): CostingEntryDto {
  return {
    id: 1,
    uid: "c1",
    org: "o1",
    org_name: "Org",
    client: "cl1",
    client_detail: null,
    designation: "d1",
    designation_detail: null,
    employee: null,
    employee_detail: null,
    hr_day: "0",
    days_working: "0",
    total: "0",
    created_by_uid: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: "emp1",
    org: "o1",
    employee_name: "Priya",
    father_name: null,
    phone: null,
    alt_phone: null,
    email: null,
    designation: null,
    designation_uid: null,
    designation_name: null,
    department: null,
    status: "Active",
    gender: null,
    marital_status: null,
    date_of_birth: null,
    blood_group: null,
    permanent_address: null,
    current_address: null,
    address_proof_url: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    reference_name: null,
    reference_contact: null,
    date_of_joining: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as Employee;
}

function makeSalary(overrides: Partial<SalaryRecord>): SalaryRecord {
  return {
    id: "s1",
    employee_id: "emp1",
    employee_name: "Priya",
    designation: null,
    department: null,
    date_of_joining: null,
    fixed_salary: 30000,
    basic_salary: null,
    hra: null,
    da: null,
    other_allowances: null,
    pf_number: null,
    effective_from: "2026-01-01",
    updated_at: null,
    created_at: null,
    ...overrides,
  } as SalaryRecord;
}

function makeSeatCostSetting(overrides: Partial<SeatCostSettingDto>): SeatCostSettingDto {
  return {
    id: 1,
    uid: "s1",
    org: "o1",
    org_name: "Org",
    monthly_amount: "5000",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as SeatCostSettingDto;
}

describe("computeProfitability", () => {
  it("sums client value across multiple costing entries for the same employee", () => {
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", total: "20000" }),
        makeCostingEntry({ uid: "c2", employee: "emp1", total: "15000" }),
      ],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].clientValue).toBe(35000);
    expect(rows[0].salary).toBe(30000);
    expect(rows[0].seatCost).toBe(0);
    expect(rows[0].cost).toBe(30000);
  });

  it("uses the org default seat cost when no override exists", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [makeSeatCostSetting({ org: "o1", monthly_amount: "5000" })],
      [],
    );
    expect(rows[0].seatCost).toBe(5000);
    expect(rows[0].cost).toBe(35000);
  });

  it("prefers a per-employee seat cost override over the org default", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [makeSeatCostSetting({ org: "o1", monthly_amount: "5000" })],
      [
        {
          id: 1,
          uid: "e1",
          employee: "emp1",
          employee_detail: null,
          monthly_amount: "8000",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        } as EmployeeSeatCostDto,
      ],
    );
    expect(rows[0].seatCost).toBe(8000);
  });

  it("flags an employee with no salary record rather than treating them as free", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [],
      [],
      [],
    );
    expect(rows[0].hasSalary).toBe(false);
    expect(rows[0].salary).toBe(0);
    // cost === 0 (no salary, no seat cost) but clientValue > 0 -> Profitable,
    // exercising the cost === 0 branch of statusFor().
    expect(rows[0].status).toBe("Profitable");
  });

  it("marks Break-even when cost is 0 and client value is also 0 (zero-amount seat cost override, no salary, no costing entries)", () => {
    // The only way to get a row with cost === 0 && clientValue === 0 is via
    // an explicit seat-cost override of amount 0 (which still counts as
    // "configured" for inclusion purposes) combined with no salary record
    // and no Costing entries at all.
    const rows = computeProfitability(
      [],
      [makeEmployee({})],
      [],
      [],
      [
        {
          id: 1,
          uid: "e1",
          employee: "emp1",
          employee_detail: null,
          monthly_amount: "0",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        } as EmployeeSeatCostDto,
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(0);
    expect(rows[0].clientValue).toBe(0);
    expect(rows[0].status).toBe("Break-even");
  });

  it("excludes an employee whose only costing entry sums to zero and has no seat cost override", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "0" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows).toHaveLength(0);
  });

  it("excludes an employee whose costing entries net to zero across multiple rows", () => {
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", total: "5000" }),
        makeCostingEntry({ uid: "c2", employee: "emp1", total: "-5000" }),
      ],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows).toHaveLength(0);
  });

  it("picks the most recent salary record by effective_from", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [
        makeSalary({ id: "s1", fixed_salary: 25000, effective_from: "2025-01-01" }),
        makeSalary({ id: "s2", fixed_salary: 32000, effective_from: "2026-01-01" }),
      ],
      [],
      [],
    );
    expect(rows[0].salary).toBe(32000);
  });

  it("marks Profitable when client value exceeds cost by more than 5%", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows[0].status).toBe("Profitable");
  });

  it("marks Loss when client value is more than 5% below cost", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "20000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows[0].status).toBe("Loss");
  });

  it("marks Break-even when client value is within 5% of cost", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "31000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      [],
      [],
    );
    expect(rows[0].status).toBe("Break-even");
  });

  it("excludes employees with no costing entries and no seat cost override", () => {
    const rows = computeProfitability([], [makeEmployee({})], [makeSalary({})], [], []);
    expect(rows).toHaveLength(0);
  });

  it("resolves each employee's org default seat cost against their OWN org, not another org's setting", () => {
    // Two employees in two different orgs, each org has its own seat cost
    // default, neither employee has a per-employee override. A multi-org
    // admin sees both settings at once — the flat "first row wins" bug
    // would apply org o1's 5000 (or o2's 9000) to both employees.
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", org: "o1", total: "40000" }),
        makeCostingEntry({ uid: "c2", employee: "emp2", org: "o2", total: "40000" }),
      ],
      [
        makeEmployee({ id: "emp1", org: "o1", employee_name: "Priya" }),
        makeEmployee({ id: "emp2", org: "o2", employee_name: "Rahul" }),
      ],
      [
        makeSalary({ employee_id: "emp1", fixed_salary: 30000 }),
        makeSalary({ id: "s2", employee_id: "emp2", fixed_salary: 30000 }),
      ],
      [
        makeSeatCostSetting({ uid: "sc1", org: "o1", monthly_amount: "5000" }),
        makeSeatCostSetting({ uid: "sc2", org: "o2", monthly_amount: "9000" }),
      ],
      [],
    );
    expect(rows).toHaveLength(2);
    const priya = rows.find((r) => r.employeeId === "emp1")!;
    const rahul = rows.find((r) => r.employeeId === "emp2")!;
    expect(priya.seatCost).toBe(5000);
    expect(priya.cost).toBe(35000);
    expect(rahul.seatCost).toBe(9000);
    expect(rahul.cost).toBe(39000);
  });
});

describe("computeProfitabilityGrandTotal", () => {
  it("sums every row", () => {
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" }),
        makeCostingEntry({ uid: "c2", employee: "emp2", total: "10000" }),
      ],
      [makeEmployee({}), makeEmployee({ id: "emp2", employee_name: "Rahul" })],
      [makeSalary({ fixed_salary: 30000 }), makeSalary({ id: "s2", employee_id: "emp2", fixed_salary: 20000 })],
      [],
      [],
    );
    const total = computeProfitabilityGrandTotal(rows);
    expect(total.clientValue).toBe(50000);
    expect(total.salary).toBe(50000);
    expect(total.cost).toBe(50000);
    expect(total.profit).toBe(0);
  });
});
