import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  CostingEntryCreateForm,
  CostingEntryDto,
  CostingEntryEditForm,
} from "@/types/api/costing";

export const listCostingEntries = (clientUid?: string) =>
  apiGet<CostingEntryDto[]>("/costing_entries/", clientUid ? { client: clientUid } : undefined);

export const createCostingEntry = (form: CostingEntryCreateForm) =>
  apiPost<CostingEntryDto>("/costing_entries/", form);

export const editCostingEntry = (uid: string, form: CostingEntryEditForm) =>
  apiPatch<CostingEntryDto>(`/costing_entries/${uid}/`, form);

export const deleteCostingEntry = (uid: string) => apiDelete(`/costing_entries/${uid}/`);
