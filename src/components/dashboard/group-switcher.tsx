"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, PlusCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/permissions";
import type { GroupSummary } from "@/lib/data/dashboard";

export function GroupSwitcher({
  memberships,
  currentGroup,
}: {
  memberships: GroupSummary[];
  currentGroup: GroupSummary;
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between sm:w-64"
          aria-label="Switch group"
        >
          <span className="truncate">{currentGroup.name}</span>
          <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your groups</DropdownMenuLabel>
        {memberships.map((membership) => (
          <DropdownMenuItem
            key={membership.id}
            onSelect={() => router.push(`/dashboard/${membership.id}`)}
          >
            <div className="flex flex-1 items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{membership.name}</p>
                <p className="text-xs text-muted-foreground">{ROLE_LABELS[membership.role]}</p>
              </div>
              {membership.id === currentGroup.id ? (
                <Check aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <PlusCircle className="h-4 w-4" /> Create or join a group
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
