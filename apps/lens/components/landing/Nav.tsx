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
    <nav className="sticky top-0 z-30 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
      <div className="flex items-center gap-8">
        <Logo />
        <div className="hidden items-center gap-6 lg:flex">
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
      </div>
      <div className="flex items-center gap-3">
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
    </nav>
  );
}
