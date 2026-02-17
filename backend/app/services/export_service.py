"""Export service for Alto, PageXML, TEI, and text formats."""
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum
from datetime import datetime

from app.schemas.schemas import TextEncoding, LineEnding


@dataclass
class ExportOptions:
    """Export configuration options."""
    encoding: TextEncoding = TextEncoding.UTF8_BOM
    line_ending: LineEnding = LineEnding.LF
    include_page_headers: bool = True
    include_line_numbers: bool = False
    include_confidence: bool = False
    xml_standalone: bool = True


def apply_line_endings(text: str, line_ending: LineEnding) -> str:
    """Convert line endings to specified format."""
    # Normalize to LF first
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    
    if line_ending == LineEnding.CRLF:
        return text.replace('\n', '\r\n')
    elif line_ending == LineEnding.CR:
        return text.replace('\n', '\r')
    return text


def export_text(transcriptions: List[Dict], options: ExportOptions) -> bytes:
    """Export transcriptions as plain text."""
    lines = []
    
    for page in transcriptions:
        if options.include_page_headers:
            lines.append(f"Page {page['page_number']}")
            lines.append("")
        
        for line in page.get('lines', []):
            text = line.get('text', '')
            if options.include_line_numbers:
                text = f"{line.get('line_number', 0):3d}. {text}"
            if options.include_confidence and line.get('confidence') is not None:
                text = f"{text} [{line['confidence']:.0%}]"
            lines.append(text)
        
        lines.append("")  # Blank line between pages
    
    content = '\n'.join(lines)
    content = apply_line_endings(content, options.line_ending)
    
    return content.encode(options.encoding.value)


def export_alto_xml(document: Dict, transcriptions: List[Dict], options: ExportOptions) -> bytes:
    """Export as Alto XML 4.0 format."""
    # XML declaration
    declaration = f'<?xml version="1.0" encoding="{options.encoding.value.upper()}"?>\n'
    
    alto_ns = "http://www.loc.gov/standards/alto/ns-v4#"
    
    xml_lines = [
        declaration,
        f'<alto xmlns="{alto_ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
        '  <Description>',
        '    <MeasurementUnit>pixel</MeasurementUnit>',
        f'    <sourceImageInformation>',
        f'      <fileName>{document.get("name", "document")}</fileName>',
        f'    </sourceImageInformation>',
        '  </Description>',
        '  <Layout>',
    ]
    
    for page in transcriptions:
        xml_lines.append(f'    <Page ID="page_{page["page_number"]}" PHYSICAL_IMG_NR="{page["page_number"]}">')
        xml_lines.append('      <PrintSpace>')
        xml_lines.append('        <TextBlock>')
        
        for line in page.get('lines', []):
            line_id = f'line_{page["page_number"]}_{line.get("line_number", 0)}'
            text = escape_xml(line.get('text', ''))
            conf = line.get('confidence')
            conf_attr = f' WC="{conf:.2f}"' if conf is not None else ''
            
            xml_lines.append(f'          <TextLine ID="{line_id}"{conf_attr}>')
            xml_lines.append(f'            <String CONTENT="{text}"/>')
            xml_lines.append('          </TextLine>')
        
        xml_lines.append('        </TextBlock>')
        xml_lines.append('      </PrintSpace>')
        xml_lines.append('    </Page>')
    
    xml_lines.append('  </Layout>')
    xml_lines.append('</alto>')
    
    content = '\n'.join(xml_lines)
    content = apply_line_endings(content, options.line_ending)
    
    return content.encode(options.encoding.value)


def export_pagexml(document: Dict, transcriptions: List[Dict], options: ExportOptions) -> bytes:
    """Export as PAGE XML format."""
    declaration = f'<?xml version="1.0" encoding="{options.encoding.value.upper()}"?>\n'
    
    page_ns = "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"
    
    xml_lines = [
        declaration,
        f'<PcGts xmlns="{page_ns}">',
        '  <Metadata>',
        f'    <Creator>Maatik Shemua</Creator>',
        f'    <Created>{datetime.utcnow().isoformat()}</Created>',
        '  </Metadata>',
    ]
    
    for page in transcriptions:
        xml_lines.append(f'  <Page imageFilename="page_{page["page_number"]:04d}.png">')
        xml_lines.append('    <TextRegion id="region_1">')
        
        for line in page.get('lines', []):
            line_id = f'line_{line.get("line_number", 0)}'
            text = escape_xml(line.get('text', ''))
            
            xml_lines.append(f'      <TextLine id="{line_id}">')
            xml_lines.append(f'        <TextEquiv>')
            xml_lines.append(f'          <Unicode>{text}</Unicode>')
            xml_lines.append(f'        </TextEquiv>')
            xml_lines.append(f'      </TextLine>')
        
        xml_lines.append('    </TextRegion>')
        xml_lines.append('  </Page>')
    
    xml_lines.append('</PcGts>')
    
    content = '\n'.join(xml_lines)
    content = apply_line_endings(content, options.line_ending)
    
    return content.encode(options.encoding.value)


def export_tei_xml(document: Dict, transcriptions: List[Dict], options: ExportOptions) -> bytes:
    """Export as TEI-XML format."""
    declaration = f'<?xml version="1.0" encoding="{options.encoding.value.upper()}"'
    if options.xml_standalone:
        declaration += ' standalone="yes"'
    declaration += '?>\n'
    
    tei_ns = "http://www.tei-c.org/ns/1.0"
    
    xml_lines = [
        declaration,
        f'<TEI xmlns="{tei_ns}" xml:lang="he">',
        '  <teiHeader>',
        '    <fileDesc>',
        f'      <titleStmt><title>{escape_xml(document.get("name", "Document"))}</title></titleStmt>',
        '      <publicationStmt><p>Transcribed with Maatik Shemua</p></publicationStmt>',
        '      <sourceDesc>',
        '        <msDesc>',
        '          <msIdentifier>',
    ]
    
    if document.get('repository'):
        xml_lines.append(f'            <repository>{escape_xml(document["repository"])}</repository>')
    if document.get('shelfmark'):
        xml_lines.append(f'            <idno>{escape_xml(document["shelfmark"])}</idno>')
    
    xml_lines.extend([
        '          </msIdentifier>',
        '        </msDesc>',
        '      </sourceDesc>',
        '    </fileDesc>',
        '  </teiHeader>',
        '  <text>',
        '    <body>',
    ])
    
    for page in transcriptions:
        xml_lines.append(f'      <pb n="{page["page_number"]}" facs="page_{page["page_number"]:04d}.png"/>')
        
        for line in page.get('lines', []):
            text = convert_paleographic_to_tei(line.get('text', ''))
            xml_lines.append(f'      <lb n="{line.get("line_number", 0) + 1}"/>{text}')
    
    xml_lines.extend([
        '    </body>',
        '  </text>',
        '</TEI>',
    ])
    
    content = '\n'.join(xml_lines)
    content = apply_line_endings(content, options.line_ending)
    
    return content.encode(options.encoding.value)


def escape_xml(text: str) -> str:
    """Escape special XML characters."""
    if not text:
        return ""
    return (
        text
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&apos;')
    )


def convert_paleographic_to_tei(text: str) -> str:
    """Convert paleographic markup conventions to TEI elements."""
    if not text:
        return ""
    
    import re
    
    # [text] -> <unclear>text</unclear> or <gap/> if empty
    def replace_lacuna(match):
        content = match.group(1)
        normalized = content.strip()
        # Common lacuna convention: "[...]" (or "[…]") means an illegible gap, not literal dots.
        if normalized in ("...", "…"):
            return '<gap reason="illegible"/>'
        if normalized:
            return f'<unclear>{escape_xml(content)}</unclear>'
        return '<gap reason="illegible"/>'
    text = re.sub(r'\[([^\]]*)\]', replace_lacuna, text)
    
    # ⟨text⟩ -> <supplied>text</supplied>
    text = re.sub(r'⟨([^⟩]*)⟩', lambda m: f'<supplied>{escape_xml(m.group(1))}</supplied>', text)
    
    # {text} -> <del>text</del>
    text = re.sub(r'\{([^\}]*)\}', lambda m: f'<del>{escape_xml(m.group(1))}</del>', text)
    
    # word? -> <unclear>word</unclear>
    text = re.sub(r'(\S+)\?', lambda m: f'<unclear>{escape_xml(m.group(1))}</unclear>', text)
    
    return text
