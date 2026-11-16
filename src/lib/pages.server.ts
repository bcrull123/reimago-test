import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredSite } from "@/lib/preview/render";

/**
 * Storage for hosted pages under /made/$id.
 *
 * - Legacy single HTML pages: `<id>.html` files (unchanged).
 * - Live preview sites (multi-page): one JSON record per site. Stored in
 *   Postgres (`preview_sites`, created on first use) when DATABASE_URL is set, otherwise as `<id>.json` files in PREVIEW_STORE_DIR
 *   (default: the OS temp dir). Use DATABASE_URL (or a persistent
 *   PREVIEW_STORE_DIR) in production so preview links survive restarts and
 *   work across serverless instances.
 */
const DIR = process.env.PREVIEW_STORE_DIR?.trim() || join(tmpdir(), "reimago-pages");
const ID = /^[a-f0-9]{16}$/;

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

let tableReady: Promise<void> | null = null;

/**
 * The preview_sites table is created lazily (only on the DATABASE_URL path) instead of via
 * migrations/, so the PGLite preview and the app-builder migration invariants stay untouched.
 */
async function previewTable() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  tableReady ??= sql
    .query(
      "create table if not exists preview_sites (id text primary key, host text not null default '', data jsonb not null, created_at timestamptz not null default now())",
    )
    .then(() => undefined)
    .catch((error) => {
      tableReady = null;
      throw error;
    });
  await tableReady;
  return sql;
}

export function newPageId(): string {
  return randomBytes(8).toString("hex");
}

export async function savePage(html: string): Promise<string> {
  const id = newPageId();
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${id}.html`), html, "utf8");
  return id;
}

export async function readPage(id: string): Promise<string | undefined> {
  if (!ID.test(id)) return undefined;
  try {
    return await readFile(join(DIR, `${id}.html`), "utf8");
  } catch {
    return undefined;
  }
}

export async function saveSite(site: StoredSite): Promise<void> {
  if (!ID.test(site.id)) throw new Error("Bad preview id.");
  if (hasDatabase()) {
    const sql = await previewTable();
    await sql`insert into preview_sites (id, host, data) values (${site.id}, ${site.host}, ${JSON.stringify(site)}::jsonb)
      on conflict (id) do update set data = excluded.data, host = excluded.host`;
    return;
  }
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${site.id}.json`), JSON.stringify(site), "utf8");
}

export async function readSite(id: string): Promise<StoredSite | undefined> {
  if (!ID.test(id)) return undefined;
  try {
    if (hasDatabase()) {
      const sql = await previewTable();
      const rows = await sql<{ data: StoredSite | string }>`select data from preview_sites where id = ${id}`;
      const data = rows[0]?.data;
      if (!data) return undefined;
      return typeof data === "string" ? (JSON.parse(data) as StoredSite) : data;
    }
    const raw = await readFile(join(DIR, `${id}.json`), "utf8");
    const site = JSON.parse(raw) as StoredSite;
    return site?.version === 2 ? site : undefined;
  } catch {
    return undefined;
  }
}
