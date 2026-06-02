// ═══════════════════════════════════════════════════════════════════
// SST FAZENDA ÁGUA VIVA — app.js
// ═══════════════════════════════════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxayJeiQeUeHNfl0oz1xcJh6xzymXLREH-wosmRaLHTazaV6fo62y0bMgivnJTyv1oP/exec'
const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'

let USUARIO = null, SENHA_ADM = null
let funcionarios = [], estoque = [], itensEpiSel = []
let paginaAtual = 'inicio', todosExames = []
// Páginas fracionadas aguardando envio: [{pagina, funcId, nome, telefone, pdfBase64, status, signUrl}]
let paginasFracionadas = []

async function carregarPdfLib() {
  if (window.PDFLib) return window.PDFLib
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = PDFLIB_URL; s.onload = () => resolve(window.PDFLib); s.onerror = reject
    document.head.appendChild(s)
  })
}

document.addEventListener('DOMContentLoaded', () => {
  const sessao = sessionStorage.getItem('sst_user')
  if (sessao) {
    const { usuario, senha } = JSON.parse(sessao)
    USUARIO = usuario; SENHA_ADM = senha
    entrarNoApp()
  }

  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault()
    const usuario = document.getElementById('login-user').value.trim()
    const senha   = document.getElementById('login-senha').value
    const btn     = document.getElementById('btn-login')
    btn.disabled = true; btn.textContent = 'Entrando...'
    document.getElementById('login-erro').style.display = 'none'
    const res = await chamarGAS({ acao: 'listar_funcionarios', usuario, senha })
    btn.disabled = false; btn.textContent = 'Entrar'
    if (res && res.ok) {
      USUARIO = usuario; SENHA_ADM = senha
      sessionStorage.setItem('sst_user', JSON.stringify({ usuario, senha }))
      funcionarios = res.data
      entrarNoApp()
    } else {
      const el = document.getElementById('login-erro')
      el.textContent = '⚠️ ' + ((res && res.erro) || 'Usuário ou senha incorretos')
      el.style.display = 'block'
    }
  })

  document.getElementById('form-funcionario').addEventListener('submit', salvarFuncionario)
  document.getElementById('form-epi').addEventListener('submit', enviarEpi)
  document.getElementById('form-fracionar').addEventListener('submit', processarFracionamento)

  document.getElementById('input-pdf-frac').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return
    const preview = document.getElementById('frac-preview')
    preview.style.display = 'block'; preview.textContent = '⏳ Lendo PDF...'
    try {
      const PDFLib = await carregarPdfLib()
      const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
      const total  = pdfDoc.getPageCount()
      preview.textContent = '📄 ' + total + ' página(s) — ' + total + ' funcionário(s)'
      preview.style.background = '#E8F5E9'; preview.style.color = '#1A5C2A'
    } catch(err) {
      preview.textContent = '❌ Erro: ' + err.message
    }
  })

  preencherMesesFracionar()
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
  document.getElementById('login-user').value = ''
  document.getElementById('login-senha').value = ''
}

async function sincronizarManual() {
  const btn = document.getElementById('btn-sync')
  btn.classList.add('girando'); btn.disabled = true
  mostrarLoading('Verificando assinaturas pendentes...')
  const res = await chamarGAS({ acao: 'sincronizar' })
  esconderLoading(); btn.classList.remove('girando'); btn.disabled = false
  if (res && res.ok) {
    const d = res.data
    if (d.atualizados > 0) {
      toast('✅ ' + d.atualizados + ' assinatura(s) atualizada(s)!', 'sucesso')
      if (paginaAtual === 'epi') carregarEpi()
      if (paginaAtual === 'fracionar') carregarEntregasFolha()
      carregarDashboard()
    } else if (d.verificados === 0) {
      toast('Nenhum documento pendente', '')
    } else {
      toast('🔄 ' + d.pendentes + ' ainda aguardando assinatura', '')
    }
  } else { toast('❌ Erro na sincronização', 'erro') }
}

const TITULOS = {
  'inicio':    '🏠 Início',
  'lista-func':'👥 Funcionários',
  'novo-func': '➕ Novo Funcionário',
  'exames':    '🩺 Exames',
  'epi':       '🦺 EPI',
  'fracionar': '💰 Folha de Pagamento',
}

function irPara(pg) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('ativo'))
  const pgEl = document.getElementById('pg-' + pg)
  if (pgEl) pgEl.classList.add('ativa')
  const nav = document.querySelector('[data-pg="' + pg + '"]')
  if (nav) nav.classList.add('ativo')
  document.getElementById('titulo-pagina').textContent = TITULOS[pg] || ''
  paginaAtual = pg
  if (pg === 'lista-func') carregarFuncionarios()
  if (pg === 'exames')     carregarExames()
  if (pg === 'epi')        carregarEpi()
  if (pg === 'fracionar')  carregarEntregasFolha()
}

async function chamarGAS(dados) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ ...dados, usuario: dados.usuario || USUARIO, senha: dados.senha || SENHA_ADM }),
    })
    return await res.json()
  } catch(e) { return { ok: false, erro: 'Erro de conexão: ' + e.message } }
}

// ─── DASHBOARD ───────────────────────────────────────────────────
async function carregarDashboard() {
  const [resEx, resEst] = await Promise.all([
    chamarGAS({ acao: 'listar_exames' }),
    chamarGAS({ acao: 'listar_epi_estoque' }),
  ])
  document.getElementById('num-funcs').textContent = funcionarios.length
  if (resEx && resEx.ok) {
    todosExames = resEx.data
    document.getElementById('num-vencidos').textContent = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('VENCIDO')).length
    document.getElementById('num-avencer').textContent  = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('A VENCER')).length
  }
  if (resEst && resEst.ok) {
    estoque = resEst.data
    document.getElementById('num-epi').textContent = resEst.data.filter(e => {
      const s = e['SITUAÇÃO']||''; return s.includes('REPOR') || s.includes('SEM')
    }).length
  }
}

// ─── FUNCIONÁRIOS ────────────────────────────────────────────────
async function carregarFuncionarios() {
  mostrarLoading('Carregando funcionários...')
  const res = await chamarGAS({ acao: 'listar_funcionarios' })
  esconderLoading()
  if (!res || !res.ok) return toast('Erro ao carregar', 'erro')
  funcionarios = res.data
  renderFuncionarios(funcionarios)
  preencherSelectsFuncionarios()
}

function renderFuncionarios(lista) {
  const el = document.getElementById('lista-funcionarios')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['NOME_COMPLETO']}</div>
        <div class="lista-item-sub">${f['FUNCAO']} · ${f['UNIDADE']}</div>
        <div class="lista-item-sub">${f['TELEFONE']||''}</div>
      </div>
      ${badge(f['STATUS'])}
    </div>`).join('')
}

async function salvarFuncionario(e) {
  e.preventDefault()
  const btn = document.getElementById('btn-salvar-func')
  btn.disabled = true; btn.textContent = 'Salvando...'
  mostrarLoading('Cadastrando funcionário e criando pasta no Drive...')
  const dados = Object.fromEntries(new FormData(e.target).entries())
  const res = await chamarGAS({ acao: 'cadastrar_funcionario', dados })
  esconderLoading(); btn.disabled = false; btn.textContent = '💾 Cadastrar'
  if (res && res.ok) {
    toast('✅ Cadastrado! ID: ' + res.data.id, 'sucesso')
    e.target.reset()
    const r2 = await chamarGAS({ acao: 'listar_funcionarios' })
    if (r2 && r2.ok) { funcionarios = r2.data; preencherSelectsFuncionarios() }
    setTimeout(() => irPara('lista-func'), 1500)
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

// ─── EXAMES ──────────────────────────────────────────────────────
async function carregarExames() {
  mostrarLoading('Carregando exames...')
  const res = await chamarGAS({ acao: 'listar_exames' })
  esconderLoading()
  if (!res || !res.ok) return
  todosExames = res.data; filtrarExames()
}

function filtrarExames() {
  const filtro = document.getElementById('filtro-status-exame').value
  const lista  = filtro ? todosExames.filter(e => (e['STATUS EXAME']||'') === filtro) : todosExames
  const el = document.getElementById('lista-exames')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum exame</p>'; return }
  el.innerHTML = lista.map(e => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['EXAME REALIZADO']}</div>
        <div class="lista-item-sub">${e['DATA REALIZAÇÃO']?'Realizado: '+e['DATA REALIZAÇÃO']:'Não realizado'}${e['DATA VENCIMENTO']?' · Vence: '+e['DATA VENCIMENTO']:''}</div>
      </div>
      ${badge(e['STATUS EXAME']||'⏳ PENDENTE')}
    </div>`).join('')
}

// ─── EPI ─────────────────────────────────────────────────────────
async function carregarEpi() {
  mostrarLoading('Carregando EPI...')
  const [resEst, resEnt] = await Promise.all([
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
  ])
  esconderLoading()
  if (resEst && resEst.ok) { estoque = resEst.data; renderEstoque(estoque); preencherSelectEpi(estoque) }
  if (resEnt && resEnt.ok) renderEntregas(resEnt.data.slice(0,15))
}

function renderEstoque(lista) {
  document.getElementById('lista-estoque').innerHTML = lista.map(e => `
    <div class="estoque-item">
      <span class="estoque-nome">${e['CÓD.']} — ${e['DESCRIÇÃO DO EPI']}</span>
      <span class="estoque-qtd">Qtd: ${e['ESTOQUE ATUAL']}</span>
      ${badge(situacaoEpi(e))}
    </div>`).join('')
}

function situacaoEpi(e) {
  const est = parseInt(e['ESTOQUE ATUAL'])||0, min = parseInt(e['ESTOQUE MÍNIMO'])||0
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
  const cod = sel.value; if (!cod) return
  if (itensEpiSel.find(i => i.cod === cod)) { sel.value = ''; return }
  const epi = estoque.find(e => e['CÓD.'] === cod); if (!epi) return
  itensEpiSel.push({ cod, descricao: epi['DESCRIÇÃO DO EPI'], ca: epi['Nº CA'], quantidade: 1 })
  sel.value = ''; renderItensEpi()
}
function removerItemEpi(cod) { itensEpiSel = itensEpiSel.filter(i => i.cod !== cod); renderItensEpi() }
function atualizarQtdEpi(cod, qtd) { const i = itensEpiSel.find(i => i.cod === cod); if (i) i.quantidade = parseInt(qtd)||1 }

function renderItensEpi() {
  const wrap = document.getElementById('itens-epi')
  const lista = document.getElementById('lista-itens-epi')
  if (!itensEpiSel.length) { wrap.style.display = 'none'; return }
  wrap.style.display = 'block'
  lista.innerHTML = itensEpiSel.map(item => `
    <div class="item-epi-row">
      <span class="item-epi-nome">${item.cod} — ${item.descricao}</span>
      <input class="item-epi-qtd" type="number" min="1" value="${item.quantidade}" onchange="atualizarQtdEpi('${item.cod}',this.value)">
      <button class="item-epi-del" onclick="removerItemEpi('${item.cod}')" type="button">✕</button>
    </div>`).join('')
}

async function enviarEpi(e) {
  e.preventDefault()
  if (!itensEpiSel.length) return toast('❌ Selecione ao menos 1 EPI', 'erro')
  const fd = new FormData(e.target)
  const funcId = fd.get('func_id'), motivo = fd.get('motivo')
  if (!funcId) return toast('❌ Selecione o funcionário', 'erro')
  const btn = document.getElementById('btn-enviar-epi')
  btn.disabled = true; btn.textContent = 'Enviando...'
  mostrarLoading('Gerando recibo e enviando para ZapSign...')
  const res = await chamarGAS({ acao: 'entregar_epi', dados: { func_id: funcId, itens: itensEpiSel, motivo } })
  esconderLoading(); btn.disabled = false; btn.textContent = '📲 Gerar Recibo e Enviar'

  if (res && res.ok) {
    // Mostra link de assinatura no app também
    if (res.data.link_assinatura) {
      mostrarLinkAssinatura(res.data.link_assinatura, res.data.mensagem)
    } else {
      toast('✅ ' + res.data.mensagem, 'sucesso')
    }
    itensEpiSel = []; renderItensEpi(); e.target.reset(); carregarEpi()
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

function mostrarLinkAssinatura(url, msg) {
  const el = document.getElementById('link-assinatura-epi')
  if (!el) return
  el.style.display = 'block'
  el.innerHTML = `
    <p style="font-size:12px;font-weight:bold;color:#1A5C2A;margin-bottom:6px">✅ ${msg}</p>
    <p style="font-size:11px;color:#555;margin-bottom:8px">Link de assinatura (copie para enviar manualmente se necessário):</p>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="inp-link-ass" value="${url}" readonly style="flex:1;font-size:10px;border:1px solid #ddd;border-radius:6px;padding:6px;background:#f9f9f9">
      <button onclick="copiarLink()" style="background:#1A5C2A;color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer">Copiar</button>
      <a href="https://wa.me/?text=${encodeURIComponent('Por favor, assine o documento: '+url)}" target="_blank" style="background:#25D366;color:white;border-radius:6px;padding:6px 10px;font-size:11px;text-decoration:none">WhatsApp</a>
    </div>`
}

function copiarLink() {
  const inp = document.getElementById('inp-link-ass')
  if (!inp) return
  inp.select(); document.execCommand('copy')
  toast('✅ Link copiado!', 'sucesso')
}

function renderEntregas(lista) {
  const el = document.getElementById('lista-entregas')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega</p>'; return }
  el.innerHTML = lista.map(e => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['DESCRIÇÃO DO EPI']} · ${e['DATA ENTREGA']}</div>
        ${e['LINK DOC ASSINADO'] ? '<a href="'+e['LINK DOC ASSINADO']+'" target="_blank" style="font-size:10px;color:#1565C0">📄 Ver doc assinado</a>' : ''}
      </div>
      ${badge(e['ASSINADO?'])}
    </div>`).join('')
}

// ─── FRACIONAR FOLHA (substitui Folha de Pagamento) ─────────────
function preencherMesesFracionar() {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano = new Date().getFullYear()
  const sel = document.getElementById('sel-comp-frac'); if (!sel) return
  sel.innerHTML = '<option value="">Selecione...</option>'
  meses.forEach(m => {
    sel.innerHTML += `<option value="${m}/${ano}">${m}/${ano}</option>`
    sel.innerHTML += `<option value="${m}/${ano-1}">${m}/${ano-1}</option>`
  })
}

async function carregarEntregasFolha() {
  const res = await chamarGAS({ acao: 'listar_folhas' })
  if (res && res.ok) renderHistoricoFolha(res.data.slice(0,20))
}

function renderHistoricoFolha(lista) {
  const el = document.getElementById('historico-folha')
  if (!el) return
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum envio</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${f['COMPETÊNCIA']} · ${f['DATA ENVIO']}</div>
        ${f['LINK DOC ASSINADO'] ? '<a href="'+f['LINK DOC ASSINADO']+'" target="_blank" style="font-size:10px;color:#1565C0">📄 Ver assinado</a>' : ''}
      </div>
      ${badge(f['STATUS'])}
    </div>`).join('')
}

async function processarFracionamento(e) {
  e.preventDefault()
  const file        = document.getElementById('input-pdf-frac').files[0]
  const competencia = document.getElementById('sel-comp-frac').value
  if (!file || !competencia) return toast('❌ Selecione o PDF e a competência', 'erro')

  const btn = document.getElementById('btn-fracionar')
  btn.disabled = true; btn.textContent = '⏳ Separando páginas...'
  mostrarLoading('Carregando pdf-lib e separando páginas...')

  try {
    const PDFLib = await carregarPdfLib()
    const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
    const total  = pdfDoc.getPageCount()

    // Separa cada página em base64
    paginasFracionadas = []
    for (let i = 0; i < total; i++) {
      mostrarLoading('Separando página ' + (i+1) + ' de ' + total + '...')
      const novoDoc = await PDFLib.PDFDocument.create()
      const [pag]   = await novoDoc.copyPages(pdfDoc, [i])
      novoDoc.addPage(pag)
      const b64 = arrayBufferToBase64(await novoDoc.save())
      paginasFracionadas.push({ pagina: i+1, funcId: '', nome: '', telefone: '', pdfBase64: b64, status: 'pronto', signUrl: '', competencia })
    }

    esconderLoading()
    btn.disabled = false; btn.textContent = '✂️ Separar PDF'
    renderPaginasFracionadas(competencia)
    preencherSelectsFuncionarios()

  } catch(err) {
    esconderLoading(); btn.disabled = false; btn.textContent = '✂️ Separar PDF'
    toast('❌ Erro: ' + err.message, 'erro')
  }
}

function renderPaginasFracionadas(competencia) {
  const wrap = document.getElementById('frac-resultado')
  const lista = document.getElementById('frac-lista')
  wrap.style.display = 'block'

  lista.innerHTML = `
    <div style="background:#E8F5E9;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:#1A5C2A;font-weight:bold">
      ✅ ${paginasFracionadas.length} página(s) separadas — selecione o funcionário e envie individualmente
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button onclick="enviarTodasPendentes()" class="btn-primario" style="flex:1;font-size:12px;padding:10px">
        📲 Enviar Todas via WhatsApp
      </button>
    </div>
    ${paginasFracionadas.map((p, i) => `
    <div class="lista-item" id="pag-card-${i}" style="flex-direction:column;gap:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:bold;color:#1A5C2A">Página ${p.pagina}</span>
        <span id="status-pag-${i}">${badge('pronto')}</span>
      </div>
      <select id="func-sel-${i}" onchange="selecionarFuncPagina(${i}, this.value)"
        style="width:100%;border:1px solid #ddd;border-radius:8px;padding:8px;font-size:12px">
        <option value="">— Selecione o funcionário —</option>
        ${funcionarios.map(f => `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>`).join('')}
      </select>
      <div id="actions-${i}" style="display:none;gap:8px">
        <button onclick="enviarPaginaZapSign(${i})" id="btn-zap-${i}"
          class="btn-primario" style="flex:1;font-size:11px;padding:8px">
          📲 Enviar WhatsApp + ZapSign
        </button>
        <a id="link-btn-${i}" href="#" target="_blank" style="display:none;background:#E3F2FD;color:#1565C0;border-radius:8px;padding:8px 10px;font-size:11px;text-decoration:none;font-weight:bold">
          🔗 Ver Link
        </a>
      </div>
    </div>`).join('')}
  `
}

function selecionarFuncPagina(idx, funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  paginasFracionadas[idx].funcId    = funcId
  paginasFracionadas[idx].nome      = func['NOME_COMPLETO']
  paginasFracionadas[idx].telefone  = func['TELEFONE']
  document.getElementById('actions-' + idx).style.display = 'flex'
}

async function enviarPaginaZapSign(idx) {
  const p = paginasFracionadas[idx]
  if (!p.funcId) return toast('❌ Selecione o funcionário primeiro', 'erro')

  const btn = document.getElementById('btn-zap-' + idx)
  btn.disabled = true; btn.textContent = '⏳ Enviando...'
  mostrarLoading('Enviando para ZapSign...')

  const res = await chamarGAS({
    acao: 'processar_pagina_folha',
    dados: {
      pdf_base64:       p.pdfBase64,
      competencia:      p.competencia,
      nome_funcionario: p.nome,
      pagina:           p.pagina,
      enviar_zapsign:   true,
    }
  })

  esconderLoading()

  if (res && res.ok) {
    paginasFracionadas[idx].status  = 'enviado'
    paginasFracionadas[idx].signUrl = res.data.sign_url || ''

    // Atualiza card
    document.getElementById('status-pag-' + idx).innerHTML = badge('Pendente')
    btn.textContent = '✅ Enviado'
    btn.style.background = '#4CAF50'

    // Mostra link de assinatura
    if (res.data.sign_url) {
      const linkBtn = document.getElementById('link-btn-' + idx)
      linkBtn.href = res.data.sign_url
      linkBtn.style.display = 'inline-flex'
      // Botão WhatsApp direto
      const waUrl = 'https://wa.me/55' + p.telefone.replace(/\D/g,'') + '?text=' + encodeURIComponent('Olá ' + p.nome.split(' ')[0] + ', por favor assine seu holerite: ' + res.data.sign_url)
      const actions = document.getElementById('actions-' + idx)
      actions.innerHTML += `<a href="${waUrl}" target="_blank" style="background:#25D366;color:white;border-radius:8px;padding:8px 10px;font-size:11px;text-decoration:none;font-weight:bold">💬 WA</a>`
    }

    toast('✅ ' + p.nome.split(' ')[0] + ' — enviado via WhatsApp!', 'sucesso')
    carregarEntregasFolha()
  } else {
    btn.disabled = false; btn.textContent = '📲 Enviar WhatsApp + ZapSign'
    toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
  }
}

async function enviarTodasPendentes() {
  const pendentes = paginasFracionadas.filter(p => p.funcId && p.status === 'pronto')
  if (!pendentes.length) return toast('⚠️ Selecione os funcionários de cada página primeiro', 'erro')
  for (let i = 0; i < paginasFracionadas.length; i++) {
    if (paginasFracionadas[i].funcId && paginasFracionadas[i].status === 'pronto') {
      await enviarPaginaZapSign(i)
    }
  }
}

// ─── UTILITÁRIOS ─────────────────────────────────────────────────
function preencherSelectsFuncionarios() {
  ;['sel-func-epi'].forEach(id => {
    const sel = document.getElementById(id); if (!sel) return
    sel.innerHTML = '<option value="">Selecione...</option>'
    funcionarios.forEach(f => { sel.innerHTML += `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>` })
  })
}

function arrayBufferToBase64(buffer) {
  let binary = ''; const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function badge(status) {
  const map = {
    '✅ VIGENTE':'badge-verde','⚠️ A VENCER':'badge-amarelo','⛔ VENCIDO':'badge-vermelho',
    '⏳ PENDENTE':'badge-cinza','Ativo':'badge-verde','Inativo':'badge-vermelho',
    'Sim':'badge-verde','Não':'badge-cinza','Pendente':'badge-amarelo',
    'Assinado':'badge-verde','Salvo':'badge-azul','pronto':'badge-cinza',
    'enviado':'badge-verde','✅ OK':'badge-verde','⚠️ REPOR':'badge-amarelo',
    '⛔ SEM ESTOQUE':'badge-vermelho',
  }
  return `<span class="badge ${map[status]||'badge-cinza'}">${status||'—'}</span>`
}

function toast(msg, tipo) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'toast ' + (tipo||'')
  el.style.display = 'block'
  setTimeout(() => el.style.display = 'none', 5000)
}

function mostrarLoading(msg) {
  document.getElementById('loading-msg').textContent = msg||'Carregando...'
  document.getElementById('loading').style.display = 'flex'
}
function esconderLoading() { document.getElementById('loading').style.display = 'none' }
