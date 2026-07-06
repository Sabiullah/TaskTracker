/**
 * DTOs for the Costing feature — mirrors `core/costing/serializers.py`
 * (`CostingEntrySerializer`) on the Django backend.
 */

import type { BaseDto, MasterRefDto } from "./common";

/** Minimal Employee reference — mirrors `EmployeeMinSerializer`. */
export interface EmployeeRefDto {
  readonly id: number;
  readonly uid: string;
  readonly employee_name: string;
}

/** Server response shape for a `CostingEntry` row (`/api/costing_entries/`). */
export interface CostingEntryDto extends BaseDto {
  readonly org: string | null;
  readonly org_name: string | null;
  readonly client: string; // Master uid (type="client")
  readonly client_detail: MasterRefDto | null;
  readonly designation: string; // Master uid (type="designation")
  readonly designation_detail: MasterRefDto | null;
  readonly employee: string | null; // Employee uid
  readonly employee_detail: EmployeeRefDto | null;
  readonly hr_day: string;
  readonly days_working: string;
  readonly total: string;
  readonly created_by_uid: string | null;
}

/** Body sent on `POST /api/costing_entries/`. */
export interface CostingEntryCreateForm {
  org?: string;
  client: string;
  designation: string;
  employee?: string | null;
  hr_day: string | number;
  days_working: string | number;
}

/** Body sent on `PATCH /api/costing_entries/{uid}/`. */
export interface CostingEntryEditForm {
  client?: string;
  designation?: string;
  employee?: string | null;
  hr_day?: string | number;
  days_working?: string | number;
}
