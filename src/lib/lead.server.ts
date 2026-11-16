import net from "node:net";
import tls from "node:tls";
import { getRequestIP } from "@tanstack/react-start/server";

const FROM = "marketing@reimago.ai";
const TO = "marketing@reimago.ai";
const MX = "onesite-com.mail.protection.outlook.com";
const hits = new Map<string, number[]>();

export type LeadInput = {
  url: string;
  email: string;
  notes: string;
};

export type LeadResult = { ok: true } | { ok: false; error: string };

function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < 60 * 60 * 1000);
  if (recent.length >= 6) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function readCode(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      socket.off("data", onData);
      reject(new Error("The mail server did not answer."));
    }, 12000);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last || !/^\d{3} /.test(last)) return;
      clearTimeout(timer);
      socket.off("data", onData);
      const code = Number(last.slice(0, 3));
      if (code >= 400) reject(new Error(last));
      else resolve(last);
    };
    socket.on("data", onData);
  });
}

async function command(socket: net.Socket, line: string): Promise<string> {
  socket.write(`${line}\r\n`);
  return readCode(socket);
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}

function messageBody(input: { email: string; website: string; notes: string; name?: string; previewUrl?: string }): string {
  const lines = [input.email, "", `Website: ${input.website}`];
  if (input.name) lines.push(`Name: ${input.name}`);
  lines.push(`What should change: ${input.notes || "(not specified)"}`);
  if (input.previewUrl) lines.push("", `Live preview: ${input.previewUrl}`);
  return lines.join("\n");
}

async function deliver(input: {
  email: string;
  website: string;
  notes: string;
  name?: string;
  previewUrl?: string;
}): Promise<void> {
  const subject = hostLabel(input.website).replace(/[\r\n]+/g, "").slice(0, 120);
  const text = messageBody(input);
  const plain = net.connect(25, MX);
  const banner = readCode(plain);
  await new Promise<void>((resolve, reject) => {
    plain.once("connect", () => resolve());
    plain.once("error", reject);
  });
  await banner;
  await command(plain, "EHLO reimago.ai");
  await command(plain, "STARTTLS");
  const socket = tls.connect({ socket: plain, servername: MX });
  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", () => resolve());
    socket.once("error", reject);
  });
  await command(socket, "EHLO reimago.ai");
  await command(socket, `MAIL FROM:<${FROM}>`);
  await command(socket, `RCPT TO:<${TO}>`);
  await command(socket, "DATA");

  const headers = [
    `From: Reimago <${FROM}>`,
    `To: ${TO}`,
    `Reply-To: ${input.email.replace(/[\r\n]+/g, "")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  headers.push("Content-Type: text/plain; charset=utf-8");
  const payload = [...headers, "", text, "."].join("\r\n");
  socket.write(`${dotStuff(payload)}\r\n`);
  await readCode(socket);
  await command(socket, "QUIT");
  socket.end();
}
function hostLabel(url: string): string {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProto).hostname.replace(/^www\./i, "") || "website";
  } catch {
    return "website";
  }
}

async function guarded(): Promise<LeadResult | null> {
  let ip = "anonymous";
  try {
    ip = getRequestIP({ xForwardedFor: true }) ?? "anonymous";
  } catch {
    ip = "anonymous";
  }
  if (limited(ip)) return { ok: false, error: "Too many notes from this network in the last hour." };
  return null;
}

export async function sendLead(input: LeadInput): Promise<LeadResult> {
  void input;
  return { ok: false, error: "Submit the form from the page." };
}

/** Email the lead with a link to the live preview (no picture attachment any more). */
export async function sendPreviewLink(input: {
  email: string;
  website: string;
  notes: string;
  name: string;
  previewUrl: string;
}): Promise<LeadResult> {
  const blocked = await guarded();
  if (blocked) return blocked;
  const email = input.email.replace(/[\r\n]+/g, "").slice(0, 200);
  const website = input.website.replace(/[\r\n]+/g, " ").slice(0, 300);
  const notes = input.notes.replace(/\r/g, "").slice(0, 800);
  const name = input.name.replace(/[\r\n]+/g, " ").slice(0, 120);
  const previewUrl = /^https?:\/\/\S+$/.test(input.previewUrl) ? input.previewUrl.slice(0, 400) : "";
  try {
    await deliver({ email, website, notes, name, previewUrl });
    return { ok: true };
  } catch {
    return { ok: false, error: "The preview link could not be emailed." };
  }
}
