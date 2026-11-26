"use client";

// Minimalist neon SVG runner pawn. Color is hashed from the wallet
// pubkey; a floating tag shows the short address and the runner's
// current multiplier (or payout estimate). The hop animation is
// re-triggered by keying the inner element on (row, col).
//
// `row` is the STANDING row: -1 = the START platform below the
// bridge, 0..rows-1 = the bridge row the runner stands on. The
// board renders rows+1 equal bands (platform + bridge rows), so
// the vertical position is band (row + 1) of (rows + 1).
export default function RunnerAvatar({
  label,
  color,
  row,
  col,
  cols,
  rows,
  tag,
  aura = false,
  ghost = false,
}: {
  label: string;
  color: string;
  row: number;
  col: number;
  cols: number;
  rows: number;
  tag: string;
  aura?: boolean;
  ghost?: boolean;
}) {
  const left = ((col + 0.5) / cols) * 100;
  const bottom = ((row + 1 + 0.5) / (rows + 1)) * 100;
  return (
    <div
      className="pointer-events-none absolute z-20 flex w-16 -translate-x-1/2 flex-col items-center"
      style={{
        left: `${left}%`,
        bottom: `calc(${bottom}% - 6px)`,
        transition: "left 0.45s cubic-bezier(.34,1.4,.44,1), bottom 0.45s cubic-bezier(.34,1.4,.44,1)",
        opacity: ghost ? 0.75 : 1,
      }}
    >
      <div
        className="mb-0.5 whitespace-nowrap rounded-full border px-1.5 py-px font-mono text-[9px]"
        style={{
          borderColor: color,
          color,
          background: "rgba(5,8,16,0.82)",
        }}
      >
        {label} · {tag}
      </div>
      <div
        key={`${row}-${col}`}
        className="avatar-hop"
        style={
          aura
            ? { filter: `drop-shadow(0 0 10px ${color}) drop-shadow(0 0 22px rgba(244,63,94,0.55))` }
            : { filter: `drop-shadow(0 0 7px ${color})` }
        }
      >
        <svg width="30" height="36" viewBox="0 0 30 36" aria-hidden>
          <circle cx="15" cy="8" r="6" fill={color} opacity="0.95" />
          <path
            d="M15 14 L22 30 Q15 34 8 30 Z"
            fill={color}
            opacity="0.85"
          />
          <ellipse cx="15" cy="32.5" rx="9" ry="2.4" fill={color} opacity="0.35" />
        </svg>
      </div>
    </div>
  );
}
