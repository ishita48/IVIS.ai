"use client";

import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/product/ThemeToggle";
import { PersonaBadge } from "@/components/product/PersonaBadge";

export function TeacherTopBar() {
  return (
    <header className="flex h-[49px] shrink-0 items-center gap-3 border-b border-ink-800/10 px-3 glass-raise">
      <Logo />
      <span className="hidden text-[12px] text-ink-500 md:block">Teacher dashboard</span>
      <div className="flex-1" />
      <PersonaBadge />
      <ThemeToggle />
      <UserButton />
    </header>
  );
}
