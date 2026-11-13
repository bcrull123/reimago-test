import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/site-shell";

export const Route = createFileRoute("/looks")({
  component: LooksPage,
});

const LOOKS = [
  ["Editorial", "/looks/editorial.jpg"],
  ["Dark", "/looks/dark.jpg"],
  ["Product", "/looks/product.jpg"],
  ["Steps", "/looks/steps.jpg"],
] as const;

function LooksPage() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-3xl text-ink">Looks to review</h1>
          <Link to="/" className="text-sm text-primary">
            Back
          </Link>
        </div>
        {LOOKS.map(([name, src]) => (
          <figure key={name} className="space-y-2">
            <figcaption className="text-sm font-medium text-fg">{name}</figcaption>
            <img src={src} alt={name} className="w-full rounded-xl border border-border" />
          </figure>
        ))}
      </main>
    </SiteShell>
  );
}
