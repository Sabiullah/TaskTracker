/** Palette used for avatar backgrounds, picked by hashing the name. */
export const AVATAR_COLORS: string[] = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#059669",
];

/** Returns a deterministic color from AVATAR_COLORS based on the first character of name. */
export function avatarColor(name: string): string {
  return AVATAR_COLORS[(name?.charCodeAt(0) || 65) % AVATAR_COLORS.length];
}

/** Returns uppercase initials (up to 2 chars) from a name string. */
export function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Multi-tone palette (bg / text / dot) used to visually tag team members on calendars and boards. */
export interface MemberPalette {
  bg: string;
  text: string;
  dot: string;
}

export const MEMBER_PALETTE: MemberPalette[] = [
  { bg: "#dbeafe", text: "#1d4ed8", dot: "#2563eb" },
  { bg: "#ede9fe", text: "#6d28d9", dot: "#7c3aed" },
  { bg: "#fce7f3", text: "#be185d", dot: "#db2777" },
  { bg: "#fee2e2", text: "#b91c1c", dot: "#dc2626" },
  { bg: "#ffedd5", text: "#c2410c", dot: "#ea580c" },
  { bg: "#dcfce7", text: "#15803d", dot: "#16a34a" },
  { bg: "#cffafe", text: "#0e7490", dot: "#0891b2" },
  { bg: "#f3e8ff", text: "#7e22ce", dot: "#9333ea" },
  { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
  { bg: "#d1fae5", text: "#065f46", dot: "#059669" },
  { bg: "#e0f2fe", text: "#075985", dot: "#0284c7" },
  { bg: "#fdf4ff", text: "#86198f", dot: "#c026d3" },
];
