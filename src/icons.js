/**
 * Consistent ingredient / base icon set for LiquidFloodie.
 * SVG marks + emoji fallbacks for quick recognition.
 */

export const CATEGORY_ICONS = {
  base: { emoji: "💧", label: "Liquid base", color: "#0ea5e9" },
  fruit: { emoji: "🍓", label: "Fruit", color: "#f43f5e" },
  vegetable: { emoji: "🥬", label: "Vegetable", color: "#22c55e" },
  herb: { emoji: "🌿", label: "Herb", color: "#84cc16" },
  spice: { emoji: "✨", label: "Spice", color: "#f59e0b" },
  "nut-seed": { emoji: "🌰", label: "Nuts & seeds", color: "#a16207" },
  legume: { emoji: "🫘", label: "Legume", color: "#b45309" },
  grain: { emoji: "🌾", label: "Grain (GF)", color: "#ca8a04" },
  protein: { emoji: "💪", label: "Protein", color: "#ef4444" },
  other: { emoji: "🥄", label: "Other", color: "#64748b" },
};

export function iconFor(item) {
  if (item?.icon) return item.icon;
  return CATEGORY_ICONS[item?.category]?.emoji || "•";
}

export function categoryMeta(category) {
  return CATEGORY_ICONS[category] || CATEGORY_ICONS.other;
}

/** Inline SVG badge for a category (accessible, consistent style) */
export function categorySvg(category, size = 28) {
  const meta = categoryMeta(category);
  const emoji = meta.emoji;
  // Use foreignObject-free: circle + text emoji
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="${meta.label}">
    <circle cx="16" cy="16" r="15" fill="${meta.color}" opacity="0.18"/>
    <circle cx="16" cy="16" r="14" fill="none" stroke="${meta.color}" stroke-width="1.5"/>
    <text x="16" y="21" text-anchor="middle" font-size="14">${emoji}</text>
  </svg>`;
}

export function iconLegendHtml() {
  return Object.entries(CATEGORY_ICONS)
    .map(
      ([key, meta]) =>
        `<span class="icon-legend-item" title="${meta.label}"><span class="ico">${meta.emoji}</span> ${meta.label}</span>`
    )
    .join("");
}
