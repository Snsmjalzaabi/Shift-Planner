"""Capture Google Play phone screenshots from the real app UI.

Drives the app's web build (the same React Native screens, rendered at phone
size) against the demo backend in demo_server.py, which holds only synthetic
data. Then frames each capture with a caption in Foxory's purple branding.

    # 1. backend with synthetic demo data
    python store/tools/demo_server.py &
    # 2. web build of the current app, pointed at the demo backend
    (cd frontend && EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8001 \
        npx expo export --platform web --output-dir /tmp/foxory-web)
    # 3. capture + frame
    python store/tools/capture_screenshots.py /tmp/foxory-web

Output: store/google-play/en-US/phone-screenshots/NN-name.png
(1080x1920, 24-bit PNG without alpha: Google Play's 9:16 promo size).

The run also checks cross-device sync for real: a shift added in one
signed-in session must appear in a second, independent session.
"""

from __future__ import annotations

import functools
import http.server
import io
import sys
import tempfile
import threading
from datetime import date, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "store" / "google-play" / "en-US" / "phone-screenshots"
RAW = Path(tempfile.mkdtemp(prefix="foxory-raw-"))
PORT = 8081
BASE = f"http://localhost:{PORT}"
# Accounts seeded by demo_server.py (all fictional, display name "Alex Morgan").
FREE = "alex.morgan@example.com"  # free plan, sample month of shifts
PLUS = "alex.plus@example.com"  # Plus, for the paid Excel export only
NEW = "alex.new@example.com"  # free plan, empty calendar (first import)
DEMO_PASSWORD = "DemoPass!2026"
PHONE = {"width": 390, "height": 844}
SCALE = 3

# Foxory palette (design_guidelines.json)
BG_TOP = (9, 5, 20)
BG_BOTTOM = (30, 20, 58)
NEON = (168, 85, 247)
TEXT = (248, 250, 252)
ACCENT = (192, 132, 252)
SUBTLE = (148, 163, 184)

FONT_DIRS = [Path("/usr/share/fonts/opentype/inter"), Path("/usr/share/fonts/truetype/dejavu")]


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for directory in FONT_DIRS:
        for name in names:
            path = directory / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


TITLE_FONT = font(["InterDisplay-Bold.otf", "DejaVuSans-Bold.ttf"], 76)
SUB_FONT = font(["Inter-Medium.otf", "DejaVuSans.ttf"], 38)


# --------------------------------------------------------------------------
# Static server for the web build (SPA fallback to index.html)
# --------------------------------------------------------------------------
def serve(directory: Path) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def send_head(self):  # noqa: N802
            path = Path(self.translate_path(self.path))
            if not path.exists() or (path.is_dir() and not (path / "index.html").exists()):
                self.path = "/index.html"
            return super().send_head()

        def log_message(self, *args):  # noqa: D401
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(directory)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# --------------------------------------------------------------------------
# App driving
# --------------------------------------------------------------------------
def sign_in(page: Page, email: str) -> None:
    page.goto(BASE)
    page.wait_for_selector('[data-testid="input-email"]', timeout=30000)
    page.get_by_test_id("input-email").fill(email)
    page.get_by_test_id("input-password").fill(DEMO_PASSWORD)
    page.get_by_test_id("login-submit-button").click()
    page.wait_for_selector('[data-testid="calendar-grid"]', timeout=30000)
    page.wait_for_timeout(1500)


def shot(page: Page, name: str) -> Path:
    path = RAW / f"{name}.png"
    page.screenshot(path=str(path))
    return path


def synthetic_roster(path: Path) -> None:
    """A small roster with fictional names, laid out like a unit spreadsheet."""
    from openpyxl import Workbook

    first = date.today().replace(day=1)
    days = [first + timedelta(days=i) for i in range(14)]
    wb = Workbook()
    ws = wb.active
    ws.title = first.strftime("%B %Y")
    ws.append(["Staff ID", "Name"] + [datetime(d.year, d.month, d.day) for d in days])
    rows = {
        "Jordan Lee": "D D N N X X D D N N X X AL AL",
        "Alex Morgan": "N N X X D D D N N X X D D X",
        "Sam Rivera": "X D D N N X X D D N N X X D",
        "Priya Shah": "D X X D D N N X X D D N N X",
    }
    for i, (name, codes) in enumerate(rows.items()):
        ws.append([f"40{120 + i}", name] + codes.split())
    wb.save(path)


def new_phone(browser, **extra):
    return browser.new_context(viewport=PHONE, device_scale_factor=SCALE, **extra).new_page()


def capture() -> dict[str, Path]:
    shots: dict[str, Path] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])

        # Free account: calendar, shift editor, drafts
        page = new_phone(browser)
        sign_in(page, FREE)
        shots["calendar"] = shot(page, "calendar")

        target = (date.today() + timedelta(days=3)).isoformat()
        page.get_by_test_id(f"calendar-cell-{target}").click()
        page.wait_for_selector('[data-testid="shift-editor-sheet"]')
        page.get_by_test_id("shift-type-night").click()
        page.wait_for_timeout(600)
        shots["editor"] = shot(page, "editor")
        page.get_by_test_id("shift-editor-close").click()
        page.wait_for_timeout(500)

        page.goto(f"{BASE}/planner")
        page.wait_for_selector('[data-testid="filter-draft"]', timeout=20000)
        page.get_by_test_id("filter-draft").click()
        page.wait_for_timeout(1200)
        shots["planner"] = shot(page, "planner")

        # Sync across devices, verified: add a shift on phone A, then open a
        # second, independent session (phone B) and look for it.
        page.goto(f"{BASE}/dashboard")
        page.wait_for_selector('[data-testid="calendar-grid"]')
        added_day = date.today().isoformat()
        cell = f'[data-testid="calendar-cell-{added_day}"] [data-testid^="shift-chip-"]'
        before = page.locator(cell).count()
        page.get_by_test_id(f"calendar-cell-{added_day}").click()
        page.wait_for_selector('[data-testid="shift-editor-sheet"]')
        page.get_by_test_id("shift-type-on_call").click()
        page.get_by_test_id("input-note").fill("Cover shift")
        page.get_by_test_id("save-shift-button").click()
        page.wait_for_timeout(1500)
        if page.get_by_test_id("shift-editor-close").count():
            page.get_by_test_id("shift-editor-close").click()
            page.wait_for_timeout(500)
        chips_a = page.locator(cell).count()
        shots["sync_a"] = shot(page, "sync_a")

        page_b = new_phone(browser)
        sign_in(page_b, FREE)
        chips_b = page_b.locator(cell).count()
        if chips_a != before + 1 or chips_b != chips_a:
            raise SystemExit(
                f"Sync check failed on {added_day}: before {before}, phone A {chips_a}, phone B {chips_b}."
            )
        print(f"Sync verified: shift added on phone A appears on phone B ({chips_b} shifts on {added_day}).")
        shots["sync_b"] = shot(page_b, "sync_b")

        # Plus account: Excel export
        plus = new_phone(browser, accept_downloads=True)
        sign_in(plus, PLUS)
        plus.goto(f"{BASE}/planner")
        plus.wait_for_selector('[data-testid="export-xlsx-btn"]', timeout=20000)
        plus.wait_for_timeout(800)
        with plus.expect_download():
            plus.get_by_test_id("export-xlsx-btn").click()
        plus.wait_for_selector('[data-testid="xlsx-result"]', timeout=20000)
        plus.get_by_test_id("xlsx-result").scroll_into_view_if_needed()
        plus.evaluate("window.scrollBy(0, -140)")
        plus.wait_for_timeout(600)
        shots["export"] = shot(plus, "export")

        # Empty free account: first roster import, row found by name
        fresh = new_phone(browser)
        sign_in(fresh, NEW)
        roster = RAW / "unit-roster.xlsx"
        synthetic_roster(roster)
        fresh.goto(f"{BASE}/import")
        fresh.wait_for_selector('[data-testid="import-xlsx"]', timeout=20000)
        with fresh.expect_file_chooser() as chooser:
            fresh.get_by_test_id("import-xlsx").click()
        chooser.value.set_files(str(roster))
        fresh.wait_for_selector('[data-testid="confirm-employee"]', timeout=20000)
        fresh.get_by_test_id("confirm-employee").click()
        fresh.wait_for_selector('[data-testid="review-counts"]', timeout=20000)
        fresh.wait_for_timeout(800)
        shots["import"] = shot(fresh, "import")
        browser.close()
    return shots


# --------------------------------------------------------------------------
# Framing
# --------------------------------------------------------------------------
W, H = 1080, 1920


def background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W * 0.15, H * 0.30, W * 0.85, H * 0.95], fill=(70, 30, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.blend(img, Image.composite(glow, img, Image.new("L", (W, H), 255)), 0.45)


def rounded(capture: Image.Image, width: int, radius: int) -> tuple[Image.Image, Image.Image]:
    height = round(capture.height * width / capture.width)
    resized = capture.convert("RGB").resize((width, height), Image.LANCZOS)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)
    return resized, mask


def place_phone(canvas: Image.Image, capture: Image.Image, x: int, y: int, width: int) -> None:
    radius = int(width * 0.085)
    screen, mask = rounded(capture, width, radius)
    bezel = 14
    frame = Image.new("L", (screen.width + bezel * 2, screen.height + bezel * 2), 0)
    ImageDraw.Draw(frame).rounded_rectangle(
        [0, 0, frame.width - 1, frame.height - 1], radius=radius + bezel, fill=255
    )
    shadow = Image.new("RGB", canvas.size, (0, 0, 0))
    shadow_mask = Image.new("L", canvas.size, 0)
    shadow_mask.paste(frame, (x - bezel, y - bezel + 24))
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(36)).point(lambda v: int(v * 0.55))
    canvas.paste(shadow, (0, 0), shadow_mask)
    canvas.paste(Image.new("RGB", frame.size, (45, 27, 78)), (x - bezel, y - bezel), frame)
    inner = Image.new("L", frame.size, 0)
    ImageDraw.Draw(inner).rounded_rectangle(
        [3, 3, frame.width - 4, frame.height - 4], radius=radius + bezel - 3, fill=255
    )
    canvas.paste(Image.new("RGB", frame.size, (17, 10, 34)), (x - bezel, y - bezel), inner)
    canvas.paste(screen, (x, y), mask)


def fitted(text: str, names: list[str], size: int, max_width: int) -> ImageFont.FreeTypeFont:
    """Largest font size (up to `size`) at which the text fits the width."""
    while size > 24:
        f = font(names, size)
        if ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(text, font=f) <= max_width:
            return f
        size -= 2
    return font(names, size)


def caption(canvas: Image.Image, title: str, subtitle: str | None) -> None:
    draw = ImageDraw.Draw(canvas)
    title_font = fitted(title, ["InterDisplay-Bold.otf", "DejaVuSans-Bold.ttf"], 76, W - 140)
    tw = draw.textlength(title, font=title_font)
    draw.text(((W - tw) / 2, 120), title, font=title_font, fill=TEXT)
    if subtitle:
        sw = draw.textlength(subtitle, font=SUB_FONT)
        draw.text(((W - sw) / 2, 225), subtitle, font=SUB_FONT, fill=ACCENT)


def frame_single(capture_path: Path, title: str, subtitle: str | None, out: Path) -> None:
    canvas = background()
    caption(canvas, title, subtitle)
    capture = Image.open(capture_path)
    width = 700
    place_phone(canvas, capture, (W - width) // 2, 330, width)
    canvas.save(out, "PNG", optimize=True)


def frame_pair(left: Path, right: Path, title: str, subtitle: str | None, out: Path) -> None:
    canvas = background()
    caption(canvas, title, subtitle)
    width = 470
    top = 380
    place_phone(canvas, Image.open(left), 46, top, width)
    place_phone(canvas, Image.open(right), W - 46 - width, top, width)
    draw = ImageDraw.Draw(canvas)
    label_y = top + round(Image.open(left).height * width / Image.open(left).width) + 50
    for label, cx in (("Phone", 46 + width / 2), ("Second device", W - 46 - width / 2)):
        lw = draw.textlength(label, font=SUB_FONT)
        draw.text((cx - lw / 2, label_y), label, font=SUB_FONT, fill=SUBTLE)
    canvas.save(out, "PNG", optimize=True)


SCREENS = [
    ("01-calendar", "calendar", "Your shifts at a glance", "Monthly work calendar"),
    ("02-shift-editor", "editor", "Plan day and night shifts", "Times, location and notes"),
    ("03-draft-planner", "planner", "Draft first, confirm later", "Filter drafts and confirmed shifts"),
    ("04-excel-export", "export", "Export your shift plan", "Excel export with Foxory Plus"),
    ("05-roster-import", "import", "Import your roster", "Your row found, every shift reviewed"),
]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    httpd = serve(Path(sys.argv[1]))
    try:
        shots = capture()
    finally:
        httpd.shutdown()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    for filename, key, title, subtitle in SCREENS:
        frame_single(shots[key], title, subtitle, OUT / f"{filename}.png")
    frame_pair(
        shots["sync_a"], shots["sync_b"], "Your schedule across devices", "Sign in anywhere, same shifts",
        OUT / "06-sync-across-devices.png",
    )
    for path in sorted(OUT.glob("*.png")):
        img = Image.open(path)
        assert img.size == (W, H) and img.mode == "RGB", (path, img.size, img.mode)
        print(path.relative_to(ROOT), img.size, img.mode)


if __name__ == "__main__":
    main()
