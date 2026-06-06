/**
 * OrbitLogo — the Orbit brand mark (Aurora direction).
 *
 * Motif: concentric orbital rings drawn with a periwinkle→rose aurora gradient,
 * pastel planet-dots with soft halos, transparent background. The raster icons
 * (public/icons/*) are generated separately from the Higgsfield source art.
 *
 * Props:
 *   size      — pixel dimension of the square viewport (default 32)
 *   className — extra Tailwind / CSS classes forwarded to the <svg>
 */

import { useId, type SVGProps } from "react";

interface OrbitLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/** Ring radii (viewBox 0..100, center 50). */
const RING_RADII = [14, 22, 31] as const;

/** Planets: position + halo/core radii + tint. */
const PLANETS = [
  { cx: 59.9, cy: 59.9, halo: 5.5, core: 3.2, haloFill: "#ff9ecb", coreFill: "#ffc4dd" },
  { cx: 39.0, cy: 69.05, halo: 6.5, core: 3.8, haloFill: "#a8b4ff", coreFill: "#c8d0ff" },
  { cx: 73.75, cy: 30.07, halo: 5.5, core: 3.2, haloFill: "#c9a0ff", coreFill: "#e0c8ff" },
  { cx: 57.52, cy: 29.33, halo: 4.2, core: 2.4, haloFill: "#ff9ecb", coreFill: "#ffd0e3" },
  { cx: 29.33, cy: 42.48, halo: 4.0, core: 2.3, haloFill: "#a8b4ff", coreFill: "#cdd4ff" },
] as const;

export function OrbitLogo({ size = 32, className, ...rest }: OrbitLogoProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `orbitAurora-${uid}`;
  const haloId = `orbitHalo-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-label="Orbit logo"
      role="img"
      className={className}
      {...rest}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a8b4ff" />
          <stop offset="55%" stopColor="#c9a0ff" />
          <stop offset="100%" stopColor="#ff9ecb" />
        </linearGradient>
        <filter id={haloId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {/* ── Orbital rings (aurora gradient stroke) ──────────────────── */}
      {RING_RADII.map((r, i) => (
        <circle
          key={`ring-${i}`}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={i === 0 ? 1.4 : i === 1 ? 1.1 : 0.9}
          strokeOpacity={0.9 - i * 0.2}
        />
      ))}

      {/* ── Planets (halo + core) ───────────────────────────────────── */}
      {PLANETS.map((p, i) => (
        <g key={`planet-${i}`}>
          <circle
            cx={p.cx}
            cy={p.cy}
            r={p.halo}
            fill={p.haloFill}
            fillOpacity={0.5}
            filter={`url(#${haloId})`}
          />
          <circle cx={p.cx} cy={p.cy} r={p.core} fill={p.coreFill} />
        </g>
      ))}

      {/* ── Central core ────────────────────────────────────────────── */}
      <circle
        cx="50"
        cy="50"
        r="7.5"
        fill={`url(#${gradId})`}
        fillOpacity={0.6}
        filter={`url(#${haloId})`}
      />
      <circle cx="50" cy="50" r="5" fill="#f3edff" />
    </svg>
  );
}

export default OrbitLogo;
