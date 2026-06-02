const GAS_URL = 'https://script.google.com/macros/s/AKfycbxayJeiQeUeHNfl0oz1xcJh6xzymXLREH-wosmRaLHTazaV6fo62y0bMgivnJTyv1oP/exec'
const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'

let USUARIO = null, SENHA_ADM = null
let funcionarios = [], estoque = [], itensEpiSel = []
let paginaAtual = 'inicio', todosExames = []
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
      preview.innerHTML = '<i class="ti ti-file-check" style="vertical-align:-2px"></i> ' + total + ' página(s) — ' + total + ' funcionário(s) serão processados'
    } catch(err) { preview.textContent = '❌ Erro ao ler PDF: ' + err.message }
  })
})

function entrarNoApp() {
  document.getElementById('tela-login').style.display = 'none'
  document.getElementById('tela-app').style.display   = 'flex'
  preencherMesesFracionar()
  preencherSelectsFuncionarios()
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
    } else { toast(d.verificados === 0 ? 'Nenhum documento pendente' : '🔄 ' + d.pendentes + ' ainda aguardando', '') }
  } else { toast('❌ Erro na sincronização', 'erro') }
}

const TITULOS = {
  'inicio':'Início','lista-func':'Funcionários','novo-func':'Novo Funcionário',
  'exames':'Exames','epi':'EPI','fracionar':'Folha de Pagamento',
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
    document.getElementById('num-epi').textContent = resEst.data.filter(e => {
      const s = e['SITUAÇÃO']||''; return s.includes('REPOR') || s.includes('SEM')
    }).length
  }

  // Monta lembretes de assinaturas pendentes
  const pendentesEpi   = (resEpi   && resEpi.ok)   ? resEpi.data.filter(e   => e['ASSINADO?'] === 'Pendente' && e['ZAPSIGN_DOC']) : []
  const pendentesFolha = (resFolha && resFolha.ok) ? resFolha.data.filter(f => f['STATUS']    === 'Pendente' && f['ZAPSIGN_DOC']) : []
  renderLembretes(pendentesEpi, pendentesFolha)
}


function renderLembretes(pendentesEpi, pendentesFolha) {
  const el = document.getElementById('lembretes-wrap')
  if (!el) return
  const todos = [
    ...pendentesEpi.map(e => ({
      tipo: 'EPI',
      nome: e['FUNCIONÁRIO'],
      descricao: e['DESCRIÇÃO DO EPI'],
      data: e['DATA ENTREGA'],
      token: e['ZAPSIGN_DOC'],
      signerToken: (e['OBSERVAÇÕES']||'').replace('Signer: ',''),
    })),
    ...pendentesFolha.map(f => ({
      tipo: 'Folha',
      nome: f['FUNCIONÁRIO'],
      descricao: f['COMPETÊNCIA'],
      data: f['DATA ENVIO'],
      token: f['ZAPSIGN_DOC'],
      signerToken: (f['OBSERVAÇÕES']||'').replace('Signer: ',''),
    })),
  ]

  if (!todos.length) {
    el.style.display = 'none'
    return
  }

  el.style.display = 'block'
  el.innerHTML = `
    <div class="card" style="border-color:rgba(133,79,11,0.3);background:#FFFBF5">
      <div class="card-titulo" style="color:var(--amber-text)">
        <i class="ti ti-bell-ringing" aria-hidden="true"></i>
        ${todos.length} assinatura(s) pendente(s)
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${todos.map((item, i) => {
          const func = funcionarios.find(f => f['NOME_COMPLETO'] === item.nome)
          const tel  = func ? '55' + func['TELEFONE'].replace(/\D/g,'') : ''
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border-radius:var(--radius-md);border:0.5px solid rgba(133,79,11,0.2)">
            <div class="avatar" style="background:var(--amber-bg);color:var(--amber-text);flex-shrink:0">${getIniciais(item.nome||'?')}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.nome}</div>
              <div style="font-size:11px;color:var(--text-secondary)">
                <span class="badge badge-amarelo" style="margin-right:4px">${item.tipo}</span>
                ${item.descricao} · ${item.data}
              </div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0">
              ${tel ? `<a href="https://wa.me/${tel}?text=${encodeURIComponent('Olá ' + (item.nome.split(' ')[0]) + ', seu documento está aguardando assinatura. Por favor acesse o link que enviamos no WhatsApp para assinar.')}" target="_blank"
                style="background:#22C55E;color:#fff;border:none;border-radius:7px;padding:6px 9px;font-size:13px;text-decoration:none;display:flex;align-items:center;gap:3px;font-weight:600">
                <i class="ti ti-brand-whatsapp"></i>
              </a>` : ''}
              <button onclick="reenviarZapSign('${item.signerToken}', '${item.nome}')"
                style="background:var(--blue-bg);color:var(--blue-text);border:none;border-radius:7px;padding:6px 9px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:3px;font-weight:600"
                title="Reenviar link via ZapSign">
                <i class="ti ti-send"></i>
              </button>
            </div>
          </div>`
        }).join('')}
      </div>
    </div>`
}

async function reenviarZapSign(signerToken, nome) {
  if (!signerToken || signerToken === 'undefined') {
    return toast('❌ Token não disponível para reenvio', 'erro')
  }
  mostrarLoading('Reenviando link para ' + nome.split(' ')[0] + '...')
  const res = await chamarGAS({ acao: 'reenviar_zapsign', dados: { signer_token: signerToken } })
  esconderLoading()
  if (res && res.ok) {
    toast('✅ Link reenviado para ' + nome.split(' ')[0] + ' via WhatsApp!', 'sucesso')
  } else {
    toast('❌ Erro ao reenviar: ' + ((res&&res.erro)||'tente novamente'), 'erro')
  }
}

function getIniciais(nome) {
  const p = nome.trim().split(' ').filter(x => x.length > 1)
  if (p.length >= 2) return (p[0][0] + p[p.length-1][0]).toUpperCase()
  return (nome[0]||'?').toUpperCase()
}

async function carregarFuncionarios() {
  mostrarLoading('Carregando funcionários...')
  const res = await chamarGAS({ acao: 'listar_funcionarios' })
  esconderLoading()
  if (!res || !res.ok) return toast('Erro ao carregar', 'erro')
  funcionarios = res.data
  renderFuncionarios(funcionarios)
  preencherSelectsFuncionarios()
}

function filtrarFuncionarios(q) {
  const lista = q ? funcionarios.filter(f => f['NOME_COMPLETO'].toLowerCase().includes(q.toLowerCase())) : funcionarios
  renderFuncionarios(lista)
}

function renderFuncionarios(lista) {
  const el = document.getElementById('lista-funcionarios')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum funcionário encontrado</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="avatar">${getIniciais(f['NOME_COMPLETO'])}</div>
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
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Salvando...'
  mostrarLoading('Cadastrando e criando pasta no Drive...')
  const dados = Object.fromEntries(new FormData(e.target).entries())
  const res = await chamarGAS({ acao: 'cadastrar_funcionario', dados })
  esconderLoading(); btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> Cadastrar'
  if (res && res.ok) {
    toast('✅ Cadastrado! ID: ' + res.data.id, 'sucesso')
    e.target.reset()
    const r2 = await chamarGAS({ acao: 'listar_funcionarios' })
    if (r2 && r2.ok) { funcionarios = r2.data; preencherSelectsFuncionarios() }
    setTimeout(() => irPara('lista-func'), 1500)
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

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
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum exame encontrado</p>'; return }
  el.innerHTML = lista.map(e => {
    const status = e['STATUS EXAME'] || '⏳ PENDENTE'
    const borderColor = status.includes('VENCIDO') ? 'var(--red-text)' : status.includes('A VENCER') ? 'var(--amber-text)' : 'var(--border)'
    return `<div class="lista-item" style="border-color:${borderColor}">
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['EXAME REALIZADO']}</div>
        <div class="lista-item-sub">${e['DATA REALIZAÇÃO']?'Realizado: '+e['DATA REALIZAÇÃO']:'Não realizado'}${e['DATA VENCIMENTO']?' · Vence: '+e['DATA VENCIMENTO']:''}</div>
      </div>
      ${badge(status)}
    </div>`
  }).join('')
}

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
  document.getElementById('lista-estoque').innerHTML = lista.map(e => {
    const sit = situacaoEpi(e)
    return `<div class="estoque-item">
      <span class="estoque-nome">${e['DESCRIÇÃO DO EPI']}</span>
      <span class="estoque-qtd">${e['ESTOQUE ATUAL']} ${e['UNIDADE']||'un'}</span>
      ${badge(sit)}
    </div>`
  }).join('')
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
      <button class="item-epi-del" onclick="removerItemEpi('${item.cod}')" type="button"><i class="ti ti-x"></i></button>
    </div>`).join('')
}

async function enviarEpi(e) {
  e.preventDefault()
  if (!itensEpiSel.length) return toast('❌ Selecione ao menos 1 EPI', 'erro')
  const fd = new FormData(e.target)
  const funcId = fd.get('func_id'), motivo = fd.get('motivo')
  if (!funcId) return toast('❌ Selecione o funcionário', 'erro')
  const btn = document.getElementById('btn-enviar-epi')
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Enviando...'
  mostrarLoading('Gerando recibo e enviando via ZapSign...')
  const res = await chamarGAS({ acao: 'entregar_epi', dados: { func_id: funcId, itens: itensEpiSel, motivo } })
  esconderLoading(); btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> Gerar recibo e enviar'
  if (res && res.ok) {
    if (res.data.link_assinatura) mostrarLinkAssinaturaEpi(res.data.link_assinatura, res.data.mensagem)
    else toast('✅ ' + res.data.mensagem, 'sucesso')
    itensEpiSel = []; renderItensEpi(); e.target.reset(); carregarEpi()
  } else { toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro') }
}

function mostrarLinkAssinaturaEpi(url, msg) {
  const el = document.getElementById('link-assinatura-epi')
  const func = funcionarios.find(f => String(f['ID']) === document.getElementById('sel-func-epi').value)
  const tel  = func ? '55' + func['TELEFONE'].replace(/\D/g,'') : ''
  const waUrl = tel ? `https://wa.me/${tel}?text=${encodeURIComponent('Por favor, assine o documento: '+url)}` : ''
  el.style.display = 'block'
  el.innerHTML = `
    <p class="link-ass-titulo">✅ ${msg}</p>
    <div class="link-ass-row">
      <input class="link-ass-input" id="inp-link-ass" value="${url}" readonly>
      <button class="btn-copiar" onclick="copiarLink()">Copiar</button>
      ${waUrl ? `<a href="${waUrl}" target="_blank" class="btn-wa"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
    </div>`
}

function copiarLink() {
  const inp = document.getElementById('inp-link-ass'); if (!inp) return
  inp.select(); document.execCommand('copy')
  toast('✅ Link copiado!', 'sucesso')
}

function renderEntregas(lista) {
  const el = document.getElementById('lista-entregas')
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhuma entrega registrada</p>'; return }
  el.innerHTML = lista.map(e => `
    <div class="lista-item">
      <div class="avatar" style="background:var(--blue-bg);color:var(--blue-text)">${getIniciais(e['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${e['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${e['DESCRIÇÃO DO EPI']} · ${e['DATA ENTREGA']}</div>
        ${e['LINK DOC ASSINADO'] ? `<a href="${e['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text)"><i class="ti ti-file-check" style="vertical-align:-2px"></i> Ver assinado</a>` : ''}
      </div>
      ${badge(e['ASSINADO?'])}
    </div>`).join('')
}

function preencherMesesFracionar() {
  const sel = document.getElementById('sel-comp-frac'); if (!sel) return
  sel.innerHTML = '<option value="">Selecione a competência...</option>'
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ano = new Date().getFullYear()
  const mesAtual = new Date().getMonth()
  for (let m = mesAtual; m >= 0; m--) sel.innerHTML += `<option value="${meses[m]}/${ano}">${meses[m]}/${ano}</option>`
  for (let m = 11; m > mesAtual; m--) sel.innerHTML += `<option value="${meses[m]}/${ano-1}">${meses[m]}/${ano-1}</option>`
}

async function carregarEntregasFolha() {
  const res = await chamarGAS({ acao: 'listar_folhas' })
  if (res && res.ok) renderHistoricoFolha(res.data.slice(0,20))
}

function renderHistoricoFolha(lista) {
  const el = document.getElementById('historico-folha')
  if (!el) return
  if (!lista.length) { el.innerHTML = '<p class="lista-vazia">Nenhum envio registrado</p>'; return }
  el.innerHTML = lista.map(f => `
    <div class="lista-item">
      <div class="avatar" style="background:var(--purple-bg);color:var(--purple-text)">${getIniciais(f['FUNCIONÁRIO']||'?')}</div>
      <div class="lista-item-info">
        <div class="lista-item-nome">${f['FUNCIONÁRIO']}</div>
        <div class="lista-item-sub">${f['COMPETÊNCIA']} · ${f['DATA ENVIO']}</div>
        ${f['LINK DOC ASSINADO'] ? `<a href="${f['LINK DOC ASSINADO']}" target="_blank" style="font-size:10px;color:var(--blue-text)"><i class="ti ti-file-check" style="vertical-align:-2px"></i> Ver assinado</a>` : ''}
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
      paginasFracionadas.push({ pagina: i+1, funcId:'', nome:'', telefone:'', pdfBase64: arrayBufferToBase64(await novoDoc.save()), status:'pronto', signUrl:'', competencia })
    }
    esconderLoading()
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-scissors"></i> Separar PDF'
    renderPaginasFracionadas(competencia)
    toast('🔍 Identificando funcionários automaticamente...', '')
    identificarFuncionariosAutomatico()
  } catch(err) {
    esconderLoading(); btn.disabled = false; btn.innerHTML = '<i class="ti ti-scissors"></i> Separar PDF'
    toast('❌ Erro: ' + err.message, 'erro')
  }
}

function renderPaginasFracionadas(competencia) {
  const wrap = document.getElementById('frac-resultado')
  const lista = document.getElementById('frac-lista')
  wrap.style.display = 'block'
  lista.innerHTML = `
    <div style="background:var(--verde-claro);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--verde-text);font-weight:600">
      <i class="ti ti-scissors" style="vertical-align:-2px"></i> ${paginasFracionadas.length} página(s) separadas
    </div>
    <button onclick="enviarTodasPendentes()" class="btn-primario w-full mb-3" style="font-size:12px">
      <i class="ti ti-brand-whatsapp"></i> Enviar todas via WhatsApp
    </button>
    ${paginasFracionadas.map((p, i) => `
    <div class="frac-card-page" id="pag-card-${i}">
      <div class="frac-page-header">
        <span class="frac-page-num"><i class="ti ti-file-text" style="vertical-align:-2px"></i> Página ${p.pagina}</span>
        <div class="frac-page-actions">
          <button onclick="visualizarPagina(${i})" class="btn-ver-pdf"><i class="ti ti-eye"></i> Ver PDF</button>
          <span id="status-pag-${i}">${badge('pronto')}</span>
        </div>
      </div>
      <select id="func-sel-${i}" class="frac-select" onchange="selecionarFuncPagina(${i}, this.value)">
        <option value="">⏳ Identificando... / Selecione manualmente</option>
        ${funcionarios.map(f => `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>`).join('')}
      </select>
      <div id="actions-${i}" class="frac-links" style="display:none">
        <button onclick="enviarPaginaZapSign(${i})" id="btn-zap-${i}" class="btn-enviar-zap">
          <i class="ti ti-brand-whatsapp"></i> Enviar
        </button>
        <a id="link-btn-${i}" href="#" target="_blank" class="btn-link-ass" style="display:none">
          <i class="ti ti-external-link"></i> Link
        </a>
      </div>
    </div>`).join('')}
  `
}

async function identificarFuncionariosAutomatico() {
  let identificados = 0
  for (let i = 0; i < paginasFracionadas.length; i++) {
    try {
      const res = await chamarGAS({ acao: 'identificar_funcionario_pdf', dados: { pdf_base64: paginasFracionadas[i].pdfBase64 } })
      if (res && res.ok && res.data && res.data.func_id) {
        const func = funcionarios.find(f => String(f['ID']) === String(res.data.func_id))
        if (func) {
          paginasFracionadas[i].funcId   = String(func['ID'])
          paginasFracionadas[i].nome     = func['NOME_COMPLETO']
          paginasFracionadas[i].telefone = func['TELEFONE']
          const sel = document.getElementById('func-sel-' + i)
          if (sel) sel.value = func['ID']
          const actions = document.getElementById('actions-' + i)
          if (actions) actions.style.display = 'flex'
          const card = document.getElementById('pag-card-' + i)
          if (card) card.style.borderColor = '#C8E6C9'
          const statusEl = document.getElementById('status-pag-' + i)
          if (statusEl) statusEl.innerHTML = `<span class="badge badge-verde">✅ ${func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]}</span>`
          identificados++
        }
      } else {
        const card = document.getElementById('pag-card-' + i)
        if (card) card.style.borderColor = '#FFE0B2'
        const statusEl = document.getElementById('status-pag-' + i)
        if (statusEl) statusEl.innerHTML = `<span class="badge badge-amarelo">⚠️ Manual</span>`
      }
    } catch(err) { console.warn('Erro página ' + (i+1), err) }
  }
  toast(identificados === paginasFracionadas.length
    ? '✅ Todos os ' + identificados + ' funcionários identificados!'
    : '✅ ' + identificados + ' identificados · ' + (paginasFracionadas.length - identificados) + ' selecione manualmente', 'sucesso')
}

function visualizarPagina(idx) {
  const p = paginasFracionadas[idx]; if (!p || !p.pdfBase64) return toast('❌ PDF não disponível', 'erro')
  const bytes = Uint8Array.from(atob(p.pdfBase64), c => c.charCodeAt(0))
  const url   = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function selecionarFuncPagina(idx, funcId) {
  const func = funcionarios.find(f => String(f['ID']) === String(funcId)); if (!func) return
  paginasFracionadas[idx].funcId   = funcId
  paginasFracionadas[idx].nome     = func['NOME_COMPLETO']
  paginasFracionadas[idx].telefone = func['TELEFONE']
  const actions = document.getElementById('actions-' + idx)
  if (actions) actions.style.display = 'flex'
}

async function enviarPaginaZapSign(idx) {
  const p = paginasFracionadas[idx]
  if (!p.funcId) return toast('❌ Selecione o funcionário primeiro', 'erro')
  const btn = document.getElementById('btn-zap-' + idx)
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>'
  mostrarLoading('Enviando para ZapSign...')
  const res = await chamarGAS({ acao: 'processar_pagina_folha', dados: { pdf_base64: p.pdfBase64, competencia: p.competencia, nome_funcionario: p.nome, pagina: p.pagina, enviar_zapsign: true } })
  esconderLoading()
  if (res && res.ok) {
    paginasFracionadas[idx].status  = 'enviado'
    paginasFracionadas[idx].signUrl = res.data.sign_url || ''
    btn.innerHTML = '<i class="ti ti-check"></i> Enviado'; btn.style.background = '#22C55E'
    const statusEl = document.getElementById('status-pag-' + idx)
    if (statusEl) statusEl.innerHTML = `<span class="badge badge-amarelo">Pendente</span>`
    if (res.data.sign_url) {
      const linkBtn = document.getElementById('link-btn-' + idx)
      if (linkBtn) { linkBtn.href = res.data.sign_url; linkBtn.style.display = 'flex' }
      const tel = p.telefone.replace(/\D/g,'')
      const waUrl = `https://wa.me/55${tel}?text=${encodeURIComponent('Olá ' + p.nome.split(' ')[0] + ', assine seu holerite: ' + res.data.sign_url)}`
      const actions = document.getElementById('actions-' + idx)
      if (actions && !actions.querySelector('.btn-wa')) {
        const wa = document.createElement('a')
        wa.href = waUrl; wa.target = '_blank'; wa.className = 'btn-wa'
        wa.innerHTML = '<i class="ti ti-brand-whatsapp"></i> WA'
        actions.appendChild(wa)
      }
    }
    toast('✅ ' + p.nome.split(' ')[0] + ' — enviado!', 'sucesso')
    carregarEntregasFolha()
  } else {
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-brand-whatsapp"></i> Enviar'
    toast('❌ ' + ((res&&res.erro)||'Erro'), 'erro')
  }
}

async function enviarTodasPendentes() {
  const pendentes = paginasFracionadas.filter(p => p.funcId && p.status === 'pronto')
  if (!pendentes.length) return toast('⚠️ Selecione os funcionários primeiro', 'erro')
  for (let i = 0; i < paginasFracionadas.length; i++) {
    if (paginasFracionadas[i].funcId && paginasFracionadas[i].status === 'pronto') await enviarPaginaZapSign(i)
  }
}

function preencherSelectsFuncionarios() {
  const sel = document.getElementById('sel-func-epi'); if (!sel) return
  sel.innerHTML = '<option value="">Selecione...</option>'
  funcionarios.forEach(f => { sel.innerHTML += `<option value="${f['ID']}">${f['NOME_COMPLETO']}</option>` })
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
