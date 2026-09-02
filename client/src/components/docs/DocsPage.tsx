import { useState } from "react";
import { Sun, Moon, ArrowLeft, ArrowRight, Menu } from "lucide-react";
import { useTheme } from "@/hooks/use-theme.tsx";
import { Logo } from "@/components/shell/Logo.tsx";
import { DOCS_GROUPS, DOCS_PAGES } from "./docs-content.tsx";

interface Props {
  /** Back to the marketing page. */
  onBack: () => void;
  /** Opens the app shell, same as the landing header's CTA. */
  onLaunch: () => void;
}

/**
 * Documentation — a standalone public page laid out the way a docs site
 * is: persistent sidebar of grouped topics on the left, one topic in the
 * content pane, previous/next at the foot of each page.
 *
 * Topics live in `docs-content.tsx`; this file is only the shell, so
 * adding a page never means touching the layout. The sidebar collapses
 * behind a toggle under `lg`, where there isn't room for a fixed column.
 */
export function DocsPage({ onBack, onLaunch }: Props) {
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const [activeId, setActiveId] = useState(DOCS_PAGES[0].id);
  const [navOpen, setNavOpen] = useState(false);

  const index = DOCS_PAGES.findIndex((p) => p.id === activeId);
  const active = DOCS_PAGES[index] ?? DOCS_PAGES[0];
  const prev = index > 0 ? DOCS_PAGES[index - 1] : null;
  const next = index < DOCS_PAGES.length - 1 ? DOCS_PAGES[index + 1] : null;

  const go = (id: string) => {
    setActiveId(id);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <header className="flex items-center gap-3 border-b border-border-soft px-5 sm:px-8 py-4">
        <button
          type="button"
          onClick={() => {
            setNavOpen((v) => !v);
          }}
          aria-label="Toggle documentation navigation"
          aria-expanded={navOpen}
          className="h-9 w-9 inline-flex shrink-0 items-center justify-center rounded-md border border-border-soft text-text-dim hover:text-text transition-colors lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-2.5 cursor-pointer"
          aria-label="Back to home"
        >
          <Logo size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Mantua</span>
        </button>
        <span className="hidden shrink-0 items-center gap-2 sm:inline-flex">
          <span className="h-3.5 w-px bg-border-soft" aria-hidden="true" />
          <span className="text-[13px] text-text-dim">Docs</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle theme"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim hover:text-text transition-colors"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLaunch}
            className="px-4 py-2 rounded-md bg-accent text-white text-[13px] font-semibold hover:bg-accent-2 transition-colors cursor-pointer"
          >
            Launch App
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Documentation"
          className={`${
            navOpen ? "block" : "hidden"
          } shrink-0 border-b border-border-soft px-5 py-6 sm:px-8 lg:block lg:w-60 lg:border-b-0 lg:border-r lg:px-5`}
        >
          <div className="lg:sticky lg:top-6 space-y-6">
            {DOCS_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-mute">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.pages.map((p) => {
                    const isActive = p.id === active.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            go(p.id);
                          }}
                          aria-current={isActive ? "page" : undefined}
                          className={`w-full rounded-xs px-2 py-1.5 text-left text-[13.5px] transition-colors cursor-pointer ${
                            isActive
                              ? "bg-accent/10 font-medium text-accent"
                              : "text-text-dim hover:bg-bg-elev hover:text-text"
                          }`}
                        >
                          {p.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-5 py-10 sm:px-8 lg:px-10">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </button>

          <article className="mt-6 max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{active.title}</h1>
            <p className="mt-3 text-[14px] text-text-mute">{active.summary}</p>
            <div className="mt-8 space-y-4">{active.body}</div>
          </article>

          <div className="mt-14 max-w-2xl grid gap-3 sm:grid-cols-2">
            {prev ? (
              <button
                type="button"
                onClick={() => {
                  go(prev.id);
                }}
                className="rounded-md border border-border-soft px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-bg-elev cursor-pointer"
              >
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-mute">
                  <ArrowLeft className="h-3 w-3" /> Previous
                </span>
                <span className="mt-1 block text-[14px] font-medium text-text">{prev.title}</span>
              </button>
            ) : (
              <span />
            )}
            {next && (
              <button
                type="button"
                onClick={() => {
                  go(next.id);
                }}
                className="rounded-md border border-border-soft px-4 py-3 text-right transition-colors hover:border-accent/50 hover:bg-bg-elev cursor-pointer sm:col-start-2"
              >
                <span className="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-wider text-text-mute">
                  Next <ArrowRight className="h-3 w-3" />
                </span>
                <span className="mt-1 block text-[14px] font-medium text-text">{next.title}</span>
              </button>
            )}
          </div>
        </main>
      </div>

      <footer className="border-t border-border-soft px-5 sm:px-8 py-8">
        <p className="text-[11px] text-text-mute text-center">
          © 2026 Mantua Intelligence. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
