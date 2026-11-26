// O seletor de competência oferece as duas parcelas do 13º, e a leitura
// da IA (que devolve o mês carimbado no holerite) NÃO sobrescreve a
// escolha explícita de 13º.  Requer: npx http-server . -p 8899
const { chromium: chromium2 } = require('/opt/node22/lib/node_modules/playwright')

let falhas = 0
const check = (n, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${n} — ${JSON.stringify(a)}${ok ? '' : ' esperado ' + JSON.stringify(b)}`)
}

;(async () => {
  const b = await chromium2.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport: { width: 900, height: 1100 } })
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.addInitScript(() => sessionStorage.setItem('sst_user', JSON.stringify({ usuario: 'admin', senha: '1234' })))
  await p.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => typeof preencherMesesFracionar === 'function')

  // ── O seletor oferece as duas parcelas ──
  const r1 = await p.evaluate(() => {
    const sel = document.getElementById('sel-comp-frac')
    sel.innerHTML = '<option value="">Selecione a competência...</option>'
    preencherMesesFracionar()
    const textos = [...sel.options].map(o => o.value)
    return {
      p1: textos.some(t => /13º Salário 1ª Parcela\/\d{4}/.test(t)),
      p2: textos.some(t => /13º Salário 2ª Parcela\/\d{4}/.test(t)),
      meses: textos.filter(t => /^[A-Za-zÀ-ú]+\/\d{4}$/.test(t)).length,
    }
  })
  check('1ª parcela no seletor', r1.p1, true)
  check('2ª parcela no seletor', r1.p2, true)
  check('os 12 meses continuam lá', r1.meses >= 12, true)

  // ── A IA não sobrescreve a competência de 13º escolhida à mão ──
  const r2 = await p.evaluate(async () => {
    funcionarios.length = 0
    funcionarios.push({ ID: '7', NOME_COMPLETO: 'Fulano Da Silva', FUNCAO: 'Tratorista',
                        UNIDADE: 'Sede', TELEFONE: '5511999', STATUS: 'Ativo' })
    paginasFracionadas.length = 0
    paginasFracionadas.push(
      { pagina: 1, pdfBase64: 'x', competencia: '13º Salário 1ª Parcela/2026',
        tipoDoc: 'Folha', funcId: '', nome: '', status: 'pronto' },
      { pagina: 2, pdfBase64: 'y', competencia: 'Outubro/2026',
        tipoDoc: 'Folha', funcId: '', nome: '', status: 'pronto' })
    paginasPonto.length = 0
    for (let k = 0; k < 2; k++) {
      for (const [id, tag] of [['fpc-' + k, 'div'], ['fpc-num-' + k, 'div'], ['fpc-func-' + k, 'div'],
                               ['fpc-anexo-' + k, 'div'], ['fpc-valor-' + k, 'div'], ['btn-zap-' + k, 'button']]) {
        if (!document.getElementById(id)) {
          const el = document.createElement(tag); el.id = id; document.body.appendChild(el)
        }
      }
    }
    window.chamarGAS = async (d) => d.acao === 'identificar_com_ia'
      ? { ok: true, data: { func_id: '7', tipo_documento: 'Folha',
          competencia: 'Novembro/2026', valor_liquido: 800 } }
      : { ok: true, data: [] }
    chamarGAS = window.chamarGAS
    await identificarFuncionariosAutomatico()
    return paginasFracionadas.map(pg => pg.competencia)
  })
  check('13º escolhido à mão sobrevive à IA', r2[0], '13º Salário 1ª Parcela/2026')
  check('mês normal continua aceitando a leitura da IA', r2[1], 'Novembro/2026')

  if (errs.length) { falhas++; console.log('❌ erros de página: ' + errs.join('; ')) }
  await b.close()
  console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo verde')
  process.exit(falhas ? 1 : 0)
})()
