import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { authorizationFor, replyWebhookConfig, sendReplyWebhook, submissionId, type ReplyPayload } from "./reply-webhook.server.ts";

// A local stand-in for Email Bot's webhook: records headers and bodies, answers with queued statuses.
let server: Server;
let base = "";
let seen: { auth?: string; idem?: string; type?: string; body: unknown }[] = [];
let statuses: number[] = [];
let hang = false;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, idem: String(req.headers["idempotency-key"] ?? ""), type: req.headers["content-type"], body: JSON.parse(body) });
      if (hang) return; // never answers: the client must time out
      res.writeHead(statuses.shift() ?? 200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  base = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});
after(() => server.close());
beforeEach(() => {
  seen = [];
  statuses = [];
  hang = false;
  process.env.REPLY_WEBHOOK_URL = `${base}/hook`;
  process.env.REPLY_WEBHOOK_KEY = "test-key-not-a-secret";
});

const payload: ReplyPayload = {
  submission_id: submissionId("0123456789abcdef", "dark-premium"),
  email: "bob@example.com",
  website: "bob.me",
  note: "Keep the rocket",
  preview_url: "https://reimago.ai/made/0123456789abcdef/",
  preview_pages: "Home: https://reimago.ai/made/0123456789abcdef/\nAbout: https://reimago.ai/made/0123456789abcdef/about",
  chosen_look: "Midnight Pressure (Dark premium)",
  change_requests: "1. more blue",
  picture_url: "https://reimago.ai/made/0123456789abcdef/img/capture",
  picture_error: "",
  submitted_at: "2026-11-16T22:30:00.000Z",
};

describe("reply webhook", () => {
  it("posts the JSON payload with Bearer auth and the dedupe id", async () => {
    const result = await sendReplyWebhook(payload);
    assert.deepEqual(result, { sent: true, status: 200, attempts: 1 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.auth, "Bearer test-key-not-a-secret");
    assert.match(seen[0]!.type ?? "", /^application\/json/);
    assert.equal(seen[0]!.idem, "reimago-0123456789abcdef-dark-premium");
    assert.deepEqual(seen[0]!.body, payload);
  });

  it("sends a key that already names its scheme as-is", async () => {
    assert.equal(authorizationFor("Bearer abc.def"), "Bearer abc.def");
    assert.equal(authorizationFor("Basic dXNlcjpwYXNz"), "Basic dXNlcjpwYXNz");
    assert.equal(authorizationFor("  abc123  "), "Bearer abc123");
    assert.equal(authorizationFor("sk_live:abc"), "Bearer sk_live:abc");
    process.env.REPLY_WEBHOOK_KEY = "Basic dXNlcjpwYXNz";
    await sendReplyWebhook(payload);
    assert.equal(seen[0]!.auth, "Basic dXNlcjpwYXNz");
  });

  it("skips silently when either setting is missing (or the URL is not https)", async () => {
    delete process.env.REPLY_WEBHOOK_KEY;
    assert.deepEqual(await sendReplyWebhook(payload), { sent: false, skipped: true, attempts: 0 });
    process.env.REPLY_WEBHOOK_KEY = "k";
    delete process.env.REPLY_WEBHOOK_URL;
    assert.deepEqual(await sendReplyWebhook(payload), { sent: false, skipped: true, attempts: 0 });
    process.env.REPLY_WEBHOOK_URL = "http://example.com/hook";
    assert.equal(replyWebhookConfig(), undefined, "plain http only for localhost tests");
    assert.equal(seen.length, 0);
  });

  it("retries once on a 5xx, not on a 4xx", async () => {
    statuses = [502, 200];
    assert.deepEqual(await sendReplyWebhook(payload), { sent: true, status: 200, attempts: 2 });
    assert.equal(seen.length, 2);
    assert.equal((seen[0]!.body as ReplyPayload).submission_id, (seen[1]!.body as ReplyPayload).submission_id, "the retry is the same submission");
    seen = [];
    statuses = [401];
    assert.deepEqual(await sendReplyWebhook(payload), { sent: false, status: 401, attempts: 1 });
    assert.equal(seen.length, 1);
    statuses = [500, 503];
    assert.deepEqual(await sendReplyWebhook(payload), { sent: false, status: 503, attempts: 2 });
  });

  it("retries once on a network error, and times out", async () => {
    process.env.REPLY_WEBHOOK_URL = "http://localhost:9/hook"; // nothing listens there
    const down = await sendReplyWebhook(payload);
    assert.equal(down.sent, false);
    assert.equal(down.attempts, 2);
    assert.equal(down.error, "network error");
    process.env.REPLY_WEBHOOK_URL = `${base}/hook`;
    hang = true;
    const started = Date.now();
    const slow = await sendReplyWebhook(payload, { timeoutMs: 300 });
    assert.equal(slow.error, "timed out after 0s");
    assert.equal(slow.attempts, 2);
    assert.ok(Date.now() - started < 3000);
  });

  it("never logs the key", async () => {
    const lines: string[] = [];
    const orig = [console.info, console.warn, console.error, console.log];
    console.info = console.warn = console.error = console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      await sendReplyWebhook(payload);
      statuses = [500, 500];
      await sendReplyWebhook(payload);
    } finally {
      [console.info, console.warn, console.error, console.log] = orig;
    }
    assert.ok(lines.length >= 3);
    assert.ok(lines.some((l) => /sent .* 200/.test(l)) && lines.some((l) => /failed: 500/.test(l)));
    assert.ok(!lines.some((l) => l.includes("test-key-not-a-secret") || l.includes("/hook")), "no key, no path");
  });

  it("the dedupe id is stable for the same chosen look and differs between looks", () => {
    assert.equal(submissionId("0123456789abcdef", "dark-premium"), submissionId("0123456789abcdef", "dark-premium"));
    assert.equal(submissionId("0123456789abcdef", "Dark Premium"), "reimago-0123456789abcdef-dark-premium");
    assert.notEqual(submissionId("0123456789abcdef", "dark-premium"), submissionId("fedcba9876543210", "dark-premium"));
  });
});
