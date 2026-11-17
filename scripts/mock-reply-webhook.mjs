#!/usr/bin/env node
/**
 * Stand-in for Email Bot's instant-reply webhook, for tests. Checks the Authorization header and the payload,
 * records every request to MOCK_WEBHOOK_LOG (JSON lines). Never a real endpoint; never sends email.
 *
 *   MOCK_WEBHOOK_PORT=9998 EXPECT_AUTH="Bearer test-key" MOCK_WEBHOOK_FAIL_FIRST=500 node scripts/mock-reply-webhook.mjs
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.MOCK_WEBHOOK_PORT ?? 9998);
const expectAuth = process.env.EXPECT_AUTH ?? "";
const log = process.env.MOCK_WEBHOOK_LOG ?? "/tmp/mock-reply-webhook.jsonl";
let failFirst = Number(process.env.MOCK_WEBHOOK_FAIL_FIRST ?? 0);
const FIELDS = ["submission_id", "email", "website", "note", "preview_url", "preview_pages", "chosen_look", "change_requests", "picture_url", "picture_error", "submitted_at"];

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const problems = [];
    if (req.method !== "POST") problems.push(`method ${req.method}`);
    if (!/^application\/json/.test(req.headers["content-type"] ?? "")) problems.push("content-type is not JSON");
    const authOk = !expectAuth || req.headers.authorization === expectAuth;
    if (!authOk) problems.push("wrong Authorization header");
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      problems.push("body is not JSON");
    }
    if (json) {
      for (const f of FIELDS) if (typeof json[f] !== "string") problems.push(`${f} missing or not a string`);
      const extra = Object.keys(json).filter((k) => !FIELDS.includes(k));
      if (extra.length) problems.push(`unexpected fields: ${extra.join(",")}`);
      if (json.submitted_at && Number.isNaN(Date.parse(json.submitted_at))) problems.push("submitted_at is not a date");
    }
    // The header itself is never written to the log; only whether it matched.
    const entry = { at: new Date().toISOString(), authOk, idempotencyKey: req.headers["idempotency-key"] ?? "", problems, payload: json };
    let status = problems.length ? (authOk ? 422 : 401) : 200;
    if (!problems.length && failFirst > 0) {
      status = failFirst;
      failFirst = 0;
    }
    entry.status = status;
    appendFileSync(log, JSON.stringify(entry) + "\n");
    console.log(`[mock-webhook] ${status} ${json?.submission_id ?? "-"} ${problems.join("; ")}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: status === 200, problems }));
  });
}).listen(port, () => console.log(`[mock-webhook] listening on http://localhost:${port}/hook`));
