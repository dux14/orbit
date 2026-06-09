// lib/constants/category-colors.ts
// Fuente única de verdad para el color por categoría.
// Consumido por: el mapa orbital (OrbitViz), la leyenda y las barras del
// dashboard, y los avatares de la lista/detalle de suscripciones.
// Mantener UN solo mapa evita que el mapa, la leyenda y las barras muestren
// colores distintos para la misma categoría.

/** Paleta pastel de marca, mapeada explícitamente por categoría. */
export const CATEGORY_COLORS: Record<string, string> = {
  Streaming: "#f4a0b0",
  "News/Media": "#ffd6a0",
  Productivity: "#b8f0c8",
  Tools: "#d4b8f0",
  Cloud: "#a0d4f4",
  Finance: "#f4c0a0",
  Health: "#a0e8d8",
  Social: "#f0b8d4",
  Gaming: "#c8d4ff",
  Other: "#e0d4f0",
};

/** Paleta de respaldo para categorías personalizadas no listadas arriba. */
export const CATEGORY_FALLBACK_COLORS = [
  "#d4b8f0",
  "#a0d4f4",
  "#b8f0c8",
  "#ffd6a0",
  "#f4a0b0",
  "#a0e8d8",
  "#f4c0a0",
  "#c8d4ff",
  "#f0b8d4",
];

/**
 * Resuelve el color de una categoría.
 * Categoría conocida → su color fijo. Desconocida → color determinístico por
 * hash del nombre (estable entre vistas: mapa, leyenda y barras coinciden sin
 * depender del orden de la lista).
 */
export function categoryColor(category: string | null | undefined): string {
  const key = category || "Other";
  const known = CATEGORY_COLORS[key];
  if (known) return known;

  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0; // unsigned 32-bit
  }
  return CATEGORY_FALLBACK_COLORS[h % CATEGORY_FALLBACK_COLORS.length];
}
