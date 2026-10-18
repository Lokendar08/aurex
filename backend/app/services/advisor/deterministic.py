"""Deterministic advisor mode (no language model configured, or the model is unavailable).

A transparent intent router maps the question to validated tools and composes the answer from their
outputs with fixed templates. Every number comes from a tool result; the answer lists the evidence,
assumptions and limitations exactly as the LLM mode does.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.models import MarketEntity, Store
from app.services.advisor import formatting as f
from app.services.advisor.tools import ToolCall, execute

Answer = dict[str, Any]


class Session_:
    """Collects tool calls for one answer."""

    def __init__(self, db: Session, ctx: OrgContext) -> None:
        self.db, self.ctx = db, ctx
        self.calls: list[ToolCall] = []

    def call(self, name: str, args: dict[str, Any]) -> ToolCall:
        call = execute(self.db, self.ctx, name, args, f"T{len(self.calls) + 1}")
        self.calls.append(call)
        return call


def _answer(text: str, *, figures: list[dict] | None = None, evidence: list[dict] | None = None,
            assumptions: list[str] | None = None, limitations: list[str] | None = None, confidence: str = "medium",
            reason: str = "", follow_ups: list[str] | None = None) -> Answer:
    return {"answer": text, "key_figures": figures or [], "evidence": evidence or [], "assumptions": assumptions or [],
            "limitations": limitations or [], "confidence": confidence, "confidence_reason": reason,
            "follow_up_questions": follow_ups or []}


def _denied(call: ToolCall) -> Answer:
    if call.status == "denied":
        return _answer(f"I can't answer that with your current access: {call.error}.", confidence="high",
                       reason="Permission check performed by the server.",
                       limitations=["Ask an organization owner if you need this access."])
    return _answer(f"I couldn't retrieve the data needed: {call.error}.", confidence="low",
                   reason="The underlying calculation failed or data is missing.")


def _fig(label: str, value: Any, display: str, ref: str) -> dict:
    return {"label": label, "value": value, "display": display, "source_ref": ref}


def _stores_in(db: Session, ctx: OrgContext, question: str) -> list[str] | None:
    codes = re.findall(r"\b[Ss](\d{2})\b", question)
    if codes:
        return [f"S{c}" for c in codes]
    company = ctx.default_company(db)
    stores = db.scalars(select(Store).where(Store.company_id == company.id)).all()
    q = question.lower()
    hits = [s.code for s in stores if any(len(tok) > 3 and tok.lower() in q for tok in
                                          (s.name.replace("NovaMart", "").split() + [s.city or ""]))]
    return hits or None


# ---------------------------------------------------------------------------------------------
# Intent handlers
# ---------------------------------------------------------------------------------------------


def revenue_change(s: Session_, q: str) -> Answer:
    stores = _stores_in(s.db, s.ctx, q)
    mom = s.call("explain_revenue_change", {"comparison": "month_vs_previous_month", "base_start": None, "base_end": None,
                                            "current_start": None, "current_end": None, "store_codes": stores})
    if mom.status != "ok":
        return _denied(mom)
    yoy = s.call("explain_revenue_change", {"comparison": "month_vs_same_month_last_year", "base_start": None,
                                            "base_end": None, "current_start": None, "current_end": None,
                                            "store_codes": stores})
    d, cur = mom.output, mom.output["currency"]
    month = d["current_period"]["start"][:7]
    lines = []
    change = d["change_pct"]
    if change is not None and change < 0:
        lines.append(f"Net sales fell **{f.pct(change)}** in {month} versus the previous month "
                     f"({f.money(d['base_period']['net_sales'], cur)} → {f.money(d['current_period']['net_sales'], cur)}).")
    else:
        lines.append(f"Net sales did not decline in {month} versus the previous month: they changed by "
                     f"**{f.pct(change)}** ({f.money(d['current_period']['net_sales'], cur)}).")
    y = yoy.output if yoy.status == "ok" else None
    if y and y.get("change_pct") is not None:
        lines.append(f"Against the same month last year the change is **{f.pct(y['change_pct'])}**.")
    neg_stores = [r for r in d["by_store"] if (r.get("change") or 0) < 0][:3]
    if neg_stores:
        parts = []
        for r in neg_stores:
            driver = ""
            t, b = r.get("transactions_change_pct"), r.get("basket_change_pct")
            if t is not None and b is not None:
                driver = " (fewer transactions)" if t < b else " (smaller baskets)"
            parts.append(f"{r['store']} {f.money(r['change'], cur)}{driver}")
        lines.append("Largest store declines: " + "; ".join(parts) + ".")
    neg_cats = [r for r in d["by_category"] if (r.get("change") or 0) < 0][:3]
    if neg_cats:
        lines.append("Largest category declines: " + "; ".join(
            f"{r['category']} {f.money(r['change'], cur)} ({f.pct(r['change_pct'])})" for r in neg_cats) + ".")
    pvm = d["price_volume_mix"]
    lines.append(f"Decomposition on products sold in both months: volume {f.money(pvm['volume'], cur)}, price "
                 f"{f.money(pvm['price'], cur)}, mix {f.money(pvm['mix'], cur)}.")
    if d.get("supplier_lead_time_alerts"):
        a = d["supplier_lead_time_alerts"][0]
        lines.append(f"Supply check: {a['supplier']} lead time rose from {f.number(a['lead_days_before'])} to "
                     f"{f.number(a['lead_days_current'])} days ({f.pct(a['change'])}), which may have caused stockouts in "
                     "its categories.")
    figures = [_fig("Net sales change vs previous month", change, f.pct(change), mom.ref)]
    if y:
        figures.append(_fig("Net sales change vs same month last year", y["change_pct"], f.pct(y["change_pct"]), yoy.ref))
    return _answer(
        "\n\n".join(lines), figures=figures,
        evidence=[{"source_ref": mom.ref, "summary": "Revenue bridge: month vs previous month by store, category, "
                                                      "price/volume/mix"}]
        + ([{"source_ref": yoy.ref, "summary": "Revenue bridge vs same month last year"}] if y else []),
        assumptions=["Comparison uses the last complete month of data."],
        limitations=["The decomposition is exact, but causes (competition, weather, supply) are inferred from patterns, "
                     "not proven.", "Festival timing differs between years and shifts sales between months."]
        + (["Synthetic demonstration data."] if d.get("synthetic") else []),
        confidence="medium", reason="Store/category effects are measured exactly; causal attribution is indicative.",
        follow_ups=["Which products face stockout risks?", "Show store performance for the last 90 days"])


def store_profit(s: Session_, q: str) -> Answer:
    call = s.call("store_performance", {"period": "last_12m", "store_codes": None})
    if call.status != "ok":
        return _denied(call)
    d, cur = call.output, call.output["currency"]
    rows = d["stores"]
    has_profit = any("store_contribution" in r for r in rows)
    key = "store_contribution" if has_profit else "net_sales"
    ranked = sorted([r for r in rows if r.get(key) is not None], key=lambda r: -r[key])
    share_key = "share_of_positive_contribution" if has_profit else "share_of_sales"
    lines = [f"Over {d['period']['label']}, ranked by {'store contribution (profit after store costs)' if has_profit else 'net sales (your role has no profit access)'}:"]
    figures = []
    for r in ranked[:5]:
        share = r.get(share_key)
        lines.append(f"- **{r['code']} {r['name']}**: {f.money(r[key], cur)}"
                     + (f" ({f.pct(share, signed=False)} of the total)" if share is not None else "")
                     + (f", margin {f.pct(r.get('store_contribution_margin'), signed=False)}" if has_profit else "")
                     + (f", growth {f.pct(r['growth'])}" if r.get("growth") is not None else ""))
        figures.append(_fig(f"{r['code']} {key.replace('_', ' ')}", r[key], f.money(r[key], cur), call.ref))
    weakest = ranked[-1] if ranked else None
    if weakest:
        lines.append(f"\nLowest: **{weakest['code']}** at {f.money(weakest[key], cur)}.")
    return _answer("\n".join(lines), figures=figures,
                   evidence=[{"source_ref": call.ref, "summary": d["definition"]}],
                   limitations=["Head-office costs are not allocated to stores.",
                                "Growth is shown only for comparable stores."],
                   confidence="high", reason="Computed directly from stored sales and store expenses.",
                   follow_ups=["Why did revenue decline last month?", "What happens if we hire 10 additional employees?"])


_WORD_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                 "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
                 "fifty": 50, "hundred": 100}
_NUM = r"(\d+|" + "|".join(sorted(_WORD_NUMBERS, key=len, reverse=True)) + r")"
_PEOPLE = r"(?:employees?|staff|people|workers|heads|headcount|hires|cashiers)"
_REDUCE = r"\b(reduce|reducing|cut|cutting|lay\s*off|laying\s*off|fire|firing|decrease|decreasing|fewer|remove)\b"


def _num(token: str) -> int:
    return int(token) if token.isdigit() else _WORD_NUMBERS[token.lower()]


def headcount_request(q: str) -> tuple[int | None, int | None, int | None]:
    """Parse a staffing question into (headcount_change, target_headcount, headcount_stated_in_question).

    "from 20 to 30" is modelled as a change of +10 applied to the recorded headcount, so a question whose
    starting figure differs from the data cannot silently cut or inflate staff; "to 30 employees" is a target;
    "10 more employees" / "by 10" is a change (negative for reduce / cut / lay off).
    """
    m = re.search(rf"\bfrom\s+{_NUM}\s+(?:[a-z]+\s+){{0,2}}?to\s+{_NUM}\b", q, re.I)
    if m:
        start, end = _num(m.group(1)), _num(m.group(2))
        return end - start, None, start
    m = (re.search(rf"\bto\s+{_NUM}\s+{_PEOPLE}", q, re.I)
         or re.search(rf"\b(?:headcount|staff(?:ing)?)\s+(?:of|to)\s+{_NUM}\b", q, re.I))
    if m:
        return None, _num(m.group(1)), None
    m = (re.search(rf"\b{_NUM}\s*(?:more|additional|new|extra|fewer|less)?\s*{_PEOPLE}", q, re.I)
         or re.search(rf"\bby\s+{_NUM}\b(?!\s*%)", q, re.I))
    n = _num(m.group(1)) if m else 10
    return (-n if re.search(_REDUCE, q, re.I) else n), None, None


def hire(s: Session_, q: str) -> Answer:
    change, target, stated = headcount_request(q)
    stores = _stores_in(s.db, s.ctx, q)
    call = s.call("simulate_scenario", {"levers": [{"type": "workforce", "headcount_change": change,
                                                    "target_headcount": target,
                                                    "change_pct": None, "category_codes": None, "safety_days_change": None,
                                                    "open_month": None, "changes": None, "from_category": None,
                                                    "to_category": None, "shift_pct": None}],
                                        "store_codes": stores, "horizon_months": 12})
    if call.status != "ok":
        return _denied(call)
    d, cur = call.output, call.output["currency"]
    lever = d["levers"][0]
    cap = lever.get("capacity") or {}
    delta = d["delta"]
    scope_txt = ", ".join(stores) if stores else "all stores in scope"
    current_hc, new_hc = cap.get("current_headcount"), cap.get("new_headcount")
    moved = (new_hc - current_hc) if current_hc is not None and new_hc is not None else (change or 0)
    verb = "Adding" if moved >= 0 else "Removing"
    lines = [f"{verb} **{f.number(abs(moved), 0)}** employees ({scope_txt}: headcount {f.number(current_hc, 0)} → "
             f"{f.number(new_hc, 0)}) changes the staffing cost by "
             f"**{f.money(cap.get('monthly_staffing_cost_change'), cur)} per month**, "
             f"{f.money(delta['operating_expenses'], cur)} over {d['horizon_months']} months.",
             f"Revenue effect: **{f.money(delta['net_sales'], cur)}**. {lever.get('revenue_effect_note')}"]
    if stated is not None and current_hc is not None and stated != current_hc:
        lines.append(f"Note: the recorded headcount in this scope is {f.number(current_hc, 0)}, which differs from the "
                     "starting figure in your question, so the requested change was applied to the recorded headcount.")
    for insight in lever.get("insights") or []:
        lines.append(insight)
    lines.append(f"Result over the horizon: net profit {f.money(delta['net_profit'], cur)}, free cash flow "
                 f"{f.money(delta['free_cash_flow'], cur)}.")
    if cap.get("transactions_per_labor_hour_after") is not None:
        lines.append(f"Transactions per labor hour would fall to {f.number(cap['transactions_per_labor_hour_after'], 2)} "
                     f"with headcount {f.number(cap['current_headcount'], 0)} → {f.number(cap['new_headcount'], 0)}.")
    lines.append("To model a sales effect, open the Decision Lab and add a documented assumption, or use the historical "
                 "mode (only applied when stores are capacity-constrained).")
    return _answer("\n\n".join(lines), figures=[
        _fig("Monthly staffing cost increase", cap.get("monthly_staffing_cost_change"),
             f.money(cap.get("monthly_staffing_cost_change"), cur), call.ref),
        _fig("Revenue change over horizon", delta["net_sales"], f.money(delta["net_sales"], cur), call.ref),
        _fig("Net profit change over horizon", delta["net_profit"], f.money(delta["net_profit"], cur), call.ref)],
        evidence=[{"source_ref": call.ref, "summary": "Decision Lab simulation: workforce lever vs forecast baseline"}],
        assumptions=[f"{a['name']}: {a['value']}" for a in d["assumptions"] if a.get("lever") != "baseline"][:6],
        limitations=(lever.get("warnings") or []) + ["Service-level effects of staffing are not modelled."],
        confidence="high", reason="Staffing cost is deterministic (historical cost per employee × headcount change).",
        follow_ups=["Which stores are capacity constrained?", "Simulate opening a new store"])


def stockouts(s: Session_, q: str) -> Answer:
    call = s.call("inventory_risks", {"store_codes": _stores_in(s.db, s.ctx, q), "limit": 8})
    if call.status != "ok":
        return _denied(call)
    d = call.output
    counts = d.get("risk_counts") or {}
    lines = [f"As of {d.get('as_of')}: **{counts.get('stocked_out', 0)}** product-store positions are out of stock, "
             f"**{counts.get('high', 0)}** at high risk and **{counts.get('medium', 0)}** at medium risk."]
    for r in d.get("stockout_risks", [])[:8]:
        lines.append(f"- {r['store_code']} · {r['product']} ({r['category']}): on hand {f.number(r['on_hand_qty'], 0)}, "
                     f"cover {f.number(r.get('days_of_cover'))} days vs lead time {f.number(r.get('lead_time_days'))} days "
                     f"— **{r['risk']}**")
    if d.get("overstock"):
        lines.append(f"\nOverstock tied up: {f.money(d.get('overstock_value_total'), d.get('currency'))} in excess inventory "
                     f"(largest: {d['overstock'][0]['product']} at {d['overstock'][0]['store_code']}).")
    return _answer("\n".join(lines), figures=[
        _fig("Out-of-stock positions", counts.get("stocked_out", 0), str(counts.get("stocked_out", 0)), call.ref),
        _fig("High-risk positions", counts.get("high", 0), str(counts.get("high", 0)), call.ref)],
        evidence=[{"source_ref": call.ref, "summary": d.get("method", "")}], limitations=d.get("limitations", []),
        confidence="medium", reason="Based on current stock, recent demand and measured lead times.",
        follow_ups=["Simulate +2 days of safety stock for Beverages", "Which suppliers have lead-time problems?"])


def price_change(s: Session_, q: str) -> Answer:
    match = re.search(r"([+-]?\d+(?:\.\d+)?)\s*%", q)
    pct = float(match.group(1)) / 100 if match else 0.05
    if re.search(r"\b(decrease|cut|lower|reduce|drop)\b", q, re.I) and pct > 0:
        pct = -pct
    company = s.ctx.default_company(s.db)
    cats = None
    from app.models import ProductCategory

    for cat in s.db.scalars(select(ProductCategory).where(ProductCategory.company_id == company.id)).all():
        if cat.name.lower() in q.lower() or cat.code.lower() in q.lower().split():
            cats = [cat.code]
    call = s.call("simulate_scenario", {"levers": [{"type": "price", "change_pct": pct, "category_codes": cats,
                                                    "headcount_change": None, "target_headcount": None,
                                                    "safety_days_change": None, "open_month": None, "changes": None,
                                                    "from_category": None, "to_category": None, "shift_pct": None}],
                                        "store_codes": _stores_in(s.db, s.ctx, q), "horizon_months": 12})
    if call.status != "ok":
        return _denied(call)
    d, cur = call.output, call.output["currency"]
    delta, unc = d["delta"], d["uncertainty"]
    npd = unc.get("net_profit_delta") or {}
    lines = [f"A **{f.pct(pct)}** price change on {', '.join(cats) if cats else 'all categories'} over "
             f"{d['horizon_months']} months is estimated to change net sales by **{f.money(delta['net_sales'], cur)}** "
             f"and net profit by **{f.money(delta['net_profit'], cur)}**.",
             f"Uncertainty: net profit change between {f.money(npd.get('p10'), cur)} (P10) and "
             f"{f.money(npd.get('p90'), cur)} (P90); probability of a gain "
             f"{f.pct(unc.get('probability_net_profit_positive'), signed=False)}.",
             "Volume responds through price elasticities estimated from your own price and promotion history."]
    warnings = [w for lv in d["levers"] for w in (lv.get("warnings") or [])]
    return _answer("\n\n".join(lines), figures=[
        _fig("Net sales change", delta["net_sales"], f.money(delta["net_sales"], cur), call.ref),
        _fig("Net profit change", delta["net_profit"], f.money(delta["net_profit"], cur), call.ref),
        _fig("Net profit change P10", npd.get("p10"), f.money(npd.get("p10"), cur), call.ref)],
        evidence=[{"source_ref": call.ref, "summary": "Decision Lab price simulation with estimated elasticities"}],
        assumptions=[f"{a['name']}: {a['value']} ({a['source']})" for a in d["assumptions"] if a.get("lever") != "baseline"][:6],
        limitations=warnings + ["Competitor price reactions are not modelled.",
                                "Elasticities are observational estimates from historical promotions and price changes."],
        confidence="medium", reason="Elasticities are estimated with confidence intervals; competitor response unknown.",
        follow_ups=["Which scenario has the best risk-adjusted outcome?"])


def best_scenario(s: Session_, q: str) -> Answer:
    call = s.call("list_saved_scenarios", {})
    if call.status != "ok":
        return _denied(call)
    d = call.output
    rows = sorted([r for r in d["scenarios"] if r["net_profit_p10"] is not None], key=lambda r: -r["net_profit_p10"])
    if not rows:
        return _answer("No saved scenarios have been computed yet. Create scenarios in the Decision Lab first.",
                       confidence="high", reason="No saved scenarios.")
    cur = s.ctx.default_company(s.db).base_currency
    lines = [f"Best risk-adjusted scenario: **{rows[0]['name']}** — even at the 10th percentile, net profit changes by "
             f"{f.money(rows[0]['net_profit_p10'], cur)}."]
    for r in rows[:5]:
        lines.append(f"- {r['name']}: P10 {f.money(r['net_profit_p10'], cur)}, P90 {f.money(r['net_profit_p90'], cur)}, "
                     f"P(gain) {f.pct(r['probability_profit_positive'], signed=False)}")
    return _answer("\n".join(lines), figures=[_fig("Best scenario P10 net profit change", rows[0]["net_profit_p10"],
                                                   f.money(rows[0]["net_profit_p10"], cur), call.ref)],
                   evidence=[{"source_ref": call.ref, "summary": d["ranking_basis"]}],
                   limitations=["Each scenario reflects the baseline at the time it was last computed.",
                                "Scenarios with different horizons are not directly comparable."],
                   confidence="medium", reason="Ranking by downside (P10) outcome from Monte Carlo simulation.")


def kpis(s: Session_, q: str) -> Answer:
    period = "last_30d" if re.search(r"30 days|this month|month", q, re.I) else "last_12m"
    call = s.call("get_kpis", {"period": period, "store_codes": _stores_in(s.db, s.ctx, q)})
    if call.status != "ok":
        return _denied(call)
    d, cur = call.output, call.output["currency"]
    lines = [f"**{d['company']}** — {d['period']['label']} (data through {d['data_end']}):"]
    figures = []
    for k in d["kpis"]:
        if k["value"] is None:
            lines.append(f"- {k['label']}: not available ({k.get('status')})")
            continue
        if k["unit"] == "currency":
            disp = f.money(k["value"], cur)
        elif k["unit"] == "percent":
            disp = f.pct(k["value"], signed=k["key"] == "revenue_growth")
        else:
            disp = f.number(k["value"])
        change = f" ({f.pct(k['change'])} vs comparison)" if k.get("change") is not None and k["unit"] == "currency" else ""
        lines.append(f"- {k['label']}: **{disp}**{change}" + (" · estimated" if k.get("estimated") else ""))
        figures.append(_fig(k["label"], k["value"], disp, call.ref))
    if d.get("health"):
        lines.append(f"\nBusiness health score: **{d['health']['score']}** ({d['health']['grade']}).")
    return _answer("\n".join(lines), figures=figures[:8],
                   evidence=[{"source_ref": call.ref, "summary": d.get("source", "KPI calculation")}],
                   limitations=(d.get("notes") or []) + ((d.get("health") or {}).get("limitations") or [])[:2],
                   confidence="high", reason="Computed directly from stored data with documented formulas.",
                   follow_ups=["Why did revenue decline?", "Which stores contribute most to profit?"])


def forecast(s: Session_, q: str) -> Answer:
    target = "operating_expenses" if re.search(r"expens|cost", q, re.I) else "net_sales"
    stores = _stores_in(s.db, s.ctx, q)
    call = s.call("get_forecast", {"target": target, "store_code": stores[0] if stores else None})
    if call.status != "ok":
        return _denied(call)
    d = call.output
    if d.get("status") == "not_trained":
        return _answer(d["message"], confidence="high", reason="No trained model.")
    cur = s.ctx.default_company(s.db).base_currency
    lines = [f"Forecast for **{target.replace('_', ' ')}** ({d['algorithm']} v{d['version']}, reliability "
             f"**{d['reliability'].replace('_', ' ')}**; backtest WAPE {f.pct(d['backtest_wape'], signed=False)} vs "
             f"baseline {f.pct(d['baseline_wape'], signed=False)}):"]
    figures = []
    for r in d["monthly_forecast"]:
        lines.append(f"- {r['month'][:7]}: {f.money(r['forecast'], cur)} (≈80% band {f.money(r['approx_lower_80'], cur)}"
                     f" – {f.money(r['approx_upper_80'], cur)})")
        figures.append(_fig(f"Forecast {r['month'][:7]}", r["forecast"], f.money(r["forecast"], cur), call.ref))
    return _answer("\n".join(lines), figures=figures[:6],
                   evidence=[{"source_ref": call.ref, "summary": "Active forecast model with rolling-origin backtests"}],
                   limitations=(d.get("limitations") or [])[:4] + [d.get("note", "")],
                   confidence="medium" if d["reliability"] != "unreliable" else "low",
                   reason=f"Model reliability: {d['reliability']}.")


def simple_tool(name: str, title: str) -> Callable[[Session_, str], Answer]:
    def handler(s: Session_, q: str) -> Answer:
        args = {"budget_vs_actual": {"period": "ytd"}, "expense_breakdown": {"period": "last_12m"},
                "supplier_lead_times": {"period": "last_90d"},
                "workforce_summary": {"period": "last_12m", "store_codes": _stores_in(s.db, s.ctx, q)},
                "data_freshness": {}}[name]
        call = s.call(name, args)
        if call.status != "ok":
            return _denied(call)
        d = call.output
        cur = s.ctx.default_company(s.db).base_currency
        lines = [f"**{title}**"]
        figures = []
        if name == "budget_vs_actual":
            for metric, t in (d.get("totals") or {}).items():
                lines.append(f"- {metric}: actual {f.money(t['actual'], cur)} vs budget {f.money(t['budget'], cur)} "
                             f"({f.pct(t['variance_pct'])})")
                figures.append(_fig(f"{metric} variance %", t["variance_pct"], f.pct(t["variance_pct"]), call.ref))
        elif name == "expense_breakdown":
            for c in d.get("categories", [])[:6]:
                lines.append(f"- {c['category']}: {f.money(c['amount'], cur)} ({f.pct(c['share'], signed=False)})")
                figures.append(_fig(c["category"], c["amount"], f.money(c["amount"], cur), call.ref))
            for a in d.get("anomalies", [])[:3]:
                lines.append(f"- Anomaly: {a['store']} {a['category']} in {a['month'][:7]} at {f.money(a['amount'], cur)} "
                             f"(trailing mean {f.money(a['trailing_mean'], cur)})")
        elif name == "supplier_lead_times":
            for sup in d.get("suppliers", [])[:8]:
                lines.append(f"- {sup['supplier']}: average {f.number(sup['avg_lead_days'])} days "
                             f"(contracted {f.number(sup['contracted_lead_days'], 0)}), on time "
                             f"{f.pct(sup['on_time_rate'], signed=False)}" + (" — **alert**" if sup.get("alert") else ""))
        elif name == "workforce_summary":
            for st in d.get("stores", [])[:8]:
                lines.append(f"- {st['store_code']}: headcount {f.number(st.get('headcount'), 0)}, sales per labor hour "
                             f"{f.money(st.get('sales_per_labor_hour'), cur)}, labor cost "
                             f"{f.pct(st.get('labor_cost_ratio'), signed=False)} of sales")
        elif name == "data_freshness":
            for row in d.get("freshness", []):
                lines.append(f"- {row['fact']}: latest {row['latest_date'] or 'no data'} ({', '.join(row['sources'])})")
        return _answer("\n".join(lines), figures=figures[:8],
                       evidence=[{"source_ref": call.ref, "summary": title}], confidence="high",
                       reason="Direct calculation from stored data.",
                       limitations=[d["note"]] if d.get("note") else [])

    return handler


def company(s: Session_, q: str) -> Answer:
    rows = s.db.scalars(select(MarketEntity).where(MarketEntity.org_id.is_(None))).all()
    ql = q.lower()
    target = next((e for e in rows if any(n and n.lower() in ql for n in [e.display_name, e.legal_name or "",
                                                                         *(e.aliases or [])])), None)
    call = s.call("company_intelligence", {"company": target.display_name if target else q})
    if call.status != "ok":
        return _denied(call)
    d = call.output
    if d.get("status") == "not_found":
        return _answer("I couldn't match a covered company. Covered: " + ", ".join(d["known_companies"]),
                       confidence="high", reason="No matching profile.")
    lines = [f"**{d['display_name']}** ({d.get('legal_name')}) — {'listed' if d.get('is_listed') else 'not listed'}."]
    figures = []
    for key, label in (("latest_revenue", "Latest reported revenue"), ("revenue_growth", "Revenue growth (latest year)"),
                       ("net_margin", "Net margin (latest year)"), ("store_count", "Stores")):
        item = (d.get("highlights") or {}).get(key)
        if item and item.get("value") is not None:
            disp = item.get("display") or str(item["value"])
            lines.append(f"- {label}: **{disp}** ({item.get('fiscal_year')}, {item.get('verification_status')}; source: "
                         f"{item.get('source_name') or item.get('source_url')})")
            figures.append(_fig(label, item["value"], disp, call.ref))
    if d.get("market_snapshot"):
        snap = d["market_snapshot"]
        lines.append(f"- Share price snapshot: {snap.get('close_price')} {snap.get('currency')} on {snap.get('as_of')} "
                     "(snapshot, not live)")
    return _answer("\n".join(lines), figures=figures,
                   evidence=[{"source_ref": call.ref, "summary": "Verified public filings and cited secondary sources"}],
                   limitations=(d.get("data_gaps") or [])[:4], confidence="medium",
                   reason="Figures are from cited public sources; check verification status per figure.")


def news(s: Session_, q: str) -> Answer:
    words = re.sub(r"\b(news|latest|about|on|the|show|me|any|what|is|are|headlines?)\b", " ", q, flags=re.I).strip()
    call = s.call("search_news", {"query": words or None, "company_key": None})
    if call.status != "ok":
        return _denied(call)
    arts = call.output["articles"]
    if not arts:
        return _answer("No matching articles in the verified news feed.", confidence="high", reason="Search result empty.")
    lines = ["Recent verified items:"] + [f"- {a['published_at'][:10] if a['published_at'] else 'undated'} · "
                                          f"[{a['title']}]({a['url']}) — {a['source']}" for a in arts]
    return _answer("\n".join(lines), evidence=[{"source_ref": call.ref, "summary": "Market news feed search"}],
                   limitations=["Headlines and reported facts only; open the source for full context."],
                   confidence="high", reason="Direct feed lookup.")


INTENTS: list[tuple[str, Callable[[Session_, str], Answer]]] = [
    (r"\b(hire|hiring|recruit\w*|add|adding|increase|increasing|raise|raising|expand|expanding|grow)\b.*"
     r"\b(employees?|staff|people|workers|heads|headcount|cashiers)\b"
     r"|\b(employees?|staff|headcount|workers)\b.*\bfrom\s+\d+\s+to\s+\d+"
     r"|\b\d+\s+(more|additional|extra|fewer)\s+(employees|staff|people|workers)"
     r"|\b(reduce|reducing|cut|cutting|lay\s*off|fire|decrease)\b.*\b\d+\b.*\b(employees?|staff|people|workers|heads|headcount)\b"
     r"|\b(reduce|reducing|cut|cutting|lay\s*off|fire|decrease)\b.*\b(employees?|staff|people|workers|headcount)\b.*\bby\s+\d+",
     hire),
    (r"\bprices?\b.*\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*%.*\bprices?\b", price_change),
    (r"\bscenarios?\b.*\b(best|risk|compare|rank|safest)\b|\brisk-adjusted\b", best_scenario),
    (r"\bwhy\b.*\b(revenue|sales)\b|\b(revenue|sales)\b.*\b(declin|drop|fell|fall|down|decreas|slump)", revenue_change),
    (r"\bstock\s*-?\s*outs?\b|\bout of stock\b|\brun(ning)? out\b|\boverstock", stockouts),
    (r"\bstores?\b.*\b(profit|contribut|best|worst|perform|rank)", store_profit),
    (r"\bforecast|\bnext (month|quarter|year)\b|\bproject(ed|ion)s?\b", forecast),
    (r"\bbudget", simple_tool("budget_vs_actual", "Budget vs actual (fiscal year to date)")),
    (r"\bexpens|\bcost breakdown\b|\bopex\b", simple_tool("expense_breakdown", "Operating expenses (last 12 months)")),
    (r"\bsuppliers?\b|\blead times?\b", simple_tool("supplier_lead_times", "Supplier lead times (last 90 days)")),
    (r"\b(workforce|labou?r|headcount|staffing|productivity|employees?|staff)\b",
     simple_tool("workforce_summary", "Workforce (last 12 months)")),
    (r"\b(dmart|d-mart|avenue supermarts|mr\.? ?d\.?i\.?y|wellness forever|medplus|vishal|99 speed ?mart)\b", company),
    (r"\bnews\b|\bheadlines?\b", news),
    (r"\b(fresh|freshness|up to date|latest data|data quality)\b", simple_tool("data_freshness", "Data freshness")),
    (r"\b(how are we|overview|summary|kpis?|performance|health|revenue|sales|profit|margin)\b", kpis),
]


def answer(db: Session, ctx: OrgContext, question: str) -> tuple[Answer, list[ToolCall]]:
    session = Session_(db, ctx)
    for pattern, handler in INTENTS:
        if re.search(pattern, question, re.I):
            result = handler(session, question)
            return result, session.calls
    return _answer(
        "I can answer questions using your organization's validated data, for example:\n"
        "- Why did revenue decline?\n- Which stores contribute most to profit?\n- What happens if we hire ten additional "
        "employees?\n- Which products face stockout risks?\n- What could happen if prices increase by 5%?\n"
        "- Which business scenario has the best risk-adjusted outcome?",
        confidence="high", reason="No analysis was run for this question.",
        limitations=["Deterministic mode recognizes common business questions; configure a language model for free-form "
                     "questions."]), session.calls
