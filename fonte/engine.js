/* ==========================================================================
   MOTOR — endereço → quarteirão
   Mesmas regras do quarteirao_enderecos.py:
   limpeza do texto, semelhança de nomes, número exato, regra da faixa
   (par com par, ímpar com ímpar), vizinho mais próximo, base aprendida e
   condomínios. Não usa rede: tudo roda no navegador.
   ========================================================================== */
(function (global) {
  "use strict";

  const CFG = {
    SIMILARIDADE_MIN: 87,
    DIF_NUM_VIZINHO: 30,
    CEPS_GENERICOS: new Set(["13140000"]),
  };

  // ---------------------------------------------------------------- texto
  const MOJIBAKE = { "┴": "Á", "└": "À", "┬": "Â", "├": "Ã", "╔": "É", "╩": "Ê", "═": "Í",
    "Ë": "Ó", "È": "Ô", "ı": "Õ", "┌": "Ú", "▄": "Ü", "ß": "Á", "Ò": "Ã",
    "þ": "Ç", "Û": "Ê", "Ý": "Í", "¾": "Ó", "¶": "Ô", "§": "Õ", "·": "Ú", "³": "Ü" };

  const TIPOS = { RUA: "RUA", R: "RUA", RU: "RUA", AVENIDA: "AVENIDA", AV: "AVENIDA", AVE: "AVENIDA",
    AVN: "AVENIDA", AVDA: "AVENIDA", ALAMEDA: "ALAMEDA", AL: "ALAMEDA", TRAVESSA: "TRAVESSA",
    TV: "TRAVESSA", TRAV: "TRAVESSA", PRACA: "PRACA", PCA: "PRACA", PC: "PRACA", ESTRADA: "ESTRADA",
    EST: "ESTRADA", ESTR: "ESTRADA", RODOVIA: "RODOVIA", ROD: "RODOVIA", VIELA: "VIELA", VIA: "VIA",
    LARGO: "LARGO", LGO: "LARGO", PASSAGEM: "PASSAGEM", VILA: "VILA", VL: "VILA", CAMINHO: "CAMINHO" };

  const TITULOS = new Set(("DR DRA DOUTOR DOUTORA PROF PROFA PROFESSOR PROFESSORA PREF PREFEITO PREFEITA " +
    "ENG ENGENHEIRO ENGENHEIRA PADRE PE CEL CORONEL GAL GEN GENERAL VEREADOR VEREADORA VER DEP DEPUTADO " +
    "DEPUTADA SEN SENADOR PRES PRESIDENTE MAJ MAJOR CAP CAPITAO TEN TENENTE SGT SARGENTO MAL MARECHAL ALM " +
    "ALMIRANTE COMEND COMENDADOR MONS MONSENHOR FREI IRMA IRMAO DOM DONA SR SRA MESTRE MAESTRO PASTOR BISPO " +
    "CONEGO DESEMBARGADOR JUIZ MINISTRO GOVERNADOR BRIGADEIRO COMANDANTE SOLDADO CABO PROFESSORES ENFERMEIRA").split(" "));
  const TITULOS_LONGOS = [...TITULOS].filter(t => t.length >= 6);
  const TIPOS_LONGOS = ["AVENIDA", "ALAMEDA", "TRAVESSA", "ESTRADA", "RODOVIA", "PASSAGEM", "CAMINHO"];
  const ABREV = { STA: "SANTA", STO: "SANTO", JD: "JARDIM", PQ: "PARQUE", RES: "RESIDENCIAL", VL: "VILA",
    MTE: "MONTE", CJ: "CONJUNTO", COND: "CONDOMINIO" };
  const STOP = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "D", "DS"]);
  const ROMANOS = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10" };

  function corrigirCodificacao(s) {
    let o = "";
    for (const ch of s) o += MOJIBAKE[ch] || ch;
    return o.replace(/Ã(?=[AU])/g, "Ç");
  }
  function semAcento(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function vazio(v) { return v === null || v === undefined || (typeof v === "number" && isNaN(v)) || String(v).trim() === "" || String(v).toLowerCase() === "nan"; }

  function textoBasico(v) {
    if (vazio(v)) return "";
    let s = corrigirCodificacao(String(v)).toUpperCase().trim();
    s = corrigirCodificacao(s);
    s = semAcento(s).replace(/'/g, "");
    s = s.replace(/[^A-Z0-9]+/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }

  function fonetica(t) {
    if (/^\d+$/.test(t)) return t;
    t = t.replace(/PH/g, "F").replace(/TH/g, "T").replace(/Y/g, "I").replace(/W/g, "V").replace(/K/g, "C");
    t = t.replace(/C(?=[EI])/g, "S").replace(/Z/g, "S").replace(/^H/, "");
    return t.replace(/(.)\1+/g, "$1");
  }

  // ------------------------------------------------------- semelhança (≈ rapidfuzz)
  function lcs(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
    for (let i = 1; i <= n; i++) {
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : (prev[j] > cur[j - 1] ? prev[j] : cur[j - 1]);
      }
      const t = prev; prev = cur; cur = t; cur.fill(0);
    }
    return prev[m];
  }
  function ratio(a, b) {
    if (!a.length && !b.length) return 100;
    return (200 * lcs(a, b)) / (a.length + b.length);
  }
  function tokenSort(a, b) {
    return ratio(a.split(" ").filter(Boolean).sort().join(" "), b.split(" ").filter(Boolean).sort().join(" "));
  }
  function tokenSet(a, b) {
    const A = new Set(a.split(" ").filter(Boolean)), B = new Set(b.split(" ").filter(Boolean));
    const inter = [...A].filter(x => B.has(x)).sort();
    const ab = [...A].filter(x => !B.has(x)).sort(), ba = [...B].filter(x => !A.has(x)).sort();
    if (inter.length && (!ab.length || !ba.length)) return 100;
    const sect = inter.join(" ");
    const sab = (sect ? sect + " " : "") + ab.join(" ");
    const sba = (sect ? sect + " " : "") + ba.join(" ");
    let r = ratio(sab, sba);
    if (sect) r = Math.max(r, ratio(sect, sab), ratio(sect, sba));
    return r;
  }
  function bigramas(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  }
  function dice(ma, la, mb, lb) {
    if (la + lb === 0) return 0;
    let inter = 0;
    for (const [g, c] of ma) { const d = mb.get(g); if (d) inter += Math.min(c, d); }
    return (2 * inter) / (la + lb);
  }

  function chaveRua(nome) {
    let toks = textoBasico(nome).split(" ").filter(Boolean);
    let tipo = "";
    for (;;) {
      if (toks.length < 2) break;
      if (TIPOS[toks[0]]) { tipo = tipo || TIPOS[toks[0]]; toks = toks.slice(1); continue; }
      // tipo digitado errado: "AVENDA", "VENIDA", "TRAVESA"
      const t0 = toks[0];
      const tl = t0.length >= 5 ? TIPOS_LONGOS.find(t => ratio(t0, t) >= 80) : null;
      if (tl) { tipo = tipo || TIPOS[tl]; toks = toks.slice(1); continue; }
      break;
    }
    // ruas numeradas ("RUA 12", "RUA DOZE" ficam como estão)
    // título digitado errado no começo ("PREOFESSOR", "GENERL", "BRIGDEIRO")
    while (toks.length >= 2 && toks[0].length >= 5 && TITULOS_LONGOS.some(t => ratio(toks[0], t) >= 85)) toks = toks.slice(1);
    let out = [];
    for (let t of toks) {
      if (TITULOS.has(t) || STOP.has(t)) continue;
      if (t !== "S" && t !== "N") t = ABREV[t] || t;
      t = ROMANOS[t] || t;
      out.push(fonetica(t));
    }
    const semSN = out.filter(t => t !== "S" && t !== "N");
    if (semSN.length) out = semSN;
    return { chave: out.join(" "), tipo };
  }

  function limparNumero(v) {
    if (vazio(v)) return "";
    let s = String(v).trim().toUpperCase();
    if (/^\d+\.0+$/.test(s)) s = s.split(".")[0];
    return s;
  }

  const RE_TEL = /\(?\b\d{2}\)?\s*9?\s*\d{4}\s*-\s*\d{4}\b|\b9?\d{4}-\d{4}\b/g;
  const RE_COMP_COND = /\b(BLOCO|BL|QUADRA|QD|LOTE|LT|TORRE|APTO|AP|APARTAMENTO|CASA|CS|UNIDADE|UN|CONDOMINIO|COND|RESIDENCIAL)\b/;

  function separarRuaNumero(ruaBruta, numBruto) {
    const obs = [];
    let complemento = "";
    let rua = corrigirCodificacao(corrigirCodificacao(vazio(ruaBruta) ? "" : String(ruaBruta)).toUpperCase());
    if (RE_TEL.test(rua)) { rua = rua.replace(RE_TEL, " "); obs.push("telefone removido da rua"); }
    RE_TEL.lastIndex = 0;
    rua = rua.replace(/\(\s*\)/g, " ");
    let numRua = null;
    let m = rua.match(/,\s*(?:N[º°O]?\.?\s*)?(\d{1,5})\b(.*)$/);
    if (m) {
      numRua = m[1];
      if (m[2].trim()) { complemento = m[2].trim().replace(/^[,;\-\s]+/, ""); obs.push(`complemento separado: '${complemento}'`); }
      rua = rua.slice(0, m.index);
    } else {
      m = rua.match(/(?:\s|(?<=[A-Z]))(?:N[º°O]?\.?\s*)?(\d{1,5})\s*$/);
      const antes = m ? textoBasico(rua.slice(0, m.index)).split(" ").filter(Boolean) : [];
      const soTipo = antes.length === 0 || (antes.length === 1 && TIPOS[antes[0]]);          // "RUA 12"
      const codigoVia = /\b(BRASIL|ESTRADA|RODOVIA|SP|SPA|BR|KM|PLN|ROD|EST|VICINAL)\s*\d*\s*$/.test(rua.slice(0, m ? m.index + m[0].length : 0));
      if (m && !soTipo && !codigoVia) {
        numRua = m[1];
        rua = rua.slice(0, m.index);
      }
    }
    rua = rua.replace(/^[\s,;\-.:]+|[\s,;\-.:]+$/g, "");
    rua = rua.replace(/^(RUA|AV|AVENIDA|R)\s*[:.]\s*/, "$1 ");

    const num = limparNumero(numBruto);
    let n = null, sufixo = "";
    const m2 = num.match(/^(\d+)\s*([A-Z]?)$/);
    if (m2 && parseInt(m2[1], 10) > 0) { n = parseInt(m2[1], 10); sufixo = m2[2]; }
    if (n === null && numRua) { n = parseInt(numRua, 10); obs.push("número tirado do campo rua"); }
    else if (n !== null && numRua && parseInt(numRua, 10) !== n) obs.push(`rua tinha outro número (${numRua}); usado ${n}`);
    if (n === null) obs.push("sem número");
    return { rua, n, sufixo, obs, complemento };
  }

  // ---------------------------------------------------------------- motor
  const ORDEM = { "ALTA": 0, "MÉDIA": 1, "BAIXA": 2, "NÃO ENCONTRADO": 3 };

  function criarMotor(dados) {
    const ceps = dados.ceps;
    const zonaPorQt = new Map();
    for (const [cod, zona] of dados.quarteiroes) if (!zonaPorQt.has(cod)) zonaPorQt.set(cod, zona);

    // ruas base (CNEFE)
    const ruasBase = new Map(); // chave -> {nome, regs:[{n,q,lat,lon,cep,ok,cont}]}
    for (const [nome, ent] of dados.ruas) {
      const { chave } = chaveRua(nome);
      if (!chave) continue;
      const regs = ent.map(e => ({ n: e[0], q: e[1], lat: e[2], lon: e[3], cep: ceps[e[4]], ok: e[5], cont: e[6] }));
      if (ruasBase.has(chave)) ruasBase.get(chave).regs.push(...regs);
      else ruasBase.set(chave, { nome, regs });
    }

    let ruas, chaves, indice, prop, fontes, aliases, condPorChave, condominios;
    const cacheRua = new Map();

    function reindexar(apr) {
      apr = apr || {};
      ruas = new Map(ruasBase);
      prop = new Map(); // chave -> Map(n -> q)
      fontes = new Map(); // "chave|n" -> fonte
      for (const c of (apr.correcoes || [])) {
        if (!c.chave || c.numero == null || !c.quarteirao) continue;
        if (!ruas.has(c.chave)) ruas.set(c.chave, { nome: c.rua, regs: [], nova: true });
        if (!prop.has(c.chave)) prop.set(c.chave, new Map());
        prop.get(c.chave).set(Number(c.numero), String(c.quarteirao));
        fontes.set(c.chave + "|" + Number(c.numero), c.fonte || "manual");
      }
      aliases = new Map();
      for (const a of (apr.aliases || [])) if (a.de && a.para) {
        aliases.set(a.de, a.para);
        if (!ruas.has(a.para)) ruas.set(a.para, { nome: a.nome || a.para, regs: [], nova: true });
      }
      for (const r of (apr.ruasNovas || [])) {
        const { chave } = chaveRua(r.nome);
        if (chave && !ruas.has(chave)) ruas.set(chave, { nome: r.nome.toUpperCase(), regs: [], nova: true });
      }
      chaves = [...ruas.keys()];
      indice = chaves.map(k => { const s = k.replace(/ /g, ""); return { k, s, bg: bigramas(s), len: Math.max(0, s.length - 1), toks: k.split(" ") }; });
      // condomínios: base + edições (por id; a mais recente vence) + novos
      const porId = new Map();
      for (const c of (dados.condominios || [])) porId.set(c.id, JSON.parse(JSON.stringify(c)));
      for (const c of (apr.condominios || [])) {
        const ant = porId.get(c.id);
        if (c.removido) { porId.delete(c.id); continue; }
        porId.set(c.id, Object.assign({}, ant || {}, c, { mapa_interno: Object.assign({}, (ant && ant.mapa_interno) || {}, c.mapa_interno || {}) }));
      }
      condominios = [...porId.values()];
      condPorChave = new Map();
      for (const c of condominios) {
        const { chave } = chaveRua(c.rua);
        c._chave = chave;
        condPorChave.set(chave + "|" + c.numero, c);
      }
      cacheRua.clear();
    }
    reindexar({});

    function cepsDaRua(k) {
      const r = ruas.get(k); const s = new Set();
      if (r) for (const x of r.regs) s.add(x.cep);
      return s;
    }

    function pontuarRuas(chave, cep, limite) {
      const semEsp = chave.replace(/ /g, "");
      const bq = bigramas(semEsp), lq = Math.max(0, semEsp.length - 1);
      const qToks = chave.split(" ");
      // pré-seleção barata
      const pre = [];
      for (const it of indice) {
        let d = dice(bq, lq, it.bg, it.len);
        // ajuda nomes incompletos: palavra rara em comum
        if (d < 0.5 && qToks.some(t => t.length >= 5 && it.toks.includes(t))) d += 0.25;
        pre.push([d, it]);
      }
      pre.sort((a, b) => b[0] - a[0]);
      const pont = [];
      for (const [, it] of pre.slice(0, 45)) {
        const k = it.k, kToks = it.toks;
        const qExp = qToks.map(t => t.length === 1 ? (kToks.find(kt => kt.startsWith(t)) || t) : t).join(" ");
        let s = Math.max(tokenSort(qExp, k), ratio(qExp.replace(/ /g, ""), it.s));
        const comuns = qToks.filter(t => kToks.some(kt => ratio(t, kt) >= 85));
        if (comuns.length >= 2 && comuns.join("").length >= 10 && comuns.length >= qToks.length - 1)
          s = Math.max(s, tokenSet(qExp, k) - 6);
        if (cep && !CFG.CEPS_GENERICOS.has(cep) && cepsDaRua(k).has(cep)) s += 5;
        pont.push([Math.min(Math.round(s * 10) / 10, 99.9), k]);
      }
      pont.sort((a, b) => b[0] - a[0]);
      return pont.slice(0, limite || 6);
    }

    function acharRua(chave, cep) {
      if (!chave) return { k: null, sim: 0, obs: "rua vazia" };
      if (aliases.has(chave)) return { k: aliases.get(chave), sim: 100, obs: "", alias: true };
      if (ruas.has(chave)) return { k: chave, sim: 100, obs: "" };
      const ck = chave + "|" + cep;
      if (cacheRua.has(ck)) return cacheRua.get(ck);
      const pont = pontuarRuas(chave, cep, 6);
      let res = { k: null, sim: pont.length ? pont[0][0] : 0, obs: "rua não encontrada" };
      if (pont.length && pont[0][0] >= CFG.SIMILARIDADE_MIN) {
        let obs = "";
        if (pont.length > 1 && pont[1][0] >= CFG.SIMILARIDADE_MIN && pont[0][0] - pont[1][0] < 3)
          obs = `rua ambígua (2ª opção: ${ruas.get(pont[1][1]).nome})`;
        res = { k: pont[0][1], sim: Math.round(pont[0][0] * 10) / 10, obs };
      }
      cacheRua.set(ck, res);
      return res;
    }

    function moda(regs) {
      const c = new Map(); let tot = 0;
      for (const r of regs) { const w = r.cont || 1; c.set(r.q, (c.get(r.q) || 0) + w); tot += w; }
      let best = null, bn = -1;
      for (const [q, v] of c) if (v > bn) { best = q; bn = v; }
      return { q: best, frac: bn / tot };
    }
    function centro(regs, q) {
      const p = regs.filter(r => r.q === q && r.lat != null);
      if (!p.length) return null;
      return [p.reduce((a, r) => a + r.lat, 0) / p.length, p.reduce((a, r) => a + r.lon, 0) / p.length];
    }

    function _achar(regs, pr, n) {
      const todos = new Set(regs.map(r => r.q));
      if (n === null) {
        if (todos.size === 1) return { q: [...todos][0], met: "rua toda num só quarteirão", conf: "MÉDIA", obs: "endereço sem número" };
        return { q: null, met: "sem número", conf: "NÃO ENCONTRADO", obs: `rua passa por ${todos.size} quarteirões; precisa do número` };
      }
      const exatos = regs.filter(r => r.n === n);
      if (exatos.length) {
        const { q, frac } = moda(exatos);
        const p = centro(exatos, q);
        const ok = frac >= 0.75 && exatos.every(r => r.q !== q || r.ok);
        return { q, met: "CNEFE (número exato)", conf: ok ? "ALTA" : "MÉDIA", obs: ok ? "" : "pontos do mesmo número em quarteirões diferentes", lat: p && p[0], lon: p && p[1] };
      }
      const lado = new Map();
      for (const r of regs) if (r.n > 0 && r.n % 2 === n % 2) { if (!lado.has(r.n)) lado.set(r.n, []); lado.get(r.n).push(r); }
      for (const [np, qp] of pr) if (np % 2 === n % 2) { if (!lado.has(np)) lado.set(np, []); lado.get(np).push({ n: np, q: qp, lat: null, lon: null, cont: 1000 }); }
      if (!lado.size) return { q: null, met: "sem vizinhos do mesmo lado", conf: "NÃO ENCONTRADO", obs: "nenhum número do mesmo lado da rua na base" };
      const nums = [...lado.keys()].sort((a, b) => a - b);
      const abaixo = nums.filter(x => x < n), acima = nums.filter(x => x > n);
      const na = abaixo.length ? abaixo[abaixo.length - 1] : null, nb = acima.length ? acima[0] : null;
      const qa = na !== null ? moda(lado.get(na)).q : null, qb = nb !== null ? moda(lado.get(nb)).q : null;
      const pa = na !== null ? centro(lado.get(na), qa) : null, pb = nb !== null ? centro(lado.get(nb), qb) : null;
      let lat = null, lon = null;
      if (pa && pb) { const t = (n - na) / (nb - na); lat = pa[0] + t * (pb[0] - pa[0]); lon = pa[1] + t * (pb[1] - pa[1]); }
      else if (pa || pb) { const p = pa || pb; lat = p[0]; lon = p[1]; }
      if (qa && qb && qa === qb) return { q: qa, met: `faixa (${na}–${nb})`, conf: "ALTA", obs: "", lat, lon };
      const cand = [];
      if (na !== null) cand.push([n - na, na, qa]);
      if (nb !== null) cand.push([nb - n, nb, qb]);
      cand.sort((a, b) => a[0] - b[0]);
      const [d, viz, q] = cand[0];
      if (d > CFG.DIF_NUM_VIZINHO) return { q, met: `vizinho distante (nº ${viz})`, conf: "BAIXA", obs: `número mais próximo na base está a ${d} de distância`, lat, lon, alternativas: [qa, qb].filter(Boolean) };
      if (qa && qb) return { q, met: `divisa (nº ${viz})`, conf: "BAIXA", obs: `entre o quarteirão ${qa} (nº ${na}) e o ${qb} (nº ${nb})`, lat, lon, alternativas: [qa, qb] };
      return { q, met: `vizinho mais próximo (nº ${viz})`, conf: "MÉDIA", obs: "", lat, lon };
    }

    function acharQuarteirao(k, n, cep) {
      const r = ruas.get(k) || { regs: [] };
      const pr = prop.get(k) || new Map();
      if (n !== null && pr.has(n)) {
        const f = fontes.get(k + "|" + n) || "manual";
        return { q: pr.get(n), met: f === "manual" ? "base aprendida (correção manual)" : `base aprendida (importada: ${f})`, conf: "ALTA", obs: "" };
      }
      const tent = [r.regs];
      if (cep && !CFG.CEPS_GENERICOS.has(cep)) {
        const f = r.regs.filter(x => x.cep === cep);
        if (f.length && f.length < r.regs.length) tent.unshift(f);
      }
      let melhor = null;
      for (const t of tent) {
        const res = _achar(t, pr, n);
        if (!melhor || ORDEM[res.conf] < ORDEM[melhor.conf]) melhor = res;
        if (ORDEM[res.conf] <= 1) break;
      }
      return melhor;
    }

    function chaveInterna(txt) { return textoBasico(txt); }
    function acharInterno(cond, complemento) {
      const comp = chaveInterna(complemento);
      if (!comp || !cond.mapa_interno) return null;
      const ct = new Set(comp.split(" "));
      const ks = Object.keys(cond.mapa_interno).sort((a, b) => b.length - a.length);
      for (const k of ks) if (k.split(" ").every(t => ct.has(t))) return { chave: k, q: cond.mapa_interno[k] };
      return null;
    }

    /** linha = {rua, numero, cep, bairro, complemento} */
    function processar(linha) {
      const sep = separarRuaNumero(linha.rua, linha.numero);
      const obs = sep.obs.slice();
      let complemento = [sep.complemento, vazio(linha.complemento) ? "" : String(linha.complemento)].filter(Boolean).join(" ").trim();
      const cep = limparNumero(linha.cep).replace(/\D/g, "").slice(0, 8);
      const { chave } = chaveRua(sep.rua);
      const ar = acharRua(chave, cep);
      if (ar.obs && ar.k) obs.push(ar.obs);
      let res;
      if (!ar.k) res = { q: null, met: "rua não encontrada", conf: "NÃO ENCONTRADO", obs: "" };
      else {
        res = acharQuarteirao(ar.k, sep.n, cep);
      }
      if (res.obs) obs.push(res.obs);

      // condomínios
      let cond = null;
      if (ar.k && sep.n !== null) cond = condPorChave.get(ar.k + "|" + sep.n) || null;
      if (cond) {
        const nome = cond.nome || `Condomínio ${cond.rua}, ${cond.numero}`;
        const interno = acharInterno(cond, complemento);
        if (interno) {
          res = Object.assign({}, res, { q: interno.q, met: `condomínio — endereço interno "${interno.chave}"`, conf: "ALTA" });
          obs.push(`${nome}`);
        } else if (cond.situacao === "portaria" && cond.quarteiroes && cond.quarteiroes.length === 1) {
          if (!res.met.startsWith("base aprendida")) res = Object.assign({}, res, { q: cond.quarteiroes[0], met: "condomínio (portaria resolve)", conf: "ALTA" });
          obs.push(`${nome} — fica num só quarteirão`);
        } else {
          res = Object.assign({}, res, { conf: "BAIXA", met: "condomínio — endereço de portaria", alternativas: cond.quarteiroes });
          obs.push(`${nome} ocupa ${(cond.quarteiroes || []).length} quarteirões (${(cond.quarteiroes || []).join(", ")}): informe casa/quadra/bloco ou o endereço real`);
        }
      } else if (complemento && RE_COMP_COND.test(textoBasico(complemento))) {
        obs.push("complemento sugere condomínio/prédio — verifique se é endereço de portaria");
      }
      if (ar.k && !ar.alias) {
        if (ar.sim < 90 && (res.conf === "ALTA" || res.conf === "MÉDIA")) { res = Object.assign({}, res, { conf: "BAIXA" }); obs.push("nome da rua bem diferente do encontrado — conferir"); }
        else if (res.conf === "ALTA" && ar.sim < 95) { res = Object.assign({}, res, { conf: "MÉDIA" }); obs.push("nome da rua corrigido por semelhança — conferir"); }
      }
      return {
        quarteirao: res.q || "", zona: res.q ? (zonaPorQt.get(res.q) || "") : "",
        confianca: res.conf, metodo: res.met, obs: obs.filter(Boolean).join("; "),
        ruaEncontrada: ar.k ? ruas.get(ar.k).nome : "", chaveRua: ar.k || "", chaveDigitada: chave,
        similaridade: ar.k ? ar.sim : null, numero: sep.n, sufixo: sep.sufixo, ruaLimpa: textoBasico(sep.rua),
        complemento, lat: res.lat || null, lon: res.lon || null,
        condominio: cond ? cond.id : "", condominioNome: cond ? (cond.nome || `Condomínio ${cond.rua}, ${cond.numero}`) : "",
        alternativas: res.alternativas || [],
      };
    }

    return {
      processar, reindexar, chaveRua, textoBasico, chaveInterna,
      sugerirRuas: (texto, cep) => pontuarRuas(chaveRua(texto).chave, cep || "", 8).map(([s, k]) => ({ chave: k, nome: ruas.get(k).nome, sim: s })),
      nomeRua: k => (ruas.get(k) || {}).nome || "",
      numerosDaRua: k => { const r = ruas.get(k); return r ? r.regs : []; },
      pontosDoCep: cep => { const out = []; if (!cep || CFG.CEPS_GENERICOS.has(cep)) return out; for (const r of ruasBase.values()) for (const x of r.regs) if (x.cep === cep) out.push(x); return out; },
      aprendidosDaRua: k => prop.get(k) || new Map(),
      condominios: () => condominios,
      zona: q => zonaPorQt.get(q) || "",
      existeQuarteirao: q => zonaPorQt.has(q),
      estat: () => ({ ruas: ruas.size, ruasNovas: [...ruas.values()].filter(r => r.nova).length, condominios: condominios.length }),
      CFG,
    };
  }

  const api = { criarMotor, chaveRua, textoBasico, separarRuaNumero, ratio, tokenSet, tokenSort };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.MotorQuarteirao = api;
})(typeof window !== "undefined" ? window : globalThis);
