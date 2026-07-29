import Link from "next/link";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-secondary/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              WC
            </span>
            <span className="text-lg tracking-tight">WealthCircle</span>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
