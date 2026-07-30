"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ContributionRecordStatus } from "@/lib/types/database";
import type { MemberOption } from "@/components/dashboard/record-contribution-dialog";

const STATUS_OPTIONS: { value: ContributionRecordStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending_verification", label: "Pending verification" },
  { value: "verified", label: "Verified" },
  { value: "reconciled", label: "Reconciled" },
  { value: "rejected", label: "Rejected" },
  { value: "reversed", label: "Reversed" },
];

export function ContributionFilters({ members }: { members: MemberOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor="filter-member">Member</Label>
        <Select value={searchParams.get("member") ?? "all"} onValueChange={(value) => setParam("member", value)}>
          <SelectTrigger id="filter-member">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All members</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-status">Status</Label>
        <Select value={searchParams.get("status") ?? "all"} onValueChange={(value) => setParam("status", value)}>
          <SelectTrigger id="filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-from">Received from</Label>
        <Input
          id="filter-from"
          type="date"
          defaultValue={searchParams.get("from") ?? ""}
          onChange={(event) => setParam("from", event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-to">Received to</Label>
        <Input
          id="filter-to"
          type="date"
          defaultValue={searchParams.get("to") ?? ""}
          onChange={(event) => setParam("to", event.target.value)}
        />
      </div>
    </div>
  );
}
