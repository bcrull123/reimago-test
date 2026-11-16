import type { LookInfo } from "@/lib/preview/types";

/** Human names for the look archetypes (picker cards and the `chosen_look` form field). */
export const ARCHETYPE_LABEL: Record<LookInfo["archetype"], string> = {
  editorial: "Editorial",
  "dark-premium": "Dark premium",
  "bold-photo": "Bold photo-led",
  playful: "Playful",
  "minimal-luxury": "Minimal luxury",
  "warm-craft": "Warm craft",
};
