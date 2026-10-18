# Company intelligence: findings, gaps, market-data sources

Research date: 2026-10-18. Machine-readable files:
- `backend/app/data/reference/companies.json` (6 companies, 234 observations);
- `news_sources.json` (13 sources);
- `news_seed.json` (20 articles).

## Method

- **Sources.** Financial figures come from primary documents wherever possible: audited results filed with the exchanges, annual reports, investor presentations and press releases on the companies' IR sites. Anything else is labelled `secondary_source`.
- **Units.** Values are exactly as presented; units were not converted. INR crore for DMart, INR million for MedPlus and Vishal Mega Mart, RM'000 for MR D.I.Y. and 99 Speed Mart.
- **Scanned filings.** Several exchange filings are scanned images with an OCR text layer. For DMart, each figure was read from a rendered image of the page and then tied out arithmetically:
  - revenue + other income = total income;
  - total income - total expenses = PBT;
  - PBT - tax = PAT;
  - investing sub-totals.
  
  One OCR error was caught this way and corrected: DMart FY2026 change in inventories reads (856.26) on the page, but the OCR layer had (656.26).
- **Comparables and MR D.I.Y.** These were compiled by research sub-tasks under the same rules, then spot-checked against the primary PDFs. Headline lines all matched for MR D.I.Y. FY2020-FY2025, MedPlus FY2025-FY2026, Vishal Mega Mart FY2024-FY2025 and 99 Speed Mart FY2024-FY2025 (IR page). Vishal FY2026 rounded deck values were not re-checked by us.
- **One row per metric.** Each (fiscal_year, basis, metric) appears once. Consolidated is preferred. Store count, retail area, revenue per sq ft and employees for DMart are standalone company KPIs.
- **Derived values.** These are flagged `DERIVED` in `notes`. Only DMart gross profit is derived: revenue - purchases - change in inventories, all from the same audited statement.

---

## 1. Avenue Supermarts Ltd (DMart) - listed

| Item | Value | Source |
|---|---|---|
| Legal name / CIN | Avenue Supermarts Limited / L51900MH2000PLC126473 | company filings |
| Listings | NSE `DMART`; BSE `540376`; ISIN **INE192R01011** | [NSE quote](https://www.nseindia.com/get-quote/equity/DMART/Avenue-Supermarts-Limited), [BSE](https://www.bseindia.com/stock-share-price/avenue-supermarts-ltd/dmart/540376/corp-announcements/) |
| Listing date | 21 Mar 2017 (NSE "Date of Listing") | NSE |
| FY end / currency / basis | 31 March / INR / Ind AS, consolidated (audited) | results filings |

**Annual figures**
- Financial lines are consolidated, INR crore. EBITDA is the company's press-release figure.
- Stores, retail area and revenue per sq ft are standalone.

| FY | Revenue from ops | PBT | Net profit | EBITDA | Stores | Retail area (mn sq ft) | Rev / sq ft (INR) |
|---|---|---|---|---|---|---|---|
| FY2020 | 24,870.20 | 1,744.77 | 1,300.98 | 2,128 | 214 | 7.8 | 32,879 |
| FY2021 | 24,143.06 | 1,483.45 | 1,099.43 | 1,743 | 234 | 8.82 | 27,306 |
| FY2022 | 30,976.27 | 2,064.12 | 1,492.40 | 2,499 | 284 | 11.5 | 27,454 |
| FY2023 | 42,839.56 | 3,060.09 | 2,378.34 | 3,637 | 324 | 13.4 | 31,096 |
| FY2024 | 50,788.83 | 3,461.33 | 2,535.61 | 4,104 | 365 | 15.15 | 32,941 |
| FY2025 | 59,358.05 | 3,672.67 | 2,707.45 | 4,487 | 415 | 17.2 | 33,896 |
| FY2026 | 68,820.74 | 4,081.62 | 2,969.86 | 5,187 | 500 | 20.6 | 33,422 |

`companies.json` also holds, for every year: total income, purchases of stock-in-trade, change in inventories, derived gross profit, inventories, cash and cash equivalents, net operating cash flow and capex. FY2026 employees (BRSR) are 96,571: 20,994 permanent plus 75,577 other-than-permanent.

**Primary documents used** (all on api.dmartindia.com, linked from the [DMart IR page](https://www.dmartindia.com/investor-relations/investor-updates/2026-2027)):
- board-meeting outcomes with audited results: [8 May 2021](https://api.dmartindia.com/corporate/content/file/v1/2/kSUSCBNwKHiYaT8uKhzS4b4n/Outcome%20of%20Board%20Meeting%20held%20on%208th%20May,%202021.pdf), [14 May 2022](https://api.dmartindia.com/corporate/content/file/v1/2/g0Mc2G6tA0aVnqEolVflpA1D1652523997/Outcome%20of%20Board%20Meeting%20held%20on%2014th%20May,%202022.pdf), [4 May 2024](https://api.dmartindia.com/corporate/content/file/v1/2/7pPxJIxiKL8bKR0RgZGhV9Nu1714823934/Outcome%20of%20Board%20Meeting%20held%20on%204th%20May,%202024.pdf), [3 May 2025](https://api.dmartindia.com/corporate/content/file/v1/2/s66CCzjOgkyssmkrawWgK7PZ1746270713/Outcome%20of%20Board%20Meeting%20held%20on%203rd%20May,%202025.pdf), [2 May 2026](https://api.dmartindia.com/corporate/content/file/v1/2/jZtJ4gV9JIDY9CjsdXXbQxhE1777722483/Outcome%20of%20the%20Board%20Meeting%20held%20on%20May%202,%202026.pdf);
- press releases for [FY2023](https://api.dmartindia.com/corporate/content/file/v1/2/ZZ3IulnubahkCZzKI6G8jsU21683975583/Press%20release%20on%20financial%20results%20for%20the%20quarter%20and%20year%20ended%2031st%20March,%202023.pdf), [FY2024](https://api.dmartindia.com/corporate/content/file/v1/2/LeKFkuvf3rpTx8j5TwoEv41H1714823953/Press%20release%20on%20financial%20results%20for%20the%20quarter%20and%20year%20ended%2031st%20March,%202024.pdf) and [FY2026](https://api.dmartindia.com/corporate/content/file/v1/2/R2aWBiIpiuD39xgfm4wrqQKc1777723315/Press%20release%20dated%202nd%20May,%202026.pdf);
- the [FY2026 investor presentation](https://api.dmartindia.com/corporate/content/file/v1/2/uGXCA17YYrPHtr7KDQfC7cWD1777724005/Investor%20Presentation%20for%20the%20year%20ended%2031st%20March,%202026.pdf);
- the [BRSR FY2025-26](https://api.dmartindia.com/corporate/content/file/v1/2/KdskDImt753l133PA6Plr3Kk1784809821/Business%20Responsibility%20and%20Sustainability%20Report%20for%20FY%202025-26.pdf).

**Market share:** about **1.5% of the total Indian retail market**, per [Emkay Research, initiating coverage dated 12 Apr 2026](https://bsmedia.business-standard.com/_media/bs/data/market-reports/equity-brokertips/2026-04/17760737820.61111000.pdf). This is a broker estimate, and the report says DMart addresses about 50% of the retail TAM. No named research firm's share of organised grocery was found.

**Snapshot (not live):** close **INR 3,342.00** on 16 Oct 2026; total market cap **INR 2,18,001.84 crore** (NSE; BSE matched).

**Data gaps:**
- employees for FY2020-FY2025;
- EBITDA is a rounded press-release figure;
- gross profit is derived;
- the capex line definition widened from FY2024;
- interim (Q1/Q2 FY2027) figures are kept as news only;
- the store POS vendor is undisclosed (SAP ERP is confirmed).

## 2. MR D.I.Y. Group (M) Berhad - listed

| Item | Value | Source |
|---|---|---|
| Legal name / company no. | MR D.I.Y. Group (M) Berhad / 201001034084 (918007-M) | annual reports |
| Listing | Bursa Malaysia Main Market, stock name `MRDIY`, code `5296`, ISIN **MYL5296OO008**, listed **26 Oct 2020** | [listing announcement (IR mirror)](https://corporate.mrdiy.com/news.html/id/2407240) |
| FY end / currency / basis | 31 December / MYR / MFRS, consolidated, RM'000 | annual reports |

**Annual figures** (RM'000; EBITDA in RM million as presented):

| FY | Revenue | Gross profit | PBT | Net profit | EBITDA | Stores |
|---|---|---|---|---|---|---|
| FY2020 | 2,559,315 | 1,091,496 | 457,675 | 337,161 | 694.2 | 734 |
| FY2021 | 3,373,408 | 1,391,908 | 586,407 | 431,827 | 865.5 | 900 |
| FY2022 | 3,985,842 | 1,647,209 | 641,365 | 472,949 | 962.9 | 1,080 |
| FY2023 | 4,359,289 | 1,977,160 | 753,173 | 560,675 | 1,116.8 | 1,255 |
| FY2024 | 4,651,416 | 2,132,646 | 763,127 | 568,937 | 1,160.6 | 1,429 |
| FY2025 | 4,953,957 | 2,354,206 | 848,809 | 632,694 | 1,279.6 | 1,584 |

Inventories, cash and cash equivalents, operating cash flow, capex and employees are in the JSON.

**Sources:** annual reports [2020](https://corporate.mrdiy.com/newsroom/MRDIY_AR2020.pdf), [2021](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._-_Annual_Report_2021.pdf), [2022](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Annual_Report_2022.pdf), [2023](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Annual_Report_2023_20240425.pdf), [2024](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Integrated_Report_2024_20250424.pdf) and [2025](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Integrated_Annual_Report_2025_20260427.pdf); Q4 interim reports; the [4Q25 deck](https://corporate.mrdiy.com/misc/slides/MRDIY_4Q25_Results_Presentation.pdf); the [Sustainability Report 2025](https://corporate.mrdiy.com/newsroom/MR_D.I.Y._Sustainability_Report_2025__20260427.pdf).

**Store counts have two bases:**
- FY2025: 1,584 in the annual report (including KKV and sub-brands) vs 1,556 in the Q4 report and press release;
- FY2024: 1,429 vs 1,435;
- FY2023: 1,255 vs 1,261.

**Market share:** **29.1%** of the Malaysian home-improvement market in 2019, per Frost & Sullivan as cited in MR D.I.Y.'s [IPO press release](https://www.mrdiy.com/zh/mrdiy-raises-rm15b-in-malaysias-biggest-ipo-of-2020). The measure is not specified. Later figures (38.5%, 41.8%) have no named source and were excluded.

**Snapshot (not live):** last done **RM 1.230** on 16 Oct 2026 ([Bursa company profile](https://www.bursamalaysia.com/trade/trading_resources/listing_directory/company-profile?stock_code=5296); the company IR site shows the same). No primary market-cap figure with an as-of date was found, so it is left null.

**Data gaps:**
- retail area is not disclosed;
- the EBITDA method is undisclosed, and the FY2025 figure is from the deck;
- employees for FY2020-FY2022 are approximate;
- market cap.

**Related-party note:** Qube Apps Solutions Sdn. Bhd. (the QubePos vendor) is a 30% associate of the group.

## 3. Wellness Forever Medicare Limited - unlisted (verified)

- **Status:** unlisted. No listing or IPO launch was found. No share price is given.
- **DRHP:** dated 30 Sep 2021 (fresh issue of Rs 400 crore plus an OFS of about 1.6 crore shares), filed around 1 Oct 2021.
  - A [SEBI-hosted copy](https://www.sebi.gov.in/sebi_data/attachdocs/oct-2021/1633066313151.pdf) was located but could not be read: it exceeded the fetch limit.
  - SEBI approval was reported on [21 Feb 2022](https://www.indiainfoline.com/news/ipo/wellness-forever-gets-sebi-nod-for-an-ipo).
- **Company basics:** founded 2008; Mumbai head office; legal name per the [company site](https://wellnessforever.in/investor.php).

**Figures** (INR crore; all `secondary_source`):

| FY | Revenue / operating income | Net profit | Stores | Source |
|---|---|---|---|---|
| FY2019 | - | - | 144 (Mar 2019) | DRHP via [Indian Pharma Post](https://www.indianpharmapost.com/startup/lite/wellness-forever-files-drhp-to-raise-rs-1500-1600-crore-10382) |
| FY2020 | 863.25 (DRHP restated) | conflicting sources, not recorded | - | [IndiaInfoline](https://www.indiainfoline.com/news/ipo/wellness-forever-gets-sebi-nod-for-an-ipo) |
| FY2021 | 924.02 (DRHP restated) | -34.85 | 236 at 30 Jun 2021 (press) | IndiaInfoline; [CRISIL Jul 2022](https://www.crisil.com/mnt/winshare/Ratings/RatingList/RatingDocs/WellnessForeverMedicareLimited_July%2020,%202022_RR_297864.html) |
| FY2022 | 1,203 | -40.0 | - | [CRISIL May 2024](https://www.crisilratings.com/mnt/winshare/Ratings/RatingList/RatingDocs/WellnessForeverMedicareLimited_May%2014_%202024_RR_342175.html) |
| FY2023 | 1,390 | -50.7 | - | CRISIL May 2024 |
| FY2024 | 1,495 | -72 | ~395 | [CRISIL Jul 2025](https://www.crisilratings.com/mnt/winshare/Ratings/RatingList/RatingDocs/WellnessForeverMedicareLimited_July%2003_%202025_RR_370246.html) / CRISIL May 2024 |
| FY2025 | 1,563 (provisional) | -43 (provisional) | ~375 | CRISIL Jul 2025 |

**What the CRISIL figures are:** CRISIL "operating income" and "reported PAT" come from the rating agency's key indicators. CRISIL consolidates two subsidiaries (Amore Health Essentials and Wellness Forever Healthtech). On 3 Jul 2025 CRISIL downgraded the bank facilities to BBB/Stable.

**Gaps:**
- the DRHP was not read directly, so FY2019 financials and DRHP balance-sheet items are missing;
- FY2020 profit conflicts between CRISIL's provisional Indian GAAP figure (+11.25) and an aggregator's DRHP figure (-5.32);
- no audited filings for FY2022 onward are available online;
- no market-share percentage (the DRHP cites Technopak only for rankings);
- store counts are approximate;
- the IPO approval status is not confirmed against SEBI records.

## 4. Comparables (listed)

| Company | Listing | FY2026 (or latest) highlights | Store count |
|---|---|---|---|
| MedPlus Health Services Ltd | NSE `MEDPLUS`, BSE `543427`, ISIN INE804L01022, listed 23 Dec 2021 | FY2026 revenue INR 68,924.66 mn; PAT 2,196.06 mn (consolidated) | 5,330 (31 Mar 2026) |
| Vishal Mega Mart Ltd | NSE `VMM`, BSE `544307`, ISIN INE01EA01019, listed 18 Dec 2024 | FY2025 revenue INR 107,163.45 mn; PAT 6,319.67 mn. FY2026 deck (rounded): revenue 129,063 mn, PAT 8,392 mn | 795 (31 Mar 2026) |
| 99 Speed Mart Retail Holdings Bhd | Bursa `99SMART` (5326), listed 9 Sep 2024; ISIN not verified | FY2025 revenue RM 11,433,224k; PAT RM 607,285k (audited); FY2024 profit restated | 3,037 (31 Dec 2025) |

**Snapshots (16 Oct 2026, not live):**
- MedPlus INR 611.95 close, market cap INR 7,351.79 crore (NSE);
- Vishal INR 96.00, market cap INR 44,974.16 crore (NSE);
- 99 Speed Mart RM 3.100 last done (Bursa); market cap null.

**Market share:** 99 Speed Mart held 40.1% of the Malaysian mini-market industry by revenue and 11.6% of grocery-based retail in 2023, per Frost & Sullivan in its [prospectus](https://99speedmart.com.my/wp-content/uploads/2024/08/99SMART-Prospectus.pdf). None was verified for MedPlus or Vishal.

---

## 5. Market-data sources for NSE / BSE / Bursa prices (assessment)

We do **not** recommend scraping the NSE, BSE or Bursa websites, or unofficial Yahoo endpoints. Website quotes are for display and are not a licence to redistribute.

| Source | What we verified (2026-10-18) | Ticker format | Free tier | Fit / ToS concerns |
|---|---|---|---|---|
| **NSE Data & Analytics** ([page](https://www.nseindia.com/nsedataandanalytics)) | NSE's data-vending arm. Search results describe EOD files delivered by SFTP or cloud and published pricing files (Mar 2026). The pricing PDF timed out and was not opened. | NSE symbols (e.g. `DMART`) | None | Authoritative and licensed. Fees and redistribution terms must be confirmed with NSE before use. |
| **BSE** | Quote page loads in a browser. Data-licensing products were not researched. | Scrip code (e.g. `540376`) | - | Licensing terms unverified. |
| **Bursa Malaysia** | Company pages show prices delayed 15 min. Third-party notices say data use requires a Bursa information-services licence; current terms were not verified. | Stock code (e.g. `5296`) | - | Obtain a Bursa or authorised-vendor licence for display in AUREX. |
| **Alpha Vantage** | Free key: 25 requests/day ([support](https://www.alphavantage.co/support/)). The docs show a BSE example `RELIANCE.BSE`; there are no NSE or Bursa examples ([docs](https://www.alphavantage.co/documentation/)). | `SYMBOL.BSE`; NSE and Bursa coverage untested | 25/day | Too small for production. Coverage of DMART/MRDIY must be tested via SYMBOL_SEARCH. Redistribution terms not reviewed. |
| **Twelve Data** | Basic $0: 8 credits/min (800/day). Grow $79, Pro $229, Ultra $999 per month ([pricing](https://twelvedata.com/pricing)). Per the [exchanges page](https://twelvedata.com/exchanges): NSE (XNSE) and BSE (XBOM) are EOD from the Grow plan (individual) or Venture (business); Bursa (XKLS) needs Pro (individual) or Venture (business). | symbol + exchange/MIC (e.g. `DMART`, `XNSE`); untested | 800/day, but India and Malaysia are not in the free plan | A B2B product showing data to customers likely needs a **business** plan; confirm display rights. |
| **EODHD** | Free: 20 calls/day, 1-year EOD history, plus 500 welcome calls. Paid from $19.99/month (EOD All-World) ([pricing](https://eodhd.com/pricing)). Bursa tickers use `NNNN.KLSE`, e.g. `0001.KLSE` ([KLSE page](https://eodhd.com/exchange/KLSE)). | `5296.KLSE` by that pattern (untested). NSE suffix **not verified** (the NSE page returned 404); confirm via the exchanges-list API. | 20/day | Low cost for EOD history. Check redistribution licence for a commercial product. |
| **Financial Modeling Prep** | Official pricing pages returned HTTP 403. Secondary sources say the free tier is 250 requests/day and US-only. | `.NS` style (unverified) | Unverified | Treat as unverified. |

**Recommendation:**
- For production, licence EOD data from NSE Data & Analytics (and BSE if needed) and from Bursa Malaysia or an authorised vendor, or buy a business/commercial plan from an aggregator whose terms permit display to end users.
- Use a free tier only for prototyping, with the snapshot clearly labelled "not live".
- Store `as_of` timestamps with every price.

## 6. News sources (tested 2026-10-18)

**Working:**
- [DMart IR investor updates](https://www.dmartindia.com/investor-relations/investor-updates/2026-2027) - JavaScript-rendered; the URL changes per fiscal year.
- [NSE announcements RSS](https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml) - market-wide; filter by company name or the `DMART_` / `MEDPLUS_` / `VMM_` file prefix.
- [BSE DMart announcements](https://www.bseindia.com/stock-share-price/avenue-supermarts-ltd/dmart/540376/corp-announcements/) - browser only.
- [MR D.I.Y. newsroom](https://corporate.mrdiy.com/newsroom.html) and [press releases](https://corporate.mrdiy.com/newsroom_press_release.html).
- [Bursa announcements](https://www.bursamalaysia.com/market_information/announcements/company_announcement?company=5296) - browser only; plain fetch gets 403.
- [99 Speed Mart IR](https://99speedmart.com.my/financial-information/).
- [Business Standard Companies RSS](https://www.business-standard.com/rss/companies-101.rss) and [Mint Companies RSS](https://www.livemint.com/rss/companies) - both load in a browser; server-side fetches were blocked or 403, so ingestion may need browser-like headers.
- [NST feed](https://www.nst.com.my/feed).
- [Bernama RSS](https://www.bernama.com/en/rssfeed.php) - items carry no dates.

**Not usable:**
- Moneycontrol business RSS: loads, but the newest item was from Apr 2024.
- The Edge Malaysia: no working RSS found (`/rss`, `/feed` returned 404).
- The Star: RSS URLs listed on its RSS page returned 404, and that page limits feeds to personal, non-commercial use.
- Economic Times / ET Retail RSS: could not be tested; the domain was blocked in both of our tools.

**Wellness Forever:** no announcements feed. Its [investor page](https://wellnessforever.in/investor.php) carries only policies. Use press-feed keyword filters and CRISIL rationales instead.
