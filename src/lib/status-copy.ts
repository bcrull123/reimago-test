/**
 * Round 10 — livelier status copy, tied to the real stage of the work (like Grok Build's). Each stage has a few
 * lines that rotate while it runs; "Build a New Site" and card edits have their own.
 */
export type StatusStage = "" | "check" | "read" | "dream" | "paint" | "picture" | "send" | "finish";
export type StatusMode = "reimagine" | "newsite" | "edit";

const COPY: Record<StatusMode, Partial<Record<StatusStage, string[]>>> = {
  reimagine: {
    check: ["Knocking on your site's door…"],
    read: ["Reading your site…", "Hunting down your best photos…", "Taking notes on what you do best…", "Checking which photos are sharp enough…"],
    dream: ["Sketching three fresh looks…", "Pairing fonts and colors…", "Writing headlines that sound like you…"],
    paint: ["Painting your homepages…", "Grok Imagine is drawing your custom design…", "Placing your photos just so…", "Polishing the details…"],
    picture: ["Snapping a picture of your look…"],
    send: ["Sending it your way…"],
    finish: ["Building every page in this look…", "Polishing the details…"],
  },
  newsite: {
    read: ["Getting to know your business…", "Unpacking your logo and notes…"],
    dream: ["Sketching three fresh looks for your new site…", "Writing your first headlines…", "Pairing fonts and colors…"],
    paint: ["Grok Imagine is painting your art…", "Building your homepages…", "Polishing the details…"],
    picture: ["Snapping a picture of your look…"],
    send: ["Sending it your way…"],
    finish: ["Building every page in this look…", "Polishing the details…"],
  },
  edit: {
    "": ["Reading your change…", "Making that change…", "Polishing the details…"],
    dream: ["Trying a few takes on your change…"],
    paint: ["Repainting this look…", "Polishing the details…"],
  },
};

export function statusLines(mode: StatusMode, stage: StatusStage): string[] {
  return COPY[mode][stage] ?? COPY[mode][""] ?? COPY.reimagine[stage] ?? ["Working on it…"];
}

/** The ring's fill: elapsed / the rolling average, never past 95% until the work is really done. */
export function ringFraction(elapsedMs: number, averageMs: number): number {
  if (!(averageMs > 0)) return 0;
  return Math.max(0, Math.min(0.95, elapsedMs / averageMs));
}
