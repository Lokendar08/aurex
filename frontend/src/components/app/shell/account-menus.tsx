"use client";

import { CheckIcon, ChevronsUpDownIcon, LoaderCircleIcon, LogOutIcon, ServerCogIcon } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { useSession } from "../session-provider";

/** Active organization, with a switcher when the user belongs to several. */
export function OrgSwitcher() {
  const { memberships, membership, setActiveOrg, isPlatformAdmin } = useSession();

  if (!membership) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <ServerCogIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{isPlatformAdmin ? "Platform administration" : "No organization"}</span>
      </div>
    );
  }

  const summary = (
    <span className="flex min-w-0 flex-1 flex-col text-left leading-tight sm:max-w-[20rem]">
      <span className="truncate text-sm font-medium">{membership.org_name}</span>
      <span className="truncate text-xs text-muted-foreground">{membership.role_label}</span>
    </span>
  );

  if (memberships.length < 2) return <div className="flex min-w-0 items-center">{summary}</div>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="-mx-2 flex max-w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Organization: ${membership.org_name}. Switch organization`}
      >
        {summary}
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuGroup>
          {memberships.map((m) => (
            <DropdownMenuItem key={m.org_id} onSelect={() => setActiveOrg(m.org_id)} className="items-start gap-2 py-2">
              <CheckIcon className={cn("mt-0.5 size-4", m.org_id === membership.org_id ? "opacity-100" : "opacity-0")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.org_name}</span>
                <span className="block truncate text-xs text-muted-foreground">{m.role_label}</span>
              </span>
              {m.is_demo ? <Badge variant="outline">Demo</Badge> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Avatar menu with the signed-in identity and sign out. */
export function UserMenu() {
  const { user, membership, signOut, isPlatformAdmin } = useSession();
  const [pending, setPending] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Account menu for ${user.full_name}`}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-navy-900 text-[0.75rem] font-semibold text-white">{initials(user.full_name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{user.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          {membership ? (
            <span className="mt-1.5 block text-xs text-muted-foreground">
              {membership.role_label} at {membership.org_name}
            </span>
          ) : isPlatformAdmin ? (
            <span className="mt-1.5 block text-xs text-muted-foreground">Platform administrator</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            setPending(true);
            void signOut();
          }}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <LogOutIcon aria-hidden />}
          {pending ? "Signing out" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
