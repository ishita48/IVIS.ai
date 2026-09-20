import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { WhyLens } from "@/components/landing/WhyLens";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Collaboration } from "@/components/landing/Collaboration";
import { TeacherSection } from "@/components/landing/TeacherSection";
import { FinalCta } from "@/components/landing/FinalCta";

export default function Landing() {
  return (
    <main className="min-h-screen app-canvas">
      <Nav />
      <Hero />
      <WhyLens />
      <HowItWorks />
      <Collaboration />
      <TeacherSection />
      <FinalCta />
      <footer className="border-t border-white/50 px-6 py-8 text-center text-[12px] text-ink-500">
        LENS · HackMIT 2026
      </footer>
    </main>
  );
}
