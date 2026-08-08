// ── Histórico de erros do app (guardado localmente p/ a aba Diagnóstico) ──
const ERR_LOG_KEY = 'sst_err_log'
function registrarErroLocal(tipo, msg, extra) {
  try {
    const lista = JSON.parse(localStorage.getItem(ERR_LOG_KEY) || '[]')
    lista.unshift({ quando: new Date().toLocaleString('pt-BR'), tipo, msg: String(msg || '').slice(0, 300), extra: String(extra || '').slice(0, 200) })
    localStorage.setItem(ERR_LOG_KEY, JSON.stringify(lista.slice(0, 50)))
  } catch (e) {}
}
function lerErrosLocais() { try { return JSON.parse(localStorage.getItem(ERR_LOG_KEY) || '[]') } catch (e) { return [] } }
function limparErrosLocais() { try { localStorage.removeItem(ERR_LOG_KEY) } catch (e) {} renderDiagnostico() }

// Captura erros JS não tratados: console + histórico local (sem expor ao usuário)
window.onerror = function(msg, src, linha, col, err) {
  registrarErroLocal('JS', msg, src ? src.split('/').pop() + ':' + linha : '')
  console.error('ERRO GLOBAL:', msg, src, linha, col, err)
  return false
}
window.addEventListener('unhandledrejection', e => {
  const r = e.reason
  registrarErroLocal('Promise', (r && r.message) || String(r), (r && r.stack ? String(r.stack).split('\n')[1] : '') || '')
  console.error('PROMISE REJEITADA:', r)
})

let motivoEpiSelecionado = 'Admissional'

function selecionarMotivo(btn, motivo) {
  motivoEpiSelecionado = motivo
  document.querySelectorAll('.motivo-chip').forEach(b => b.classList.remove('ativo'))
  btn.classList.add('ativo')
}


const EPI_SUGERIDOS_PERFIL = {
  CASEIRO_AGROPECUARIO:        ['EPI-006','EPI-007','EPI-014','EPI-015'],
  OPERADOR_MAQUINAS_AGRICOLAS: ['EPI-001','EPI-003','EPI-006','EPI-007','EPI-002'],
  PULVERIZACAO_AGRICOLA:       ['EPI-001','EPI-004','EPI-005','EPI-009','EPI-010','EPI-002'],
  MOTORISTA_LOGISTICA:         ['EPI-001','EPI-003','EPI-002','EPI-006'],
  COZINHA:                     ['EPI-005','EPI-015','EPI-002'],
  LIDER_OPERACIONAL:           ['EPI-001','EPI-006','EPI-007','EPI-003'],
  ADMINISTRATIVO:              ['EPI-002','EPI-014'],
  ARMAZEM_ABASTECIMENTO:       ['EPI-001','EPI-003','EPI-004','EPI-006','EPI-007'],
  BIOFABRICA:                  ['EPI-004','EPI-005','EPI-010','EPI-002'],
}

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxZAoTs9hTLs3LbOgjGKPiytHTEP6N0O34WpUHUYPRaFh5yKS6P6gXNRS9dMLlmHLtW/exec'
const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'

let USUARIO = null, SENHA_ADM = null
let funcionarios = [], estoque = [], itensEpiSel = []
let funcEpiSelecionado = null
let paginaAtual = 'inicio', todosExames = []
let paginasFracionadas = []
// Páginas do PDF de ponto, ainda soltas. Viram anexo da folha do mesmo
// funcionário no parearPonto() — o que sobrar sem par vira card próprio.
let paginasPonto = []
// FIX #3: tipoDocAtual agora é atualizado pelos radio buttons via setTipoDoc()
let tipoDocAtual = 'Folha'

// FIX #3: função chamada pelos radio buttons no index.html
function setTipoDoc(valor) {
  tipoDocAtual = valor
  const label = document.getElementById('tipo-doc-label')
  const nomes = { Ponto: 'Folha de Ponto', Ferias: 'Folha de Férias', Folha: 'Folha de Pagamento' }
  if (label) label.textContent = (nomes[valor] || 'Folha de Pagamento') + ' selecionada'
}

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
    USUARIO = usuario; SENHA_ADM = senha; entrarNoApp()
  }

  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault()
    const usuario = document.getElementById('login-user').value.trim()
    const senha   = document.getElementById('login-senha').value
    const btn     = document.getElementById('btn-login')
    btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Entrando...'
    document.getElementById('login-erro').style.display = 'none'
    const res = await chamarGAS({ acao: 'listar_funcionarios', usuario, senha })
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-login"></i> Entrar'
    if (res && res.ok) {
      USUARIO = usuario; SENHA_ADM = senha
      sessionStorage.setItem('sst_user', JSON.stringify({ usuario, senha }))
      funcionarios = res.data; entrarNoApp()
    } else {
      const el = document.getElementById('login-erro')
      el.textContent = '⚠️ ' + ((res && res.erro) || 'Usuário ou senha incorretos')
      el.style.display = 'block'
    }
  })

  document.getElementById('form-funcionario').addEventListener('submit', salvarFuncionario)

  document.getElementById('input-pdf-frac').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return
    // FIX #1: passa file.name (string) em vez do elemento
    mostrarPdfSelecionado(file.name)
    const preview = document.getElementById('frac-preview') || document.getElementById('pdf-selecionado')
    if (preview) { preview.style.display = 'block'; preview.textContent = '⏳ Lendo PDF...' }
    try {
      const PDFLib = await carregarPdfLib()
      const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
      const total  = pdfDoc.getPageCount()
      if (preview) preview.innerHTML = '<i class="ti ti-file-check" style="vertical-align:-2px"></i> ' + total + ' página(s) — 1 funcionário por página'
    } catch(err) { if (preview) preview.textContent = '❌ Erro: ' + err.message }
  })

  const inputPonto = document.getElementById('input-pdf-ponto')
  if (inputPonto) inputPonto.addEventListener('change', async e => {
    const file = e.target.files[0]
    const el = document.getElementById('ponto-selecionado')
    if (!el) return
    if (!file) { el.style.display = 'none'; return }
    el.style.display = 'block'
    el.textContent = '⏳ Lendo o ponto...'
    try {
      const PDFLib = await carregarPdfLib()
      const doc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
      el.innerHTML = '<i class="ti ti-paperclip" style="vertical-align:-2px"></i> '
        + file.name + ' — ' + doc.getPageCount() + ' página(s) para juntar na folha'
    } catch(err) { el.textContent = '❌ Erro: ' + err.message }
  })
})

function entrarNoApp() {
  document.getElementById('tela-login').style.display = 'none'
  aplicarTemaInicial()
  // Limpa o display inline em vez de fixar 'flex': assim o CSS decide o
  // layout (coluna flex no mobile, grid com barra lateral no desktop).
  document.getElementById('tela-app').style.display   = ''
  preencherMesesFracionar()
  preencherSelectsOcultos()
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
      toast('✅ ' + d.atualizados + ' atualizada(s)!', 'sucesso')
      if (paginaAtual === 'epi') carregarEpi()
      if (paginaAtual === 'fracionar') carregarEntregasFolha()
    } else { toast(d.verificados === 0 ? 'Nenhum pendente' : '🔄 ' + d.pendentes + ' aguardando', '') }
    // Sempre recarrega o painel: o ↻ é a forma de recuperar os números quando
    // o carregamento inicial falhou, não só quando houve assinatura nova.
    carregarDashboard()
    // O empregador pode ter pago pelo celular, fora do app. O ↻ é o momento
    // em que a lista de "aguardando" tem chance de encolher.
    if (paginaAtual === 'pagamento') {
      carregarNotifPendentes()
      if (funcPgtoSelecionado) carregarHistoricoPagamentos()
    }
  } else { toast('❌ Erro na sincronização', 'erro') }
}

// ── TEMA ────────────────────────────────────────────────────────
aplicarTemaInicial()

// ── TEMA ────────────────────────────────────────────────────────
function toggleTema() {
  const escuro = document.documentElement.getAttribute('data-tema') === 'escuro'
  document.documentElement.setAttribute('data-tema', escuro ? 'claro' : 'escuro')
  const btn = document.getElementById('btn-tema')
  if (btn) btn.innerHTML = escuro ? '<i class="ti ti-moon"></i>' : '<i class="ti ti-sun"></i>'
  localStorage.setItem('sst-tema', escuro ? 'claro' : 'escuro')
}
function aplicarTemaInicial() {
  const tema = localStorage.getItem('sst-tema') || 'claro'
  document.documentElement.setAttribute('data-tema', tema)
  const btn = document.getElementById('btn-tema')
  if (btn) btn.innerHTML = tema === 'escuro' ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>'
}

// ── BUSCA GLOBAL ─────────────────────────────────────────────────
function toggleBusca() {
  const c = document.getElementById('busca-global-container')
  const visivel = c.style.display !== 'none'
  c.style.display = visivel ? 'none' : 'block'
  if (!visivel) setTimeout(() => document.getElementById('inp-busca-global').focus(), 50)
  else document.getElementById('busca-resultados').style.display = 'none'
}
function fecharBusca() {
  const c = document.getElementById('busca-global-container')
  if (c) c.style.display = 'none'
  const r = document.getElementById('busca-resultados')
  if (r) r.style.display = 'none'
  const i = document.getElementById('inp-busca-global')
  if (i) i.value = ''
}

// FIX #8: busca global expandida para funcionários, folhas e EPIs
function buscaGlobal(q) {
  const el = document.getElementById('busca-resultados')
  if (!q || q.length < 2) { el.style.display = 'none'; return }
  const ql = q.toLowerCase()
  const resultados = []

  // Funcionários
  funcionarios.filter(f => (f['NOME_COMPLETO']||'').toLowerCase().includes(ql)).slice(0,4).forEach(f => {
    resultados.push({ tipo:'Funcionário', label:f['NOME_COMPLETO'], sub:(f['FUNCAO']||'')+'·'+(f['UNIDADE']||''), bg:'var(--verde-claro)', cor:'var(--verde-text)', action:()=>abrirFicha(f['ID']) })
  })

  // EPIs em estoque
  estoque.filter(e => (e['DESCRIÇÃO DO EPI']||'').toLowerCase().includes(ql)).slice(0,3).forEach(e => {
    resultados.push({ tipo:'EPI', label:e['DESCRIÇÃO DO EPI'], sub:'CA '+( e['Nº CA']||'—')+' · Estoque: '+(e['ESTOQUE ATUAL']||0), bg:'var(--coral-bg)', cor:'var(--coral-text)', action:()=>irPara('epi') })
  })

  if (!resultados.length) { el.innerHTML='<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-hint)">Sem resultados</div>'; el.style.display='block'; return }
  window._buscaActions = resultados.map(r => () => { fecharBusca(); r.action() })
  el.innerHTML = resultados.map((r,i) => `
    <div class="busca-item" onclick="window._buscaActions[${i}]()">
      <span class="busca-item-tipo" style="background:${r.bg};color:${r.cor}">${r.tipo}</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div><div style="font-size:11px;color:var(--text-secondary)">${esc(r.sub)}</div></div>
      <i class="ti ti-arrow-right" style="color:var(--text-hint);font-size:14px"></i>
    </div>`).join('')
  el.style.display = 'block'
}

// ── FICHA FUNCIONÁRIO ────────────────────────────────────────────
let fichaFuncId = null
function abrirFicha(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  fichaFuncId = String(funcId)
  document.getElementById('ficha-av').textContent   = getIniciais(func['NOME_COMPLETO'])
  document.getElementById('ficha-nome').textContent = func['NOME_COMPLETO']
  document.getElementById('ficha-sub').textContent  = (func['FUNCAO']||'—')+' · '+(func['UNIDADE']||'—')
  irPara('ficha-func')
  // Reseta tabs
  document.querySelectorAll('.ficha-tab').forEach((t,i) => t.classList.toggle('ativo', i===0))
  document.querySelectorAll('.ficha-painel').forEach((p,i) => p.classList.toggle('ativo', i===0))
  renderFichaGeral(func)
}
function abrirFichaTab(tab, btn) {
  document.querySelectorAll('.ficha-tab').forEach(t => t.classList.remove('ativo'))
  document.querySelectorAll('.ficha-painel').forEach(p => p.classList.remove('ativo'))
  btn.classList.add('ativo')
  const painel = document.getElementById('ficha-painel-' + tab)
  if (painel) painel.classList.add('ativo')
  if (tab === 'exames')     renderFichaExames()
  if (tab === 'epi')        renderFichaEpi()
  if (tab === 'folhas')     renderFichaFolhas()
  if (tab === 'pagamentos') renderFichaPagamentos()
}
function renderFichaGeral(func) {
  const el = document.getElementById('ficha-painel-geral')
  if (!el) return
  const campos = [
    ['CPF',func['CPF']],['RG',func['RG']],['Nascimento',func['DATA_NASCIMENTO']],
    ['Admissão',func['DATA_ADMISSAO']],['WhatsApp',func['TELEFONE']],
    ['Banco',func['BANCO']],['Agência',func['AGENCIA']],['Conta',func['CONTA']],['PIX',func['PIX']],
    ['Salário base',func['SALARIO_BASE']?'R$ '+formatarValor(func['SALARIO_BASE']):''],
    ['Comissão anual',func['COMISSAO_ANUAL']?'R$ '+formatarValor(func['COMISSAO_ANUAL']):''],
  ].filter(([,v]) => v)
  el.innerHTML = `
    <div class="card" style="margin-bottom:8px">
      <div class="card-titulo"><i class="ti ti-id-badge"></i> Dados cadastrais</div>
      ${campos.map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border);font-size:12px"><span style="color:var(--text-secondary)">${esc(k)}</span><span style="font-weight:600;max-width:60%;text-align:right">${esc(v)}</span></div>`).join('')}
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="editarFuncionario('${func['ID']}')" class="btn-primario" style="flex:1;font-size:12px"><i class="ti ti-pencil"></i> Editar</button>
      <a href="https://wa.me/${telWhats(func['TELEFONE'])}" target="_blank" style="flex:1;background:#22C55E;color:#fff;border-radius:var(--radius-md);padding:12px;font-size:12px;font-weight:700;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px"><i class="ti ti-brand-whatsapp"></i> WhatsApp</a>
    </div>`
}
async function renderFichaExames() {
  const el = document.getElementById('ficha-painel-exames')
  el.innerHTML = '<p class="lista-vazia">Carregando...</p>'
  const res = await chamarGAS({ acao: 'listar_exames_func', dados: { func_id: fichaFuncId } })
  const lista = res?.ok ? res.data : []
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum exame</p>'; return }
  el.innerHTML = lista.map(e => `<div class="lista-item" style="margin-bottom:6px"><div class="lista-item-info"><div class="lista-item-nome">${esc(e['TIPO_EXAME']||'—')}</div><div class="lista-item-sub">${esc(e['DATA_VENCIMENTO']||'')}</div></div><span class="badge ${e['STATUS']==='Vencido'?'badge-vermelho':e['STATUS']==='A vencer'?'badge-amarelo':'badge-verde'}">${esc(e['STATUS']||'—')}</span></div>`).join('')
}
async function renderFichaEpi() {
  const el = document.getElementById('ficha-painel-epi')
  el.innerHTML = '<p class="lista-vazia">Carregando...</p>'
  const res = await chamarGAS({ acao: 'listar_epi_entregas', dados: { func_id: fichaFuncId } })
  const lista = res?.ok ? res.data : []
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega</p>'; return }
  el.innerHTML = lista.slice(0,15).map(e => `<div class="lista-item" style="margin-bottom:6px"><div class="lista-item-info"><div class="lista-item-nome">${esc(e['ITENS']||e['EPI']||'—')}</div><div class="lista-item-sub">${esc(e['DATA_ENTREGA']||'')}</div></div><span class="badge ${e['STATUS_ASSINATURA']==='Assinado'?'badge-verde':'badge-amarelo'}">${esc(e['STATUS_ASSINATURA']||'Pendente')}</span></div>`).join('')
}
async function renderFichaFolhas() {
  const el = document.getElementById('ficha-painel-folhas')
  el.innerHTML = '<p class="lista-vazia">Carregando...</p>'
  const res = await chamarGAS({ acao: 'listar_folhas' })
  const lista = (res?.ok ? res.data : []).filter(f => String(f['ID FUNC.']) === fichaFuncId)
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma folha</p>'; return }
  el.innerHTML = lista.map(f => `<div class="lista-item" style="margin-bottom:6px"><div class="lista-item-info"><div class="lista-item-nome">${normalizarComp(f['COMPETÊNCIA']||'')}</div><div class="lista-item-sub">${f['DATA ENVIO']||''}</div></div><span class="badge ${f['STATUS']==='Assinado'?'badge-verde':'badge-amarelo'}">${f['STATUS']||'—'}</span></div>`).join('')
}
async function renderFichaPagamentos() {
  const el = document.getElementById('ficha-painel-pagamentos')
  el.innerHTML = '<p class="lista-vazia">Carregando...</p>'
  const res = await chamarGAS({ acao: 'listar_pagamentos', dados: { func_id: fichaFuncId } })
  const lista = res?.ok ? res.data : []
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum pagamento</p>'; return }
  el.innerHTML = lista.map(p => `<div class="lista-item" style="margin-bottom:6px"><div class="lista-item-info"><div class="lista-item-nome">${normalizarComp(p['COMPETENCIA']||'')}${p['VALOR_LIQUIDO']?' · R$ '+formatarValor(p['VALOR_LIQUIDO']):''}</div><div class="lista-item-sub">${p['DATA_GERACAO']||''}</div></div><span class="badge ${p['STATUS']==='Pago'?'badge-verde':'badge-amarelo'}">${p['STATUS']||'—'}</span></div>`).join('')
}

// ── PENDÊNCIAS DO DIA ────────────────────────────────────────────
// FIX #6: renderPendencias agora recebe dados reais do carregarDashboard, não lê do DOM
function renderPendencias(dados) {
  const card  = document.getElementById('card-pendencias')
  const lista = document.getElementById('lista-pendencias')
  if (!card || !lista || !dados) return
  const ps = []
  if ((dados.examesVencidos||0) > 0)   ps.push({u:'urgente', t:`${dados.examesVencidos} exame(s) vencido(s)`, a:()=>irPara('exames')})
  if ((dados.examesAVencer||0) > 0)    ps.push({u:'atencao', t:`${dados.examesAVencer} exame(s) vencendo em breve`, a:()=>irPara('exames')})
  if ((dados.epiRepor||0) > 0)         ps.push({u:'atencao', t:`${dados.epiRepor} EPI(s) para repor`, a:()=>irPara('epi')})
  if ((dados.folhasPendentes||0) > 0)  ps.push({u:'info', t:`${dados.folhasPendentes} folha(s) aguardando assinatura`, a:()=>irPara('fracionar')})
  if ((dados.pagtosPendentes||0) > 0)  ps.push({u:'urgente', t:`${dados.pagtosPendentes} pagamento(s) aguardando`, a:()=>irPara('pagamento')})
  if (!ps.length) { card.style.display='none'; return }
  card.style.display = 'block'
  window._pendenciaActions = ps.map(p => p.a)
  lista.innerHTML = ps.map((p,i)=>`
    <div class="pendencia-item" onclick="window._pendenciaActions[${i}]()">
      <div class="pendencia-dot ${p.u}"></div>
      <div style="flex:1;font-size:12px;font-weight:500">${p.t}</div>
      <i class="ti ti-chevron-right" style="color:var(--text-hint);font-size:13px"></i>
    </div>`).join('')
}

// ── LOG DE AUDITORIA ─────────────────────────────────────────────
let logCache = []

async function carregarLog() {
  mostrarLoading('Carregando log...')
  const res = await chamarGAS({ acao: 'listar_log' })
  esconderLoading()
  logCache = res?.ok ? res.data : []
  renderLog(logCache)
  const sel = document.getElementById('sel-log-usuario')
  if (sel) {
    const usuarios = [...new Set(logCache.map(l => l['USUARIO']).filter(Boolean))]
    sel.innerHTML = '<option value="">Todos</option>' + usuarios.map(u=>`<option>${esc(u)}</option>`).join('')
    sel.onchange = filtrarLog
  }
}
function filtrarLog() {
  const u = document.getElementById('sel-log-usuario')?.value||''
  const b = (document.getElementById('inp-log-busca')?.value||'').toLowerCase()
  renderLog(logCache.filter(l => (!u||l['USUARIO']===u) && (!b||JSON.stringify(l).toLowerCase().includes(b))))
}
function renderLog(lista) {
  const el = document.getElementById('lista-log')
  if (!el) return
  if (!lista.length) { el.innerHTML='<p class="lista-vazia">Nenhum registro</p>'; return }
  el.innerHTML = lista.slice(0,60).map(l=>`
    <div class="log-item">
      <div class="log-acao">${esc(l['ACAO']||'—')}</div>
      <div class="log-detalhe">${esc(l['DETALHE']||l['DETALHES']||'')}</div>
      <div class="log-meta">${esc(l['USUARIO']||'—')} · ${esc(l['DATA_HORA']||'')}</div>
    </div>`).join('')
}

const TITULOS = {
  'inicio':'Início','lista-func':'Pessoal','novo-func':'Novo Funcionário',
  'ficha-func':'Ficha do Funcionário',
  'exames':'Exames','epi':'EPI','fracionar':'Folha de Pagamento',
  'pagamento':'Controle de Pagamento',
  'log':'Log de Auditoria',
  'diagnostico':'Diagnóstico',
  'calendario':'Calendário de Férias',
}

function irPara(pg) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('ativo'))
  const pgEl = document.getElementById('pg-' + pg); if (pgEl) pgEl.classList.add('ativa')
  const nav = document.querySelector('[data-pg="' + pg + '"]'); if (nav) nav.classList.add('ativo')
  document.getElementById('titulo-pagina').textContent = TITULOS[pg] || ''
  paginaAtual = pg
  if (pg === 'lista-func') carregarFuncionarios()
  if (pg === 'exames')     carregarExames()
  if (pg === 'epi')        carregarEpi()
  if (pg === 'fracionar')  { preencherMesesFracionar(); carregarEntregasFolha() }
  if (pg === 'pagamento')  iniciarPagamento()
  if (pg === 'log')        carregarLog()
  if (pg === 'diagnostico') renderDiagnostico()
  if (pg === 'calendario') carregarCalendario()
}

// ─── CALENDÁRIO DE FÉRIAS ────────────────────────────────────────
let feriasCache = []
let calMes = new Date().getMonth(), calAno = new Date().getFullYear()

function parseDataCal(s) {
  if (!s) return null
  s = String(s).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  let b = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (b) return new Date(+b[3], +b[2] - 1, +b[1])
  let d = new Date(s); return isNaN(d) ? null : d
}
async function carregarCalendario() {
  mostrarLoading('Carregando férias...')
  const res = await chamarGAS({ acao: 'listar_ferias' })
  esconderLoading()
  feriasCache = (res && res.ok && Array.isArray(res.data)) ? res.data : []
  const hoje = new Date(); calMes = hoje.getMonth(); calAno = hoje.getFullYear()
  const sel = document.getElementById('cal-unidade')
  if (sel) {
    const unidades = [...new Set(funcionarios.map(f => f['UNIDADE']).filter(Boolean))]
    const atual = sel.value
    sel.innerHTML = '<option value="">Todas as unidades</option>' + unidades.map(u => `<option${u === atual ? ' selected' : ''}>${esc(u)}</option>`).join('')
  }
  renderCalendario()
}
let calUnidade = ''
function filtrarCal() {
  calUnidade = document.getElementById('cal-unidade')?.value || ''
  renderCalendario()
}
// Só o filtro de unidade — é a base do resumo, que não deve encolher quando o
// usuário filtra a lista por status.
function feriasPorUnidade() {
  if (!calUnidade) return feriasCache
  return feriasCache.filter(f => {
    const func = funcionarios.find(x => String(x['ID']) === String(f['ID_FUNC']))
    return func && func['UNIDADE'] === calUnidade
  })
}
let filtroFeriasStatus = ''
function feriasFiltradas() {
  const base = feriasPorUnidade()
  if (!filtroFeriasStatus) return base
  return base.filter(f => (f['STATUS'] || 'Pendente') === filtroFeriasStatus)
}
function setFiltroFerias(v) {
  filtroFeriasStatus = v || ''
  const sel = document.getElementById('cal-status')
  if (sel && sel.value !== filtroFeriasStatus) sel.value = filtroFeriasStatus
  renderCalendario()
}

const soDataCal = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const hojeCal   = () => soDataCal(new Date())

function renderResumoFerias() {
  const h0 = hojeCal()
  const em30 = new Date(h0); em30.setDate(em30.getDate() + 30)
  const regs = feriasPorUnidade()
    .map(f => ({ status: f['STATUS'] || 'Pendente', ini: parseDataCal(f['INICIO']), fim: parseDataCal(f['FIM'] || f['INICIO']) }))
    .filter(r => r.ini)
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('fer-hoje', regs.filter(r => h0 >= soDataCal(r.ini) && h0 <= soDataCal(r.fim || r.ini)).length)
  set('fer-pend', regs.filter(r => r.status !== 'Assinado').length)
  set('fer-prox', regs.filter(r => soDataCal(r.ini) > h0 && soDataCal(r.ini) <= em30).length)
}

function mudarMesCal(delta) {
  if (calView === 'ano') { calAno += delta; renderCalendario(); return }
  calMes += delta
  if (calMes < 0) { calMes = 11; calAno-- }
  if (calMes > 11) { calMes = 0; calAno++ }
  renderCalendario()
}
function renderCalendario() {
  const lbl = document.getElementById('cal-mes-label')
  const lista = document.getElementById('cal-lista')
  if (!lbl) return
  lbl.textContent = calView === 'ano' ? String(calAno) : (MESES[calMes] + ' ' + calAno)

  const periodos = feriasFiltradas().map(f => ({
    nome: f['NOME_FUNC'] || '', status: f['STATUS'] || 'Pendente', token: f['REF_TOKEN'] || '',
    ini: parseDataCal(f['INICIO']), fim: parseDataCal(f['FIM'] || f['INICIO'])
  })).filter(p => p.ini)

  // As simulações entram junto: são o ponto do planejamento, e por isso não
  // somem quando o filtro de status está ligado.
  const todos = periodos.concat(simulacoesVisiveis())
  renderMesGoogle(todos)
  if (calView === 'plano') renderPlanejamento()

  if (lista) {
    const mIni = new Date(calAno, calMes, 1), mFim = new Date(calAno, calMes + 1, 0)
    const doMes = periodos.filter(p => p.fim >= mIni && p.ini <= mFim).sort((a, b) => a.ini - b.ini)
    if (!doMes.length) lista.innerHTML = `<p class="lista-vazia">Nenhuma férias neste mês${filtroFeriasStatus ? ' com o filtro "' + esc(filtroFeriasStatus) + '"' : ''}</p>`
    else {
      const h0 = hojeCal()
      lista.innerHTML = doMes.map(p => {
        const ini = soDataCal(p.ini), fim = soDataCal(p.fim || p.ini)
        const dias = Math.round((fim - ini) / 86400000) + 1
        let sit, sitCor
        if (h0 < ini)      { sit = 'Faltam ' + Math.round((ini - h0) / 86400000) + ' dia(s)'; sitCor = 'var(--blue-text)' }
        else if (h0 > fim) { sit = 'Concluída';  sitCor = 'var(--text-hint)' }
        else               { sit = 'Em curso';   sitCor = 'var(--verde-text)' }
        return `
      <div class="lista-item" style="margin-bottom:6px;cursor:pointer" onclick="editarFerias('${esc(p.token)}')">
        <div class="avatar" style="background:var(--verde-claro);color:var(--verde-text)">${getIniciais(p.nome || '?')}</div>
        <div class="lista-item-info">
          <div class="lista-item-nome">${esc(p.nome)}</div>
          <div class="lista-item-sub">${p.ini.toLocaleDateString('pt-BR')} → ${p.fim.toLocaleDateString('pt-BR')} · ${dias} dia(s)</div>
          <div style="font-size:10px;font-weight:600;color:${sitCor};margin-top:2px">${sit}</div>
        </div>
        <span class="badge ${p.status === 'Assinado' ? 'badge-verde' : p.status === 'Planejado' ? 'badge-azul' : 'badge-amarelo'}">${esc(p.status)}</span>
      </div>`
      }).join('')
    }
  }
  renderResumoFerias()
  renderAno()
}

// ── Visão de mês estilo Google Agenda ─────────────────────────────
// Cada período vira uma faixa contínua que atravessa os dias e quebra a cada
// semana. Dentro da semana as faixas são empilhadas em trilhas para não se
// sobreporem, e a altura da linha acompanha o número de trilhas.
const DOWS_CAL = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// Cor/estilo da faixa conforme o estágio do período
function classeStatusFerias(s) {
  return s === 'Assinado'  ? ''
       : s === 'Simulado'  ? ' simulado'
       : s === 'Planejado' ? ' planejado'
       : ' pendente'
}
function corStatusFerias(s) {
  return s === 'Assinado'  ? 'var(--verde)'
       : s === 'Planejado' ? 'var(--blue-text)'
       : s === 'Simulado'  ? 'var(--purple-text)'
       : 'var(--amber-text)'
}
function simulacoesVisiveis() {
  return simulacoes
    .filter(s => {
      if (!calUnidade) return true
      const f = funcionarios.find(x => String(x['ID']) === String(s.funcId))
      return f && f['UNIDADE'] === calUnidade
    })
    .map(s => ({ nome: s.nome, status: 'Simulado', token: s.id, ini: s.ini, fim: s.fim }))
}

function renderMesGoogle(periodos) {
  const el = document.getElementById('cal-mes'); if (!el) return
  const DIA = 86400000
  const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

  const primeiro = new Date(calAno, calMes, 1)
  const ultimo   = new Date(calAno, calMes + 1, 0)
  const inicio   = somaDias(primeiro, -primeiro.getDay())          // domingo da 1ª semana
  const fimGrade = somaDias(ultimo, 6 - ultimo.getDay())           // sábado da última
  // fimGrade é o ÚLTIMO dia da grade, não o início da última semana: por isso
  // conta-se o dia dele antes de dividir, senão sobra uma semana vazia no fim.
  const semanas  = Math.round(((fimGrade - inicio) / DIA + 1) / 7)
  const hoje     = hojeCal()

  const eventos = periodos.map(p => ({
    nome: p.nome, status: p.status, token: p.token,
    ini: soDataCal(p.ini), fim: soDataCal(p.fim || p.ini),
  }))

  let html = '<div class="gc-dows">' + DOWS_CAL.map(d => `<div class="gc-dow">${d}</div>`).join('') + '</div>'

  for (let s = 0; s < semanas; s++) {
    const semIni = somaDias(inicio, s * 7)
    const semFim = somaDias(semIni, 6)

    // Mais longos primeiro: as faixas grandes ficam nas trilhas de cima.
    const daSemana = eventos
      .filter(e => e.fim >= semIni && e.ini <= semFim)
      .sort((a, b) => (a.ini - b.ini) || ((b.fim - b.ini) - (a.fim - a.ini)))

    const trilhas = []
    daSemana.forEach(e => {
      const c0 = Math.max(0, Math.round((e.ini - semIni) / DIA))
      const c1 = Math.min(6, Math.round((e.fim - semIni) / DIA))
      let t = trilhas.findIndex(tr => tr.every(x => c1 < x.c0 || c0 > x.c1))
      if (t === -1) { trilhas.push([]); t = trilhas.length - 1 }
      trilhas[t].push({ ...e, c0, c1 })
    })

    const altura = Math.max(84, 32 + trilhas.length * 22)
    let dias = ''
    for (let d = 0; d < 7; d++) {
      const data = somaDias(semIni, d)
      const fora = data.getMonth() !== calMes
      const eHoje = data.getTime() === hoje.getTime()
      dias += `<div class="gc-day${fora ? ' fora' : ''}${eHoje ? ' hoje' : ''}" style="min-height:${altura}px">`
            + `<div class="gc-daynum">${data.getDate()}</div></div>`
    }

    const lanes = trilhas.map(tr => '<div class="gc-lane">' + tr.map(e => {
      const cls = 'gc-chip' + classeStatusFerias(e.status)
                + (e.ini < semIni ? ' cont-ini' : '') + (e.fim > semFim ? ' cont-fim' : '')
      const dica = e.nome + ' · ' + e.ini.toLocaleDateString('pt-BR') + ' → ' + e.fim.toLocaleDateString('pt-BR')
      return `<div class="${cls}" style="grid-column:${e.c0 + 1}/span ${e.c1 - e.c0 + 1}"`
           + ` title="${esc(dica)}" onclick="editarFerias('${esc(e.token)}')">${esc(e.nome)}</div>`
    }).join('') + '</div>').join('')

    html += `<div class="gc-week"><div class="gc-days">${dias}</div><div class="gc-lanes">${lanes}</div></div>`
  }
  el.innerHTML = html
}

function irHojeCal() {
  const h = new Date(); calMes = h.getMonth(); calAno = h.getFullYear()
  renderCalendario()
}

let calView = 'grid'
function setCalView(v) {
  calView = v
  const alvos = { grid: 'cal-mes', ano: 'cal-ano', plano: 'cal-plano' }
  Object.entries(alvos).forEach(([val, id]) => {
    const el = document.getElementById(id); if (el) el.style.display = v === val ? 'block' : 'none'
  })
  ;[['cal-tab-grid', 'grid'], ['cal-tab-ano', 'ano'], ['cal-tab-plano', 'plano']]
    .forEach(([id, val]) => { const b = document.getElementById(id); if (b) b.classList.toggle('ativo', v === val) })
  renderCalendario()
}

function renderAno() {
  const el = document.getElementById('cal-ano'); if (!el) return
  const anoIni = new Date(calAno, 0, 1), anoFim = new Date(calAno, 11, 31)
  const diasAno = ((calAno % 4 === 0 && calAno % 100 !== 0) || calAno % 400 === 0) ? 366 : 365
  const pct = d => Math.max(0, Math.min(diasAno, (( (d < anoIni ? anoIni : d) - anoIni) / 86400000))) / diasAno * 100
  const meses3 = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
  const header = '<div class="ano-row"><div class="ano-nome"></div><div class="ano-track ano-header">' + meses3.map(m => `<span>${m}</span>`).join('') + '</div></div>'
  const regs = feriasFiltradas().map(f => ({ nome: f['NOME_FUNC'] || '?', status: f['STATUS'] || 'Pendente', token: f['REF_TOKEN'] || '', ini: parseDataCal(f['INICIO']), fim: parseDataCal(f['FIM'] || f['INICIO']) }))
    .filter(r => r.ini && r.fim && r.fim >= anoIni && r.ini <= anoFim)
    .sort((a, b) => a.ini - b.ini)
  if (!regs.length) { el.innerHTML = header + '<p class="lista-vazia">Nenhuma férias em ' + calAno + '</p>'; return }
  el.innerHTML = header + regs.map(r => {
    const left = pct(r.ini)
    const width = Math.max(1.5, Math.min(100 - left, pct(r.fim) - left + (100 / diasAno)))
    const cor = corStatusFerias(r.status)
    return `<div class="ano-row" onclick="editarFerias('${esc(r.token)}')">
      <div class="ano-nome">${esc(r.nome)}</div>
      <div class="ano-track"><div class="ano-bar" style="left:${left}%;width:${width}%;background:${cor}"></div></div>
    </div>`
  }).join('')
}

// ═══════════════════════════════════════════════════════════════════
// PLANEJAMENTO / SIMULAÇÃO DE FÉRIAS
// Projeta os períodos do ano inteiro antes de emitir qualquer documento.
// As regras seguem a CLT: 30 dias por período aquisitivo (12 meses de
// trabalho), concessão até 12 meses depois sob pena de férias em dobro
// (art. 137), e fracionamento em até 3 períodos — um de no mínimo 14 dias
// e nenhum abaixo de 5 (art. 134 §1).
// ═══════════════════════════════════════════════════════════════════
let simulacoes = []          // períodos simulados, ainda não salvos
let seqSimulacao = 0

const DIA_MS = 86400000
const somaAnos  = (d, n) => new Date(d.getFullYear() + n, d.getMonth(), d.getDate())
const somaDiasD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const diasEntre = (a, b) => Math.round((soDataCal(b) - soDataCal(a)) / DIA_MS)
const fmtBR     = d => (d ? d.toLocaleDateString('pt-BR') : '—')
const isoDe     = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Períodos de um funcionário: os já registrados na planilha + os simulados
function periodosDoFunc(funcId) {
  const reg = feriasCache
    .filter(f => String(f['ID_FUNC']) === String(funcId))
    .map(f => ({ ini: parseDataCal(f['INICIO']), fim: parseDataCal(f['FIM'] || f['INICIO']),
                 status: f['STATUS'] || 'Pendente', token: f['REF_TOKEN'] || '' }))
    .filter(p => p.ini && p.fim)
  const sim = simulacoes.filter(s => String(s.funcId) === String(funcId))
    .map(s => ({ ini: s.ini, fim: s.fim, status: 'Simulado', token: s.id }))
  return reg.concat(sim)
}

// Situação do funcionário perante o direito a férias.
// Devolve o período aquisitivo mais antigo ainda não quitado — é o que
// manda no planejamento, porque é o que vence primeiro.
function situacaoFerias(func) {
  const adm = parseDataCal(func['DATA_ADMISSAO'])
  if (!adm) return { situacao: 'semdata', saldo: 0, usados: 0 }
  const hoje = hojeCal()
  const periodos = periodosDoFunc(func['ID'])

  let completos = 0
  while (somaAnos(adm, completos + 1) <= hoje) completos++

  if (completos === 0) {
    return { situacao: 'aquisitivo', admissao: adm, completaEm: somaAnos(adm, 1), saldo: 0, usados: 0 }
  }

  for (let k = 1; k <= completos; k++) {
    const iniConc = somaAnos(adm, k)                       // começa a contar o prazo de concessão
    const fimConc = somaDiasD(somaAnos(adm, k + 1), -1)    // limite legal para conceder
    const usados = periodos
      .filter(p => p.ini >= iniConc && p.ini <= fimConc)
      .reduce((s, p) => s + diasEntre(p.ini, p.fim) + 1, 0)
    if (usados < 30) {
      const restam = diasEntre(hoje, fimConc)
      return {
        situacao: restam < 0 ? 'vencido' : restam <= 90 ? 'urgente' : 'programar',
        admissao: adm, aquisitivoIni: somaAnos(adm, k - 1), aquisitivoFim: somaDiasD(iniConc, -1),
        concessivoIni: iniConc, limite: fimConc, usados, saldo: 30 - usados, restam,
      }
    }
  }
  return { situacao: 'emdia', admissao: adm, saldo: 0, usados: 30,
           completaEm: somaAnos(adm, completos + 1) }
}

const ROTULO_SIT = {
  vencido:    { txt: 'Vencido',        cls: 'br' },
  urgente:    { txt: 'Vence em breve', cls: 'ba' },
  programar:  { txt: 'A programar',    cls: 'bb' },
  emdia:      { txt: 'Em dia',         cls: 'bg' },
  aquisitivo: { txt: 'Aquisitivo',     cls: 'badge-cinza' },
  semdata:    { txt: 'Sem data',       cls: 'badge-cinza' },
}

// Confere um período contra as regras da CLT e contra a escala da equipe.
// `erros` impedem a simulação; `alertas` só avisam.
function validarSimulacao(func, ini, dias) {
  const erros = [], alertas = []
  const fim = somaDiasD(ini, dias - 1)
  const sit = situacaoFerias(func)

  if (dias < 5)  erros.push('Cada período precisa ter no mínimo 5 dias corridos (art. 134 §1).')
  if (dias > 30) erros.push('Um período não pode passar de 30 dias.')

  const meus = periodosDoFunc(func['ID'])
  if (meus.some(p => ini <= p.fim && fim >= p.ini))
    erros.push('Sobrepõe outro período já registrado para este funcionário.')

  if (sit.limite) {
    const noAno = meus.filter(p => p.ini >= sit.concessivoIni && p.ini <= sit.limite)
    if (noAno.length >= 3)
      erros.push('Já existem 3 períodos neste ciclo — o fracionamento permite no máximo 3 (art. 134 §1).')
    const duracoes = noAno.map(p => diasEntre(p.ini, p.fim) + 1).concat(dias)
    if (duracoes.length > 1 && !duracoes.some(d => d >= 14))
      alertas.push('Ao fracionar, um dos períodos precisa ter pelo menos 14 dias corridos.')
    if (fim > sit.limite)
      alertas.push('Termina depois do limite para conceder (' + fmtBR(sit.limite) + ') — risco de férias em dobro.')
  }

  // Art. 134 §3: não começar no repouso semanal nem nos 2 dias anteriores
  const dow = ini.getDay()
  if (dow === 0 || dow === 5 || dow === 6)
    alertas.push('Início em ' + DOWS_CAL[dow] + ': as férias não devem começar no descanso semanal nem nos 2 dias que o antecedem (art. 134 §3).')

  if (sit.saldo > 0 && dias > sit.saldo)
    alertas.push('Excede o saldo do ciclo: restam ' + sit.saldo + ' dia(s).')
  if (sit.situacao === 'aquisitivo')
    alertas.push('Período aquisitivo ainda em curso — completa em ' + fmtBR(sit.completaEm) + '.')
  if (sit.situacao === 'semdata')
    alertas.push('Funcionário sem data de admissão: não dá para conferir o período aquisitivo.')

  const unidade = func['UNIDADE'] || ''
  const juntos = funcionarios
    .filter(f => String(f['ID']) !== String(func['ID']) && (f['UNIDADE'] || '') === unidade)
    .filter(f => periodosDoFunc(f['ID']).some(p => ini <= p.fim && fim >= p.ini))
  if (juntos.length)
    alertas.push(juntos.length + ' da unidade ' + (unidade || '—') + ' fora no mesmo intervalo: '
      + juntos.map(f => String(f['NOME_COMPLETO'] || '').split(' ')[0]).join(', ') + '.')

  return { erros, alertas, fim }
}

function renderPlanejamento() {
  const el = document.getElementById('cal-plano'); if (!el) return
  const alvo = calUnidade ? funcionarios.filter(f => (f['UNIDADE'] || '') === calUnidade) : funcionarios
  const ativos = alvo.filter(f => (f['STATUS'] || 'Ativo') !== 'Inativo')

  if (!ativos.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário para planejar</p>'; return }

  const linhas = ativos.map(f => ({ f, s: situacaoFerias(f) }))
  const ordem = { vencido: 0, urgente: 1, programar: 2, aquisitivo: 3, emdia: 4, semdata: 5 }
  linhas.sort((a, b) => (ordem[a.s.situacao] - ordem[b.s.situacao])
                     || ((a.s.limite || 0) - (b.s.limite || 0)))

  const alerta = linhas.filter(l => l.s.situacao === 'vencido' || l.s.situacao === 'urgente').length

  el.innerHTML = `
    ${alerta ? `<div class="plano-aviso"><i class="ti ti-alert-triangle"></i>
        ${alerta} funcionário(s) com o prazo de concessão vencido ou perto de vencer — conceder fora do prazo obriga a pagar em dobro (CLT art. 137).</div>` : ''}
    <div class="plano-tabela">
      <div class="plano-linha plano-cab">
        <span>Funcionário</span><span>Aquisitivo</span><span>Conceder até</span><span>Saldo</span><span></span>
      </div>
      ${linhas.map(({ f, s }) => {
        const r = ROTULO_SIT[s.situacao] || ROTULO_SIT.programar
        const prazo = s.limite
          ? fmtBR(s.limite) + (s.restam < 0 ? ` <b class="plano-vencido">(${-s.restam}d atrás)</b>`
                                            : s.restam <= 90 ? ` <b class="plano-urgente">(${s.restam}d)</b>` : '')
          : s.completaEm ? 'completa em ' + fmtBR(s.completaEm) : '—'
        const aq = s.aquisitivoIni ? fmtBR(s.aquisitivoIni) + ' – ' + fmtBR(s.aquisitivoFim)
                 : s.admissao ? 'desde ' + fmtBR(s.admissao) : '—'
        return `<div class="plano-linha">
          <span class="plano-nome">${esc(f['NOME_COMPLETO'] || '')}
            <em>${esc(f['FUNCAO'] || '')}${f['UNIDADE'] ? ' · ' + esc(f['UNIDADE']) : ''}</em></span>
          <span class="plano-sec">${aq}</span>
          <span class="plano-sec">${prazo}</span>
          <span><span class="badge ${r.cls}">${s.saldo ? s.saldo + 'd' : r.txt}</span></span>
          <span><button class="plano-btn" onclick="abrirSimulacao('${esc(f['ID'])}')">Simular</button></span>
        </div>`
      }).join('')}
    </div>
    ${renderListaSimulacoes()}`
}

function renderListaSimulacoes() {
  if (!simulacoes.length) {
    return `<p class="plano-dica">Toque em <strong>Simular</strong> para montar o plano do ano. Os períodos simulados
            aparecem no calendário em tracejado e só vão para a planilha quando você salvar.</p>`
  }
  const total = simulacoes.reduce((s, x) => s + diasEntre(x.ini, x.fim) + 1, 0)
  return `
    <div class="plano-sim">
      <div class="card-titulo" style="margin-bottom:8px"><i class="ti ti-flask"></i>
        Simulação — ${simulacoes.length} período(s), ${total} dia(s)</div>
      ${simulacoes.map((s, i) => `
        <div class="plano-sim-item">
          <div>
            <div class="plano-sim-nome">${esc(s.nome)}</div>
            <div class="plano-sec">${fmtBR(s.ini)} → ${fmtBR(s.fim)} · ${diasEntre(s.ini, s.fim) + 1} dia(s)</div>
            ${s.alertas.length ? `<div class="plano-alerta">${s.alertas.map(a => '<div>⚠ ' + esc(a) + '</div>').join('')}</div>` : ''}
          </div>
          <button class="plano-btn remover" onclick="removerSimulacao(${i})" aria-label="Remover"><i class="ti ti-trash"></i></button>
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-secundario" style="flex:1" onclick="limparSimulacoes()">Descartar</button>
        <button class="btn-primario" style="flex:1" id="btn-salvar-plano" onclick="salvarPlano()">Salvar plano</button>
      </div>
    </div>`
}

function abrirSimulacao(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return toast('❌ Funcionário não encontrado', 'erro')
  const s = situacaoFerias(func)
  // Sugere o primeiro dia útil (segunda) a partir de hoje ou do início do ciclo
  let sugerido = hojeCal()
  if (s.concessivoIni && s.concessivoIni > sugerido) sugerido = s.concessivoIni
  while (sugerido.getDay() !== 1) sugerido = somaDiasD(sugerido, 1)

  const modal = document.createElement('div')
  modal.id = 'modal-simular'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:400;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `<div style="background:var(--card-bg);border-radius:20px 20px 0 0;padding:20px 16px 28px;width:100%;max-width:480px">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <h3 style="font-size:15px;font-weight:700;margin-bottom:2px">${esc(func['NOME_COMPLETO'] || '')}</h3>
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px">
      ${s.limite ? 'Conceder até ' + fmtBR(s.limite) + ' · saldo ' + s.saldo + ' dia(s)'
                 : s.completaEm ? 'Aquisitivo completa em ' + fmtBR(s.completaEm) : 'Sem data de admissão'}</p>
    <div class="dois-col">
      <div class="campo-grupo"><label>Início</label><input type="date" id="sim-ini" value="${isoDe(sugerido)}" oninput="previewSimulacao('${esc(funcId)}')"></div>
      <div class="campo-grupo"><label>Dias</label><input type="number" id="sim-dias" min="5" max="30" value="${Math.min(30, Math.max(5, s.saldo || 30))}" oninput="previewSimulacao('${esc(funcId)}')"></div>
    </div>
    <div id="sim-preview" class="plano-preview"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button onclick="document.getElementById('modal-simular').remove()" class="btn-secundario" style="flex:1">Cancelar</button>
      <button onclick="addSimulacao('${esc(funcId)}')" class="btn-primario" style="flex:1" id="btn-add-sim">Adicionar</button>
    </div>
  </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
  previewSimulacao(funcId)
}

function lerCamposSimulacao() {
  const ini = parseDataCal(document.getElementById('sim-ini')?.value || '')
  const dias = parseInt(document.getElementById('sim-dias')?.value || '0', 10)
  return { ini, dias }
}

function previewSimulacao(funcId) {
  const el = document.getElementById('sim-preview'); if (!el) return
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  const { ini, dias } = lerCamposSimulacao()
  const btn = document.getElementById('btn-add-sim')
  if (!func || !ini || !dias) { el.innerHTML = ''; if (btn) btn.disabled = true; return }

  const v = validarSimulacao(func, ini, dias)
  if (btn) btn.disabled = v.erros.length > 0
  el.innerHTML =
    `<div class="plano-preview-periodo">${fmtBR(ini)} → ${fmtBR(v.fim)} · ${dias} dia(s)</div>`
    + v.erros.map(e => `<div class="plano-erro">✕ ${esc(e)}</div>`).join('')
    + v.alertas.map(a => `<div class="plano-alerta">⚠ ${esc(a)}</div>`).join('')
    + (!v.erros.length && !v.alertas.length ? '<div class="plano-ok">✓ Dentro das regras</div>' : '')
}

function addSimulacao(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId)); if (!func) return
  const { ini, dias } = lerCamposSimulacao()
  if (!ini || !dias) return toast('❌ Informe início e duração', 'erro')
  const v = validarSimulacao(func, ini, dias)
  if (v.erros.length) return toast('❌ ' + v.erros[0], 'erro')

  simulacoes.push({
    id: 'SIM-' + (++seqSimulacao), funcId: String(func['ID']),
    nome: func['NOME_COMPLETO'] || '', ini, fim: v.fim, alertas: v.alertas,
  })
  document.getElementById('modal-simular')?.remove()
  toast('✅ Período simulado — veja no calendário', 'sucesso')
  renderCalendario()
}

function removerSimulacao(i) { simulacoes.splice(i, 1); renderCalendario() }
function limparSimulacoes()  { simulacoes = []; renderCalendario() }

async function salvarPlano() {
  if (!simulacoes.length) return
  const btn = document.getElementById('btn-salvar-plano')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...' }
  mostrarLoading('Salvando plano de férias...')
  const res = await chamarGAS({
    acao: 'salvar_plano_ferias',
    dados: { periodos: simulacoes.map(s => ({
      func_id: s.funcId, inicio: isoDe(s.ini), fim: isoDe(s.fim),
      competencia: MESES[s.ini.getMonth()] + '/' + s.ini.getFullYear(),
    })) },
  })
  esconderLoading()
  if (btn) { btn.disabled = false; btn.textContent = 'Salvar plano' }

  if (res && res.ok) {
    toast('✅ ' + (res.data?.salvos ?? simulacoes.length) + ' período(s) salvos no plano', 'sucesso')
    simulacoes = []
    carregarCalendario()
  } else {
    toast('❌ ' + ((res && res.erro) || 'Erro ao salvar o plano'), 'erro')
  }
}

function editarFerias(refToken) {
  // Faixa de simulação: ainda não existe na planilha — leva ao painel do plano.
  if (String(refToken).indexOf('SIM-') === 0) return setCalView('plano')
  const r = feriasCache.find(f => String(f['REF_TOKEN']) === String(refToken))
  if (!r) return toast('❌ Registro não encontrado', 'erro')
  const ini = String(r['INICIO'] || '').substring(0, 10)
  const fim = String(r['FIM'] || '').substring(0, 10)
  const modal = document.createElement('div')
  modal.id = 'modal-ferias'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:400;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `<div style="background:var(--card-bg);border-radius:20px 20px 0 0;padding:20px 16px 28px;width:100%;max-width:480px">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <h3 style="font-size:15px;font-weight:700;margin-bottom:2px">${esc(r['NOME_FUNC'] || '')}</h3>
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px">Ajustar período de férias</p>
    <div class="dois-col">
      <div class="campo-grupo"><label>Início</label><input type="date" id="fer-ini" value="${esc(ini)}"></div>
      <div class="campo-grupo"><label>Fim</label><input type="date" id="fer-fim" value="${esc(fim)}"></div>
    </div>
    <div class="campo-grupo"><label>Status</label><select id="fer-status">
      ${['Planejado', 'Pendente', 'Assinado'].map(o => `<option${o === (r['STATUS'] || 'Pendente') ? ' selected' : ''}>${o}</option>`).join('')}
    </select></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="document.getElementById('modal-ferias').remove()" class="btn-secundario" style="flex:1">Cancelar</button>
      <button onclick="salvarFerias('${esc(refToken)}')" class="btn-primario" style="flex:1">Salvar</button>
    </div>
  </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}
async function salvarFerias(refToken) {
  const inicio = document.getElementById('fer-ini')?.value || ''
  const fim    = document.getElementById('fer-fim')?.value || ''
  const status = document.getElementById('fer-status')?.value || 'Pendente'
  if (inicio && fim && fim < inicio) return toast('❌ Fim antes do início', 'erro')
  document.getElementById('modal-ferias')?.remove()
  mostrarLoading('Salvando...')
  const res = await chamarGAS({ acao: 'atualizar_ferias', dados: { ref_token: refToken, inicio, fim, status } })
  esconderLoading()
  if (res && res.ok) { toast('✅ Férias atualizadas', 'sucesso'); carregarCalendario() }
  else toast('❌ ' + ((res && res.erro) || 'Erro'), 'erro')
}

// ─── DIAGNÓSTICO / HISTÓRICO DE ERROS ────────────────────────────
function diagRow(k, v) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:12px"><span style="color:var(--text-secondary)">${esc(k)}</span>${v}</div>`
}
function renderListaErros(el, lista, vazio) {
  if (!lista.length) { el.innerHTML = `<p class="lista-vazia">${esc(vazio)}</p>`; return }
  el.innerHTML = lista.map(e => `
    <div class="log-item">
      <div class="log-acao" style="color:var(--red-text)">${esc(e.tipo || 'Erro')}${e.extra ? ' · ' + esc(e.extra) : ''}</div>
      <div class="log-detalhe">${esc(e.msg || '')}</div>
      <div class="log-meta">${esc(e.quando || '')}</div>
    </div>`).join('')
}
function idImplantacao() {
  const m = String(GAS_URL).match(/\/macros\/s\/([^/]+)\//)
  return m ? m[1] : '—'
}

function renderDiagnostico() {
  const st = document.getElementById('diag-status')
  if (st) {
    const online = navigator.onLine
    let host = '—'; try { host = new URL(GAS_URL).host } catch (e) {}
    st.innerHTML =
      diagRow('Conexão', `<span class="badge ${online ? 'badge-verde' : 'badge-vermelho'}">${online ? 'Online' : 'Offline'}</span>`) +
      diagRow('Backend', `<span style="font-size:11px;color:var(--text-secondary)">${esc(host)}</span>`) +
      // O ID identifica a IMPLANTAÇÃO. Criar uma nova em vez de editar a
      // existente gera outra URL, e o app fica falando com a antiga.
      diagRow('Implantação', `<span style="font-size:10px;color:var(--text-secondary);font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(idImplantacao())}</span>`) +
      diagRow('Usuário', `<span style="font-size:11px;color:var(--text-secondary)">${esc(USUARIO || '—')}</span>`)
  }
  const elL = document.getElementById('diag-erros-locais')
  if (elL) renderListaErros(elL, lerErrosLocais(), 'Nenhum erro registrado no app 🎉')
  carregarErrosBackend()
}
// "Failed to fetch" não diz nada: pode ser internet, implantação fora do ar
// ou permissão de acesso. Descobrir qual é vale mais que o texto do erro.
//
// O truque é o segundo tiro em 'no-cors': ele não deixa LER a resposta, mas
// resolve se o servidor respondeu alguma coisa. Então:
//   POST falha + no-cors resolve  -> o servidor está lá, o navegador é que
//                                    não pode ler = implantação privada ou
//                                    apagada (redireciona para o login)
//   POST falha + no-cors falha    -> não há caminho até o servidor
async function diagnosticarConexao(timeoutMs = 20000) {
  const t0 = Date.now()
  const res = await chamarGAS({ acao: 'listar_funcionarios' }, { timeoutMs })
  const ms = () => Date.now() - t0

  if (res && res.ok) return { veredito: 'ok', ms: ms() }
  const erro = String((res && res.erro) || '')

  if (/Tempo esgotado/.test(erro)) {
    return { veredito: 'timeout', ms: ms(), detalhe: erro,
      titulo: 'O servidor não respondeu a tempo',
      acao: 'O Apps Script pode estar processando algo pesado. Tente de novo em um minuto.' }
  }
  if (/Erro HTTP/.test(erro)) {
    return { veredito: 'http', ms: ms(), detalhe: erro,
      titulo: 'O servidor respondeu com erro',
      acao: 'O código chegou a rodar. Veja "Execuções" no Apps Script para o motivo.' }
  }

  let alcancavel = false
  try {
    await fetch(GAS_URL, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
    alcancavel = true
  } catch (e) { alcancavel = false }

  if (alcancavel) {
    return { veredito: 'bloqueado', ms: ms(), detalhe: erro,
      titulo: 'O servidor respondeu, mas o app não pode ler a resposta',
      acao: 'Quase sempre é a permissão da implantação. No Apps Script: '
          + 'Implantar → Gerenciar implantações → ✏️ → "Quem pode acessar" = '
          + '<strong>Qualquer pessoa</strong>. Confira também se a URL abaixo é a '
          + 'mesma que aparece lá — criar uma implantação nova gera outra URL.' }
  }
  return { veredito: 'inalcancavel', ms: ms(), detalhe: erro,
    titulo: 'Não há caminho até o servidor',
    acao: 'Internet caiu, o Wi-Fi está bloqueando o script.google.com, ou a '
        + 'implantação foi apagada. Teste abrir a URL abaixo numa aba do navegador.' }
}

async function testarConexao() {
  const el = document.getElementById('diag-conexao')
  if (el) { el.style.display = 'block'; el.className = 'diag-res'; el.innerHTML = '⏳ Testando...' }

  const d = await diagnosticarConexao()

  if (el) {
    if (d.veredito === 'ok') {
      el.className = 'diag-res ok'
      el.innerHTML = `<strong>✅ Backend respondeu</strong> · ${d.ms} ms`
    } else {
      el.className = 'diag-res falhou'
      el.innerHTML = `
        <strong>❌ ${esc(d.titulo)}</strong>
        <div class="diag-acao">${d.acao}</div>
        <div class="diag-url">${esc(GAS_URL)}</div>
        <div class="diag-cru">${esc(d.detalhe)} · ${d.ms} ms</div>`
    }
  }
  const elL = document.getElementById('diag-erros-locais')
  if (elL) renderListaErros(elL, lerErrosLocais(), 'Nenhum erro registrado no app 🎉')
}

async function carregarErrosBackend() {
  const el = document.getElementById('diag-erros-backend'); if (!el) return
  el.innerHTML = '<p class="lista-vazia">Carregando...</p>'
  const res = await chamarGAS({ acao: 'listar_log' })
  const lista = (res && res.ok && Array.isArray(res.data) ? res.data : [])
    .filter(l => String(l['ACAO'] || '').toUpperCase().includes('ERRO'))
    .slice(0, 40)
    .map(l => ({ tipo: l['ACAO'], extra: l['USUARIO'], msg: l['DETALHE'] || l['DETALHES'], quando: l['DATA_HORA'] }))
  renderListaErros(el, lista, 'Nenhum erro no servidor')
}

// Ações que só LEEM. São as únicas que podem ser repetidas em caso de falha
// de rede: repetir um envio criaria dois documentos no ZapSign, duas ordens
// de pagamento, dois registros. Prefixo, não lista fechada, para não
// esquecer de incluir as próximas.
const ACOES_SEGURAS = /^(listar_|historico_|resumo_|buscar_|identificar_|verificar_|relatorio_)/

function podeRepetir(acao) {
  return ACOES_SEGURAS.test(String(acao || ''))
}

async function chamarGAS(dados, { timeoutMs = 120000, tentativas } = {}) {
  const acao = dados.acao || ''
  // Falha de rede num POST é comum e passageira (queda de sinal, conexão
  // derrubada no meio). Tentar de novo poupa o usuário de um erro que se
  // resolveria sozinho — mas só quando repetir é inofensivo.
  const max = tentativas != null ? tentativas : (podeRepetir(acao) ? 3 : 1)
  let ultimo = null

  for (let n = 1; n <= max; n++) {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ ...dados, usuario: dados.usuario || USUARIO, senha: dados.senha || SENHA_ADM }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        registrarErroLocal('HTTP', 'HTTP ' + res.status, acao)
        return { ok: false, erro: 'Erro HTTP ' + res.status }
      }
      return await res.json()
    } catch (e) {
      if (e.name === 'AbortError') {
        registrarErroLocal('Timeout', 'Tempo esgotado na requisição', acao)
        return { ok: false, erro: 'Tempo esgotado. Verifique sua conexão e tente novamente.' }
      }
      ultimo = e
      if (n < max) {
        // Espera crescente: se foi um soluço, 400 ms bastam; se a rede caiu,
        // insistir de imediato só gasta bateria.
        await new Promise(r => setTimeout(r, n * 400))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const msg = ultimo ? ultimo.message : 'falha desconhecida'
  registrarErroLocal('Conexão', msg + (max > 1 ? ` (${max} tentativas)` : ''), acao)
  return { ok: false, erro: 'Erro de conexão: ' + msg }
}

// ─── DASHBOARD ────────────────────────────────────────────────────
async function carregarDashboard() {
  const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }

  // Total de funcionários não depende de rede: mostra na hora em vez de ficar
  // preso esperando as 5 chamadas abaixo.
  setNum('num-funcs', funcionarios.length || '…')
  // Os demais ficam em "…" para o painel não parecer travado enquanto carrega.
  ;['num-vencidos', 'num-avencer', 'num-epi'].forEach(id => setNum(id, '…'))

  // Ao restaurar a sessão (F5) o login não roda, e com ele a lista de
  // funcionários nunca era recarregada — o painel e os selects ficavam zerados.
  const precisaFuncs = !funcionarios.length

  const [resFuncs, resEx, resEst, resEpi, resFolha, resPgto] = await Promise.all([
    precisaFuncs ? chamarGAS({ acao: 'listar_funcionarios' }) : null,
    chamarGAS({ acao: 'listar_exames' }),
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
    chamarGAS({ acao: 'listar_folhas' }),
    chamarGAS({ acao: 'listar_pagamentos', dados: { status: 'Aguardando Pagamento' } }),
  ])

  if (resFuncs && resFuncs.ok && Array.isArray(resFuncs.data)) {
    funcionarios = resFuncs.data
    preencherSelectsOcultos()
  }
  setNum('num-funcs', funcionarios.length)

  // FIX #6: calcula contadores reais antes de chamar renderPendencias
  let examesVencidos = 0, examesAVencer = 0, epiRepor = 0, folhasPendentes = 0

  if (resEx && resEx.ok) {
    todosExames = resEx.data
    examesVencidos = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('VENCIDO')).length
    examesAVencer  = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('A VENCER')).length
    setNum('num-vencidos', examesVencidos)
    setNum('num-avencer',  examesAVencer)
  } else {
    setNum('num-vencidos', '—'); setNum('num-avencer', '—')
  }
  if (resEst && resEst.ok) {
    estoque = resEst.data
    epiRepor = resEst.data.filter(e => { const s = e['SITUAÇÃO']||''; return s.includes('REPOR') || s.includes('SEM') }).length
    setNum('num-epi', epiRepor)
  } else {
    setNum('num-epi', '—')
  }

  // Sem isto, uma falha ou lentidão do GAS deixava o painel em "—" para sempre,
  // sem nenhum aviso de que os dados não vieram.
  const falhas = [resFuncs, resEx, resEst, resEpi, resFolha, resPgto].filter(r => r && !r.ok)
  if (falhas.length) toast('⚠️ Não foi possível carregar todo o painel — toque em ↻ para tentar de novo', 'erro')

  const pendentesEpi   = (resEpi   && resEpi.ok)   ? resEpi.data.filter(e   => e['ASSINADO?'] === 'Pendente' && e['ZAPSIGN_DOC']) : []
  const pendentesFolha = (resFolha && resFolha.ok) ? resFolha.data.filter(f => f['STATUS']    === 'Pendente' && f['ZAPSIGN_DOC']) : []
  folhasPendentes = pendentesFolha.length

  const pagtosPendentes = (resPgto && resPgto.ok && Array.isArray(resPgto.data)) ? resPgto.data.length : 0

  // Agora passa dados reais para renderPendencias
  renderPendencias({ examesVencidos, examesAVencer, epiRepor, folhasPendentes, pagtosPendentes })
  renderLembretes(pendentesEpi, pendentesFolha)
}

function renderLembretes(pendentesEpi, pendentesFolha) {
  const el = document.getElementById('lembretes-wrap'); if (!el) return
  const todos = [
    ...pendentesEpi.map(e => ({ tipo:'EPI', nome:e['FUNCIONÁRIO'], descricao:e['DESCRIÇÃO DO EPI'], data:e['DATA ENTREGA'], docToken:e['ZAPSIGN_DOC'] })),
    ...pendentesFolha.map(f => ({ tipo:'Folha', nome:f['FUNCIONÁRIO'], descricao:f['COMPETÊNCIA'], data:f['DATA ENVIO'], docToken:f['ZAPSIGN_DOC'] })),
  ]
  if (!todos.length) { el.style.display = 'none'; return }
  el.style.display = 'block'
  el.innerHTML = `<div class="card" style="border-color:rgba(133,79,11,0.3);background:#FFFBF5">
    <div class="card-titulo" style="color:var(--amber-text)"><i class="ti ti-bell-ringing" aria-hidden="true"></i> ${todos.length} assinatura(s) pendente(s)</div>
    <div style="display:flex;flex-direction:column;gap:8px">
    ${todos.map(item => {
      const func = funcionarios.find(f => f['NOME_COMPLETO'] === item.nome)
      var telRaw = func ? String(func['TELEFONE']||'').replace(/\D/g,'') : ''
  if (telRaw.length >= 12 && telRaw.substring(0,2) === '55') telRaw = telRaw.substring(2)
  const tel  = telRaw ? '55' + telRaw : ''
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border-radius:var(--radius-md);border:0.5px solid rgba(133,79,11,0.15)">
        <div class="avatar" style="background:var(--amber-bg);color:var(--amber-text)">${getIniciais(item.nome||'?')}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.nome)}</div>
          <div style="font-size:11px;color:var(--text-secondary)"><span class="badge badge-amarelo" style="margin-right:4px">${esc(item.tipo)}</span>${esc(item.descricao)} · ${esc(item.data)}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${tel ? `<a href="https://wa.me/${tel}?text=${encodeURIComponent('Olá '+item.nome.split(' ')[0]+', seu documento aguarda assinatura. Por favor acesse o link que enviamos no WhatsApp.')}" target="_blank" style="background:#22C55E;color:#fff;border:none;border-radius:7px;padding:6px 9px;font-size:13px;text-decoration:none;display:flex;align-items:center"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
          <button onclick="reenviarZapSign('${item.docToken}','${item.nome}')" style="background:var(--blue-bg);color:var(--blue-text);border:none;border-radius:7px;padding:6px 9px;font-size:13px;cursor:pointer;display:flex;align-items:center" title="Reenviar via ZapSign"><i class="ti ti-send"></i></button>
        </div>
      </div>`
    }).join('')}
    </div>
  </div>`
}

async function reenviarZapSign(docToken, nome) {
  if (!docToken || docToken === 'undefined') return toast('❌ Documento indisponível', 'erro')
  mostrarLoading('Reenviando para ' + nome.split(' ')[0] + '...')
  const res = await chamarGAS({ acao: 'reenviar_zapsign', dados: { doc_token: docToken } })
  esconderLoading()
  if (res && res.ok) toast('✅ Reenviado para ' + nome.split(' ')[0] + '!', 'sucesso')
  else toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
}

// ─── FUNCIONÁRIOS ─────────────────────────────────────────────────
async function carregarFuncionarios() {
  mostrarLoading('Carregando...')
  const res = await chamarGAS({ acao: 'listar_funcionarios' })
  esconderLoading()
  if (!res || !res.ok) return toast('Erro ao carregar', 'erro')
  funcionarios = res.data; renderFuncionarios(funcionarios); preencherSelectsOcultos()
}

function filtrarFuncionarios(q) {
  renderFuncionarios(q ? funcionarios.filter(f => (f['NOME_COMPLETO']||'').toLowerCase().includes(q.toLowerCase())) : funcionarios)
}

function getIniciais(nome) {
  const s = String(nome == null ? '' : nome).trim()
  const p = s.split(' ').filter(x => x.length > 1)
  if (p.length >= 2) return (p[0][0] + p[p.length-1][0]).toUpperCase()
  return (s[0] || '?').toUpperCase()
}

// Normaliza telefone BR para link de WhatsApp: retorna '55'+DDD+numero
// sem duplicar o 55 (evita wa.me/5555... quando o telefone já vem com país).
// Retorna '' se o número for curto demais.
function telWhats(raw) {
  var t = String(raw == null ? '' : raw).replace(/\D/g, '')
  if (t.length >= 12 && t.substring(0, 2) === '55') t = t.substring(2)
  return t.length >= 10 ? '55' + t : ''
}


function abrirEpiRapido(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  irPara('epi')
  setTimeout(() => {
    selecionarFuncEpi(funcId)
    const sel = document.getElementById('sel-func-epi-hidden')
    if (sel) sel.value = funcId
    const perfil    = func['PERFIL_SST'] || ''
    const sugeridos = EPI_SUGERIDOS_PERFIL[perfil] || []
    if (sugeridos.length && estoque.length) {
      itensEpiSel = []
      sugeridos.forEach(cod => {
        const epi = estoque.find(e => e['CÓD.'] === cod && parseInt(e['ESTOQUE ATUAL']) > 0)
        if (epi && !itensEpiSel.find(i => i.cod === cod)) {
          itensEpiSel.push({ cod, descricao: epi['DESCRIÇÃO DO EPI'], ca: epi['Nº CA'], quantidade: 1 })
        }
      })
      renderItensEpi()
      atualizarBtnEpi()
      if (itensEpiSel.length) toast('⚡ ' + itensEpiSel.length + ' EPI(s) sugerido(s) para ' + func['NOME_CURTO'], 'sucesso')
    }
  }, 400)
}

function renderFuncionarios(lista) {
  const el = document.getElementById('lista-funcionarios')
  const cnt = document.getElementById('func-count')
  if (cnt) cnt.textContent = lista.length + ' funcionário(s)'
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="avatar">${getIniciais(f['NOME_COMPLETO'])}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${esc(f['NOME_COMPLETO'])}</div>
        <div class="lista-item-sub">${esc(f['FUNCAO'])} · ${esc(f['UNIDADE'])}</div>
        <div class="lista-item-sub">${esc(f['TELEFONE']||'')}</div>
      </div>
      <div style="display:flex;gap:5px;align-items:center">
        <button onclick="editarFuncionario('${f['ID']}')" class="btn-epi-rapido" title="Editar" style="background:var(--blue-bg);color:var(--blue-text)">
          <i class="ti ti-pencil" aria-hidden="true"></i>
        </button>
        <button onclick="abrirEpiRapido('${f['ID']}')" class="btn-epi-rapido" title="Entregar EPI">
          <i class="ti ti-shield-plus" aria-hidden="true"></i>
        </button>
        ${badge(f['STATUS'])}
      </div>
    </div>`).join('')
}


// ─── EDITAR FUNCIONÁRIO ───────────────────────────────────────────
function editarFuncionario(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return toast('❌ Funcionário não encontrado', 'erro')

  irPara('novo-func')

  setTimeout(() => {
    const form = document.querySelector('#pg-novo-func form')
    if (!form) return

    const map = {
      'nome_completo':        func['NOME_COMPLETO'],
      'nome_curto':           func['NOME_CURTO'],
      'funcao':               func['FUNCAO'],
      'unidade':              func['UNIDADE'],
      'cpf':                  func['CPF'],
      'rg':                   func['RG'],
      'data_nascimento':      func['DATA_NASCIMENTO'],
      'data_admissao':        func['DATA_ADMISSAO'],
      'telefone':             func['TELEFONE'],
      'email':                func['EMAIL'],
      'perfil_sst':           func['PERFIL_SST'],
      'empregador':           func['EMPREGADOR'],
      'opera_maquina':        func['OPERA_MAQUINA'],
      'aplica_defensivo':     func['APLICA_DEFENSIVO'],
      'tam_camisa':           func['TAM_CAMISA'],
      'tam_bota':             func['TAM_BOTA'],
      'whatsapp_empregador':  func['WHATSAPP_EMPREGADOR'],
      'banco':                func['BANCO'],
      'agencia':              func['AGENCIA'],
      'conta':                func['CONTA'],
      'pix':                  func['PIX'],
      'salario_base':         func['SALARIO_BASE'],
      'comissao_anual':       func['COMISSAO_ANUAL'],
      'observacoes':          func['OBSERVACOES'],
    }

    Object.entries(map).forEach(([name, val]) => {
      const el = form.querySelector(`[name="${name}"]`)
      if (el && val) el.value = val
    })

    const titulo = document.getElementById('titulo-pagina')
    if (titulo) titulo.textContent = '✏️ Editar Funcionário'

    const btn = document.getElementById('btn-salvar-func')
    if (btn) btn.innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações'

    form.dataset.editandoId = funcId

    toast('✏️ Editando ' + func['NOME_COMPLETO'].split(' ')[0], 'sucesso')
  }, 100)
}

async function salvarFuncionario(e) {
  e.preventDefault()
  const btn = document.getElementById('btn-salvar-func')
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Salvando...'
  mostrarLoading('Cadastrando e criando pasta no Drive...')
  const dados = Object.fromEntries(new FormData(e.target).entries())
  const editandoId = e.target.dataset.editandoId
  const acao = editandoId ? 'atualizar_funcionario' : 'cadastrar_funcionario'
  if (editandoId) dados.id = editandoId

  const res = await chamarGAS({ acao, dados })
  esconderLoading()
  btn.disabled = false
  btn.innerHTML = editandoId
    ? '<i class="ti ti-device-floppy"></i> Salvar alterações'
    : '<i class="ti ti-device-floppy"></i> Cadastrar'

  if (res && res.ok) {
    toast(editandoId ? '✅ Dados atualizados!' : '✅ Cadastrado! ID: ' + res.data.id, 'sucesso')
    if (!editandoId) e.target.reset()
    e.target.dataset.editandoId = ''
    const r2 = await chamarGAS({ acao: 'listar_funcionarios' })
    if (r2 && r2.ok) { funcionarios = r2.data; preencherSelectsOcultos() }
    setTimeout(() => irPara('lista-func'), 1500)
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

// ─── EXAMES ───────────────────────────────────────────────────────
async function carregarExames() {
  if (!todosExames.length) {
    mostrarLoading('Carregando exames...')
    const res = await chamarGAS({ acao: 'listar_exames' })
    esconderLoading()
    if (!res || !res.ok) return
    todosExames = res.data
  }
  filtrarExames()
}

let filtroExameStatus = ''
function setFiltroExame(btn, val) {
  filtroExameStatus = val
  document.querySelectorAll('#filtro-exames .motivo-chip').forEach(b => b.classList.remove('ativo'))
  btn.classList.add('ativo')
  filtrarExames()
}
function filtrarExames(busca) {
  const filtroStatus = filtroExameStatus
  const q = typeof busca === 'string' ? busca.toLowerCase() : (document.getElementById('busca-exame')?.value || '').toLowerCase()
  let lista = todosExames
  if (filtroStatus) lista = lista.filter(e => (e['STATUS EXAME']||'').toUpperCase().includes(filtroStatus.toUpperCase()))
  if (q) lista = lista.filter(e => (e['FUNCIONÁRIO']||'').toLowerCase().includes(q))
  const cnt = document.getElementById('exame-count')
  if (cnt) cnt.textContent = lista.length + ' exame(s)'
  const el = document.getElementById('lista-exames')
  if (!el) return
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum exame encontrado</p>'; return }
  el.innerHTML = lista.map(e => {
    const status = e['STATUS EXAME'] || '⏳ PENDENTE'
    const bc = status.includes('VENCIDO') ? 'var(--red-text)' : status.includes('A VENCER') ? 'var(--amber-text)' : 'var(--border)'
    return `<div class="lista-item" style="border-color:${bc}">
      <div class="lista-item-info">
        <div class="lista-item-nome">${esc(e['FUNCIONÁRIO'])}</div>
        <div class="lista-item-sub">${esc(e['EXAME REALIZADO'])}</div>
        <div class="lista-item-sub">${e['DATA REALIZAÇÃO']?'Realizado: '+e['DATA REALIZAÇÃO']:'Não realizado'}${e['DATA VENCIMENTO']?' · Vence: '+e['DATA VENCIMENTO']:''}</div>
      </div>${badge(status)}
    </div>`
  }).join('')
}

// ─── EPI ──────────────────────────────────────────────────────────
async function carregarEpi() {
  const selFuncEpi = document.getElementById('sel-func-epi-hidden')
  const selDisplay = document.getElementById('sel-func-display')
  if (selFuncEpi && selDisplay) {
    selDisplay.style.position = 'relative'
    selFuncEpi.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px;display:block'
    selDisplay.parentElement.style.position = 'relative'
    if (selFuncEpi.parentElement !== selDisplay.parentElement) {
      selDisplay.parentElement.appendChild(selFuncEpi)
    }
  }
  mostrarLoading('Carregando EPI...')
  const [resEst, resEnt] = await Promise.all([
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
  ])
  esconderLoading()
  if (resEst && resEst.ok) { estoque = resEst.data; preencherSelectsOcultos(); renderEstoqueModal(estoque) }
  if (resEnt && resEnt.ok) {
    const dados = resEnt.data
    renderEpiAcumulados(dados.filter(e => e['ASSINADO?'] === 'Acumulado'))
    renderEntregas(dados.filter(e => e['ASSINADO?'] !== 'Acumulado').slice(0,15))
  }
}

// ── EPIs acumulados no mês → fechar mês ───────────────────────────
function renderEpiAcumulados(acumulados) {
  const el = document.getElementById('epi-acumulados-wrap')
  if (!el) return
  if (!acumulados || !acumulados.length) { el.innerHTML = ''; return }

  // Agrupa por funcionário
  const porFunc = {}
  acumulados.forEach(e => {
    const id = String(e['ID FUNC.'])
    if (!porFunc[id]) porFunc[id] = { func_id: id, nome: e['FUNCIONÁRIO'] || '?', itens: [] }
    porFunc[id].itens.push(e)
  })
  const grupos = Object.values(porFunc)

  el.innerHTML = `
    <div class="card" style="border:0.5px solid rgba(133,79,11,0.25)">
      <div class="card-titulo" style="color:var(--amber-text)"><i class="ti ti-package"></i> Acumulados no mês — fechar e assinar</div>
      ${grupos.map(g => `
        <div style="background:var(--amber-bg);border-radius:var(--radius-md);padding:10px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="avatar" style="background:rgba(133,79,11,0.15);color:var(--amber-text)">${getIniciais(g.nome)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.nome)}</div>
              <div style="font-size:10px;color:var(--amber-text)">${g.itens.length} EPI(s) acumulado(s)</div>
            </div>
            <button onclick="fecharMesEpiUI('${g.func_id}')" style="background:var(--verde);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px">
              <i class="ti ti-file-check"></i> Fechar mês
            </button>
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:6px;padding-left:44px">${g.itens.map(i => esc((i['DESCRIÇÃO DO EPI']||'') + (i['QUANTIDADE']>1?' ('+i['QUANTIDADE']+')':''))).join(' · ')}</div>
        </div>`).join('')}
    </div>`
}

function fecharMesEpiUI(funcId) {
  const modal = document.createElement('div')
  modal.id = 'modal-fechar-mes'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `
    <div style="background:var(--card-bg,#fff);border-radius:20px 20px 0 0;padding:20px 16px 32px;width:100%;max-width:480px">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 16px"></div>
      <h3 style="font-size:15px;font-weight:600;margin-bottom:6px;text-align:center">Fechar mês — enviar recibo</h3>
      <p style="font-size:12px;color:var(--text-secondary);text-align:center;margin-bottom:16px">Consolida os EPIs do mês em um único documento</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="document.getElementById('modal-fechar-mes').remove();executarFecharMes('${funcId}','zapsign')" style="background:#1A5C2A;color:#fff;border:none;border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📲</span>
          <div style="text-align:left"><div>ZapSign — WhatsApp automático</div><div style="font-size:10px;opacity:0.8;font-weight:400">Link enviado automaticamente</div></div>
        </button>
        <button onclick="document.getElementById('modal-fechar-mes').remove();executarFecharMes('${funcId}','proprio')" style="background:#E6F1FB;color:#185FA5;border:0.5px solid rgba(24,95,165,0.2);border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✍️</span>
          <div style="text-align:left"><div>Assinatura própria</div><div style="font-size:10px;opacity:0.7;font-weight:400">Gera link para assinar no celular</div></div>
        </button>
        <button onclick="document.getElementById('modal-fechar-mes').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:13px;padding:10px;cursor:pointer">Cancelar</button>
      </div>
    </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

async function executarFecharMes(funcId, metodo) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  mostrarLoading('Gerando recibo mensal...')
  const res = await chamarGAS({ acao: 'fechar_mes_epi', dados: { func_id: funcId, metodo_assinatura: metodo } })
  if (metodo === 'proprio' && res && res.ok && res.data?.pdf_base64) {
    mostrarLoading('Gerando link de assinatura...')
    const res2 = await chamarGAS({ acao: 'gerar_link_assinatura', dados: {
      tipo: 'EPI', func_id: funcId,
      referencia: res.data.motivo || 'Entregas do mês',
      pdf_base64: res.data.pdf_base64, itens: res.data.itens || [],
      motivo: res.data.motivo || 'Entregas do mês',
      func_cpf: func?.['CPF'] || '', func_funcao: func?.['FUNCAO'] || '', func_unidade: func?.['UNIDADE'] || '',
    }})
    esconderLoading()
    if (res2 && res2.ok) mostrarLinkAssinaturaEpi(res2.data.link, res2.data.mensagem, res2.data.wa_link)
    else toast('❌ Erro ao gerar link', 'erro')
    carregarEpi()
    return
  }
  esconderLoading()
  if (res && res.ok) {
    if (res.data.link_assinatura) mostrarLinkAssinaturaEpi(res.data.link_assinatura, res.data.mensagem, '')
    else toast('✅ ' + res.data.mensagem, 'sucesso')
    carregarEpi()
  } else toast('❌ ' + ((res&&res.erro)||'Erro ao fechar o mês'), 'erro')
}

function toggleEstoqueModal() {
  const el = document.getElementById('estoque-modal')
  if (!el) return
  el.style.display = el.style.display === 'none' ? 'block' : 'none'
}

function renderEstoqueModal(lista) {
  const el = document.getElementById('estoque-modal-body')
  if (!el) return
  const icones = { 'Capacete':'🪖','Óculos':'🥽','Protetor':'👂','Respirador':'😷','Luva':'🧤','Bota':'👟','Botina':'👟','Avental':'🦺','Macacão':'👔','Colete':'🦺','Cinto':'🔒','Chapéu':'👒','Camisa':'👕','Máscara':'😷' }
  function gi(nome) { for (const [k,v] of Object.entries(icones)) { if (nome.toLowerCase().includes(k.toLowerCase())) return v } return '🦺' }
  el.innerHTML = lista.map(e => {
    const sit = situacaoEpi(e)
    const bc = sit === '✅ OK' ? 'badge-verde' : sit === '⚠️ REPOR' ? 'badge-amarelo' : 'badge-vermelho'
    return `<div class="epi-estoque-item">
      <div class="epi-icone-wrap">${gi(e['DESCRIÇÃO DO EPI'])}</div>
      <div class="epi-est-info">
        <div class="epi-est-nome">${esc(e['DESCRIÇÃO DO EPI'])}</div>
        <div class="epi-est-ca">CA ${esc(e['Nº CA']||'—')} · ${esc(e['UNIDADE']||'un')}</div>
      </div>
      <div class="epi-est-right">
        <span class="epi-est-qty">${e['ESTOQUE ATUAL']}</span>
        <span class="badge ${bc}">${sit.replace('✅ ','').replace('⚠️ ','').replace('⛔ ','')}</span>
      </div>
    </div>`
  }).join('')
}

function situacaoEpi(e) {
  const est = parseInt(e['ESTOQUE ATUAL'])||0, min = parseInt(e['ESTOQUE MÍNIMO'])||0
  if (est === 0) return '⛔ SEM ESTOQUE'
  if (est <= min) return '⚠️ REPOR'
  return '✅ OK'
}

function abrirSeletorFunc() {
  const sel = document.getElementById('sel-func-epi-hidden')
  if (!sel) return
  if (sel.options.length <= 1) preencherSelectsOcultos()
  sel.click()
}
function selecionarFuncEpi(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  funcEpiSelecionado = func
  document.getElementById('sel-func-display').classList.add('selecionado')
  document.getElementById('sel-func-avatar').textContent = getIniciais(func['NOME_COMPLETO'])
  const nomeEl = document.getElementById('sel-func-nome')
  nomeEl.textContent = func['NOME_COMPLETO']; nomeEl.style.color = 'var(--text-primary)'
  const subEl = document.getElementById('sel-func-sub')
  if (subEl) subEl.textContent = (func['FUNCAO']||'') + ' · ' + (func['UNIDADE']||'')

  const perfil    = func['PERFIL_SST'] || ''
  const sugeridos = EPI_SUGERIDOS_PERFIL[perfil] || []
  if (sugeridos.length && estoque.length && itensEpiSel.length === 0) {
    sugeridos.forEach(cod => {
      const epi = estoque.find(e => e['CÓD.'] === cod && parseInt(e['ESTOQUE ATUAL']) > 0)
      if (epi) itensEpiSel.push({ cod, descricao: epi['DESCRIÇÃO DO EPI'], ca: epi['Nº CA'], quantidade: 1 })
    })
    renderItensEpi()
    const hint = document.getElementById('add-epi-hint')
    if (hint && itensEpiSel.length) hint.textContent = itensEpiSel.length + ' EPI(s) sugeridos — adicionar mais...'
  }
  atualizarBtnEpi()
}

function abrirSeletorEpi() {
  const wrap = document.getElementById('epi-busca-wrap')
  if (!wrap) return
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'
  if (wrap.style.display === 'block') {
    const inp = document.getElementById('epi-busca-input')
    if (inp) { inp.value = ''; inp.focus(); filtrarEpiBusca('') }
  }
}

function filtrarEpiBusca(q) {
  const lista = document.getElementById('epi-busca-lista'); if (!lista) return
  const itens = estoque.filter(e => parseInt(e['ESTOQUE ATUAL']) > 0 && (!q || e['DESCRIÇÃO DO EPI'].toLowerCase().includes(q.toLowerCase())))
  lista.innerHTML = itens.map(e => `
    <div onclick="adicionarItemEpiBusca('${e['CÓD.']}')" style="padding:8px 10px;cursor:pointer;border-bottom:0.5px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;font-weight:500">${esc(e['DESCRIÇÃO DO EPI'])}</span>
      <span style="font-size:11px;color:#6B7280">${esc(e['ESTOQUE ATUAL'])} ${esc(e['UNIDADE']||'un')}</span>
    </div>`).join('') || '<p style="padding:10px;font-size:12px;color:#9CA3AF;text-align:center">Nenhum EPI disponível</p>'
}

function adicionarItemEpiBusca(cod) {
  if (itensEpiSel.find(i => i.cod === cod)) { fecharBuscaEpi(); return }
  const epi = estoque.find(e => e['CÓD.'] === cod); if (!epi) return
  itensEpiSel.push({ cod, descricao: epi['DESCRIÇÃO DO EPI'], ca: epi['Nº CA'], quantidade: 1 })
  renderItensEpi(); atualizarBtnEpi(); fecharBuscaEpi()
}

function fecharBuscaEpi() {
  const wrap = document.getElementById('epi-busca-wrap')
  if (wrap) wrap.style.display = 'none'
}

function adicionarItemEpi(sel) {
  const cod = sel.value; if (!cod) return
  adicionarItemEpiBusca(cod)
  sel.value = ''
}

function removerItemEpi(cod) { itensEpiSel = itensEpiSel.filter(i => i.cod !== cod); renderItensEpi(); atualizarBtnEpi() }
function alterarQtdEpi(cod, delta) {
  const item = itensEpiSel.find(i => i.cod === cod); if (!item) return
  item.quantidade = Math.max(1, item.quantidade + delta)
  renderItensEpi(); atualizarBtnEpi()
}

function renderItensEpi() {
  const el = document.getElementById('epi-itens-lista')
  el.innerHTML = itensEpiSel.map(item => `
    <div class="epi-item-card">
      <span class="epi-item-nome">${esc(item.cod)} — ${esc(item.descricao)}</span>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="alterarQtdEpi('${item.cod}',-1)">−</button>
        <span class="qty-num">${item.quantidade}</span>
        <button class="qty-btn" onclick="alterarQtdEpi('${item.cod}',1)">+</button>
      </div>
      <button class="del-epi-btn" onclick="removerItemEpi('${item.cod}')"><i class="ti ti-x"></i></button>
    </div>`).join('')
}

function atualizarBtnEpi() {
  const btn = document.getElementById('btn-enviar-epi')
  const lbl = document.getElementById('btn-epi-label')
  const n   = itensEpiSel.length
  if (n > 0) lbl.textContent = 'Gerar recibo e enviar (' + n + ' item' + (n > 1 ? 's' : '') + ')'
  else lbl.textContent = 'Gerar recibo e enviar'
  btn.disabled = !funcEpiSelecionado || n === 0
}

async function enviarEpi(metodo) {
  if (!funcEpiSelecionado || !itensEpiSel.length) return toast('❌ Selecione funcionário e EPIs', 'erro')
  if (!metodo) { mostrarModalEnvio('epi'); return }

  const btn = document.getElementById('btn-enviar-epi')
  const motivo = motivoEpiSelecionado || 'Admissional'
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Enviando...'
  mostrarLoading(metodo === 'acumular' ? 'Registrando no mês...' : 'Gerando recibo PDF...')

  const res = await chamarGAS({ acao: 'entregar_epi', dados: {
    func_id: funcEpiSelecionado['ID'], itens: itensEpiSel, motivo,
    metodo_assinatura: metodo
  }})
  esconderLoading()
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> <span id="btn-epi-label">Gerar recibo e enviar</span>'

  if (res && res.ok) {
    if (metodo === 'proprio' && res.data.pdf_base64) {
      mostrarLoading('Gerando link de assinatura...')
      const func = funcEpiSelecionado
      const res2 = await chamarGAS({ acao: 'gerar_link_assinatura', dados: {
        tipo:         'EPI',
        func_id:      func['ID'],
        referencia:   itensEpiSel.map(i => i.descricao).join(', '),
        pdf_base64:   res.data.pdf_base64,
        itens:        itensEpiSel,
        motivo:       motivoEpiSelecionado || 'Admissional',
        func_cpf:     func['CPF']     || '',
        func_funcao:  func['FUNCAO']  || '',
        func_unidade: func['UNIDADE'] || '',
      }})
      esconderLoading()
      if (res2 && res2.ok) mostrarLinkAssinaturaEpi(res2.data.link, res2.data.mensagem, res2.data.wa_link)
      else toast('❌ Erro ao gerar link', 'erro')
    } else {
      if (res.data.link_assinatura) mostrarLinkAssinaturaEpi(res.data.link_assinatura, res.data.mensagem, '')
      else toast('✅ ' + res.data.mensagem, 'sucesso')
    }
    itensEpiSel = []; funcEpiSelecionado = null
    renderItensEpi()
    document.getElementById('sel-func-display').classList.remove('selecionado')
    document.getElementById('sel-func-avatar').textContent = '?'
    document.getElementById('sel-func-nome').textContent = 'Selecione o funcionário...'
    document.getElementById('sel-func-nome').style.color = 'var(--text-secondary)'
    carregarEpi()
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

function mostrarLinkAssinaturaEpi(url, msg, waLinkCustom) {
  const el = document.getElementById('link-assinatura-epi')
  var _telEpi = funcEpiSelecionado ? String(funcEpiSelecionado['TELEFONE']||'').replace(/\D/g,'') : ''
  if (_telEpi.length >= 12 && _telEpi.substring(0,2) === '55') _telEpi = _telEpi.substring(2)
  const tel = _telEpi ? '55' + _telEpi : ''
  const waUrl = waLinkCustom || (tel ? `https://wa.me/${tel}?text=${encodeURIComponent('Por favor, assine o documento: '+url)}` : '')
  el.style.display = 'block'
  el.innerHTML = `<p style="font-size:12px;font-weight:600;color:var(--verde-text);margin-bottom:6px">✅ ${msg}</p>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="inp-link-ass" value="${url}" readonly style="flex:1;font-size:10px;border:0.5px solid var(--border);border-radius:6px;padding:6px 8px;background:#fff;color:var(--text-primary)">
      <button onclick="copiarLink()" class="btn-copiar" style="background:var(--verde);color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer">Copiar</button>
      ${waUrl ? `<a href="${waUrl}" target="_blank" style="background:#22C55E;color:#fff;border-radius:6px;padding:6px 10px;font-size:13px;text-decoration:none;display:flex;align-items:center"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
    </div>`
}

async function copiarLink() {
  const inp = document.getElementById('inp-link-ass'); if (!inp) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inp.value)
    } else {
      inp.select(); document.execCommand('copy')
    }
    toast('✅ Link copiado!', 'sucesso')
  } catch(e) {
    try { inp.select(); document.execCommand('copy'); toast('✅ Link copiado!', 'sucesso') }
    catch(_) { toast('❌ Não foi possível copiar', 'erro') }
  }
}

let entregasCache = []
let filtroEntregaStatus = ''

function setFiltroEntrega(btn, val) {
  filtroEntregaStatus = val
  document.querySelectorAll('#filtro-epi-entrega .motivo-chip').forEach(b => b.classList.remove('ativo'))
  btn.classList.add('ativo')
  filtrarEntregas()
}

function filtrarEntregas() {
  renderEntregas(entregasCache)
}

function itemEntregaHTML(e) {
  const assinado = e['ASSINADO?'] === 'Sim'
  const func  = funcionarios.find(f => f['NOME_COMPLETO'] === e['FUNCIONÁRIO'])
  const tel   = telWhats(func?.['TELEFONE'] || e['TELEFONE'])
  const waUrl = tel ? `https://wa.me/${tel}` : ''
  return `
    <div class="lista-item">
      <div class="avatar" style="background:${assinado?'var(--verde-claro)':'var(--amber-bg)'};color:${assinado?'var(--verde-text)':'var(--amber-text)'}">${getIniciais(e['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${esc(e['FUNCIONÁRIO']||'—')}</div>
        <div class="lista-item-sub">${esc(e['DESCRIÇÃO DO EPI']||'')} · ${esc(e['DATA ENTREGA']||'')} · ${esc(e['MOTIVO ENTREGA']||'')}</div>
        ${e['LINK DOC ASSINADO'] ? `<a href="${e['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text);display:flex;align-items:center;gap:2px;margin-top:2px"><i class="ti ti-file-check" style="font-size:10px"></i> Ver documento assinado</a>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${badge(e['ASSINADO?'])}
        ${waUrl && !assinado ? `<a href="${waUrl}" target="_blank" style="background:#22C55E;color:#fff;border-radius:6px;padding:3px 7px;font-size:10px;text-decoration:none;display:flex;align-items:center;gap:3px"><i class="ti ti-brand-whatsapp" style="font-size:10px"></i></a>` : ''}
      </div>
    </div>`
}

function grupoEntregaHTML(titulo, cor, itens) {
  if (!itens.length) return ''
  return `
    <div style="display:flex;align-items:center;gap:6px;margin:10px 2px 6px">
      <span style="width:7px;height:7px;border-radius:50%;background:${cor}"></span>
      <span style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.03em">${titulo}</span>
      <span style="font-size:10px;font-weight:600;color:var(--text-secondary);background:var(--surface);border-radius:10px;padding:1px 7px">${itens.length}</span>
    </div>
    ${itens.map(itemEntregaHTML).join('')}`
}

function renderEntregas(lista) {
  entregasCache = lista || []
  const el = document.getElementById('lista-entregas')
  if (!el) return

  const q = (document.getElementById('busca-epi-entrega')?.value || '').toLowerCase().trim()
  let filtrada = entregasCache
  if (filtroEntregaStatus === 'assinado') filtrada = filtrada.filter(e => e['ASSINADO?'] === 'Sim')
  else if (filtroEntregaStatus === 'pendente') filtrada = filtrada.filter(e => e['ASSINADO?'] !== 'Sim')
  if (q) filtrada = filtrada.filter(e =>
    (e['FUNCIONÁRIO']||'').toLowerCase().includes(q) || (e['DESCRIÇÃO DO EPI']||'').toLowerCase().includes(q))

  if (!filtrada.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega encontrada</p>'; return }

  const assinados = filtrada.filter(e => e['ASSINADO?'] === 'Sim')
  const pendentes = filtrada.filter(e => e['ASSINADO?'] !== 'Sim')
  el.innerHTML = grupoEntregaHTML('Assinados', 'var(--verde)', assinados)
              + grupoEntregaHTML('Pendentes', 'var(--amber-text)', pendentes)
}

// ─── FOLHA / FRACIONAR ────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// ASSINATURA PRÓPRIA
// ═══════════════════════════════════════════════════════════════════
function mostrarModalEnvio(tipo, dadosEnvio) {
  const existente = document.getElementById('modal-envio')
  if (existente) existente.remove()

  const modal = document.createElement('div')
  modal.id = 'modal-envio'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 32px;width:100%;max-width:480px">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 16px"></div>
      <h3 style="font-size:15px;font-weight:600;color:#1A1A1A;margin-bottom:6px;text-align:center">Como deseja enviar?</h3>
      <p style="font-size:12px;color:#6B7280;text-align:center;margin-bottom:16px">Escolha o método de assinatura</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="enviarComZapSign_${tipo}()" style="background:#1A5C2A;color:#fff;border:none;border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📲</span>
          <div style="text-align:left">
            <div>ZapSign — WhatsApp automático</div>
            <div style="font-size:10px;opacity:0.8;font-weight:400">Link enviado automaticamente pelo WhatsApp</div>
          </div>
        </button>
        <button onclick="enviarComAssinaturaPropria_${tipo}()" style="background:#E6F1FB;color:#185FA5;border:0.5px solid rgba(24,95,165,0.2);border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✍️</span>
          <div style="text-align:left">
            <div>Assinatura própria — sem ZapSign</div>
            <div style="font-size:10px;opacity:0.7;font-weight:400">Gera link para assinar com o dedo no celular</div>
          </div>
        </button>
        ${tipo === 'epi' ? `<button onclick="document.getElementById('modal-envio').remove();enviarEpi('acumular')" style="background:#FFF3E0;color:#854F0B;border:0.5px solid rgba(133,79,11,0.2);border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📦</span>
          <div style="text-align:left">
            <div>Acumular no mês — assinar depois</div>
            <div style="font-size:10px;opacity:0.75;font-weight:400">Registra a entrega e envia tudo junto no fim do mês</div>
          </div>
        </button>` : ''}
        <button onclick="document.getElementById('modal-envio').remove()" style="background:none;border:none;color:#6B7280;font-size:13px;padding:10px;cursor:pointer">Cancelar</button>
      </div>
    </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

// ── EPI ───────────────────────────────────────────────────────────
function enviarComZapSign_epi()          { document.getElementById('modal-envio')?.remove(); enviarEpi('zapsign') }
function enviarComAssinaturaPropria_epi(){ document.getElementById('modal-envio')?.remove(); enviarEpi('proprio') }

async function enviarPaginaAssinaturaPropria(idx, tipo) {
  const p = paginasFracionadas[idx]
  if (!p.funcId) return toast('❌ Selecione o funcionário primeiro', 'erro')
  const tipoDoc = tipo || p.tipoDoc || 'Folha'
  const btn = document.getElementById('btn-zap-' + idx)
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>' }
  mostrarLoading('Gerando link de assinatura...')

  const res = await chamarGAS({
    acao: 'processar_pagina_proprio',
    dados: {
      pdf_base64:   p.pdfBase64,
      tipo:         tipoDoc,
      competencia:  p.competencia,
      func_id:      p.funcId,
      func_nome:    p.nome,
      pagina:       p.pagina,
      valor_liquido: p.valorLiquido || null,
      ferias_inicio: p.feriasInicio || null,
      ferias_fim:    p.feriasFim || null,
    }
  })
  esconderLoading()

  if (res && res.ok) {
    paginasFracionadas[idx].status = 'enviado'
    atualizarCardEnviado(idx, res.data)
    toast('✅ Link gerado para ' + p.nome.split(' ')[0], 'sucesso')
    carregarEntregasFolha()
  } else {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> Enviar' }
    toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
  }
}

function atualizarCardEnviado(idx, data) {
  const card = document.getElementById('fpc-' + idx); if (!card) return
  card.className = 'frac-page-card enviado'
  const numEl = document.getElementById('fpc-num-' + idx)
  if (numEl) { numEl.className = 'fpc-num enviado'; numEl.innerHTML = '<i class="ti ti-circle-check" style="font-size:11px;vertical-align:-1px"></i> Pág. ' + paginasFracionadas[idx].pagina + ' — Enviado' }
  const actionEl = document.getElementById('fpc-action-' + idx)
  if (actionEl && data) {
    const telRaw2 = String(paginasFracionadas[idx].telefone||'').replace(/\D/g,''); const tel = telRaw2
    actionEl.innerHTML = `<div class="fpc-links">
      <span class="btn-enviado-frac"><i class="ti ti-check"></i></span>
      ${data.link ? `<a href="${data.link}" target="_blank" class="btn-link-frac"><i class="ti ti-external-link"></i> Link</a>` : ''}
      ${data.wa_link ? `<a href="${data.wa_link}" target="_blank" class="btn-wa-frac"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
    </div>`
  }
  atualizarBtnTodos()
}


// ═══════════════════════════════════════════════════════════════════
// GOOGLE DRIVE PICKER
// ═══════════════════════════════════════════════════════════════════
const DRIVE_CLIENT_ID  = '850932556005-m1tdqleh9ffgcfddavlcar51p0padce3.apps.googleusercontent.com'
const DRIVE_API_KEY    = 'AIzaSyBK0ADivSbDVb0kox6gGeCGepDQR9nWtSw'
const DRIVE_APP_ID     = '850932556005'

let pickerApiLoaded = false
let oauthToken      = null

function abrirDrivePicker() {
  gapi.load('picker', () => {
    pickerApiLoaded = true
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope:     'https://www.googleapis.com/auth/drive.readonly',
      callback:  (response) => {
        if (response.access_token) {
          oauthToken = response.access_token
          criarPicker()
        }
      },
    })
    tokenClient.requestAccessToken({ prompt: oauthToken ? '' : 'consent' })
  })
}

function criarPicker() {
  if (!pickerApiLoaded || !oauthToken) return

  const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setMimeTypes('application/pdf')
    .setMode(google.picker.DocsViewMode.LIST)
    .setIncludeFolders(true)

  const picker = new google.picker.PickerBuilder()
    .enableFeature(google.picker.Feature.NAV_HIDDEN)
    .setAppId(DRIVE_APP_ID)
    .setOAuthToken(oauthToken)
    .addView(view)
    .setDeveloperKey(DRIVE_API_KEY)
    .setCallback(pickerCallback)
    .setTitle('Selecione o PDF da folha')
    .build()

  picker.setVisible(true)
}

async function pickerCallback(data) {
  if (data.action !== google.picker.Action.PICKED) return
  const file = data.docs[0]
  const nome = file.name

  mostrarLoading('Carregando PDF do Drive...')

  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
      { headers: { Authorization: 'Bearer ' + oauthToken } }
    )
    if (!res.ok) {
      const errText = await res.text()
      throw new Error('Erro HTTP ' + res.status + ': ' + errText.substring(0, 100))
    }
    const buffer = await res.arrayBuffer()
    const blob   = new Blob([buffer], { type: 'application/pdf' })
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(blob)
    })

    esconderLoading()
    mostrarPdfSelecionado(nome)

    const fileObj = new File([blob], nome, { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(fileObj)
    const inputFrac = document.getElementById('input-pdf-frac')
    if (inputFrac) {
      inputFrac.files = dt.files
      inputFrac.dispatchEvent(new Event('change'))
    }

    toast('✅ PDF carregado: ' + nome, 'sucesso')
    const comp = document.getElementById('sel-comp-frac')?.value
    if (!comp) toast('⚠️ Selecione a competência e clique em Separar PDF', 'aviso')
  } catch(e) {
    esconderLoading()
    toast('❌ Erro ao carregar PDF: ' + e.message, 'erro')
  }
}

// FIX #1: função recebe nome (string), não o elemento input
function mostrarPdfSelecionado(nome) {
  const el = document.getElementById('pdf-selecionado')
  if (el) { el.style.display = 'block'; el.textContent = '📄 ' + nome }
  const nomeEl = document.getElementById('pdf-nome')
  if (nomeEl) nomeEl.textContent = nome
}

function atualizarCompDisplay() {
  const sel   = document.getElementById('sel-comp-frac')
  const label = document.getElementById('comp-display-label')
  if (sel && label) {
    label.textContent = sel.value || 'Selecione a competência...'
    label.style.color = sel.value ? 'var(--text-primary)' : 'var(--text-secondary)'
  }
}

function preencherMesesFracionar() {
  const sel = document.getElementById('sel-comp-frac'); if (!sel) return
  if (sel.options.length > 1) return
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano = new Date().getFullYear(), mesAtual = new Date().getMonth()
  let opts = '<option value="">Selecione a competência...</option>'
  for (let m = mesAtual; m >= 0; m--) opts += `<option value="${meses[m]}/${ano}">${meses[m]}/${ano}</option>`
  for (let m = 11; m > mesAtual; m--) opts += `<option value="${meses[m]}/${ano-1}">${meses[m]}/${ano-1}</option>`
  sel.innerHTML = opts
}

let folhaListaCache = []
let filtroFolhaStatus = ''

async function carregarEntregasFolha() {
  const res = await chamarGAS({ acao: 'listar_folhas' })
  if (res && res.ok) renderHistoricoFolha(res.data.slice(0,50))
}

function setFiltroFolha(btn, val) {
  filtroFolhaStatus = val
  document.querySelectorAll('#filtro-folha .motivo-chip').forEach(b => b.classList.remove('ativo'))
  btn.classList.add('ativo')
  filtrarFolhas()
}

function filtrarFolhas() {
  renderHistoricoFolha(folhaListaCache)
}

function itemFolhaHTML(f) {
  const assinado = f['STATUS'] === 'Assinado'
  return `
    <div class="lista-item">
      <div class="avatar" style="background:${assinado?'var(--verde-claro)':'var(--amber-bg)'};color:${assinado?'var(--verde-text)':'var(--amber-text)'}">${getIniciais(f['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${esc(f['FUNCIONÁRIO'])}</div>
        <div class="lista-item-sub">${esc(f['COMPETÊNCIA'])} · ${esc(f['DATA ENVIO'])}</div>
        ${f['LINK DOC ASSINADO'] ? `<a href="${f['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text);display:flex;align-items:center;gap:2px;margin-top:2px"><i class="ti ti-file-check" style="font-size:10px"></i> Ver assinado</a>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${badge(f['STATUS'])}
        ${assinado ? `<button onclick="notificarPagamentoIndividual('${f['ID FUNC.']}','${normalizarComp(f['COMPETÊNCIA'])}')"
          style="background:#25D366;color:#fff;border:none;border-radius:6px;padding:3px 7px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px">
          <i class="ti ti-brand-whatsapp"></i>
        </button>` : ''}
      </div>
    </div>`
}

function grupoFolhaHTML(titulo, cor, itens) {
  if (!itens.length) return ''
  return `
    <div style="display:flex;align-items:center;gap:6px;margin:10px 2px 6px">
      <span style="width:7px;height:7px;border-radius:50%;background:${cor}"></span>
      <span style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.03em">${titulo}</span>
      <span style="font-size:10px;font-weight:600;color:var(--text-secondary);background:var(--surface);border-radius:10px;padding:1px 7px">${itens.length}</span>
    </div>
    ${itens.map(itemFolhaHTML).join('')}`
}

// FIX #5: renderHistoricoFolha não gera mais sel-comp-notif interno pois ele já existe fixo no index.html
function renderHistoricoFolha(lista) {
  folhaListaCache = lista || []
  const el = document.getElementById('historico-folha'); if (!el) return

  // Atualiza o select de competência fixo no HTML (sem criar um segundo)
  const competencias = [...new Set(folhaListaCache.filter(f => f['STATUS'] === 'Assinado').map(f => f['COMPETÊNCIA']))]
  const selComp = document.getElementById('sel-comp-notif')
  if (selComp && competencias.length) {
    const atual = selComp.value
    selComp.innerHTML = competencias.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    if (atual && competencias.includes(atual)) selComp.value = atual
  }

  const q = (document.getElementById('busca-folha')?.value || '').toLowerCase().trim()
  let filtrada = folhaListaCache
  if (filtroFolhaStatus) filtrada = filtrada.filter(f => (f['STATUS']||'') === filtroFolhaStatus)
  if (q) filtrada = filtrada.filter(f =>
    (f['FUNCIONÁRIO']||'').toLowerCase().includes(q) || (f['COMPETÊNCIA']||'').toLowerCase().includes(q))

  if (!filtrada.length) { el.innerHTML = '<p class="lista-vazia">Nenhum envio encontrado</p>'; return }

  const assinados = filtrada.filter(f => f['STATUS'] === 'Assinado')
  const pendentes = filtrada.filter(f => f['STATUS'] !== 'Assinado')
  el.innerHTML = grupoFolhaHTML('Assinados', 'var(--verde)', assinados)
              + grupoFolhaHTML('Pendentes', 'var(--amber-text)', pendentes)
}

async function notificarPagamentoIndividual(funcId, competencia) {
  mostrarLoading('Gerando notificação...')
  const res = await chamarGAS({ acao: 'gerar_msg_pagamento', dados: { func_id: funcId, competencia } })
  esconderLoading()
  if (!res || !res.ok || !res.data.length) return toast('❌ Erro ao gerar mensagem', 'erro')
  const m = res.data[0]
  if (!m.wa_link) return toast('❌ WhatsApp do empregador não cadastrado', 'erro')
  mostrarModalNotificacao([m])
}

async function notificarPagamentoLote() {
  const competencia = document.getElementById('sel-comp-notif')?.value
  if (!competencia) return toast('❌ Selecione a competência', 'erro')

  mostrarLoading('Gerando mensagens...')
  const resFolhas = await chamarGAS({ acao: 'listar_folhas' })
  if (!resFolhas || !resFolhas.ok) { esconderLoading(); return }

  const assinados = resFolhas.data.filter(f => f['COMPETÊNCIA'] === competencia && f['STATUS'] === 'Assinado')
  const funcIds   = assinados.map(f => f['ID FUNC.'])

  const res = await chamarGAS({ acao: 'gerar_msg_pagamento', dados: { func_ids: funcIds, competencia: normalizarComp(competencia) } })
  esconderLoading()
  if (!res || !res.ok || !res.data.length) return toast('❌ Erro ao gerar mensagens', 'erro')
  mostrarModalNotificacao(res.data, true)
}

async function enviarNotificacaoComLink(funcId, competencia, valorLiquido) {
  mostrarLoading('Gerando link...')
  const res = await chamarGAS({ acao: 'liquidar_salario', dados: {
    func_id:       funcId,
    competencia:   normalizarComp(competencia),
    valor_liquido: valorLiquido ? parseFloat(valorLiquido) : null,
  }})
  esconderLoading()
  if (res && res.ok && res.data.wa_link) {
    window.open(res.data.wa_link, '_blank')
    toast('✅ WhatsApp aberto com link de confirmação!', 'sucesso')
    document.getElementById('modal-notif-pgto')?.remove()
    carregarNotifPendentes()
  } else {
    toast('❌ ' + ((res&&res.erro)||'Erro ao gerar link'), 'erro')
  }
}

function mostrarModalNotificacao(mensagens, editavel) {
  const existente = document.getElementById('modal-notif-pgto')
  if (existente) existente.remove()

  const modal = document.createElement('div')
  modal.id = 'modal-notif-pgto'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:400;display:flex;align-items:flex-end;justify-content:center'

  const lista = mensagens.map(m => `
    <div style="background:#F9FAFB;border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="flex:1;margin-right:8px">
          <div style="font-size:13px;font-weight:600">${m.nome.split(' ')[0]}</div>
          ${m.valor_liquido
            ? `<div style="font-size:11px;color:var(--verde-text);font-weight:600">R$ ${parseFloat(m.valor_liquido).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>`
            : '<div style="font-size:10px;color:var(--amber-text)">Valor não informado</div>'}
        </div>
        <button onclick="enviarNotificacaoComLink('${m.func_id}','${m.competencia||''}','${m.valor_liquido||''}')"
          style="background:#25D366;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">
          <i class="ti ti-brand-whatsapp"></i> Enviar
        </button>
      </div>
      <div style="font-size:10px;color:var(--text-secondary);background:#fff;border-radius:6px;padding:6px 8px;white-space:pre-wrap">${m.mensagem.replace(/\*/g,'')}</div>
    </div>`).join('')

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:16px 16px 32px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 14px"></div>
      <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">💬 Notificações de Pagamento</h3>
      <p style="font-size:12px;color:#6B7280;margin-bottom:14px">${mensagens.length} funcionário(s) — toque em Enviar para cada um</p>
      ${lista}
      <button onclick="document.getElementById('modal-notif-pgto').remove()"
        style="background:var(--verde);color:#fff;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:600;cursor:pointer;width:100%;margin-top:6px">
        ✓ Concluído
      </button>
    </div>`

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

// Separa um PDF em uma página por documento. Devolve os pedaços em base64.
async function separarPaginas(file, PDFLib, rotulo) {
  const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
  const total  = pdfDoc.getPageCount()
  const saida  = []
  for (let i = 0; i < total; i++) {
    mostrarLoading(`Separando ${rotulo} — página ${i + 1} de ${total}...`)
    const novoDoc = await PDFLib.PDFDocument.create()
    const [pag]   = await novoDoc.copyPages(pdfDoc, [i])
    novoDoc.addPage(pag)
    saida.push({ pagina: i + 1, pdfBase64: arrayBufferToBase64(await novoDoc.save()) })
  }
  return saida
}

// Cola dois PDFs de uma página num só. É o que economiza a assinatura: o
// ZapSign cobra por DOCUMENTO, não por página.
async function juntarPdfs(listaBase64) {
  const PDFLib = await carregarPdfLib()
  const doc = await PDFLib.PDFDocument.create()
  for (const b64 of listaBase64) {
    const origem = await PDFLib.PDFDocument.load(base64ParaArrayBuffer(b64))
    const pags   = await doc.copyPages(origem, origem.getPageIndices())
    pags.forEach(p => doc.addPage(p))
  }
  return arrayBufferToBase64(await doc.save())
}

function base64ParaArrayBuffer(b64) {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

async function processarFracionamento() {
  const file        = document.getElementById('input-pdf-frac').files[0]
  const filePonto   = document.getElementById('input-pdf-ponto')?.files[0] || null
  const competencia = document.getElementById('sel-comp-frac').value
  if (!file) return toast('❌ Selecione o PDF', 'erro')
  if (!competencia) return toast('❌ Selecione a competência antes de separar', 'erro')
  // Garante que a lista de funcionários esteja carregada — sem ela a seleção
  // (automática pela IA e manual) fica vazia.
  if (!funcionarios.length) {
    const rf = await chamarGAS({ acao: 'listar_funcionarios' })
    if (rf && rf.ok && Array.isArray(rf.data)) { funcionarios = rf.data; preencherSelectsOcultos() }
  }
  const btn = document.getElementById('btn-fracionar')
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Separando...'
  mostrarLoading('Carregando pdf-lib...')
  try {
    const PDFLib = await carregarPdfLib()
    const doTipo = await separarPaginas(file, PDFLib, tipoDocAtual === 'Ponto' ? 'o ponto' : 'a folha')
    paginasFracionadas = doTipo.map(p => ({
      pagina: p.pagina, funcId:'', nome:'', funcao:'', telefone:'',
      pdfBase64: p.pdfBase64, status:'pronto', signUrl:'', competencia,
      tipoDoc: tipoDocAtual,
    }))

    // O ponto vira uma lista à parte; o pareamento com a folha só acontece
    // depois da identificação, porque a chave é o FUNCIONÁRIO — a ordem das
    // páginas nos dois PDFs não precisa bater.
    paginasPonto = filePonto
      ? (await separarPaginas(filePonto, PDFLib, 'o ponto')).map(p => ({
          pagina: p.pagina, pdfBase64: p.pdfBase64, funcId:'', nome:'', usada:false,
        }))
      : []

    esconderLoading()
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-scissors"></i> Separar PDF'
    document.getElementById('frac-step-wrap').style.display = 'block'
    const resumoEl = document.getElementById('frac-resumo')
    resumoEl.dataset.base = competencia + ' · ' + paginasFracionadas.length + ' página(s) separadas'
      + (paginasPonto.length ? ' + ' + paginasPonto.length + ' de ponto' : '')
    resumoEl.textContent  = resumoEl.dataset.base
    renderPaginasFracionadas()
    atualizarBtnTodos()
    toast('🔍 Identificando funcionários...', '')
    identificarFuncionariosAutomatico()
  } catch(err) {
    esconderLoading(); btn.disabled = false; btn.innerHTML = '<i class="ti ti-scissors"></i> Separar PDF'
    toast('❌ ' + err.message, 'erro')
  }
}

function renderPaginasFracionadas() {
  const el = document.getElementById('frac-lista')
  el.innerHTML = paginasFracionadas.map((p, i) => `
    <div class="frac-page-card" id="fpc-${i}">
      <div class="fpc-header">
        <span class="fpc-num" id="fpc-num-${i}"><i class="ti ti-file-text" style="font-size:11px;vertical-align:-1px"></i> Página ${p.pagina}</span>
        <div class="fpc-actions">
          <button class="btn-ver-frac" onclick="visualizarPagina(${i})"><i class="ti ti-eye"></i> Ver</button>
          <div id="fpc-action-${i}">
            <button class="btn-enviar-frac" onclick="abrirModalEnvioFolha(${i})" id="btn-zap-${i}" disabled>
              <i class="ti ti-brand-whatsapp"></i> Enviar
            </button>
          </div>
        </div>
      </div>
      <div id="fpc-func-${i}">
        <div style="font-size:11px;color:var(--text-hint);display:flex;align-items:center;gap:4px">
          <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
          Identificando automaticamente...
        </div>
      </div>
      <div id="fpc-anexo-${i}"></div>
      <div id="fpc-valor-${i}"></div>
    </div>`).join('')
}

// Selo do que vai dentro do documento enviado. Sem ele, o usuário não teria
// como saber que o ponto entrou junto — nem que uma assinatura foi poupada.
function renderAnexoPonto(i) {
  const el = document.getElementById('fpc-anexo-' + i); if (!el) return
  const p = paginasFracionadas[i]
  if (p.soPonto) {
    el.innerHTML = `<div class="fpc-anexo aviso"><i class="ti ti-alert-triangle"></i>
      Só ponto — sem folha deste funcionário no PDF</div>`
  } else if (p.ponto) {
    el.innerHTML = `<div class="fpc-anexo"><i class="ti ti-paperclip"></i>
      Folha + ponto (pág. ${p.ponto.pagina}) num documento só · <strong>1 assinatura</strong></div>`
  } else {
    el.innerHTML = ''
  }
}

// ── Valor líquido da página ───────────────────────────────────────
// É o valor que vira a ordem de pagamento quando o funcionário assina. A IA
// erra em holerite de layout incomum, e antes disso não aparecia em lugar
// nenhum: o valor sumia calado e a ordem saía "(verificar holerite)". Agora
// fica à vista e editável antes do envio.
function renderValorPagina(i) {
  const el = document.getElementById('fpc-valor-' + i); if (!el) return
  const p  = paginasFracionadas[i]
  const v  = p.valorLiquido
  const tem = v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v))
  el.innerHTML = `
    <div class="fpc-valor ${tem ? '' : 'vazio'}">
      <span class="fpc-valor-lbl">${tem ? '<i class="ti ti-cash"></i> Líquido' : '<i class="ti ti-alert-triangle"></i> Sem valor'}</span>
      <span class="fpc-valor-pre">R$</span>
      <input type="text" inputmode="decimal" class="fpc-valor-in" id="fpc-valor-in-${i}"
             value="${tem ? formatarValor(v) : ''}" placeholder="0,00"
             onchange="definirValorPagina(${i}, this.value)"
             onblur="definirValorPagina(${i}, this.value)">
      ${tem && p.valorOrigem === 'ia' ? '<span class="fpc-valor-tag">pela IA</span>' : ''}
    </div>`
}

function definirValorPagina(i, texto) {
  const n = parseValorNum(texto)
  paginasFracionadas[i].valorLiquido = n > 0 ? n : null
  paginasFracionadas[i].valorOrigem  = n > 0 ? 'manual' : ''
  renderValorPagina(i)
  atualizarBtnTodos()
}

// ── Mapeamento salvo ──────────────────────────────────────────────
function salvarMapeamento(competencia) {
  const mapa = {}
  paginasFracionadas.forEach(p => { if (p.funcId) mapa[p.pagina] = p.funcId })
  try { sessionStorage.setItem('mapa_folha_' + competencia, JSON.stringify(mapa)) } catch(e) {}
}

function carregarMapeamentoSalvo(competencia) {
  try {
    const raw = sessionStorage.getItem('mapa_folha_' + competencia)
    return raw ? JSON.parse(raw) : null
  } catch(e) { return null }
}

async function identificarFuncionariosAutomatico() {
  const competencia = paginasFracionadas[0]?.competencia || ''
  const mapaAnterior = carregarMapeamentoSalvo(competencia)
  let identificados = 0

  const promessas = paginasFracionadas.map((p, i) =>
    chamarGAS({ acao: 'identificar_com_ia', dados: { pdf_base64: p.pdfBase64 } })
      .catch(() => null)
  )

  for (let i = 0; i < promessas.length; i++) {
    const res = await promessas[i]
    let func = null
    let tipoIA = '', compIA = ''

    if (res && res.ok && res.data) {
      const d = res.data
      tipoIA = d.tipo_documento || ''
      compIA = d.competencia    || ''

      if (tipoIA && paginasFracionadas[i].tipoDoc !== 'Ferias') paginasFracionadas[i].tipoDoc = tipoIA
      if (compIA) paginasFracionadas[i].competencia  = compIA
      if (d.valor_liquido !== null && d.valor_liquido !== undefined && d.valor_liquido !== '') {
        paginasFracionadas[i].valorLiquido = d.valor_liquido
        paginasFracionadas[i].valorOrigem  = 'ia'
      }
      if (d.ferias_inicio) paginasFracionadas[i].feriasInicio = d.ferias_inicio
      if (d.ferias_fim)    paginasFracionadas[i].feriasFim    = d.ferias_fim

      if (d.func_id) {
        func = funcionarios.find(f => String(f['ID']) === String(d.func_id))
        if (func) {
          // Empregador do documento diverge do cadastrado: o casamento pode
          // estar errado, então pede conferência em vez de aceitar calado.
          func._metodo = d.empregador_confere === false ? 'conferir' : 'ia'
          func._empregadorDoc = d.empregador || ''
          paginasFracionadas[i].funcId    = String(func['ID'])
          paginasFracionadas[i].nome      = func['NOME_COMPLETO']
          paginasFracionadas[i].telefone  = func['TELEFONE'] || ''
        }
      }
    }

    if (!func && mapaAnterior && mapaAnterior[paginasFracionadas[i].pagina]) {
      const savedId = mapaAnterior[paginasFracionadas[i].pagina]
      func = funcionarios.find(f => String(f['ID']) === String(savedId))
      if (func) func._metodo = 'cache'
    }

    if (func) {
      paginasFracionadas[i].funcId    = String(func['ID'])
      paginasFracionadas[i].nome      = func['NOME_COMPLETO']
      paginasFracionadas[i].funcao    = func['FUNCAO']
      paginasFracionadas[i].telefone  = func['TELEFONE']
      renderCardIdentificado(i, func, func._metodo || 'auto')
      identificados++
    } else {
      renderCardManual(i)
    }
    renderValorPagina(i)
    renderAnexoPonto(i)
    atualizarBtnTodos()
  }

  if (identificados > 0) salvarMapeamento(competencia)

  if (paginasPonto.length) await identificarPonto()

  toast(identificados === paginasFracionadas.length
    ? '🤖 IA identificou todos os ' + identificados + ' funcionários!'
    : '🤖 ' + identificados + ' identificados · ' + (paginasFracionadas.length - identificados) + ' selecione manualmente',
    identificados > 0 ? 'sucesso' : '')
}

// ── Ponto na mesma assinatura ─────────────────────────────────────
// Identifica de quem é cada página do ponto e junta na folha do mesmo
// funcionário. Um documento só no ZapSign = uma assinatura só cobrada.
async function identificarPonto() {
  toast('🔍 Identificando o ponto...', '')
  const promessas = paginasPonto.map(p =>
    chamarGAS({ acao: 'identificar_com_ia', dados: { pdf_base64: p.pdfBase64 } }).catch(() => null))

  for (let i = 0; i < promessas.length; i++) {
    const res = await promessas[i]
    const d = res && res.ok ? res.data : null
    if (d && d.func_id) {
      const f = funcionarios.find(x => String(x['ID']) === String(d.func_id))
      if (f) { paginasPonto[i].funcId = String(f['ID']); paginasPonto[i].nome = f['NOME_COMPLETO'] }
    }
  }
  await parearPonto()
}

// Junta, por funcionário, a página de ponto na folha. Idempotente: pode
// rodar de novo depois de o usuário corrigir uma identificação à mão.
async function parearPonto() {
  if (!paginasPonto.length) return
  paginasPonto.forEach(p => { p.usada = false })

  for (const p of paginasFracionadas) {
    // Já enviado é imutável: o que entrou no documento entrou. Mas o ponto
    // dele continua reservado — sem isso ele voltaria a aparecer como órfão,
    // e alguém mandaria de novo o que já foi assinado.
    if (p.status === 'enviado') {
      if (p.ponto) p.ponto.usada = true
      continue
    }
    p.ponto = null; p.pdfEnvio = null
    if (!p.funcId) continue
    const par = paginasPonto.find(q => !q.usada && q.funcId && String(q.funcId) === String(p.funcId))
    if (!par) continue
    par.usada = true
    p.ponto = par
    // Folha primeiro, ponto depois: a página 1 é a que o classifica_conteudo
    // do servidor lê para decidir a pasta do arquivo.
    p.pdfEnvio = await juntarPdfs([p.pdfBase64, par.pdfBase64])
  }

  // Ponto sem folha correspondente não some calado — vira card próprio, para
  // ser enviado separado (aí sim com assinatura própria).
  const orfaos = paginasPonto.filter(q => !q.usada)
  paginasFracionadas = paginasFracionadas.filter(p => !p.soPonto)
  orfaos.forEach(q => {
    const f = q.funcId ? funcionarios.find(x => String(x['ID']) === String(q.funcId)) : null
    paginasFracionadas.push({
      pagina: q.pagina, funcId: q.funcId || '', nome: q.nome || '',
      funcao: f ? f['FUNCAO'] : '', telefone: f ? f['TELEFONE'] : '',
      pdfBase64: q.pdfBase64, status: 'pronto', signUrl: '',
      competencia: paginasFracionadas[0]?.competencia || '',
      tipoDoc: 'Ponto', soPonto: true,
    })
  })

  renderPaginasFracionadas()
  paginasFracionadas.forEach((p, i) => {
    const f = p.funcId ? funcionarios.find(x => String(x['ID']) === String(p.funcId)) : null
    if (f) renderCardIdentificado(i, f, p._metodo || 'auto')
    else renderCardManual(i)
    renderValorPagina(i)
    renderAnexoPonto(i)
  })
  atualizarBtnTodos()

  const juntados = paginasFracionadas.filter(p => p.ponto).length
  if (juntados) toast(`📎 ${juntados} ponto(s) juntado(s) — ${juntados} assinatura(s) economizada(s)`, 'sucesso')
  if (orfaos.length) toast(`⚠️ ${orfaos.length} página(s) de ponto sem folha correspondente`, 'aviso')
}

function renderCardIdentificado(i, func, metodo) {
  const card = document.getElementById('fpc-' + i); if (!card) return
  card.className = 'frac-page-card ' + (metodo === 'conferir' ? 'manual' : 'identificado')
  document.getElementById('fpc-num-' + i).innerHTML = `<i class="ti ti-file-text" style="font-size:11px;vertical-align:-1px"></i> Página ${paginasFracionadas[i].pagina}`
  document.getElementById('fpc-func-' + i).innerHTML = `
    <div class="fpc-func">
      <div class="fpc-av">${getIniciais(func['NOME_COMPLETO'])}</div>
      <div style="flex:1;min-width:0">
        <div class="fpc-nome">${esc(func['NOME_COMPLETO'])}</div>
        <div class="fpc-sub">${esc(func['FUNCAO']||'')} · ${esc(func['UNIDADE']||'')}</div>
        ${metodo === 'conferir'
            ? `<div class="fpc-conferir"><i class="ti ti-alert-triangle" style="font-size:9px"></i> Empregador do documento (${esc(func._empregadorDoc || '?')}) difere do cadastro (${esc(func['EMPREGADOR'] || '—')}) — confira</div>`
            : metodo === 'ia' || metodo === 'auto' ? `<div class="fpc-auto"><i class="ti ti-robot" style="font-size:9px"></i> Identificado pela IA</div>`
            : metodo === 'cache' ? `<div class="fpc-auto"><i class="ti ti-history" style="font-size:9px"></i> Mapeamento salvo — confirme</div>`
            : '<div class="fpc-manual-tag">Selecionado manualmente</div>'}
      </div>
      <button class="btn-trocar-func" onclick="renderCardManual(${i})"><i class="ti ti-switch-horizontal" style="font-size:11px"></i> Trocar</button>
    </div>`
  const btnEl = document.getElementById('btn-zap-' + i)
  if (btnEl) btnEl.disabled = false
}

function renderCardManual(i) {
  const card = document.getElementById('fpc-' + i); if (!card) return
  card.className = 'frac-page-card manual'
  const numEl = document.getElementById('fpc-num-' + i)
  if (numEl) { numEl.className = 'fpc-num manual'; numEl.innerHTML = `<i class="ti ti-alert-triangle" style="font-size:10px;vertical-align:-1px"></i> Pág. ${paginasFracionadas[i].pagina} — selecione` }
  const selId = String(paginasFracionadas[i].funcId || '')
  const wrap  = document.getElementById('fpc-func-' + i)

  if (!funcionarios.length) {
    wrap.innerHTML = `
      <div style="font-size:11px;color:var(--amber-text);display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span><i class="ti ti-alert-circle" style="font-size:12px;vertical-align:-1px"></i> Lista de funcionários não carregada.</span>
        <button class="btn-trocar-func" onclick="recarregarFuncionariosFrac(${i})"><i class="ti ti-refresh" style="font-size:11px"></i> Recarregar</button>
      </div>`
    return
  }

  wrap.innerHTML = `
    <select class="frac-select-manual" onchange="selecionarFuncManual(${i}, this.value)">
      <option value="">Selecione o funcionário...</option>
      ${funcionarios.map(f => `<option value="${esc(f['ID'])}"${String(f['ID']) === selId ? ' selected' : ''}>${esc(f['NOME_COMPLETO'])}</option>`).join('')}
    </select>`
  const btnEl = document.getElementById('btn-zap-' + i)
  if (btnEl) btnEl.disabled = !selId
}

async function recarregarFuncionariosFrac(i) {
  const res = await chamarGAS({ acao: 'listar_funcionarios' })
  if (res && res.ok && Array.isArray(res.data)) {
    funcionarios = res.data
    preencherSelectsOcultos()
    renderCardManual(i)
  } else {
    toast('❌ Não foi possível carregar os funcionários', 'erro')
  }
}

function selecionarFuncManual(i, funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId)); if (!func) return
  paginasFracionadas[i].funcId   = funcId
  paginasFracionadas[i].nome     = func['NOME_COMPLETO']
  paginasFracionadas[i].funcao   = func['FUNCAO']
  paginasFracionadas[i].telefone = func['TELEFONE']
  renderCardIdentificado(i, func, 'manual')
  renderValorPagina(i)
  // A folha mudou de dono: o ponto que estava junto pode não ser mais dele.
  if (paginasPonto.length) parearPonto()
  else { renderAnexoPonto(i); atualizarBtnTodos() }
}

function visualizarPagina(idx) {
  const p = paginasFracionadas[idx]; if (!p || !p.pdfBase64) return toast('❌ PDF indisponível', 'erro')
  // Mostra o documento COMO SERÁ ASSINADO — com o ponto junto, se houver.
  const b64 = p.pdfEnvio || p.pdfBase64
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'application/pdf' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function abrirModalEnvioFolha(idx) {
  const modal = document.createElement('div')
  modal.id = 'modal-envio-folha-' + idx
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 32px;width:100%;max-width:480px">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 16px"></div>
      <h3 style="font-size:15px;font-weight:600;color:#1A1A1A;margin-bottom:6px;text-align:center">Como deseja enviar?</h3>
      <p style="font-size:12px;color:#6B7280;text-align:center;margin-bottom:16px">Página ${paginasFracionadas[idx].pagina} — ${paginasFracionadas[idx].nome.split(' ')[0]}</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="document.getElementById('modal-envio-folha-${idx}').remove();enviarPaginaZapSign(${idx})" style="background:#1A5C2A;color:#fff;border:none;border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">📲</span>
          <div style="text-align:left"><div>ZapSign — WhatsApp automático</div><div style="font-size:10px;opacity:0.8;font-weight:400">Link via WhatsApp automático</div></div>
        </button>
        <button onclick="document.getElementById('modal-envio-folha-${idx}').remove();enviarPaginaAssinaturaPropria(${idx}, paginasFracionadas[${idx}].tipoDoc || tipoDocAtual)" style="background:#E6F1FB;color:#185FA5;border:0.5px solid rgba(24,95,165,0.2);border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✍️</span>
          <div style="text-align:left"><div>Assinatura própria — sem ZapSign</div><div style="font-size:10px;opacity:0.7;font-weight:400">Gera link para assinar com o dedo</div></div>
        </button>
        <button onclick="document.getElementById('modal-envio-folha-${idx}').remove()" style="background:none;border:none;color:#6B7280;font-size:13px;padding:10px;cursor:pointer">Cancelar</button>
      </div>
    </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

async function enviarPaginaZapSign(idx) {
  const p = paginasFracionadas[idx]
  if (!p.funcId) return toast('❌ Selecione o funcionário primeiro', 'erro')
  const btn = document.getElementById('btn-zap-' + idx)
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>'
  mostrarLoading('Enviando para ' + p.nome.split(' ')[0] + '...')
  const res = await chamarGAS({ acao: 'processar_pagina_folha', dados: { pdf_base64: p.pdfEnvio || p.pdfBase64, inclui_ponto: !!p.ponto, competencia: p.competencia, nome_funcionario: p.nome, pagina: p.pagina, enviar_zapsign: true, tipo: p.tipoDoc || tipoDocAtual, valor_liquido: p.valorLiquido || null, ferias_inicio: p.feriasInicio || null, ferias_fim: p.feriasFim || null } })
  esconderLoading()
  if (res && res.ok) {
    paginasFracionadas[idx].status  = 'enviado'
    paginasFracionadas[idx].signUrl = res.data.sign_url || ''
    const card = document.getElementById('fpc-' + idx)
    if (card) card.className = 'frac-page-card enviado'
    const numEl = document.getElementById('fpc-num-' + idx)
    if (numEl) { numEl.className = 'fpc-num enviado'; numEl.innerHTML = `<i class="ti ti-circle-check" style="font-size:11px;vertical-align:-1px"></i> Pág. ${p.pagina} — Enviado` }
    const actionEl = document.getElementById('fpc-action-' + idx)
    if (actionEl) {
      let links = `<span class="btn-enviado-frac"><i class="ti ti-check"></i></span>`
      if (res.data.sign_url) {
        links += `<a href="${res.data.sign_url}" target="_blank" class="btn-link-frac"><i class="ti ti-external-link"></i> Link</a>`
        const tel = telWhats(p.telefone)
        const waUrl = `https://wa.me/${tel}?text=${encodeURIComponent('Olá '+p.nome.split(' ')[0]+', assine seu holerite: '+res.data.sign_url)}`
        links += `<a href="${waUrl}" target="_blank" class="btn-wa-frac"><i class="ti ti-brand-whatsapp"></i></a>`
      }
      actionEl.innerHTML = `<div class="fpc-links">${links}</div>`
    }
    salvarMapeamento(p.competencia)
    atualizarBtnTodos()
    toast('✅ ' + p.nome.split(' ')[0] + ' — enviado!', 'sucesso')
    carregarEntregasFolha()
  } else {
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> Enviar'
    toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
  }
}

async function enviarTodasPendentes(metodo) {
  metodo = metodo || 'zapsign'
  const pendentes = paginasFracionadas.filter(p => p.funcId && p.status === 'pronto')
  if (!pendentes.length) return toast('⚠️ Nenhum pronto para enviar', 'erro')

  if (metodo === 'proprio') {
    mostrarLoading('Gerando links de assinatura para ' + pendentes.length + ' funcionários...')
    const links = []

    for (let i = 0; i < paginasFracionadas.length; i++) {
      const p = paginasFracionadas[i]
      if (!p.funcId || p.status !== 'pronto') continue
      mostrarLoading('Gerando link ' + (links.length + 1) + '/' + pendentes.length + ' — ' + p.nome.split(' ')[0])
      const res = await chamarGAS({
        acao: 'processar_pagina_proprio',
        dados: { pdf_base64: p.pdfEnvio || p.pdfBase64, inclui_ponto: !!p.ponto, tipo: p.tipoDoc || tipoDocAtual,
                 competencia: p.competencia, func_id: p.funcId, func_nome: p.nome, pagina: p.pagina,
                 valor_liquido: p.valorLiquido || null, ferias_inicio: p.feriasInicio || null, ferias_fim: p.feriasFim || null }
      })
      if (res && res.ok) {
        paginasFracionadas[i].status = 'enviado'
        atualizarCardEnviado(i, res.data)
        links.push({ nome: p.nome.split(' ')[0], telefone: p.telefone, link: res.data.link, wa_link: res.data.wa_link })
      }
    }
    esconderLoading()
    atualizarBtnTodos()

    if (links.length) {
      toast('✅ ' + links.length + ' links gerados! Abrindo WhatsApp...', 'sucesso')
      await abrirWhatsAppSequencial(links)
    }
    carregarEntregasFolha()

  } else {
    for (let i = 0; i < paginasFracionadas.length; i++) {
      const p = paginasFracionadas[i]
      if (!p.funcId || p.status !== 'pronto') continue
      await enviarPaginaZapSign(i)
    }
  }
}

async function abrirWhatsAppSequencial(links) {
  const existente = document.getElementById('modal-wa-lote')
  if (existente) existente.remove()

  const modal = document.createElement('div')
  modal.id = 'modal-wa-lote'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:400;display:flex;align-items:flex-end;justify-content:center'

  const lista = links.map((l, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#F9FAFB;border-radius:10px;margin-bottom:6px">
      <div class="avatar" style="background:var(--verde-claro);color:var(--verde-text);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0">
        ${l.nome.substring(0,2).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${l.nome}</div>
        <div style="font-size:10px;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.link}</div>
      </div>
      <a href="${l.wa_link}" target="_blank"
        style="background:#22C55E;color:#fff;border-radius:8px;padding:8px 10px;font-size:13px;text-decoration:none;display:flex;align-items:center;gap:4px;flex-shrink:0;font-weight:600">
        <i class="ti ti-brand-whatsapp"></i>
      </a>
    </div>`).join('')

  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 32px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 16px"></div>
      <h3 style="font-size:15px;font-weight:600;color:#1A1A1A;margin-bottom:4px">✅ ${links.length} links gerados</h3>
      <p style="font-size:12px;color:#6B7280;margin-bottom:14px">Toque no botão WhatsApp para enviar o link para cada funcionário</p>
      ${lista}
      <button onclick="document.getElementById('modal-wa-lote').remove()"
        style="background:var(--verde);color:#fff;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:600;cursor:pointer;width:100%;margin-top:10px">
        ✓ Concluído
      </button>
    </div>`

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

function atualizarBtnTodos() {
  const pendentes = paginasFracionadas.filter(p => p.funcId && p.status === 'pronto').length
  const btn = document.getElementById('btn-enviar-todos')
  const lbl = document.getElementById('btn-todos-label')
  if (!btn || !lbl) return
  lbl.textContent = pendentes > 0 ? 'Enviar ' + pendentes + ' pendente(s) via WhatsApp' : 'Todos enviados ✅'
  btn.disabled = pendentes === 0

  // Aviso de valor faltando: sem ele a ordem de pagamento sai sem o líquido,
  // e o empregador só descobre na hora de pagar.
  const semValor = paginasFracionadas.filter(p =>
    p.funcId && p.status === 'pronto' && !(parseValorNum(p.valorLiquido) > 0)).length
  const res = document.getElementById('frac-resumo')
  if (res) {
    const base = res.dataset.base || res.textContent
    res.dataset.base = base
    res.innerHTML = semValor > 0
      ? esc(base) + ` · <span style="color:var(--amber-text)"><i class="ti ti-alert-triangle" style="font-size:10px;vertical-align:-1px"></i> ${semValor} sem valor líquido</span>`
      : esc(base)
  }
}

// ─── SELECTS OCULTOS ──────────────────────────────────────────────
function preencherSelectsOcultos() {
  popularSelectPgto()
  const selFunc = document.getElementById('sel-func-epi-hidden')
  if (selFunc) {
    selFunc.innerHTML = '<option value="">Selecione...</option>' +
      funcionarios.map(f => `<option value="${esc(f['ID'])}">${esc(f['NOME_COMPLETO'])}</option>`).join('')
  }
  const selEpi = document.getElementById('sel-epi-hidden')
  if (selEpi && estoque.length) {
    selEpi.innerHTML = '<option value="">Selecione...</option>' +
      estoque.filter(e => parseInt(e['ESTOQUE ATUAL']) > 0)
        .map(e => `<option value="${esc(e['CÓD.'])}">${esc(e['CÓD.'])} — ${esc(e['DESCRIÇÃO DO EPI'])}</option>`).join('')
  }
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────
function arrayBufferToBase64(buffer) {
  let binary = ''; const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Escapa texto para inserção segura em innerHTML (evita XSS/quebra de layout
// quando campos livres como Observações contêm < > & " ')
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// FIX #2: badge-cinza adicionado ao mapa
function badge(status) {
  const map = {
    '✅ VIGENTE':'badge-verde','⚠️ A VENCER':'badge-amarelo','⛔ VENCIDO':'badge-vermelho',
    '⏳ PENDENTE':'badge-cinza','Ativo':'badge-verde','Inativo':'badge-vermelho',
    'Sim':'badge-verde','Não':'badge-cinza','Pendente':'badge-amarelo',
    'Assinado':'badge-verde','Salvo':'badge-azul','pronto':'badge-cinza',
    'enviado':'badge-verde','✅ OK':'badge-verde','⚠️ REPOR':'badge-amarelo',
    '⛔ SEM ESTOQUE':'badge-vermelho','⛔ Recusado':'badge-vermelho',
    '—':'badge-cinza',
  }
  return `<span class="badge ${map[status]||'badge-cinza'}">${status||'—'}</span>`
}

function toast(msg, tipo) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'toast ' + (tipo||'')
  el.style.display = 'block'
  setTimeout(() => el.style.display = 'none', 3000)
}

function mostrarLoading(msg) {
  document.getElementById('loading-msg').textContent = msg||'Carregando...'
  document.getElementById('loading').style.display = 'flex'
}
function esconderLoading() { document.getElementById('loading').style.display = 'none' }

// ═══════════════════════════════════════════════════════════════════
// MÓDULO: CONTROLE DE PAGAMENTO
// ═══════════════════════════════════════════════════════════════════

let funcPgtoSelecionado = null
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function formatarValor(v) {
  if (!v && v !== 0) return '0,00'
  const s = String(v).trim().replace(/R\$\s*/g,'')
  let n
  if (s.indexOf(',') === -1) n = parseFloat(s)
  else n = parseFloat(s.replace(/\./g,'').replace(',','.'))
  if (isNaN(n)) return String(v)
  const parts = n.toFixed(2).split('.')
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + parts[1]
}

// Converte valores em string ("1.234,56", "R$ 1.234,56", "1234.56") para número.
// Mesma lógica de parsing de formatarValor — evita que o separador de milhar quebre a soma.
function parseValorNum(v) {
  if (typeof v === 'number') return v
  const s = String(v == null ? '' : v).trim().replace(/R\$\s*/g, '')
  if (!s) return 0
  let t = s
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.')
  else {
    // "3.565" (3 digitos depois do unico ponto) e milhar, nao decimal.
    const partes = t.split('.')
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) t = partes.join('')
  }
  const n = parseFloat(t)
  return isNaN(n) ? 0 : n
}

function normalizarComp(comp) {
  const s = String(comp||'').trim()
  const m = s.match(/([A-Z][a-z]{2})\s+\d{2}\s+(\d{4})/)
  const eng = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}
  if (m && eng[m[1]] !== undefined) return MESES[eng[m[1]]] + '/' + m[2]
  const d1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (d1) return MESES[parseInt(d1[2])-1] + '/' + d1[3]
  const d2 = s.match(/^(\d{2})\/(\d{4})$/)
  if (d2) return MESES[parseInt(d2[1])-1] + '/' + d2[2]
  return s
}

async function iniciarPagamento() {
  carregarNotifPendentes()
  if (!funcionarios.length) {
    const res = await chamarGAS({ acao: 'listar_funcionarios' })
    if (res && res.ok) { funcionarios = res.data; preencherSelectsOcultos() }
  }
  popularSelectPgto()
  const selAno = document.getElementById('sel-ano-pgto')
  if (selAno && !selAno.options.length) {
    const ano = new Date().getFullYear()
    let opts = ''
    for (let a = ano; a >= ano-3; a--) opts += `<option value="${a}">${a}</option>`
    selAno.innerHTML = opts
  }
  const inpData = document.getElementById('inp-data-adiant')
  if (inpData && !inpData.value) inpData.value = new Date().toISOString().split('T')[0]
}

function popularSelectPgto() {
  const sel = document.getElementById('sel-func-pgto')
  if (!sel) return
  sel.innerHTML = '<option value="">Selecione...</option>' +
    funcionarios.map(f => `<option value="${esc(f['ID'])}">${esc(f['NOME_COMPLETO'])}</option>`).join('')
}

function selecionarFuncPgto(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  funcPgtoSelecionado = func

  document.getElementById('pgto-func-avatar').textContent = getIniciais(func['NOME_COMPLETO'])
  document.getElementById('pgto-func-nome').textContent   = func['NOME_COMPLETO']
  document.getElementById('pgto-func-nome').style.color   = 'var(--text-primary)'
  document.getElementById('pgto-func-sub').textContent    = (func['FUNCAO']||'') + ' · ' + (func['UNIDADE']||'')

  const comp = document.getElementById('txt-comissao-anual')
  if (comp) comp.value = func['COMISSAO_ANUAL'] ? 'R$ ' + formatarValor(func['COMISSAO_ANUAL']) : 'Não cadastrado'

  ;['card-hist-pagamentos','card-comissao-func','card-extrato'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'block'
  })

  const ano = new Date().getFullYear()
  const ini = document.getElementById('ext-inicio')
  const fim = document.getElementById('ext-fim')
  if (ini) ini.value = `${ano}-01-01`
  if (fim) fim.value = new Date().toISOString().split('T')[0]

  carregarResumoPgto()
  carregarHistoricoPagamentos()
  carregarAnaliseFolha()
  gerarExtrato()
}

async function carregarResumoPgto() {
  if (!funcPgtoSelecionado) return
  const ano = document.getElementById('sel-ano-pgto')?.value || new Date().getFullYear()
  document.getElementById('ano-label-pgto').textContent = ano

  const res = await chamarGAS({ acao: 'resumo_comissao', dados: { func_id: funcPgtoSelecionado['ID'], ano } })
  if (!res || !res.ok) return
  const d   = res.data
  const pct = Math.min(d.percentual || 0, 100)
  const cor = pct >= 100 ? 'var(--verde)' : pct >= 50 ? 'var(--amber-text)' : 'var(--blue-text)'

  document.getElementById('comissao-resumo-body').innerHTML = `
    <div style="text-align:center;margin-bottom:12px">
      <div style="font-size:11px;color:var(--text-secondary);font-weight:600">Saldo a pagar</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-0.02em;color:${d.saldo>0?'var(--amber-text)':'var(--verde-text)'}">R$ ${formatarValor(d.saldo)}</div>
    </div>
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:6px;height:10px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${cor};border-radius:6px;transition:width .3s"></div>
    </div>
    <div style="font-size:10px;color:var(--text-secondary);text-align:center;margin:6px 0 12px">${pct}% pago de R$ ${formatarValor(d.valor_anual)}</div>
    <div style="display:flex;gap:8px">
      <div style="flex:1;background:var(--surface);border-radius:12px;padding:11px;text-align:center">
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:2px">Total anual</div>
        <div style="font-size:14px;font-weight:700">R$ ${formatarValor(d.valor_anual)}</div>
      </div>
      <div style="flex:1;background:var(--verde-claro);border-radius:12px;padding:11px;text-align:center">
        <div style="font-size:10px;color:var(--verde-text);margin-bottom:2px">Total pago</div>
        <div style="font-size:14px;font-weight:700;color:var(--verde-text)">R$ ${formatarValor(d.total_pago)}</div>
      </div>
    </div>`

  renderAdiantamentos(d.adiantamentos || [])
  const cardAdiant = document.getElementById('card-hist-adiant')
  if (cardAdiant) cardAdiant.style.display = d.adiantamentos?.length ? 'block' : 'none'
}

let adiantamentosCache = []
function renderAdiantamentos(lista) {
  adiantamentosCache = lista || []
  const el = document.getElementById('lista-adiantamentos')
  if (!el) return
  if (!adiantamentosCache.length) { el.innerHTML = '<p class="lista-vazia">Nenhum adiantamento</p>'; return }
  el.innerHTML = adiantamentosCache.map((a, i) => `
    <div class="lista-item">
      <div class="lista-item-info">
        <div class="lista-item-nome">R$ ${formatarValor(a['VALOR'])}</div>
        <div class="lista-item-sub">${esc(a['DATA_PAGTO'])} · ${esc(a['FORMA_PAGTO'])}${a['OBSERVACOES']?' · '+esc(a['OBSERVACOES']):''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="badge badge-verde">Pago</span>
        <button onclick="abrirReciboAdiantamento(${i})" title="Recibo"
          style="background:var(--verde-claro);color:var(--verde-text);border:none;border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px">
          <i class="ti ti-receipt"></i>
        </button>
      </div>
    </div>`).join('')
}

// ── RECIBO DE ADIANTAMENTO ────────────────────────────────────────
function abrirPdfBase64(b64, nome) {
  const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function abrirReciboAdiantamento(idx) {
  const a = adiantamentosCache[idx]; if (!a) return
  const modal = document.createElement('div')
  modal.id = 'modal-recibo-op'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;justify-content:center'
  modal.innerHTML = `
    <div style="background:var(--card-bg,#fff);border-radius:20px 20px 0 0;padding:20px 16px 32px;width:100%;max-width:480px">
      <div style="width:36px;height:4px;background:#E5E7EB;border-radius:2px;margin:0 auto 16px"></div>
      <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;text-align:center">Recibo de adiantamento</h3>
      <p style="font-size:12px;color:var(--text-secondary);text-align:center;margin-bottom:16px">R$ ${formatarValor(a['VALOR'])} · ${esc(a['DATA_PAGTO']||'')}</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="document.getElementById('modal-recibo-op').remove();reciboAdiantamentoImpresso(${idx})"
          style="background:#185FA5;color:#fff;border:none;border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">🖨️</span>
          <div style="text-align:left"><div>Imprimir / Baixar</div><div style="font-size:10px;opacity:0.85;font-weight:400">PDF para assinar à mão</div></div>
        </button>
        <button onclick="document.getElementById('modal-recibo-op').remove();abrirAssinaturaReciboAdiant(${idx})"
          style="background:#1A5C2A;color:#fff;border:none;border-radius:12px;padding:14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">✍️</span>
          <div style="text-align:left"><div>Assinar no app</div><div style="font-size:10px;opacity:0.85;font-weight:400">Assine e posicione a assinatura no PDF</div></div>
        </button>
        <button onclick="document.getElementById('modal-recibo-op').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:13px;padding:10px;cursor:pointer">Cancelar</button>
      </div>
    </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

function dadosReciboAdiant(idx) {
  const a = adiantamentosCache[idx]
  return {
    func_id: funcPgtoSelecionado?.['ID'], ano: a['ANO'],
    valor: a['VALOR'], data_pagto: a['DATA_PAGTO'],
    forma_pagto: a['FORMA_PAGTO'], observacoes: a['OBSERVACOES']
  }
}

async function reciboAdiantamentoImpresso(idx) {
  if (!funcPgtoSelecionado) return toast('❌ Selecione o funcionário', 'erro')
  mostrarLoading('Gerando recibo...')
  const res = await chamarGAS({ acao: 'gerar_recibo_adiantamento', dados: { ...dadosReciboAdiant(idx), modo: 'impresso' } })
  esconderLoading()
  if (res && res.ok && res.data?.pdf_base64) { abrirPdfBase64(res.data.pdf_base64); toast('✅ Recibo gerado', 'sucesso') }
  else toast('❌ ' + ((res&&res.erro)||'Erro ao gerar recibo'), 'erro')
}

// ── Assinatura própria com posicionamento ─────────────────────────
let _reciboSig = { b64: null, idx: null, x: 30, y: 72, w: 34 }

function reciboPreviewHTML(func, a) {
  return `
    <div style="padding:6% 6%;font-family:Arial,sans-serif;color:#222;height:100%;box-sizing:border-box;font-size:2.6vw">
      <div style="background:#1A5C2A;color:#fff;padding:4% 5%;border-radius:3px">
        <div style="font-weight:bold;font-size:3.2vw">Fazenda Água Viva</div>
        <div style="font-size:2vw;opacity:.85">Sistema SST — Recibo de Adiantamento de Comissão</div>
      </div>
      <div style="text-align:center;font-weight:bold;color:#1A5C2A;margin:5% 0 1%;font-size:3vw">RECIBO DE ADIANTAMENTO DE COMISSÃO</div>
      <div style="text-align:center;font-weight:bold;color:#1A5C2A;font-size:4.4vw;margin-bottom:4%">R$ ${formatarValor(a['VALOR'])}</div>
      <div style="text-align:justify;line-height:1.7;margin:3% 0">Recebi de <b>FAZENDA ÁGUA VIVA</b> a importância acima, a título de <b>adiantamento de comissão</b> referente ao exercício de <b>${esc(a['ANO']||'')}</b>, dando plena e geral quitação.</div>
      <div style="background:#f6faf3;border:1px solid #d9e8cc;border-radius:5px;padding:4%;margin:4% 0">
        <div style="margin:2% 0"><b>Funcionário:</b> ${esc(func['NOME_COMPLETO']||'')}</div>
        <div style="margin:2% 0"><b>CPF:</b> ${esc(func['CPF']||'—')}</div>
        <div style="margin:2% 0"><b>Forma de pagamento:</b> ${esc(a['FORMA_PAGTO']||'Pix')}</div>
        <div style="margin:2% 0"><b>Data do pagamento:</b> ${esc(a['DATA_PAGTO']||'—')}</div>
      </div>
      <div style="margin-top:16%;text-align:center">
        <div style="width:60%;border-top:1.5px solid #333;margin:0 auto 2%"></div>
        <div style="font-weight:bold">${esc(func['NOME_COMPLETO']||'')}</div>
        <div style="font-size:2vw;color:#555">Assinatura do funcionário</div>
      </div>
    </div>`
}

function abrirAssinaturaReciboAdiant(idx) {
  if (!funcPgtoSelecionado) return toast('❌ Selecione o funcionário', 'erro')
  _reciboSig = { b64: null, idx, x: 30, y: 72, w: 34 }
  const func = funcPgtoSelecionado
  const a = adiantamentosCache[idx]

  const modal = document.createElement('div')
  modal.id = 'modal-recibo-assin'
  modal.style.cssText = 'position:fixed;inset:0;background:#0d1117;z-index:400;display:flex;flex-direction:column'
  modal.innerHTML = `
    <div style="background:#1A5C2A;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <div><div style="font-size:14px;font-weight:600">✍️ Recibo de adiantamento</div><div style="font-size:10px;opacity:.7">Assine e arraste para posicionar</div></div>
      <button onclick="document.getElementById('modal-recibo-assin').remove()" style="background:none;border:none;color:rgba(255,255,255,.7);font-size:13px;cursor:pointer">✕ Fechar</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;align-items:center;gap:12px">
      <div style="color:#fff;font-size:11px;opacity:.75;text-align:center;max-width:420px">1) Toque em <b>Assinar</b> · 2) Arraste a assinatura para o local desejado · 3) Gere o recibo</div>
      <div id="recibo-preview" style="position:relative;width:100%;max-width:420px;aspect-ratio:210/297;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.4);touch-action:none">
        ${reciboPreviewHTML(func, a)}
        <div id="recibo-sig-box" style="display:none;position:absolute;left:30%;top:72%;width:34%;cursor:move;border:1.5px dashed rgba(26,92,42,.6);border-radius:4px;background:rgba(26,92,42,.06);touch-action:none">
          <img id="recibo-sig-img" style="width:100%;display:block;pointer-events:none" src="">
        </div>
      </div>
      <div style="width:100%;max-width:420px;display:flex;flex-direction:column;gap:8px">
        <div id="recibo-size-wrap" style="display:none;align-items:center;gap:8px;color:#fff;font-size:11px">
          <span>Tamanho</span>
          <input id="recibo-size" type="range" min="15" max="60" value="34" style="flex:1" oninput="ajustarTamanhoSigRecibo(this.value)">
        </div>
        <button id="recibo-btn-assinar" onclick="abrirPadSigRecibo()" style="background:#fff;color:#1A5C2A;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:600;cursor:pointer">✍️ Assinar</button>
        <button id="recibo-btn-gerar" onclick="gerarReciboAssinado()" disabled style="background:#555;color:#999;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:600;cursor:not-allowed">Gerar recibo assinado</button>
      </div>
    </div>
    <div id="recibo-pad" style="display:none;position:absolute;inset:0;background:#1A1A1A;flex-direction:column;z-index:10">
      <div style="background:#1A5C2A;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:600">Assine com o dedo</div>
        <button onclick="fecharPadSigRecibo()" style="background:none;border:none;color:rgba(255,255,255,.6);font-size:12px;cursor:pointer">✕ Cancelar</button>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;gap:10px">
        <canvas id="recibo-canvas" style="background:#fff;border-radius:10px;touch-action:none;width:100%;max-width:600px"></canvas>
        <div style="display:flex;gap:10px;width:100%;max-width:600px">
          <button onclick="limparPadSigRecibo()" style="flex:1;background:#333;color:#fff;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:600;cursor:pointer">🗑 Limpar</button>
          <button id="recibo-btn-ok" onclick="salvarPadSigRecibo()" disabled style="flex:2;background:#555;color:#999;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:not-allowed">✅ Usar assinatura</button>
        </div>
      </div>
    </div>`
  document.body.appendChild(modal)
  configurarDragSigRecibo()
}

// Canvas de assinatura
let _rcv, _rctx, _rDraw = false, _rTraco = false, _rlx = 0, _rly = 0
function abrirPadSigRecibo() {
  document.getElementById('recibo-pad').style.display = 'flex'
  setTimeout(() => {
    _rcv = document.getElementById('recibo-canvas')
    const w = _rcv.parentElement.clientWidth - 24
    _rcv.width = Math.min(w, 600); _rcv.height = 260
    _rctx = _rcv.getContext('2d')
    _rctx.strokeStyle = '#1A1A1A'; _rctx.lineWidth = 2.8; _rctx.lineCap = 'round'; _rctx.lineJoin = 'round'
    limparPadSigRecibo()
    const pos = e => { const r = _rcv.getBoundingClientRect(), s = e.touches ? e.touches[0] : e
      return { x: (s.clientX - r.left) * _rcv.width / r.width, y: (s.clientY - r.top) * _rcv.height / r.height } }
    const start = e => { e.preventDefault(); _rDraw = true; const p = pos(e); _rlx = p.x; _rly = p.y }
    const move = e => { e.preventDefault(); if (!_rDraw) return; const p = pos(e)
      _rctx.beginPath(); _rctx.moveTo(_rlx, _rly); _rctx.lineTo(p.x, p.y); _rctx.stroke(); _rlx = p.x; _rly = p.y
      if (!_rTraco) { _rTraco = true; const b = document.getElementById('recibo-btn-ok'); b.disabled = false; b.style.cssText = b.style.cssText.replace('#555','#1A5C2A').replace('#999','#fff').replace('not-allowed','pointer') } }
    const end = e => { e.preventDefault(); _rDraw = false }
    _rcv.onmousedown = start; _rcv.onmousemove = move; _rcv.onmouseup = end
    _rcv.ontouchstart = start; _rcv.ontouchmove = move; _rcv.ontouchend = end
  }, 60)
}
function limparPadSigRecibo() { if (_rctx) _rctx.clearRect(0,0,_rcv.width,_rcv.height); _rTraco = false
  const b = document.getElementById('recibo-btn-ok'); if (b) { b.disabled = true; b.style.background = '#555'; b.style.color = '#999'; b.style.cursor = 'not-allowed' } }
function fecharPadSigRecibo() { document.getElementById('recibo-pad').style.display = 'none' }
function salvarPadSigRecibo() {
  if (!_rTraco) return
  const tmp = document.createElement('canvas'); tmp.width = _rcv.width; tmp.height = _rcv.height
  const c = tmp.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0,0,tmp.width,tmp.height); c.drawImage(_rcv,0,0)
  _reciboSig.b64 = recortarSigRecibo(tmp)
  const box = document.getElementById('recibo-sig-box')
  document.getElementById('recibo-sig-img').src = 'data:image/png;base64,' + _reciboSig.b64
  box.style.display = 'block'
  document.getElementById('recibo-size-wrap').style.display = 'flex'
  document.getElementById('recibo-btn-assinar').textContent = '🔄 Assinar novamente'
  const g = document.getElementById('recibo-btn-gerar'); g.disabled = false; g.style.background = '#1A5C2A'; g.style.color = '#fff'; g.style.cursor = 'pointer'
  fecharPadSigRecibo()
}
function recortarSigRecibo(canvas) {
  const ctx = canvas.getContext('2d'), d = ctx.getImageData(0,0,canvas.width,canvas.height).data
  let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y*canvas.width+x)*4
    if (d[i] < 240 || d[i+1] < 240 || d[i+2] < 240) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y }
  }
  if (maxX < minX) return canvas.toDataURL('image/png').split(',')[1]
  const pad = 10
  minX = Math.max(0,minX-pad); maxX = Math.min(canvas.width,maxX+pad); minY = Math.max(0,minY-pad); maxY = Math.min(canvas.height,maxY+pad)
  const out = document.createElement('canvas'); out.width = maxX-minX; out.height = maxY-minY
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png').split(',')[1]
}

// Drag da assinatura sobre o preview
function configurarDragSigRecibo() {
  const box = document.getElementById('recibo-sig-box'), prev = document.getElementById('recibo-preview')
  if (!box || !prev) return
  let dragging = false, offX = 0, offY = 0
  const startDrag = e => {
    dragging = true; const s = e.touches ? e.touches[0] : e
    const br = box.getBoundingClientRect()
    offX = s.clientX - br.left; offY = s.clientY - br.top
    e.preventDefault()
  }
  const moveDrag = e => {
    if (!dragging) return
    const s = e.touches ? e.touches[0] : e
    const pr = prev.getBoundingClientRect()
    let left = (s.clientX - offX - pr.left) / pr.width * 100
    let top  = (s.clientY - offY - pr.top) / pr.height * 100
    left = Math.max(0, Math.min(left, 100 - _reciboSig.w))
    top  = Math.max(0, Math.min(top, 98))
    _reciboSig.x = left; _reciboSig.y = top
    box.style.left = left + '%'; box.style.top = top + '%'
    e.preventDefault()
  }
  const endDrag = () => { dragging = false }
  box.onmousedown = startDrag; document.addEventListener('mousemove', moveDrag); document.addEventListener('mouseup', endDrag)
  box.ontouchstart = startDrag; box.ontouchmove = moveDrag; box.ontouchend = endDrag
}
function ajustarTamanhoSigRecibo(v) {
  _reciboSig.w = parseInt(v)
  const box = document.getElementById('recibo-sig-box')
  if (box) { box.style.width = v + '%'; if (_reciboSig.x + _reciboSig.w > 100) { _reciboSig.x = 100 - _reciboSig.w; box.style.left = _reciboSig.x + '%' } }
}

async function gerarReciboAssinado() {
  if (!_reciboSig.b64) return toast('❌ Assine primeiro', 'erro')
  mostrarLoading('Gerando recibo assinado...')
  const res = await chamarGAS({ acao: 'gerar_recibo_adiantamento', dados: {
    ...dadosReciboAdiant(_reciboSig.idx), modo: 'assinatura',
    assinatura_base64: _reciboSig.b64,
    sig_x: Math.round(_reciboSig.x), sig_y: Math.round(_reciboSig.y), sig_w: _reciboSig.w
  }})
  esconderLoading()
  if (res && res.ok && res.data?.pdf_base64) {
    document.getElementById('modal-recibo-assin')?.remove()
    abrirPdfBase64(res.data.pdf_base64)
    toast(res.data.link ? '✅ Recibo assinado e salvo no Drive' : '✅ Recibo gerado', 'sucesso')
  } else toast('❌ ' + ((res&&res.erro)||'Erro ao gerar recibo'), 'erro')
}

async function registrarAdiantamento() {
  if (!funcPgtoSelecionado) return toast('❌ Selecione o funcionário', 'erro')
  const ano   = document.getElementById('sel-ano-pgto')?.value
  const data  = document.getElementById('inp-data-adiant')?.value
  const valor = document.getElementById('inp-valor-adiant')?.value
  const forma = document.getElementById('sel-forma-adiant')?.value
  const obs   = document.getElementById('inp-obs-adiant')?.value
  if (!data || !valor) return toast('❌ Informe data e valor', 'erro')

  mostrarLoading('Registrando...')
  const res = await chamarGAS({ acao: 'registrar_adiantamento', dados: {
    func_id: funcPgtoSelecionado['ID'], ano,
    data_pagto: data, valor: parseFloat(valor),
    forma_pagto: forma, observacoes: obs
  }})
  esconderLoading()
  if (res && res.ok) {
    toast('✅ Adiantamento registrado!', 'sucesso')
    document.getElementById('inp-valor-adiant').value = ''
    document.getElementById('inp-obs-adiant').value   = ''
    carregarResumoPgto()
  } else toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
}

// ═══════════════════════════════════════════════════════════════════
// ANÁLISE DA FOLHA — o que compõe o salário, mês a mês
// ═══════════════════════════════════════════════════════════════════
// O líquido sozinho não explica nada: se subiu R$ 400 num mês, foi hora
// extra, periculosidade ou reajuste? As verbas extraídas do holerite
// respondem isso sem reabrir PDF nenhum.
let analiseAtual = null
let analiseVista = 'resumo'

async function carregarAnaliseFolha() {
  if (!funcPgtoSelecionado) return
  const card = document.getElementById('card-analise-folha')
  const corpo = document.getElementById('analise-corpo')
  if (!card || !corpo) return
  card.style.display = 'block'
  corpo.innerHTML = '<p class="lista-vazia">Carregando...</p>'

  const ano = document.getElementById('sel-ano-pgto')?.value || ''
  document.getElementById('analise-ano-label').textContent = ano ? ' · ' + ano : ''

  const res = await chamarGAS({ acao: 'historico_folha',
                                dados: { func_id: funcPgtoSelecionado['ID'], ano } })
  if (!res || !res.ok) {
    corpo.innerHTML = '<p class="lista-vazia">Não consegui carregar a análise</p>'
    return
  }
  analiseAtual = res.data
  renderAnalise()
}

function verAnalise(vista) {
  analiseVista = vista
  ;['resumo', 'meses'].forEach(v => {
    const b = document.getElementById('af-aba-' + v)
    if (b) b.className = 'af-aba' + (v === vista ? ' ativa' : '')
  })
  renderAnalise()
}

function renderAnalise() {
  const corpo = document.getElementById('analise-corpo')
  if (!corpo || !analiseAtual) return
  const a = analiseAtual

  if (!a.meses.length) {
    corpo.innerHTML = analiseVazia(a)
    return
  }
  corpo.innerHTML = (analiseVista === 'resumo' ? analiseResumo(a) : analiseMeses(a)) + analiseRodape(a)
}

// Quando nenhum holerite passou pela extração, o card não pode só ficar
// vazio: tem que dizer o que fazer.
function analiseRodape(a) {
  if (!a.sem_verbas) return ''
  const todos = a.sem_verbas === a.meses.length
  return `
    <div class="af-pendente">
      <div>
        <strong>${a.sem_verbas} ${a.sem_verbas === 1 ? 'holerite ainda não analisado' : 'holerites ainda não analisados'}</strong>
        <div>${todos
          ? 'As folhas enviadas antes desta atualização não tiveram as verbas extraídas.'
          : 'Alguns meses entram no líquido mas não no detalhamento por verba.'}
          Posso reler os PDFs guardados no Drive.</div>
      </div>
      <button class="af-btn" id="btn-reanalisar" onclick="reanalisarHistorico()">Analisar agora</button>
    </div>`
}

// Sem meses no período, a tela não pode ser um beco. Ou existem folhas em
// OUTRO ano — e aí basta trocar o seletor —, ou não existe nenhuma, e o
// motivo é outro: documento ainda não enviado, ou enviado como Ponto.
function analiseVazia(a) {
  const outros = (a.anos || []).filter(y => String(y) !== String(a.ano_filtro))
  if (outros.length) {
    return `
      <div class="af-pendente">
        <div>
          <strong>${a.ano_filtro ? 'Nada em ' + esc(String(a.ano_filtro)) : 'Nada no período selecionado'}</strong>
          <div>Mas há folha registrada em
            ${outros.map(y => `<button class="af-ano" onclick="irParaAno('${esc(String(y))}')">${esc(String(y))}
                <span>${(a.anos_qtd && a.anos_qtd[y]) || ''}</span></button>`).join(' ')}
          </div>
        </div>
      </div>`
  }
  return `
    <div class="af-pendente">
      <div>
        <strong>Nenhuma folha registrada para ${esc(a.nome || 'este funcionário')}</strong>
        <div>A análise sai das folhas enviadas pela aba <strong>Folha de Pagamento</strong>.
          Se você já enviou, confira na planilha se a linha tem o
          <strong>ID FUNC.</strong> deste funcionário e se o <strong>TIPO</strong>
          não ficou como "Ponto".</div>
      </div>
    </div>`
}

function irParaAno(ano) {
  const sel = document.getElementById('sel-ano-pgto')
  if (sel && [...sel.options].some(o => o.value === String(ano))) sel.value = String(ano)
  carregarResumoPgto()
  carregarAnaliseFolha()
  gerarExtrato()
}

function analiseResumo(a) {
  const proventos = a.categorias.filter(c => c.tipo !== 'desconto')
  const descontos = a.categorias.filter(c => c.tipo === 'desconto')
  const teto = Math.max(...a.categorias.map(c => c.total), 1)
  const nMeses = a.meses.length

  const linha = c => `
    <div class="af-verba">
      <div class="af-verba-topo">
        <span class="af-verba-nome">${esc(c.rotulo)}</span>
        <span class="af-verba-valor">R$ ${formatarValor(c.total)}</span>
      </div>
      <div class="af-barra"><div class="af-barra-in ${c.tipo === 'desconto' ? 'neg' : ''}" style="width:${Math.round(c.total / teto * 100)}%"></div></div>
      <div class="af-verba-sub">
        ${c.meses} de ${nMeses} ${nMeses === 1 ? 'mês' : 'meses'}
        · média R$ ${formatarValor(c.total / c.meses)}
      </div>
    </div>`

  return `
    <div class="af-totais">
      <div class="af-total"><span>Proventos</span><strong>R$ ${formatarValor(a.total_proventos)}</strong></div>
      <div class="af-total"><span>Descontos</span><strong class="neg">R$ ${formatarValor(a.total_descontos)}</strong></div>
      <div class="af-total destaque"><span>Líquido</span><strong>R$ ${formatarValor(a.total_liquido)}</strong></div>
    </div>
    ${proventos.length ? `<div class="af-secao">Proventos</div>${proventos.map(linha).join('')}` : ''}
    ${descontos.length ? `<div class="af-secao">Descontos</div>${descontos.map(linha).join('')}` : ''}`
}

function analiseMeses(a) {
  return a.meses.slice().reverse().map((m, idx) => {
    const i = a.meses.length - 1 - idx
    const detalhe = m.verbas.length ? `
      <div class="af-mes-detalhe" id="af-det-${i}" hidden>
        ${m.verbas.map(v => `
          <div class="af-item ${v.tipo === 'desconto' ? 'neg' : ''}">
            <span class="af-item-desc">${esc(v.descricao)}${v.referencia ? ` <span class="af-ref">${esc(v.referencia)}</span>` : ''}</span>
            <span class="af-item-valor">${v.tipo === 'desconto' ? '−' : ''}R$ ${formatarValor(v.valor)}</span>
          </div>`).join('')}
      </div>` : ''
    return `
    <div class="af-mes">
      <button class="af-mes-topo" onclick="alternarMes(${i})" aria-expanded="false" id="af-btn-${i}"
              ${m.verbas.length ? '' : 'disabled'}>
        <span class="af-mes-nome">${esc(normalizarComp(m.competencia))}</span>
        ${m.sem_verbas
          ? '<span class="af-tag">sem detalhamento</span>'
          : `<span class="af-mes-cols">
               <span class="af-mes-col">+${formatarValor(m.proventos)}</span>
               <span class="af-mes-col neg">−${formatarValor(m.descontos)}</span>
             </span>`}
        <span class="af-mes-liq">R$ ${formatarValor(m.valor_liquido)}</span>
        ${m.verbas.length ? '<i class="ti ti-chevron-down af-seta"></i>' : ''}
      </button>
      ${detalhe}
    </div>`
  }).join('')
}

function alternarMes(i) {
  const det = document.getElementById('af-det-' + i)
  const btn = document.getElementById('af-btn-' + i)
  if (!det || !btn) return
  const aberto = !det.hidden
  det.hidden = aberto
  btn.setAttribute('aria-expanded', String(!aberto))
  btn.classList.toggle('aberto', !aberto)
}

// Relê os PDFs do Drive em lotes — o Apps Script corta a execução em 6 min,
// então o backend devolve quantos faltam e a gente volta até zerar.
async function reanalisarHistorico() {
  if (!funcPgtoSelecionado) return
  const btn = document.getElementById('btn-reanalisar')
  if (btn) { btn.disabled = true; btn.textContent = 'Analisando...' }

  let total = 0, voltas = 0
  while (voltas++ < 30) {
    mostrarLoading(`Lendo holerites... ${total} analisado(s)`)
    const res = await chamarGAS({ acao: 'reanalisar_folhas',
                                  dados: { func_id: funcPgtoSelecionado['ID'], limite: 4 } })
    if (!res || !res.ok) {
      esconderLoading()
      toast('❌ ' + ((res && res.erro) || 'Erro na análise'), 'erro')
      break
    }
    total += res.data.processados
    if (res.data.erros?.length) console.warn('Reanálise:', res.data.erros)
    // Nada processado e ainda há pendentes = todos falharam; insistir seria laço infinito.
    if (!res.data.restantes || !res.data.processados) {
      if (res.data.restantes && !res.data.processados) {
        toast(`⚠️ ${res.data.restantes} holerite(s) não puderam ser lidos`, 'aviso')
      }
      break
    }
  }
  esconderLoading()
  if (total) toast(`✅ ${total} holerite(s) analisado(s)`, 'sucesso')
  await carregarAnaliseFolha()
}

async function carregarHistoricoPagamentos() {
  if (!funcPgtoSelecionado) return
  const res  = await chamarGAS({ acao: 'listar_pagamentos', dados: { func_id: funcPgtoSelecionado['ID'] } })
  const el   = document.getElementById('historico-pagamentos')
  const card = document.getElementById('card-hist-pagamentos')
  if (!el) return
  if (!res || !res.ok || !res.data?.length) {
    el.innerHTML = '<p class="lista-vazia">Nenhum salário registrado</p>'
    return
  }
  if (card) card.style.display = 'block'
  el.innerHTML = res.data.map(p => {
    const pago     = p['STATUS'] === 'Pago'
    const compNorm = normalizarComp(p['COMPETENCIA'] || p['COMPETÊNCIA'] || '')
    const valor    = p['VALOR_LIQUIDO'] ? 'R$ ' + formatarValor(p['VALOR_LIQUIDO']) : ''
    return `
    <div class="lista-item">
      <div class="av" style="background:${pago?'var(--verde-claro)':'var(--amber-bg)'};color:${pago?'var(--verde-text)':'var(--amber-text)'}">
        ${getIniciais(p['NOME_FUNC']||'?')}
      </div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${compNorm}${valor?' · '+valor:''}</div>
        <div class="lista-item-sub">${p['DATA_GERACAO']||p['DATA_ASSINATURA']||''}</div>
        ${p['COMPROVANTE_LINK']
          ? `<a href="${p['COMPROVANTE_LINK']}" target="_blank" style="font-size:10px;color:var(--blue-text);display:flex;align-items:center;gap:2px;margin-top:2px">
               <i class="ti ti-receipt" style="font-size:10px"></i> Ver comprovante
             </a>`
          : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="badge ${pago?'badge-verde':'badge-amarelo'}">${p['STATUS']||'—'}</span>
        ${!pago && p['WA_LINK_EMPREGADOR']
          ? `<a href="${p['WA_LINK_EMPREGADOR']}" target="_blank"
               style="background:#22C55E;color:#fff;border-radius:6px;padding:3px 7px;font-size:10px;text-decoration:none;display:flex;align-items:center;gap:3px">
               <i class="ti ti-brand-whatsapp" style="font-size:10px"></i> Reenviar
             </a>`
          : ''}
      </div>
    </div>`
  }).join('')
}

// FIX #7: gerarExtrato agora também reage à troca de ano via sel-ano-pgto
async function gerarExtrato() {
  if (!funcPgtoSelecionado) return
  const ini  = document.getElementById('ext-inicio')?.value
  const fim  = document.getElementById('ext-fim')?.value
  if (!ini || !fim) return

  const anoLabel = document.getElementById('ext-ano-label')
  if (anoLabel) anoLabel.textContent = new Date(ini).getFullYear()

  mostrarLoading('Gerando extrato...')

  const [resPag, resAdiant] = await Promise.all([
    chamarGAS({ acao: 'listar_pagamentos',   dados: { func_id: funcPgtoSelecionado['ID'] } }),
    chamarGAS({ acao: 'resumo_comissao',     dados: { func_id: funcPgtoSelecionado['ID'], ano: new Date(ini).getFullYear() } }),
  ])
  esconderLoading()

  const corpo  = document.getElementById('extrato-corpo')
  const lista  = document.getElementById('extrato-lista')
  const totais = document.getElementById('extrato-totais')
  if (!corpo || !lista || !totais) return

  const iniDate = new Date(ini)
  const fimDate = new Date(fim + 'T23:59:59')

  const salarios = (resPag?.data || []).filter(p => {
    const d = new Date(p['DATA_GERACAO'] || p['DATA_ASSINATURA'] || '2000-01-01')
    return d >= iniDate && d <= fimDate
  })

  const adiantamentos = (resAdiant?.data?.adiantamentos || []).filter(a => {
    const d = new Date(a['DATA_PAGTO'] || '2000-01-01')
    return d >= iniDate && d <= fimDate
  })

  const itens = [
    ...salarios.map(p => {
      // ORIGEM diz de onde veio a ordem; linhas antigas não têm a coluna
      const origem = p['ORIGEM'] || 'Folha'
      const rotulo = origem === 'Ferias' ? 'Férias'
                   : origem === 'Ponto'  ? 'Folha de ponto'
                   : 'Salário'
      return {
        tipo:  origem === 'Ferias' ? 'ferias' : 'salario',
        data:  p['DATA_GERACAO'] || p['DATA_ASSINATURA'] || '',
        desc:  rotulo + ' ' + normalizarComp(p['COMPETENCIA'] || p['COMPETÊNCIA'] || ''),
        valor: p['VALOR_LIQUIDO'] || 0,
        status: p['STATUS'],
        link:  p['COMPROVANTE_LINK'] || '',
      }
    }),
    ...adiantamentos.map(a => ({
      tipo:  'adiantamento',
      data:  a['DATA_PAGTO'] || '',
      desc:  'Adiantamento · ' + (a['FORMA_PAGTO'] || '') + (a['OBSERVACOES'] ? ' · ' + a['OBSERVACOES'] : ''),
      valor: a['VALOR'] || 0,
      status: 'Pago',
      link:  '',
    })),
  ].sort((a, b) => new Date(a.data) - new Date(b.data))

  if (!itens.length) {
    lista.innerHTML = '<p class="lista-vazia">Nenhum lançamento no período</p>'
    totais.innerHTML = ''
    return
  }

  const ehFerias    = p => (p['ORIGEM'] || 'Folha') === 'Ferias'
  const soFerias    = salarios.filter(ehFerias)
  const soFolha     = salarios.filter(p => !ehFerias(p))
  const totalSal    = soFolha.reduce((s, p) => s + parseValorNum(p['VALOR_LIQUIDO']), 0)
  const totalFerias = soFerias.reduce((s, p) => s + parseValorNum(p['VALOR_LIQUIDO']), 0)
  const totalAdiant = adiantamentos.reduce((s, a) => s + parseValorNum(a['VALOR']), 0)
  const totalGeral  = totalSal + totalFerias + totalAdiant

  lista.innerHTML = itens.map(it => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <div style="width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;
        background:${it.tipo==='salario'?'var(--verde-claro)':it.tipo==='ferias'?'var(--amber-bg)':'var(--blue-bg)'}">
        ${it.tipo==='salario'?'💼':it.tipo==='ferias'?'🌴':'💰'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.desc}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${it.data ? new Date(it.data).toLocaleDateString('pt-BR') : '—'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:600;color:${it.tipo==='salario'?'var(--verde-text)':it.tipo==='ferias'?'var(--amber-text)':'var(--blue-text)'}">R$ ${formatarValor(it.valor)}</div>
        <div style="font-size:9px;color:var(--text-secondary)">${it.status}</div>
        ${it.link ? `<a href="${it.link}" target="_blank" style="font-size:9px;color:var(--blue-text)">comprovante</a>` : ''}
      </div>
    </div>`).join('')

  totais.innerHTML = `
    <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Totais do período</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
      <span style="color:var(--text-secondary)">💼 Salários (${soFolha.length})</span>
      <span style="font-weight:600;color:var(--verde-text)">R$ ${formatarValor(totalSal)}</span>
    </div>
    ${soFerias.length ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
      <span style="color:var(--text-secondary)">🌴 Férias (${soFerias.length})</span>
      <span style="font-weight:600;color:var(--amber-text)">R$ ${formatarValor(totalFerias)}</span>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
      <span style="color:var(--text-secondary)">💰 Adiantamentos (${adiantamentos.length})</span>
      <span style="font-weight:600;color:var(--blue-text)">R$ ${formatarValor(totalAdiant)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:6px 0 0;border-top:0.5px solid var(--border);margin-top:4px">
      <span>Total geral</span>
      <span style="color:var(--verde-text)">R$ ${formatarValor(totalGeral)}</span>
    </div>`

  corpo.style.display = ''
}

// Ordens de pagamento em aberto. Inclui as já notificadas: "Notificado"
// significa que o empregador foi avisado, não que pagou — mostrar só
// "Aguardando Pagamento" esvaziava o painel no instante do aviso, que é
// justamente quando ele passa a importar.
async function carregarNotifPendentes() {
  const card = document.getElementById('card-notif-pendentes')
  const el   = document.getElementById('lista-notif-pendentes')
  if (!card || !el) return

  const res = await chamarGAS({ acao: 'listar_pagamentos' })
  if (!res || !res.ok || !Array.isArray(res.data)) { card.style.display = 'none'; return }

  const pendentes = res.data.filter(p =>
    ['Aguardando Pagamento', 'Notificado'].includes(String(p['STATUS'] || '').trim()) &&
    String(p['CANCELADO'] || '').trim() !== 'Sim')

  if (!pendentes.length) { card.style.display = 'none'; return }
  card.style.display = 'block'

  const total = pendentes.reduce((s, p) => s + parseValorNum(p['VALOR_LIQUIDO']), 0)
  const tituloEl = document.getElementById('notif-pendentes-titulo')
  if (tituloEl) {
    tituloEl.textContent = pendentes.length + (pendentes.length === 1 ? ' pendente' : ' pendentes')
      + (total > 0 ? ' · R$ ' + formatarValor(total) : '')
  }

  el.innerHTML = pendentes.map(p => {
    const avisado = String(p['STATUS']).trim() === 'Notificado'
    const valor = parseValorNum(p['VALOR_LIQUIDO'])
    return `
    <div class="np-item">
      <div class="np-av">${getIniciais(p['NOME_FUNC'] || '?')}</div>
      <div class="np-info">
        <div class="np-nome">${esc(p['NOME_FUNC'] || '')}</div>
        <div class="np-sub">
          ${esc(normalizarComp(p['COMPETENCIA'] || ''))}
          ${p['ORIGEM'] && p['ORIGEM'] !== 'Folha' ? ' · ' + esc(p['ORIGEM']) : ''}
          ${valor > 0 ? ' · R$ ' + formatarValor(valor) : ''}
        </div>
        <span class="np-estado ${avisado ? 'avisado' : ''}">${avisado ? 'Avisado, aguardando pagamento' : 'Ainda não avisado'}</span>
      </div>
      <div class="np-acoes">
        ${p['WA_LINK_EMPREGADOR']
          ? `<a href="${p['WA_LINK_EMPREGADOR']}" target="_blank" class="np-wa" title="${avisado ? 'Cobrar' : 'Avisar'} pelo WhatsApp">
               <i class="ti ti-brand-whatsapp"></i>
             </a>`
          : ''}
        <button class="np-pago" onclick="marcarComoPago('${esc(String(p['ID']))}', '${esc(String(p['NOME_FUNC'] || ''))}')"
                title="Marcar como pago">
          <i class="ti ti-check"></i> Pago
        </button>
      </div>
    </div>`
  }).join('')
}

// Nem todo pagamento passa pelo link: dinheiro, Pix pelo banco, transferência
// na mão. Sem isto a ordem ficava "aguardando" para sempre.
async function marcarComoPago(id, nome) {
  if (!confirm(`Confirmar que o pagamento de ${nome || 'este funcionário'} já foi feito?`)) return
  mostrarLoading('Registrando...')
  const res = await chamarGAS({ acao: 'marcar_pago', dados: { id } })
  esconderLoading()
  if (!res || !res.ok) return toast('❌ ' + ((res && res.erro) || 'Erro ao registrar'), 'erro')
  toast(res.data?.ja_estava ? 'Já estava marcado como pago' : '✅ Pagamento registrado', 'sucesso')
  await carregarNotifPendentes()
  if (funcPgtoSelecionado) carregarHistoricoPagamentos()
}
