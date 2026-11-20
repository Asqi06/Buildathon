import os
import shutil
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

BLUE = RGBColor(0x1A, 0x73, 0xE8)
TEAL = RGBColor(0x1E, 0x8E, 0x83)
TEAL_BRIGHT = RGBColor(0x3B, 0xB8, 0xAC)
TEAL_TINT = RGBColor(0xEA, 0xF8, 0xF6)
BLUE_TINT = RGBColor(0xEE, 0xF4, 0xFE)
DARK = RGBColor(0x11, 0x13, 0x17)
CHARCOAL = RGBColor(0x20, 0x21, 0x24)
SLATE = RGBColor(0x47, 0x54, 0x67)
CARD_BG = RGBColor(0xF6, 0xF8, 0xFA)
BORDER_GRAY = RGBColor(0xD8, 0xE2, 0xEB)
BORDER_TEAL = RGBColor(0x9E, 0xDF, 0xD7)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


def find_shape_by_id(slide, shape_id):
    for s in slide.shapes:
        if s.shape_id == shape_id:
            return s
    return None


def set_shape_box(shape, left_in, top_in, width_in, height_in):
    shape.left = Inches(left_in)
    shape.top = Inches(top_in)
    shape.width = Inches(width_in)
    shape.height = Inches(height_in)


def clear_placeholder_text(slide, shape_id):
    sp = find_shape_by_id(slide, shape_id)
    if sp is not None and sp.has_text_frame:
        sp.text_frame.clear()
        set_shape_box(sp, 0.1, 0.1, 0.1, 0.1)


def add_feature_cards(slide, cards, left_in=0.42, start_top_in=1.56, width_in=5.22):
    """
    Renders a stack of modern rounded SaaS cards on the left column of a slide.
    Each item in cards: (badge_text, title_text, body_text, is_teal_highlight)
    """
    count = len(cards)
    total_h = 3.74
    gap = 0.09
    card_h = (total_h - gap * (count - 1)) / count

    for i, (badge, title, body, highlight) in enumerate(cards):
        top = start_top_in + i * (card_h + gap)

        # Card container
        box = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(left_in),
            Inches(top),
            Inches(width_in),
            Inches(card_h),
        )
        box.adjustments[0] = 0.08
        box.fill.solid()
        box.fill.fore_color.rgb = TEAL_TINT if highlight else CARD_BG
        box.line.color.rgb = BORDER_TEAL if highlight else BORDER_GRAY
        box.line.width = Pt(1)

        # Left accent bar
        bar = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(left_in + 0.09),
            Inches(top + 0.10),
            Inches(0.06),
            Inches(card_h - 0.20),
        )
        bar.fill.solid()
        bar.fill.fore_color.rgb = TEAL if highlight else BLUE
        bar.line.fill.background()

        # Text inside card
        tb = slide.shapes.add_textbox(
            Inches(left_in + 0.20),
            Inches(top + 0.05),
            Inches(width_in - 0.28),
            Inches(card_h - 0.10),
        )
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.02)
        tf.margin_right = Inches(0.02)
        tf.margin_top = Inches(0.02)
        tf.margin_bottom = Inches(0.02)

        p1 = tf.paragraphs[0]
        p1.space_after = Pt(2)
        p1.line_spacing = 1.08

        r_badge = p1.add_run()
        r_badge.text = f"[{badge}]  "
        r_badge.font.name = "Google Sans"
        r_badge.font.size = Pt(8.2)
        r_badge.font.bold = True
        r_badge.font.color.rgb = TEAL if highlight else BLUE

        r_title = p1.add_run()
        r_title.text = title
        r_title.font.name = "Google Sans"
        r_title.font.size = Pt(9.3)
        r_title.font.bold = True
        r_title.font.color.rgb = DARK

        p2 = tf.add_paragraph()
        p2.line_spacing = 1.10
        r_body = p2.add_run()
        r_body.text = body
        r_body.font.name = "Google Sans"
        r_body.font.size = Pt(8.4)
        r_body.font.bold = False
        r_body.font.color.rgb = SLATE


def add_screenshot_showcase(
    slide,
    img_path,
    kicker_badge,
    caption_title,
    caption_sub,
    metric_pills,
    left_in=5.82,
    top_in=1.56,
    width_in=3.78,
):
    """
    Renders a sleek SaaS showcase frame on the right column with a screenshot,
    caption, and metric pills at the bottom.
    """
    card_h = 3.74
    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(left_in),
        Inches(top_in),
        Inches(width_in),
        Inches(card_h),
    )
    card.adjustments[0] = 0.05
    card.fill.solid()
    card.fill.fore_color.rgb = CARD_BG
    card.line.color.rgb = BORDER_TEAL
    card.line.width = Pt(1.25)

    # Top dark browser header strip inside card
    hdr = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(left_in + 0.10),
        Inches(top_in + 0.09),
        Inches(width_in - 0.20),
        Inches(0.26),
    )
    hdr.adjustments[0] = 0.3
    hdr.fill.solid()
    hdr.fill.fore_color.rgb = DARK
    hdr.line.fill.background()

    htf = hdr.text_frame
    htf.margin_left = Inches(0.10)
    htf.margin_top = Inches(0.02)
    hp = htf.paragraphs[0]
    hr1 = hp.add_run()
    hr1.text = "● ● ●   "
    hr1.font.name = "Google Sans"
    hr1.font.size = Pt(7.5)
    hr1.font.color.rgb = TEAL_BRIGHT
    hr2 = hp.add_run()
    hr2.text = kicker_badge
    hr2.font.name = "Google Sans"
    hr2.font.size = Pt(7.8)
    hr2.font.bold = True
    hr2.font.color.rgb = WHITE

    # Screenshot image
    if os.path.exists(img_path):
        slide.shapes.add_picture(
            img_path,
            Inches(left_in + 0.10),
            Inches(top_in + 0.39),
            width=Inches(width_in - 0.20),
        )

    # Caption text below screenshot
    tb = slide.shapes.add_textbox(
        Inches(left_in + 0.12),
        Inches(top_in + 2.66),
        Inches(width_in - 0.24),
        Inches(0.70),
    )
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.02)
    tf.margin_right = Inches(0.02)
    tf.margin_top = Inches(0.02)

    p1 = tf.paragraphs[0]
    p1.space_after = Pt(2)
    r1 = p1.add_run()
    r1.text = caption_title
    r1.font.name = "Google Sans"
    r1.font.size = Pt(9.5)
    r1.font.bold = True
    r1.font.color.rgb = DARK

    p2 = tf.add_paragraph()
    p2.line_spacing = 1.10
    r2 = p2.add_run()
    r2.text = caption_sub
    r2.font.name = "Google Sans"
    r2.font.size = Pt(8.2)
    r2.font.color.rgb = SLATE

    # Bottom metric pills row
    if metric_pills:
        pill_w = (width_in - 0.24 - 0.08 * (len(metric_pills) - 1)) / len(metric_pills)
        for idx, pill_text in enumerate(metric_pills):
            px = left_in + 0.12 + idx * (pill_w + 0.08)
            py = top_in + 3.38
            pbox = slide.shapes.add_shape(
                MSO_SHAPE.ROUNDED_RECTANGLE,
                Inches(px),
                Inches(py),
                Inches(pill_w),
                Inches(0.26),
            )
            pbox.adjustments[0] = 0.5
            pbox.fill.solid()
            pbox.fill.fore_color.rgb = TEAL_TINT if idx == 0 else BLUE_TINT
            pbox.line.color.rgb = BORDER_TEAL if idx == 0 else BORDER_GRAY
            pbox.line.width = Pt(0.75)

            ptf = pbox.text_frame
            ptf.margin_left = Inches(0.04)
            ptf.margin_right = Inches(0.04)
            ptf.margin_top = Inches(0.02)
            pp = ptf.paragraphs[0]
            pp.alignment = PP_ALIGN.CENTER
            pr = pp.add_run()
            pr.text = pill_text
            pr.font.name = "Google Sans"
            pr.font.size = Pt(7.6)
            pr.font.bold = True
            pr.font.color.rgb = TEAL if idx == 0 else BLUE


def main():
    src_pptx = r"C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\.user_uploaded\media_1794732186657_66d5d2d1.pptx"
    preview_dir = r"C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\deck_preview"
    out_pptx_workspace = r"e:\Coders of Bharat\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx"
    out_pptx_artifacts = r"C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx"

    shot_home = os.path.join(preview_dir, "shot_home.png")
    shot_studio = os.path.join(preview_dir, "shot_studio.png")
    shot_xray = os.path.join(preview_dir, "shot_xray.png")
    shot_demo = os.path.join(preview_dir, "shot_demo.png")
    shot_tour = os.path.join(preview_dir, "shot_tour.png")
    cob_logo = r"e:\Coders of Bharat\public\images\coders-of-bharat-logo.png"

    prs = Presentation(src_pptx)

    # =========================================================================
    # SLIDE 2: TEAM IDENTITY & PROBLEM STATEMENT BENTO LAYOUT
    # =========================================================================
    s2 = prs.slides[1]
    clear_placeholder_text(s2, 62)

    # Left Card: Team Identity & Brand Card
    left_card = s2.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(0.55),
        Inches(3.05),
        Inches(3.10),
        Inches(2.25),
    )
    left_card.adjustments[0] = 0.06
    left_card.fill.solid()
    left_card.fill.fore_color.rgb = CARD_BG
    left_card.line.color.rgb = BORDER_GRAY
    left_card.line.width = Pt(1.2)

    if os.path.exists(cob_logo):
        s2.shapes.add_picture(cob_logo, Inches(0.75), Inches(3.16), width=Inches(1.75))

    tb_team = s2.shapes.add_textbox(Inches(0.72), Inches(3.88), Inches(2.78), Inches(1.32))
    tf_team = tb_team.text_frame
    tf_team.word_wrap = True
    for idx, (k, v, col) in enumerate([
        ("Team Name: ", "Coders of Bharat", BLUE),
        ("Team Size: ", "1 (Anirudh Verma)", DARK),
        ("Product: ", "AutoPatch v1.0 SaaS", TEAL),
    ]):
        p = tf_team.paragraphs[0] if idx == 0 else tf_team.add_paragraph()
        p.space_after = Pt(4)
        r1 = p.add_run()
        r1.text = k
        r1.font.name = "Google Sans"
        r1.font.size = Pt(10.5)
        r1.font.bold = True
        r1.font.color.rgb = SLATE
        r2 = p.add_run()
        r2.text = v
        r2.font.name = "Google Sans"
        r2.font.size = Pt(11.0)
        r2.font.bold = True
        r2.font.color.rgb = col

    # Right Card: Problem Statement & Executive Summary Card
    right_card = s2.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(3.82),
        Inches(3.05),
        Inches(5.65),
        Inches(2.25),
    )
    right_card.adjustments[0] = 0.06
    right_card.fill.solid()
    right_card.fill.fore_color.rgb = TEAL_TINT
    right_card.line.color.rgb = BORDER_TEAL
    right_card.line.width = Pt(1.2)

    tb_prob = s2.shapes.add_textbox(Inches(4.02), Inches(3.16), Inches(5.28), Inches(2.05))
    tf_prob = tb_prob.text_frame
    tf_prob.word_wrap = True

    p_hdr = tf_prob.paragraphs[0]
    p_hdr.space_after = Pt(4)
    r_hdr = p_hdr.add_run()
    r_hdr.text = "PROBLEM STATEMENT & SOLUTION OVERVIEW"
    r_hdr.font.name = "Google Sans"
    r_hdr.font.size = Pt(9.5)
    r_hdr.font.bold = True
    r_hdr.font.color.rgb = TEAL

    p_b1 = tf_prob.add_paragraph()
    p_b1.space_after = Pt(6)
    p_b1.line_spacing = 1.15
    rb1_k = p_b1.add_run()
    rb1_k.text = "Problem Statement: "
    rb1_k.font.name = "Google Sans"
    rb1_k.font.size = Pt(10.5)
    rb1_k.font.bold = True
    rb1_k.font.color.rgb = DARK
    rb1_v = p_b1.add_run()
    rb1_v.text = (
        "Third-party APIs (Razorpay, Stripe, ONDC Beckn) silently rename fields, nest objects, or change data types inside valid HTTP 200 OK responses—crashing downstream production apps and causing 3.5 hours of emergency downtime."
    )
    rb1_v.font.name = "Google Sans"
    rb1_v.font.size = Pt(10.0)
    rb1_v.font.color.rgb = CHARCOAL

    p_b2 = tf_prob.add_paragraph()
    p_b2.line_spacing = 1.15
    rb2_k = p_b2.add_run()
    rb2_k.text = "Our Solution (AutoPatch): "
    rb2_k.font.name = "Google Sans"
    rb2_k.font.size = Pt(10.5)
    rb2_k.font.bold = True
    rb2_k.font.color.rgb = BLUE
    rb2_v = p_b2.add_run()
    rb2_v.text = (
        "An autonomous self-healing reverse proxy that intercepts schema drift in real time, uses Google Gemini 2.0 Flash on Zero-PII payload skeletons to synthesize verified mapping rules, heals responses in 0.14 ms from RAM, and opens permanent TypeScript GitHub Pull Requests."
    )
    rb2_v.font.name = "Google Sans"
    rb2_v.font.size = Pt(10.0)
    rb2_v.font.color.rgb = CHARCOAL

    # =========================================================================
    # SLIDE 3: PROBLEM STATEMENT
    # =========================================================================
    s3 = prs.slides[2]
    sp68 = find_shape_by_id(s3, 68)
    if sp68:
        set_shape_box(sp68, 0.42, 0.72, 8.5, 0.62)
    clear_placeholder_text(s3, 69)

    add_feature_cards(
        s3,
        [
            (
                "01 · SILENT DRIFT",
                "What Goes Wrong in Real Production APIs",
                'External APIs (Razorpay, Stripe, ONDC Beckn) silently mutate JSON responses without bumping versions—e.g. renaming "user_id" -> "id", nesting "email" -> "contact.email_addr", or changing 450.5 -> "450.50".',
                True,
            ),
            (
                "02 · CLIENT CRASH",
                "Immediate Downstream TypeError & Dropped Orders",
                "Checkout and billing microservices expect the locked baseline contract. A single renamed or moved key triggers runtime TypeErrors or Zod/Pydantic validation crashes on live customer traffic.",
                False,
            ),
            (
                "03 · GATEWAY BLINDSPOT",
                "Why Traditional API Gateways Cannot Stop It",
                "Legacy gateways (Kong, Envoy, Apigee) only inspect HTTP status codes (200 vs 500). Because schema drift arrives inside a valid HTTP 200 OK response, gateways forward the broken JSON straight through.",
                False,
            ),
            (
                "04 · 3.5H DOWNTIME",
                "Costly 3 AM Engineering Firefights (MTTR)",
                "On-call engineers are paged mid-sleep to dig through payload logs, write manual adapter shims, and run emergency CI/CD deploys for a simple upstream field rename.",
                False,
            ),
        ],
    )

    add_screenshot_showcase(
        s3,
        shot_demo,
        "LIVE PROOF SURFACE · /demo (ACME BILLING)",
        "Direct Upstream Crash vs. AutoPatch 0.14 ms Recovery",
        "Toggling between Direct Upstream and Via AutoPatch proves how unhealed schema drift crashes the client while AutoPatch keeps checkout online.",
        ["3.5h MTTR -> 0.14 ms", "Zero Client Code Changes"],
    )

    # =========================================================================
    # SLIDE 4: PROPOSED SOLUTION
    # =========================================================================
    s4 = prs.slides[3]
    sp75 = find_shape_by_id(s4, 75)
    if sp75:
        set_shape_box(sp75, 0.42, 0.72, 8.5, 0.62)
    clear_placeholder_text(s4, 76)

    add_feature_cards(
        s4,
        [
            (
                "STEP 01 · INTERCEPT",
                "Drop-In Self-Healing Reverse Proxy (<0.05 ms)",
                "Deploys in front of any API with 1 command and zero SDK changes. Healthy responses pass through in <0.05 ms; drifted JSON responses are caught in-flight before reaching the client.",
                False,
            ),
            (
                "STEP 02 · HEAL & CACHE",
                "Zero-PII Gemini 2.0 Flash -> 0.14 ms RAM Cache",
                "Strips all raw PII, asks Google Gemini 2.0 Flash for a deterministic mapping rule, verifies it through 5 safety gates, and caches it by SHA-1 structural fingerprint—healing future requests in 0.14 ms.",
                True,
            ),
            (
                "STEP 03 · ONBOARD",
                "30-Second Zero-Config LEARN_MODE & Canary Rollout",
                "Passively observes healthy 200 OK traffic to auto-infer contracts without manual YAML writing. Teams roll out safely via Shadow Mode (observe only) -> 5% Canary -> 100% Active Heal.",
                False,
            ),
            (
                "STEP 04 · PERMANENT FIX",
                "Autonomous TypeScript Adapter & GitHub PR",
                "While keeping live traffic healthy in memory, AutoPatch synthesizes a dependency-free TypeScript adapter + node:test suite, verifies it in-process, and opens a GitHub Pull Request.",
                False,
            ),
        ],
    )

    add_screenshot_showcase(
        s4,
        shot_home,
        "LIVE SAAS PLATFORM · / (AUTOPATCH OVERVIEW)",
        "Real-Time KPI Dashboard, Drift Lab & Interactive Tour",
        "Designed for instant clarity: live revenue protection telemetry, 6-scenario drift simulator, and an interactive step-by-step product walkthrough.",
        ["0.14 ms Hot Cache", "99.86% Cache Efficiency"],
    )

    # =========================================================================
    # SLIDE 5: SOLUTION ARCHITECTURE
    # =========================================================================
    s5 = prs.slides[4]
    sp82 = find_shape_by_id(s5, 82)
    if sp82:
        set_shape_box(sp82, 0.42, 0.72, 8.5, 0.62)
    clear_placeholder_text(s5, 83)

    add_feature_cards(
        s5,
        [
            (
                "LAYER 01 · PRIVACY",
                "Zero-PII Structural Sanitizer (sanitizer.ts)",
                'Replaces 100% of raw customer emails, IDs, and balances with structural value-class tokens ("string:email_like", "number:float", "number:epoch_like") in local RAM before any LLM call.',
                False,
            ),
            (
                "LAYER 02 · ENTITY LOCK",
                "Entity Disambiguation (data_id vs user_id)",
                "How do we prevent mixing up data_id and user_id? AutoPatch separates user/account entity tokens from record/order/transaction tokens so generic record IDs never overwrite user foreign keys.",
                True,
            ),
            (
                "LAYER 03 · 5 GATES",
                "Fail-Closed 5-Gate Engine & 1-to-1 Path Lock",
                "Enforces (1) 100% Schema Coverage, (2) Null Safety, (3) Confidence >= 70%, (4) Dry-Run Replay, and (5) Zero Hallucination + 1-to-1 Source Path Exclusivity (deleted financial fields fail closed with HTTP 502).",
                True,
            ),
            (
                "LAYER 04 · CONCURRENCY",
                "200-Request Single-Flight Deduplication",
                "When 200 concurrent requests hit a cold drifted route at once, Single-Flight Deduplication coalesces them into 1 single AI inference call and heals all 200 requests simultaneously.",
                False,
            ),
        ],
    )

    add_screenshot_showcase(
        s5,
        shot_xray,
        "OPERATOR CONSOLE · /console (03 PIPELINE X-RAY)",
        "5-Gate Verification X-Ray & 3-Column JSON Suture Diff",
        "Shows every gate check (Coverage, Null Safety, Confidence, Replay, Zero Hallucination) alongside Raw Drift -> Healed JSON -> TypeScript Adapter.",
        ["5/5 Gates Fail-Closed", "Zero PII Transmitted"],
    )

    # =========================================================================
    # SLIDE 6: GOOGLE AI TOOLS
    # =========================================================================
    s6 = prs.slides[5]
    sp89 = find_shape_by_id(s6, 89)
    if sp89:
        set_shape_box(sp89, 0.42, 0.72, 8.5, 0.62)
        for p in sp89.text_frame.paragraphs:
            for r in p.runs:
                if "used or planned" in r.text:
                    r.text = r.text.replace(" (used or planned to be used).", ".")
    clear_placeholder_text(s6, 90)

    add_feature_cards(
        s6,
        [
            (
                "GOOGLE AI STUDIO",
                "Structured JSON Schema Prompting (@google/genai)",
                "Engineered low-temperature (0.1) AST mapping prompts and strict responseSchema contracts in Google AI Studio so Gemini outputs deterministic {targetField, sourcePath, coercion} rules.",
                True,
            ),
            (
                "GOOGLE ANTIGRAVITY",
                "Agentic Engineering, Stress Testing & Visual QA",
                "Used Antigravity multi-agent workflows to build the proxy core, execute Playwright visual audits, and verify 99 automated tests (including 200-request concurrency and 60-level JSON bomb guards).",
                False,
            ),
            (
                "GOOGLE AGENT SKILLS",
                "Automated Schema Bijection & Cloud Hardening",
                "Applied schema-mapping, modern-web-guidance, and security skills to validate 1-to-1 field bijections, Zero-PII redaction, and single-container Google AI Studio / Cloud Run deployment.",
                False,
            ),
            (
                "UNIVERSAL STUDIO",
                "05 AI Healing Studio (/console Live Sandbox)",
                "Interactive studio where developers paste any custom baseline contract and broken webhook (Razorpay v2, ONDC Beckn, Stripe) to run live Gemini healing and synthesize TypeScript code.",
                False,
            ),
        ],
    )

    add_screenshot_showcase(
        s6,
        shot_studio,
        "UNIVERSAL WORKBENCH · /console (05 HEALING STUDIO)",
        "Custom Contract & Webhook Healing Studio",
        "Pre-loaded with production templates for Razorpay v1->v2, ONDC Beckn Order, Stripe Charge->Intent, and Gate 5 Financial Tamper (HTTP 502).",
        ["@google/genai SDK", "Live Adapter Synthesis"],
    )

    # =========================================================================
    # SLIDE 7: GOOGLE AI MODELS (Left: 3 Model Cards | Right: Visual Pipeline Diagram)
    # =========================================================================
    s7 = prs.slides[6]
    sp96 = find_shape_by_id(s7, 96)
    if sp96:
        set_shape_box(sp96, 0.42, 0.72, 8.5, 0.62)
    clear_placeholder_text(s7, 97)

    add_feature_cards(
        s7,
        [
            (
                "PRIMARY ACTIVE MODEL",
                "Google Gemini 2.0 Flash (gemini-2.0-flash)",
                "Selected for sub-second structured reasoning over deeply nested JSON AST skeletons (key renames, data[0] array unwrapping, numeric/boolean coercion, Unix epoch -> ISO-8601). Auto-binds GEMINI_API_KEY & GOOGLE_API_KEY.",
                True,
            ),
            (
                "MULTI-TIER RESILIENCE",
                "2.8s Circuit-Breaker & Multi-Model Failover",
                "Production payment proxies cannot stall on API rate limits. AutoPatch wraps Gemini in a strict 2.8s circuit breaker that seamlessly fails over to Groq Llama-3.3-70B and an in-process Type-Aware Semantic AST Mapper.",
                False,
            ),
            (
                "SINGLE-CALL CACHE",
                "Called Only Once Per Drift Shape (0.14 ms RAM)",
                "Gemini is never placed in a hot per-request loop. Once Gemini's rule passes all 5 safety gates, it is indexed by SHA-1 structural fingerprint and served from memory in 0.14 ms (99.86% cache hit ratio).",
                True,
            ),
            (
                "ENTERPRISE ROADMAP",
                "Gemma 2 (Air-Gapped VPC & Cloud Run Sidecar)",
                "Targeted for regulated banking (RBI/PCI-DSS) and healthcare enterprises on Google Cloud Run / GKE sidecars so zero-trust schema healing runs 100% inside a private VPC.",
                False,
            ),
        ],
    )

    # Right Column on Slide 7: Visual 3-Stage Zero-PII Gemini Pipeline Diagram Card
    diag_card = s7.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(5.82),
        Inches(1.56),
        Inches(3.78),
        Inches(3.74),
    )
    diag_card.adjustments[0] = 0.05
    diag_card.fill.solid()
    diag_card.fill.fore_color.rgb = CARD_BG
    diag_card.line.color.rgb = BORDER_TEAL
    diag_card.line.width = Pt(1.25)

    stages = [
        (
            "STAGE 1 · RAW DRIFTED PAYLOAD (STAYS IN PROXY RAM)",
            '{\n  "id": "pay_Pq9821",\n  "contact": { "email_addr": "priya@fin.in" },\n  "amount": "1499.50", "captured": 1\n}',
            DARK,
            WHITE,
        ),
        (
            "STAGE 2 · ZERO-PII SKELETON SENT TO GEMINI 2.0 FLASH",
            '{\n  "id": "string",\n  "contact": { "email_addr": "string:email_like" },\n  "amount": "string:numeric", "captured": "number:int"\n}',
            TEAL_TINT,
            DARK,
        ),
        (
            "STAGE 3 · 5-GATE VERIFIED RULE CACHED IN RAM (0.14 MS)",
            "payment_id     <- id (none)\ncustomer_email <- contact.email_addr (none)\namount_inr     <- amount (coerce: number)\nis_captured    <- captured (coerce: boolean)",
            BLUE_TINT,
            DARK,
        ),
    ]

    for idx, (st_title, st_code, bg_col, fg_col) in enumerate(stages):
        sy = 1.68 + idx * 1.18
        sbox = s7.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(5.96),
            Inches(sy),
            Inches(3.50),
            Inches(1.06),
        )
        sbox.adjustments[0] = 0.08
        sbox.fill.solid()
        sbox.fill.fore_color.rgb = bg_col
        sbox.line.color.rgb = BORDER_TEAL if idx == 1 else BORDER_GRAY
        sbox.line.width = Pt(1)

        stf = sbox.text_frame
        stf.word_wrap = True
        stf.margin_left = Inches(0.10)
        stf.margin_right = Inches(0.08)
        stf.margin_top = Inches(0.06)

        sp1 = stf.paragraphs[0]
        sp1.space_after = Pt(2)
        sr1 = sp1.add_run()
        sr1.text = st_title
        sr1.font.name = "Google Sans"
        sr1.font.size = Pt(7.5)
        sr1.font.bold = True
        sr1.font.color.rgb = TEAL_BRIGHT if bg_col == DARK else (TEAL if idx == 1 else BLUE)

        sp2 = stf.add_paragraph()
        sp2.line_spacing = 1.05
        sr2 = sp2.add_run()
        sr2.text = st_code
        sr2.font.name = "Consolas"
        sr2.font.size = Pt(7.5)
        sr2.font.color.rgb = fg_col

    # =========================================================================
    # SLIDE 8: PRODUCTION IMPLEMENTATION, BENCHMARKS & LIVE WALKTHROUGH
    # =========================================================================
    s8 = prs.slides[7]
    tb_title = s8.shapes.add_textbox(Inches(0.42), Inches(0.84), Inches(8.8), Inches(0.66))
    tf_t = tb_title.text_frame
    tf_t.word_wrap = True
    p_t1 = tf_t.paragraphs[0]
    p_t1.space_after = Pt(1)
    r_t1 = p_t1.add_run()
    r_t1.text = "Production Implementation & Stress-Test Verification"
    r_t1.font.name = "Google Sans"
    r_t1.font.size = Pt(20.5)
    r_t1.font.bold = True
    r_t1.font.color.rgb = CHARCOAL

    p_t2 = tf_t.add_paragraph()
    r_t2 = p_t2.add_run()
    r_t2.text = "End-to-end functional proofs, 99 automated tests across 14 suites, and interactive live verification."
    r_t2.font.name = "Google Sans"
    r_t2.font.size = Pt(10.5)
    r_t2.font.color.rgb = SLATE

    add_feature_cards(
        s8,
        [
            (
                "3 LIVE SURFACES",
                "Complete End-to-End SaaS Product (/, /console, /demo)",
                "Includes the Amplitux SaaS landing page, a 6-workbench Operator Console (Live Traffic, Chaos Lab, 5-Gate X-Ray, Auto-PR, AI Healing Studio, Contract Auto-Profiler), and Acme Billing client.",
                True,
            ),
            (
                "99 AUTOMATED TESTS",
                "200-Request Thundering Herd & Stress Suite",
                "Verified across 14 Vitest suites: 200 concurrent requests on a cold drifted route coalesce into 1 AI call and return 200/200 HTTP 200 OK; hardened against 60-level JSON bombs & prototype pollution.",
                False,
            ),
            (
                "ZERO CORRUPTION",
                "Mathematical Bijection Lock (data_id != user_id)",
                "Proves two target fields can never map to the same source path, and deleted required financial fields fail closed with HTTP 502 Bad Gateway instead of hallucinating data.",
                True,
            ),
            (
                "INTERACTIVE TOUR",
                "Built-In Step-by-Step Live Verification Guide",
                "Anyone reviewing the app can click 'Interactive Product Tour' on any page to execute live backend proofs (0.14 ms heal, Zero-PII Gemini, data_id vs user_id, ONDC codegen) in one click.",
                False,
            ),
        ],
    )

    add_screenshot_showcase(
        s8,
        shot_tour,
        "INTERACTIVE TOUR · LIVE BACKEND PROOF ENGINE",
        "Step-by-Step Interactive Architecture Tour",
        "Executes real HTTP requests against the proxy at every step so reviewers can verify 0.14 ms caching, Zero-PII redaction, and Gate 5 quarantine live.",
        ["99/99 Tests Passing", "200/200 Burst Verified"],
    )

    prs.save(out_pptx_workspace)
    shutil.copyfile(out_pptx_workspace, out_pptx_artifacts)
    print(f"Saved redesigned PPTX: {out_pptx_workspace} ({os.path.getsize(out_pptx_workspace)} bytes)")


if __name__ == "__main__":
    main()
