import { Circle, Icon, type IconNode } from "lucide-react";

// Official Lucide nodes: lucide-icons/lucide icons/{mars,venus}.svg (ISC).
// These icons are absent from our installed Lucide version.
const symbols: Record<string, IconNode> = {
  man: [
    ["path", { d: "M16 3h5v5", key: "arrow" }],
    ["path", { d: "m21 3-6.75 6.75", key: "stem" }],
    ["circle", { cx: "10", cy: "14", r: "6", key: "circle" }],
  ],
  woman: [
    ["path", { d: "M12 15v7", key: "stem" }],
    ["path", { d: "M9 19h6", key: "cross" }],
    ["circle", { cx: "12", cy: "9", r: "6", key: "circle" }],
  ],
};

export function GenderIcon({
  gender,
  size = 17,
}: {
  gender: string;
  size?: number;
}) {
  const iconNode = symbols[gender];
  return iconNode ? (
    <Icon iconNode={iconNode} size={size} aria-hidden="true" />
  ) : (
    <Circle size={size} aria-hidden="true" />
  );
}
