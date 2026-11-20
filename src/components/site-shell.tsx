import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BRAND, brandNameParts } from "@/lib/brand";

export function Wordmark({ className = "size-[250px]" }: { className?: string }) {
  return (
    <img
      src="/reimago-logo.png"
      alt="reimago.ai"
      width={250}
      height={250}
      className={className}
    />
  );
}

const linkClass = "rounded-md px-3 py-2 text-sm text-white/80 hover:text-accent";

export function SiteShell({ children }: { children: ReactNode }) {
  const { head, mark } = brandNameParts();
  return (
    <div className="min-h-screen bg-bg text-fg" style={{ ["--brand" as string]: BRAND.color } as CSSProperties}>
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-white sm:text-xl" data-site-header-brand>
            {BRAND.logoUrl ? (
              <img src={BRAND.logoUrl} alt="" width={120} height={36} className="h-8 w-auto max-h-9 max-w-[9rem] object-contain object-left sm:h-9" />
            ) : null}
            <span>
              {head}
              {mark ? <span className="text-accent">{mark}</span> : null}
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to="/" hash="how-it-works" className={linkClass}>
              How it works
            </Link>
            <Link to="/terms" className={linkClass}>
              Legal
            </Link>
            <a href="mailto:sales@reimago.ai" className={linkClass}>
              Contact
            </a>
          </nav>
        </div>
        <div className="h-1 bg-primary" />
      </header>
      {children}
      <footer className="border-t-4 border-accent bg-bg">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-4">
            <Wordmark className="h-28 w-auto" />
            <p className="max-w-sm text-sm text-muted">
              Reimago is for brands, agencies, and anyone ready to rebuild. Twenty years in Oklahoma City. Now we
              reimagine the site in front of you.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-eyebrow text-faint">Legal notices</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link to="/terms" className="text-muted hover:text-fg">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-muted hover:text-fg">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/operator-terms" className="text-muted hover:text-fg">
                  Operator Terms
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-eyebrow text-faint">We want to hear from you</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>
                <a href="mailto:sales@reimago.ai" className="hover:text-fg">
                  sales@reimago.ai
                </a>
              </li>
              <li>
                <a href="tel:+14057535300" className="hover:text-fg">
                  (405) 753-5300
                </a>
              </li>
              <li>Help: (405) 753-5300 x102</li>
              <li className="max-w-64 leading-snug">
                14000 Quail Springs Parkway, Suite 3600, Oklahoma City, OK 73134 U.S.A.
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© 2006–2026 Reimago, Inc. All rights reserved.</p>
            <p>REIMAGO, Inc., a subsidiary of Catalog.com, Inc.</p>
            <p data-build-stamp className="font-mono text-[10px] text-faint">Build {typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "dev"}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
