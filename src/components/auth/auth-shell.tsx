import Link from "next/link";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-secondary/30">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link href="/" className="mb-8 flex items-center gap-2 font-semibold text-foreground">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            WC
          </span>
          <span className="text-lg tracking-tight">WealthCircle</span>
        </Link>

        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}
