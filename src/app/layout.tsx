import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { cn } from "@/lib/utils";

// Warm, rounder humanist letterforms than Geist while staying highly
// legible, with proper tabular figures (font-variant-numeric:
// tabular-nums, applied per element via Tailwind's tabular-nums
// utility) for financial amounts. Full weight range for the type
// scale: 400/500 body and labels, 600/700 headings, 800 display.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "WealthCircle — Manage your group's savings, loans and decisions",
    template: "%s | WealthCircle",
  },
  description:
    "WealthCircle helps community savings groups, susu circles, investment clubs and associations manage contributions, loans and decisions with clarity, accountability and confidence. WealthCircle never holds your group's money.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistMono.variable, "font-sans", manrope.variable)}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
