/**
 * Smoke test for the authenticated AUREX app (/app/**).
 *
 * Needs the API (127.0.0.1:8000, NovaMart demo seeded) and the Next app running:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
 * PLAYWRIGHT_CHANNEL=chrome (or msedge) uses an installed browser instead of Playwright's Chromium.
 *
 * Signs in through the demo endpoint (no passwords), visits each role's workspace and checks that
 * the key headings render without error states, that permissions hide and block Finance for an
 * employee, and that a CSV upload on an integration page is validated and logged.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.use({
  baseURL: BASE_URL,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function demoLogin(request: APIRequestContext, role: string) {
  const response = await request.post("/api/v1/auth/demo/login", { data: { role } });
  expect(response.status(), `demo login as ${role}`).toBe(200);
  return (await response.json()) as { memberships: { org_id: string; workspace_path: string }[] };
}

/** No error panel (role=alert) is visible in the page content. */
async function expectNoErrorStates(page: Page) {
  await expect(page.locator("main [role=alert]").filter({ visible: true })).toHaveCount(0);
}

async function openWorkspace(page: Page, expectedPath: string, heading: string | RegExp) {
  await page.goto("/app");
  await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
}

test("executive: dashboard with KPIs, trend, health score and finance access", async ({ page }) => {
  await demoLogin(page.request, "executive");
  await openWorkspace(page, "/app/dashboard", "Executive dashboard");

  const main = page.getByRole("main");
  await expect(main.getByText("Net sales", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(main.getByRole("heading", { name: "Business health" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Stores" })).toBeVisible();
  await expect(page.getByText("Synthetic demonstration data — fictional company NovaMart.")).toBeVisible();
  await expectNoErrorStates(page);

  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Finance", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Profit and loss statement" })).toBeVisible({ timeout: 30_000 });
  await expectNoErrorStates(page);
});

test("finance manager: finance workspace and a CSV upload with its validation error log", async ({ page }) => {
  const session = await demoLogin(page.request, "finance_manager");
  await openWorkspace(page, "/app/finance", "Finance");
  await expect(page.getByRole("heading", { name: "Profit and loss statement" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Totals for the period" })).toBeVisible({ timeout: 30_000 });
  await expectNoErrorStates(page);

  // Both rows fail validation on purpose (unknown store, unknown SKU): the upload, validation and
  // error log are exercised without changing the demo's business figures. The stamp keeps the file
  // unique so it is never refused as a duplicate import.
  const orgId = session.memberships[0].org_id;
  const filters = await page.request.get(`/api/v1/orgs/${orgId}/dashboard/filters`);
  const day = ((await filters.json()) as { data_end: string }).data_end;
  const stamp = Date.now();
  const csv = [
    "source_record_id,store_code,sku,business_date,quantity,gross_amount,discount_amount,refund_amount,net_amount,cost_amount",
    `e2e-${stamp}-unknown-store,S99,NM-STAP-001,${day},1,100,0,0,100,80`,
    `e2e-${stamp}-unknown-sku,S01,E2E-NO-SUCH-SKU,${day},1,100,0,0,100,80`,
  ].join("\n");

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Integration Hub" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Integration Hub" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /Manual sales corrections \(CSV\)/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Manual sales corrections (CSV)" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Upload a file" })).toBeVisible();
  await page.getByRole("combobox", { name: "Record type" }).click();
  await page.getByRole("option", { name: "Sales (lines or daily summaries)" }).click();

  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: `e2e-sales-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await page.getByRole("button", { name: "Upload and import" }).click();

  const result = page.getByRole("status").filter({ hasText: "Import job" });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("2 rows received", { timeout: 45_000 });
  await expect(result).toContainText("0 inserted");
  await expect(result).toContainText("2 rejected");

  await result.getByRole("link", { name: "View job and error log" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /File upload/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Error log" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Unknown store code/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: /Unknown product SKU/ }).first()).toBeVisible();
});

test("employee: my work only, no Finance in the navigation and a friendly 403", async ({ page }) => {
  await demoLogin(page.request, "employee");
  await openWorkspace(page, "/app/my-work", "My Work");
  await expect(page.getByRole("heading", { name: "Tasks and notifications" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Net sales", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expectNoErrorStates(page);

  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "My Work", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Finance", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);

  await page.goto("/app/finance");
  await expect(page.getByRole("heading", { level: 1, name: "You don’t have access to Finance" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Error 403: permission required")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to your workspace" })).toBeVisible();
});

test("platform admin: platform overview without tenant business data", async ({ page }) => {
  await demoLogin(page.request, "platform_admin");
  await openWorkspace(page, "/app/platform", "Platform administration");
  await expect(page.getByText("Administrators cannot see tenant business data")).toBeVisible();
  await expect(page.getByText("Organizations", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expectNoErrorStates(page);

  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Platform", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Organizations" }).click();
  await expect(page.getByRole("cell", { name: /NovaMart Demo/ }).first()).toBeVisible({ timeout: 30_000 });
  await expectNoErrorStates(page);
});
