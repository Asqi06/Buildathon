import os
import zipfile
import shutil
import xml.etree.ElementTree as ET

# Namespaces to register
NAMESPACES = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'mv': 'urn:schemas-microsoft-com:mac:vml',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    'dgm': 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
    'o': 'urn:schemas-microsoft-com:office:office',
    'v': 'urn:schemas-microsoft-com:vml',
    'pvml': 'urn:schemas-microsoft-com:office:powerpoint',
    'com': 'http://schemas.openxmlformats.org/drawingml/2006/compatibility',
    'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
    'p15': 'http://schemas.microsoft.com/office/powerpoint/2012/main',
    'ahyp': 'http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor'
}

for prefix, uri in NAMESPACES.items():
    ET.register_namespace(prefix, uri)

A_NS = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P_NS = '{http://schemas.openxmlformats.org/presentationml/2006/main}'

def make_bullet_para(title, body, font_sz=1100, is_last=False):
    p = ET.Element(f'{A_NS}p')
    pPr = ET.SubElement(p, f'{A_NS}pPr', {
        'indent': '-228600',
        'lvl': '0',
        'marL': '228600',
        'rtl': '0',
        'algn': 'l'
    })
    lnSpc = ET.SubElement(pPr, f'{A_NS}lnSpc')
    ET.SubElement(lnSpc, f'{A_NS}spcPct', {'val': '115000'})
    spcBef = ET.SubElement(pPr, f'{A_NS}spcBef')
    ET.SubElement(spcBef, f'{A_NS}spcPts', {'val': '200'})
    spcAft = ET.SubElement(pPr, f'{A_NS}spcAft')
    ET.SubElement(spcAft, f'{A_NS}spcPts', {'val': '600' if not is_last else '0'})
    buFont = ET.SubElement(pPr, f'{A_NS}buFont', {'typeface': 'Arial'})
    ET.SubElement(pPr, f'{A_NS}buChar', {'char': '•'})

    # Bold lead-in run
    r1 = ET.SubElement(p, f'{A_NS}r')
    rPr1 = ET.SubElement(r1, f'{A_NS}rPr', {'b': '1', 'lang': 'en-GB', 'sz': str(font_sz + 50)})
    sFill1 = ET.SubElement(rPr1, f'{A_NS}solidFill')
    ET.SubElement(sFill1, f'{A_NS}srgbClr', {'val': '1a73e8'})  # Google Blue accent for topic
    ET.SubElement(rPr1, f'{A_NS}latin', {'typeface': 'Google Sans Flex Medium'})
    t1 = ET.SubElement(r1, f'{A_NS}t')
    t1.text = title + ' '

    # Body text run
    r2 = ET.SubElement(p, f'{A_NS}r')
    rPr2 = ET.SubElement(r2, f'{A_NS}rPr', {'b': '0', 'lang': 'en-GB', 'sz': str(font_sz)})
    sFill2 = ET.SubElement(rPr2, f'{A_NS}solidFill')
    ET.SubElement(sFill2, f'{A_NS}srgbClr', {'val': '202124'})  # Material charcoal
    ET.SubElement(rPr2, f'{A_NS}latin', {'typeface': 'Google Sans Flex'})
    t2 = ET.SubElement(r2, f'{A_NS}t')
    t2.text = body

    endPara = ET.SubElement(p, f'{A_NS}endParaRPr', {'sz': str(font_sz)})
    ET.SubElement(endPara, f'{A_NS}latin', {'typeface': 'Google Sans Flex'})
    return p

def update_slide2(xml_str):
    root = ET.fromstring(xml_str)
    # Find shape id 62
    for sp in root.findall(f'.//{P_NS}sp'):
        cNvPr = sp.find(f'.//{P_NS}cNvPr')
        if cNvPr is not None and cNvPr.attrib.get('id') == '62':
            # Widen xfrm
            xfrm = sp.find(f'.//{A_NS}xfrm')
            if xfrm is not None:
                off = xfrm.find(f'{A_NS}off')
                ext = xfrm.find(f'{A_NS}ext')
                if off is not None:
                    off.set('y', '3100000')
                if ext is not None:
                    ext.set('cx', '8100000')
                    ext.set('cy', '1800000')
            
            txBody = sp.find(f'{P_NS}txBody')
            if txBody is not None:
                # Remove existing p elements
                for p_elem in list(txBody.findall(f'{A_NS}p')):
                    txBody.remove(p_elem)
                
                # Para 1: Team Name
                p1 = ET.SubElement(txBody, f'{A_NS}p')
                pPr1 = ET.SubElement(p1, f'{A_NS}pPr', {'algn': 'l'})
                spcAft1 = ET.SubElement(pPr1, f'{A_NS}spcAft')
                ET.SubElement(spcAft1, f'{A_NS}spcPts', {'val': '400'})
                r1_lbl = ET.SubElement(p1, f'{A_NS}r')
                rPr1_lbl = ET.SubElement(r1_lbl, f'{A_NS}rPr', {'b': '1', 'sz': '1400'})
                s1 = ET.SubElement(rPr1_lbl, f'{A_NS}solidFill')
                ET.SubElement(s1, f'{A_NS}srgbClr', {'val': '202124'})
                ET.SubElement(rPr1_lbl, f'{A_NS}latin', {'typeface': 'Google Sans Flex Medium'})
                t1_lbl = ET.SubElement(r1_lbl, f'{A_NS}t')
                t1_lbl.text = 'Team Name:  '
                
                r1_val = ET.SubElement(p1, f'{A_NS}r')
                rPr1_val = ET.SubElement(r1_val, f'{A_NS}rPr', {'b': '1', 'sz': '1400'})
                s1v = ET.SubElement(rPr1_val, f'{A_NS}solidFill')
                ET.SubElement(s1v, f'{A_NS}srgbClr', {'val': '1a73e8'})
                ET.SubElement(rPr1_val, f'{A_NS}latin', {'typeface': 'Google Sans Flex Medium'})
                t1_val = ET.SubElement(r1_val, f'{A_NS}t')
                t1_val.text = 'Coders of Bharat'

                # Para 2: Team Size
                p2 = ET.SubElement(txBody, f'{A_NS}p')
                pPr2 = ET.SubElement(p2, f'{A_NS}pPr', {'algn': 'l'})
                spcAft2 = ET.SubElement(pPr2, f'{A_NS}spcAft')
                ET.SubElement(spcAft2, f'{A_NS}spcPts', {'val': '400'})
                r2_lbl = ET.SubElement(p2, f'{A_NS}r')
                rPr2_lbl = ET.SubElement(r2_lbl, f'{A_NS}rPr', {'b': '1', 'sz': '1400'})
                s2 = ET.SubElement(rPr2_lbl, f'{A_NS}solidFill')
                ET.SubElement(s2, f'{A_NS}srgbClr', {'val': '202124'})
                ET.SubElement(rPr2_lbl, f'{A_NS}latin', {'typeface': 'Google Sans Flex Medium'})
                t2_lbl = ET.SubElement(r2_lbl, f'{A_NS}t')
                t2_lbl.text = 'Team Size:  '
                
                r2_val = ET.SubElement(p2, f'{A_NS}r')
                rPr2_val = ET.SubElement(r2_val, f'{A_NS}rPr', {'b': '0', 'sz': '1400'})
                s2v = ET.SubElement(rPr2_val, f'{A_NS}solidFill')
                ET.SubElement(s2v, f'{A_NS}srgbClr', {'val': '3c4043'})
                ET.SubElement(rPr2_val, f'{A_NS}latin', {'typeface': 'Google Sans Flex'})
                t2_val = ET.SubElement(r2_val, f'{A_NS}t')
                t2_val.text = '1 (Lead: Anirudh Verma)'

                # Para 3: Problem Statement
                p3 = ET.SubElement(txBody, f'{A_NS}p')
                pPr3 = ET.SubElement(p3, f'{A_NS}pPr', {'algn': 'l'})
                spcAft3 = ET.SubElement(pPr3, f'{A_NS}spcAft')
                ET.SubElement(spcAft3, f'{A_NS}spcPts', {'val': '200'})
                r3_lbl = ET.SubElement(p3, f'{A_NS}r')
                rPr3_lbl = ET.SubElement(r3_lbl, f'{A_NS}rPr', {'b': '1', 'sz': '1400'})
                s3 = ET.SubElement(rPr3_lbl, f'{A_NS}solidFill')
                ET.SubElement(s3, f'{A_NS}srgbClr', {'val': '202124'})
                ET.SubElement(rPr3_lbl, f'{A_NS}latin', {'typeface': 'Google Sans Flex Medium'})
                t3_lbl = ET.SubElement(r3_lbl, f'{A_NS}t')
                t3_lbl.text = 'Problem Statement:  '
                
                r3_val = ET.SubElement(p3, f'{A_NS}r')
                rPr3_val = ET.SubElement(r3_val, f'{A_NS}rPr', {'b': '0', 'sz': '1250'})
                s3v = ET.SubElement(rPr3_val, f'{A_NS}solidFill')
                ET.SubElement(s3v, f'{A_NS}srgbClr', {'val': '3c4043'})
                ET.SubElement(rPr3_val, f'{A_NS}latin', {'typeface': 'Google Sans Flex'})
                t3_val = ET.SubElement(r3_val, f'{A_NS}t')
                t3_val.text = 'Silent upstream API schema drift and unannounced contract changes break downstream production applications, causing immediate downtime and emergency hotfixes.'

    return ET.tostring(root, encoding='utf-8')

def update_content_slide(xml_str, title_id, content_id, bullets, font_sz=1100):
    root = ET.fromstring(xml_str)
    
    # Widen title shape cx
    for sp in root.findall(f'.//{P_NS}sp'):
        cNvPr = sp.find(f'.//{P_NS}cNvPr')
        if cNvPr is not None and cNvPr.attrib.get('id') == str(title_id):
            xfrm = sp.find(f'.//{A_NS}xfrm')
            if xfrm is not None:
                ext = xfrm.find(f'{A_NS}ext')
                if ext is not None:
                    ext.set('cx', '8315350')

        # Replace content shape
        if cNvPr is not None and cNvPr.attrib.get('id') == str(content_id):
            xfrm = sp.find(f'.//{A_NS}xfrm')
            if xfrm is not None:
                off = xfrm.find(f'{A_NS}off')
                ext = xfrm.find(f'{A_NS}ext')
                if off is not None:
                    off.set('x', '414325')
                    off.set('y', '1650000')
                if ext is not None:
                    ext.set('cx', '8315350')
                    ext.set('cy', '3250000')
            
            txBody = sp.find(f'{P_NS}txBody')
            if txBody is not None:
                # Clear existing paragraphs
                for p_elem in list(txBody.findall(f'{A_NS}p')):
                    txBody.remove(p_elem)
                
                # Add new bullet points
                for i, (b_title, b_body) in enumerate(bullets):
                    is_last = (i == len(bullets) - 1)
                    p_node = make_bullet_para(b_title, b_body, font_sz=font_sz, is_last=is_last)
                    txBody.append(p_node)

    return ET.tostring(root, encoding='utf-8')

def main():
    src_pptx = r'C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\.user_uploaded\media_1794732186657_66d5d2d1.pptx'
    out_pptx_workspace = r'e:\Coders of Bharat\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx'
    out_pptx_artifacts = r'C:\Users\WELCOME\.gemini\antigravity\brain\bc35fd4c-c79c-4f4d-8d7c-ee4aefac0b32\Startup_Buildathon_Coders_of_Bharat_AutoPatch.pptx'

    # Slide 3: Problem Statement
    bullets_s3 = [
        ('Silent API Contract Drift:', 'External third-party APIs (payment gateways, logistics providers, authentication services) frequently change JSON response structures without advance notice or version deprecation, renaming fields, shifting types, or re-nesting schemas.'),
        ('Downstream Application Outages:', 'Client applications and microservices fail schema validation (Zod, Pydantic) or crash with runtime exceptions on undefined properties, directly breaking customer transactions and degrading checkout conversion.'),
        ('Costly Midnight Firefights:', 'Engineering teams are paged during off-hours to manually inspect API payloads, code hotfix shims, run emergency CI/CD deployments, and patch codebases, incurring heavy engineering hours and high Mean Time to Recovery (MTTR).')
    ]

    # Slide 4: Proposed Solution
    bullets_s4 = [
        ('Autonomous Reverse Proxy:', 'AutoPatch sits transparently between client microservices and external upstream APIs, continuously validating payload schemas and isolating failures before they reach production applications.'),
        ('In-Flight Schema Healing (<150ms):', 'When schema drift is detected, AutoPatch sanitizes customer data, passes the structural diff to an LLM healer, synthesizes a deterministic transformation rule, and repairs the payload in real time.'),
        ('Sub-Millisecond JIT Cache (0.14ms):', 'Verified transformation rules are compiled into a local in-memory cache, allowing subsequent drifting requests to be patched at native wire speed without LLM latency or cost.'),
        ('Automated Human-in-the-Loop PR Generation:', 'AutoPatch automatically opens a GitHub Pull Request with updated TypeScript/Zod schemas and regression tests, converting runtime hot-patches into permanent, auditable codebase fixes.')
    ]

    # Slide 5: Solution Architecture
    bullets_s5 = [
        ('Ingress Proxy & Zod Contract Layer:', 'Built on Fastify and Node.js; intercepts incoming API responses and verifies payload contracts against registered Zod schemas.'),
        ('Zero-PII Sanitization Gateway:', 'Automatically redacts customer identifiers, credentials, emails, and tokens using deterministic heuristic masking before sending schema structures to LLM inference.'),
        ('Dual-Engine LLM Healer (Google Gemini 1.5 Flash):', 'Analyzes the structural delta between expected and received JSON trees to synthesize exact JavaScript field-mapping expressions.'),
        ('5-Gate Programmatic Verification Engine:', 'Validates rules through syntax checking, target schema conformance, idempotency testing, synthetic payload dry-runs, and hallucination boundary validation.'),
        ('Hot Rule Cache & Background PR Worker:', 'Serves active transformation rules in 0.14ms while asynchronously dispatching a Git worker to commit Zod schema updates and open GitHub PRs.')
    ]

    # Slide 6: Google AI Tools
    bullets_s6 = [
        ('Google AI Studio:', 'Used for system prompt design, low-temperature parameter optimization, and few-shot evaluation. Enabled deterministic JSON mode output for schema-to-schema structural diffing and rule synthesis.'),
        ('Google Antigravity:', 'Served as the agentic engineering workstation and orchestrator, executing multi-agent workflows to build the proxy core, implement chaos testing scenarios, and verify end-to-end integration.'),
        ('Google Agent Skills:', 'Employed custom skills for automated schema mapping validation, PII safety assessment, and strict code quality verification across proxy modules.')
    ]

    # Slide 7: Google AI Models
    bullets_s7 = [
        ('Google Gemini 1.5 Flash (Primary Active Model):', 'Utilized for its low latency, high throughput, and superior reasoning over complex, nested JSON objects. Computes schema diffs and generates deterministic transformation functions in under 150ms.'),
        ('Gemma 2 (Planned On-Premise / Edge Deployment):', 'Targeted for enterprise on-premise deployments using Google Cloud Run or GKE sidecars. Allows regulated organizations (banking, healthcare) to execute private, air-gapped schema healing without data leaving their VPC.')
    ]

    # Temporary directory for zip modification
    temp_dir = r'e:\Coders of Bharat\scripts\temp_pptx'
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)

    with zipfile.ZipFile(src_pptx, 'r') as z_in:
        z_in.extractall(temp_dir)

    # Process slide 2
    s2_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide2.xml')
    with open(s2_path, 'r', encoding='utf-8') as f:
        s2_content = f.read()
    s2_updated = update_slide2(s2_content)
    with open(s2_path, 'wb') as f:
        f.write(s2_updated)

    # Process slide 3
    s3_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide3.xml')
    with open(s3_path, 'r', encoding='utf-8') as f:
        s3_content = f.read()
    s3_updated = update_content_slide(s3_content, 68, 69, bullets_s3, font_sz=1100)
    with open(s3_path, 'wb') as f:
        f.write(s3_updated)

    # Process slide 4
    s4_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide4.xml')
    with open(s4_path, 'r', encoding='utf-8') as f:
        s4_content = f.read()
    s4_updated = update_content_slide(s4_content, 75, 76, bullets_s4, font_sz=1050)
    with open(s4_path, 'wb') as f:
        f.write(s4_updated)

    # Process slide 5
    s5_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide5.xml')
    with open(s5_path, 'r', encoding='utf-8') as f:
        s5_content = f.read()
    s5_updated = update_content_slide(s5_content, 82, 83, bullets_s5, font_sz=1000)
    with open(s5_path, 'wb') as f:
        f.write(s5_updated)

    # Process slide 6
    s6_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide6.xml')
    with open(s6_path, 'r', encoding='utf-8') as f:
        s6_content = f.read()
    s6_updated = update_content_slide(s6_content, 89, 90, bullets_s6, font_sz=1100)
    with open(s6_path, 'wb') as f:
        f.write(s6_updated)

    # Process slide 7
    s7_path = os.path.join(temp_dir, 'ppt', 'slides', 'slide7.xml')
    with open(s7_path, 'r', encoding='utf-8') as f:
        s7_content = f.read()
    s7_updated = update_content_slide(s7_content, 96, 97, bullets_s7, font_sz=1100)
    with open(s7_path, 'wb') as f:
        f.write(s7_updated)

    # Re-pack into output pptx
    for out_path in [out_pptx_workspace, out_pptx_artifacts]:
        with zipfile.ZipFile(out_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
            for root_dir, dirs, files in os.walk(temp_dir):
                for file in files:
                    full_p = os.path.join(root_dir, file)
                    rel_p = os.path.relpath(full_p, temp_dir)
                    z_out.write(full_p, rel_p)
        print(f'Successfully generated: {out_path} (Size: {os.path.getsize(out_path)} bytes)')

    # Clean up temp
    shutil.rmtree(temp_dir)
    print('All slides updated successfully.')

if __name__ == '__main__':
    main()
