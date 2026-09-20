import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/product/ThemeToggle";

const LINKS = [
  { href: "#why", label: "Why LENS" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#why", label: "Features" },
  { href: "#collaboration", label: "Collaboration" },
  { href: "#teachers", label: "For Teachers" },
];

const CTA_CLASS =
  "flex items-center gap-1.5 rounded-full bg-signal px-4 py-2 text-[13.5px] font-semibold text-white shadow-glow transition hover:bg-signal-deep";

export async function Nav() {
  // Resolved on the server so a signed-in student never sees the logged-out
  // CTAs flash before Clerk hydrates — that flash is what made returning to
  // the landing page feel like a forced re-login.
  const { userId } = await auth();
  const signedIn = Boolean(userId);

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
        {signedIn ? (
          <Link href="/app" className={CTA_CLASS}>
            Open workspace
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <>
            <Link href="/sign-in" className="text-[13.5px] font-medium text-ink-400 transition hover:text-ink-100">
              Sign in
            </Link>
            <Link href="/app" className={CTA_CLASS}>
              Get started
              <span aria-hidden>→</span>
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
