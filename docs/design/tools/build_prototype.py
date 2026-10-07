from pathlib import Path
import json

pack = Path(__file__).resolve().parents[1]
src = Path(__file__).resolve().parent
policy = json.loads((pack/'contracts/policy.json').read_text())
app = (src/'app.js').read_text().replace('/* POLICY_INLINE */',json.dumps(policy,ensure_ascii=False))
html = (src/'prototype.html.in').read_text().replace('/* CRYPTO_INLINE */',(src/'crypto.js').read_text()).replace('/* APP_INLINE */',app)
(pack/'Interaction_Prototype.html').write_text(html)
print('Built self-contained offline interaction prototype.')
