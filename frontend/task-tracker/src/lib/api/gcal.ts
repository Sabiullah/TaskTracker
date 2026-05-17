import { apiGet, apiRequest } from "./client";
import type {
  GcalStatusDto,
  GcalAuthUrlDto,
  GcalDisconnectDto,
} from "@/types/api/gcal";

export const getGcalStatus = (): Promise<GcalStatusDto> =>
  apiGet<GcalStatusDto>("/api/gcal/status/");

export const getGcalAuthUrl = (): Promise<GcalAuthUrlDto> =>
  apiGet<GcalAuthUrlDto>("/api/gcal/auth-url/");

export const disconnectGcal = (): Promise<GcalDisconnectDto> =>
  apiRequest<GcalDisconnectDto>("/api/gcal/credential/", { method: "DELETE" });
