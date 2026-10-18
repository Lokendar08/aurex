"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { PageHeader, Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { InvitationsSettings } from "@/components/app/settings/invitations";
import { MembersSettings } from "@/components/app/settings/members";
import { OrganizationSettings } from "@/components/app/settings/organization";
import { PeriodsSettings } from "@/components/app/settings/periods";
import { RolesMatrix } from "@/components/app/settings/roles";
import { CompaniesSettings, DepartmentsSettings, StoresSettings } from "@/components/app/settings/structure";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERMISSIONS } from "@/lib/app/nav";

export default function SettingsPage() {
  return (
    <AppPage>
      <RequireAccess area="Settings" permission={PERMISSIONS.orgRead}>
        <Settings />
      </RequireAccess>
    </AppPage>
  );
}

type TabDef = { key: string; label: string; visible: boolean };

function Settings() {
  const { has } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabs: TabDef[] = [
    { key: "organization", label: "Organization", visible: true },
    { key: "members", label: "Members", visible: has(PERMISSIONS.membersRead) },
    { key: "invitations", label: "Invitations", visible: has(PERMISSIONS.membersManage) },
    { key: "roles", label: "Roles and permissions", visible: true },
    { key: "companies", label: "Companies", visible: true },
    { key: "stores", label: "Stores", visible: true },
    { key: "departments", label: "Departments", visible: true },
    { key: "periods", label: "Fiscal periods", visible: true },
  ].filter((t) => t.visible);
  const requested = params.get("tab");
  const tab = tabs.some((t) => t.key === requested) ? (requested as string) : "organization";

  function setTab(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "organization") query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization profile, members and invitations, roles, and the companies, stores, departments and fiscal calendar that every report uses."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="organization">
          <OrganizationSettings />
        </TabsContent>
        {has(PERMISSIONS.membersRead) ? (
          <TabsContent value="members">
            <Panel title="Members" description="Roles decide what each member can see and do; store access limits them to specific stores">
              <MembersSettings />
            </Panel>
          </TabsContent>
        ) : null}
        {has(PERMISSIONS.membersManage) ? (
          <TabsContent value="invitations">
            <InvitationsSettings />
          </TabsContent>
        ) : null}
        <TabsContent value="roles">
          <Panel title="Roles and permissions" description="What each role can do. The server enforces exactly this matrix on every request.">
            <RolesMatrix />
          </Panel>
        </TabsContent>
        <TabsContent value="companies">
          <CompaniesSettings />
        </TabsContent>
        <TabsContent value="stores">
          <StoresSettings />
        </TabsContent>
        <TabsContent value="departments">
          <DepartmentsSettings />
        </TabsContent>
        <TabsContent value="periods">
          <PeriodsSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}
