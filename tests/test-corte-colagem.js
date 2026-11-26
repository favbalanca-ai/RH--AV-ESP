// O fluxo de atualização que o usuário pediu: manter o topo com os SEUS
// valores e colar só do ✂️ CORTE para baixo. Este teste simula exatamente
// isso — recorta o código novo no marcador, cola sobre um topo "antigo"
// com valores preenchidos, e o resultado tem que funcionar inteiro.
// Rodar da raiz: node tests/test-corte-colagem.js
const fs = require('fs'), vm = require('vm'), path = require('path')
const { execSync } = require('child_process')
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8')

let falhas = 0
const check = (n, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${n} — ${JSON.stringify(a)}${ok ? '' : ' esperado ' + JSON.stringify(b)}`)
}

const MARCA = '// ═══════════════ ✂️ CORTE AQUI'

// ── 1. O arquivo tem o corte, e os valores do usuário ficam ACIMA dele ──
const iCorte = SRC.indexOf(MARCA)
check('a linha de corte existe', iCorte > 0, true)
const topo = SRC.slice(0, iCorte)
const resto = SRC.slice(iCorte)
check('SHEET_ID fica acima do corte', topo.includes('COLE_O_ID_DA_PLANILHA_AQUI'), true)
check('pasta do Drive acima do corte', topo.includes('COLE_O_ID_DA_PASTA_DRIVE_AQUI'), true)
check('senha acima do corte', topo.includes('TROCAR_SENHA'), true)
check('nada do usuário abaixo do corte',
  /COLE_O_ID|TROCAR_SENHA/.test(resto), false)
check('as ABAS (do sistema) ficam ABAIXO do corte', resto.includes("FOLHA:          'FOLHA_PAGAMENTO'"), true)
const linhas = SRC.split('\n')
check('placeholders nas linhas de sempre (22/23/31)',
  [/SHEET_ID/.test(linhas[21]), /DRIVE_ROOT/.test(linhas[22]), /TROCAR_SENHA/.test(linhas[30])],
  [true, true, true])

// ── 2. Topo "antigo" preenchido + código novo colado do corte: funciona ──
const topoDoUsuario = topo
  .replace('COLE_O_ID_DA_PLANILHA_AQUI', 'ID_REAL_DA_PLANILHA')
  .replace('COLE_O_ID_DA_PASTA_DRIVE_AQUI', 'ID_REAL_DA_PASTA')
  .replace('TROCAR_SENHA', 'senha-do-usuario')
const colado = topoDoUsuario + resto

const ctx = { console, Logger: { log: () => {} },
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
  Utilities: { formatDate: () => 'x', getUuid: () => 'T', base64Encode: x => x },
  HtmlService: { createHtmlOutput: h => ({ getAs: () => ({ setName: () => ({ getBytes: () => h }) }) }) },
  DriveApp: { Access: {}, Permission: {} }, CalendarApp: {}, UrlFetchApp: {},
  DocumentApp: {}, Drive: {}, ContentService: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) } }
ctx.globalThis = ctx; vm.createContext(ctx)
vm.runInContext(colado, ctx)

check('o arquivo colado carrega sem erro', typeof ctx.doPost, 'function')
// `const CONFIG` não vira propriedade do contexto do vm — lê por expressão.
const CFG = vm.runInContext('CONFIG', ctx)
check('os valores do usuário sobreviveram', CFG.SHEET_ID, 'ID_REAL_DA_PLANILHA')
check('a senha também', CFG.ADM_USERS['admin'], 'senha-do-usuario')
check('as ABAS vieram do código NOVO (abaixo do corte)', CFG.ABAS.FOLHA, 'FOLHA_PAGAMENTO')
check('todas as 8 abas presentes', Object.keys(CFG.ABAS).length, 8)
check('login funciona com a senha do usuário', ctx.verificarLogin('admin', 'senha-do-usuario'), 'admin')
check('abasDoSistema enxerga as abas', ctx.abasDoSistema().indexOf('FOLHA_PAGAMENTO') >= 0, true)

// ── 3. A página de copiar recorta no mesmo marcador ────────────────
const tmp = path.join(require('os').tmpdir(), 'pagina-corte-teste.html')
execSync('node ' + path.join(__dirname, 'gerar-pagina-code.js') + ' ' + tmp)
const pagina = fs.readFileSync(tmp, 'utf8')
check('a página tem o botão do corte', pagina.includes('btn-corte'), true)
check('e procura o mesmo marcador do arquivo', pagina.includes("CODIGO.indexOf('// ═══════════════ ✂️ CORTE AQUI')"), true)
fs.unlinkSync(tmp)

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo verde')
process.exit(falhas ? 1 : 0)
