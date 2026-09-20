import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { WhyLens } from "@/components/landing/WhyLens";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { InteractiveDemo } from "@/components/landing/InteractiveDemo";
import { Collaboration } from "@/components/landing/Collaboration";
import { TeacherSection } from "@/components/landing/TeacherSection";
import { FinalCta } from "@/components/landing/FinalCta";

export default function Landing() {
  return (
    <main className="min-h-screen wave-canvas">
      <Nav />
      <Hero />
      <WhyLens />
      <HowItWorks />
      <InteractiveDemo />
      <Collaboration />
      <TeacherSection />
      <FinalCta />
    </main>
  );
}
