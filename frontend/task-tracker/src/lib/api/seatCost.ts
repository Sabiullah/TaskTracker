import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  EmployeeSeatCostCreateForm,
  EmployeeSeatCostDto,
  EmployeeSeatCostEditForm,
  SeatCostSettingDto,
  SeatCostSettingForm,
} from "@/types/api/seatCost";

export const listSeatCostSettings = () => apiGet<SeatCostSettingDto[]>("/seat_cost_settings/");

export const createSeatCostSetting = (form: SeatCostSettingForm) =>
  apiPost<SeatCostSettingDto>("/seat_cost_settings/", form);

export const editSeatCostSetting = (uid: string, form: SeatCostSettingForm) =>
  apiPatch<SeatCostSettingDto>(`/seat_cost_settings/${uid}/`, form);

export const listEmployeeSeatCosts = () => apiGet<EmployeeSeatCostDto[]>("/employee_seat_costs/");

export const createEmployeeSeatCost = (form: EmployeeSeatCostCreateForm) =>
  apiPost<EmployeeSeatCostDto>("/employee_seat_costs/", form);

export const editEmployeeSeatCost = (uid: string, form: EmployeeSeatCostEditForm) =>
  apiPatch<EmployeeSeatCostDto>(`/employee_seat_costs/${uid}/`, form);

export const deleteEmployeeSeatCost = (uid: string) => apiDelete(`/employee_seat_costs/${uid}/`);
