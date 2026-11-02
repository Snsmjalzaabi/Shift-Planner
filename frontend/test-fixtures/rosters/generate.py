"""Generate synthetic Excel-style roster screenshots + ground truth.

Run:  python3 test-fixtures/rosters/generate.py
Each fixture writes <name>.png and <name>.json next to this script. The JSON
holds the manually-checkable truth (employee rows, dates, codes as written)
that the regression tests compare the extractor against.

All names are fictional.
"""

from __future__ import annotations

import io
import json
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FONT_PATHS = [
    "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
BOLD_PATHS = [
    "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in BOLD_PATHS if bold else FONT_PATHS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


FILLS = {
    "D": "#FFE699",
    "N": "#9BC2E6",
    "X": "#D9D9D9",
    "XL": "#F8CBAD",
    "AL": "#A9D08E",
    "SL": "#FFC7CE",
}
HEADER_FILL = "#DDEBF7"
WEEKEND_FILL = "#F2F2F2"
GRID = "#BFBFBF"
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Cell:
    text: str = ""
    fill: str | None = None
    rotate: int = 0  # 0 or 90 (text reads bottom-to-top, Excel "Rotate Text Up")
    bold: bool = False
    colspan: int = 1
    rowspan: int = 1
    align: str = "center"
    size: int = 13


@dataclass
class Sheet:
    col_widths: list[int]
    row_heights: list[int]
    cells: dict[tuple[int, int], Cell] = field(default_factory=dict)
    title: str | None = None

    def set(self, r: int, c: int, cell: Cell) -> None:
        self.cells[(r, c)] = cell


LAST_CELLS: list[dict] = []


def render(sheet: Sheet, pad: int = 6) -> Image.Image:
    """Draw the sheet. Cell boxes + texts are kept in LAST_CELLS (ground truth
    for the structure tests: what text sits where)."""
    title_h = 34 if sheet.title else 0
    width = sum(sheet.col_widths) + pad * 2 + 1
    height = sum(sheet.row_heights) + pad * 2 + title_h + 1
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    if sheet.title:
        draw.text((pad + 4, pad + 6), sheet.title, fill="#1F1F1F", font=font(18, True))
    x0s = [pad]
    for w in sheet.col_widths:
        x0s.append(x0s[-1] + w)
    y0s = [pad + title_h]
    for h in sheet.row_heights:
        y0s.append(y0s[-1] + h)
    covered: set[tuple[int, int]] = set()
    for (r, c), cell in sheet.cells.items():
        for rr in range(r, r + cell.rowspan):
            for cc in range(c, c + cell.colspan):
                if (rr, cc) != (r, c):
                    covered.add((rr, cc))
    # Fills first, then grid, then text so text sits on top.
    for (r, c), cell in sheet.cells.items():
        box = (x0s[c], y0s[r], x0s[c + cell.colspan], y0s[r + cell.rowspan])
        if cell.fill:
            draw.rectangle(box, fill=cell.fill)
    for r in range(len(sheet.row_heights)):
        for c in range(len(sheet.col_widths)):
            if (r, c) in covered:
                continue
            cell = sheet.cells.get((r, c), Cell())
            box = (x0s[c], y0s[r], x0s[c + cell.colspan], y0s[r + cell.rowspan])
            draw.rectangle(box, outline=GRID, width=1)
    LAST_CELLS.clear()
    if sheet.title:
        LAST_CELLS.append({"rect": [0, 0, width, pad + title_h - 2], "text": sheet.title, "title": True})
    for (r, c), cell in sheet.cells.items():
        if not cell.text:
            continue
        box = (x0s[c], y0s[r], x0s[c + cell.colspan], y0s[r + cell.rowspan])
        LAST_CELLS.append({"rect": list(box), "text": cell.text, "rotate": cell.rotate})
        f = font(cell.size, cell.bold)
        l, t, rgt, b = draw.textbbox((0, 0), cell.text, font=f)
        tw, th = rgt - l, b - t
        tile = Image.new("RGBA", (tw + 4, th + 4), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((2 - l, 2 - t), cell.text, fill="#111111", font=f)
        if cell.rotate:
            tile = tile.rotate(cell.rotate, expand=True)
        bw, bh = box[2] - box[0], box[3] - box[1]
        if cell.align == "left":
            px = box[0] + 5
        else:
            px = box[0] + (bw - tile.width) // 2
        py = box[1] + (bh - tile.height) // 2
        img.paste(tile, (px, py), tile)
    return img


def daterange(start: date, days: int) -> list[date]:
    return [start + timedelta(days=i) for i in range(days)]


def build_monthly(
    employees: list[tuple[str, str]],
    dates: list[date],
    codes: dict[str, dict[date, str]],
    *,
    header_style: str,
    title: str | None,
    month_banner: bool,
    rotated_days: bool,
) -> Sheet:
    label_cols = [70, 150]
    date_w = 30 if rotated_days else 34
    row_heights = []
    header_rows = 0
    if month_banner:
        row_heights.append(24)
        header_rows += 1
    row_heights.append(24)  # weekday row
    row_heights.append(46 if rotated_days else 24)  # day row
    header_rows += 2
    row_heights += [24] * len(employees)
    sheet = Sheet(label_cols + [date_w] * len(dates), row_heights, title=title)
    r = 0
    if month_banner:
        # One merged banner per month covered by the roster.
        sheet.set(r, 0, Cell("", HEADER_FILL, colspan=2))
        start = 0
        while start < len(dates):
            end = start
            while end + 1 < len(dates) and dates[end + 1].month == dates[start].month:
                end += 1
            d = dates[start]
            sheet.set(
                r,
                2 + start,
                Cell(f"{d.strftime('%B').upper()} {d.year}", HEADER_FILL, bold=True, colspan=end - start + 1),
            )
            start = end + 1
        r += 1
    sheet.set(r, 0, Cell("Staff ID", HEADER_FILL, bold=True, rowspan=2))
    sheet.set(r, 1, Cell("Name", HEADER_FILL, bold=True, rowspan=2))
    for i, d in enumerate(dates):
        fill = WEEKEND_FILL if d.weekday() >= 5 else HEADER_FILL
        sheet.set(r, 2 + i, Cell(WEEKDAYS[d.weekday()][:2], fill, size=11))
        if header_style == "day":
            text = str(d.day)
        elif header_style == "dd-mmm":
            text = f"{d.day}-{MONTHS[d.month - 1]}"
        else:
            text = f"{d.day:02d}/{d.month:02d}"
        sheet.set(r + 1, 2 + i, Cell(text, fill, rotate=90 if rotated_days else 0, size=12))
    r += 2
    for emp_id, name in employees:
        sheet.set(r, 0, Cell(emp_id))
        sheet.set(r, 1, Cell(name, align="left"))
        for i, d in enumerate(dates):
            code = codes[name].get(d, "")
            sheet.set(r, 2 + i, Cell(code, FILLS.get(code), bold=True, size=13))
        r += 1
    return sheet


def random_codes(rng: random.Random, names: list[str], dates: list[date]) -> dict[str, dict[date, str]]:
    out: dict[str, dict[date, str]] = {}
    for name in names:
        row: dict[date, str] = {}
        for d in dates:
            roll = rng.random()
            if roll < 0.32:
                row[d] = "D"
            elif roll < 0.58:
                row[d] = "N"
            elif roll < 0.78:
                row[d] = "X"
            elif roll < 0.84:
                row[d] = "XL"
            elif roll < 0.90:
                row[d] = "AL"
            # else: blank cell (no assignment written)
        out[name] = row
    return out


def truth(name: str, sheet_img: Image.Image, employees, dates, codes, axis: str, notes: str) -> None:
    sheet_img.save(HERE / f"{name}.png", optimize=True)
    data = {
        "image": f"{name}.png",
        "cells": [dict(c) for c in LAST_CELLS],
        "notes": notes,
        "datesAxis": axis,
        "dates": [d.isoformat() for d in dates],
        "employees": [
            {
                "id": emp_id,
                "name": emp_name,
                "assignments": {d.isoformat(): c for d, c in codes[emp_name].items()},
            }
            for emp_id, emp_name in employees
        ],
    }
    (HERE / f"{name}.json").write_text(json.dumps(data, indent=2) + "\n")


EMPLOYEES = [
    ("40112", "Aisha Rahman"),
    ("40127", "Omar Haddad"),
    ("40135", "Mariam Khoury"),
    ("40148", "Yousef Nasser"),
    ("40159", "Layla Saeed"),
    ("40163", "Hamad Al Ali"),
    ("40171", "Noura Farouk"),
    ("40186", "Khalid Mansour"),
]


def main() -> None:
    rng = random.Random(20261102)
    names = [n for _, n in EMPLOYEES]

    # 1. Monthly roster: merged month banner, weekday row, rotated day numbers,
    #    coloured shift cells, blanks. Mirrors the reported failing roster.
    nov = daterange(date(2026, 11, 1), 30)
    codes = random_codes(rng, names, nov)
    img = render(
        build_monthly(EMPLOYEES, nov, codes, header_style="day", title="ICU Nursing Roster",
                      month_banner=True, rotated_days=True)
    )
    truth("monthly_rotated", img, EMPLOYEES, nov, codes, "columns",
          "Monthly roster, rotated day numbers, merged month banner, coloured cells, blanks.")

    # 2. Cross month + year boundary, dd-mmm headers, no month banner.
    span = daterange(date(2026, 12, 20), 21)
    codes = random_codes(rng, names[:5], span)
    img = render(
        build_monthly(EMPLOYEES[:5], span, codes, header_style="dd-mmm", title=None,
                      month_banner=False, rotated_days=True)
    )
    truth("cross_year", img, EMPLOYEES[:5], span, codes, "columns",
          "20 Dec 2026 - 9 Jan 2027, rotated dd-Mmm headers, no banner.")

    # 3. Weekly roster with dd/mm headers (not rotated).
    week = daterange(date(2026, 11, 2), 7)
    codes = random_codes(rng, names[:6], week)
    img = render(
        build_monthly(EMPLOYEES[:6], week, codes, header_style="dd/mm", title="Week 45 Roster",
                      month_banner=True, rotated_days=False)
    )
    truth("weekly", img, EMPLOYEES[:6], week, codes, "columns",
          "Weekly roster with dd/mm headers.")

    # 4. Vertical layout: dates down the rows, staff across the columns.
    vert_dates = daterange(date(2026, 10, 26), 14)
    staff = EMPLOYEES[:4]
    codes = random_codes(rng, [n for _, n in staff], vert_dates)
    sheet = Sheet([90, 40] + [120] * len(staff), [26] * (len(vert_dates) + 1), title="Roster Oct-Nov 2026")
    sheet.set(0, 0, Cell("Date", HEADER_FILL, bold=True))
    sheet.set(0, 1, Cell("Day", HEADER_FILL, bold=True))
    for i, (_, n) in enumerate(staff):
        sheet.set(0, 2 + i, Cell(n, HEADER_FILL, bold=True))
    for r, d in enumerate(vert_dates, start=1):
        sheet.set(r, 0, Cell(f"{d.day:02d}/{d.month:02d}/{d.year}"))
        sheet.set(r, 1, Cell(WEEKDAYS[d.weekday()]))
        for i, (_, n) in enumerate(staff):
            code = codes[n].get(d, "")
            sheet.set(r, 2 + i, Cell(code, FILLS.get(code), bold=True))
    truth("vertical", render(sheet), staff, vert_dates, codes, "rows",
          "Dates down the rows, staff across columns.")

    # 5. Poor quality: the monthly roster photographed-ish (downscaled, blurred, JPEG).
    src = Image.open(HERE / "monthly_rotated.png")
    w, h = src.size
    low = src.resize((int(w * 0.8), int(h * 0.8)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    low.save(buf, "JPEG", quality=55)
    low = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    low.save(HERE / "poor_quality.png", optimize=True)
    base = json.loads((HERE / "monthly_rotated.json").read_text())
    base["image"] = "poor_quality.png"
    base["notes"] = "monthly_rotated at 80% scale, blurred, JPEG q55."
    for c in base["cells"]:
        c["rect"] = [round(v * 0.8) for v in c["rect"]]
    (HERE / "poor_quality.json").write_text(json.dumps(base, indent=2) + "\n")


def high_dpi() -> None:
    """monthly_rotated as a 2x (retina) screenshot: exercises the downscaled
    rule detection + full-resolution cell reading path."""
    src = Image.open(HERE / "monthly_rotated.png")
    big = src.resize((src.width * 2, src.height * 2), Image.BICUBIC)
    big.save(HERE / "high_dpi.png", optimize=True)
    base = json.loads((HERE / "monthly_rotated.json").read_text())
    base["image"] = "high_dpi.png"
    base["notes"] = "monthly_rotated at 2x (retina screenshot)."
    for c in base["cells"]:
        c["rect"] = [v * 2 for v in c["rect"]]
    (HERE / "high_dpi.json").write_text(json.dumps(base, indent=2) + "\n")


if __name__ == "__main__":
    main()
    high_dpi()
