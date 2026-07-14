// Render the Work Log dashboard to a PNG the user can share (WhatsApp etc.).
//
// WhatsApp's wa.me link is text-only, so an image has to go through the OS
// share sheet via the Web Share API (mobile). We draw a clean, theme-neutral
// snapshot on a canvas — no external dependency, and it looks the same
// regardless of the app's light/dark theme or the phone's screen size.

export interface DashboardStat {
  label: string;
  value: string;
  color: string;
}

export interface DashboardBar {
  label: string;
  value: string; // e.g. "6:09"
  mins: number;
}

export interface DashboardMember {
  name: string;
  value: string; // e.g. "14:18 hrs"
  mins: number;
}

export interface DashboardImageInput {
  title: string;
  subtitle: string;
  reportedBy?: string;
  stats: DashboardStat[];
  chartTitle: string;
  bars: DashboardBar[];
  members: DashboardMember[];
  generatedAt: string;
}

const SCALE = 2; // hi-DPI so text stays crisp when WhatsApp downscales
const W = 760;
const PAD = 28;
const MAX_BARS = 20;

const FONT = (weight: number, size: number) =>
  `${weight} ${size}px -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Draw the dashboard and return it as a PNG blob. */
export async function renderDashboardImage(
  input: DashboardImageInput,
): Promise<Blob> {
  const bars = input.bars.slice(-MAX_BARS);
  const truncated = input.bars.length > MAX_BARS;
  const members = input.members.slice(0, 6);

  // ── Measure the vertical layout so the canvas is exactly tall enough. ──
  const headerH = 96;
  const statsH = 92;
  const chartH = bars.length ? 40 + 190 : 0;
  const membersH = members.length ? 34 + members.length * 30 + 8 : 0;
  const footerH = 40;
  const H =
    PAD + headerH + statsH + chartH + membersH + footerH + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  // Background
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, PAD - 8, PAD - 8, W - 2 * (PAD - 8), H - 2 * (PAD - 8), 16);
  ctx.fill();

  let y = PAD + 8;

  // ── Header ──
  ctx.fillStyle = "#0f172a";
  ctx.font = FONT(800, 24);
  ctx.fillText(input.title, PAD, y + 20);
  y += 30;
  ctx.fillStyle = "#475569";
  ctx.font = FONT(500, 14);
  ctx.fillText(input.subtitle, PAD, y + 14);
  y += 22;
  if (input.reportedBy) {
    ctx.fillStyle = "#64748b";
    ctx.font = FONT(600, 13);
    ctx.fillText(`Reported by: ${input.reportedBy}`, PAD, y + 12);
    y += 20;
  }
  y += 12;
  divider(ctx, y);
  y += 18;

  // ── Stat cards (up to 4 across) ──
  const cardCount = Math.min(input.stats.length, 4) || 1;
  const gap = 12;
  const cardW = (W - 2 * PAD - gap * (cardCount - 1)) / cardCount;
  const cardH = 72;
  input.stats.slice(0, 4).forEach((s, i) => {
    const cx = PAD + i * (cardW + gap);
    ctx.fillStyle = "#f8fafc";
    roundRect(ctx, cx, y, cardW, cardH, 10);
    ctx.fill();
    // colored top accent
    ctx.fillStyle = s.color;
    roundRect(ctx, cx, y, cardW, 4, 2);
    ctx.fill();
    ctx.fillStyle = s.color;
    ctx.font = FONT(800, 24);
    ctx.fillText(s.value, cx + 14, y + 38);
    ctx.fillStyle = "#64748b";
    ctx.font = FONT(600, 12);
    ctx.fillText(s.label, cx + 14, y + 58);
  });
  y += cardH + 24;

  // ── Trend chart ──
  if (bars.length) {
    ctx.fillStyle = "#0f172a";
    ctx.font = FONT(700, 15);
    ctx.fillText(input.chartTitle, PAD, y + 14);
    y += 30;

    const chartTop = y;
    const chartBottom = y + 150;
    const maxMins = Math.max(...bars.map((b) => b.mins), 1);
    const slot = (W - 2 * PAD) / bars.length;
    const barW = Math.min(slot * 0.6, 46);

    bars.forEach((b, i) => {
      const cx = PAD + i * slot + (slot - barW) / 2;
      const h = Math.max(2, ((chartBottom - chartTop) * b.mins) / maxMins);
      const top = chartBottom - h;
      ctx.fillStyle = "#2563eb";
      roundRect(ctx, cx, top, barW, h, 4);
      ctx.fill();
      // value above the bar
      if (b.mins > 0) {
        ctx.fillStyle = "#1e293b";
        ctx.font = FONT(700, 10);
        ctx.textAlign = "center";
        ctx.fillText(b.value, cx + barW / 2, top - 4);
        ctx.textAlign = "left";
      }
      // x label
      ctx.fillStyle = "#94a3b8";
      ctx.font = FONT(500, 10);
      ctx.textAlign = "center";
      ctx.fillText(b.label, cx + barW / 2, chartBottom + 16);
      ctx.textAlign = "left";
    });
    // baseline
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, chartBottom + 0.5);
    ctx.lineTo(W - PAD, chartBottom + 0.5);
    ctx.stroke();
    y = chartBottom + 40;
    if (truncated) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = FONT(500, 11);
      ctx.fillText(`(showing last ${MAX_BARS} of ${input.bars.length})`, PAD, y);
      y += 8;
    }
  }

  // ── Top members ──
  if (members.length) {
    ctx.fillStyle = "#0f172a";
    ctx.font = FONT(700, 15);
    ctx.fillText("Top Members", PAD, y + 14);
    y += 28;
    const maxMemMins = Math.max(...members.map((m) => m.mins), 1);
    const barMaxW = W - 2 * PAD - 260;
    members.forEach((m) => {
      ctx.fillStyle = "#334155";
      ctx.font = FONT(600, 13);
      ctx.fillText(clip(ctx, m.name, 150), PAD, y + 14);
      // track + fill
      const trackX = PAD + 160;
      ctx.fillStyle = "#eef2f7";
      roundRect(ctx, trackX, y + 4, barMaxW, 12, 6);
      ctx.fill();
      ctx.fillStyle = "#16a34a";
      roundRect(
        ctx,
        trackX,
        y + 4,
        Math.max(6, (barMaxW * m.mins) / maxMemMins),
        12,
        6,
      );
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.font = FONT(700, 12);
      ctx.textAlign = "right";
      ctx.fillText(m.value, W - PAD, y + 14);
      ctx.textAlign = "left";
      y += 30;
    });
    y += 8;
  }

  // ── Footer ──
  divider(ctx, y);
  ctx.fillStyle = "#94a3b8";
  ctx.font = FONT(500, 11);
  ctx.fillText(`Task Tracker · ${input.generatedAt}`, PAD, y + 20);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}

/**
 * Share a PNG via the OS share sheet (mobile). Returns true if the share
 * sheet was invoked; false if the platform can't share files (caller should
 * fall back to a download).
 */
export async function shareImageFile(
  blob: Blob,
  filename: string,
  text: string,
): Promise<boolean> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === "function") {
    try {
      await nav.share({ files: [file], text });
      return true;
    } catch (err) {
      // User cancelled the sheet — treat as handled, don't also download.
      if (err instanceof DOMException && err.name === "AbortError") return true;
      return false;
    }
  }
  return false;
}

/** Trigger a browser download of the blob (desktop fallback). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── canvas helpers ──
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function divider(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 0.5);
  ctx.lineTo(W - PAD, y + 0.5);
  ctx.stroke();
}

function clip(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
    t = t.slice(0, -1);
  }
  return t + "…";
}
