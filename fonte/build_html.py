"""Gera ../index.html (arquivo único) a partir de app.html + app.js + engine.js + dados.json + Leaflet.
Uso:  cd fonte && python build_html.py
Para atualizar CNEFE/malha: rode build_data.py (precisa do CSV do CNEFE e do KMZ) e depois este."""
import re, os
aqui = os.path.dirname(os.path.abspath(__file__)); j = lambda *p: os.path.join(aqui, *p)
t = open(j('app.html'), encoding='utf-8').read()
lj = re.sub(r'//# sourceMappingURL=.*$', '', open(j('..', 'vendor', 'leaflet', 'leaflet.js'), encoding='utf-8').read(), flags=re.M)
lc = open(j('..', 'vendor', 'leaflet', 'leaflet.css'), encoding='utf-8').read()
eng = open(j('engine.js'), encoding='utf-8').read()
app = open(j('app.js'), encoding='utf-8').read()
app = app.replace('__SUPABASE_URL__', 'https://psyfcwpupjsxpfgienxr.supabase.co').replace('__SUPABASE_KEY__', 'sb_publishable_CgP-HRMOaw3CUAK1LfeJng_pRJaAn4e')
dados = open(j('dados.json'), encoding='utf-8').read().replace('</', '<\\/')
for nome, s in [('leaflet', lj), ('engine', eng), ('app', app)]:
    assert '</script' not in s.lower(), nome
out = t.replace('/*__LEAFLET_CSS__*/', lc).replace('/*__LEAFLET_JS__*/', lj).replace('/*__ENGINE__*/', eng).replace('/*__APP__*/', app).replace('__DADOS__', dados)
open(j('..', 'index.html'), 'w', encoding='utf-8').write(out)
print('index.html gerado:', round(len(out.encode()) / 1e6, 2), 'MB')
