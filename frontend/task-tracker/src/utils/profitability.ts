import type { CostingEntryDto } from "@/types/api/costing";
import type { Employee, SalaryRecord } from "@/types";
import type { EmployeeSeatCostDto, SeatCostSettingDto } from "@/types/api/seatCost";

export type ProfitabilityStatus = "Profitable" | "Break-even" | "Loss";

export interface ProfitabilityRow {
  employeeId: string;
  employeeName: string;
  clientValue: number;
  salary: number;
  hasSalary: boolean;
  seatCost: number;
  cost: number;
  profit: number;
  marginPct: number;
  status: ProfitabilityStatus;
}

export interface ProfitabilityGrandTotal {
  clientValue: number;
  salary: number;
  seatCost: number;
  cost: number;
  profit: number;
  marginPct: number;
}

const BREAK_EVEN_TOLERANCE = 0.05; // ±5%

function statusFor(clientValue: number, cost: number): ProfitabilityStatus {
  if (cost === 0) {
    return clientValue === 0 ? "Break-even" : "Profitable";
  }
  const ratio = clientValue / cost;
  if (ratio > 1 + BREAK_EVEN_TOLERANCE) return "Profitable";
  if (ratio < 1 - BREAK_EVEN_TOLERANCE) return "Loss";
  return "Break-even";
}

function currentSalary(salaries: readonly SalaryRecord[], employeeId: string): number | null {
  const forEmployee = salaries.filter((s) => s.employee_id === employeeId && s.fixed_salary !== null);
  if (forEmployee.length === 0) return null;
  const latest = forEmployee.reduce((a, b) =>
    (a.effective_from ?? "") >= (b.effective_from ?? "") ? a : b,
  );
  return latest.fixed_salary;
}

/** Per-employee comparison of client-billed Costing value against what
 *  that employee costs the org (salary + seat cost). Only includes
 *  employees with at least one Costing entry (non-zero total) or a
 *  seat-cost override — everyone else has nothing to compare. */
export function computeProfitability(
  costingEntries: readonly CostingEntryDto[],
  employees: readonly Employee[],
  salaries: readonly SalaryRecord[],
  seatCostSetting: SeatCostSettingDto | null,
  employeeSeatCosts: readonly EmployeeSeatCostDto[],
): ProfitabilityRow[] {
  const clientValueByEmployee = new Map<string, number>();
  for (const entry of costingEntries) {
    if (!entry.employee) continue;
    const amount = Number.parseFloat(entry.total) || 0;
    clientValueByEmployee.set(entry.employee, (clientValueByEmployee.get(entry.employee) ?? 0) + amount);
  }

  const seatCostOverrideByEmployee = new Map<string, number>();
  for (const item of employeeSeatCosts) {
    seatCostOverrideByEmployee.set(item.employee, Number.parseFloat(item.monthly_amount) || 0);
  }
  const orgDefaultSeatCost = seatCostSetting ? Number.parseFloat(seatCostSetting.monthly_amount) || 0 : 0;

  const employeeIds = new Set<string>([
    ...clientValueByEmployee.keys(),
    ...seatCostOverrideByEmployee.keys(),
  ]);

  const rows: ProfitabilityRow[] = [];
  for (const employeeId of employeeIds) {
    const employee = employees.find((e) => e.id === employeeId);
    const clientValue = clientValueByEmployee.get(employeeId) ?? 0;
    const seatCost = seatCostOverrideByEmployee.get(employeeId) ?? orgDefaultSeatCost;
    const salary = currentSalary(salaries, employeeId);
    const hasSalary = salary !== null;
    const cost = (salary ?? 0) + seatCost;
    const profit = clientValue - cost;
    const marginPct = cost !== 0 ? (profit / cost) * 100 : 0;
    rows.push({
      employeeId,
      employeeName: employee?.employee_name ?? "Unknown",
      clientValue,
      salary: salary ?? 0,
      hasSalary,
      seatCost,
      cost,
      profit,
      marginPct,
      status: statusFor(clientValue, cost),
    });
  }
  return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** Rolls every profitability row up into a single grand-total summary. */
export function computeProfitabilityGrandTotal(
  rows: readonly ProfitabilityRow[],
): ProfitabilityGrandTotal {
  const clientValue = rows.reduce((sum, r) => sum + r.clientValue, 0);
  const salary = rows.reduce((sum, r) => sum + r.salary, 0);
  const seatCost = rows.reduce((sum, r) => sum + r.seatCost, 0);
  const cost = rows.reduce((sum, r) => sum + r.cost, 0);
  const profit = clientValue - cost;
  const marginPct = cost !== 0 ? (profit / cost) * 100 : 0;
  return { clientValue, salary, seatCost, cost, profit, marginPct };
}
