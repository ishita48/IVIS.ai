import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/Logo";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-signal/[0.08] blur-[120px]" />
      <div className="pointer-events-none absolute -left-20 bottom-20 size-[350px] rounded-full bg-signal-deep/[0.07] blur-[80px]" />
      <div className="pointer-events-none absolute -right-20 top-20 size-[300px] rounded-full bg-signal/[0.05] blur-[80px]" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint bg-[size:48px_48px] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="relative z-10 flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <Logo className="scale-150" />
          <p className="text-sm text-ink-400 mt-2">Create your study workspace</p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
