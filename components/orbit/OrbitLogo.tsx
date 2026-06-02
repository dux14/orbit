/**
 * OrbitLogo — the Orbit brand mark.
 *
 * Motif: concentric rings with planet-dots orbiting a central core.
 * Planet size ≈ subscription cost tier; color ≈ category.
 * Uses a fixed, visually-pleasing arrangement for the logo.
 *
 * Props:
 *   size      — pixel dimension of the square viewport (default 32)
 *   className — extra Tailwind / CSS classes forwarded to the <svg>
 */

import type { SVGProps } from "react";

interface OrbitLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/** Planet arrangement — angles in degrees, ring index 0 = inner, 1 = middle, 2 = outer */
const PLANETS = [
  // ring 0 — inner
  { ring: 0, angle: 45,  r: 3.5, fill: "#f4a0b0" }, // coral — streaming
  { ring: 0, angle: 225, r: 3,   fill: "#a0d4f4" }, // sky blue — cloud
  // ring 1 — middle
  { ring: 1, angle: 120, r: 4.5, fill: "#b8f0c8" }, // mint — productivity
  { ring: 1, angle: 290, r: 3.5, fill: "#ffd6a0" }, // peach — news/media
  { ring: 1, angle: 200, r: 3,   fill: "#d4b8f0" }, // lilac — tools
  // ring 2 — outer
  { ring: 2, angle: 60,  r: 5,   fill: "#f4c0a0" }, // warm peach — finance
  { ring: 2, angle: 165, r: 3.5, fill: "#a0e8d8" }, // teal — health
  { ring: 2, angle: 320, r: 4,   fill: "#f0b8d4" }, // rose — social
] as const;

/** Ring radii expressed as fractions of half the viewBox size (50 units). */
const RING_RADII = [14, 22, 31]; // inner, middle, outer

export function OrbitLogo({ size = 32, className, ...rest }: OrbitLogoProps) {
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
        {/* Radial gradient for the central core */}
        <radialGradient id="orbitCoreGrad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#e8d8ff" />
          <stop offset="100%" stopColor="#c9b8ff" />
        </radialGradient>

        {/* Subtle glow filter for rings */}
        <filter id="orbitGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Clip the whole logo to a circle for clean edges at small sizes */}
        <clipPath id="orbitClip">
          <circle cx="50" cy="50" r="49" />
        </clipPath>
      </defs>

      <g clipPath="url(#orbitClip)">
        {/* ── Rings ─────────────────────────────────────────────────── */}
        {RING_RADII.map((r, i) => (
          <circle
            key={`ring-${i}`}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="#c9b8ff"
            strokeWidth={i === 0 ? 1.2 : i === 1 ? 1.0 : 0.85}
            strokeOpacity={0.55 - i * 0.08}
            filter="url(#orbitGlow)"
          />
        ))}

        {/* ── Planet dots ───────────────────────────────────────────── */}
        {PLANETS.map((p, i) => {
          const rRing = RING_RADII[p.ring];
          const rad = (p.angle * Math.PI) / 180;
          const cx = 50 + rRing * Math.cos(rad);
          const cy = 50 + rRing * Math.sin(rad);
          return (
            <circle
              key={`planet-${i}`}
              cx={cx}
              cy={cy}
              r={p.r}
              fill={p.fill}
              fillOpacity={0.92}
            />
          );
        })}

        {/* ── Central core ──────────────────────────────────────────── */}
        <circle
          cx="50"
          cy="50"
          r="6.5"
          fill="url(#orbitCoreGrad)"
        />
        {/* Inner highlight on core */}
        <circle
          cx="48"
          cy="47.5"
          r="2.2"
          fill="white"
          fillOpacity={0.45}
        />
      </g>
    </svg>
  );
}

export default OrbitLogo;
