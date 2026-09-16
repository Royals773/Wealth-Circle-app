import {
  LayoutDashboard,
  HandCoins,
  Landmark,
  ReceiptText,
  Users,
  Banknote,
  ClipboardCheck,
  Vote,
  FileBarChart,
  Bell,
  ScrollText,
  Settings,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  segment: string; // "" for the group overview index route
  icon: LucideIcon;
  /** Section label shown above this item when it differs from the previous item's group. */
  group: string | null;
}

export const DASHBOARD_NAV_ITEMS: NavItem[] = [
  { label: "Overview", segment: "", icon: LayoutDashboard, group: null },
  { label: "Contributions", segment: "contributions", icon: HandCoins, group: "Money" },
  { label: "Loans", segment: "loans", icon: Landmark, group: "Money" },
  { label: "Repayments", segment: "repayments", icon: ReceiptText, group: "Money" },
  { label: "Withdrawals", segment: "withdrawals", icon: Banknote, group: "Money" },
  { label: "Members", segment: "members", icon: Users, group: "Governance" },
  { label: "Approvals", segment: "approvals", icon: ClipboardCheck, group: "Governance" },
  { label: "Governance", segment: "governance", icon: Vote, group: "Governance" },
  { label: "Constitution", segment: "constitution", icon: FileText, group: "Governance" },
  { label: "Reports", segment: "reports", icon: FileBarChart, group: "Insights" },
  { label: "Audit log", segment: "audit", icon: ScrollText, group: "Insights" },
  { label: "Notifications", segment: "notifications", icon: Bell, group: "Account" },
  { label: "Settings", segment: "settings", icon: Settings, group: "Account" },
];
