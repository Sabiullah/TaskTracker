// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ApkDownloadPage from "@/pages/ApkDownloadPage";
import { APP_VERSION } from "@/appVersion";

describe("ApkDownloadPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("links to the APK served from public/ with a download attribute", () => {
    render(<ApkDownloadPage />);
    const link = screen.getByRole("link", { name: /download apk/i });
    expect(link.getAttribute("href")).toBe("/TaskTracker-debug.apk");
    expect(link.getAttribute("download")).not.toBeNull();
  });

  it("shows the current app version", () => {
    render(<ApkDownloadPage />);
    expect(screen.getByText(`Version ${APP_VERSION}`)).toBeTruthy();
  });
});
