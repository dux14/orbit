"use client";

import type { FxRatesCache, Subscription } from "@/lib/types";
import { monthlyInPrimary } from "@/lib/domain/totals";

// ─── Pastel category color palette ────────────────────────────────────────────
const PASTEL_PALETTE = [
  "#f4a0b0", // coral-rose
  "#a0d4f4", // sky blue
  "#b8f0c8", // mint
  "#ffd6a0", // peach
  "#d4b8f0", // lilac
  "#f4c0a0", // warm peach
  "#a0e8d8", // teal
  "#f0b8d4", // rose
  "#c8d4ff", // periwinkle
  "#b8e8b0", // sage
  "#ffe0a0", // golden
  "#d0b8e8", // lavender
];

/** Deterministic hash: category string → pastel color */
function categoryColor(category: string): string {
  let h = 5381;
  for (let i = 0; i < category.length; i++) {
    h = ((h << 5) + h) ^ category.charCodeAt(i);
    h = h >>> 0; // unsigned 32-bit
  }
  return PASTEL_PALETTE[h % PASTEL_PALETTE.length];
}

// ─── Ring layout ───────────────────────────────────────────────────────────────
/** Ring radii as viewBox units (viewBox = "0 0 280 280", centre = 140,140) */
const RING_RADII = [52, 82, 112];
const RING_STROKE_WIDTHS = [1.2, 1.0, 0.85];
const RING_OPACITIES = [0.45, 0.35, 0.28];

/** Spread subscriptions across rings (round-robin by index) */
function assignRings(subs: Subscription[]) {
  return subs.map((sub, i) => ({ sub, ring: i % RING_RADII.length }));
}

/** Place planets evenly spaced around each ring, with a slight angle offset per ring */
function computePlanetPositions(
  assignments: { sub: Subscription; ring: number }[]
) {
  const ringCounts: Record<number, number> = {};
  const ringIndex: Record<number, number> = {};
  for (const { ring } of assignments) {
    ringCounts[ring] = (ringCounts[ring] ?? 0) + 1;
    ringIndex[ring] = 0;
  }

  const RING_PHASE_OFFSETS = [0, 45, 22]; // stagger starting angle per ring

  return assignments.map(({ sub, ring }) => {
    const count = ringCounts[ring];
    const idx = ringIndex[ring]++;
    const baseAngle = RING_PHASE_OFFSETS[ring] + (360 / count) * idx;
    const rad = (baseAngle * Math.PI) / 180;
    const r = RING_RADII[ring];
    const cx = 140 + r * Math.cos(rad);
    const cy = 140 + r * Math.sin(rad);
    return { sub, cx, cy, ring, idx, count };
  });
}

// ─── Cost → planet radius mapping ─────────────────────────────────────────────
const MIN_PLANET_R = 5;
const MAX_PLANET_R = 14;

function planetRadius(
  sub: Subscription,
  primary: string,
  fx: FxRatesCache | null,
  allCosts: number[]
): number {
  let cost = 0;
  if (fx) {
    try {
      cost = monthlyInPrimary(sub, primary, fx);
    } catch {
      cost = 0;
    }
  }

  const max = Math.max(...allCosts, 1);
  // Scale logarithmically so cheap services aren't tiny dots
  const normalized = max > 0 ? Math.log1p(cost) / Math.log1p(max) : 0;
  return MIN_PLANET_R + normalized * (MAX_PLANET_R - MIN_PLANET_R);
}

// ─── Animation keyframes (CSS) ─────────────────────────────────────────────────
const ANIMATION_CSS = `
@keyframes orbit-spin-slow {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes orbit-spin-med {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes orbit-spin-fast {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .orbit-ring-0,
  .orbit-ring-1,
  .orbit-ring-2 {
    animation: none !important;
  }
}
`;

const RING_ANIMATION_STYLES = [
  { className: "orbit-ring-0", duration: "60s", direction: "normal" as const },
  { className: "orbit-ring-1", duration: "45s", direction: "reverse" as const },
  { className: "orbit-ring-2", duration: "80s", direction: "normal" as const },
];

// ─── Props ─────────────────────────────────────────────────────────────────────
export interface OrbitVizProps {
  subscriptions: Subscription[];
  primaryCurrency: string;
  fx: FxRatesCache | null;
  /** Optional size override (default 280) */
  size?: number;
  className?: string;
}

export function OrbitViz({
  subscriptions,
  primaryCurrency,
  fx,
  size = 280,
  className,
}: OrbitVizProps) {
  // Only visualize active/trial subscriptions
  const active = subscriptions.filter(
    (s) => s.status === "active" || s.status === "trial"
  );

  // Pre-compute all monthly costs for relative sizing
  const allCosts = active.map((s) => {
    if (!fx) return 0;
    try {
      return monthlyInPrimary(s, primaryCurrency, fx);
    } catch {
      return 0;
    }
  });

  const assignments = assignRings(active);
  const positions = computePlanetPositions(assignments);

  // Group positions by ring for animated <g> containers
  const byRing: Record<number, typeof positions> = { 0: [], 1: [], 2: [] };
  for (const p of positions) {
    byRing[p.ring].push(p);
  }

  return (
    <>
      {/* Inject animation CSS once */}
      <style dangerouslySetInnerHTML={{ __html: ANIMATION_CSS }} />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 280 280"
        width={size}
        height={size}
        aria-label={`Orbit visualization: ${active.length} active subscription${active.length !== 1 ? "s" : ""}`}
        role="img"
        className={className}
      >
        <defs>
          {/* Core gradient */}
          <radialGradient id="vizCoreGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#e8d8ff" />
            <stop offset="100%" stopColor="#c9b8ff" />
          </radialGradient>
          {/* Glow for rings */}
          <filter id="vizGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Soft planet glow */}
          <filter id="planetGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Static orbit rings ───────────────────────────────────────── */}
        {RING_RADII.map((r, i) => (
          <circle
            key={`ring-${i}`}
            cx="140"
            cy="140"
            r={r}
            fill="none"
            stroke="#c9b8ff"
            strokeWidth={RING_STROKE_WIDTHS[i]}
            strokeOpacity={RING_OPACITIES[i]}
            strokeDasharray="4 6"
            filter="url(#vizGlow)"
          />
        ))}

        {/* ── Animated ring groups (planets spin around centre) ─────────── */}
        {([0, 1, 2] as const).map((ringIdx) => {
          const anim = RING_ANIMATION_STYLES[ringIdx];
          return (
            <g
              key={`ring-group-${ringIdx}`}
              className={anim.className}
              style={{
                transformOrigin: "140px 140px",
                animation: `orbit-spin-${ringIdx === 0 ? "slow" : ringIdx === 1 ? "med" : "fast"} ${anim.duration} linear infinite`,
                animationDirection: anim.direction,
              }}
            >
              {byRing[ringIdx].map(({ sub, cx, cy }) => {
                const r = planetRadius(sub, primaryCurrency, fx, allCosts);
                const color = categoryColor(sub.category || "Other");
                const monthlyCost = allCosts[active.indexOf(sub)];
                const label = `${sub.serviceName}, ${sub.category || "Other"}, ${new Intl.NumberFormat("en", {
                  style: "currency",
                  currency: primaryCurrency,
                  maximumFractionDigits: 0,
                }).format(monthlyCost)}/mo`;

                return (
                  <g key={sub.id} role="img" aria-label={label}>
                    {/* Glow halo */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r + 3}
                      fill={color}
                      fillOpacity={0.18}
                      filter="url(#planetGlow)"
                      aria-hidden="true"
                    />
                    {/* Planet body */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={color}
                      fillOpacity={0.9}
                      tabIndex={0}
                      style={{ cursor: "default" }}
                    />
                    {/* Highlight specular */}
                    <circle
                      cx={cx - r * 0.28}
                      cy={cy - r * 0.28}
                      r={r * 0.3}
                      fill="white"
                      fillOpacity={0.38}
                      aria-hidden="true"
                    />
                    {/* Service name label for planets larger than ~8px */}
                    {r >= 9 && (
                      <text
                        x={cx}
                        y={cy + r + 10}
                        textAnchor="middle"
                        fontSize="8"
                        fill="currentColor"
                        fillOpacity={0.65}
                        style={{ userSelect: "none", pointerEvents: "none" }}
                        aria-hidden="true"
                      >
                        {sub.serviceName.length > 10
                          ? sub.serviceName.slice(0, 9) + "…"
                          : sub.serviceName}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* ── Central core ────────────────────────────────────────────── */}
        <circle cx="140" cy="140" r="10" fill="url(#vizCoreGrad)" />
        <circle cx="137" cy="137" r="3.2" fill="white" fillOpacity={0.45} aria-hidden="true" />
      </svg>
    </>
  );
}

export default OrbitViz;
