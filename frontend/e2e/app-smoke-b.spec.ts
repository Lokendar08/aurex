/**
 * Smoke test for the planning, market and delivery pages of the authenticated app (part B).
 *
 * Needs the API (127.0.0.1:8000, NovaMart demo seeded, forecast models trained) and the Next app:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_CHANNEL=chrome \
 *     npx playwright test e2e/app-smoke-b.spec.ts --workers=1 --reporter=list
 *
 * Signs in through the demo endpoint (no passwords) once per role and reuses that browser
 * context, because demo sign-in is rate limited per client IP. A 429 waits for Retry-After.
 * No test triggers a browser download; files are checked through the API request context.
 */
import { createHash } from "node:crypto";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL || undefined;
const SLOW = { timeout: 60_000 };

test.use({ baseURL: BASE_URL, channel: CHANNEL, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const contexts = new Map<string, BrowserContext>();

async function signedIn(browser: Browser, role: string): Promise<BrowserContext> {
  const existing = contexts.get(role);
  if (existing) return existing;
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, acceptDownloads: false });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await context.request.post("/api/v1/auth/demo/login", { data: { role } });
    if (response.status() === 200) {
      contexts.set(role, context);
      return context;
    }
    if (response.status() === 429) {
      const wait = Number(response.headers()["retry-after"] ?? "15");
      await new Promise((resolve) => setTimeout(resolve, (Math.min(Math.max(wait, 1), 70) + 1) * 1000));
      continue;
    }
    throw new Error(`demo login as ${role} failed with HTTP ${response.status()}`);
  }
  throw new Error(`demo login as ${role} stayed rate limited`);
}

async function open(context: BrowserContext, path: string, heading: string | RegExp): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible(SLOW);
  return page;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.afterAll(async () => {
  for (const context of contexts.values()) await context.close();
  contexts.clear();
});

test("decision lab: hiring 10 at S04 adds cost but no revenue; saved scenario persists and compares", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/decision-lab", "Decision Lab");

  // The preset's wording comes from the evidence for S04 (current headcount 20).
  const preset = page.getByRole("button", { name: "Hire 10 employees at S04 (20 → 30)" });
  await expect(preset).toBeVisible(SLOW);
  await preset.click();

  const outcome = page.getByRole("region", { name: "Simulation outcome" });
  await expect(outcome).toBeVisible(SLOW);
  await expect(outcome.getByRole("group", { name: "Net sales change" })).toHaveText(/Net sales\s*₹0\s*\(no change\)/);
  const opex = outcome.getByRole("group", { name: "Operating expenses change" });
  await expect(opex).toContainText("+₹");
  await expect(opex).toContainText("increase, unfavourable");
  await expect(outcome.getByRole("group", { name: "Net profit change" })).toContainText("−₹");
  await expect(page.getByText(/No revenue effect modelled/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What moves the result" })).toBeVisible();

  // Save it, reload, and it is still there.
  const name = `E2E S04 staffing ${Date.now()}`;
  await page.getByRole("button", { name: "Save scenario" }).click();
  const dialog = page.getByRole("dialog", { name: "Save scenario" });
  await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
  await dialog.getByRole("button", { name: "Save scenario" }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible(SLOW);
  await expect(page).toHaveURL(/scenario=/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible(SLOW);
  await expect(page.getByText("Saved · v1").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Simulation outcome" })).toBeVisible(SLOW);

  // Compare it with a second saved scenario, created through the API so the test does not depend on
  // scenarios left behind by earlier runs (a freshly seeded demo has none).
  const me = (await (await analyst.request.get("/api/v1/auth/me")).json()) as { memberships: { org_id: string }[] };
  const csrf = (await analyst.cookies()).find((cookie) => cookie.name === "aurex_csrf")?.value ?? "";
  const other = await analyst.request.post(`/api/v1/orgs/${me.memberships[0].org_id}/scenarios`, {
    headers: { "X-CSRF-Token": csrf },
    data: { name: `E2E utilities ${Date.now()}`, levers: [{ type: "opex", changes: { utilities: -0.05 } }],
            monte_carlo_runs: 50 },
  });
  expect(other.status()).toBe(201);
  await page.reload();
  await page.getByRole("tab", { name: "Compare" }).click();
  const list = page.getByRole("list", { name: "Saved scenarios" });
  await expect(list).toBeVisible(SLOW);
  await list.getByRole("checkbox", { name: new RegExp(escape(name)) }).check();
  await list.getByRole("checkbox", { checked: false }).first().check();
  await page.getByRole("button", { name: /Compare 2 scenarios/ }).click();
  await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible(SLOW);
  await expect(page.getByRole("region", { name: "Scenario comparison table" })).toContainText(name);
  await expect(page.getByText("Best risk-adjusted outcome")).toBeVisible();
  await page.close();
});

test("advisor: staffing question at S04 answers with traced numbers and evidence", async ({ browser }) => {
  const executive = await signedIn(browser, "executive");
  const page = await open(executive, "/app/advisor", "AI Advisor");
  await page.getByLabel("Ask the advisor").fill("What happens if we increase employees from 20 to 30 at store S04?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.getByRole("article", { name: "Advisor answer" }).last();
  await expect(answer).toBeVisible(SLOW);
  await expect(answer.getByText(/Numbers traced: \d+\/\d+/)).toBeVisible();
  await expect(answer.getByRole("list", { name: "Key figures" })).toContainText("Verified");
  await expect(answer).toContainText("No revenue effect modelled");
  await expect(answer.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await answer.getByRole("button", { name: /tool call/ }).click();
  await expect(answer.getByText("simulate_scenario")).toBeVisible();
  await page.close();
});

test("forecasts: model card with WAPE and a reliability verdict", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/forecasts", "Forecasts");
  const card = page.getByRole("region", { name: "Model card" });
  await expect(card).toBeVisible(SLOW);
  await expect(card).toContainText("WAPE");
  await expect(card).toContainText("Reliability verdict");
  await expect(card.getByText(/^(Reliable|Use with caution|Unreliable)$/).first()).toBeVisible();
  await expect(card).toContainText(/lower error \(WAPE\) than the .+ baseline|No improvement over the/);
  await expect(page.getByRole("heading", { name: "Methodology" })).toBeVisible();
  await page.close();
});

test("intelligence: DMart with source links, Wellness Forever without a share price", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/intelligence", "Company Intelligence");
  const dmart = page.getByRole("article", { name: "DMart" });
  await expect(dmart).toBeVisible(SLOW);
  const source = dmart.getByRole("link", { name: /Source/ }).first();
  await expect(source).toHaveAttribute("href", /^https?:\/\//);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  await expect(dmart).toContainText("Dated snapshot, not live");
  const wellness = page.getByRole("article", { name: "Wellness Forever" });
  await expect(wellness).toContainText("Unlisted — no share price");
  await expect(wellness).not.toContainText("close on");
  await expect(page.getByText("Live market data is not configured.")).toBeVisible();
  await page.close();
});

test("news: reported facts kept apart, every AI interpretation labelled", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/news", "Market News");
  await expect(page.getByText("Reported facts (from the source)").first()).toBeVisible(SLOW);
  const firstLink = page.getByRole("article").first().getByRole("link").first();
  await expect(firstLink).toHaveAttribute("rel", "noopener noreferrer");
  const ai = page.getByRole("region", { name: "AI-generated interpretation" });
  const count = await ai.count();
  for (let i = 0; i < count; i += 1) await expect(ai.nth(i)).toContainText("AI-generated interpretation — not verified");
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await page.close();
});

test("benchmarking: comparability notes and the synthetic company labelled", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/benchmarking", "Benchmarking");
  await expect(page.getByText("Comparability notes")).toBeVisible(SLOW);
  await expect(page.getByText(/Fiscal years differ/).first()).toBeVisible();
  const table = page.getByRole("region", { name: "Benchmark comparison" });
  await expect(table).toContainText("NovaMart Retail (Synthetic)");
  await expect(table).toContainText("Synthetic");
  await expect(page.getByRole("heading", { name: "Business health" })).toBeVisible();
  await page.close();
});

test("reports: generate an executive PDF and download it", async ({ browser }) => {
  const executive = await signedIn(browser, "executive");
  const page = await open(executive, "/app/reports", "Reports");
  const title = `E2E executive summary ${Date.now()}`;
  await page.getByRole("radio", { name: /Executive summary/ }).click();
  await page.getByRole("radio", { name: /PDF/ }).click();
  await page.getByRole("textbox", { name: /^Title/ }).fill(title);
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/v1\/orgs\/[^/]+\/reports$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Generate PDF" }).click(),
  ]);
  expect(created.status()).toBe(202);
  const report = (await created.json()) as { id: string; format: string };
  expect(report.format).toBe("pdf");

  const row = page.getByRole("row", { name: new RegExp(escape(title)) });
  await expect(row).toBeVisible(SLOW);
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 90_000 });
  await expect(row.getByRole("button", { name: /Download/ })).toBeEnabled();
  await expect(row).toContainText(/[0-9a-f]{10}…/);

  // The file is fetched through the signed-in session's request context (Node), never as a
  // browser download: a download manager on the test machine would intercept browser downloads.
  const downloadPath = `${new URL(created.url()).pathname}/${report.id}/download`;
  const served = await page.request.get(downloadPath);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("application/pdf");
  expect(served.headers()["content-disposition"]).toMatch(/attachment;.*\.pdf/);
  const bytes = await served.body();
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  const sha = served.headers()["x-content-sha256"];
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  await page.close();
});

test("workflows: analyst generates and submits, executive approves", async ({ browser }) => {
  const analyst = await signedIn(browser, "business_analyst");
  const page = await open(analyst, "/app/workflows", "Workflows");
  await page.getByRole("button", { name: "Generate from rules" }).click();
  await expect(page.getByText(/Created \d+ recommendations?|No new recommendations/)).toBeVisible(SLOW);

  const title = `E2E review S04 staffing ${Date.now()}`;
  await page.getByRole("button", { name: "New recommendation" }).click();
  const dialog = page.getByRole("dialog", { name: "New recommendation" });
  await dialog.getByRole("textbox", { name: /^Title/ }).fill(title);
  await dialog.getByRole("textbox", { name: /^Summary/ }).fill("Hold S04 headcount at 20: the Decision Lab shows cost without a revenue effect.");
  await dialog.getByRole("button", { name: "Create recommendation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(SLOW);
  const detailUrl = page.url();

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("dialog", { name: "Submit for approval?" }).getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByRole("main").getByText("Pending approval").first()).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await page.close();

  const executive = await signedIn(browser, "executive");
  const approvals = await open(executive, "/app/workflows?tab=approvals", "Workflows");
  await expect(approvals.getByRole("link", { name: title })).toBeVisible(SLOW);
  await approvals.goto(detailUrl);
  await expect(approvals.getByRole("heading", { level: 1, name: title })).toBeVisible(SLOW);
  await approvals.getByRole("button", { name: "Approve" }).click();
  await approvals.getByRole("dialog", { name: "Approve this recommendation?" }).getByRole("button", { name: "Approve" }).click();
  await expect(approvals.getByText("Recommendation approved")).toBeVisible(SLOW);
  await expect(approvals.getByRole("button", { name: "Start implementation" })).toBeVisible();
  await approvals.close();
});

test("employee: the Decision Lab shows the friendly 403", async ({ browser }) => {
  const employee = await signedIn(browser, "employee");
  const page = await employee.newPage();
  await page.goto("/app/decision-lab");
  await expect(page.getByRole("heading", { level: 1, name: "You don’t have access to the Decision Lab" })).toBeVisible(SLOW);
  await expect(page.getByText("Error 403: permission required")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to your workspace" })).toBeVisible();
  await page.close();
});
