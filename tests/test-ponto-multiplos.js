// O caso real do usuário: recibo com vários funcionários + cartões de
// ponto em ARQUIVOS SEPARADOS (um por funcionário, como o Secullum
// exporta). Antes o campo aceitava um arquivo só — 6 de 7 folhas ficavam
// sem ponto, em silêncio. Agora: vários PDFs entram, pareiam pelo
// funcionário, e folha sem ponto é acusada no resumo.
const { chromium } = require('/opt/node22/lib/node_modules/playwright')

const FUNCS = [
  { ID: '26', NOME_COMPLETO: 'Laurentino Boa Ventura Da Silva Filho', FUNCAO: 'Tratorista', UNIDADE: 'Sede', TELEFONE: '5511999990000', STATUS: 'Ativo' },
  { ID: '27', NOME_COMPLETO: 'Divo Lopes Barbosa', FUNCAO: 'Tratorista', UNIDADE: 'Sede', TELEFONE: '5511999990001', STATUS: 'Ativo' },
  { ID: '42', NOME_COMPLETO: 'Felipe Soares Limeira', FUNCAO: 'Polivalente', UNIDADE: 'Sede', TELEFONE: '5511999990002', STATUS: 'Ativo' },
]

let falhas = 0
const check = (n, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${n} — ${JSON.stringify(a)}${ok ? '' : ' esperado ' + JSON.stringify(b)}`)
}

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.addInitScript(() => sessionStorage.setItem('sst_user', JSON.stringify({ usuario: 'admin', senha: '1234' })))
  await p.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => typeof processarFracionamento === 'function')
  await p.addScriptTag({ path: __dirname + '/pdf-lib.min.js' })
  await p.waitForFunction(() => !!window.PDFLib)

  const r = await p.evaluate(async (funcs) => {
    const PDFLib = await carregarPdfLib()
    async function fazPdf(rotulos, tam) {
      const doc = await PDFLib.PDFDocument.create()
      rotulos.forEach(t => { const pg = doc.addPage(tam); pg.drawText(t, { x: 40, y: tam[1] - 80, size: 18 }) })
      return new File([await doc.save()], rotulos[0].replace(/\s+/g, '_') + '.pdf', { type: 'application/pdf' })
    }
    const RETRATO = [595, 842], PAISAGEM = [842, 595]
    // Recibo: 3 funcionários num PDF só. Ponto: DOIS arquivos separados
    // (Divo e Felipe) — o Laurentino ficou sem ponto de propósito.
    const folha = await fazPdf(['FOLHA Laurentino', 'FOLHA Divo', 'FOLHA Felipe'], RETRATO)
    const ponto1 = await fazPdf(['PONTO Divo'], PAISAGEM)
    const ponto2 = await fazPdf(['PONTO Felipe'], PAISAGEM)

    funcionarios.length = 0; funcs.forEach(f => funcionarios.push(f))

    const ordem = ['FOLHA Laurentino', 'FOLHA Divo', 'FOLHA Felipe', 'PONTO Divo', 'PONTO Felipe']
    const porTexto = { 'FOLHA Laurentino': '26', 'FOLHA Divo': '27', 'FOLHA Felipe': '42',
                       'PONTO Divo': '27', 'PONTO Felipe': '42' }
    let n = 0
    window.chamarGAS = async (req) => {
      if (req.acao !== 'identificar_com_ia') return { ok: true, data: [] }
      const txt = ordem[n++]
      return { ok: true, data: { func_id: porTexto[txt],
        tipo_documento: txt.startsWith('PONTO') ? 'Ponto' : 'Folha',
        competencia: 'Outubro/2026', valor_liquido: txt.startsWith('FOLHA') ? 2000 : null } }
    }
    chamarGAS = window.chamarGAS

    const põe = (id, files) => {
      const dt = new DataTransfer(); files.forEach(f => dt.items.add(f))
      document.getElementById(id).files = dt.files
    }
    põe('input-pdf-frac', [folha])
    põe('input-pdf-ponto', [ponto1, ponto2])   // DOIS arquivos
    const sel = document.getElementById('sel-comp-frac')
    sel.innerHTML = '<option value="Outubro/2026">Outubro/2026</option>'
    sel.value = 'Outubro/2026'

    await processarFracionamento()
    await new Promise(ok => setTimeout(ok, 1800))

    async function numPaginas(b64) {
      const bin = atob(b64), buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      return (await PDFLib.PDFDocument.load(buf.buffer)).getPageCount()
    }
    const cards = []
    for (const pg of paginasFracionadas) {
      cards.push({ nome: pg.nome.split(' ')[0], temPonto: !!pg.ponto, soPonto: !!pg.soPonto,
                   pags: await numPaginas(pg.pdfEnvio || pg.pdfBase64) })
    }
    return { cards, pontosNaFila: paginasPonto.length,
             resumo: document.getElementById('frac-resumo').textContent }
  }, FUNCS)

  check('as páginas dos DOIS arquivos de ponto entraram', r.pontosNaFila, 2)
  check('3 cards de folha, nenhum ponto órfão', r.cards.length, 3)

  const lau = r.cards.find(c => c.nome === 'Laurentino')
  const divo = r.cards.find(c => c.nome === 'Divo')
  const felipe = r.cards.find(c => c.nome === 'Felipe')
  check('Divo: folha + ponto num documento (2 págs)', [divo.temPonto, divo.pags], [true, 2])
  check('Felipe (do SEGUNDO arquivo): idem', [felipe.temPonto, felipe.pags], [true, 2])
  check('Laurentino sem ponto segue só com a folha', [lau.temPonto, lau.pags], [false, 1])
  check('o resumo acusa a folha sem ponto', r.resumo.includes('1 folha(s) sem cartão de ponto'), true)
  check('e sugere conferir o upload', r.resumo.includes('confira se faltou arquivo'), true)

  if (errs.length) { falhas++; console.log('❌ erros de página: ' + errs.join('; ')) }
  await b.close()
  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo verde')
  process.exit(falhas ? 1 : 0)
})()
