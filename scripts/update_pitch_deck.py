import os
import shutil
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# Minimalist Gravity-Tech Editorial Palette on Official White Buildathon Base
COBALT_DEEP = RGBColor(0x0C, 0x0A, 0x9E)   # Bold primary display headlines & dark bars
COBALT = RGBColor(0x2B, 0x4B, 0xF2)        # Clean accent headings, rules, and bars
INK = RGBColor(0x11, 0x13, 0x17)           # Crisp black/charcoal text
MUTED = RGBColor(0x4B, 0x55, 0x63)         # Clean readable body gray
HAIRLINE = RGBColor(0xD1, 0xD5, 0xDB)      # Subtle 0.75pt divider lines
LIGHT_TINT = RGBColor(0xF8, 0xFA, 0xFC)    # Ultra-subtle clean surface when needed
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


def find_shape_by_id(slide, shape_id):
    for s in slide.shapes:
        if s.shape_id == shape_id:
            return s
    return None


def clear_placeholder(slide, shape_id):
    sp = find_shape_by_id(slide, shape_id)
    if sp is not None and sp.has_text_frame:
        sp.text_frame.clear()
        sp.left = Inches(0.02)
        sp.top = Inches(0.02)
        sp.width = Inches(0.02)
        sp.height = Inches(0.02)


def add_line(slide, x_in, y_in, w_in, color=HAIRLINE, thickness_pt=0.9):
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(x_in),
        Inches(y_in),
        Inches(w_in),
        Pt(thickness_pt),
    )
    line.fill.solid()
    line.fill.fore_color.rgb = color
    line.line.fill.background()
    line.shadow.inherit = False
    return line


def add_v_line(slide, x_in, y_in, h_in, color=HAIRLINE, thickness_pt=0.9):
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(x_in),
        Inches(y_in),
        Pt(thickness_pt),
        Inches(h_in),
    )
    line.fill.solid()
    line.fill.fore_color.rgb = color
    line.line.fill.background()
    line.shadow.inherit = False
    return line


def add_text(
    slide,
    x_in,
    y_in,
    w_in,
    h_in,
    text,
    size_pt=10.5,
    bold=False,
    color=INK,
    align=PP_ALIGN.LEFT,
    line_spacing=1.18,
    font_name="Google Sans",
):
    tb = slide.shapes.add_textbox(Inches(x_in), Inches(y_in), Inches(w_in), Inches(h_in))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0)
    tf.margin_right = Inches(0)
    tf.margin_top = Inches(0)
    tf.margin_bottom = Inches(0)
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    r = p.add_run()
    r.text = text
    r.font.name = font_name
    r.font.size = Pt(size_pt)
    r.font.bold = bold
    r.font.color.rgb = color
    return tb


def add_clean_image(slide, img_path, x_in, y_in, w_in=None, h_in=None):
    if not os.path.exists(img_path):
        return None
    if w_in is not None and h_in is not None:
        pic = slide.shapes.add_picture(img_path, Inches(x_in), Inches(y_in), width=Inches(w_in), height=Inches(h_in))
    elif w_in is not None:
        pic = slide.shapes.add_picture(img_path, Inches(x_in), Inches(y_in), width=Inches(w_in))
    else:
        pic = slide.shapes.add_picture(img_path, Inches(x_in), Inches(y_in), height=Inches(h_in))
    pic.line.color.rgb = HAIRLINE
    pic.line.width = Pt(0.75)
    pic.shadow.inherit = False
    return pic


def add_hairline_stack(slide, items, x_in=4.45, start_y_in=1.22, w_in=5.05, total_h_in=3.95):
    """
    Gravity Tech Layout B (ref_slide_3): Clean stacked sections separated ONLY by thin horizontal rules.
    Each item: (HEADING, body_text)
    """
    n = len(items)
    slot_h = total_h_in / n
    for idx, (head, body) in enumerate(items):
        y = start_y_in + idx * slot_h
        add_text(slide, x_in, y, w_in, 0.30, head, size_pt=11.5, bold=True, color=COBALT_DEEP)
        add_text(slide, x_in, y + 0.30, w_in, slot_h - 0.42, body, size_pt=9.8, bold=False, color=MUTED, line_spacing=1.22)
        add_line(slide, x_in, y + slot_h - 0.10, w_in, color=COBALT if idx == n - 1 else HAIRLINE, thickness_pt=0.9)


def add_four_clean_columns(slide, items, start_y_in=2.12, h_in=3.05):
    """
    Gravity Tech Layout D (ref_slide_7): 4 clean equal-width hairline-outlined columns.
    Each item: (HEADING, body_text)
    """
    total_w = 9.00
    gap = 0.20
    col_w = (total_w - gap * 3) / 4
    start_x = 0.50

    for idx, (head, body) in enumerate(items):
        x = start_x + idx * (col_w + gap)
        box = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(x),
            Inches(start_y_in),
            Inches(col_w),
            Inches(h_in),
        )
        box.adjustments[0] = 0.06
        box.fill.solid()
        box.fill.fore_color.rgb = WHITE
        box.line.color.rgb = COBALT if idx in (0, 2) else HAIRLINE
        box.line.width = Pt(0.9)
        box.shadow.inherit = False

        add_text(
            slide,
            x + 0.16,
            start_y_in + 0.22,
            col_w - 0.32,
            0.55,
            head,
            size_pt=10.5,
            bold=True,
            color=COBALT_DEEP,
            align=PP_ALIGN.LEFT,
            line_spacing=1.12,
        )
        add_line(slide, x + 0.16, start_y_in + 0.80, 0.45, color=COBALT, thickness_pt=1.5)
        add_text(
            slide,
            x + 0.16,
            start_y_in + 0.96,
            col_w - 0.32,
            h_in - 1.12,
            body,
            size_pt=9.2,
            bold=False,
            color=MUTED,
            align=PP_ALIGN.LEFT,
            line_spacing=1.22,
        )


def main():
    src_pptx = r"e:\Coders of Bharat\scripts\template_16slide.pptx"
    preview_dir = r"C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\deck_preview"

    out_final_pptx = r"e:\Coders of Bharat\Final Prototype Submission Deck _ Startup Buildathon.pptx"
    out_auto_pptx = r"e:\Coders of Bharat\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx"
    out_art_pptx = r"C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx"

    shot_home = os.path.join(preview_dir, "shot_home.png")
    shot_studio = os.path.join(preview_dir, "shot_studio.png")
    shot_xray = os.path.join(preview_dir, "shot_xray.png")
    shot_demo = os.path.join(preview_dir, "shot_demo.png")
    shot_tour = os.path.join(preview_dir, "shot_tour.png")
    cob_logo = r"e:\Coders of Bharat\public\images\coders-of-bharat-logo.png"

    prs = Presentation(src_pptx)

    # =========================================================================
    # SLIDE 2: TEAM IDENTITY & PROBLEM STATEMENT (Clean, Unboxed Editorial)
    # =========================================================================
    s2 = prs.slides[1]
    clear_placeholder(s2, 62)

    if os.path.exists(cob_logo):
        pic = s2.shapes.add_picture(cob_logo, Inches(0.55), Inches(3.22), width=Inches(1.80))
        pic.shadow.inherit = False

    add_text(s2, 0.55, 4.02, 2.95, 0.30, "TEAM NAME  ·  CODERS OF BHARAT", size_pt=10.5, bold=True, color=COBALT_DEEP)
    add_text(s2, 0.55, 4.35, 2.95, 0.28, "TEAM SIZE  ·  1 (Anirudh Verma)", size_pt=10.0, bold=False, color=INK)
    add_text(s2, 0.55, 4.66, 2.95, 0.28, "PRODUCT  ·  AutoPatch v1.0", size_pt=10.0, bold=False, color=MUTED)

    add_v_line(s2, 3.72, 3.28, 1.90, color=HAIRLINE, thickness_pt=1.0)

    add_text(s2, 4.05, 3.24, 5.40, 0.30, "PROBLEM STATEMENT", size_pt=11.0, bold=True, color=COBALT_DEEP)
    add_text(
        s2,
        4.05,
        3.58,
        5.40,
        1.65,
        "Third-party APIs (Razorpay, Stripe, ONDC Beckn) silently rename fields, nest objects, or shift data types inside HTTP 200 OK responses—crashing downstream production apps.\n\nAutoPatch is a self-healing reverse proxy powered by Google Gemini 2.0 Flash that repairs drifted JSON in 0.14 ms through 5 fail-closed safety gates and opens permanent TypeScript Pull Requests.",
        size_pt=10.2,
        bold=False,
        color=MUTED,
        line_spacing=1.24,
    )

    # =========================================================================
    # SLIDE 3: BRIEF ABOUT THE IDEA (Layout B — Giant Left Title + Right Hairline Stack)
    # =========================================================================
    s3 = prs.slides[2]
    clear_placeholder(s3, 67)

    add_text(s3, 0.50, 1.35, 3.60, 1.85, "BRIEF\nABOUT\nTHE IDEA", size_pt=36, bold=True, color=COBALT_DEEP, line_spacing=0.98)
    add_line(s3, 0.50, 3.35, 1.10, color=COBALT, thickness_pt=2.5)
    add_text(
        s3,
        0.50,
        3.58,
        3.45,
        1.40,
        "AutoPatch acts as an autonomous runtime airbag between your app and external APIs—eliminating 3 AM schema-drift outages.",
        size_pt=10.5,
        bold=False,
        color=MUTED,
        line_spacing=1.28,
    )

    add_hairline_stack(
        s3,
        [
            (
                "01  SILENT SCHEMA DRIFT",
                'When an upstream API renames "user_id" to "id", nests "email" inside "contact.email_addr", or changes 450.5 to "450.50", downstream apps crash immediately with TypeError.',
            ),
            (
                "02  0.14 MS SELF-HEALING PROXY",
                "AutoPatch strips all customer PII into type tokens, asks Google Gemini 2.0 Flash for a deterministic field mapping, validates it through 5 safety gates, and serves it from RAM in 0.14 ms.",
            ),
            (
                "03  PERMANENT GITHUB PULL REQUESTS",
                "While keeping live production traffic healthy in memory, AutoPatch generates a tested TypeScript adapter + node:test suite and opens a ready-to-merge GitHub PR.",
            ),
        ],
    )

    # =========================================================================
    # SLIDE 4: OPPORTUNITIES & USP (Layout A — Bold Header + 3 Clean Unboxed Columns)
    # =========================================================================
    s4 = prs.slides[3]
    clear_placeholder(s4, 73)

    add_text(s4, 0.50, 1.05, 9.00, 0.72, "OPPORTUNITIES & USP", size_pt=36, bold=True, color=COBALT_DEEP)
    add_line(s4, 0.50, 1.82, 9.00, color=HAIRLINE, thickness_pt=1.0)

    opp_cols = [
        (
            "HOW IT DIFFERS",
            "Legacy gateways (Kong, Envoy, Apigee) only check HTTP status codes and pass broken JSON inside 200 OK straight through.\n\nNaive LLM wrappers add ~2,000 ms per request, leak raw PII, and risk hallucinating financial numbers. AutoPatch calls Gemini once per drift shape and runs in 0.14 ms.",
        ),
        (
            "HOW IT SOLVES IT",
            "Repairs renamed keys, deep nesting, array wrappers, and type mutations in-flight so checkouts stay online without waking engineers.\n\nSeparates resource IDs (data_id) from identity IDs (user_id) and dispatches a verified TypeScript Pull Request to eliminate technical debt permanently.",
        ),
        (
            "OUR CORE USPs",
            "Zero-PII Redaction: Customer emails, IDs, and balances never leave local memory.\n\n30s Auto-Profiler: Passively learns baseline contracts from 200 OK traffic.\n\n5-Gate Fail-Closed Guard: Missing required financial fields return HTTP 502 instead of fabricated data.",
        ),
    ]

    for idx, (col_h, col_b) in enumerate(opp_cols):
        cx = 0.50 + idx * 3.12
        add_text(s4, cx, 2.06, 2.76, 0.35, col_h, size_pt=12.0, bold=True, color=COBALT)
        add_text(s4, cx, 2.48, 2.76, 2.75, col_b, size_pt=9.6, bold=False, color=MUTED, line_spacing=1.24)
        if idx < 2:
            add_v_line(s4, cx + 2.94, 2.08, 3.00, color=HAIRLINE, thickness_pt=0.75)

    # =========================================================================
    # SLIDE 5: LIST OF FEATURES (Layout C — Left Title & Summary + Right 4 Outlined Rows)
    # =========================================================================
    s5 = prs.slides[4]
    clear_placeholder(s5, 79)

    add_text(
        s5,
        0.50,
        1.30,
        3.55,
        1.15,
        "Built for high-throughput production APIs—combining sub-millisecond in-memory caching with strict deterministic verification.",
        size_pt=10.5,
        bold=False,
        color=MUTED,
        line_spacing=1.26,
    )
    add_text(s5, 0.50, 2.68, 3.60, 1.55, "KEY\nFEATURES", size_pt=40, bold=True, color=COBALT_DEEP, line_spacing=0.96)
    add_line(s5, 0.50, 4.35, 1.10, color=COBALT, thickness_pt=2.5)

    feat_rows = [
        ("0.14 MS SHA-1 RULE CACHE", "99.86% cache efficiency with zero per-request LLM calls or latency."),
        ("ZERO-PII STRUCTURAL SANITIZER", "Redacts emails, IDs, and balances to value-class tokens before Gemini."),
        ("5-GATE FAIL-CLOSED ENGINE", "Enforces 100% coverage, 1-to-1 path lock (data_id != user_id), and HTTP 502 guard."),
        ("AUTO-PROFILER & SHADOW / CANARY", "Learns contracts in 30s and rolls out safely via Shadow -> 5% Canary -> Active."),
        ("AI HEALING STUDIO & AUTO-PR", "Live webhook workbench (Razorpay, ONDC, Stripe) + tested TypeScript PRs."),
    ]

    for idx, (ft, fd) in enumerate(feat_rows):
        ry = 1.15 + idx * 0.82
        rbox = s5.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(4.35),
            Inches(ry),
            Inches(5.15),
            Inches(0.70),
        )
        rbox.adjustments[0] = 0.14
        rbox.fill.solid()
        rbox.fill.fore_color.rgb = WHITE
        rbox.line.color.rgb = COBALT if idx in (0, 2) else HAIRLINE
        rbox.line.width = Pt(0.9)
        rbox.shadow.inherit = False

        add_text(s5, 4.52, ry + 0.14, 0.42, 0.40, "↗", size_pt=18, bold=True, color=COBALT)
        add_text(s5, 4.95, ry + 0.10, 4.40, 0.24, ft, size_pt=10.2, bold=True, color=COBALT_DEEP)
        add_text(s5, 4.95, ry + 0.35, 4.40, 0.28, fd, size_pt=8.8, bold=False, color=MUTED)

    # =========================================================================
    # SLIDE 6: PROCESS FLOW DIAGRAM (Clean Minimalist 5-Step Flow + Outcome Split)
    # =========================================================================
    s6 = prs.slides[5]
    clear_placeholder(s6, 85)

    add_text(s6, 0.50, 1.00, 9.00, 0.58, "PROCESS FLOW", size_pt=32, bold=True, color=COBALT_DEEP, align=PP_ALIGN.CENTER)
    add_text(
        s6,
        0.50,
        1.56,
        9.00,
        0.30,
        "How AutoPatch intercepts, verifies, and heals a broken upstream API response in real time",
        size_pt=10.2,
        bold=False,
        color=MUTED,
        align=PP_ALIGN.CENTER,
    )

    steps = [
        ("01", "UPSTREAM 200", "Drifted JSON arrives with renamed or nested keys."),
        ("02", "SHA-1 CHECK", "Detects drift in <0.05 ms and hashes JSON structure."),
        ("03", "RAM CACHE", "Hit -> heals in 0.14 ms. Miss -> Single-Flight lock."),
        ("04", "GEMINI 2.0", "Receives Zero-PII tokens; returns AST rule."),
        ("05", "5 SAFETY GATES", "5/5 pass -> 200 OK + PR. Missing field -> 502."),
    ]

    sw = 1.64
    sgap = 0.20
    for idx, (num, st_h, st_b) in enumerate(steps):
        sx = 0.50 + idx * (sw + sgap)
        sy = 2.05
        box = s6.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(sx),
            Inches(sy),
            Inches(sw),
            Inches(1.62),
        )
        box.adjustments[0] = 0.08
        box.fill.solid()
        box.fill.fore_color.rgb = LIGHT_TINT if idx in (2, 4) else WHITE
        box.line.color.rgb = COBALT if idx in (2, 4) else HAIRLINE
        box.line.width = Pt(1.0)
        box.shadow.inherit = False

        add_text(s6, sx + 0.14, sy + 0.14, sw - 0.28, 0.28, num, size_pt=14, bold=True, color=COBALT)
        add_text(s6, sx + 0.14, sy + 0.46, sw - 0.28, 0.28, st_h, size_pt=9.6, bold=True, color=COBALT_DEEP)
        add_text(s6, sx + 0.14, sy + 0.78, sw - 0.28, 0.74, st_b, size_pt=8.6, bold=False, color=MUTED, line_spacing=1.18)

        if idx < len(steps) - 1:
            add_text(s6, sx + sw + 0.01, sy + 0.64, sgap - 0.02, 0.30, "→", size_pt=14, bold=True, color=COBALT, align=PP_ALIGN.CENTER)

    add_line(s6, 0.50, 3.94, 9.00, color=HAIRLINE, thickness_pt=0.9)

    add_text(s6, 0.50, 4.10, 4.20, 0.26, "FAST PATH  ·  99.86% CACHE HIT (0.14 MS)", size_pt=10.0, bold=True, color=COBALT_DEEP)
    add_text(
        s6,
        0.50,
        4.38,
        4.20,
        0.75,
        'Maps {"id":"usr_99", "balance":"450.50"} -> {"user_id":"usr_99", "account_balance":450.5} purely in RAM with 0 AI calls.',
        size_pt=9.2,
        bold=False,
        color=MUTED,
        line_spacing=1.20,
    )

    add_v_line(s6, 4.98, 4.10, 0.95, color=HAIRLINE, thickness_pt=0.8)

    add_text(s6, 5.25, 4.10, 4.25, 0.26, "FAIL-CLOSED GUARD  ·  MISSING FIELD (HTTP 502)", size_pt=10.0, bold=True, color=COBALT_DEEP)
    add_text(
        s6,
        5.25,
        4.38,
        4.25,
        0.75,
        "If an upstream bug deletes a required payment or user ID field, Gate 5 blocks the response with HTTP 502 instead of inventing data.",
        size_pt=9.2,
        bold=False,
        color=MUTED,
        line_spacing=1.20,
    )

    # =========================================================================
    # SLIDE 7: WIREFRAMES & LIVE SURFACES (Clean 3-Column Unframed Gallery)
    # =========================================================================
    s7 = prs.slides[6]
    clear_placeholder(s7, 91)

    add_text(s7, 0.50, 1.00, 9.00, 0.54, "WIREFRAMES & LIVE SURFACES", size_pt=30, bold=True, color=COBALT_DEEP)
    add_line(s7, 0.50, 1.62, 9.00, color=HAIRLINE, thickness_pt=0.9)

    surf_cols = [
        ("01  SAAS OVERVIEW (/)", shot_home, "Live KPI dashboard, 6-mode interactive drift simulator, and 1-click guided product tour."),
        ("02  OPERATOR CONSOLE (/console)", shot_xray, "Real-time traffic feed, 5-Gate Pipeline X-Ray, AI Healing Studio, and Auto-PR generator."),
        ("03  BILLING CLIENT (/demo)", shot_demo, "Live client demonstrating direct upstream TypeError crash vs. 0.14 ms proxy protection."),
    ]
    for idx, (st, simg, sdesc) in enumerate(surf_cols):
        sx = 0.50 + idx * 3.08
        add_clean_image(s7, simg, sx, 1.85, w_in=2.84)
        add_text(s7, sx, 3.76, 2.84, 0.28, st, size_pt=10.2, bold=True, color=COBALT_DEEP)
        add_text(s7, sx, 4.08, 2.84, 1.00, sdesc, size_pt=9.0, bold=False, color=MUTED, line_spacing=1.22)

    # =========================================================================
    # SLIDE 8: ARCHITECTURE DIAGRAM (Layout D — Centered Title + 4 Clean Columns)
    # =========================================================================
    s8 = prs.slides[7]
    clear_placeholder(s8, 97)

    add_text(s8, 0.50, 1.00, 9.00, 0.58, "SYSTEM ARCHITECTURE", size_pt=32, bold=True, color=COBALT_DEEP, align=PP_ALIGN.CENTER)
    add_text(
        s8,
        0.50,
        1.56,
        9.00,
        0.30,
        "Four decoupled engineering layers separating the 0.14 ms hot data-plane from Zero-PII AI control-plane",
        size_pt=10.2,
        bold=False,
        color=MUTED,
        align=PP_ALIGN.CENTER,
    )

    add_four_clean_columns(
        s8,
        [
            (
                "01  INGRESS &\nAUTO-PROFILER",
                "Fastify 5 reverse proxy intercepts HTTP JSON traffic.\n\nLEARN_MODE passively observes healthy 200 OK responses to lock baseline contracts automatically.",
            ),
            (
                "02  SHA-1 CACHE &\nSINGLE-FLIGHT",
                "Indexes verified rules in RAM by payload SHA-1 structure fingerprint (0.14 ms hit).\n\nCoalesces 200+ parallel cold misses into 1 AI inference call.",
            ),
            (
                "03  ZERO-PII &\nGEMINI 2.0 FLASH",
                "sanitizer.ts replaces emails, IDs, and numbers with value-class tokens.\n\nGemini 2.0 Flash outputs strict JSON Schema rules with 2.8s failover.",
            ),
            (
                "04  5-GATE ENGINE\n& AUTO-PR WORKER",
                "Verifies coverage, null safety, confidence >=70%, dry-run replay, and 1-to-1 path lock.\n\nRuns node:test and opens a GitHub PR asynchronously.",
            ),
        ],
    )

    # =========================================================================
    # SLIDE 9: TECHNOLOGIES USED (Layout D — Centered Title + 4 Clean Columns)
    # =========================================================================
    s9 = prs.slides[8]
    clear_placeholder(s9, 103)

    add_text(s9, 0.50, 1.00, 9.00, 0.58, "TECHNOLOGY STACK", size_pt=32, bold=True, color=COBALT_DEEP, align=PP_ALIGN.CENTER)
    add_text(
        s9,
        0.50,
        1.56,
        9.00,
        0.30,
        "Minimal, high-throughput TypeScript stack engineered for cloud-native and serverless deployment",
        size_pt=10.2,
        bold=False,
        color=MUTED,
        align=PP_ALIGN.CENTER,
    )

    add_four_clean_columns(
        s9,
        [
            (
                "GOOGLE AI &\nINFERENCE",
                "Google Gemini 2.0 Flash via @google/genai SDK with strict JSON Schema output.\n\nGoogle AI Studio for prompt tuning + 2.8s failover to Groq & Semantic AST.",
            ),
            (
                "PROXY CORE &\nVALIDATION",
                "Node.js 22 LTS, TypeScript, and Fastify 5.12 raw-buffer HTTP proxy.\n\nZod 4.6 contract validation, SHA-1 fingerprinting, and WebSocket telemetry.",
            ),
            (
                "AUTOMATION &\nCODEGEN",
                "In-process TypeScript adapter synthesizer + isolated node:test runner.\n\n@octokit/rest v22 for autonomous branch, commit, and GitHub PR creation.",
            ),
            (
                "CLOUD, UI &\nSTRESS TESTING",
                "Zero-dependency ES module SaaS UI with Canvas ECG oscilloscope.\n\nDocker, Google Cloud Run, Vercel Serverless, and 99 Vitest automated tests.",
            ),
        ],
    )

    # =========================================================================
    # SLIDE 10: ESTIMATED IMPLEMENTATION COST (Layout E — Left Flat Cobalt Chart + Right 2 Points)
    # =========================================================================
    s10 = prs.slides[9]
    clear_placeholder(s10, 109)

    add_text(s10, 0.50, 1.00, 9.00, 0.58, "COST & UNIT ECONOMICS", size_pt=32, bold=True, color=COBALT_DEEP)
    add_line(s10, 0.50, 1.66, 9.00, color=HAIRLINE, thickness_pt=0.9)

    # Left: Clean Minimalist Flat Cobalt Bar Chart (like Gravity Tech's flat blue bars)
    chart_box = s10.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(0.50),
        Inches(1.92),
        Inches(4.45),
        Inches(3.25),
    )
    chart_box.adjustments[0] = 0.05
    chart_box.fill.solid()
    chart_box.fill.fore_color.rgb = LIGHT_TINT
    chart_box.line.color.rgb = HAIRLINE
    chart_box.line.width = Pt(0.8)
    chart_box.shadow.inherit = False

    add_text(s10, 0.72, 2.08, 4.00, 0.28, "MONTHLY OPERATING COST BY SCALE (USD)", size_pt=9.2, bold=True, color=COBALT_DEEP)

    bars = [
        ("STARTUP\n(100K req)", "$0", 0.28, COBALT),
        ("GROWTH\n(10M req)", "$20", 0.85, COBALT),
        ("ENTERPRISE\n(100M+ req)", "$165", 1.75, COBALT_DEEP),
    ]
    base_y = 4.48
    for idx, (blbl, bval, bh, bcol) in enumerate(bars):
        bx = 0.92 + idx * 1.32
        bw = 0.86
        bar = s10.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(bx),
            Inches(base_y - bh),
            Inches(bw),
            Inches(bh),
        )
        bar.adjustments[0] = 0.08
        bar.fill.solid()
        bar.fill.fore_color.rgb = bcol
        bar.line.fill.background()
        bar.shadow.inherit = False

        add_text(s10, bx, base_y - bh - 0.28, bw, 0.25, bval, size_pt=12.0, bold=True, color=bcol, align=PP_ALIGN.CENTER)
        add_text(s10, bx - 0.12, base_y + 0.08, bw + 0.24, 0.45, blbl, size_pt=8.2, bold=True, color=MUTED, align=PP_ALIGN.CENTER)

    add_line(s10, 0.75, base_y + 0.02, 3.95, color=HAIRLINE, thickness_pt=0.9)

    # Right: 2 Clean Unboxed Points
    add_hairline_stack(
        s10,
        [
            (
                "NEAR-ZERO AI TOKEN COST (99.86% CACHE)",
                "Gemini 2.0 Flash is only invoked once per unique schema drift shape. 1,000,000 API requests with 10 breaking schema changes require just 10 Gemini calls (<$0.001/mo).",
            ),
            (
                "ULTRA-LIGHT COMPUTE FOOTPRINT",
                "Cached healing runs in 0.14 ms in RAM with bounded O(1) memory—one 2-vCPU Google Cloud Run container (~$18/mo) handles 5,000+ req/sec.",
            ),
            (
                "IMMEDIATE CUSTOMER ROI",
                "Preventing even a single 3.5-hour checkout outage saves $14,280+ in lost revenue and engineering firefights—paying for years of infrastructure.",
            ),
        ],
        x_in=5.28,
        start_y_in=1.94,
        w_in=4.22,
        total_h_in=3.24,
    )

    # =========================================================================
    # SLIDE 11: SNAPSHOTS OF THE PROTOTYPE (Clean Minimalist 2x2 Grid)
    # =========================================================================
    s11 = prs.slides[10]
    clear_placeholder(s11, 115)

    add_text(s11, 0.50, 0.92, 9.00, 0.46, "PROTOTYPE SNAPSHOTS", size_pt=26, bold=True, color=COBALT_DEEP)
    add_line(s11, 0.50, 1.42, 9.00, color=HAIRLINE, thickness_pt=0.8)

    gallery = [
        ("01  SAAS OVERVIEW & DRIFT SIMULATOR (/)", shot_home),
        ("02  5-GATE PIPELINE X-RAY (/console)", shot_xray),
        ("03  UNIVERSAL AI HEALING STUDIO (/console)", shot_studio),
        ("04  INTERACTIVE STEP-BY-STEP PRODUCT TOUR", shot_tour),
    ]
    for idx, (gcap, gimg) in enumerate(gallery):
        r = idx // 2
        c = idx % 2
        gx = 0.50 + c * 4.62
        gy = 1.56 + r * 1.92
        add_clean_image(s11, gimg, gx, gy, h_in=1.55)
        add_text(s11, gx, gy + 1.60, 4.35, 0.24, gcap, size_pt=8.8, bold=True, color=COBALT_DEEP)

    # =========================================================================
    # SLIDE 12: PERFORMANCE REPORT / BENCHMARKING (Layout E — Left Metrics Visual + Right Stack)
    # =========================================================================
    s12 = prs.slides[11]
    clear_placeholder(s12, 121)

    add_text(s12, 0.50, 1.00, 9.00, 0.56, "PERFORMANCE BENCHMARKING", size_pt=30, bold=True, color=COBALT_DEEP)
    add_line(s12, 0.50, 1.64, 9.00, color=HAIRLINE, thickness_pt=0.9)

    # Left: Clean Big KPI Grid (2x2 clean typographic numbers on subtle tint, zero clutter)
    kpis = [
        ("0.14 ms", "MEDIAN CACHED HEAL (p50)", "99.86% faster than cold AI inference"),
        ("200 / 200", "THUNDERING HERD BURST", "1 single AI call via Single-Flight lock"),
        ("99 / 99", "AUTOMATED VITEST TESTS", "14 test suites passing with zero errors"),
        ("0 Bytes", "PII SENT TO EXTERNAL AI", "100% redacted to structural tokens"),
    ]
    for idx, (knum, klbl, ksub) in enumerate(kpis):
        kr = idx // 2
        kc = idx % 2
        kx = 0.50 + kc * 2.26
        ky = 1.90 + kr * 1.66
        kbox = s12.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(kx),
            Inches(ky),
            Inches(2.12),
            Inches(1.50),
        )
        kbox.adjustments[0] = 0.07
        kbox.fill.solid()
        kbox.fill.fore_color.rgb = LIGHT_TINT
        kbox.line.color.rgb = COBALT if idx in (0, 1) else HAIRLINE
        kbox.line.width = Pt(0.9)
        kbox.shadow.inherit = False

        add_text(s12, kx + 0.16, ky + 0.18, 1.80, 0.50, knum, size_pt=24, bold=True, color=COBALT_DEEP if idx % 2 == 0 else COBALT)
        add_text(s12, kx + 0.16, ky + 0.76, 1.80, 0.28, klbl, size_pt=8.2, bold=True, color=INK)
        add_text(s12, kx + 0.16, ky + 1.04, 1.80, 0.36, ksub, size_pt=8.0, bold=False, color=MUTED)

    add_hairline_stack(
        s12,
        [
            (
                "300-REQUEST MULTI-DRIFT BURST",
                "Completed 300 rapid requests across all 6 drift modes (rename, nest, type shift, array wrap, combo_v2, field_deleted) in 402 ms total with zero errors.",
            ),
            (
                "SECURITY & FUZZING HARDENED",
                "Hardened against 60-level deep JSON bombs (MAX_DEPTH=16), prototype pollution (__proto__/constructor filtering), and bounded 1,000-sample memory windows.",
            ),
            (
                "VS. MANUAL HOTFIX & NAIVE PROXIES",
                "Reduces 3.5-hour manual MTTR to 0.14 ms while avoiding the ~1,850 ms latency, PII leaks, and hallucination risks of per-request LLM wrappers.",
            ),
        ],
        x_in=5.20,
        start_y_in=1.90,
        w_in=4.30,
        total_h_in=3.26,
    )

    # =========================================================================
    # SLIDE 13: FUTURE DEVELOPMENT (Layout B — Left Giant Title + Right Hairline Stack)
    # =========================================================================
    s13 = prs.slides[12]
    clear_placeholder(s13, 127)

    add_text(s13, 0.50, 1.35, 3.60, 1.65, "FUTURE\nROADMAP", size_pt=38, bold=True, color=COBALT_DEEP, line_spacing=0.98)
    add_line(s13, 0.50, 3.00, 1.10, color=COBALT, thickness_pt=2.5)
    add_text(
        s13,
        0.50,
        3.22,
        3.45,
        1.50,
        "Expanding autonomous API contract resilience across regulated banking VPCs, GraphQL/gRPC, and Kubernetes service meshes.",
        size_pt=10.5,
        bold=False,
        color=MUTED,
        line_spacing=1.28,
    )

    add_hairline_stack(
        s13,
        [
            (
                "01  AIR-GAPPED GEMMA 2 VPC SIDECARS",
                "Deploy quantized Gemma 2 containers on Google Cloud Run / GKE sidecars so RBI/PCI-DSS regulated enterprises run schema healing with zero external egress.",
            ),
            (
                "02  GRAPHQL, GRPC & PROTOBUF DRIFT",
                "Extend SHA-1 structural fingerprinting and 5-Gate verification beyond REST/JSON to GraphQL resolvers, gRPC protobufs, and Kafka Avro streams.",
            ),
            (
                "03  ENVOY WASM FILTER & MULTI-LANGUAGE PRS",
                "Package the 0.14 ms rule cache as a native WebAssembly filter for Envoy/Istio and generate automated Python (Pydantic), Go, and Java Pull Requests.",
            ),
        ],
    )

    # =========================================================================
    # SLIDE 14: GOOGLE AI INTEGRATION (Layout E — Left Studio Shot + Right Clean Stack)
    # =========================================================================
    s14 = prs.slides[13]

    add_text(s14, 0.50, 1.00, 9.00, 0.56, "GOOGLE AI INTEGRATION", size_pt=30, bold=True, color=COBALT_DEEP)
    add_line(s14, 0.50, 1.64, 9.00, color=HAIRLINE, thickness_pt=0.9)

    add_clean_image(s14, shot_studio, 0.50, 1.94, w_in=4.48)
    add_text(s14, 0.50, 4.84, 4.48, 0.30, "05 AI HEALING STUDIO  ·  LIVE WEBHOOK SANDBOX (/console)", size_pt=8.6, bold=True, color=MUTED)

    add_hairline_stack(
        s14,
        [
            (
                "GEMINI 2.0 FLASH (@GOOGLE/GENAI)",
                "Drives cold-path JSON AST diffing using strict responseSchema (temperature 0.1) to map renames, array wraps, and Unix epoch timestamps cleanly.",
            ),
            (
                "GOOGLE AI STUDIO & ZERO-PII PIPELINE",
                "Engineered prompts in Google AI Studio over Zero-PII value-class skeletons; auto-binds GEMINI_API_KEY and GOOGLE_API_KEY in Cloud Run.",
            ),
            (
                "GOOGLE ANTIGRAVITY & AGENT SKILLS",
                "Orchestrated full-stack engineering, live browser visual audits, and our 99-test production stress suite using Antigravity workflows.",
            ),
        ],
        x_in=5.24,
        start_y_in=1.94,
        w_in=4.26,
        total_h_in=3.20,
    )

    # =========================================================================
    # SLIDE 15: EDGE-CASE DEFENSE (Layout B — Giant Left Title + Right Hairline Stack)
    # =========================================================================
    s15 = prs.slides[14]

    add_text(s15, 0.50, 1.35, 3.65, 1.65, "ZERO DATA\nCORRUPTION", size_pt=36, bold=True, color=COBALT_DEEP, line_spacing=0.98)
    add_line(s15, 0.50, 3.00, 1.10, color=COBALT, thickness_pt=2.5)
    add_text(
        s15,
        0.50,
        3.22,
        3.45,
        1.55,
        "How AutoPatch handles the hardest production edge case: payloads containing both data_id and user_id, or deleted required fields.",
        size_pt=10.5,
        bold=False,
        color=MUTED,
        line_spacing=1.28,
    )

    add_hairline_stack(
        s15,
        [
            (
                "ENTITY-DOMAIN DISAMBIGUATION",
                "Separates resource/transaction tokens (data_id, record_id, order_id) from user identity tokens (user_id, customer.uid) so generic record IDs never overwrite user foreign keys.",
            ),
            (
                "GATE 5  ·  1-TO-1 SOURCE PATH LOCK",
                "Enforces a strict mathematical bijection: two required target fields can never copy from the same upstream source path.",
            ),
            (
                "FAIL-CLOSED HTTP 502 QUARANTINE",
                "When user_id or a required financial balance is deleted upstream, AutoPatch refuses to guess or copy data_id—returning HTTP 502 with exact diagnostics.",
            ),
        ],
    )

    prs.save(out_final_pptx)
    shutil.copyfile(out_final_pptx, out_auto_pptx)
    shutil.copyfile(out_final_pptx, out_art_pptx)
    print(f"Generated clean Gravity-Tech-style 16-slide deck: {out_final_pptx} ({os.path.getsize(out_final_pptx)} bytes)")


if __name__ == "__main__":
    main()
