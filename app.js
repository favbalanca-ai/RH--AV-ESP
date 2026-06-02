// ═══════════════════════════════════════════════════════════════════
// SST FAZENDA ÁGUA VIVA — app.js
// ═══════════════════════════════════════════════════════════════════

// ── Cole aqui a URL do seu Google Apps Script publicado ──────────
const GAS_URL = https://script.google.com/macros/s/AKfycbxayJeiQeUeHNfl0oz1xcJh6xzymXLREH-wosmRaLHTazaV6fo62y0bMgivnJTyv1oP/exec
const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'

// Carrega pdf-lib dinamicamente
async function carregarPdfLib() {
  if (window.PDFLib) return window.PDFLib
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = PDFLIB_URL
    s.onload = () => resolve(window.PDFLib)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ── Estado global ────────────────────────────────────────────────
let USUARIO   = null
let SENHA_ADM = null
let funcionarios = []
let estoque      = []
let itensEpiSel  = []
let pdfFolhaB64  = ''
let paginaAtual  = 'inicio'
let todosExames  = []

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Sessão salva?
  const sessao = sessionStorage.getItem('sst_user')
  if (sessao) {
    const { usuario, senha } = JSON.parse(sessao)
    USUARIO = usuario; SENHA_ADM = senha
    entrarNoApp()
  }

  // Login
  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault()
    const usuario = document.getElementById('login-user').value.trim()
    const senha   = document.getElementById('login-senha').value
    const btn     = document.getElementById('btn-login')
    btn.disabled  = true; btn.textContent = 'Entrando...'
    document.getElementById('login-erro').style.display = 'none'

    const res = await chamarGAS({ acao: 'listar_funcionarios', usuario, senha })
    btn.disabled = false; btn.textContent = 'Entrar'

    if (res.ok) {
      USUARIO = usuario; SENHA_ADM = senha
      sessionStorage.setItem('sst_user', JSON.stringify({ usuario, senha }))
      funcionarios = res.data
      entrarNoApp()
    } else {
      const el = document.getElementById('login-erro')
      el.textContent = '⚠️ ' + (res.erro || 'Usuário ou senha incorretos')
      el.style.display = 'block'
    }
  })

  // Form funcionário
  document.getElementById('form-funcionario').addEventListener('submit', salvarFuncionario)

  // Form EPI
  document.getElementById('form-epi').addEventListener('submit', enviarEpi)

  // Form Folha
  document.getElementById('form-folha').addEventListener('submit', enviarFolha)

  // Form fracionar
  document.getElementById('form-fracionar').addEventListener('submit', processarFracionamento)
  preencherMesesFracionar()

  // Upload PDF fracionar — preview
  document.getElementById('input-pdf-frac').addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    const preview = document.getElementById('frac-preview')
    preview.style.display = 'block'
    preview.textContent   = '⏳ Lendo PDF...'
    try {
      const PDFLib  = await carregarPdfLib()
      const buffer  = await file.arrayBuffer()
      const pdfDoc  = await PDFLib.PDFDocument.load(buffer)
      const total   = pdfDoc.getPageCount()
      preview.textContent = `📄 PDF carregado: ${total} página(s) — ${total} funcionário(s) serão processados`
    } catch(e) {
      preview.textContent = '❌ Erro ao ler PDF: ' + e.message
    }
  })
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      pdfFolhaB64 = ev.target.result.split(',')[1]
      document.getElementById('pdf-carregado').style.display = 'block'
    }
    reader.readAsDataURL(file)
  })

  // Preencher meses
  preencherMeses()
})

function entrarNoApp() {
  document.getElementById('tela-login').style.display = 'none'
  document.getElementById('tela-app').style.display   = 'flex'
  carregarDashboard()
  irPara('inicio')
}

function logout() {
  sessionStorage.removeItem('sst_user')
  USUARIO = null; SENHA_ADM = null
  document.getElementById('tela-app').style.display   = 'none'
  document.getElementById('tela-login').style.display = 'flex'
  document.getElementById('login-user').value  = ''
  document.getElementById('login-senha').value = ''
}

// ═══════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO MANUAL
// ═══════════════════════════════════════════════════════════════════
async function sincronizarManual() {
  const btn = document.getElementById('btn-sync')
  btn.classList.add('girando')
  btn.disabled = true
  mostrarLoading('Verificando assinaturas pendentes na ZapSign...')

  const res = await chamarGAS({ acao: 'sincronizar' })

  esconderLoading()
  btn.classList.remove('girando')
  btn.disabled = false

  if (res.ok) {
    const d = res.data
    if (d.atualizados > 0) {
      toast(`✅ ${d.atualizados} assinatura(s) atualizada(s)! Verificados: ${d.verificados}`, 'sucesso')
      // Recarregar dados da página atual
      if (paginaAtual === 'epi')   carregarEpi()
      if (paginaAtual === 'folha') carregarFolha()
      carregarDashboard()
    } else if (d.verificados === 0) {
      toast('Nenhum documento pendente encontrado', '')
    } else {
      toast(`🔄 ${d.verificados} verificado(s) — ${d.pendentes} ainda aguardando assinatura`, '')
    }
    if (d.erros?.length) {
      console.warn('Erros na sincronização:', d.erros)
    }
  } else {
    toast('❌ Erro na sincronização: ' + (res.erro || 'Tente novamente'), 'erro')
  }
}

// ═══════════════════════════════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════════════════════════════
const TITULOS = {
  'inicio':     '🏠 Início',
  'lista-func': '👥 Funcionários',
  'novo-func':  '➕ Novo Funcionário',
  'exames':     '🩺 Controle de Exames',
  'epi':        '🦺 EPI',
  'folha':      '💰 Folha de Pagamento',
  'fracionar':  '✂️ Fracionar Folha',
}

function irPara(pg) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('ativo'))

  const pgEl = document.getElementById('pg-' + pg)
  if (pgEl) pgEl.classList.add('ativa')

  const navBtn = document.querySelector('[data-pg="' + pg + '"]')
  if (navBtn) navBtn.classList.add('ativo')

  document.getElementById('titulo-pagina').textContent = TITULOS[pg] || ''
  paginaAtual = pg

  if (pg === 'lista-func') carregarFuncionarios()
  if (pg === 'exames')     carregarExames()
  if (pg === 'epi')        carregarEpi()
  if (pg === 'folha')      carregarFolha()
}

// ═══════════════════════════════════════════════════════════════════
// API — Google Apps Script
// ═══════════════════════════════════════════════════════════════════
async function chamarGAS(dados) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body:   JSON.stringify({ ...dados, usuario: dados.usuario || USUARIO, senha: dados.senha || SENHA_ADM }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, erro: 'Erro de conexão: ' + e.message }
  }
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD — INÍCIO
// ═══════════════════════════════════════════════════════════════════
async function carregarDashboard() {
  // Funcionários já vieram no login; busca exames e estoque em paralelo
  const [resEx, resEst] = await Promise.all([
    chamarGAS({ acao: 'listar_exames' }),
    chamarGAS({ acao: 'listar_epi_estoque' }),
  ])

  document.getElementById('num-funcs').textContent = funcionarios.length

  if (resEx.ok) {
    todosExames = resEx.data
    const venc   = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('VENCIDO')).length
    const aVenc  = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('A VENCER')).length
    document.getElementById('num-vencidos').textContent = venc
    document.getElementById('num-avencer').textContent  = aVenc
  }

  if (resEst.ok) {
    estoque = resEst.data
    const repor = resEst.data.filter(e => {
      const sit = e['SITUAÇÃO'] || ''
      return sit.includes('REPOR') || sit.includes('SEM')
    }).length
    document.getElementById('num-epi').textContent = repor
  }
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONÁRIOS
// ═══════════════════════════════════════════════════════════════════
async function carregarFuncionarios() {
  mostrarLoading('Carregando funcionários...')
  const res = await chamarGAS({ acao: 'listar_funcionarios' })
  esconderLoading()
  if (!res.ok) return toast('Erro: ' + res.erro, 'erro')
  funcionarios = res.data
  renderFuncionarios(funcionarios)
  preencherSelectsFuncionarios()
}

function renderFuncionarios(lista) {
  const el = document.getElementById('lista-funcionarios')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário encontrado</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['NOME_COMPLETO']}</div>
        <div class="lista-item-sub">${f['FUNCAO']} · ${f['UNIDADE']}</div>
        <div class="lista-item-sub">${f['TELEFONE'] || ''}</div>
      </div>
      ${badge(f['STATUS'])}
    </div>
  `).join('')
}

async function salvarFuncionario(e) {
  e.preventDefault()
  const btn = document.getElementById('btn-salvar-func')
  btn.disabled = true; btn.textContent = 'Salvando...'
  mostrarLoading('Cadastrando funcionário, criando pasta no Drive e cadastrando exames...')

  const dados = Object.fromEntries(new FormData(e.target).entries())
  const res   = await chamarGAS({ acao: 'cadastrar_funcionario', dados })

  esconderLoading()
  btn.disabled = false; btn.textContent = '💾 Cadastrar'

  if (res.ok) {
    toast(`✅ Funcionário cadastrado! ID: ${res.data.id}`, 'sucesso')
    e.target.reset()
    funcionarios = (await chamarGAS({ acao: 'listar_funcionarios' })).data || funcionarios
    preencherSelectsFuncionarios()
    setTimeout(() => irPara('lista-func'), 1500)
  } else {
    toast('❌ ' + (res.erro || 'Erro ao cadastrar'), 'erro')
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMES
// ═══════════════════════════════════════════════════════════════════
async function carregarExames() {
  mostrarLoading('Carregando exames...')
  const res = await chamarGAS({ acao: 'listar_exames' })
  esconderLoading()
  if (!res.ok) return toast('Erro: ' + res.erro, 'erro')
  todosExames = res.data
  filtrarExames()
}

function filtrarExames() {
  const filtro = document.getElementById('filtro-status-exame').value
  const lista  = filtro ? todosExames.filter(e => (e['STATUS EXAME']||'') === filtro) : todosExames
  renderExames(lista)
}

function renderExames(lista) {
  const el = document.getElementById('lista-exames')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum exame encontrado</p>'; return }
  el.innerHTML = lista.map(e => {
    const status = e['STATUS EXAME'] || '⏳ PENDENTE'
    let cls = 'lista-item'
    if (status.includes('VENCIDO'))  cls += ' borda-vermelho'
    if (status.includes('A VENCER')) cls += ' borda-amarelo'
    return `
    <div class="${cls}">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['EXAME REALIZADO']}</div>
        <div class="lista-item-sub">
          ${e['DATA REALIZAÇÃO'] ? 'Realizado: ' + e['DATA REALIZAÇÃO'] : 'Não realizado'}
          ${e['DATA VENCIMENTO'] ? ' · Vence: ' + e['DATA VENCIMENTO'] : ''}
        </div>
      </div>
      ${badge(status)}
    </div>`
  }).join('')
}

// ═══════════════════════════════════════════════════════════════════
// EPI
// ═══════════════════════════════════════════════════════════════════
async function carregarEpi() {
  mostrarLoading('Carregando EPI...')
  const [resEst, resEnt] = await Promise.all([
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
  ])
  esconderLoading()

  if (resEst.ok) {
    estoque = resEst.data
    renderEstoque(estoque)
    preencherSelectEpi(estoque)
  }
  if (resEnt.ok) renderEntregas(resEnt.data.slice(0, 15))
}

function renderEstoque(lista) {
  const el = document.getElementById('lista-estoque')
  el.innerHTML = lista.map(e => `
    <div class="estoque-item">
      <span class="estoque-nome">${e['CÓD.']} — ${e['DESCRIÇÃO DO EPI']}</span>
      <span class="estoque-qtd">Estoque: ${e['ESTOQUE ATUAL']}</span>
      ${badge(situacaoEpi(e))}
    </div>
  `).join('')
}

function situacaoEpi(e) {
  const est = parseInt(e['ESTOQUE ATUAL']) || 0
  const min = parseInt(e['ESTOQUE MÍNIMO']) || 0
  if (est === 0) return '⛔ SEM ESTOQUE'
  if (est <= min) return '⚠️ REPOR'
  return '✅ OK'
}

function preencherSelectEpi(lista) {
  const sel = document.getElementById('sel-epi-adicionar')
  sel.innerHTML = '<option value="">Selecione um EPI...</option>'
  lista.filter(e => parseInt(e['ESTOQUE ATUAL']) > 0).forEach(e => {
    sel.innerHTML += `<option value="${e['CÓD.']}">${e['CÓD.']} — ${e['DESCRIÇÃO DO EPI']}</option>`
  })
}

function adicionarItemEpi(sel) {
  const cod = sel.value
  if (!cod) return
  if (itensEpiSel.find(i => i.cod === cod)) { sel.value = ''; return }
  const epi = estoque.find(e => e['CÓD.'] === cod)
  if (!epi) return
  itensEpiSel.push({ cod, descricao: epi['DESCRIÇÃO DO EPI'], ca: epi['Nº CA'], quantidade: 1 })
  sel.value = ''
  renderItensEpi()
}

function removerItemEpi(cod) {
  itensEpiSel = itensEpiSel.filter(i => i.cod !== cod)
  renderItensEpi()
}

function renderItensEpi() {
  const wrap = document.getElementById('itens-epi')
  const lista = document.getElementById('lista-itens-epi')
  if (!itensEpiSel.length) { wrap.style.display = 'none'; return }
  wrap.style.display = 'block'
  lista.innerHTML = itensEpiSel.map(item => `
    <div class="item-epi-row">
      <span class="item-epi-nome">${item.cod} — ${item.descricao}</span>
      <input class="item-epi-qtd" type="number" min="1" value="${item.quantidade}"
        onchange="atualizarQtdEpi('${item.cod}', this.value)">
      <button class="item-epi-del" onclick="removerItemEpi('${item.cod}')" type="button">✕</button>
    </div>
  `).join('')
}

function atualizarQtdEpi(cod, qtd) {
  const item = itensEpiSel.find(i => i.cod === cod)
  if (item) item.quantidade = parseInt(qtd) || 1
}

async function enviarEpi(e) {
  e.preventDefault()
  if (!itensEpiSel.length) return toast('❌ Selecione ao menos 1 EPI', 'erro')
  const fd     = new FormData(e.target)
  const funcId = fd.get('func_id')
  const motivo = fd.get('motivo')
  if (!funcId) return toast('❌ Selecione o funcionário', 'erro')

  const btn = document.getElementById('btn-enviar-epi')
  btn.disabled = true; btn.textContent = 'Enviando...'
  mostrarLoading('Gerando recibo PDF e enviando para ZapSign...')

  const res = await chamarGAS({
    acao: 'entregar_epi',
    dados: { func_id: funcId, itens: itensEpiSel, motivo }
  })

  esconderLoading()
  btn.disabled = false; btn.textContent = '📲 Gerar Recibo e Enviar para Assinatura'

  if (res.ok) {
    toast('✅ ' + res.data.mensagem, 'sucesso')
    itensEpiSel = []
    renderItensEpi()
    e.target.reset()
    carregarEpi()
  } else {
    toast('❌ ' + (res.erro || 'Erro'), 'erro')
  }
}

function renderEntregas(lista) {
  const el = document.getElementById('lista-entregas')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega registrada</p>'; return }
  el.innerHTML = lista.map(e => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['DESCRIÇÃO DO EPI']} · ${e['DATA ENTREGA']}</div>
      </div>
      ${badge(e['ASSINADO?'])}
    </div>
  `).join('')
}

// ═══════════════════════════════════════════════════════════════════
// FOLHA DE PAGAMENTO
// ═══════════════════════════════════════════════════════════════════
async function carregarFolha() {
  mostrarLoading('Carregando folhas...')
  const res = await chamarGAS({ acao: 'listar_folhas' })
  esconderLoading()
  if (res.ok) renderFolhas(res.data.slice(0, 15))
}

async function enviarFolha(e) {
  e.preventDefault()
  const fd         = new FormData(e.target)
  const funcId     = fd.get('func_id')
  const competencia = fd.get('competencia')
  if (!funcId || !competencia) return toast('❌ Selecione funcionário e competência', 'erro')

  const btn = document.getElementById('btn-enviar-folha')
  btn.disabled = true; btn.textContent = 'Enviando...'
  mostrarLoading('Gerando documento e enviando para ZapSign...')

  const res = await chamarGAS({
    acao: 'enviar_folha',
    dados: { func_id: funcId, competencia, pdf_base64: pdfFolhaB64 || '' }
  })

  esconderLoading()
  btn.disabled = false; btn.textContent = '📲 Enviar para Assinatura'

  if (res.ok) {
    toast('✅ ' + res.data.mensagem, 'sucesso')
    pdfFolhaB64 = ''
    document.getElementById('pdf-carregado').style.display = 'none'
    document.getElementById('input-pdf-folha').value = ''
    e.target.reset()
    carregarFolha()
  } else {
    toast('❌ ' + (res.erro || 'Erro'), 'erro')
  }
}

function renderFolhas(lista) {
  const el = document.getElementById('lista-folhas')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum envio registrado</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${f['COMPETÊNCIA']} · Enviado: ${f['DATA ENVIO']}</div>
      </div>
      ${badge(f['STATUS'])}
    </div>
  `).join('')
}

// ═══════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════════
function preencherSelectsFuncionarios() {
  ;['sel-func-epi', 'sel-func-folha'].forEach(id => {
    const sel = document.getElementById(id)
    if (!sel) return
    sel.innerHTML = '<option value="">Selecione...</option>'
    funcionarios.forEach(f => {
      sel.innerHTML += `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>`
    })
  })
}

function preencherMeses() {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano   = new Date().getFullYear()
  const sel   = document.getElementById('sel-competencia')
  if (!sel) return
  meses.forEach((m, i) => {
    sel.innerHTML += `<option value="${m}/${ano}">${m}/${ano}</option>`
  })
  // Adicionar ano anterior também
  meses.forEach((m, i) => {
    sel.innerHTML += `<option value="${m}/${ano-1}">${m}/${ano-1}</option>`
  })
}

// ═══════════════════════════════════════════════════════════════════
// FRACIONAR FOLHA DE PAGAMENTO
// ═══════════════════════════════════════════════════════════════════
function preencherMesesFracionar() {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano   = new Date().getFullYear()
  const sel   = document.getElementById('sel-comp-frac')
  if (!sel) return
  meses.forEach(m => {
    sel.innerHTML += `<option value="${m}/${ano}">${m}/${ano}</option>`
    sel.innerHTML += `<option value="${m}/${ano-1}">${m}/${ano-1}</option>`
  })
}

async function processarFracionamento(e) {
  e.preventDefault()
  const file        = document.getElementById('input-pdf-frac').files[0]
  const competencia = document.getElementById('sel-comp-frac').value
  const enviarZap   = document.getElementById('sel-zapsign-frac').value === 'sim'

  if (!file || !competencia) return toast('❌ Selecione o PDF e a competência', 'erro')

  const btn = document.getElementById('btn-fracionar')
  btn.disabled = true; btn.textContent = '⏳ Lendo PDF...'
  mostrarLoading('Carregando pdf-lib...')

  try {
    const PDFLib = await carregarPdfLib()
    mostrarLoading('Lendo PDF...')

    const buffer = await file.arrayBuffer()
    const pdfDoc = await PDFLib.PDFDocument.load(buffer)
    const total  = pdfDoc.getPageCount()

    esconderLoading()
    btn.disabled = false; btn.textContent = '✂️ Separar e Processar'

    // Mostra interface de confirmação página a página
    mostrarConfirmacaoPaginas(pdfDoc, PDFLib, total, competencia, enviarZap, file)

  } catch(err) {
    esconderLoading()
    btn.disabled = false; btn.textContent = '✂️ Separar e Processar'
    toast('❌ Erro ao ler PDF: ' + err.message, 'erro')
  }
}

async function mostrarConfirmacaoPaginas(pdfDoc, PDFLib, total, competencia, enviarZap) {
  const wrap  = document.getElementById('frac-resultado')
  const lista = document.getElementById('frac-lista')
  wrap.style.display = 'block'

  // Extrai todas as páginas e monta preview com select
  lista.innerHTML = `<p style="font-size:12px;color:#1A5C2A;font-weight:bold;margin-bottom:10px">
    📄 ${total} página(s) encontrada(s). Confirme o funcionário de cada página:</p>`

  for (let i = 0; i < total; i++) {
    const div = document.createElement('div')
    div.className = 'lista-item'
    div.id = 'pag-item-' + i
    div.style.cssText = 'flex-direction:column;gap:8px;margin-bottom:8px'
    div.innerHTML = `
      <div style="font-size:12px;font-weight:bold;color:#1A5C2A">Página ${i+1}</div>
      <select id="func-pag-${i}" style="width:100%;border:1px solid #ddd;border-radius:8px;padding:8px;font-size:12px">
        <option value="">⏳ Identificando...</option>
      </select>`
    lista.appendChild(div)
  }

  // Botão confirmar
  const btnDiv = document.createElement('div')
  btnDiv.innerHTML = `<button onclick="enviarPaginasConfirmadas(${total},'${competencia}',${enviarZap})"
    class="btn-primario w-full mt-2" id="btn-confirmar-frac">
    📲 Confirmar e Processar
  </button>`
  lista.appendChild(btnDiv)

  // Identifica funcionários em paralelo via GAS (OCR)
  for (let i = 0; i < total; i++) {
    identificarPaginaAsync(pdfDoc, PDFLib, i, total)
  }
}

async function identificarPaginaAsync(pdfDoc, PDFLib, i, total) {
  const sel = document.getElementById('func-pag-' + i)
  if (!sel) return

  try {
    // Extrai página como PDF
    const novoDoc  = await PDFLib.PDFDocument.create()
    const [pag]    = await novoDoc.copyPages(pdfDoc, [i])
    novoDoc.addPage(pag)
    const pagBytes  = await novoDoc.save()
    const pagBase64 = arrayBufferToBase64(pagBytes)

    // Pede ao GAS para identificar o funcionário via OCR
    const res = await chamarGAS({
      acao: 'identificar_funcionario_pdf',
      dados: { pdf_base64: pagBase64 }
    })

    // Monta select com todos os funcionários, pre-selecionando o identificado
    let opcoesHtml = '<option value="">— Selecione —</option>'
    funcionarios.forEach(f => {
      const sel = (res.ok && res.data && String(res.data.func_id) === String(f['ID'])) ? 'selected' : ''
      opcoesHtml += `<option value="${f['ID']}" ${sel}>${f['NOME_COMPLETO']}</option>`
    })
    opcoesHtml += '<option value="PULAR">⏭ Pular esta página</option>'
    sel.innerHTML = opcoesHtml

    // Feedback visual
    const item = document.getElementById('pag-item-' + i)
    if (res.ok && res.data?.func_id) {
      item.style.borderColor = '#4CAF50'
      item.querySelector('div').textContent = `Página ${i+1} — ✅ ${res.data.nome_encontrado}`
    } else {
      item.style.borderColor = '#FF9800'
      item.querySelector('div').textContent = `Página ${i+1} — ⚠️ Confirme manualmente`
    }
  } catch(e) {
    sel.innerHTML = '<option value="">— Erro, selecione manualmente —</option>' +
      funcionarios.map(f => `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>`).join('')
  }
}

async function enviarPaginasConfirmadas(total, competencia, enviarZap) {
  const btn = document.getElementById('btn-confirmar-frac')
  btn.disabled = true; btn.textContent = '⏳ Processando...'

  const PDFLib = window._PDFLibFrac
  const pdfDoc = window._pdfDocFrac
  const resultados = [], erros = []

  for (let i = 0; i < total; i++) {
    const sel    = document.getElementById('func-pag-' + i)
    const funcId = sel?.value
    if (!funcId || funcId === 'PULAR' || funcId === '') continue

    const func = funcionarios.find(f => String(f['ID']) === String(funcId))
    if (!func) continue

    mostrarLoading(`Processando ${func['NOME_COMPLETO']} (${i+1}/${total})...`)

    const novoDoc  = await PDFLib.PDFDocument.create()
    const [pag]    = await novoDoc.copyPages(pdfDoc, [i])
    novoDoc.addPage(pag)
    const pagBytes  = await novoDoc.save()
    const pagBase64 = arrayBufferToBase64(pagBytes)

    const res = await chamarGAS({
      acao: 'processar_pagina_folha',
      dados: {
        pdf_base64:       pagBase64,
        competencia,
        nome_funcionario: func['NOME_COMPLETO'],
        pagina:           i + 1,
        enviar_zapsign:   enviarZap,
      }
    })

    const item = document.getElementById('pag-item-' + i)
    if (res.ok) {
      resultados.push({ pagina: i+1, ...res.data })
      if (item) item.style.background = '#F1F8E9'
    } else {
      erros.push(`Pág ${i+1}: ${res.erro}`)
      if (item) item.style.background = '#FFF5F5'
    }
  }

  esconderLoading()
  btn.disabled = false; btn.textContent = '✅ Concluído'
  renderResultadoFracionamento(resultados, erros, total)
  toast(`✅ ${resultados.length} processados, ${erros.length} erros`, resultados.length > 0 ? 'sucesso' : 'erro')
}

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// ═══════════════════════════════════════════════════════════════════
function badge(status) {
  const map = {
    '✅ VIGENTE':     'badge-verde',
    '⚠️ A VENCER':    'badge-amarelo',
    '⛔ VENCIDO':     'badge-vermelho',
    '⏳ PENDENTE':    'badge-cinza',
    'Ativo':          'badge-verde',
    'Inativo':        'badge-vermelho',
    'Sim':            'badge-verde',
    'Não':            'badge-cinza',
    'Pendente':       'badge-amarelo',
    'Assinado':       'badge-verde',
    '✅ OK':          'badge-verde',
    '⚠️ REPOR':       'badge-amarelo',
    '⛔ SEM ESTOQUE': 'badge-vermelho',
  }
  const cls = map[status] || 'badge-cinza'
  return `<span class="badge ${cls}">${status || '—'}</span>`
}

function toast(msg, tipo) {
  const el   = document.getElementById('toast')
  el.textContent  = msg
  el.className    = 'toast ' + (tipo || '')
  el.style.display = 'block'
  setTimeout(() => el.style.display = 'none', 4000)
}

function mostrarLoading(msg) {
  document.getElementById('loading-msg').textContent = msg || 'Carregando...'
  document.getElementById('loading').style.display   = 'flex'
}

function esconderLoading() {
  document.getElementById('loading').style.display = 'none'
}
