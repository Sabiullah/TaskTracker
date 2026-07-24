import { apiGet } from "./client";

/** One exported APK build, as recorded in the backend release table. */
export interface ApkReleaseDto {
  readonly version: string;
  readonly remarks: string;
  readonly updated_at: string;
}

/** Latest released APK version plus the full release history. All top-level
 *  fields are null/empty until a release has been recorded. */
export interface ApkVersionDto {
  readonly version: string | null;
  readonly updated_at: string | null;
  readonly remarks: string;
  readonly releases: readonly ApkReleaseDto[];
}

export const fetchApkVersion = () => apiGet<ApkVersionDto>("/apk_version/");
