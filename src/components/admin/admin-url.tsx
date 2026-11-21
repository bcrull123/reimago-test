import { useState } from "react";

/** Shared "copy this private admin address" card, used on first-run setup and in Settings. */
export function AdminUrlCard({ url, heading }: { url: string; heading: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is still selectable */
    }
  }
  return (
    <div className="rounded-lg border border-brand/40 bg-brand-wash px-4 py-3" data-setup-save>
      <p className="text-sm font-medium text-ink">{heading}</p>
      <p className="mt-2 break-all font-mono text-sm text-fg" data-admin-url>
        {url}
      </p>
      <button type="button" onClick={() => void copy()} data-copy-admin-url className="mt-3 h-10 rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:bg-brand-hover">
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
}
