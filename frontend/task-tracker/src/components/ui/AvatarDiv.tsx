import { avatarColor, initials } from "@/utils/avatar";

export interface AvatarDivProps {
  name: string;
  size?: number;
  radius?: string;
  icon?: string;
}

export default function AvatarDiv({
  name,
  size = 34,
  radius = "50%",
  icon,
}: AvatarDivProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: icon ? "#7c3aed" : avatarColor(name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {icon || initials(name)}
    </div>
  );
}
