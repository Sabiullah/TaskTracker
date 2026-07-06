/**
 * Employee and salary DTOs — mirrors `/api/employees/` and `/api/employee_salary/`.
 *
 * `address_proof_url` is a short auth-gated URL pointing at
 * `/api/employees/<uid>/address_proof/`. No token in the URL; access is
 * gated by DRF `IsAuthenticated` + the viewset's org-scoped queryset.
 */

import type {
  BaseDto,
  IsoDate,
  Pk,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `Employee.status`. */
export type EmployeeStatusValue = "Active" | "Inactive" | "Resigned";

/** Allowed values for `Employee.gender`. */
export type EmployeeGenderValue = "Male" | "Female" | "Other";

/** Allowed values for `Employee.marital_status`. */
export type EmployeeMaritalStatusValue =
  | "Single"
  | "Married"
  | "Divorced"
  | "Widowed";

/** One salary history row embedded on `EmployeeDto.salary_records`. */
export interface EmployeeSalaryEmbedded {
  readonly id: Pk;
  readonly designation: string;
  readonly department: string;
  readonly fixed_salary: string;
  readonly effective_from: IsoDate;
  readonly effective_to: IsoDate | null;
}

/** Full employee payload. */
export interface EmployeeDto extends BaseDto {
  readonly user_detail: UserRefDto | null;
  readonly employee_name: string;
  readonly status: EmployeeStatusValue;
  readonly date_of_joining: IsoDate | null;
  readonly date_of_birth: IsoDate | null;
  readonly gender: EmployeeGenderValue | "";
  readonly blood_group: string;
  readonly marital_status: EmployeeMaritalStatusValue | "";
  readonly father_name: string;
  readonly phone: string;
  readonly alt_phone: string;
  readonly email: string;
  readonly permanent_address: string;
  readonly current_address: string;
  readonly aadhar_number: string;
  readonly pan_number: string;
  readonly bank_name: string;
  readonly bank_account: string;
  readonly ifsc_code: string;
  /** Auth-gated URL — `/api/employees/<uid>/address_proof/`. */
  readonly address_proof_url: string | null;
  readonly emergency_contact_name: string;
  readonly emergency_contact_phone: string;
  readonly emergency_contact_relation: string;
  readonly reference_name: string;
  readonly reference_contact: string;
  readonly reference_relation: string;
  readonly salary_records: readonly EmployeeSalaryEmbedded[];
  /** Master (`type="designation"`) uid — write side of `designation_detail`. */
  readonly designation: string | null;
  /** Nested read-only detail for `designation`. */
  readonly designation_detail: { uid: string; name: string } | null;
}

/** Body for `POST /api/employees/`. */
export interface EmployeeCreate {
  readonly employee_name: string;
  readonly status?: EmployeeStatusValue;
  readonly user?: Uid;
  readonly org?: Uid;
  readonly date_of_joining?: IsoDate;
  readonly date_of_birth?: IsoDate;
  readonly gender?: EmployeeGenderValue;
  readonly blood_group?: string;
  readonly marital_status?: EmployeeMaritalStatusValue;
  readonly father_name?: string;
  readonly phone?: string;
  readonly alt_phone?: string;
  readonly email?: string;
  readonly permanent_address?: string;
  readonly current_address?: string;
  readonly aadhar_number?: string;
  readonly pan_number?: string;
  readonly bank_name?: string;
  readonly bank_account?: string;
  readonly ifsc_code?: string;
  readonly emergency_contact_name?: string;
  readonly emergency_contact_phone?: string;
  readonly emergency_contact_relation?: string;
  readonly reference_name?: string;
  readonly reference_contact?: string;
  readonly reference_relation?: string;
  /** Master (`type="designation"`) uid. */
  readonly designation?: string | null;
}

/** Body for `PATCH /api/employees/<uid>/`. */
export type EmployeeUpdate = Partial<EmployeeCreate>;

/** Full salary payload. */
export interface EmployeeSalaryDto extends BaseDto {
  readonly employee: Uid;
  readonly designation: string;
  readonly department: string;
  /** Decimal string, `"0.00"..`. */
  readonly fixed_salary: string;
  readonly basic_salary: string;
  readonly hra: string;
  readonly da: string;
  readonly other_allowances: string;
  readonly pf_number: string;
  readonly esi_number: string;
  readonly uan_number: string;
  readonly effective_from: IsoDate | null;
  readonly effective_to: IsoDate | null;
  readonly remarks: string;
}

/** Body for `POST /api/employee_salary/`. */
export interface EmployeeSalaryCreate {
  readonly employee: Uid;
  readonly designation?: string;
  readonly department?: string;
  readonly fixed_salary?: string;
  readonly basic_salary?: string;
  readonly hra?: string;
  readonly da?: string;
  readonly other_allowances?: string;
  readonly pf_number?: string;
  readonly esi_number?: string;
  readonly uan_number?: string;
  readonly effective_from?: IsoDate;
  readonly effective_to?: IsoDate;
  readonly remarks?: string;
}

/** Body for `PATCH /api/employee_salary/<uid>/`. */
export type EmployeeSalaryUpdate = Partial<EmployeeSalaryCreate>;
