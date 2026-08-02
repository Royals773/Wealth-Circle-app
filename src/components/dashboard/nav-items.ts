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
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  segment: string; // "" for the group overview index route
  icon: LucideIcon;
}

export const DASHBOARD_NAV_ITEMS: NavItem[] = [
  { label: "Overview", segment: "", icon: LayoutDashboard },
  { label: "Contributions", segment: "contributions", icon: HandCoins },
  { label: "Loans", segment: "loans", icon: Landmark },
  { label: "Repayments", segment: "repayments", icon: ReceiptText },
  { label: "Members", segment: "members", icon: Users },
  { label: "Withdrawals", segment: "withdrawals", icon: Banknote },
  { label: "Approvals", segment: "approvals", icon: ClipboardCheck },
  { label: "Governance", segment: "governance", icon: Vote },
  { label: "Reports", segment: "reports", icon: FileBarChart },
  { label: "Audit log", segment: "audit", icon: ScrollText },
  { label: "Notifications", segment: "notifications", icon: Bell },
  { label: "Settings", segment: "settings", icon: Settings },
];
