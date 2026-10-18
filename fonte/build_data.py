import json, math, collections, sys, datetime
import pandas as pd
import quarteirao_enderecos as Q
from shapely.geometry import mapping

# uso: python build_data.py MALHA.kmz CNEFE.csv   (CNEFE: 3536505_PAULINIA.csv do IBGE)
if len(sys.argv) < 3: sys.exit('uso: python build_data.py MALHA.kmz 3536505_PAULINIA.csv')
KMZ, CNEFE = sys.argv[1], sys.argv[2]
m=Q.Malha(KMZ)
c=Q.ler_cnefe(CNEFE)
ref,nomes=Q.montar_referencia(c,m,print)

# ---- ruas
ceps=[]; cep_idx={}
def ci(x):
    if x not in cep_idx: cep_idx[x]=len(ceps); ceps.append(x)
    return cep_idx[x]
ruas=[]
for k,regs in ref.items():
    g=collections.defaultdict(list)
    for n,q,_,cep,lo,la in regs: g[(n,cep)].append((q,lo,la))
    ent=[]
    for (n,cep),lst in sorted(g.items()):
        cnt=collections.Counter(q for q,_,_ in lst); q,nq=cnt.most_common(1)[0]
        pts=[(lo,la) for qq,lo,la in lst if qq==q]
        lo=sum(p[0] for p in pts)/len(pts); la=sum(p[1] for p in pts)/len(pts)
        ent.append([n,q,round(la,6),round(lo,6),ci(cep),1 if nq/len(lst)>=0.75 else 0,len(lst)])
    ruas.append([nomes[k],ent])
print('ruas',len(ruas))

# ---- polígonos (de volta para lon/lat, simplificados ~0.7 m)
def to_ll(x,y): return [round(x/Q._KX,6), round(y/Q._KY,6)]
qts=[]
for g,(cod,zona) in zip(m.geoms,m.attrs):
    gs=g.simplify(0.7,preserve_topology=True)
    polys=list(gs.geoms) if hasattr(gs,'geoms') else [gs]
    rings=[]
    for p in polys:
        if p.is_empty: continue
        rings.append([[to_ll(x,y) for x,y in p.exterior.coords]]+[[to_ll(x,y) for x,y in i.coords] for i in p.interiors])
    qts.append([cod,zona,rings])

# ---- condomínios (8+ unidades no mesmo número)
c2=c[c.NUM_ENDERECO.astype(str)!='0'].copy()
c2['rua']=(c2.NOM_TIPO_SEGLOGR.fillna('')+' '+c2.NOM_TITULO_SEGLOGR.fillna('')+' '+c2.NOM_SEGLOGR.fillna('')).str.replace(r'\s+',' ',regex=True).str.strip()
cond=[]
for (r,n),s in c2.groupby(['rua','NUM_ENDERECO']):
    if len(s)<8: continue
    qs=collections.Counter()
    k=Q.chave_rua(r)[0]
    for reg in ref.get(k,[]):
        if reg[0]==int(n): qs[reg[1]]+=1
    if not qs: continue
    comp=collections.Counter(s.NOM_COMP_ELEM1.dropna())
    vert=any(k in comp for k in ('BLOCO','TORRE','APARTAMENTO','PREDIO','ANDAR'))
    est=s.DSC_ESTABELECIMENTO.dropna()
    quarts=[q for q,v in qs.most_common() if v>=max(2,0.05*len(s))] or [q for q,_ in qs.most_common(1)]
    cond.append({"id":f"cnefe-{len(cond)+1}","nome":"","rua":r,"numero":int(n),"bairro":s.DSC_LOCALIDADE.iloc[0] if isinstance(s.DSC_LOCALIDADE.iloc[0],str) else "",
                 "unidades":int(len(s)),"tipo":"vertical" if vert else "horizontal",
                 "quarteiroes":quarts,"situacao":"portaria" if len(quarts)==1 else "interno",
                 "complementos":sorted(comp.keys())[:6],"lat":round(s.LATITUDE.astype(float).mean(),6),"lon":round(s.LONGITUDE.astype(float).mean(),6),
                 "origem":"CNEFE 2022","mapa_interno":{}})
print('condominios',len(cond), collections.Counter(x['situacao'] for x in cond))
data={"versao":datetime.date.today().isoformat(),"fonte":"CNEFE 2022 (IBGE) + malha Quarteiroes_Com_Zoneamento","ceps":ceps,"ruas":ruas,"quarteiroes":qts,"condominios":cond}
s=json.dumps(data,ensure_ascii=False,separators=(',',':'))
open('dados.json','w',encoding='utf-8').write(s)
print('MB',len(s.encode())/1e6, 'ruas MB',len(json.dumps(ruas,separators=(',',':')))/1e6,'poly MB',len(json.dumps(qts,separators=(',',':')))/1e6)
