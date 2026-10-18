# Integration provider verification

Research date: 2026-10-18. Machine-readable output: `backend/app/data/reference/providers.json` (22 providers).

## How this was checked

- Each retailer-to-vendor claim from the client brief was tested against, in order of weight:
  1. the retailer's own filings and infrastructure (annual reports, exchange filings, portals on the retailer's domain);
  2. the vendor's own website and help desk;
  3. secondary material.
- User-generated content (directory reviews, enquiries) and unsourced blogs are recorded but never counted as confirmation.
- Integration facts come only from official vendor pages that loaded during this session. Pages that returned HTTP 403, or only a JavaScript shell, are flagged.
- `public_api.available = false` means **no public, documented API was found**. Private or partner-only interfaces may still exist. `null` means unknown.

| Status | Meaning |
|---|---|
| verified | Confirmed by primary evidence from the retailer and/or the vendor |
| partially_verified | Credible indirect evidence, or only part of the claim confirmed |
| unverified | No credible evidence found |
| contradicted | Evidence against the claim |

## Verdicts on the three named providers

| Brief claim | Verdict | Best evidence |
|---|---|---|
| "YASH Systems Private Limited" is DMart's system | **Unverified** | No company with that exact name found. The closest match is Yash Systems India Pvt Ltd (Nagpur). Only user reviews and an unsourced blog link it to DMart. A DMart filing confirms SAP ERP but names no POS vendor. |
| QubePOS / QubeRM is associated with Mr. DIY | **Verified** | MR D.I.Y.'s Annual Report 2025 lists Qube Apps Solutions Sdn. Bhd. as a 30% associate (IT services). The QubePos site shows an MR DIY client logo and testimonial. A "QubeERP Portal" runs on mrdiy.com for MR.DIY Indonesia. |
| "EcoLite" (tentative) is Wellness Forever's system | **Partially verified (name not found)** | No "EcoLite" product exists that we could find. The likely match is C-Square's EcoGreen family. Wellness Forever's app uses C-Square's `com.c2info.` package namespace, and a student report saw "ECOGREEN" in a store. Nothing official from either side. |

None of the three publishes a public API. For all three, **file export (CSV/XML over SFTP) is the realistic first connector**, and it must be authorised by the retailer.

---

## 1. YASH Systems -> DMart (Avenue Supermarts) - UNVERIFIED

### Who the entity is
- **Closest match:** YASH SYSTEMS INDIA PRIVATE LIMITED.
  - CIN U72900MH2005PTC151026, incorporated 4 Feb 2005, ROC Mumbai.
  - Registered office: Bajaj Nagar, Nagpur.
  - NIC 7290 ("other computer related activities"); paid-up capital Rs 1 lakh; status Active.
  - Last AGM 30 Sep 2023; last balance sheet 31 Mar 2023.
  - Source: [ZaubaCorp, compiled from MCA](https://www.zaubacorp.com/YASH-SYSTEMS-INDIA-PRIVATE-LIMITED-U72900MH2005PTC151026).
- **Directory listings:**
  - [Justdial](https://www.justdial.com/Nagpur/Yash-Systems-INDIA-Pvt-Ltd-Opposite-Ciims-Bajaj-Nagar/0712P712STDKM00066_BZDET) lists it as "Computer Software Developers For Retailers", established 2007.
  - [IndiaMART](https://www.indiamart.com/yash-systems-india/) lists only generic software services.
- **Website:** the domain given in directories, yashsys.com, served only a domain-parking script on 2026-10-18. There is no live company website and no product or API documentation.
- **Not to be confused with:**
  - YASH Technologies Pvt Ltd (Indore SAP/IT services firm; no DMart link found);
  - Yash Computech Solution Pvt Ltd (Indore, "YES POS");
  - Yash Systems Manufacturing Co. Pvt Ltd (Pune, machinery).

### Evidence for a DMart link (all weak)

| Source | What it shows | Weight |
|---|---|---|
| [Justdial review, 28 Jun 2017](https://www.justdial.com/Nagpur/Yash-Systems-INDIA-Pvt-Ltd-Opposite-Ciims-Bajaj-Nagar/0712P712STDKM00066_BZDET) | A user says DMart's software was made by this company | User-generated |
| [HelloNagpur enquiry, 3 Jan 2019](https://hellonagpur.com/Yash-Systems-India-Private-Limited-in-Nagpur/HN9189) | A visitor asks about "Retailsoft" software seen at DMart | User-generated |
| [Medium blog, 9 Jan 2026](https://medium.com/@rautprajwal36/inside-dmarts-technology-how-india-s-favorite-supermarket-runs-on-smart-systems-31546b6558a2) | Claims stores run "R-Soft" by Yash Systems India and HQ runs SAP | Unsourced, partly illustrative |
| [DMart board-meeting outcome, 2 May 2026 (p.20)](https://api.dmartindia.com/corporate/content/file/v1/2/jZtJ4gV9JIDY9CjsdXXbQxhE1777722483/Outcome%20of%20the%20Board%20Meeting%20held%20on%20May%202,%202026.pdf) | An executive's profile says he drove DMart's "SAP ERP transformation" (2009-2018) | **Primary**, but it names SAP only; no POS vendor |

Things checked without finding a vendor name or confirmation:
- DMart results filings, press releases, investor presentations and the BRSR FY2025-26;
- DMart job ads in search results;
- vendor case studies.

Other noise:
- A Techjockey Q&A claims DMart uses "Times Media" billing software. It is unsourced and was disregarded.
- A Techjockey marketplace listing is titled "Ginesys D Mart Billing Software". That is a marketplace product name, not evidence that DMart uses Ginesys; no DMart confirmation was found.

### Integration
- No public API, webhooks, export spec or partner programme was found.
- Any data AUREX receives would be DMart-owned and would come through DMart.
- Recommended connector: **file_export** (scheduled CSV/XML via SFTP).

**Activation steps:**
1. DMart IT confirms the system of record for store sales and inventory.
2. DMart signs a written authorisation and data-sharing agreement.
3. The vendor provides an extract spec, routed through DMart.
4. SFTP credentials are issued and AUREX IPs are allow-listed.
5. Infosec review and NDA.

**Open question for the client:** where did the name "YASH Systems Private Limited" come from? A contract, an invoice or an email would settle the identity.

---

## 2. QubePOS / QubeRM -> MR D.I.Y. - VERIFIED

### Who the vendor is
- **Vendor:** Qube Apps Solutions Sdn. Bhd. ("QubePos is a registered trademark of Qube Apps Solutions Sdn Bhd (981542-A)"), Petaling Jaya, Selangor, Malaysia. Source: [qubepos.com](https://qubepos.com/).
- **Products:**
  - QubeRM (retail POS) and CloudBite (F&B POS);
  - QubeERP (cloud ERP, described [here](https://qubeapps.com/services/software-solutions/erp-software/));
  - self-checkout, warehouse and transport management, CRM/loyalty, mobile reporting, and LHDN e-invoicing.
- **Markets:** an Indonesian site exists, and the [about page](https://qubeapps.com/about/) says a Jakarta office opened in 2025.

### Evidence

| Source | What it shows |
|---|---|
| [MR D.I.Y. Integrated Annual Report 2025](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Integrated_Annual_Report_2025_20260427.pdf) (group structure p.11; associates note p.154) | Qube Apps Solutions Sdn. Bhd. is a **30% associate** of MR D.I.Y. Group (M) Berhad: Malaysia; "computer consultancy services, software developers and trading of related products"; shown under "IT services" |
| [qubepos.com](https://qubepos.com/) | Displays an MR DIY client logo and a testimonial attributed to the IT Director of Mr. DIY Group |
| [iderp.mrdiy.com](https://iderp.mrdiy.com/Default.aspx?country=id_diy) | Login page branded "QubeERP Portal" on MR DIY's own domain, labelled for MR.DIY Indonesia, live. We read the branding only and attempted no login. |
| [Qube help desk, e-invoicing folder](https://qubeappshelp.freshdesk.com/support/solutions/folders/60000509276) | FPOS / ERP Portal troubleshooting articles; one refers to MR DIY's practice |
| MR.DIY Indonesia job ads ([1](https://dealls.com/loker/desktop-and-store-support-it~mr-diy-indonesia), [2](https://dealls.com/en/loker/it-store-support-staff~mr-diy-indonesia)) | One lists "Application Qube Administrator". The other mentions ERP administration "oracle or equivalent", so other systems may coexist. |

**Not confirmed:**
- which modules (QubeRM POS, "FPOS", QubeERP) run in which country;
- whether MR D.I.Y. Malaysia and Indonesia run the same stack.

Because Qube is an MR D.I.Y. associate, commercial terms may be a related-party matter for the retailer.

**Name collisions:** "Qu POS" (Qubeyond, US restaurant POS with its own partner API) and "Cube RM" (CPQ software) are unrelated.

### Integration
- **Public API:** none found.
- **Vendor claims and integrations:** the vendor says the product is "easy to integrate with third-party systems". Documented integrations (see the [features summary](https://qubepos.com/retail-features-summary/) and [FAQ](https://qubepos.com/faqs/)) are:
  - posting to accounting software;
  - integrated payments;
  - sales submission to shopping malls;
  - LHDN e-invoicing.
- **Data handling:** the POS works offline with local storage and syncs to a central back office. Data migration and custom builds are offered on request.
- **Partner programme:** a reseller/partner programme exists ([become a partner](https://qubepos.com/become-a-partner/)), but it is a sales channel, not a developer programme.
- **Recommended connector:** **file_export** now; switch to generic_rest if Qube supplies an API specification.

**Activation steps:**
1. MR D.I.Y. signs a written authorisation and data-sharing agreement.
2. Qube provides an integration spec or scheduled export, routed through MR D.I.Y. IT.
3. Scope is agreed per country instance and per module.
4. Qube issues credentials (API keys or SFTP) and AUREX IPs are allow-listed.
5. Data-protection review under local law (e.g. Malaysia PDPA).

---

## 3. "EcoLite" -> Wellness Forever - PARTIALLY VERIFIED (name not found)

### Which product this probably is
- No product named "EcoLite" was found.
- The closest real product line is **C-Square Info-Solutions' EcoGreen family** ([csquare.in](https://www.csquare.in/)):
  - [EcoGreen](https://www.csquare.in/ecogreen/): a multi-store pharmacy/retail ERP;
  - EcoGreen Express;
  - [EcoGreen Lite](https://www.csquare.in/ecogreen-lite/): a low-cost standalone POS on Jio PC.
- "EcoLite" may be a conflation of these names. A chain of roughly 375-450 stores would more plausibly run multi-store EcoGreen than Lite.
- C-Square's [about page](https://www.csquare.in/about-us/) says it became a **subsidiary of Reliance Retail** in 2017. Reliance Retail competes in pharmacy retail, which matters for any data-flow review.

### Evidence linking Wellness Forever and C-Square

| Source | What it shows | Weight |
|---|---|---|
| [Wellness Forever Android app](https://play.google.com/store/apps/details?id=com.c2info.wellnessforever&hl=en_IN) | Official app (support email at wellnessforever.in) with package id **com.c2info.wellnessforever** | Objective technical artifact |
| [Google Play, C-Square apps](https://play.google.com/store/search?q=C-Square%20Info%20Solutions&c=apps) | Apps published by "C-Square Info-Solutions Limited" use the same `com.c2info.` namespace (e.g. com.c2info.liveconnect.productlist) | Links the app to C-Square |
| [Student project on a Wellness Forever store, Pune](https://www.slideshare.net/slideshow/storekeeping-79944007/79944007) (c. 2014-2017) | Store stock kept on "ECOGREEN" software, with an early-morning transfer to head office | Old, non-authoritative |
| [Blue Yonder customer story](https://zh.blueyonder.com/resources/wellness-forever-digitally-transforms-category-management) | Wellness Forever uses Blue Yonder for category management and planograms | Different system; undated |

- **Not confirmed:** the current store POS/ERP, and any statement by Wellness Forever or C-Square about their relationship.
- **Also looked for, not found:** an ERP vendor named in DRHP coverage, job ads naming a POS/ERP, a Google Cloud case study.

### Integration
- **Public API:** none.
- **Vendor statements (EcoGreen FAQ):** the ERP "supports API integration" and custom APIs can be developed (online orders; Paytm/Razorpay).
- **Data handling:** branches keep transactions locally and sync to the central Admin module at intervals.
- **Exports:** Excel export is documented, but only for EcoGreen Lite reports.
- **Partner programme:** channel-partner tiers exist ([channel partner](https://www.csquare.in/channel-partner/)), but they are a sales channel.
- **Recommended connector:** **file_export**.

**Activation steps:**
1. Wellness Forever IT confirms which system it runs.
2. Wellness Forever signs an authorisation and data-sharing agreement. Pharmacy data can include prescription data, so restrict to aggregated sales and inventory unless explicitly approved.
3. C-Square provides an API or scheduled export, routed through Wellness Forever.
4. Legal review, given C-Square's Reliance Retail ownership.
5. DPDP Act 2023 compliance, credentials and allow-listing.

---

## 4. Common systems catalogue (official documentation only)

Details, evidence URLs and notes are in `providers.json`. Rate limits are quoted only where an official page stated them.

| System | Official API docs | Auth | Webhooks | Rate-limit notes | Status |
|---|---|---|---|---|---|
| Shopify | [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql) | OAuth2, access token | Yes | Points per second by plan (100 / 200 / 1,000 / 2,000); 1,000-point cap per query. REST is legacy. | verified |
| Square | [REST API](https://developer.squareup.com/docs/build-basics/using-rest-api) | OAuth2, personal access token | Yes | No numbers published; 429 errors | verified |
| Lightspeed Retail (X-Series) | [X-Series API](https://x-series-api.lightspeedhq.com/docs/introduction) | OAuth2, personal token | Yes | 300 x registers + 50 per 5 min | partially (R-Series docs blocked) |
| Odoo | [External JSON-2 API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html) | API key | Yes (Studio) | None documented; external API needs a Custom plan on Odoo Online | verified |
| SAP Business One | [Service Layer reference](https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html) | Session login | Not found | None found | partially |
| MS Dynamics 365 Business Central | [API v2.0](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/) | OAuth2 (Entra) | Yes | 6,000 requests per 5 min per user; 5 concurrent | verified |
| Oracle NetSuite | [REST/SOAP/RESTlets](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1544786256.html) | OAuth2, TBA (no new TBA from 2027.1) | Not established | Concurrency 5 / 15 / 20 / 20 by tier | partially |
| TallyPrime | [Integration methods](https://help.tallysolutions.com/integration-methods-and-technologies/) | None documented (local HTTP server) | No | n/a; needs an on-prem agent | partially |
| Zoho Inventory | [API v1](https://www.zoho.com/inventory/api/v1/introduction/) | OAuth2 | Yes (workflow) | 100/min per org; daily caps by plan | verified |
| Zoho Books | [API v3](https://www.zoho.com/books/api/v3/introduction/) | OAuth2 | Yes | 100/min per org; daily caps by plan | verified |
| QuickBooks Online | [Limits and throttles](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html) | OAuth2 | Yes | 500/min per realm; 10/s per realm and app | verified |
| Xero | [Accounting API](https://developer.xero.com/documentation/api/accounting/overview) | OAuth2 | Yes (details unverified) | 60/min and 5,000/day per tenant (FAQ) | partially |
| Gofrugal | [E-commerce API](https://community.gofrugal.com/portal/en/kb/articles/api-integration) | API key (X-Auth-Token) | Not documented | None | partially |
| Ginesys | none public ([integrations page](https://www.ginesys.in/products/erp-pos-integrations)) | n/a | n/a | n/a | unverified |
| LS Central | [Web services](https://help.lscentral.lsretail.com/Content/LS-Retail/BackOffice/How-To-Setup-Web-Services.htm) | OAuth2 (via BC SaaS) | Not LS-specific | BC limits likely apply | partially |
| BambooHR | [API](https://documentation.bamboohr.com/docs/getting-started) | API key (Basic), OAuth2 | Yes | No numbers published; 429 + Retry-After | verified |
| Deputy | [API auth](https://developer.deputy.com/docs/authenticating-with-deputy) | OAuth2, permanent token | Yes | None documented | verified |
| HubSpot CRM | [Auth overview](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview) | OAuth2, private-app token | Yes | 110 per 10 s (public apps); private apps vary by tier | verified |
| Salesforce | [API guide (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/api_basics/api_basics_overview) | OAuth2, session ID | CDC / Pub/Sub (no generic webhooks verified) | Edition-based; numbers not verified | partially |

**Blocked or unrendered pages** (facts from them are marked unverified):
- returned HTTP 403: lightspeedhq.com, sap.com, netsuite.com, developer.salesforce.com;
- returned only a page shell: developer.intuit.com and parts of developer.xero.com.
