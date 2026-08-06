import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { TERMS_OF_USE } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return <LegalPage doc={TERMS_OF_USE} />;
}
