import { apiGet, apiRequest } from "./client";
import type {
  GcalStatusDto,
  GcalAuthUrlDto,
  GcalDisconnectDto,
} from "@/types/api/gcal";

// Paths are relative to `API_BASE` (defaults to `/api`); the client prepends
// it for us, so the leading `/api` is NOT included here.
export const getGcalStatus = (): Promise<GcalStatusDto> =>
  apiGet<GcalStatusDto>("/gcal/status/");

export const getGcalAuthUrl = (): Promise<GcalAuthUrlDto> =>
  apiGet<GcalAuthUrlDto>("/gcal/auth-url/");

export const disconnectGcal = (): Promise<GcalDisconnectDto> =>
  apiRequest<GcalDisconnectDto>("/gcal/credential/", { method: "DELETE" });
