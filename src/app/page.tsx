import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArchitectureSection } from "@/components/landing/ArchitectureSection";
import { CtaSection } from "@/components/landing/CtaSection";
import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { HeroSection } from "@/components/landing/HeroSection";
import { StatsSection } from "@/components/landing/StatsSection";
import { TrustSection } from "@/components/landing/TrustSection";
import { UseCaseSection } from "@/components/landing/UseCaseSection";
import { WorkflowSection } from "@/components/landing/WorkflowSection";
import { auth } from "@/lib/auth/server";

export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/workspace");

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink transition-colors duration-200 ease-out">
      <Header />

      <main className="min-h-[70vh]">
        <HeroSection />
        <StatsSection />
        <UseCaseSection />
        <WorkflowSection />
        <ArchitectureSection />
        <TrustSection />
        <CtaSection />
      </main>

      <Footer year={new Date().getFullYear()} />
    </div>
  );
}