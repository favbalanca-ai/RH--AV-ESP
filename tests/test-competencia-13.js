// 13º salário: 1ª e 2ª parcela são competências próprias. A chave de cada
// uma tem que ser DIFERENTE (senão a trava de ordem duplicada bloqueia o
// pagamento da 2ª), ordenar depois de Dezembro, e carregar o ano — para o
// filtro de ano do custo não jogar o 13º fora.
// Roda o Code.gs real:  node tests/test-competencia-13.js
const fs = require('fs'), vm = require('vm')
const path = require('path')
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8')

let falhas = 0
const check = (n, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${n} — ${JSON.stringify(a)}${ok ? '' : ' esperado ' + JSON.stringify(b)}`)
}

function makeSheet(h, r) {
  const g = [h.slice(), ...r.map(x => x.slice())]
  return { _grid: g,
    getDataRange: () => ({ getValues: () => g.map(x => x.slice()) }),
    getLastColumn: () => Math.max(...g.map(x => x.length), 1), getLastRow: () => g.length,
    getRange: (row, col) => ({
      getValues: () => [ (g[row - 1] || []).slice(col - 1) ],
      setValue: v => { while (g.length < row) g.push([]); const l = g[row - 1]
        while (l.length < col) l.push(''); l[col - 1] = v } }),
    appendRow: v => g.push(v.slice()), setFrozenRows: () => {} }
}

const HDR_PAG = ['ID', 'ID_FUNC', 'NOME_FUNC', 'COMPETENCIA', 'VALOR_LIQUIDO', 'DATA_GERACAO',
  'STATUS', 'WA_LINK_EMPREGADOR', 'MSG_EMPREGADOR', 'DATA_CONFIRMACAO', 'CANCELADO',
  'DATA_PAGAMENTO', 'COMPROVANTE_FILEID', 'COMPROVANTE_LINK', 'LINK_HOLERITE',
  'TOKEN_CONFIRMACAO', 'ORIGEM', 'REF_DOC']

function boot(pagamentos) {
  const sheets = {
    PAGAMENTOS: makeSheet(HDR_PAG, pagamentos || []),
    FUNCIONARIOS: makeSheet(['ID', 'STATUS', 'NOME_COMPLETO'], [['7', 'Ativo', 'Fulano Da Silva']]),
    LOG_ACOES: makeSheet(['DATA', 'USUARIO', 'ACAO', 'DETALHE'], []),
  }
  const ctx = { console, Logger: { log: () => {} },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null,
      insertSheet: n => { const s = makeSheet([], []); s._grid.length = 0; return (sheets[n] = s) } }) },
    Utilities: { formatDate: () => '26/11/2026', getUuid: () => 'TOK', base64Encode: x => x },
    HtmlService: { createHtmlOutput: h => ({ getAs: () => ({ setName: () => ({ getBytes: () => h }) }) }) },
    DriveApp: { Access: {}, Permission: {} }, CalendarApp: {}, UrlFetchApp: {},
    DocumentApp: {}, Drive: {}, ContentService: {},
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) } }
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx)
  return { ctx, sheets }
}

const { ctx } = boot()

// ── 1. Chaves distintas, ano certo, ordenação depois de Dezembro ───
const p1 = ctx.ordemCompetencia('13º Salário 1ª Parcela/2026')
const p2 = ctx.ordemCompetencia('13º Salário 2ª Parcela/2026')
const dez = ctx.ordemCompetencia('Dezembro/2026')
check('1ª parcela tem chave própria', p1.chave, 202613)
check('2ª parcela tem OUTRA chave', p2.chave, 202614)
check('com o ano certo (o filtro do custo depende disso)', [p1.ano, p2.ano], ['2026', '2026'])
check('as duas ordenam depois de Dezembro', p1.chave > dez.chave && p2.chave > p1.chave, true)
check('meses normais continuam iguais', ctx.ordemCompetencia('Julho/2026').chave, 202607)
check('variação de escrita cai na mesma chave',
  ctx.ordemCompetencia('13º Salario - 2ª Parcela / 2026').chave, 202614)

// ── 2. A trava de duplicada separa as parcelas ─────────────────────
{
  // Ordem ATIVA da 1ª parcela já existe; a 2ª NÃO pode ser barrada.
  const { ctx: c2 } = boot([
    ['1', '7', 'Fulano Da Silva', '13º Salário 1ª Parcela/2026', 1000, '20/11/2026',
     'PENDENTE', '', '', '', '', '', '', '', '', 'TOKA', 'Folha', 'DOC1'],
  ])
  check('mesma parcela é pega como duplicada',
    c2.jaExisteOrdemPagamento('7', '13º Salário 1ª Parcela/2026', 'Folha', ''), true)
  check('a 2ª parcela NÃO é barrada pela 1ª',
    c2.jaExisteOrdemPagamento('7', '13º Salário 2ª Parcela/2026', 'Folha', ''), false)
  check('e Dezembro também não',
    c2.jaExisteOrdemPagamento('7', 'Dezembro/2026', 'Folha', ''), false)
}

// ── 3. Nome do documento no ZapSign sai limpo e por parcela ────────
check('nome da 1ª parcela', ctx.nomeDocumentoAssinatura('Folha', '13º Salário 1ª Parcela/2026', 'Fulano Da Silva'),
  'Folha_13Salario-1Parcela-2026_FULANO DA SILVA')
check('nome da 2ª parcela', ctx.nomeDocumentoAssinatura('Folha', '13º Salário 2ª Parcela/2026', 'Fulano Da Silva'),
  'Folha_13Salario-2Parcela-2026_FULANO DA SILVA')
check('mês normal não mudou', ctx.nomeDocumentoAssinatura('Folha', 'Julho/2026', 'Fulano Da Silva'),
  'Folha_Julho-2026_FULANO DA SILVA')

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo verde')
process.exit(falhas ? 1 : 0)
