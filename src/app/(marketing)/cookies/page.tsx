import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { COOKIE_POLICY } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return <LegalPage doc={COOKIE_POLICY} />;
}
