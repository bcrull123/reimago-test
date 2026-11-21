import { DOMAIN_TOKEN_ENV_NAMES, parseTldList } from "./domain-config.ts";
export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience, gate endpoints and connector-token semantics all
 * key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}

let keysLogged = false;
/**
 * Round 9b: one server log line per server instance saying which keys are present — true/false only, never a
 * value — so a workspace preview can be told from the published app.
 */
export function logKeyPresenceOnce(): void {
  if (keysLogged) return;
  keysLogged = true;
  const has = (k: string) => (env(k) ? "true" : "false");
  console.info(
    `[env] keys present (true/false only): XAI_API_KEY=${has("XAI_API_KEY")} SERPER_API_KEY=${has("SERPER_API_KEY")} ` +
      `REPLY_WEBHOOK_URL=${has("REPLY_WEBHOOK_URL")} REPLY_WEBHOOK_KEY=${has("REPLY_WEBHOOK_KEY")} PHOTO_SEARCH_PROXY=${env("PHOTO_SEARCH_PROXY_URL") && env("PHOTO_SEARCH_PROXY_KEY") ? "true" : "false"} · ` +
      `DOMAIN_CHECK=${DOMAIN_TOKEN_ENV_NAMES.some((name) => env(name)) ? "true" : "false"} DOMAIN_TLDS=${parseTldList(env("DOMAIN_TLDS")).join(",")}${env("DOMAIN_TLDS") ? "(env)" : "(default)"} · ` +
      `ADMIN_PATH=${has("ADMIN_PATH")} ADMIN_PASSWORD=${has("ADMIN_PASSWORD")} ADMIN_SESSION_SECRET=${has("ADMIN_SESSION_SECRET")} SETUP_CODE=${has("SETUP_CODE")} FORMCARRY_API_KEY=${has("FORMCARRY_API_KEY")} LEADS_STORE=${env("DATABASE_URL") ? "postgres(DATABASE_URL)" : "memory(no DATABASE_URL)"} · ` +
      `running as: ${isWorkspacePreview() ? "workspace preview" : "published app"}`,
  );
}
