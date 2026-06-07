
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

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxayJeiQeUeHNfl0oz1xcJh6xzymXLREH-wosmRaLHTazaV6fo62y0bMgivnJTyv1oP/exec'
const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'

let USUARIO = null, SENHA_ADM = null
let funcionarios = [], estoque = [], itensEpiSel = []
let funcEpiSelecionado = null
let paginaAtual = 'inicio', todosExames = []
let paginasFracionadas = []
let tipoDocAtual = 'Folha'

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
    mostrarPdfSelecionado(file.name)
    const preview = document.getElementById('frac-preview')
    preview.style.display = 'block'; preview.textContent = '⏳ Lendo PDF...'
    try {
      const PDFLib = await carregarPdfLib()
      const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
      const total  = pdfDoc.getPageCount()
      preview.innerHTML = '<i class="ti ti-file-check" style="vertical-align:-2px"></i> ' + total + ' página(s) detectadas — 1 funcionário por página'
    } catch(err) { preview.textContent = '❌ Erro: ' + err.message }
  })
})

function entrarNoApp() {
  document.getElementById('tela-login').style.display = 'none'
  document.getElementById('tela-app').style.display   = 'flex'
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
      carregarDashboard()
    } else { toast(d.verificados === 0 ? 'Nenhum pendente' : '🔄 ' + d.pendentes + ' aguardando', '') }
  } else { toast('❌ Erro na sincronização', 'erro') }
}

const TITULOS = {
  'inicio':'Início','lista-func':'Funcionários','novo-func':'Novo Funcionário',
  'exames':'Exames','epi':'EPI','fracionar':'Folha de Pagamento',
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

// ─── DASHBOARD ────────────────────────────────────────────────────
async function carregarDashboard() {
  const [resEx, resEst, resEpi, resFolha] = await Promise.all([
    chamarGAS({ acao: 'listar_exames' }),
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
    chamarGAS({ acao: 'listar_folhas' }),
  ])
  document.getElementById('num-funcs').textContent = funcionarios.length
  if (resEx && resEx.ok) {
    todosExames = resEx.data
    document.getElementById('num-vencidos').textContent = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('VENCIDO')).length
    document.getElementById('num-avencer').textContent  = resEx.data.filter(e => (e['STATUS EXAME']||'').includes('A VENCER')).length
  }
  if (resEst && resEst.ok) {
    estoque = resEst.data
    document.getElementById('num-epi').textContent = resEst.data.filter(e => { const s = e['SITUAÇÃO']||''; return s.includes('REPOR') || s.includes('SEM') }).length
  }
  const pendentesEpi   = (resEpi   && resEpi.ok)   ? resEpi.data.filter(e   => e['ASSINADO?'] === 'Pendente' && e['ZAPSIGN_DOC']) : []
  const pendentesFolha = (resFolha && resFolha.ok) ? resFolha.data.filter(f => f['STATUS']    === 'Pendente' && f['ZAPSIGN_DOC']) : []
  renderLembretes(pendentesEpi, pendentesFolha)
}

function renderLembretes(pendentesEpi, pendentesFolha) {
  const el = document.getElementById('lembretes-wrap'); if (!el) return
  const todos = [
    ...pendentesEpi.map(e => ({ tipo:'EPI', nome:e['FUNCIONÁRIO'], descricao:e['DESCRIÇÃO DO EPI'], data:e['DATA ENTREGA'], signerToken:(e['OBSERVAÇÕES']||'').replace('Signer: ','') })),
    ...pendentesFolha.map(f => ({ tipo:'Folha', nome:f['FUNCIONÁRIO'], descricao:f['COMPETÊNCIA'], data:f['DATA ENVIO'], signerToken:(f['OBSERVAÇÕES']||'').replace('Signer: ','') })),
  ]
  if (!todos.length) { el.style.display = 'none'; return }
  el.style.display = 'block'
  el.innerHTML = `<div class="card" style="border-color:rgba(133,79,11,0.3);background:#FFFBF5">
    <div class="card-titulo" style="color:var(--amber-text)"><i class="ti ti-bell-ringing" aria-hidden="true"></i> ${todos.length} assinatura(s) pendente(s)</div>
    <div style="display:flex;flex-direction:column;gap:8px">
    ${todos.map(item => {
      const func = funcionarios.find(f => f['NOME_COMPLETO'] === item.nome)
      const tel  = func ? '55' + func['TELEFONE'].replace(/\D/g,'') : ''
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border-radius:var(--radius-md);border:0.5px solid rgba(133,79,11,0.15)">
        <div class="avatar" style="background:var(--amber-bg);color:var(--amber-text)">${getIniciais(item.nome||'?')}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.nome}</div>
          <div style="font-size:11px;color:var(--text-secondary)"><span class="badge badge-amarelo" style="margin-right:4px">${item.tipo}</span>${item.descricao} · ${item.data}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${tel ? `<a href="https://wa.me/${tel}?text=${encodeURIComponent('Olá '+item.nome.split(' ')[0]+', seu documento aguarda assinatura. Por favor acesse o link que enviamos no WhatsApp.')}" target="_blank" style="background:#22C55E;color:#fff;border:none;border-radius:7px;padding:6px 9px;font-size:13px;text-decoration:none;display:flex;align-items:center"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
          <button onclick="reenviarZapSign('${item.signerToken}','${item.nome}')" style="background:var(--blue-bg);color:var(--blue-text);border:none;border-radius:7px;padding:6px 9px;font-size:13px;cursor:pointer;display:flex;align-items:center" title="Reenviar via ZapSign"><i class="ti ti-send"></i></button>
        </div>
      </div>`
    }).join('')}
    </div>
  </div>`
}

async function reenviarZapSign(signerToken, nome) {
  if (!signerToken || signerToken === 'undefined') return toast('❌ Token indisponível', 'erro')
  mostrarLoading('Reenviando para ' + nome.split(' ')[0] + '...')
  const res = await chamarGAS({ acao: 'reenviar_zapsign', dados: { signer_token: signerToken } })
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
  renderFuncionarios(q ? funcionarios.filter(f => f['NOME_COMPLETO'].toLowerCase().includes(q.toLowerCase())) : funcionarios)
}

function getIniciais(nome) {
  const p = String(nome).trim().split(' ').filter(x => x.length > 1)
  return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : (nome[0]||'?').toUpperCase()
}


function abrirEpiRapido(funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId))
  if (!func) return
  irPara('epi')
  setTimeout(() => {
    // Pré-seleciona o funcionário
    selecionarFuncEpi(funcId)
    const sel = document.getElementById('sel-func-epi-hidden')
    if (sel) sel.value = funcId
    // Sugerir EPIs do perfil em estoque
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
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="avatar">${getIniciais(f['NOME_COMPLETO'])}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['NOME_COMPLETO']}</div>
        <div class="lista-item-sub">${f['FUNCAO']} · ${f['UNIDADE']}</div>
        <div class="lista-item-sub">${f['TELEFONE']||''}</div>
      </div>
      <div style="display:flex;gap:5px;align-items:center">
        <button onclick="abrirEpiRapido('${f['ID']}')" class="btn-epi-rapido" title="Entregar EPI">
          <i class="ti ti-shield-plus" aria-hidden="true"></i>
        </button>
        ${badge(f['STATUS'])}
      </div>
    </div>`).join('')
}

async function salvarFuncionario(e) {
  e.preventDefault()
  const btn = document.getElementById('btn-salvar-func')
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Salvando...'
  mostrarLoading('Cadastrando e criando pasta no Drive...')
  const dados = Object.fromEntries(new FormData(e.target).entries())
  const res = await chamarGAS({ acao: 'cadastrar_funcionario', dados })
  esconderLoading(); btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> Cadastrar'
  if (res && res.ok) {
    toast('✅ Cadastrado! ID: ' + res.data.id, 'sucesso')
    e.target.reset()
    const r2 = await chamarGAS({ acao: 'listar_funcionarios' })
    if (r2 && r2.ok) { funcionarios = r2.data; preencherSelectsOcultos() }
    setTimeout(() => irPara('lista-func'), 1500)
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

// ─── EXAMES ───────────────────────────────────────────────────────
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
  el.innerHTML = lista.map(e => {
    const status = e['STATUS EXAME'] || '⏳ PENDENTE'
    const bc = status.includes('VENCIDO') ? 'var(--red-text)' : status.includes('A VENCER') ? 'var(--amber-text)' : 'var(--border)'
    return `<div class="lista-item" style="border-color:${bc}">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['EXAME REALIZADO']}</div>
        <div class="lista-item-sub">${e['DATA REALIZAÇÃO']?'Realizado: '+e['DATA REALIZAÇÃO']:'Não realizado'}${e['DATA VENCIMENTO']?' · Vence: '+e['DATA VENCIMENTO']:''}</div>
      </div>${badge(status)}
    </div>`
  }).join('')
}

// ─── EPI ──────────────────────────────────────────────────────────
async function carregarEpi() {
  mostrarLoading('Carregando EPI...')
  const [resEst, resEnt] = await Promise.all([
    chamarGAS({ acao: 'listar_epi_estoque' }),
    chamarGAS({ acao: 'listar_epi_entregas' }),
  ])
  esconderLoading()
  if (resEst && resEst.ok) { estoque = resEst.data; preencherSelectsOcultos(); renderEstoqueModal(estoque) }
  if (resEnt && resEnt.ok) renderEntregas(resEnt.data.slice(0,15))
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
        <div class="epi-est-nome">${e['DESCRIÇÃO DO EPI']}</div>
        <div class="epi-est-ca">CA ${e['Nº CA']||'—'} · ${e['UNIDADE']||'un'}</div>
      </div>
      <div class="epi-est-right">
        <span class="epi-est-qty">${e['ESTOQUE ATUAL']}</span>
        <span class="badge ${bc}">${sit.replace('✅ ','').replace('⚠️ ','').replace('⛔ ','')}</span>
      </div>
    </div>`
  }).join('')
}

function renderEstoque(lista) {
  const icones = { 'Capacete':'🪖','Óculos':'🥽','Protetor':'👂','Respirador':'😷','Luva':'🧤','Bota':'👟','Avental':'🦺','Macacão':'👔','Colete':'🦺','Cinto':'🔒','Protetor Facial':'😷','Chapéu':'👒','Camisa':'👕','Botina':'👟','Máscara':'😷' }
  function getIcone(nome) { for (const [k,v] of Object.entries(icones)) { if (nome.toLowerCase().includes(k.toLowerCase())) return v } return '🦺' }
  document.getElementById('lista-estoque').innerHTML = lista.map(e => {
    const sit = situacaoEpi(e)
    const badgeCls = sit === '✅ OK' ? 'badge-verde' : sit === '⚠️ REPOR' ? 'badge-amarelo' : 'badge-vermelho'
    return `<div class="epi-estoque-item">
      <div class="epi-icone-wrap">${getIcone(e['DESCRIÇÃO DO EPI'])}</div>
      <div class="epi-est-info">
        <div class="epi-est-nome">${e['DESCRIÇÃO DO EPI']}</div>
        <div class="epi-est-ca">CA ${e['Nº CA']||'—'} · ${e['UNIDADE']||'un'}</div>
      </div>
      <div class="epi-est-right">
        <span class="epi-est-qty">${e['ESTOQUE ATUAL']}</span>
        <span class="badge ${badgeCls}">${sit.replace('✅ ','').replace('⚠️ ','').replace('⛔ ','')}</span>
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

// Seletor de funcionário para EPI
function abrirSeletorFunc() { document.getElementById('sel-func-epi-hidden').click() }
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

  // Sugerir EPIs do perfil
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

// Seletor de EPI
function abrirSeletorEpi() {
  // Mostra dropdown de busca
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
      <span style="font-size:12px;font-weight:500">${e['DESCRIÇÃO DO EPI']}</span>
      <span style="font-size:11px;color:#6B7280">${e['ESTOQUE ATUAL']} ${e['UNIDADE']||'un'}</span>
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
      <span class="epi-item-nome">${item.cod} — ${item.descricao}</span>
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
  // Se não passou metodo, mostra modal de escolha
  if (!metodo) { mostrarModalEnvio('epi'); return }

  const btn = document.getElementById('btn-enviar-epi')
  const motivo = motivoEpiSelecionado || 'Admissional'
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Enviando...'
  mostrarLoading('Gerando recibo PDF...')

  // Sempre gera o recibo EPI no GAS
  const res = await chamarGAS({ acao: 'entregar_epi', dados: {
    func_id: funcEpiSelecionado['ID'], itens: itensEpiSel, motivo,
    metodo_assinatura: metodo  // 'zapsign' | 'proprio'
  }})
  esconderLoading()
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> <span id="btn-epi-label">Gerar recibo e enviar</span>'

  if (res && res.ok) {
    if (metodo === 'proprio' && res.data.pdf_base64) {
      // Gera link de assinatura própria
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
  const tel = funcEpiSelecionado ? '55' + funcEpiSelecionado['TELEFONE'].replace(/\D/g,'') : ''
  const waUrl = waLinkCustom || (tel ? `https://wa.me/${tel}?text=${encodeURIComponent('Por favor, assine o documento: '+url)}` : '')
  el.style.display = 'block'
  el.innerHTML = `<p style="font-size:12px;font-weight:600;color:var(--verde-text);margin-bottom:6px">✅ ${msg}</p>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="inp-link-ass" value="${url}" readonly style="flex:1;font-size:10px;border:0.5px solid var(--border);border-radius:6px;padding:6px 8px;background:#fff;color:var(--text-primary)">
      <button onclick="copiarLink()" class="btn-copiar" style="background:var(--verde);color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer">Copiar</button>
      ${waUrl ? `<a href="${waUrl}" target="_blank" style="background:#22C55E;color:#fff;border-radius:6px;padding:6px 10px;font-size:13px;text-decoration:none;display:flex;align-items:center"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
    </div>`
}

function copiarLink() {
  const inp = document.getElementById('inp-link-ass'); if (!inp) return
  inp.select(); document.execCommand('copy'); toast('✅ Link copiado!', 'sucesso')
}

function renderEntregas(lista) {
  const el = document.getElementById('lista-entregas')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega</p>'; return }
  el.innerHTML = lista.map(e => `
    <div class="lista-item">
      <div class="avatar" style="background:var(--blue-bg);color:var(--blue-text)">${getIniciais(e['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['DESCRIÇÃO DO EPI']} · ${e['DATA ENTREGA']} · ${e['MOTIVO ENTREGA']||''}</div>
        ${e['LINK DOC ASSINADO'] ? `<a href="${e['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text);display:flex;align-items:center;gap:2px;margin-top:2px"><i class="ti ti-file-check" style="font-size:10px"></i> Ver documento assinado</a>` : ''}
      </div>${badge(e['ASSINADO?'])}
    </div>`).join('')
}

// ─── FOLHA / FRACIONAR ────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// ASSINATURA PRÓPRIA
// ═══════════════════════════════════════════════════════════════════
function mostrarModalEnvio(tipo, dadosEnvio) {
  // tipo: 'epi' | 'folha'
  // Cria modal de escolha
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
        <button onclick="document.getElementById('modal-envio').remove()" style="background:none;border:none;color:#6B7280;font-size:13px;padding:10px;cursor:pointer">Cancelar</button>
      </div>
    </div>`
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

// ── EPI ───────────────────────────────────────────────────────────
function enviarComZapSign_epi()          { document.getElementById('modal-envio')?.remove(); enviarEpi('zapsign') }
function enviarComAssinaturaPropria_epi(){ document.getElementById('modal-envio')?.remove(); enviarEpi('proprio') }

// ── Folha ─────────────────────────────────────────────────────────
function enviarComZapSign_folha(idx)          { document.getElementById('modal-envio')?.remove(); enviarPaginaZapSign(idx) }
function enviarComAssinaturaPropria_folha(idx){ document.getElementById('modal-envio')?.remove(); enviarPaginaAssinaturaPropria(idx) }

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
      pdf_base64:  p.pdfBase64,
      tipo:        tipoDoc,
      competencia: p.competencia,
      func_id:     p.funcId,
      func_nome:   p.nome,
      pagina:      p.pagina,
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
    const tel = paginasFracionadas[idx].telefone.replace(/\D/g,'')
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
    // Autentica com Google
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
    // Baixa o arquivo via Drive API
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
      { headers: { Authorization: 'Bearer ' + oauthToken } }
    )
    const buffer = await res.arrayBuffer()
    const blob   = new Blob([buffer], { type: 'application/pdf' })
    // Converte para base64 sem usar spread (evita stack overflow em PDFs grandes)
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(blob)
    })

    // Simula o mesmo comportamento do input file
    esconderLoading()
    mostrarPdfSelecionado(nome)

    // Armazena como File object para o processamento normal
    const fileObj = new File([blob], nome, { type: 'application/pdf' })
    // Injeta no input file
    const dt = new DataTransfer()
    dt.items.add(fileObj)
    const inputFrac = document.getElementById('input-pdf-frac')
    if (inputFrac) {
      inputFrac.files = dt.files
      // Dispara o evento change para contar páginas normalmente
      inputFrac.dispatchEvent(new Event('change'))
    }

    toast('✅ PDF do Drive carregado: ' + nome, 'sucesso')
  } catch(e) {
    esconderLoading()
    toast('❌ Erro ao carregar PDF: ' + e.message, 'erro')
  }
}

function mostrarPdfSelecionado(nome) {
  const el = document.getElementById('pdf-selecionado')
  const nomeEl = document.getElementById('pdf-nome')
  if (el) el.style.display = 'flex'
  if (nomeEl) nomeEl.textContent = nome
}

function preencherMesesFracionar() {
  const sel = document.getElementById('sel-comp-frac'); if (!sel) return
  if (sel.options.length > 1) return
  sel.innerHTML = '<option value="">Selecione a competência...</option>'
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano = new Date().getFullYear(), mesAtual = new Date().getMonth()
  for (let m = mesAtual; m >= 0; m--) sel.innerHTML += `<option value="${meses[m]}/${ano}">${meses[m]}/${ano}</option>`
  for (let m = 11; m > mesAtual; m--) sel.innerHTML += `<option value="${meses[m]}/${ano-1}">${meses[m]}/${ano-1}</option>`
}

async function carregarEntregasFolha() {
  const res = await chamarGAS({ acao: 'listar_folhas' })
  if (res && res.ok) renderHistoricoFolha(res.data.slice(0,20))
}

function renderHistoricoFolha(lista) {
  const el = document.getElementById('historico-folha'); if (!el) return
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum envio</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="avatar" style="background:var(--purple-bg);color:var(--purple-text)">${getIniciais(f['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${f['COMPETÊNCIA']} · ${f['DATA ENVIO']}</div>
        ${f['LINK DOC ASSINADO'] ? `<a href="${f['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text);display:flex;align-items:center;gap:2px;margin-top:2px"><i class="ti ti-file-check" style="font-size:10px"></i> Ver assinado</a>` : ''}
      </div>${badge(f['STATUS'])}
    </div>`).join('')
}

async function processarFracionamento() {
  const file        = document.getElementById('input-pdf-frac').files[0]
  const competencia = document.getElementById('sel-comp-frac').value
  if (!file || !competencia) return toast('❌ Selecione o PDF e a competência', 'erro')
  const btn = document.getElementById('btn-fracionar')
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Separando...'
  mostrarLoading('Carregando pdf-lib...')
  try {
    const PDFLib = await carregarPdfLib()
    const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer())
    const total  = pdfDoc.getPageCount()
    paginasFracionadas = []
    for (let i = 0; i < total; i++) {
      mostrarLoading('Separando página ' + (i+1) + ' de ' + total + '...')
      const novoDoc = await PDFLib.PDFDocument.create()
      const [pag]   = await novoDoc.copyPages(pdfDoc, [i])
      novoDoc.addPage(pag)
      paginasFracionadas.push({ pagina:i+1, funcId:'', nome:'', funcao:'', telefone:'', pdfBase64:arrayBufferToBase64(await novoDoc.save()), status:'pronto', signUrl:'', competencia, tipoDoc: tipoDocAtual })
    }
    esconderLoading()
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-scissors"></i> Separar PDF'
    document.getElementById('frac-resultado').style.display = 'block'
    document.getElementById('frac-resumo').textContent = competencia + ' · ' + total + ' página(s) separadas'
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
    </div>`).join('')
}

// ── Mapeamento salvo: competencia -> {pagina: funcId} ──────────
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

  // Dispara todas as identificações com IA em paralelo
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

      // Atualiza tipo e competência detectados pela IA
      if (tipoIA) paginasFracionadas[i].tipoDoc    = tipoIA
      if (compIA) paginasFracionadas[i].competencia = compIA

      if (d.func_id) {
        func = funcionarios.find(f => String(f['ID']) === String(d.func_id))
        if (func) func._metodo = 'ia'
      }
    }

    // Fallback: mapeamento salvo
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
    atualizarBtnTodos()
  }

  if (identificados > 0) salvarMapeamento(competencia)

  toast(identificados === paginasFracionadas.length
    ? '🤖 IA identificou todos os ' + identificados + ' funcionários!'
    : '🤖 ' + identificados + ' identificados · ' + (paginasFracionadas.length - identificados) + ' selecione manualmente',
    identificados > 0 ? 'sucesso' : '')
}

function renderCardIdentificado(i, func, metodo) {
  const card = document.getElementById('fpc-' + i); if (!card) return
  card.className = 'frac-page-card identificado'
  document.getElementById('fpc-num-' + i).innerHTML = `<i class="ti ti-file-text" style="font-size:11px;vertical-align:-1px"></i> Página ${paginasFracionadas[i].pagina}`
  document.getElementById('fpc-func-' + i).innerHTML = `
    <div class="fpc-func">
      <div class="fpc-av">${getIniciais(func['NOME_COMPLETO'])}</div>
      <div>
        <div class="fpc-nome">${func['NOME_COMPLETO']}</div>
        <div class="fpc-sub">${func['FUNCAO']||''} · ${func['UNIDADE']||''}</div>
        ${metodo === 'ia' || metodo === 'auto' ? `<div class="fpc-auto"><i class="ti ti-robot" style="font-size:9px"></i> Identificado pela IA</div>` : metodo === 'cache' ? `<div class="fpc-auto"><i class="ti ti-history" style="font-size:9px"></i> Mapeamento salvo — confirme</div>` : '<div class="fpc-manual-tag">Selecionado manualmente</div>'}
      </div>
    </div>`
  const btnEl = document.getElementById('btn-zap-' + i)
  if (btnEl) btnEl.disabled = false
}

function renderCardManual(i) {
  const card = document.getElementById('fpc-' + i); if (!card) return
  card.className = 'frac-page-card manual'
  const numEl = document.getElementById('fpc-num-' + i)
  if (numEl) { numEl.className = 'fpc-num manual'; numEl.innerHTML = `<i class="ti ti-alert-triangle" style="font-size:10px;vertical-align:-1px"></i> Pág. ${paginasFracionadas[i].pagina} — selecione` }
  document.getElementById('fpc-func-' + i).innerHTML = `
    <select class="frac-select-manual" onchange="selecionarFuncManual(${i}, this.value)">
      <option value="">Selecione o funcionário...</option>
      ${funcionarios.map(f => `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>`).join('')}
    </select>`
}

function selecionarFuncManual(i, funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId)); if (!func) return
  paginasFracionadas[i].funcId   = funcId
  paginasFracionadas[i].nome     = func['NOME_COMPLETO']
  paginasFracionadas[i].funcao   = func['FUNCAO']
  paginasFracionadas[i].telefone = func['TELEFONE']
  renderCardIdentificado(i, func, 'manual')
  atualizarBtnTodos()
}

function visualizarPagina(idx) {
  const p = paginasFracionadas[idx]; if (!p || !p.pdfBase64) return toast('❌ PDF indisponível', 'erro')
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(p.pdfBase64), c => c.charCodeAt(0))], { type: 'application/pdf' }))
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
  const res = await chamarGAS({ acao: 'processar_pagina_folha', dados: { pdf_base64: p.pdfBase64, competencia: p.competencia, nome_funcionario: p.nome, pagina: p.pagina, enviar_zapsign: true } })
  esconderLoading()
  if (res && res.ok) {
    paginasFracionadas[idx].status  = 'enviado'
    paginasFracionadas[idx].signUrl = res.data.sign_url || ''
    // Atualiza card para estado enviado
    const card = document.getElementById('fpc-' + idx)
    if (card) card.className = 'frac-page-card enviado'
    const numEl = document.getElementById('fpc-num-' + idx)
    if (numEl) { numEl.className = 'fpc-num enviado'; numEl.innerHTML = `<i class="ti ti-circle-check" style="font-size:11px;vertical-align:-1px"></i> Pág. ${p.pagina} — Enviado` }
    // Substitui botão enviar por "enviado" + links
    const actionEl = document.getElementById('fpc-action-' + idx)
    if (actionEl) {
      let links = `<span class="btn-enviado-frac"><i class="ti ti-check"></i></span>`
      if (res.data.sign_url) {
        links += `<a href="${res.data.sign_url}" target="_blank" class="btn-link-frac"><i class="ti ti-external-link"></i> Link</a>`
        const tel = p.telefone.replace(/\D/g,'')
        const waUrl = `https://wa.me/55${tel}?text=${encodeURIComponent('Olá '+p.nome.split(' ')[0]+', assine seu holerite: '+res.data.sign_url)}`
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
    // Gera todos os links primeiro, depois abre WhatsApp em sequência
    mostrarLoading('Gerando links de assinatura para ' + pendentes.length + ' funcionários...')
    const links = []  // { nome, telefone, link, wa_link }

    for (let i = 0; i < paginasFracionadas.length; i++) {
      const p = paginasFracionadas[i]
      if (!p.funcId || p.status !== 'pronto') continue
      mostrarLoading('Gerando link ' + (links.length + 1) + '/' + pendentes.length + ' — ' + p.nome.split(' ')[0])
      const res = await chamarGAS({
        acao: 'processar_pagina_proprio',
        dados: { pdf_base64: p.pdfBase64, tipo: p.tipoDoc || tipoDocAtual,
                 competencia: p.competencia, func_id: p.funcId, func_nome: p.nome, pagina: p.pagina }
      })
      if (res && res.ok) {
        paginasFracionadas[i].status = 'enviado'
        atualizarCardEnviado(i, res.data)
        links.push({ nome: p.nome.split(' ')[0], telefone: p.telefone, link: res.data.link, wa_link: res.data.wa_link })
      }
    }
    esconderLoading()
    atualizarBtnTodos()

    // Abre WhatsApp para cada funcionário em sequência com delay
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
  // Mostra modal com todos os links e botão WhatsApp por funcionário
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
}

// ─── SELECTS OCULTOS ──────────────────────────────────────────────
function preencherSelectsOcultos() {
  const selFunc = document.getElementById('sel-func-epi-hidden')
  if (selFunc) {
    selFunc.innerHTML = '<option value="">Selecione...</option>'
    funcionarios.forEach(f => { selFunc.innerHTML += `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>` })
  }
  const selEpi = document.getElementById('sel-epi-hidden')
  if (selEpi && estoque.length) {
    selEpi.innerHTML = '<option value="">Selecione...</option>'
    estoque.filter(e => parseInt(e['ESTOQUE ATUAL']) > 0).forEach(e => {
      selEpi.innerHTML += `<option value="${e['CÓD.']}">${e['CÓD.']} — ${e['DESCRIÇÃO DO EPI']}</option>`
    })
  }
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────
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
    '⛔ SEM ESTOQUE':'badge-vermelho','⛔ Recusado':'badge-vermelho',
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
