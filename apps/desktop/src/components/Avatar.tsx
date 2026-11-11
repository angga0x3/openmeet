const COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#f43f5e",
];

const SKIN = ["#f3c9a8", "#e8bf98", "#d9a27a", "#c68a62", "#a86b47", "#7a4a2a"];
const HAIR = ["#1c1412", "#2a1a10", "#3a2618", "#0f0b09", "#5b3a24", "#a86b32"];
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function colorFor(name: string): string {
  return COLORS[hash(name || "guest") % COLORS.length];
}

export function Avatar({
  name,
  size = 28,
  className = "",
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const color = colorFor(name);
  return (
    <span
      className={`av ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        ["--c" as string]: color,
        ...style,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Illustrated portrait used when the camera is off. */
export function AvatarArt({ name, className = "" }: { name: string; className?: string }) {
  const h = hash(name || "guest");
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const shirt = COLORS[(h >> 7) % COLORS.length];
  const long = h % 3 === 0;
  const bun = h % 7 === 0;

  return (
    <svg
      className={`avatar-art ${className}`}
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
    >
      {bun && <circle cx="100" cy="34" r="13" fill={hair} />}
      {long && (
        <path
          d="M62 86c0-36 17-56 38-56s38 20 38 56v48c0 6-5 10-11 10H73c-6 0-11-4-11-10z"
          fill={hair}
        />
      )}
      <path d="M100 126c-44 0-70 26-74 74h148c-4-48-30-74-74-74z" fill={shirt} />
      <path d="M84 126c4 10 10 14 16 14s12-4 16-14z" fill="#000000" opacity="0.18" />
      <rect x="89" y="102" width="22" height="30" rx="10" fill={skin} />
      <rect x="89" y="110" width="22" height="9" fill="#000000" opacity="0.12" />
      <ellipse cx="100" cy="80" rx="30" ry="36" fill={skin} />
      <path
        d={
          long
            ? "M66 76c4-24 17-38 34-38 18 0 31 13 32 38-10-13-21-19-32-19-12 0-23 6-34 19z"
            : "M66 76c0-26 14-43 34-43s34 16 33 43c-6-11-13-17-22-19-9 5-22 7-35 5-4 4-8 9-10 14z"
        }
        fill={hair}
      />
    </svg>
  );
}
