import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  LayoutDashboard,
  HandCoins,
  Landmark,
  Users,
  Settings,
  ScrollText,
  ArrowUpRight,
  CircleCheck,
  Info,
} from "lucide-react";
import { ThemeToggleDemo } from "@/components/styleguide/theme-toggle-demo";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Styleguide (internal, not linked)" };

const SWATCH_GROUPS: { label: string; note: string; items: { name: string; bg: string; fg: string }[] }[] = [
  {
    label: "Neutrals",
    note: "Every neutral shares one warm hue — this is where the warmth actually lives, not in saturation.",
    items: [
      { name: "background", bg: "bg-background", fg: "text-foreground" },
      { name: "card", bg: "bg-card", fg: "text-card-foreground" },
      { name: "secondary / muted", bg: "bg-muted", fg: "text-muted-foreground" },
      { name: "border", bg: "bg-border", fg: "text-foreground" },
    ],
  },
  {
    label: "Brand",
    note: "One considered warm colour — deep, muted terracotta. Restraint over saturation.",
    items: [
      { name: "primary", bg: "bg-primary", fg: "text-primary-foreground" },
      { name: "accent", bg: "bg-accent", fg: "text-accent-foreground" },
    ],
  },
  {
    label: "Semantic",
    note: "Success/warning/error nudged into the warm family; info stays a quiet, deliberately-neutral blue.",
    items: [
      { name: "success", bg: "bg-success", fg: "text-success-foreground" },
      { name: "warning", bg: "bg-warning", fg: "text-warning-foreground" },
      { name: "destructive", bg: "bg-destructive", fg: "text-destructive-foreground" },
      { name: "info", bg: "bg-info", fg: "text-info-foreground" },
    ],
  },
];

const RADII = [
  { name: "sm", cls: "rounded-sm" },
  { name: "md", cls: "rounded-md" },
  { name: "lg", cls: "rounded-lg" },
  { name: "xl", cls: "rounded-xl" },
  { name: "2xl", cls: "rounded-2xl" },
  { name: "full (pill)", cls: "rounded-4xl" },
];

const SAMPLE_ROWS = [
  { member: "Ama Owusu", date: "12 Jul 2026", amount: 25000, status: "verified" as const },
  { member: "Kwabena Boateng", date: "10 Jul 2026", amount: 25000, status: "pending" as const },
  { member: "Efua Mensah", date: "05 Jul 2026", amount: 12500, status: "overdue" as const },
];

const STATUS_STYLE: Record<string, string> = {
  verified: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  overdue: "bg-destructive/10 text-destructive",
};

export default function StyleguidePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* ---------------------------------------------------------- */}
        <header className="mb-16 flex flex-col gap-4 border-b border-border pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-medium text-primary">Design system reference — now live app-wide</p>
            <h1 className="text-4xl font-bold tracking-tight text-balance">Warm, trustworthy, human — but financial</h1>
            <p className="mt-3 max-w-2xl text-base text-muted-foreground">
              These tokens were approved in Phase 1 (scoped to a <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">.warm-preview</code> class
              for review) and have since been promoted into the shared <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">:root</code>/<code className="rounded bg-muted px-1.5 py-0.5 text-sm">.dark</code> tokens
              every page reads from — this page now just renders the same global styles as everywhere else.
              Every component below is the real, shared component from{" "}
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">src/components/ui</code>.
            </p>
          </div>
          <ThemeToggleDemo />
        </header>

        {/* ---------------------------------------------------------- */}
        <Section title="Colour" description="A warm but professional palette. Warmth comes from a consistent warm-tinted neutral hue and one considered primary — not from loud saturation.">
          <div className="space-y-10">
            {SWATCH_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <p className="text-sm text-muted-foreground">{group.note}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {group.items.map((item) => (
                    <div key={item.name} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                      <div className={cn("flex h-20 items-end p-3", item.bg, item.fg)}>
                        <span className="text-xs font-medium">Aa</span>
                      </div>
                      <div className="bg-card px-3 py-2">
                        <p className="text-xs font-medium text-card-foreground">{item.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Typography" description="A humanist sans (Manrope, proposed — see note below) with a clear, restrained hierarchy. Financial figures always use tabular numerals so amounts align in columns.">
          <div className="space-y-1 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <p className="text-4xl leading-tight font-bold tracking-tight">Display 36 / bold</p>
            <p className="pt-3 text-3xl leading-tight font-bold tracking-tight">Heading 1 · 30 / bold</p>
            <p className="pt-3 text-2xl leading-snug font-semibold">Heading 2 · 24 / semibold</p>
            <p className="pt-3 text-lg leading-snug font-semibold">Heading 3 · 18 / semibold</p>
            <p className="pt-3 text-base leading-relaxed">Body large · 16 / regular — used for the occasional lead paragraph.</p>
            <p className="pt-3 text-sm leading-relaxed">Body · 14 / regular — the default text size across the app today.</p>
            <p className="pt-3 text-xs font-medium text-muted-foreground">Caption / label · 12 / medium — timestamps, helper text, table headers.</p>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <h3 className="mb-3 text-sm font-semibold">Numbers: tabular, right-aligned, weighted</h3>
              <div className="space-y-1.5 text-sm">
                {[
                  { label: "Contributions", value: 128450 },
                  { label: "Loan repayments", value: 9600 },
                  { label: "Outstanding", value: 1250 },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(row.value, "GBP")}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-bold tabular-nums">{formatMoney(139300, "GBP")}</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <h3 className="mb-3 text-sm font-semibold">Typeface note</h3>
              <p className="text-sm text-muted-foreground">
                The whole app now uses <span className="font-semibold text-foreground">Manrope</span> instead of
                the previous Geist (src/app/layout.tsx). Both are clean and legible; Manrope&apos;s letterforms are
                rounder and warmer, which reads slightly friendlier at headline sizes without losing precision in
                numbers.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Spacing, radius & elevation" description="Spacing stays on Tailwind's existing 4px scale — no new spacing tokens, just consistent use of it. Radius is nudged softer (10px → 12px base). Elevation stays restrained: most surfaces still use a 1px ring, not a shadow.">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <h3 className="mb-3 text-sm font-semibold">Radius scale</h3>
              <div className="flex flex-wrap items-end gap-4">
                {RADII.map((r) => (
                  <div key={r.name} className="flex flex-col items-center gap-2">
                    <div className={cn("h-14 w-14 bg-primary/15 ring-1 ring-primary/30", r.cls)} />
                    <span className="text-xs text-muted-foreground">{r.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
              <h3 className="mb-3 text-sm font-semibold">Elevation (used sparingly — popovers, dialogs)</h3>
              <div className="flex flex-wrap gap-4">
                {(["shadow-sm", "shadow-md", "shadow-lg"] as const).map((s) => (
                  <div key={s} className={cn("flex h-14 w-20 items-center justify-center rounded-xl bg-card text-xs text-muted-foreground", s)}>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Buttons" description="Primary is the one saturated moment on the page. Everything else — including destructive — stays soft/tinted rather than a solid loud fill, matching this app's existing restrained pattern.">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link button</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add"><ArrowUpRight /></Button>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Inputs" description="Warm-neutral borders, softened corners, a primary-tinted focus ring.">
          <div className="grid gap-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sg-default">Default</Label>
              <Input id="sg-default" placeholder="Contribution amount" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-disabled">Disabled</Label>
              <Input id="sg-disabled" placeholder="Not editable" disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-invalid">Invalid</Label>
              <Input id="sg-invalid" defaultValue="not a number" aria-invalid />
              <p className="text-xs text-destructive">Enter a valid amount.</p>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Badges / status pills" description="Soft, tinted fills for every state — never a solid saturated badge. success/warning/info shown here are the same soft-tint treatment the existing destructive badge already uses; Phase 2 would add them as first-class Badge variants.">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge className={STATUS_STYLE.verified}><CircleCheck /> Verified</Badge>
            <Badge className={STATUS_STYLE.pending}>Pending</Badge>
            <Badge className={STATUS_STYLE.overdue}>Overdue</Badge>
            <Badge className="bg-info/10 text-info"><Info /> Info</Badge>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Card" description="A real dashboard-style summary card — warm surface, 1px ring instead of a shadow, softened corners.">
          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>This month&apos;s contributions</CardTitle>
                <CardDescription>Susu — Group savings</CardDescription>
                <CardAction>
                  <Badge className={STATUS_STYLE.verified}>On track</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tabular-nums">{formatMoney(128450, "GBP")}</p>
                <p className="mt-1 text-sm text-muted-foreground">from 8 of 9 members this period</p>
              </CardContent>
              <CardFooter className="justify-between">
                <span className="text-xs text-muted-foreground">Updated 2 hours ago</span>
                <Button variant="ghost" size="sm">View all <ArrowUpRight /></Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Active loan</CardTitle>
                <CardDescription>Efua Mensah</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span className="tabular-nums font-medium">{formatMoney(50000, "GBP")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Repaid</span><span className="tabular-nums font-medium">{formatMoney(12500, "GBP")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><span className="tabular-nums font-semibold">{formatMoney(37500, "GBP")}</span></div>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Table" description="Warm hairline borders, a soft hover tint, and right-aligned tabular figures for amounts.">
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SAMPLE_ROWS.map((row) => (
                  <TableRow key={row.member}>
                    <TableCell className="font-medium">{row.member}</TableCell>
                    <TableCell className="text-muted-foreground">{row.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(row.amount, "GBP")}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLE[row.status]}>{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Dialog" description="Same warm surface as cards, a soft shadow (not a ring, since it needs to visually separate from page content behind the overlay) for a gentle lift.">
          <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open a sample dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record a contribution</DialogTitle>
                  <DialogDescription>This is a real DialogContent component, styled only by the scoped tokens.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="sg-dialog-amount">Amount</Label>
                  <Input id="sg-dialog-amount" placeholder="250.00" />
                </div>
                <DialogFooter showCloseButton>
                  <Button>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section title="Navigation" description="Warm dark charcoal-brown instead of the current cool navy sidebar — same structure, warmer undertone.">
          <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
            <nav className="rounded-xl bg-sidebar p-3 text-sidebar-foreground ring-1 ring-sidebar-border">
              <p className="mb-3 px-2 text-sm font-semibold">WealthCircle</p>
              {[
                { label: "Overview", icon: LayoutDashboard, active: true },
                { label: "Contributions", icon: HandCoins },
                { label: "Loans", icon: Landmark },
                { label: "Members", icon: Users },
                { label: "Audit log", icon: ScrollText },
                { label: "Settings", icon: Settings },
              ].map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                    item.active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/80",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              ))}
            </nav>
            <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              (Page content would render here — not part of this styleguide.)
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="mb-16">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      <Separator className="mt-16" />
    </section>
  );
}
