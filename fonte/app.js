/* ==========================================================================
   QUARTEIRÃO POR ENDEREÇO — aplicação
   - A planilha de casos é lida e processada só no navegador (memória).
   - A base de conhecimento (rua+número → quarteirão, apelidos de rua,
     condomínios) fica no IndexedDB e sincroniza com o Supabase.
   ========================================================================== */
(function () {
"use strict";

// ------------------------------------------------------------------ util
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Number(n || 0).toLocaleString("pt-BR");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vazio = v => v == null || String(v).trim() === "";
const confCls = c => c === "ALTA" ? "ALTA" : c === "MÉDIA" ? "MEDIA" : c === "BAIXA" ? "BAIXA" : "NAO";
function normQ(v) {
  let s = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "";
  const m = s.match(/^0*(\d+)([A-Z]?)$/);
  if (m) return m[1].padStart(4, "0") + m[2];
  return s;
}
function msg(alvo, tipo, texto) {
  const e = typeof alvo === "string" ? $(alvo) : alvo;
  if (!e) return;
  e.innerHTML = texto ? `<div class="${tipo === "ok" ? "ok-msg" : tipo === "erro" ? "err-msg" : "aviso"}">${texto}</div>` : "";
}

const DADOS = JSON.parse(document.getElementById("dados").textContent);
const MOTOR = MotorQuarteirao.criarMotor(DADOS);
const textoBasico = MotorQuarteirao.textoBasico;

// ------------------------------------------------------------------ IndexedDB (chave → valor)
const KV = (() => {
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open("quarteirao-enderecos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  return {
    async get(k) { try { const d = await db(); return await new Promise((res, rej) => { const t = d.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch (e) { return undefined; } },
    async set(k, v) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { console.warn("IndexedDB indisponível", e); } },
  };
})();

// ------------------------------------------------------------------ ZIP / XLSX / CSV
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function inflar(u8) {
  const ds = new DecompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
}
async function deflar(u8) {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
}
async function lerZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("arquivo não é .xlsx válido");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const arquivos = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const nome = dec.decode(u8.subarray(p + 46, p + 46 + ln));
    arquivos[nome] = { metodo, tam, off };
    p += 46 + ln + le + lc;
  }
  return {
    nomes: Object.keys(arquivos),
    async texto(nome) {
      const a = arquivos[nome]; if (!a) return null;
      const ini = a.off + 30 + dv.getUint16(a.off + 26, true) + dv.getUint16(a.off + 28, true);
      const dados = u8.subarray(ini, ini + a.tam);
      const bruto = a.metodo === 0 ? dados : await inflar(dados);
      return new TextDecoder("utf-8").decode(bruto);
    },
  };
}
function colIdx(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function lerXlsx(buf) {
  const z = await lerZip(buf);
  const P = new DOMParser();
  const xml = async n => { const t = await z.texto(n); return t ? P.parseFromString(t, "application/xml") : null; };
  const wb = await xml("xl/workbook.xml");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const alvo = {};
  for (const r of rels.getElementsByTagName("Relationship")) alvo[r.getAttribute("Id")] = r.getAttribute("Target");
  const ss = [];
  const sst = await xml("xl/sharedStrings.xml");
  if (sst) for (const si of sst.getElementsByTagName("si")) { let t = ""; for (const x of si.getElementsByTagName("t")) t += x.textContent; ss.push(t); }
  const abas = [];
  for (const s of wb.getElementsByTagName("sheet")) {
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let caminho = alvo[rid] || ""; caminho = caminho.replace(/^\//, "");
    if (!caminho.startsWith("xl/")) caminho = "xl/" + caminho;
    abas.push({ nome: s.getAttribute("name"), caminho });
  }
  async function lerAba(i) {
    const doc = await xml(abas[i].caminho);
    const linhas = [];
    for (const row of doc.getElementsByTagName("row")) {
      const r = parseInt(row.getAttribute("r"), 10) - 1;
      const vals = [];
      for (const c of row.getElementsByTagName("c")) {
        const ref = c.getAttribute("r"); const t = c.getAttribute("t");
        let v = "";
        if (t === "inlineStr") { for (const x of c.getElementsByTagName("t")) v += x.textContent; }
        else { const ve = c.getElementsByTagName("v")[0]; v = ve ? ve.textContent : ""; if (t === "s") v = ss[parseInt(v, 10)] || ""; else if (t === "b") v = v === "1" ? "VERDADEIRO" : "FALSO"; }
        vals[ref ? colIdx(ref) : vals.length] = v;
      }
      linhas[isNaN(r) ? linhas.length : r] = vals;
    }
    return linhas.filter(Boolean).map(l => Array.from(l, v => v == null ? "" : v));
  }
  return { abas: abas.map(a => a.nome), lerAba };
}
function lerCsv(buf) {
  let txt = new TextDecoder("utf-8").decode(buf);
  if (txt.includes("�")) txt = new TextDecoder("windows-1252").decode(buf);
  txt = txt.replace(/^﻿/, "");
  const prim = txt.slice(0, 3000);
  const sep = [";", ",", "\t"].sort((a, b) => prim.split(b).length - prim.split(a).length)[0];
  const out = []; let lin = [], campo = "", aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === sep) { lin.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && txt[i + 1] === "\n") i++; lin.push(campo); out.push(lin); lin = []; campo = ""; }
    else campo += ch;
  }
  if (campo || lin.length) { lin.push(campo); out.push(lin); }
  return out.filter(l => l.some(v => String(v).trim() !== ""));
}
async function lerPlanilha(arquivo) {
  const buf = await arquivo.arrayBuffer();
  if (/\.xlsx$/i.test(arquivo.name)) return await lerXlsx(buf);
  if (/\.xls$/i.test(arquivo.name)) throw new Error("Formato .xls antigo: abra no Excel e salve como .xlsx ou .csv");
  const linhas = lerCsv(buf);
  return { abas: ["CSV"], lerAba: async () => linhas };
}

// escrita .xlsx
const xesc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
function letra(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function folhaXml(cab, linhas, estiloLinha, larguras) {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  x += "<cols>" + cab.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${(larguras && larguras[i]) || 14}" customWidth="1"/>`).join("") + "</cols><sheetData>";
  const linha = (r, vals, est) => `<row r="${r}">` + vals.map((v, i) => {
    const s = typeof est === "function" ? est(i) : est;
    if (typeof v === "number" && isFinite(v)) return `<c r="${letra(i)}${r}"${s ? ` s="${s}"` : ""}><v>${v}</v></c>`;
    return `<c r="${letra(i)}${r}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }).join("") + "</row>";
  x += linha(1, cab, 1);
  linhas.forEach((l, j) => { x += linha(j + 2, l, estiloLinha ? estiloLinha(j) : 0); });
  x += `</sheetData><autoFilter ref="A1:${letra(cab.length - 1)}${linhas.length + 1}"/></worksheet>`;
  return x;
}
async function gerarXlsx(folhas) {
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    folhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    folhas.map((f, i) => `<sheet name="${xesc(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets></workbook>";
  const wbr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    folhas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${folhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const fill = c => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const sty = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    `<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill("C6EFCE")}${fill("FFEB9C")}${fill("F8CBAD")}${fill("D9D9D9")}${fill("BDD7EE")}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    [2, 3, 4, 5, 6].map(f => `<xf numFmtId="0" fontId="0" fillId="${f}" borderId="0" xfId="0" applyFill="1"/>`).join("") + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const arqs = [["[Content_Types].xml", ct], ["_rels/.rels", rels], ["xl/workbook.xml", wb], ["xl/_rels/workbook.xml.rels", wbr], ["xl/styles.xml", sty]];
  folhas.forEach((f, i) => arqs.push([`xl/worksheets/sheet${i + 1}.xml`, f.xml]));
  const enc = new TextEncoder(); const partes = []; const central = []; let off = 0;
  for (const [nome, txt] of arqs) {
    const bruto = enc.encode(txt), nb = enc.encode(nome), crc = crc32(bruto);
    const comp = await deflar(bruto); const metodo = comp ? 8 : 0; const dados = comp || bruto;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, metodo, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, dados.length, true); lh.setUint32(22, bruto.length, true); lh.setUint16(26, nb.length, true);
    partes.push(new Uint8Array(lh.buffer), nb, dados);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, metodo, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, dados.length, true); ch.setUint32(24, bruto.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + dados.length;
  }
  const tamC = central.reduce((a, b) => a + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arqs.length, true); fim.setUint16(10, arqs.length, true); fim.setUint32(12, tamC, true); fim.setUint32(16, off, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function baixar(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

// ------------------------------------------------------------------ base compartilhada (local + Supabase)
const CFG_PADRAO = { url: "__SUPABASE_URL__", key: "__SUPABASE_KEY__" };
const TABELAS = {
  correcoes: { chave: o => o.chave + "|" + o.numero, conflito: "chave,numero", envio: o => ({ chave: o.chave, numero: o.numero, rua: o.rua, quarteirao: o.quarteirao || null, fonte: o.fonte || "manual" }) },
  aliases: { chave: o => o.de, conflito: "de", envio: o => ({ de: o.de, para: o.para, nome: o.nome || null }) },
  condominios: { chave: o => o.id, conflito: "id", envio: o => { const d = Object.assign({}, o); delete d.id; delete d._chave; delete d.removido; delete d.pendente; delete d.usuario; delete d.mes; delete d.versao; return { id: o.id, dados: d, removido: !!o.removido }; } },
};
const Sync = {
  cfg: Object.assign({}, CFG_PADRAO),
  apr: { correcoes: {}, aliases: {}, condominios: {} },
  versao: { correcoes: 0, aliases: 0, condominios: 0 },
  fila: [],
  sessao: null,          // {access_token, refresh_token, expires_at, email}
  perfil: null,          // linha em autorizados
  estado: "local",       // local | ok | pendente | semrede | naoliberado | erro
  ocupado: false,

  async iniciar() {
    const s = await KV.get("estado");
    if (s) { this.apr = s.apr || this.apr; this.versao = s.versao || this.versao; this.fila = s.fila || []; }
    try { const c = JSON.parse(localStorage.getItem("qe-cfg") || "null"); if (c && c.url && c.key) this.cfg = c; } catch (e) {}
    try { this.sessao = JSON.parse(localStorage.getItem("qe-sessao") || "null"); } catch (e) {}
    // volta do link de confirmação / recuperação de senha: o Supabase traz a sessão no endereço (#access_token=…)
    if (location.hash.includes("access_token=")) {
      const h = new URLSearchParams(location.hash.slice(1));
      try {
        const tok = h.get("access_token"); const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        this.guardarSessao({ access_token: tok, refresh_token: h.get("refresh_token"), expires_at: +h.get("expires_at") || undefined, expires_in: +h.get("expires_in") || 3600 }, payload.email);
        this._voltouDoEmail = true;
      } catch (e) { console.warn("sessão do link", e); }
      history.replaceState(null, "", location.pathname + location.search);
    } else if (location.hash.includes("error=")) {
      const h = new URLSearchParams(location.hash.slice(1));
      this._erroLink = h.get("error_description") || h.get("error");
      history.replaceState(null, "", location.pathname + location.search);
    }
    aplicarAprendizado(false);
    if (this.sessao) this.sincronizar();
    else this.atualizarPill();
    setInterval(() => { if (this.sessao) this.sincronizar(); }, 120000);
    window.addEventListener("online", () => { if (this.sessao) this.sincronizar(); });
    window.addEventListener("focus", () => { if (this.sessao && Date.now() - (this._ult || 0) > 30000) this.sincronizar(); });
  },
  async salvarLocal() { await KV.set("estado", { apr: this.apr, versao: this.versao, fila: this.fila }); },
  paraMotor() {
    return {
      correcoes: Object.values(this.apr.correcoes).filter(c => c.quarteirao),
      aliases: Object.values(this.apr.aliases),
      condominios: Object.values(this.apr.condominios),
    };
  },
  registrar(tipo, obj, adiar) {
    const k = TABELAS[tipo].chave(obj);
    this.apr[tipo][k] = Object.assign({}, obj, { pendente: true });
    if (!this.fila.some(f => f.tipo === tipo && f.k === k)) this.fila.push({ tipo, k });
    if (!adiar) { this.salvarLocal(); this.enviar(); }
    this.atualizarPill();
  },
  // ---- HTTP
  async req(caminho, op = {}, tentarRenovar = true) {
    const h = Object.assign({ apikey: this.cfg.key, "Content-Type": "application/json" }, op.headers || {});
    if (this.sessao && !op.semToken) {
      if (this.sessao.expires_at && this.sessao.expires_at - 60 < Date.now() / 1000 && tentarRenovar) await this.renovar();
      h.Authorization = "Bearer " + this.sessao.access_token;
    }
    const r = await fetch(this.cfg.url.replace(/\/$/, "") + caminho, Object.assign({}, op, { headers: h }));
    if (r.status === 401 && this.sessao && tentarRenovar && !op.semToken) { if (await this.renovar()) return this.req(caminho, op, false); }
    return r;
  },
  guardarSessao(j, email) {
    this.sessao = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Date.now() / 1000 + (j.expires_in || 3600)), email: (j.user && j.user.email) || email };
    localStorage.setItem("qe-sessao", JSON.stringify(this.sessao));
  },
  async renovar() {
    if (!this.sessao || !this.sessao.refresh_token) return false;
    try {
      const r = await this.req("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: this.sessao.refresh_token }), semToken: true }, false);
      if (!r.ok) { if (r.status === 400 || r.status === 401) this.sair(true); return false; }
      this.guardarSessao(await r.json(), this.sessao.email); return true;
    } catch (e) { return false; }
  },
  async entrar(email, senha) {
    const r = await this.req("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password: senha }), semToken: true });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "falha no login");
    this.guardarSessao(j, email);
    await this.sincronizar();
  },
  async criarConta(email, senha) {
    const volta = encodeURIComponent(location.protocol.startsWith("http") ? location.origin + location.pathname : "https://marckitto.github.io/quarteiroes/");
    const r = await this.req("/auth/v1/signup?redirect_to=" + volta, { method: "POST", body: JSON.stringify({ email, password: senha, options: { email_redirect_to: decodeURIComponent(volta) } }), semToken: true });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "falha ao criar conta");
    if (j.access_token) { this.guardarSessao(j, email); await this.sincronizar(); return "logado"; }
    return "confirmar";
  },
  sair(silencioso) {
    this.sessao = null; this.perfil = null; localStorage.removeItem("qe-sessao");
    this.estado = "local"; this.atualizarPill(); renderAcesso();
    if (!silencioso) msg("#lgMsg", "ok", "Você saiu. As correções continuam guardadas neste navegador.");
  },
  async checarPerfil() {
    const r = await this.req("/rest/v1/autorizados?select=email,nome,divisao,admin&email=eq." + encodeURIComponent(this.sessao.email.toLowerCase()));
    if (!r.ok) throw new Error("HTTP " + r.status);
    const l = await r.json();
    // e-mail pode ter sido cadastrado com maiúsculas
    if (!l.length) { const r2 = await this.req("/rest/v1/autorizados?select=email,nome,divisao,admin"); const l2 = r2.ok ? await r2.json() : []; this.perfil = l2.find(x => x.email.toLowerCase() === this.sessao.email.toLowerCase()) || null; }
    else this.perfil = l[0];
  },
  async puxar() {
    let mudou = false;
    for (const t of Object.keys(TABELAS)) {
      for (;;) {
        const r = await this.req(`/rest/v1/${t}?select=*&versao=gt.${this.versao[t] || 0}&order=versao.asc&limit=1000`);
        if (!r.ok) throw new Error(`HTTP ${r.status} ao ler ${t}`);
        const linhas = await r.json();
        for (const l of linhas) {
          const obj = t === "condominios" ? Object.assign({}, l.dados || {}, { id: l.id, removido: l.removido, usuario: l.usuario, mes: l.mes }) : l;
          const k = TABELAS[t].chave(obj);
          const local = this.apr[t][k];
          if (!(local && local.pendente)) { this.apr[t][k] = obj; mudou = true; }
          this.versao[t] = Math.max(this.versao[t] || 0, l.versao);
        }
        if (linhas.length < 1000) break;
      }
    }
    return mudou;
  },
  async enviar() {
    if (!this.sessao || !this.perfil || !this.fila.length || this._enviando) return;
    this._enviando = true;
    try {
      for (const t of Object.keys(TABELAS)) {
        if (t === "correcoes" && !this.perfil.admin) {
          const bloq = this.fila.filter(f => f.tipo === t && this.apr[t][f.k] && (this.apr[t][f.k].fonte || "manual") !== "manual");
          if (bloq.length) {
            const ks = new Set(bloq.map(f => f.k));
            this.fila = this.fila.filter(f => !(f.tipo === t && ks.has(f.k)));
            for (const k of ks) delete this.apr[t][k];
            this._erro = `${bloq.length} itens de importação descartados: importação é restrita ao administrador.`;
          }
        }
        let itens = this.fila.filter(f => f.tipo === t);
        while (itens.length) {
          const lote = itens.slice(0, 500);
          const corpo = lote.map(f => this.apr[t][f.k]).filter(Boolean).map(TABELAS[t].envio);
          if (corpo.length) {
            const r = await this.req(`/rest/v1/${t}?on_conflict=${TABELAS[t].conflito}`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(corpo) });
            if (!r.ok) throw new Error(`HTTP ${r.status} ao gravar ${t}: ${(await r.text()).slice(0, 200)}`);
          }
          const ks = new Set(lote.map(f => f.k));
          this.fila = this.fila.filter(f => !(f.tipo === t && ks.has(f.k)));
          for (const k of ks) if (this.apr[t][k]) delete this.apr[t][k].pendente;
          itens = itens.slice(500);
          this.atualizarPill();
        }
      }
      await this.salvarLocal();
      this.estado = "ok";
    } catch (e) {
      this.estado = navigator.onLine ? "erro" : "semrede"; this._erro = e.message; console.warn(e);
    } finally { this._enviando = false; this.atualizarPill(); }
  },
  async sincronizar() {
    if (!this.sessao || this.ocupado) return;
    this.ocupado = true; this._ult = Date.now();
    try {
      await this.checarPerfil();
      if (!this.perfil) { this.estado = "naoliberado"; return; }
      await this.enviar();
      const mudou = await this.puxar();
      await this.salvarLocal();
      this.estado = this.fila.length ? "pendente" : "ok";
      if (mudou) aplicarAprendizado(true);
    } catch (e) {
      this.estado = navigator.onLine ? "erro" : "semrede"; this._erro = e.message; console.warn(e);
    } finally { this.ocupado = false; this.atualizarPill(); renderAcesso(); renderBase(); }
  },
  atualizarPill() {
    const p = $("#pillSync"); if (!p) return;
    const pend = this.fila.length;
    let cls = "", txt = "";
    if (!this.sessao) { cls = pend ? "warn" : ""; txt = pend ? `Sem login · ${fmt(pend)} correções só neste navegador` : "Sem login · base só neste navegador"; }
    else if (this.estado === "naoliberado") { cls = "err"; txt = "E-mail ainda não liberado"; }
    else if (this.estado === "semrede") { cls = "warn"; txt = `Sem conexão · ${fmt(pend)} na fila`; }
    else if (this.estado === "erro") { cls = "err"; txt = "Erro ao sincronizar"; }
    else if (pend) { cls = "warn"; txt = `Enviando ${fmt(pend)}…`; }
    else { cls = "ok"; txt = "Base compartilhada em dia"; }
    p.innerHTML = `<span class="dot ${cls}"></span><span>${esc(txt)}</span>`;
    p.title = this._erro && (this.estado === "erro") ? this._erro : "Sincronização da base compartilhada";
  },
};

// ------------------------------------------------------------------ estado da planilha (só memória)
const P = { arquivo: null, leitor: null, aba: 0, linhas: [], cab: [], cols: {}, rows: [], filtroConf: null };
let REV = { fila: [], pos: 0, filtro: "pend" };

function aplicarAprendizado(reprocessar) {
  MOTOR.reindexar(Sync.paraMotor());
  if (reprocessar && P.rows.length) { for (const r of P.rows) r.res = MOTOR.processar(r.ent); renderResultado(); if (abaAtual === "revisar") renderRevisao(); }
  renderBase();
  $("#nCond").textContent = MOTOR.condominios().length;
  if (abaAtual === "condominios") renderCondList();
}
function final(r) {
  if (r.manual) return { q: r.manual.q, conf: "CORRIGIDO", met: "corrigido manualmente" };
  return { q: r.res.quarteirao, conf: r.res.confianca, met: r.res.metodo };
}
function pendente(r) {
  if (r.manual) return false;
  const c = r.res.confianca;
  return c === "BAIXA" || c === "NÃO ENCONTRADO" || /conferir|ambígua|portaria|sugere condomínio/.test(r.res.obs) || (r.res.metodo || "").includes("portaria");
}

// ------------------------------------------------------------------ abas
let abaAtual = "processar";
function irAba(a) {
  abaAtual = a;
  $$("nav button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === a)));
  $$(".aba").forEach(s => s.classList.toggle("ativa", s.id === "aba-" + a));
  if (a === "revisar") { montarFila(false); renderRevisao(); setTimeout(() => mapaRev && mapaRev.map.invalidateSize(), 50); }
  if (a === "condominios") { renderCondList(); setTimeout(() => { garantirMapaCond(); mapaCond.map.invalidateSize(); }, 50); }
  if (a === "base") { renderAcesso(); renderBase(); }
}
$$("nav button").forEach(b => b.addEventListener("click", () => irAba(b.dataset.aba)));

// ------------------------------------------------------------------ PROCESSAR
const drop = $("#drop");
["dragenter", "dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("sobre"); }));
["dragleave", "drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("sobre"); }));
drop.addEventListener("drop", ev => { const f = ev.dataTransfer.files[0]; if (f) abrirArquivo(f); });
$("#arquivo").addEventListener("change", ev => { const f = ev.target.files[0]; if (f) abrirArquivo(f); ev.target.value = ""; });

const PALAVRAS = {
  rua: ["LOGRAD", "RUA", "ENDERE", "LOGR"],
  num: ["NUMERO", "NUM", "NRO"],
  comp: ["COMPL"],
  bairro: ["BAIRRO", "LOCALIDADE"],
  cep: ["CEP"],
};
function detectar(cab, tipo) {
  const norm = cab.map(c => MotorQuarteirao.textoBasico(c));
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i], toks = c.split(" ");
    let bate = PALAVRAS[tipo].some(p => c.includes(p));
    if (tipo === "num" && (toks.includes("N") || toks.includes("NO") || toks.includes("NU"))) bate = bate || toks.length <= 2 && !c.includes("BAIRRO") && !c.includes("LOGR") && !c.includes("NOME");
    if (!bate) continue;
    if (tipo === "num" && /CEP|TEL|NOTIF|CPF|CNS|SUS|BAIRRO|FONE|CEL|PRONT|SINAN|IDADE/.test(c)) continue;
    if (tipo === "rua" && /NUM|COMPL|BAIRRO|CEP/.test(c) && !c.includes("LOGR")) continue;
    if (tipo === "rua" && c.includes("COMPL")) continue;
    return i;
  }
  return -1;
}
async function abrirArquivo(f) {
  try {
    P.arquivo = f; P.leitor = await lerPlanilha(f); P.aba = 0;
    await carregarAba();
  } catch (e) { alert("Não consegui ler o arquivo: " + e.message); }
}
async function carregarAba() {
  const todas = await P.leitor.lerAba(P.aba);
  P.cab = (todas[0] || []).map((c, i) => String(c || `Coluna ${i + 1}`).trim());
  P.linhas = todas.slice(1).filter(l => l.some(v => String(v).trim() !== ""));
  $("#etapaArquivo").classList.add("oculto");
  $("#etapaResultado").classList.add("oculto");
  $("#etapaColunas").classList.remove("oculto");
  $("#tituloArquivo").innerHTML = `${esc(P.arquivo.name)} <span class="nota mono">${fmt(P.linhas.length)} linhas</span>`;
  $("#linhaAba").innerHTML = P.leitor.abas.length > 1 ? `<div class="campo" style="max-width:260px"><label>Aba</label><select id="selAba">${P.leitor.abas.map((a, i) => `<option value="${i}" ${i === P.aba ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>` : "";
  if ($("#selAba")) $("#selAba").onchange = e => { P.aba = +e.target.value; carregarAba(); };
  const opts = (sel) => `<option value="-1">— nenhuma —</option>` + P.cab.map((c, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  $("#colRua").innerHTML = opts(detectar(P.cab, "rua"));
  $("#colNum").innerHTML = opts(detectar(P.cab, "num"));
  $("#colComp").innerHTML = opts(detectar(P.cab, "comp"));
  $("#colBairro").innerHTML = opts(detectar(P.cab, "bairro"));
  $("#colCep").innerHTML = opts(detectar(P.cab, "cep"));
  const prev = P.linhas.slice(0, 6);
  $("#previa").innerHTML = `<tr>${P.cab.map(c => `<th>${esc(c)}</th>`).join("")}</tr>` + prev.map(l => `<tr>${P.cab.map((_, i) => `<td>${esc(l[i])}</td>`).join("")}</tr>`).join("");
}
$("#btnTrocar").onclick = () => { $("#etapaColunas").classList.add("oculto"); $("#etapaArquivo").classList.remove("oculto"); };
$("#btnNovo").onclick = () => {
  if (P.rows.some(r => r.manual) && !confirm("Descartar a planilha atual? As correções já foram gravadas na base; só a lista some da tela.")) return;
  P.rows = []; $("#etapaResultado").classList.add("oculto"); $("#etapaArquivo").classList.remove("oculto"); atualizarContRev();
};
$("#btnProcessar").onclick = async () => {
  const c = { rua: +$("#colRua").value, num: +$("#colNum").value, comp: +$("#colComp").value, bairro: +$("#colBairro").value, cep: +$("#colCep").value };
  if (c.rua < 0) { alert("Escolha a coluna da rua."); return; }
  P.cols = c;
  const g = (l, i) => i >= 0 ? l[i] : "";
  $("#progWrap").classList.remove("oculto"); $("#btnProcessar").disabled = true;
  P.rows = [];
  const t0 = performance.now();
  for (let i = 0; i < P.linhas.length; i++) {
    const l = P.linhas[i];
    const ent = { rua: g(l, c.rua), numero: g(l, c.num), complemento: g(l, c.comp), bairro: g(l, c.bairro), cep: g(l, c.cep) };
    P.rows.push({ i, orig: l, ent, res: MOTOR.processar(ent), manual: null });
    if (i % 200 === 199) { $("#prog").style.width = (100 * i / P.linhas.length) + "%"; await sleep(0); }
  }
  console.log("processado em", Math.round(performance.now() - t0), "ms");
  $("#progWrap").classList.add("oculto"); $("#btnProcessar").disabled = false; $("#prog").style.width = "0";
  $("#etapaColunas").classList.add("oculto"); $("#etapaResultado").classList.remove("oculto");
  P.filtroConf = null; renderResultado();
};
window.addEventListener("beforeunload", e => { if (P.rows.length) { e.preventDefault(); e.returnValue = ""; } });

function renderResultado() {
  if (!P.rows.length) return;
  const cont = { ALTA: 0, "MÉDIA": 0, BAIXA: 0, "NÃO ENCONTRADO": 0, CORRIGIDO: 0 };
  for (const r of P.rows) cont[final(r).conf]++;
  const tot = P.rows.length;
  const chip = (k, rot, cls) => `<button class="chip" data-c="${k}" aria-pressed="${P.filtroConf === k}"><span class="v c-${cls}">${fmt(cont[k])}</span><span class="r">${rot} · <span class="mono">${(100 * cont[k] / tot).toFixed(0)}%</span></span></button>`;
  $("#chips").innerHTML = chip("ALTA", "Alta", "ALTA") + chip("MÉDIA", "Média", "MEDIA") + chip("BAIXA", "Baixa", "BAIXA") + chip("NÃO ENCONTRADO", "Não encontrado", "NAO") + (cont.CORRIGIDO ? `<button class="chip" data-c="CORRIGIDO" aria-pressed="${P.filtroConf === "CORRIGIDO"}"><span class="v" style="color:var(--realce)">${fmt(cont.CORRIGIDO)}</span><span class="r">Corrigido</span></button>` : "");
  $$("#chips .chip").forEach(b => b.onclick = () => { P.filtroConf = P.filtroConf === b.dataset.c ? null : b.dataset.c; renderResultado(); });
  const ft = MotorQuarteirao.textoBasico($("#filtroTexto").value);
  let lista = P.rows.filter(r => (!P.filtroConf || final(r).conf === P.filtroConf) && (!ft || MotorQuarteirao.textoBasico(r.ent.rua + " " + r.res.ruaEncontrada + " " + final(r).q).includes(ft)));
  $("#contFiltro").textContent = lista.length !== tot ? `${fmt(lista.length)} de ${fmt(tot)} linhas` : `${fmt(tot)} linhas`;
  const lim = lista.slice(0, 1500);
  $("#tabRes").innerHTML = `<tr><th>#</th><th>Rua (planilha)</th><th>Nº</th><th>Quarteirão</th><th>Zona</th><th>Confiança</th><th>Rua encontrada</th><th>Método / observação</th></tr>` +
    lim.map(r => {
      const f = final(r); const cls = f.conf === "CORRIGIDO" ? "cond" : confCls(f.conf);
      return `<tr class="click" data-i="${r.i}"><td class="mono">${r.i + 2}</td><td>${esc(r.ent.rua)}</td><td class="mono">${esc(r.ent.numero)}</td><td class="mono"><b>${esc(f.q || "—")}</b></td><td class="mono" style="white-space:nowrap">${esc(MOTOR.zona(f.q))}</td><td><span class="tag ${cls}">${esc(f.conf)}</span>${r.res.condominio ? ' <span class="tag cond">COND</span>' : ""}</td><td>${esc(r.res.ruaEncontrada)}</td><td class="obs">${esc(f.met)}${r.res.obs && !r.manual ? " · " + esc(r.res.obs) : ""}</td></tr>`;
    }).join("") + (lista.length > lim.length ? `<tr><td colspan="8" class="nota">Mostrando ${fmt(lim.length)} de ${fmt(lista.length)}. Use o filtro ou baixe a planilha.</td></tr>` : "");
  $$("#tabRes tr.click").forEach(tr => tr.onclick = () => abrirRevisao(+tr.dataset.i));
  atualizarContRev();
}
$("#filtroTexto").addEventListener("input", () => renderResultado());
$("#btnRevisar").onclick = () => irAba("revisar");

$("#btnExportar").onclick = async () => {
  const extra = ["QUARTEIRAO", "ZONA", "CONFIANCA", "METODO", "RUA_ENCONTRADA", "NUMERO_USADO", "CONDOMINIO", "LATITUDE", "LONGITUDE", "OBS"];
  const cab = P.cab.concat(extra);
  const est = { ALTA: 2, "MÉDIA": 3, BAIXA: 4, "NÃO ENCONTRADO": 5, CORRIGIDO: 6 };
  const linhas = P.rows.map(r => {
    const f = final(r);
    return P.cab.map((_, i) => r.orig[i] == null ? "" : r.orig[i]).concat([
      f.q || "", MOTOR.zona(f.q), f.conf, f.met, r.manual ? r.manual.nome : r.res.ruaEncontrada,
      r.manual ? String(r.manual.numero || "") : (r.res.numero != null ? r.res.numero + (r.res.sufixo || "") : ""),
      r.res.condominioNome || "", r.res.lat ? +r.res.lat.toFixed(6) : "", r.res.lon ? +r.res.lon.toFixed(6) : "", r.manual ? "" : r.res.obs]);
  });
  const iConf = P.cab.length + 2;
  const xml1 = folhaXml(cab, linhas, j => (i => i === iConf ? (est[linhas[j][iConf]] || 0) : 0), cab.map((c, i) => i >= P.cab.length ? [12, 8, 16, 30, 34, 10, 30, 12, 12, 60][i - P.cab.length] : Math.min(40, Math.max(10, String(c).length + 4))));
  const cont = {}; for (const r of P.rows) { const c = final(r).conf; cont[c] = (cont[c] || 0) + 1; }
  const res = Object.entries(cont).map(([k, v]) => [k, v, Math.round(1000 * v / P.rows.length) / 10]);
  const xml2 = folhaXml(["CONFIANCA", "QTD", "%"], res, null, [20, 10, 8]);
  const blob = await gerarXlsx([{ nome: "Enderecos", xml: xml1 }, { nome: "Resumo", xml: xml2 }]);
  baixar(blob, P.arquivo.name.replace(/\.(xlsx|csv|txt)$/i, "") + "_com_quarteirao.xlsx");
};

// ------------------------------------------------------------------ MAPA (Leaflet)
const PALETA = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22"];
const corQ = q => { let h = 0; for (const ch of String(q)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETA[h % PALETA.length]; };
function criarMapa(div, aoClicar) {
  const map = L.map(div, { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([-22.76, -47.15], 14);
  const renderer = L.canvas({ padding: 0.3, tolerance: 4 });
  const fundo = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap" });
  let usarFundo = true;
  try { usarFundo = localStorage.getItem("qe-fundo") !== "0"; } catch (e) {}
  if (usarFundo) fundo.addTo(map);
  const polyPorQ = new Map(); const todos = [];
  const estiloBase = { color: "#6b7785", weight: 1, fillColor: "#6b7785", fillOpacity: 0.06, renderer };
  for (const [cod, zona, rings] of DADOS.quarteiroes) {
    for (const r of rings) {
      const latlngs = r.map(ring => ring.map(([lon, lat]) => [lat, lon]));
      const p = L.polygon(latlngs, Object.assign({}, estiloBase)).addTo(map);
      p._q = cod; p._zona = zona;
      p.bindTooltip(() => `<b class="mono">${esc(cod)}</b> · ${esc(zona)}`, { sticky: true, direction: "top", opacity: 0.95 });
      p.on("click", () => aoClicar && aoClicar(cod));
      if (!polyPorQ.has(cod)) polyPorQ.set(cod, []);
      polyPorQ.get(cod).push(p); todos.push(p);
    }
  }
  const camadaPontos = L.layerGroup().addTo(map);
  const camadaRotulos = L.layerGroup().addTo(map);
  let destaque = [];
  function rotular() {
    camadaRotulos.clearLayers();
    if (map.getZoom() < 17) return;
    const b = map.getBounds(); let n = 0;
    for (const p of todos) {
      if (p._q.includes("X")) continue;
      const c = p.getBounds().getCenter();
      if (!b.contains(c)) continue;
      L.marker(c, { interactive: false, icon: L.divIcon({ className: "rotulo-q", html: esc(p._q), iconSize: null }) }).addTo(camadaRotulos);
      if (++n > 400) break;
    }
  }
  map.on("zoomend moveend", rotular);
  return {
    map,
    fundo(on) { if (on) fundo.addTo(map); else map.removeLayer(fundo); try { localStorage.setItem("qe-fundo", on ? "1" : "0"); } catch (e) {} },
    usandoFundo: () => map.hasLayer(fundo),
    destacar(principal, alternativas, enquadrar) {
      for (const p of destaque) p.setStyle(estiloBase);
      destaque = [];
      const b = L.latLngBounds([]);
      for (const q of (alternativas || [])) for (const p of polyPorQ.get(q) || []) { p.setStyle({ color: "#b3401f", weight: 2.5, dashArray: "5 4", fillOpacity: 0.12, fillColor: "#b3401f" }); destaque.push(p); b.extend(p.getBounds()); }
      for (const p of polyPorQ.get(principal) || []) { p.setStyle({ color: "#1f5fbf", weight: 3.5, dashArray: null, fillOpacity: 0.22, fillColor: "#1f5fbf" }); p.bringToFront(); destaque.push(p); b.extend(p.getBounds()); }
      return b;
    },
    pontos(regs, numeroAlvo, extra) {
      camadaPontos.clearLayers();
      const b = L.latLngBounds([]);
      for (const r of regs) {
        if (r.lat == null) continue;
        const ll = [r.lat, r.lon];
        L.circleMarker(ll, { radius: 4, color: corQ(r.q), weight: 1, fillColor: corQ(r.q), fillOpacity: 0.85, renderer })
          .bindTooltip(`nº <b class="mono">${r.n || "s/n"}</b> → <span class="mono">${esc(r.q)}</span>`, { direction: "top" }).addTo(camadaPontos);
        b.extend(ll);
      }
      if (extra) {
        L.circleMarker(extra, { radius: 8, color: "#111", weight: 2, fillColor: "#ffd400", fillOpacity: 1, renderer }).bindTooltip("posição estimada", { permanent: false }).addTo(camadaPontos);
        b.extend(extra);
      }
      return b;
    },
    enquadrar(b, zoomMax) { if (b && b.isValid()) map.fitBounds(b.pad(0.25), { maxZoom: zoomMax || 18 }); },
    irPara(q) { const ps = polyPorQ.get(normQ(q)) || polyPorQ.get(q); if (!ps) return false; const b = L.latLngBounds([]); ps.forEach(p => b.extend(p.getBounds())); map.fitBounds(b.pad(1.2), { maxZoom: 18 }); return true; },
  };
}

// ------------------------------------------------------------------ REVISAR
let mapaRev = null;
function garantirMapaRev() {
  if (mapaRev) return;
  mapaRev = criarMapa("mapaRev", q => { $("#revQ").value = q; validarQ(); });
  $("#chkFundo").checked = mapaRev.usandoFundo();
  $("#chkFundo").onchange = e => mapaRev.fundo(e.target.checked);
}
function filtroRev(r) {
  const f = REV.filtro;
  if (f === "todos") return true;
  if (f === "pend") return pendente(r);
  if (f === "BAIXA") return !r.manual && r.res.confianca === "BAIXA";
  if (f === "NAO") return !r.manual && r.res.confianca === "NÃO ENCONTRADO";
  if (f === "cond") return !!r.res.condominio || /sugere condomínio/.test(r.res.obs);
  return true;
}
function montarFila(manterAtual) {
  const atual = REV.fila[REV.pos];
  REV.fila = P.rows.filter(filtroRev).map(r => r.i);
  if (manterAtual && atual != null) { const p = REV.fila.indexOf(atual); REV.pos = p >= 0 ? p : Math.min(REV.pos, REV.fila.length - 1); }
  else REV.pos = Math.min(REV.pos, Math.max(0, REV.fila.length - 1));
}
function atualizarContRev() { const n = P.rows.filter(pendente).length; $("#nRevisar").textContent = P.rows.length ? fmt(n) : ""; }
function abrirRevisao(i) {
  REV.filtro = "todos"; $("#revFiltro").value = "todos";
  montarFila(false); REV.pos = Math.max(0, REV.fila.indexOf(i));
  irAba("revisar");
}
$("#revFiltro").onchange = e => { REV.filtro = e.target.value; REV.pos = 0; montarFila(false); renderRevisao(); };
$("#revAnt").onclick = () => { if (REV.pos > 0) { REV.pos--; renderRevisao(); } };
$("#revProx").onclick = () => { if (REV.pos < REV.fila.length - 1) { REV.pos++; renderRevisao(); } };
$("#revPular").onclick = () => $("#revProx").click();
document.addEventListener("keydown", e => {
  if (abaAtual !== "revisar") return;
  if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); $("#revSalvar").click(); }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); $("#revProx").click(); }
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); $("#revAnt").click(); }
});

let ESC = null; // rua escolhida {chave, nome}
let avisoQ = null;
function renderRevisao() {
  const tem = P.rows.length && REV.fila.length;
  $("#revVazio").classList.toggle("oculto", !!tem);
  $("#revCorpo").classList.toggle("oculto", !tem);
  if (!tem) { if (P.rows.length) $("#revVazio").innerHTML = `<h2>Nada pendente neste filtro</h2><p class="nota">Troque o filtro para ver outras linhas.</p><select onchange="document.getElementById('revFiltro').value=this.value;document.getElementById('revFiltro').dispatchEvent(new Event('change'))"><option>—</option><option value="todos">Todas as linhas</option><option value="cond">Só condomínios</option></select>`; return; }
  garantirMapaRev();
  const r = P.rows[REV.fila[REV.pos]]; const res = r.res; const f = final(r);
  $("#revPos").textContent = `${REV.pos + 1} / ${REV.fila.length}`;
  $("#revTag").innerHTML = `<span class="tag ${f.conf === "CORRIGIDO" ? "cond" : confCls(f.conf)}">${esc(f.conf)}</span>`;
  const nomeCol = i => i >= 0 ? esc(P.cab[i]) : "";
  $("#revOrig").innerHTML = [
    ["Linha", `<span class="mono">${r.i + 2}</span>`],
    [nomeCol(P.cols.rua) || "Rua", esc(r.ent.rua)],
    [nomeCol(P.cols.num) || "Número", `<span class="mono">${esc(r.ent.numero)}</span>`],
    P.cols.comp >= 0 ? [nomeCol(P.cols.comp), esc(r.ent.complemento)] : null,
    P.cols.bairro >= 0 ? [nomeCol(P.cols.bairro), esc(r.ent.bairro)] : null,
    P.cols.cep >= 0 ? [nomeCol(P.cols.cep), `<span class="mono">${esc(r.ent.cep)}</span>`] : null,
    ["Sugestão", `<b class="mono">${esc(f.q || "—")}</b> ${f.q ? `<span class="nota">${esc(MOTOR.zona(f.q))}</span>` : ""}`],
    ["Rua encontrada", esc(res.ruaEncontrada || "—") + (res.similaridade != null && res.similaridade < 100 ? ` <span class="nota mono">${res.similaridade}%</span>` : "")],
    ["Método", esc(f.met)],
  ].filter(Boolean).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  $("#revObs").textContent = r.manual ? "" : res.obs;

  // condomínio
  const cond = res.condominio ? MOTOR.condominios().find(c => c.id === res.condominio) : null;
  const box = $("#revCondBox");
  if (cond) {
    const nome = cond.nome || `Condomínio ${cond.rua}, ${cond.numero}`;
    const mi = Object.entries(cond.mapa_interno || {});
    box.innerHTML = `<div class="card" style="background:var(--realce-bg);border-color:transparent;padding:10px 12px">
      <b>${esc(nome)}</b> <span class="nota">${cond.unidades ? fmt(cond.unidades) + " unidades · " : ""}${esc(cond.tipo || "")}</span><br>
      <span class="nota">${cond.situacao === "interno" ? "Ocupa vários quarteirões: o endereço da portaria não basta." : "Fica num só quarteirão: a portaria resolve."}</span>
      <div class="alts">${(cond.quarteiroes || []).map(q => `<button class="btn peq mono" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      ${mi.length ? `<div class="nota" style="margin-top:6px">Endereços internos já aprendidos: ${mi.slice(0, 12).map(([k, v]) => `<span class="mono">${esc(k)}→${esc(v)}</span>`).join(", ")}${mi.length > 12 ? "…" : ""}</div>` : ""}
      <div style="margin-top:6px"><button class="btn peq" id="revEditCond">Editar condomínio</button></div></div>`;
    box.classList.remove("oculto");
    box.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { $("#revQ").value = b.dataset.q; validarQ(); mapaRev.irPara(b.dataset.q); });
    $("#revEditCond").onclick = () => { irAba("condominios"); abrirCondEditor(cond.id); };
  } else { box.classList.add("oculto"); box.innerHTML = ""; }
  const interno = cond && cond.situacao === "interno";
  $("#revIntWrap").style.display = interno ? "" : "none";
  $("#revInt").value = interno ? (res.complemento || "") : "";
  $("#revCondNovo").style.display = cond ? "none" : "";

  // formulário
  ESC = r.manual ? { chave: r.manual.chave, nome: r.manual.nome } : (res.chaveRua ? { chave: res.chaveRua, nome: res.ruaEncontrada } : null);
  $("#revRua").value = ESC ? ESC.nome : (res.ruaLimpa || "");
  $("#revRuaNova").checked = !!(r.manual && r.manual.nova);
  $("#revNum").value = r.manual ? (r.manual.numero || "") : (res.numero != null ? res.numero : "");
  $("#revQ").value = f.q || "";
  avisoQ = null; msg("#revMsg", "", "");
  renderSugestoes(ESC ? "" : $("#revRua").value, r);
  $("#revAlts").innerHTML = (res.alternativas || []).filter(q => !(cond && (cond.quarteiroes || []).includes(q))).map(q => `<button class="btn peq mono" data-q="${esc(q)}">${esc(q)}</button>`).join("");
  $$("#revAlts [data-q]").forEach(b => b.onclick = () => { $("#revQ").value = b.dataset.q; validarQ(); mapaRev.irPara(b.dataset.q); });
  atualizarMapaRev(r);
}
function atualizarMapaRev(r) {
  const res = r.res; const f = final(r);
  const chave = ESC ? ESC.chave : res.chaveRua;
  const regs = chave ? MOTOR.numerosDaRua(chave) : [];
  const apr = chave ? [...MOTOR.aprendidosDaRua(chave)].map(([n, q]) => ({ n, q, lat: null })) : [];
  const ext = res.lat ? [res.lat, res.lon] : null;
  const b1 = mapaRev.pontos(regs.concat(apr), res.numero, ext);
  const cond = res.condominio ? MOTOR.condominios().find(c => c.id === res.condominio) : null;
  const alts = (res.alternativas || []).concat(cond ? cond.quarteiroes || [] : []).filter(q => q !== f.q);
  const b2 = mapaRev.destacar(f.q, alts);
  if (ext) { mapaRev.map.setView(ext, 18); }
  else if (b2.isValid()) mapaRev.enquadrar(b2, 18);
  else if (b1.isValid()) mapaRev.enquadrar(b1, 17);
  else {
    // rua desconhecida: aproxima pela região do CEP informado (ruas vizinhas com o mesmo CEP)
    const cep = String(r.ent.cep || "").trim().replace(/\.0+$/, "").replace(/\D/g, "").slice(0, 8);
    const pc = MOTOR.pontosDoCep(cep);
    if (pc.length) { const b3 = mapaRev.pontos(pc, null, null); mapaRev.enquadrar(b3, 17); $("#legendaMapa").textContent = `Rua fora do CNEFE: mostrando endereços do CEP ${cep} para localizar a região.`; return; }
  }
  $("#legendaMapa").textContent = "Pontos: números da rua no CNEFE (cor = quarteirão; passe o mouse para ver o número). Contorno azul: sugestão. Tracejado: alternativas.";
}
function renderSugestoes(texto, r) {
  const cep = r ? MotorQuarteirao.textoBasico(r.ent.cep).replace(/\D/g, "").slice(0, 8) : "";
  const lista = texto ? MOTOR.sugerirRuas(texto, cep) : [];
  $("#revSug").innerHTML = lista.map(s => `<button data-k="${esc(s.chave)}" class="${ESC && ESC.chave === s.chave ? "sel" : ""}"><span>${esc(s.nome)}</span><span class="s">${s.sim}%</span></button>`).join("");
  $("#revSug").style.display = lista.length ? "" : "none";
  $$("#revSug button").forEach(b => b.onclick = () => {
    ESC = { chave: b.dataset.k, nome: MOTOR.nomeRua(b.dataset.k) };
    $("#revRua").value = ESC.nome; $("#revRuaNova").checked = false; $("#revSug").style.display = "none";
    atualizarMapaRev(P.rows[REV.fila[REV.pos]]);
  });
}
let tSug = null;
$("#revRua").addEventListener("input", () => { ESC = null; clearTimeout(tSug); tSug = setTimeout(() => renderSugestoes($("#revRua").value, P.rows[REV.fila[REV.pos]]), 150); });
$("#revRuaNova").onchange = e => { if (e.target.checked) { ESC = null; $("#revSug").style.display = "none"; } };
$("#revBuscaQ").addEventListener("keydown", e => { if (e.key === "Enter") { if (!mapaRev.irPara(e.target.value)) { e.target.style.borderColor = "var(--baixa)"; setTimeout(() => e.target.style.borderColor = "", 1200); } } });
function validarQ() {
  const q = normQ($("#revQ").value);
  if (q && !MOTOR.existeQuarteirao(q)) msg("#revMsg", "aviso", `O quarteirão <b class="mono">${esc(q)}</b> não existe na malha. Clique em salvar de novo para gravar mesmo assim.`);
  else msg("#revMsg", "", "");
  if (q && mapaRev) { const r = P.rows[REV.fila[REV.pos]]; mapaRev.destacar(q, (r.res.alternativas || []).filter(x => x !== q)); }
}
$("#revQ").addEventListener("change", validarQ);

function salvarRevisao(confirmar) {
  const r = P.rows[REV.fila[REV.pos]]; const res = r.res;
  const q = normQ(confirmar ? res.quarteirao : $("#revQ").value);
  if (!q) { msg("#revMsg", "erro", "Informe o quarteirão (digite ou clique no mapa)."); return; }
  if (!MOTOR.existeQuarteirao(q) && avisoQ !== q) { avisoQ = q; msg("#revMsg", "aviso", `O quarteirão <b class="mono">${esc(q)}</b> não existe na malha. Clique em salvar de novo para gravar mesmo assim.`); return; }
  const numero = parseInt(confirmar ? res.numero : $("#revNum").value, 10) || null;
  let rua;
  if (confirmar) rua = res.chaveRua ? { chave: res.chaveRua, nome: res.ruaEncontrada } : null;
  else if ($("#revRuaNova").checked) { const t = $("#revRua").value.trim(); rua = t ? { chave: MOTOR.chaveRua(t).chave, nome: MotorQuarteirao.textoBasico(t), nova: true } : null; }
  else rua = ESC;
  if (!rua || !rua.chave) { msg("#revMsg", "erro", "Escolha a rua na lista de sugestões ou marque “rua nova”."); return; }

  const cond = res.condominio ? MOTOR.condominios().find(c => c.id === res.condominio) : null;
  let aviso = "";
  if (cond && cond.situacao === "interno") {
    const ki = MOTOR.chaveInterna($("#revInt").value);
    if (ki) {
      const novo = Object.assign({}, cond, { mapa_interno: Object.assign({}, cond.mapa_interno || {}, { [ki]: q }) });
      delete novo._chave;
      Sync.registrar("condominios", novo);
    } else aviso = "Sem endereço interno a correção vale só para esta linha (não foi aprendida).";
  } else if (numero) {
    Sync.registrar("correcoes", { chave: rua.chave, numero, rua: rua.nome, quarteirao: q, fonte: "manual" });
  } else aviso = "Sem número a correção vale só para esta linha (não foi aprendida).";
  if (res.chaveDigitada && res.chaveDigitada !== rua.chave && res.chaveDigitada.length >= 4)
    Sync.registrar("aliases", { de: res.chaveDigitada, para: rua.chave, nome: rua.nome });
  r.manual = { q, chave: rua.chave, nome: rua.nome, numero, nova: !!rua.nova };
  aplicarAprendizado(true);
  if (aviso) { msg("#revMsg", "aviso", aviso); setTimeout(() => avancar(), 1400); }
  else avancar();
}
function avancar() {
  montarFila(true);
  if (REV.filtro === "pend") { /* a linha salva sai da fila; pos já aponta para a próxima */ }
  else if (REV.pos < REV.fila.length - 1) REV.pos++;
  renderRevisao();
}
$("#revSalvar").onclick = () => salvarRevisao(false);
$("#revOk").onclick = () => { if (!P.rows[REV.fila[REV.pos]].res.quarteirao) { msg("#revMsg", "erro", "Não há sugestão para confirmar."); return; } salvarRevisao(true); };
$("#revCondNovo").onclick = () => {
  const r = P.rows[REV.fila[REV.pos]];
  const rua = ESC || (r.res.chaveRua ? { chave: r.res.chaveRua, nome: r.res.ruaEncontrada } : null);
  const numero = parseInt($("#revNum").value, 10);
  if (!rua || !numero) { msg("#revMsg", "erro", "Para cadastrar o condomínio escolha a rua e informe o número da portaria."); return; }
  const q = normQ($("#revQ").value);
  const id = "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  Sync.registrar("condominios", { id, nome: "", rua: rua.nome, numero, bairro: r.ent.bairro || "", unidades: null, tipo: "horizontal", quarteiroes: q ? [q] : [], situacao: "interno", complementos: [], origem: "cadastro manual", mapa_interno: {} });
  aplicarAprendizado(true);
  msg("#revMsg", "ok", "Condomínio cadastrado. Ajuste os quarteirões dele na aba Condomínios.");
  renderRevisao();
};

// ------------------------------------------------------------------ CONDOMÍNIOS
let mapaCond = null, condSel = null, condEdit = null;
function garantirMapaCond() {
  if (mapaCond) return;
  mapaCond = criarMapa("mapaCond", q => {
    if (!condEdit) return;
    const l = condEdit.quarteiroes || (condEdit.quarteiroes = []);
    const i = l.indexOf(q); if (i >= 0) l.splice(i, 1); else l.push(q);
    $("#ceQ").value = l.join(", "); mapaCond.destacar(null, l);
  });
}
function renderCondList() {
  const ft = MotorQuarteirao.textoBasico($("#condFiltro").value); const sit = $("#condSit").value;
  const l = MOTOR.condominios().filter(c => (!sit || c.situacao === sit) && (!ft || MotorQuarteirao.textoBasico(`${c.nome} ${c.rua} ${c.numero} ${c.bairro}`).includes(ft)))
    .sort((a, b) => (a.situacao === b.situacao ? 0 : a.situacao === "interno" ? -1 : 1) || (b.unidades || 0) - (a.unidades || 0));
  $("#tabCond").innerHTML = `<tr><th>Condomínio / portaria</th><th>Bairro</th><th>Unid.</th><th>Quarteirões</th><th>Situação</th></tr>` + l.map(c =>
    `<tr class="click" data-id="${esc(c.id)}"><td>${c.nome ? `<b>${esc(c.nome)}</b><br>` : ""}${esc(c.rua)}, <span class="mono">${c.numero}</span></td><td>${esc(c.bairro)}</td><td class="mono">${c.unidades ? fmt(c.unidades) : "—"}</td><td class="mono">${esc((c.quarteiroes || []).join(", "))}</td><td>${c.situacao === "interno" ? '<span class="tag BAIXA">precisa endereço interno</span>' : '<span class="tag ALTA">portaria resolve</span>'}${Object.keys(c.mapa_interno || {}).length ? ` <span class="nota mono">${Object.keys(c.mapa_interno).length} int.</span>` : ""}</td></tr>`).join("");
  $$("#tabCond tr.click").forEach(tr => tr.onclick = () => abrirCondEditor(tr.dataset.id));
}
$("#condFiltro").addEventListener("input", renderCondList);
$("#condSit").addEventListener("change", renderCondList);
$("#condNovo").onclick = () => abrirCondEditor(null);
function abrirCondEditor(id) {
  garantirMapaCond();
  const c = id ? MOTOR.condominios().find(x => x.id === id) : null;
  condEdit = c ? JSON.parse(JSON.stringify(c)) : { id: "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nome: "", rua: "", numero: "", bairro: "", unidades: null, tipo: "horizontal", quarteiroes: [], situacao: "interno", complementos: [], origem: "cadastro manual", mapa_interno: {} };
  delete condEdit._chave;
  const mi = Object.entries(condEdit.mapa_interno || {});
  $("#condEditor").innerHTML = `<h2>${c ? "Editar condomínio" : "Novo condomínio"}</h2>
    <div class="linha"><div class="campo"><label>Nome</label><input type="text" id="ceNome" value="${esc(condEdit.nome)}" placeholder="ex.: Residencial Jardim das Flores"></div></div>
    <div class="linha" style="margin-top:8px"><div class="campo" style="flex:3"><label>Rua da portaria</label><input type="text" id="ceRua" value="${esc(condEdit.rua)}"><div class="sug" id="ceSug" style="display:none"></div></div>
    <div class="campo" style="max-width:110px"><label>Número</label><input type="number" id="ceNum" value="${esc(condEdit.numero)}"></div></div>
    <div class="linha" style="margin-top:8px"><div class="campo"><label>Bairro</label><input type="text" id="ceBairro" value="${esc(condEdit.bairro)}"></div>
    <div class="campo"><label>Tipo</label><select id="ceTipo"><option value="horizontal">horizontal (casas)</option><option value="vertical">vertical (prédios)</option></select></div>
    <div class="campo"><label>Situação</label><select id="ceSit"><option value="interno">precisa endereço interno</option><option value="portaria">portaria resolve</option></select></div></div>
    <div class="campo" style="margin-top:8px"><label>Quarteirões que ocupa (clique no mapa para marcar/desmarcar)</label><input type="text" id="ceQ" class="mono" value="${esc((condEdit.quarteiroes || []).join(", "))}"></div>
    <h3>Endereços internos → quarteirão</h3>
    <p class="nota">Ex.: <span class="mono">QUADRA E</span> → <span class="mono">2141</span>. Um endereço cujo complemento contém todas as palavras da chave recebe esse quarteirão.</p>
    <div class="lista-int" id="ceInt">${mi.map(([k, v]) => `<div><span class="mono" style="min-width:160px">${esc(k)}</span>→<span class="mono">${esc(v)}</span><button class="btn peq" data-del="${esc(k)}">remover</button></div>`).join("") || '<span class="nota">nenhum ainda</span>'}</div>
    <div class="linha" style="margin-top:6px"><input type="text" id="ceIntK" placeholder="QUADRA E" style="max-width:180px"><input type="text" id="ceIntQ" class="mono" placeholder="2141" style="max-width:100px"><button class="btn peq" id="ceIntAdd">Adicionar</button></div>
    <div id="ceMsg" style="margin-top:8px"></div>
    <div class="linha" style="margin-top:10px"><button class="btn pri" id="ceSalvar">Salvar</button>${c ? '<button class="btn" id="ceRemover">Remover da lista</button>' : ""}<span class="nota">${esc(condEdit.origem || "")}${condEdit.usuario ? " · " + esc(condEdit.usuario) + " " + esc(condEdit.mes || "") : ""}</span></div>`;
  $("#ceTipo").value = condEdit.tipo || "horizontal"; $("#ceSit").value = condEdit.situacao || "interno";
  $$("#ceInt [data-del]").forEach(b => b.onclick = () => { delete condEdit.mapa_interno[b.dataset.del]; b.parentElement.remove(); condEdit._apagar = (condEdit._apagar || []).concat(b.dataset.del); });
  $("#ceIntAdd").onclick = () => {
    const k = MOTOR.chaveInterna($("#ceIntK").value), q = normQ($("#ceIntQ").value);
    if (!k || !q) return;
    condEdit.mapa_interno = condEdit.mapa_interno || {}; condEdit.mapa_interno[k] = q;
    const d = document.createElement("div"); d.innerHTML = `<span class="mono" style="min-width:160px">${esc(k)}</span>→<span class="mono">${esc(q)}</span>`;
    const cont = $("#ceInt"); if (cont.querySelector(".nota")) cont.innerHTML = ""; cont.appendChild(d);
    $("#ceIntK").value = ""; $("#ceIntQ").value = "";
  };
  let tS = null;
  $("#ceRua").addEventListener("input", () => { clearTimeout(tS); tS = setTimeout(() => {
    const l = MOTOR.sugerirRuas($("#ceRua").value, "");
    const s = $("#ceSug"); s.innerHTML = l.map(x => `<button data-k="${esc(x.chave)}"><span>${esc(x.nome)}</span><span class="s">${x.sim}%</span></button>`).join(""); s.style.display = l.length ? "" : "none";
    s.querySelectorAll("button").forEach(b => b.onclick = () => { $("#ceRua").value = MOTOR.nomeRua(b.dataset.k); s.style.display = "none"; });
  }, 150); });
  $("#ceQ").addEventListener("change", () => { condEdit.quarteiroes = $("#ceQ").value.split(/[,;\s]+/).map(normQ).filter(Boolean); mapaCond.destacar(null, condEdit.quarteiroes); });
  $("#ceSalvar").onclick = () => {
    const numero = parseInt($("#ceNum").value, 10);
    const rua = $("#ceRua").value.trim();
    if (!rua || !numero) { msg("#ceMsg", "erro", "Informe rua e número da portaria."); return; }
    const novo = Object.assign({}, condEdit, {
      nome: $("#ceNome").value.trim(), rua: rua.toUpperCase(), numero, bairro: $("#ceBairro").value.trim(),
      tipo: $("#ceTipo").value, situacao: $("#ceSit").value,
      quarteiroes: $("#ceQ").value.split(/[,;\s]+/).map(normQ).filter(Boolean),
    });
    delete novo._apagar;
    Sync.registrar("condominios", novo);
    aplicarAprendizado(true);
    msg("#ceMsg", "ok", "Salvo. Vale para todos os usuários.");
    condSel = novo.id;
  };
  if ($("#ceRemover")) $("#ceRemover").onclick = () => {
    if (!confirm("Remover este condomínio da lista? (endereços dele deixam de ser sinalizados)")) return;
    Sync.registrar("condominios", Object.assign({}, condEdit, { removido: true }));
    aplicarAprendizado(true); $("#condEditor").innerHTML = '<p class="ok-msg">Removido.</p>'; condEdit = null;
  };
  // mapa
  const b = mapaCond.destacar(null, condEdit.quarteiroes || []);
  const pts = c && c.lat ? [{ lat: c.lat, lon: c.lon, q: (c.quarteiroes || [""])[0], n: c.numero }] : [];
  const b2 = mapaCond.pontos(pts, null, null);
  if (b.isValid()) mapaCond.enquadrar(b, 18); else if (b2.isValid()) mapaCond.enquadrar(b2, 17);
}

// ------------------------------------------------------------------ BASE E ACESSO
function renderAcesso() {
  const logado = !!Sync.sessao;
  $("#loginBox").classList.toggle("oculto", logado);
  $("#logadoBox").classList.toggle("oculto", !logado);
  if (logado) {
    $("#lgQuem").textContent = Sync.sessao.email;
    $("#lgPapel").textContent = Sync.perfil ? (Sync.perfil.admin ? "administrador" : "usuário") : "aguardando liberação";
    if (Sync.estado === "naoliberado") msg("#lgMsg", "aviso", "Seu e-mail ainda não está na lista de usuários liberados. Peça ao administrador para liberar. Enquanto isso, suas correções ficam guardadas neste navegador.");
  }
  const admin = !!(logado && Sync.perfil && Sync.perfil.admin);
  $("#adminBox").classList.toggle("oculto", !admin);
  $("#impAdmin").classList.toggle("oculto", !admin);
  $("#impBloqueado").classList.toggle("oculto", admin);
  $("#lblImpApr").classList.toggle("oculto", !admin);
  if (admin) carregarUsuarios();
}
async function carregarUsuarios() {
  try {
    const r = await Sync.req("/rest/v1/autorizados?select=*&order=email");
    const l = r.ok ? await r.json() : [];
    $("#tabUsu").innerHTML = `<tr><th>E-mail</th><th>Nome</th><th>Divisão</th><th>Papel</th><th></th></tr>` + l.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.nome)}</td><td>${esc(u.divisao)}</td><td>${u.admin ? "admin" : "usuário"}</td><td>${u.email.toLowerCase() !== Sync.sessao.email.toLowerCase() ? `<button class="btn peq" data-rm="${esc(u.email)}">remover</button>` : ""}</td></tr>`).join("");
    $$("#tabUsu [data-rm]").forEach(b => b.onclick = async () => {
      if (!confirm("Remover o acesso de " + b.dataset.rm + "?")) return;
      await Sync.req("/rest/v1/autorizados?email=eq." + encodeURIComponent(b.dataset.rm), { method: "DELETE" });
      carregarUsuarios();
    });
  } catch (e) { console.warn(e); }
}
$("#adAdd").onclick = async () => {
  const email = $("#adEmail").value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) { msg("#lgMsg", "erro", "E-mail inválido."); return; }
  const r = await Sync.req("/rest/v1/autorizados?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ email, nome: $("#adNome").value.trim() || null, divisao: $("#adDiv").value.trim() || null, admin: $("#adAdmin").checked }]) });
  if (r.ok) { msg("#lgMsg", "ok", `${esc(email)} liberado. A pessoa cria a conta em “Criar conta” com esse e-mail.`); $("#adEmail").value = $("#adNome").value = $("#adDiv").value = ""; $("#adAdmin").checked = false; carregarUsuarios(); }
  else msg("#lgMsg", "erro", "Não foi possível liberar: " + esc((await r.text()).slice(0, 200)));
};
$("#btnEntrar").onclick = async () => {
  const e = $("#lgEmail").value.trim(), s = $("#lgSenha").value;
  if (!e || !s) { msg("#lgMsg", "erro", "Informe e-mail e senha."); return; }
  msg("#lgMsg", "aviso", "Entrando…");
  try { await Sync.entrar(e, s); msg("#lgMsg", Sync.perfil ? "ok" : "aviso", Sync.perfil ? "Conectado. Base sincronizada." : "Conectado, mas o e-mail ainda não foi liberado pelo administrador."); $("#lgSenha").value = ""; }
  catch (err) { msg("#lgMsg", "erro", /invalid login/i.test(err.message) ? "E-mail ou senha incorretos." : /not confirmed/i.test(err.message) ? "Confirme o e-mail pelo link que chegou na sua caixa de entrada." : esc(err.message)); }
  renderAcesso();
};
$("#btnCriar").onclick = async () => {
  const e = $("#lgEmail").value.trim(), s = $("#lgSenha").value;
  if (!e || s.length < 8) { msg("#lgMsg", "erro", "Informe o e-mail e uma senha de pelo menos 8 caracteres."); return; }
  try {
    const r = await Sync.criarConta(e, s);
    msg("#lgMsg", "ok", r === "logado" ? "Conta criada e conectada." : "Conta criada. Abra o e-mail de confirmação que chegou e clique no link; depois volte aqui e clique em Entrar. O administrador também precisa liberar o seu e-mail.");
  } catch (err) { msg("#lgMsg", "erro", esc(err.message)); }
  renderAcesso();
};
$("#btnSair").onclick = () => Sync.sair();
$("#btnSync").onclick = async () => { msg("#lgMsg", "aviso", "Sincronizando…"); await Sync.sincronizar(); msg("#lgMsg", Sync.estado === "ok" ? "ok" : "aviso", Sync.estado === "ok" ? "Base em dia." : esc(Sync._erro || Sync.estado)); };

function renderBase() {
  const corr = Object.values(Sync.apr.correcoes).filter(c => c.quarteirao).length;
  const e = MOTOR.estat();
  $("#baseEstat").innerHTML = [
    ["Ruas (CNEFE)", fmt(DADOS.ruas.length)],
    ["Ruas novas", fmt(e.ruasNovas)],
    ["Correções", fmt(corr)],
    ["Apelidos de rua", fmt(Object.keys(Sync.apr.aliases).length)],
    ["Condomínios", fmt(e.condominios)],
    ["Na fila p/ enviar", fmt(Sync.fila.length)],
    ["Quarteirões", fmt(new Set(DADOS.quarteiroes.map(q => q[0])).size)],
  ].map(([a, b]) => `<dt>${a}</dt><dd class="mono">${b}</dd>`).join("");
  $("#rodape").textContent = `${DADOS.fonte} · versão ${DADOS.versao}`;
  $("#cfgUrl").value = Sync.cfg.url; $("#cfgKey").value = Sync.cfg.key;
}
$("#cfgSalvar").onclick = () => { Sync.cfg = { url: $("#cfgUrl").value.trim(), key: $("#cfgKey").value.trim() }; localStorage.setItem("qe-cfg", JSON.stringify(Sync.cfg)); msg("#lgMsg", "ok", "Configuração salva."); };
$("#cfgPadrao").onclick = () => { Sync.cfg = Object.assign({}, CFG_PADRAO); localStorage.removeItem("qe-cfg"); renderBase(); };

$("#btnExpApr").onclick = () => baixar(new Blob([JSON.stringify({ tipo: "aprendizado-quarteirao", exportado: new Date().toISOString().slice(0, 7), correcoes: Object.values(Sync.apr.correcoes), aliases: Object.values(Sync.apr.aliases), condominios: Object.values(Sync.apr.condominios) })], { type: "application/json" }), "aprendizado_quarteiroes.json");
$("#arqApr").onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
  if (!(Sync.perfil && Sync.perfil.admin)) { alert("Importação restrita ao administrador."); ev.target.value = ""; return; }
  try {
    const j = JSON.parse(await f.text()); let n = 0;
    for (const c of j.correcoes || []) if (c.chave && c.numero) { Sync.registrar("correcoes", { chave: c.chave, numero: c.numero, rua: c.rua, quarteirao: c.quarteirao, fonte: c.fonte || "manual" }, true); n++; }
    for (const a of j.aliases || []) if (a.de && a.para) { Sync.registrar("aliases", { de: a.de, para: a.para, nome: a.nome }, true); n++; }
    for (const c of j.condominios || []) if (c.id) { const o = Object.assign({}, c); delete o.pendente; delete o.usuario; delete o.mes; delete o.versao; Sync.registrar("condominios", o, true); n++; }
    await Sync.salvarLocal(); Sync.enviar(); aplicarAprendizado(true);
    $("#baseImpMsg").textContent = `${fmt(n)} itens importados.`;
  } catch (e) { alert("Arquivo inválido: " + e.message); }
};
// ---- importar fonte de endereços (histórico de casos, base da divisão, cadastros…)
const MOTOR_CNEFE = MotorQuarteirao.criarMotor(DADOS);   // só CNEFE, sem aprendizado: serve de referência
const IMP = { leitor: null, cab: [], linhas: [], analise: null };
$("#arqFonte").onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  if (!(Sync.perfil && Sync.perfil.admin)) { alert("Importação restrita ao administrador."); ev.target.value = ""; return; }
  try {
    IMP.leitor = await lerPlanilha(f); IMP.nomeArq = f.name;
    $("#impAbaLinha").innerHTML = IMP.leitor.abas.length > 1 ? `<div class="campo" style="max-width:260px"><label>Aba</label><select id="impAba">${IMP.leitor.abas.map((a, i) => `<option value="${i}">${esc(a)}</option>`).join("")}</select></div>` : "";
    if ($("#impAba")) $("#impAba").onchange = () => impCarregarAba(+$("#impAba").value);
    await impCarregarAba(0);
    $("#impCorpo").classList.remove("oculto");
  } catch (e) { alert("Não consegui ler: " + e.message); }
};
async function impCarregarAba(i) {
  const todas = await IMP.leitor.lerAba(i);
  IMP.cab = (todas[0] || []).map((c, j) => String(c || `Coluna ${j + 1}`).trim());
  IMP.linhas = todas.slice(1).filter(l => l.some(v => String(v).trim() !== ""));
  const opts = sel => `<option value="-1">—</option>` + IMP.cab.map((c, j) => `<option value="${j}" ${j === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  const iq = IMP.cab.findIndex(c => /QUART|QUADRA|^QT|_QT/.test(MotorQuarteirao.textoBasico(c).replace(/ /g, "_")));
  $("#impRua").innerHTML = opts(detectar(IMP.cab, "rua"));
  $("#impNum").innerHTML = opts(detectar(IMP.cab, "num"));
  $("#impQ").innerHTML = opts(iq);
  $("#impProg").textContent = `${fmt(IMP.linhas.length)} linhas`;
  $("#impRel").innerHTML = "";
}
$("#impAnalisar").onclick = async () => {
  const cR = +$("#impRua").value, cN = +$("#impNum").value, cQ = +$("#impQ").value;
  if (cR < 0 || cN < 0 || cQ < 0) { alert("Escolha as colunas de rua, número e quarteirão."); return; }
  const cacheRua = new Map(); const grupos = new Map();
  const ign = { semDado: 0, foraMalha: 0 }; const foraMalha = new Map();
  let i = 0;
  for (const l of IMP.linhas) {
    if (++i % 500 === 0) { $("#impProg").textContent = `lendo ${fmt(i)}…`; await sleep(0); }
    const sep = MotorQuarteirao.separarRuaNumero(l[cR], l[cN]);
    const q = normQ(l[cQ]);
    if (!sep.rua || !sep.n || !q) { ign.semDado++; continue; }
    if (!MOTOR.existeQuarteirao(q)) { ign.foraMalha++; foraMalha.set(q, (foraMalha.get(q) || 0) + 1); continue; }
    const ch = MOTOR.chaveRua(sep.rua).chave;
    if (!ch) { ign.semDado++; continue; }
    if (!cacheRua.has(ch)) {
      let r;
      if (MOTOR_CNEFE.nomeRua(ch)) r = { chave: ch, nome: MOTOR_CNEFE.nomeRua(ch), cnefe: true };
      else if (MOTOR.nomeRua(ch)) r = { chave: ch, nome: MOTOR.nomeRua(ch), cnefe: false };
      else {
        const s = MOTOR.sugerirRuas(sep.rua, "")[0];
        if (s && s.sim >= 90) r = { chave: s.chave, nome: s.nome, cnefe: !!MOTOR_CNEFE.nomeRua(s.chave), apelido: ch };
        else if (s && s.sim >= 78) r = { chave: ch, nome: MotorQuarteirao.textoBasico(sep.rua), duvida: s.nome, simDuvida: s.sim };   // pode ser erro de digitação
        else r = { chave: ch, nome: MotorQuarteirao.textoBasico(sep.rua), cnefe: false, nova: true };
      }
      cacheRua.set(ch, r);
    }
    const r = cacheRua.get(ch); const k = r.chave + "|" + sep.n;
    if (!grupos.has(k)) grupos.set(k, { chave: r.chave, nome: r.nome, n: sep.n, cont: new Map(), nova: !!r.nova, duvida: r.duvida || "" });
    const g = grupos.get(k); g.cont.set(q, (g.cont.get(q) || 0) + 1);
  }
  // consenso por endereço + comparação com o que o CNEFE sozinho diria
  const cat = { acrescenta: [], concorda: [], diverge: [], conflito: [], manual: [], duvida: [] };
  i = 0;
  for (const g of grupos.values()) {
    if (++i % 300 === 0) { $("#impProg").textContent = `comparando ${fmt(i)} de ${fmt(grupos.size)}…`; await sleep(0); }
    const tot = [...g.cont.values()].reduce((a, b) => a + b, 0);
    const [q, nq] = [...g.cont.entries()].sort((a, b) => b[1] - a[1])[0];
    g.q = q; g.tot = tot; g.share = nq / tot;
    g.outros = [...g.cont.entries()].filter(([x]) => x !== q).map(([x, c]) => `${x}(${c})`).join(" ");
    const atual = Sync.apr.correcoes[g.chave + "|" + g.n];
    if (atual && (atual.fonte || "manual") === "manual") { cat.manual.push(g); continue; }
    if (g.share < 0.7) { cat.conflito.push(g); continue; }
    if (g.duvida) { cat.duvida.push(g); continue; }
    const p = g.nova ? null : MOTOR_CNEFE.processar({ rua: g.nome, numero: g.n });
    g.cnefe = p ? p.quarteirao : ""; g.cnefeConf = p ? p.confianca : "NÃO ENCONTRADO";
    if (p && p.confianca === "ALTA") (p.quarteirao === q ? cat.concorda : cat.diverge).push(g);
    else cat.acrescenta.push(g);
  }
  IMP.analise = { cat, grupos, ign, foraMalha, ruasNovas: [...cacheRua.values()].filter(r => r.nova).length, ruasDuvida: [...cacheRua.values()].filter(r => r.duvida).length, apelidos: [...cacheRua.values()].filter(r => r.apelido) };
  $("#impProg").textContent = "";
  const comp = cat.concorda.length + cat.diverge.length;
  const pct = comp ? Math.round(100 * cat.concorda.length / comp) : null;
  const fm = [...foraMalha.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([q, c]) => `${q}(${c})`).join(", ");
  $("#impRel").innerHTML = `
    <dl class="ficha">
      <dt>Linhas lidas</dt><dd class="mono">${fmt(IMP.linhas.length)}</dd>
      <dt>Endereços únicos</dt><dd class="mono">${fmt(grupos.size)} <span class="nota">(${fmt(IMP.analise.ruasNovas)} ruas fora do CNEFE · ${fmt(IMP.analise.ruasDuvida)} nomes parecidos com ruas do CNEFE, mas não iguais)</span></dd>
      <dt>Ignoradas</dt><dd>${fmt(ign.semDado)} sem rua/número/quarteirão · ${fmt(ign.foraMalha)} com quarteirão que não existe na malha${fm ? ` <span class="nota">(${esc(fm)}${foraMalha.size > 8 ? "…" : ""})</span>` : ""}</dd>
      <dt>Qualidade</dt><dd>${pct === null ? "—" : `<b class="mono">${pct}%</b> de acordo com o CNEFE nos ${fmt(comp)} endereços em que os dois têm resposta segura`}</dd>
    </dl>
    <h3>O que importar</h3>
    <label class="opc"><input type="checkbox" id="impA" checked> <span><b class="mono">${fmt(cat.acrescenta.length)}</b> que <b>acrescentam</b>: rua fora do CNEFE ou endereço em que o CNEFE não tem certeza</span></label>
    <label class="opc"><input type="checkbox" id="impD"> <span><b class="mono">${fmt(cat.diverge.length)}</b> que <b>divergem</b> de uma resposta ALTA do CNEFE (recomendo revisar antes; baixe a lista)</span></label>
    <label class="opc"><input type="checkbox" id="impC"> <span><b class="mono">${fmt(cat.concorda.length)}</b> que só <b>repetem</b> o CNEFE (não melhoram nada; por minimização, ficam de fora)</span></label>
    <label class="opc"><input type="checkbox" id="impU"> <span><b class="mono">${fmt(cat.duvida.length)}</b> em ruas com <b>nome duvidoso</b> (parecido com uma rua do CNEFE, mas não o bastante: pode ser erro de digitação ou rua nova; veja na lista)</span></label>
    <p class="nota"><b class="mono">${fmt(cat.conflito.length)}</b> endereços com quarteirões diferentes entre os registros (menos de 70% iguais) não entram. <b class="mono">${fmt(cat.manual.length)}</b> já têm correção manual, que sempre prevalece.</p>
    <div class="linha"><button class="btn pri" id="impFazer">Importar selecionados</button><button class="btn" id="impBaixar">Baixar lista para revisar (.xlsx)</button></div>
    <div id="impMsg" style="margin-top:8px"></div>`;
  $("#impBaixar").onclick = async () => {
    const cab = ["RUA", "NUMERO", "QUARTEIRAO_FONTE", "VEZES", "OUTROS_NA_FONTE", "QUARTEIRAO_CNEFE", "SITUACAO"];
    const rows = cat.diverge.map(g => [g.nome, g.n, g.q, g.tot, g.outros, g.cnefe, "diverge do CNEFE"])
      .concat(cat.conflito.map(g => [g.nome, g.n, g.q, g.tot, g.outros, "", "conflito na fonte"]))
      .concat(cat.duvida.map(g => [g.nome, g.n, g.q, g.tot, g.outros, "", `nome duvidoso — parecido com ${g.duvida}`]));
    baixar(await gerarXlsx([{ nome: "Revisar", xml: folhaXml(cab, rows, null, [40, 9, 16, 8, 26, 16, 18]) }]), "fonte_para_revisar.xlsx");
  };
  $("#impFazer").onclick = async () => {
    const fonte = ($("#impNome").value.trim() || "importação").slice(0, 40);
    const sel = [].concat($("#impA").checked ? cat.acrescenta : [], $("#impD").checked ? cat.diverge : [], $("#impC").checked ? cat.concorda : [], $("#impU").checked ? cat.duvida : []);
    if (!sel.length) { msg("#impMsg", "aviso", "Nada selecionado."); return; }
    let n = 0;
    for (const g of sel) {
      Sync.registrar("correcoes", { chave: g.chave, numero: g.n, rua: g.nome, quarteirao: g.q, fonte }, true);
      if (++n % 500 === 0) { msg("#impMsg", "aviso", `${fmt(n)} de ${fmt(sel.length)}…`); await sleep(0); }
    }
    for (const a of IMP.analise.apelidos) if (a.apelido.length >= 4 && !Sync.apr.aliases[a.apelido]) Sync.registrar("aliases", { de: a.apelido, para: a.chave, nome: a.nome }, true);
    await Sync.salvarLocal(); aplicarAprendizado(true); Sync.enviar();
    msg("#impMsg", "ok", `${fmt(n)} endereços importados como “${esc(fonte)}”.${Sync.sessao ? " Enviando para a base compartilhada." : " Entre com seu login para enviar à base compartilhada."}`);
  };
};

// ------------------------------------------------------------------ início
$("#nCond").textContent = MOTOR.condominios().length;
setTimeout(() => {
  if (Sync._voltouDoEmail) { irAba("base"); msg("#lgMsg", "ok", "E-mail confirmado e conectado."); }
  else if (Sync._erroLink) { irAba("base"); msg("#lgMsg", "aviso", "O link do e-mail não funcionou (" + esc(Sync._erroLink) + "). Se você já confirmou antes, é só entrar com e-mail e senha."); }
}, 300);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(e => console.warn("sw", e));
Sync.iniciar();
renderBase();
})();
