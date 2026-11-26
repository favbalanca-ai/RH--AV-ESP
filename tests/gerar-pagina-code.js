// Gera code-gs.html: a página-artifact com o Code.gs inteiro e um botão
// Copiar fiel byte a byte. O código vai embutido UMA vez, como JSON, e o
// <pre> é preenchido dele via textContent — impossível divergir do que o
// botão copia. Vive em tests/ para sobreviver às reciclagens do ambiente.
// Rodar da raiz do repositório: node tests/gerar-pagina-code.js <saida.html>
const fs = require('fs')
const path = require('path')
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8')

const versao = (SRC.match(/var VERSAO_BACKEND = '(\d+)'/) || [])[1] || '?'
const linhas = SRC.split('\n').length
const kb = Math.round(Buffer.byteLength(SRC, 'utf8') / 1024)

// O JSON embutido vive dentro de <script>: '</script>' no meio do código
// quebraria a página — escapa a barra.
const json = JSON.stringify(SRC).replace(/<\//g, '<\\/')

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code.gs SST</title>
<style>
:root {
  --fundo: #F4F6F4; --cartao: #FFFFFF; --texto: #1F2937; --suave: #6B7280;
  --verde: #1A5C2A; --verde-claro: #EAF3DE; --borda: rgba(0,0,0,0.1);
  --pre-fundo: #FAFAF8;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --fundo: #121212; --cartao: #1E1E1E; --texto: #F1F1F1; --suave: #A0A0A0;
    --verde: #2E7D32; --verde-claro: #1B2E1B; --borda: rgba(255,255,255,0.12);
    --pre-fundo: #161616;
  }
}
:root[data-theme="dark"] {
  --fundo: #121212; --cartao: #1E1E1E; --texto: #F1F1F1; --suave: #A0A0A0;
  --verde: #2E7D32; --verde-claro: #1B2E1B; --borda: rgba(255,255,255,0.12);
  --pre-fundo: #161616;
}
* { box-sizing: border-box }
body {
  margin: 0; background: var(--fundo); color: var(--texto);
  font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  padding: 16px;
}
.topo {
  max-width: 900px; margin: 0 auto 12px; background: var(--cartao);
  border: 1px solid var(--borda); border-radius: 12px; padding: 14px 16px;
}
.topo h1 { margin: 0 0 2px; font-size: 17px; color: var(--verde) }
.topo p { margin: 0; font-size: 12.5px; color: var(--suave); line-height: 1.5 }
.topo strong { color: var(--texto) }
.aviso {
  max-width: 900px; margin: 0 auto 12px; font-size: 12px; line-height: 1.55;
  background: var(--verde-claro); border: 1px solid var(--borda);
  border-radius: 12px; padding: 10px 14px;
}
button {
  background: var(--verde); color: #fff; border: none; border-radius: 10px;
  padding: 12px 18px; font-size: 14px; font-weight: 700; cursor: pointer;
  width: 100%; margin: 4px auto 12px; max-width: 900px; display: block;
}
pre {
  max-width: 900px; margin: 0 auto; background: var(--pre-fundo);
  border: 1px solid var(--borda); border-radius: 12px; padding: 14px;
  font-size: 11px; line-height: 1.45; overflow-x: auto; white-space: pre;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
</style>
</head>
<body>
<div class="topo">
  <h1>Code.gs — Sistema SST Fazenda Água Viva</h1>
  <p>Versão <strong>${versao}</strong> · ${linhas.toLocaleString('pt-BR')} linhas · ${kb} KB</p>
</div>
<div class="aviso">
  Depois de colar no Apps Script, recoloque os seus valores:
  <strong>linha 22</strong> (SHEET_ID da planilha), <strong>linha 23</strong>
  (ID da pasta do Drive) e <strong>linha 31</strong> (senha do admin).
  Aí publique: <strong>Implantar → Gerenciar implantações → ✏️ → Versão:
  Nova versão → Implantar</strong>.
</div>
<button id="btn-copiar">📋 Copiar o Code.gs inteiro</button>
<pre id="codigo"></pre>
<script id="fonte" type="application/json">${json}</script>
<script>
const CODIGO = JSON.parse(document.getElementById('fonte').textContent)
document.getElementById('codigo').textContent = CODIGO
document.getElementById('btn-copiar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-copiar')
  try {
    await navigator.clipboard.writeText(CODIGO)
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = CODIGO; document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); ta.remove()
  }
  btn.textContent = 'Copiado ✓'
  setTimeout(() => { btn.textContent = '📋 Copiar o Code.gs inteiro' }, 2500)
})
</script>
</body>
</html>
`
const saida = process.argv[2] || path.join(__dirname, '..', '..', 'code-gs.html')
fs.writeFileSync(saida, html)
console.log('✅ página gerada — versão ' + versao + ', ' + linhas.toLocaleString('pt-BR') +
  ' linhas, ' + kb + ' KB → ' + saida)
