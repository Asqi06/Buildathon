import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

def update_presentation():
    input_path = "base_deck.pptx"
    output_pptx = "Startup_Buildathon_Idea_Submission_Deck_Coders_of_Bharat.pptx"
    
    prs = Presentation(input_path)
    
    # Color palette matching Google / Antigravity design
    color_primary = RGBColor(0x1F, 0x1F, 0x1F)     # Dark charcoal #1F1F1F
    color_blue = RGBColor(0x1A, 0x73, 0xE8)        # Google Blue #1A73E8
    color_green = RGBColor(0x10, 0xB9, 0x81)       # Emerald Green #10B981
    color_muted = RGBColor(0x5F, 0x63, 0x68)       # Google Gray #5F6368
    
    # ── Slide 2: Team Name, Size, One-Liner Problem Statement ─────────────
    slide2 = prs.slides[1]
    sh2 = slide2.shapes[1]
    tf2 = sh2.text_frame
    tf2.clear()
    
    p = tf2.paragraphs[0]
    p.text = "Team Name: "
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = color_primary
    r = p.add_run()
    r.text = "Coders of Bharat"
    r.font.bold = False
    r.font.color.rgb = color_blue
    
    p = tf2.add_paragraph()
    p.space_before = Pt(8)
    p.text = "Team Size: "
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = color_primary
    r = p.add_run()
    r.text = "1 (Solo Builder)  |  Team Lead: Anirudh Verma"
    r.font.bold = False
    r.font.color.rgb = color_muted
    
    p = tf2.add_paragraph()
    p.space_before = Pt(8)
    p.text = "Problem Statement:"
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = color_primary
    
    p = tf2.add_paragraph()
    p.space_before = Pt(4)
    p.text = "External and microservice APIs frequently introduce silent, breaking schema changes without prior notice. These unannounced mutations crash customer-facing frontend applications, resulting in severe business downtime, failed revenue transactions, and emergency engineering fire drills."
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(12)
    p.font.color.rgb = color_primary

    # Helper function to populate content on slides 3-7
    def populate_slide(slide_idx, paragraphs_data):
        slide = prs.slides[slide_idx]
        sh = slide.shapes[2]
        sh.left = Inches(0.45)
        sh.top = Inches(1.55)
        sh.width = Inches(9.1)
        sh.height = Inches(3.6)
        
        tf = sh.text_frame
        tf.word_wrap = True
        tf.clear()
        
        for i, item in enumerate(paragraphs_data):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            if item.get("space_before"):
                p.space_before = Pt(item["space_before"])
            
            # Heading or bullet run
            if item.get("heading"):
                r_head = p.add_run()
                r_head.text = item["heading"] + " "
                r_head.font.name = "Google Sans Flex"
                r_head.font.size = Pt(item.get("size", 11.5))
                r_head.font.bold = True
                r_head.font.color.rgb = item.get("head_color", color_primary)
                
            if item.get("text"):
                r_body = p.add_run()
                r_body.text = item["text"]
                r_body.font.name = "Google Sans Flex"
                r_body.font.size = Pt(item.get("size", 11.5))
                r_body.font.bold = False
                r_body.font.color.rgb = item.get("body_color", color_primary)

    # ── Slide 3: The Challenge or Problem Identified ─────────────────────
    populate_slide(2, [
        {
            "heading": "• The Silent Breaking Change Epidemic:",
            "text": "Modern cloud apps rely on dozens of third-party SaaS APIs (payment gateways, CRMs, shipping, auth). When an upstream provider silently renames a key (user_id → id), nests fields (email → contact.email_addr), or changes data types, frontends crash immediately with TypeError: Cannot read properties of undefined.",
            "head_color": color_blue,
            "space_before": 2
        },
        {
            "heading": "• High Cost of Silent Outages:",
            "text": "Every API break halts critical user journeys (checkout, onboarding, billing), leading to direct revenue loss, degraded customer trust, and costly emergency escalations.",
            "head_color": color_primary,
            "space_before": 10
        },
        {
            "heading": "• Engineering Burnout & Reactive Patching:",
            "text": "Developers spend hours firefighting, parsing corrupted logs, and writing rushed one-off adapters under pressure instead of shipping core product features.",
            "head_color": color_primary,
            "space_before": 10
        },
        {
            "heading": "• The Critical Infrastructure Gap:",
            "text": "Traditional API gateways (Cloudflare, Kong, AWS API GW) only catch HTTP 5xx server outages. They are completely blind to silent structural schema drift where the server returns HTTP 200 OK with corrupted JSON shapes.",
            "head_color": color_green,
            "space_before": 10
        }
    ])

    # ── Slide 4: Proposed Solution ───────────────────────────────────────
    populate_slide(3, [
        {
            "heading": "AutoPatch: Autonomous Self-Healing Reverse Proxy for Silently Drifting APIs",
            "text": "",
            "head_color": color_blue,
            "size": 13,
            "space_before": 0
        },
        {
            "heading": "• Real-Time Schema Interception & Self-Healing (0.14 ms):",
            "text": "AutoPatch sits transparently between client frontends and upstream APIs. It intercepts drifted JSON payloads, validates them against target schema contracts, and repairs corrupted structures on the fly with zero client downtime.",
            "head_color": color_primary,
            "space_before": 8
        },
        {
            "heading": "• 5-Gate Fail-Closed Safety Engine:",
            "text": "Strict verification prevents AI hallucination. Mappings must pass: (1) 100% schema coverage, (2) null-safe path resolution, (3) ≥90% confidence score, (4) in-process sample replay, and (5) strictly zero invented financial/sensitive fields (e.g. missing amount_cents returns safe HTTP 502).",
            "head_color": color_green,
            "space_before": 8
        },
        {
            "heading": "• In-Memory Rule Caching for Sub-Millisecond Speed:",
            "text": "Once an AI mapping rule is verified, it is cached in-memory and reloaded atomically. Repeat requests are healed in 0.14 ms overhead with 0 additional AI latency or cost.",
            "head_color": color_primary,
            "space_before": 8
        },
        {
            "heading": "• Autonomous Git Pull Request Pipeline:",
            "text": "Runtime healing stops the immediate outage, but AutoPatch also writes permanent TypeScript adapter code, drafts node:test unit tests, and submits an autonomous GitHub PR for developer review.",
            "head_color": color_blue,
            "space_before": 8
        }
    ])

    # ── Slide 5: Solution Architecture ───────────────────────────────────
    populate_slide(4, [
        {
            "heading": "End-to-End System Pipeline & Architecture:",
            "text": "",
            "head_color": color_blue,
            "size": 12.5,
            "space_before": 0
        },
        {
            "heading": "[Client Frontend / Mobile] ↔ [AutoPatch Reverse Proxy (Port 8080)] ↔ [Upstream APIs]",
            "text": "",
            "head_color": color_muted,
            "size": 11,
            "space_before": 4
        },
        {
            "heading": "1. Contract Registry & Fast Validator:",
            "text": "Intercepts incoming requests and evaluates response payloads against versioned JSON schemas in <0.05 ms.",
            "head_color": color_primary,
            "space_before": 8
        },
        {
            "heading": "2. In-Memory Healer Cache:",
            "text": "Matches payload structure fingerprints. Cache hits execute instant AST path coercion in 0.14 ms overhead.",
            "head_color": color_primary,
            "space_before": 6
        },
        {
            "heading": "3. AI Schema Mapper (Cold Drift):",
            "text": "On novel drift, extracts source-to-target mapping candidates with type coercion rules using structured LLM inference.",
            "head_color": color_primary,
            "space_before": 6
        },
        {
            "heading": "4. 5-Gate In-Process Verification:",
            "text": "Executes candidates against captured samples; rejects invalid paths or hallucinated data with fail-closed HTTP 502.",
            "head_color": color_green,
            "space_before": 6
        },
        {
            "heading": "5. Autonomous Adapter Codegen & PR Worker:",
            "text": "Compiles verified rules into TypeScript adapter modules and node:test suites, validated in-process and submitted to GitHub.",
            "head_color": color_blue,
            "space_before": 6
        }
    ])

    # ── Slide 6: Google AI Tools ─────────────────────────────────────────
    populate_slide(5, [
        {
            "heading": "• Google Antigravity (Core Autonomous Agent Architecture):",
            "text": "Leveraged Antigravity as the primary agentic development environment to architect, scaffold, and implement the complete reverse proxy runtime, the multi-tier caching engine, and the interactive Operator Console. Used Antigravity subagent delegation and verification gates to achieve 100% strict TypeScript typing and zero compiler errors.",
            "head_color": color_blue,
            "space_before": 4
        },
        {
            "heading": "• Google AI Studio (Prompt Engineering & Schema Tuning):",
            "text": "Utilized Google AI Studio to calibrate few-shot schema-mapping prompts, establish strict JSON-mode system instructions, and benchmark cold-drift edge cases (such as ISO-8601 vs Unix epoch date shifts and multi-level object unflattening) with guaranteed structural adherence.",
            "head_color": color_green,
            "space_before": 14
        },
        {
            "heading": "• Google Agent Skills (Automation & Verification Rigor):",
            "text": "Integrated agent skills for architecture design, unit test generation with Vitest (89/89 tests passed), code hygiene, and autonomous GitHub Octokit dispatch for pull request creation.",
            "head_color": color_primary,
            "space_before": 14
        }
    ])

    # ── Slide 7: Google AI Models ────────────────────────────────────────
    populate_slide(6, [
        {
            "heading": "• Gemini 2.5 Flash (Primary Low-Latency Schema Mapper):",
            "text": "Utilized for cold-start schema drift resolution. Gemini Flash provides sub-second time-to-first-token (TTFT) and native JSON Schema output enforcement (response_schema), guaranteeing valid AST transformation rules with zero syntax or typing errors.",
            "head_color": color_blue,
            "space_before": 4
        },
        {
            "heading": "• Gemini 1.5 Pro (Deep Structural Diffing & Autonomous Adapter Codegen):",
            "text": "Employed for complex, multi-layered schema transformations where ambiguous nested schemas require deep reasoning. Translates verified runtime transformation rules into clean, idiomatic TypeScript adapter files and comprehensive node:test test suites for the GitHub PR worker.",
            "head_color": color_green,
            "space_before": 12
        },
        {
            "heading": "• Hybrid Edge LPU Engine (Groq / Llama-3.1-8b Integration):",
            "text": "Supported as an ultra-fast edge inference provider (700+ tokens/sec) for sub-second cold heals, paired with AutoPatch's local in-memory cache for 0.14 ms continuous runtime execution.",
            "head_color": color_primary,
            "space_before": 12
        }
    ])

    # ── Slide 8: Validation, Testing & Live Working Prototype ─────────────
    slide8 = prs.slides[7]
    sh8 = slide8.shapes.add_textbox(Inches(0.45), Inches(1.3), Inches(9.1), Inches(4.0))
    tf8 = sh8.text_frame
    tf8.word_wrap = True
    
    p = tf8.paragraphs[0]
    p.text = "Validation, Testing & Live Working Prototype"
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = color_blue
    
    p = tf8.add_paragraph()
    p.space_before = Pt(4)
    p.text = "Proven reliability, rigorous automated testing, and interactive developer tooling."
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(11.5)
    p.font.color.rgb = color_muted
    
    items8 = [
        ("• 100% Test Suite Coverage (89/89 Tests Passed):", " Comprehensive Vitest test suite spanning 12 test files verifies contract validation, cache persistence, 5 safety gates, Groq/Gemini mapper fallback, and adapter codegen."),
        ("• Strict TypeScript Compilation (0 Errors):", " Fully typed in strict mode (npx tsc --noEmit passes cleanly), ensuring enterprise-grade software stability."),
        ("• Live Operator Console & Chaos Lab:", " Complete real-time dashboard at /console with live WebSocket traffic monitoring, interactive Chaos Engineering simulator (Combo v2, renames, array wraps), side-by-side JSON diff Inspector, and autonomous GitHub PR preview."),
        ("• Drop-in Zero-Code Integration:", " Works as a transparent reverse proxy in front of any existing stack (Node.js, Python, Go, React, iOS, Android) by simply repointing the API base URL.")
    ]
    for head, body in items8:
        p = tf8.add_paragraph()
        p.space_before = Pt(8)
        r1 = p.add_run()
        r1.text = head
        r1.font.bold = True
        r1.font.size = Pt(11.5)
        r1.font.color.rgb = color_primary
        r2 = p.add_run()
        r2.text = body
        r2.font.bold = False
        r2.font.size = Pt(11.5)
        r2.font.color.rgb = color_primary

    # ── Slide 9: Thank You Details ───────────────────────────────────────
    slide9 = prs.slides[8]
    sh9 = slide9.shapes.add_textbox(Inches(0.5), Inches(3.6), Inches(6.0), Inches(1.8))
    tf9 = sh9.text_frame
    tf9.word_wrap = True
    
    p = tf9.paragraphs[0]
    p.text = "AutoPatch — Autonomous Self-Healing Reverse Proxy"
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = color_blue
    
    p = tf9.add_paragraph()
    p.space_before = Pt(4)
    p.text = "Team: Coders of Bharat  |  Lead: Anirudh Verma"
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = color_primary
    
    p = tf9.add_paragraph()
    p.space_before = Pt(4)
    p.text = "Built for Google DeepMind & Google Cloud Startup Buildathon India 2026"
    p.font.name = "Google Sans Flex"
    p.font.size = Pt(11)
    p.font.color.rgb = color_muted

    prs.save(output_pptx)
    print(f"Successfully saved updated presentation to {output_pptx}!")

if __name__ == "__main__":
    update_presentation()
