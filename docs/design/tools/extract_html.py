from pathlib import Path
from lxml import html
import json

root=Path(__file__).resolve().parents[1]
doc=html.fromstring((root/'Interaction_Prototype.html').read_text())
elements=[]
for node in doc.xpath('//*[@id]'):
    attrs=dict(node.attrib)
    value=attrs.get('value','')
    if node.tag=='textarea':value=node.text or ''
    if node.tag=='select':
        opts=node.xpath('./option[@selected]') or node.xpath('./option')[:1]
        value=opts[0].get('value','') if opts else ''
    elements.append({'tag':node.tag,'attrs':attrs,'value':value,'text':''.join(node.itertext())})
(root/'checks/dom_nodes.json').write_text(json.dumps(elements,ensure_ascii=False))
print('Extracted actual HTML IDs and initial controls for local DOM-double state checks.')
