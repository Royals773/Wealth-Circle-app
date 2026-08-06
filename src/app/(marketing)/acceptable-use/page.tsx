import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { ACCEPTABLE_USE_POLICY } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function AcceptableUsePage() {
  return <LegalPage doc={ACCEPTABLE_USE_POLICY} />;
}
