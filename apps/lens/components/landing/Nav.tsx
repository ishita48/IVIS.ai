import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/product/ThemeToggle";

const LINKS = [
  { href: "#why", label: "Why LENS" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#why", label: "Features" },
  { href: "#collaboration", label: "Collaboration" },
  { href: "#teachers", label: "For Teachers" },
];

export function Nav() {
  return (
    <nav className="sticky top-0 z-30 w-full border-b border-white/50 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center px-6 py-4 sm:px-10">
        <Logo />

        <div className="hidden items-center justify-center gap-10 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-[13.5px] font-medium text-ink-400 transition hover:text-ink-100"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href="/sign-in" className="text-[13.5px] font-medium text-ink-400 transition hover:text-ink-100">
            Sign in
          </Link>
          <Link
            href="/app"
            className="flex items-center gap-1.5 rounded-full bg-signal px-4 py-2 text-[13.5px] font-semibold text-white shadow-glow transition hover:bg-signal-deep"
          >
            Get started
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
