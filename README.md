# Quarteirão por Endereço

Ferramenta da Vigilância em Saúde de Paulínia para ligar endereços (planilhas de casos, visitas, cadastros) ao **quarteirão** da malha municipal.

**Acesse:** https://marckitto.github.io/quarteiroes/

## Como funciona

- A planilha carregada é lida e processada **só no navegador** de quem usa. Nada da planilha é enviado.
- O endereço é comparado com o **CNEFE 2022 (IBGE)** cruzado com a malha de quarteirões da prefeitura:
  número exato → regra da faixa (par com par, ímpar com ímpar) → vizinho mais próximo.
- Nomes de rua digitados com erro são reconhecidos por semelhança.
- Correções feitas na tela **Revisar** viram aprendizado compartilhado (Supabase, com login e lista de usuários liberados).
  Para o servidor vão apenas rua, número e quarteirão, com usuário e mês da correção.
- Condomínios: 108 pré-carregados do CNEFE. Os que ocupam vários quarteirões pedem o endereço interno (quadra/bloco/casa).
- Outras fontes com rua, número e quarteirão (histórico, bases da divisão) podem ser importadas em **Base e acesso**.

## Instalar como aplicativo

No Chrome ou Edge, abra o link e clique no ícone de instalar na barra de endereço
(ou menu → *Instalar Quarteirão por Endereço*). O app abre mesmo sem internet;
as correções ficam na fila e sobem quando a conexão voltar.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | o sistema completo (arquivo único, gerado) |
| `fonte/app.html`, `fonte/app.js` | interface |
| `fonte/engine.js` | motor de casamento endereço → quarteirão |
| `fonte/dados.json` | CNEFE × malha pré-processados (ruas, números, polígonos, condomínios) |
| `fonte/build_data.py` | gera `dados.json` a partir do CSV do CNEFE e do KMZ da malha |
| `fonte/build_html.py` | gera `index.html` |
| `fonte/quarteirao_enderecos.py` | versão em Python (linha de comando) |
| `supabase/schema.sql` | tabelas e regras de acesso do banco |
| `vendor/leaflet/` | biblioteca de mapas Leaflet 1.9.4 (BSD-2) |

## Atualizar

```
cd fonte
python build_data.py      # só se mudar o CNEFE ou a malha
python build_html.py      # gera ../index.html
```

Fontes de dados: CNEFE 2022 — IBGE; malha de quarteirões com zoneamento — Prefeitura Municipal de Paulínia.
