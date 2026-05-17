/** Response of GET /api/gcal/status/. */
export type GcalStatusDto =
  | { connected: false }
  | {
      connected: true;
      google_email: string;
      scopes: readonly string[];
      connected_at: string;
      last_refreshed_at: string | null;
    };

/** Response of GET /api/gcal/auth-url/. */
export interface GcalAuthUrlDto {
  readonly url: string;
}

/** Response of DELETE /api/gcal/credential/. */
export interface GcalDisconnectDto {
  readonly disconnected: true;
}
