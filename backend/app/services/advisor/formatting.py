from __future__ import annotations


def money(value: float | None, currency: str = "INR") -> str:
    if value is None:
        return "not available"
    sign = "−" if value < 0 else ""
    v = abs(value)
    if currency == "INR":
        if v >= 1e7:
            return f"{sign}₹{v / 1e7:,.2f} crore"
        if v >= 1e5:
            return f"{sign}₹{v / 1e5:,.2f} lakh"
        return f"{sign}₹{v:,.0f}"
    symbol = {"MYR": "RM ", "USD": "$", "EUR": "€", "SAR": "SAR "}.get(currency, f"{currency} ")
    if v >= 1e9:
        return f"{sign}{symbol}{v / 1e9:,.2f}B"
    if v >= 1e6:
        return f"{sign}{symbol}{v / 1e6:,.2f}M"
    return f"{sign}{symbol}{v:,.0f}"


def pct(value: float | None, signed: bool = True) -> str:
    if value is None:
        return "not available"
    return f"{value * 100:+.1f}%" if signed else f"{value * 100:.1f}%"


def number(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "not available"
    return f"{value:,.{digits}f}"
