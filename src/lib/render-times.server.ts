/**
 * Round 10 — how long renders really take, kept server-side so the progress ring can fill by elapsed / average.
 * Three kinds, averaged separately: round 1 of a Reimagine ("round1"), a card edit ("edit"), and Build a New Site
 * ("newsite"). A rolling average of the last 20 finished renders (stopped or failed ones are not counted).
 * Postgres (`render_times`) when DATABASE_URL is set, else a JSON file in PREVIEW_STORE_DIR.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RenderKind = "round1" | "edit" | "newsite";
export const RENDER_KINDS: RenderKind[] = ["round1", "edit", "newsite"];
/** Until there is history: about what each takes today. */
export const DEFAULT_MS: Record<RenderKind, number> = { round1: 95_000, edit: 25_000, newsite: 80_000 };
const KEEP = 20;
const DIR = process.env.PREVIEW_STORE_DIR?.trim() || join(tmpdir(), "reimago-pages");
const FILE = join(DIR, "render-times.json");

/** The rolling average (ms) of the last KEEP samples; the default with no history. */
export function rollingAverage(samples: number[], kind: RenderKind): number {
  const recent = samples.filter((n) => Number.isFinite(n) && n > 0).slice(-KEEP);
  if (!recent.length) return DEFAULT_MS[kind];
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

let tableReady: Promise<void> | null = null;
async function table() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  tableReady ??= sql
    .query("create table if not exists render_times (id bigserial primary key, kind text not null, ms integer not null, at timestamptz not null default now())")
    .then(() => undefined)
    .catch((error) => {
      tableReady = null;
      throw error;
    });
  await tableReady;
  return sql;
}
const hasDatabase = () => Boolean(process.env.DATABASE_URL?.trim());

async function readFileStore(): Promise<Record<string, number[]>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, number[]>;
  } catch {
    return {};
  }
}

export async function recentRenderTimes(kind: RenderKind): Promise<number[]> {
  try {
    if (hasDatabase()) {
      const sql = await table();
      const rows = await sql<{ ms: number }>`select ms from render_times where kind = ${kind} order by id desc limit ${KEEP}`;
      return rows.map((r) => Number(r.ms)).reverse();
    }
    return (await readFileStore())[kind] ?? [];
  } catch {
    return [];
  }
}

export async function addRenderTime(kind: RenderKind, ms: number): Promise<void> {
  if (hasDatabase()) {
    const sql = await table();
    await sql`insert into render_times (kind, ms) values (${kind}, ${Math.round(ms)})`;
    return;
  }
  const all = await readFileStore();
  all[kind] = [...(all[kind] ?? []), Math.round(ms)].slice(-KEEP);
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(all), "utf8");
}
