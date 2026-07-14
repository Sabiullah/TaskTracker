/**
 * DTOs for Seat Cost — mirrors `core/costing/serializers.py`
 * (`SeatCostSettingSerializer`, `EmployeeSeatCostSerializer`).
 */

import type { BaseDto } from "./common";
import type { EmployeeRefDto } from "./costing";

/** Org-wide default seat cost (`/api/seat_cost_settings/`). */
export interface SeatCostSettingDto extends BaseDto {
  readonly org: string;
  readonly org_name: string | null;
  readonly monthly_amount: string;
}

export interface SeatCostSettingForm {
  org?: string;
  monthly_amount: string | number;
}

/** Per-employee override (`/api/employee_seat_costs/`). */
export interface EmployeeSeatCostDto extends BaseDto {
  readonly employee: string; // Employee uid
  readonly employee_detail: EmployeeRefDto | null;
  readonly monthly_amount: string;
}

export interface EmployeeSeatCostCreateForm {
  employee: string;
  monthly_amount: string | number;
}

export interface EmployeeSeatCostEditForm {
  monthly_amount?: string | number;
}
