/**
 * Test helper: lets `node --experimental-strip-types` import server modules that use the app's "@/..." alias
 * (e.g. src/lib/preview/scrape.server.ts). Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = join(root, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
