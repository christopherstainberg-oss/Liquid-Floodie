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


