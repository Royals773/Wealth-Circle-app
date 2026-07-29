import { Hero } from "@/components/marketing/hero";
import { ProductExplanation } from "@/components/marketing/product-explanation";
import { Features } from "@/components/marketing/features";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { WhoItsFor } from "@/components/marketing/who-its-for";
import { SecuritySection } from "@/components/marketing/security-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { CtaSection } from "@/components/marketing/cta-section";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProductExplanation />
      <Features />
      <HowItWorks />
      <WhoItsFor />
      <SecuritySection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
