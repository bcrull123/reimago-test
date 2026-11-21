import assert from "node:assert/strict";
import { test } from "node:test";
import { chicagoTime, cleanFilters, cleanLeadInput, csvCell, leadsToCsv, mergePicks, newLeadId, pickNames, type Lead, type LeadPick } from "./leads.ts";

const pick = (id: string, look: string): LeadPick => ({ look_id: id, look, preview_url: `https://x.test/made/${id}`, pages: [], picked_at: "2026-11-20T15:00:00.000Z", formcarry_status: "", webhook_status: "" });

test("cleanLeadInput keeps good fields, drops bad ones and never trusts a link scheme", () => {
  const id = newLeadId();
  assert.match(id, /^[a-f0-9]{24}$/);
  const lead = cleanLeadInput({
    id, mode: "new_site", email: " Bob@Example.com ", name: "Joe's", logo_url: "javascript:alert(1)", chosen_domain: "joes-pizza.com", domain_status: "selected_not_registered",
    extras: { phone: "555", "bad key!": "x", pages: ["Home", "Menu"] }, pick: { look_id: "0123456789abcdef", look: "Dark Premium", preview_url: "https://a.test/made/0123456789abcdef" },
    looks: [{ look_id: "0123456789abcdef", name: "Dark Premium", url: "/made/0123456789abcdef" }, { name: "" }],
  });
  assert.equal(lead.id, id);
  assert.equal(lead.email, "bob@example.com");
  assert.equal(lead.logo_url, "");
  assert.equal(lead.chosen_domain, "joes-pizza.com");
  assert.deepEqual(lead.extras, { phone: "555", pages: "Home\nMenu" });
  assert.equal(lead.looks.length, 1);
  assert.equal(lead.pick.look, "Dark Premium");
});

test("cleanLeadInput makes a fresh id for a missing or malformed one and blanks a bad email", () => {
  const lead = cleanLeadInput({ id: "../../etc", email: "nope", mode: "weird" });
  assert.match(lead.id, /^[a-f0-9]{24}$/);
  assert.equal(lead.email, "");
  assert.equal(lead.mode, "reimagine");
});

test("mergePicks appends a new look and replaces a re-send of the same look without losing delivery status", () => {
  const a = pick("aaaaaaaaaaaaaaaa", "Dark");
  const b = pick("bbbbbbbbbbbbbbbb", "Light");
  const two = mergePicks(mergePicks([], a), b);
  assert.equal(two.length, 2);
  const withStatus = two.map((p) => (p === two[0] ? { ...p, formcarry_status: "sent 200" } : p));
  const again = mergePicks(withStatus, { ...a, preview_url: "https://x.test/new", picked_at: "2026-11-21T00:00:00.000Z" });
  assert.equal(again.length, 2);
  assert.equal(again[0]!.preview_url, "https://x.test/new");
  assert.equal(again[0]!.formcarry_status, "sent 200");
  assert.equal(again[0]!.picked_at, "2026-11-20T15:00:00.000Z");
  assert.equal(pickNames({ picks: again }), "Dark, Light");
});

test("cleanFilters accepts only known modes, statuses and dates", () => {
  assert.deepEqual(cleanFilters({ q: " pizza ", mode: "new_site", status: "won", from: "2026-11-01", to: "tomorrow", limit: "9999" }), { q: "pizza", mode: "new_site", status: "won", from: "2026-11-01", to: "", limit: 2000 });
  assert.equal(cleanFilters({ mode: "x", status: "y" }).mode, "");
  assert.equal(cleanFilters({}).limit, 500);
});

test("csvCell quotes and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("+1 555"), "'+1 555");
  assert.equal(csvCell(null), "");
});

test("times are shown in America/Chicago", () => {
  assert.match(chicagoTime("2026-11-20T02:30:00.000Z"), /Nov 19, 2026, 8:30 PM/);
});

test("leadsToCsv has a header, one row per lead and Chicago dates", () => {
  const lead: Lead = {
    id: "a".repeat(24), created_at: "2026-11-20T18:05:00.000Z", updated_at: "2026-11-20T18:05:00.000Z", mode: "new_site", name: "Joe's", email: "j@x.com", phone: "555", source: "Joe's", what: "pizza, slices", location: "Austin", style: "",
    domain_choice: "get", chosen_domain: "joes.com", domain_status: "selected_not_registered", logo_source: "ai", logo_url: "", change_requests: ["bigger logo"], looks: [], picks: [pick("aaaaaaaaaaaaaaaa", "Dark")],
    extras: { goal: "calls" }, attribution: { utm_source: "ads" }, user_agent: "", country: "US", formcarry_status: "sent 200", webhook_status: "sent 200", lead_status: "new", notes: [{ at: "2026-11-20T19:00:00.000Z", text: "called" }],
  };
  const csv = leadsToCsv([lead]);
  const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^id,created_at_chicago,mode,status,name,email/);
  assert.match(lines[1]!, /2026-11-20 12:05,new_site,new,Joe's,j@x.com/);
  assert.match(lines[1]!, /"pizza, slices"/);
  assert.match(lines[1]!, /joes\.com,selected_not_registered/);
});
