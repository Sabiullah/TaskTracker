import type { CSSProperties } from "react";

export const STATUS_LIST: string[] = ["Active", "Inactive", "Resigned"];
export const STATUS_CFG: Record<string, { color: string; bg: string }> = {
  Active: { color: "#16a34a", bg: "#f0fdf4" },
  Inactive: { color: "#d97706", bg: "#fef3c7" },
  Resigned: { color: "#dc2626", bg: "#fef2f2" },
};
export const GENDERS: string[] = ["Male", "Female", "Other"];
export const BLOOD_GROUPS: string[] = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];
export const MARITAL: string[] = ["Single", "Married", "Divorced", "Widowed"];

export const thS: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
export const tdS: CSSProperties = {
  padding: "8px 12px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
export const inpS: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
export const lblS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: ".5px",
};

export const BLANK_EMP: Record<string, string> = {
  employee_name: "",
  father_name: "",
  date_of_birth: "",
  gender: "Male",
  blood_group: "",
  marital_status: "Single",
  phone: "",
  alt_phone: "",
  email: "",
  permanent_address: "",
  current_address: "",
  aadhar_number: "",
  pan_number: "",
  bank_name: "",
  bank_account: "",
  ifsc_code: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
  reference_name: "",
  reference_contact: "",
  reference_relation: "",
  status: "Active",
};

export const BLANK_SAL: Record<string, string> = {
  employee_id: "",
  employee_name: "",
  date_of_joining: "",
  designation: "",
  department: "",
  fixed_salary: "",
  basic_salary: "",
  hra: "",
  da: "",
  other_allowances: "",
  pf_number: "",
  esi_number: "",
  uan_number: "",
  effective_from: "",
  remarks: "",
};
