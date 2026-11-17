import type { Archetype } from "./types.ts";

/**
 * The ONE name a look goes by (Bob: "Just name them one thing"): its style. Shown on the cards, the preview
 * banner and the `chosen_look` form field, kept through refine rounds, and what refine requests resolve by.
 */
export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  editorial: "Editorial",
  "dark-premium": "Dark Premium",
  "bold-photo": "Bold Photo",
  playful: "Playful",
  "minimal-luxury": "Minimal Luxury",
  "warm-craft": "Warm Craft",
};

export function lookName(archetype: Archetype): string {
  return ARCHETYPE_LABEL[archetype] ?? archetype;
}
