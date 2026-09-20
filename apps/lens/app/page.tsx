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
    </main>
  );
}
