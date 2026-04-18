import type { ID, DateString } from "./common";

export interface Employee {
  id: ID;
  employee_name: string;
  father_name?: string | null;
  phone: string | null;
  alt_phone?: string | null;
  email: string | null;
  designation: string | null;
  department: string | null;
  status: string;
  gender: string | null;
  marital_status?: string | null;
  date_of_birth: DateString | null;
  blood_group: string | null;
  permanent_address: string | null;
  current_address?: string | null;
  aadhar_number?: string | null;
  pan_number?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  ifsc_code?: string | null;
  address_proof_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation?: string | null;
  reference_name: string | null;
  reference_contact: string | null;
  reference_relation?: string | null;
  date_of_joining: DateString | null;
  created_by: ID | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SalaryRecord {
  id: ID;
  employee_id: ID;
  employee_name: string;
  designation: string | null;
  department: string | null;
  date_of_joining: DateString | null;
  fixed_salary: number | null;
  basic_salary: number | null;
  hra: number | null;
  da: number | null;
  other_allowances: number | null;
  pf_number: string | null;
  esi_number?: string | null;
  uan_number?: string | null;
  effective_from: DateString | null;
  remarks?: string | null;
  updated_at: string | null;
  created_at: string | null;
}
