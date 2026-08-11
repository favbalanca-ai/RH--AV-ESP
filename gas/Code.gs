// ═══════════════════════════════════════════════════════════════════
// SST FAZENDA ÁGUA VIVA — Google Apps Script Backend
// ═══════════════════════════════════════════════════════════════════
//
// CÓPIA VERSIONADA E SANITIZADA — não contém credenciais reais.
//
// ⚠️ ANTES DE USAR, configure os segredos em:
//    Projeto → ⚙ Configurações do projeto → Propriedades do script
//    - ZAPSIGN_TOKEN : token da API da ZapSign
//    - ANTHROPIC_KEY : chave da API da Anthropic (sk-ant-...)
// E preencha os IDs marcados como 'COLE_..._AQUI' no CONFIG abaixo.
//
// NUNCA comite tokens/chaves/senhas reais neste arquivo.
//
// Fixes aplicados nesta cópia:
//  - enviarParaZapSign(): normaliza o telefone (remove o 55 inicial, pois
//    phone_country já é '55') + valida DDD+número + erro com HTTP code.
//  - identificarDocumentoComIA(): modelo corrigido para 'claude-sonnet-4-6'.
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  SHEET_ID:          'COLE_O_ID_DA_PLANILHA_AQUI',
  DRIVE_ROOT_FOLDER: 'COLE_O_ID_DA_PASTA_DRIVE_AQUI',
  // Token lido das Propriedades do Script (não fica no código)
  get ZAPSIGN_TOKEN() {
    return PropertiesService.getScriptProperties().getProperty('ZAPSIGN_TOKEN') || ''
  },
  ZAPSIGN_URL:       'https://api.zapsign.com.br/api/v1',
  ADM_USERS: {
    // Defina os usuários/senhas reais aqui (não comitar senhas reais).
    'admin': 'TROCAR_SENHA',
  },
  ABAS: {
    FUNCIONARIOS:   'FUNCIONARIOS',
    EXAMES_CONFIG:  'EXAMES_POR_FUNCAO',
    EXAMES:         'CONTROLE_EXAMES',
    EPI_ESTOQUE:    'EPI_ESTOQUE',
    EPI_ENTREGAS:   'EPI_ENTREGAS',
    FOLHA:          'FOLHA_PAGAMENTO',
    ENCARGOS:       'ENCARGOS',
    LOG:            'LOG_ACOES',
  }
}

function doPost(e) {
  // Rodar doPost pelo botão Executar do editor chega aqui com 'e' indefinido —
  // é o caminho usual para autorizar os escopos do script. Sem esta guarda o
  // clique virava "ERRO · SISTEMA: Cannot read properties of undefined" no log,
  // indistinguível de uma requisição do app que falhou de verdade.
  if (!e || !e.postData || !e.postData.contents) {
    return respErro('Este endereço espera uma requisição POST com JSON. ' +
      'Se você chegou aqui pelo botão Executar do editor, está tudo certo: ' +
      'os escopos foram autorizados e não há nada a corrigir.', 400)
  }

  try {
    const body = JSON.parse(e.postData.contents)
    const acao = body.acao

    // Rotas públicas — sem login (funcionário acessando)
    if (acao === 'buscar_doc_assinatura') return respOk(buscarDocAssinatura(body.token))
    if (acao === 'confirmar_assinatura')  return respOk(confirmarAssinatura(body.token, body.assinatura, body.pdf_assinado || null))
    if (acao === 'buscar_pagamento')             return respOk(buscarPagamento(body.token))
    if (acao === 'confirmar_pagamento_empregador') return respOk(confirmarPagamentoEmpregador(body))
    if (acao === 'registrar_comprovante')          return respOk(registrarComprovante(body))
    if (acao === 'webhook_zapsign' || (!acao && (body.status || body.token || body.open_id || body.document))) {
      return respOk(webhookZapSign(body))
    }

    const usuario = verificarLogin(body.usuario, body.senha)
    if (!usuario) return respErro('Usuário ou senha incorretos', 401)

    switch (acao) {
      case 'listar_funcionarios':         return respOk(listarFuncionarios())
      case 'cadastrar_funcionario':       return respOk(cadastrarFuncionario(body.dados, usuario))
      case 'atualizar_funcionario':         return respOk(atualizarFuncionario(body.dados, usuario))
      case 'listar_exames':               return respOk(listarExames())
      case 'listar_epi_estoque':          return respOk(listarEpiEstoque())
      case 'listar_epi_entregas':         return respOk(listarEpiEntregas())
      case 'entregar_epi':                return respOk(entregarEpi(body.dados, usuario))
      case 'listar_epi_acumulados':       return respOk(listarEpiAcumulados())
      case 'fechar_mes_epi':              return respOk(fecharMesEpi(body.dados, usuario))
      case 'enviar_folha':                return respOk(enviarFolha(body.dados, usuario))
      case 'listar_folhas':               return respOk(listarFolhas())
      case 'sincronizar':                 return respOk(sincronizarPendentes())
      case 'reenviar_zapsign':            return respOk(reenviarZapSignGAS(body.dados))
      case 'gerar_link_assinatura':       return respOk(gerarLinkAssinatura(body.dados, usuario))
      case 'processar_pagina_proprio':    return respOk(processarPaginaProprio(body.dados, usuario))
      case 'identificar_com_ia':          return respOk(identificarDocumentoComIA(body.dados))
      case 'diagnosticar_ia':             return respOk(diagnosticarIA(body.dados))

      // Módulo Pagamento — somente ADM
      case 'cadastrar_comissao':          return respOk(cadastrarComissao(body.dados, usuario))
      case 'listar_comissoes':            return respOk(listarComissoes(body.dados))
      case 'registrar_adiantamento':      return respOk(registrarAdiantamento(body.dados, usuario))
      case 'listar_adiantamentos':        return respOk(listarAdiantamentos(body.dados))
      case 'resumo_comissao':             return respOk(resumoComissao(body.dados))
      case 'gerar_autorizacao_pagamento': return respOk(gerarAutorizacaoPagamento(body.dados, usuario))
      case 'gerar_recibo_adiantamento':   return respOk(gerarReciboAdiantamento(body.dados, usuario))
      case 'listar_autorizacoes':         return respOk(listarAutorizacoes(body.dados))
      case 'gerar_msg_pagamento':         return respOk(gerarMensagemPagamento(body.dados))
      case 'gerar_relatorio_pagamentos': return respOk(gerarRelatorioPagamentos(body.dados))
      case 'liquidar_salario':              return respOk(liquidarSalario(body.dados, usuario))
      case 'listar_log':                 return respOk(listarLog(body.dados))
      case 'listar_ferias':              return respOk(listarFerias())
      case 'atualizar_ferias':           return respOk(atualizarFerias(body.dados))
      case 'corrigir_arquivamento_ferias': return respOk(corrigirArquivamentoFerias())
      case 'salvar_plano_ferias':        return respOk(salvarPlanoFerias(body.dados, usuario))
      case 'excluir_plano_ferias':       return respOk(excluirPlanoFerias(body.dados, usuario))
      case 'listar_pagamentos_func':        return respOk(listarPagamentos(body.dados))
      case 'listar_pagamentos':           return respOk(listarPagamentos(body.dados))
      case 'confirmar_notificacao':       return respOk(confirmarNotificacao(body.dados, usuario))
      case 'cancelar_notificacao':        return respOk(cancelarNotificacao(body.dados, usuario))
      case 'processar_pagina_folha':      return respOk(processarPaginaFolha(body.dados, usuario))
      case 'identificar_funcionario_pdf': return respOk(identificarFuncionarioPdf(body.dados))
      case 'historico_folha':             return respOk(historicoFolha(body.dados))
      case 'marcar_pago':                 return respOk(marcarPago(body.dados, usuario))
      case 'reanalisar_folhas':           return respOk(reanalisarFolhas(body.dados, usuario))

      // Custo de mão de obra
      case 'custo_mdo':                   return respOk(custoMdo(body.dados))
      case 'listar_encargos':             return respOk(listarEncargos())
      case 'salvar_encargos':             return respOk(salvarEncargos(body.dados, usuario))
      default: return respErro('Ação desconhecida: ' + acao)
    }
  } catch (err) {
    logAcao('SISTEMA', 'ERRO', err.message)
    return respErro('Erro interno: ' + err.message)
  }
}

function doGet(e) {
  // Abrir a URL /exec no navegador cai aqui. É o teste rápido de que a
  // implantação está no ar e pública — por isso responde sem exigir nada.
  return ContentService.createTextOutput(JSON.stringify({
    ok: true, msg: 'SST API ativa', versao: VERSAO_BACKEND,
  })).setMimeType(ContentService.MimeType.JSON)
}

// Sobe junto com o deploy. Aberta a URL /exec, diz qual versão está no ar —
// é como se confere que o deploy realmente pegou, sem depender de sintoma.
var VERSAO_BACKEND = '20260818'

function verificarLogin(usuario, senha) {
  if (!usuario || !senha) return null
  const senhaCorreta = CONFIG.ADM_USERS[usuario.toLowerCase()]
  if (!senhaCorreta || senhaCorreta !== senha) return null
  return usuario
}

function getSheet(nomeAba) {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(nomeAba)
}

// Célula de data vira texto dd/MM/yyyy. Sem isto o objeto sai com um Date,
// que no JSON da resposta vira "2026-07-01T07:00:00.000Z" — foi assim que a
// competência apareceu crua na tela de pagamentos.
function ehData(v) {
  // Não usa `instanceof Date`: ele compara o construtor do contexto atual e
  // devolve false para uma data vinda de outro contexto. O toString é o teste
  // que não depende disso.
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())
}

function valorDeCelula(v) {
  if (ehData(v)) {
    // 1899 é a data-zero do Sheets: célula de hora sem data, ou vazia.
    return v.getFullYear() === 1899 ? '' : Utilities.formatDate(v, 'America/Sao_Paulo', 'dd/MM/yyyy')
  }
  return v ?? ''
}

function lerAbaComoObjetos(nomeAba) {
  const sheet = getSheet(nomeAba)
  const dados = sheet.getDataRange().getValues()
  if (dados.length < 2) return []
  const headers = dados[0]
  return dados.slice(1)
    .filter(row => row.some(c => c !== ''))
    .map(row => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = valorDeCelula(row[i]) })
      return obj
    })
}

// Grava um valor por NOME de coluna na última linha da aba, criando a coluna
// se ela ainda não existir. Serve para completar uma linha que acabou de ser
// acrescentada por appendRow — que é posicional e não conhece nomes.
function definirNaUltimaLinha(nomeAba, coluna, valor) {
  var sheet = getSheet(nomeAba)
  var ultima = sheet.getLastRow()
  if (ultima < 2) return
  var hdrs = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h).trim() })
  var i = hdrs.indexOf(coluna)
  if (i < 0) { i = hdrs.length; sheet.getRange(1, i + 1).setValue(coluna) }
  sheet.getRange(ultima, i + 1).setValue(valor)
}

function adicionarLinha(nomeAba, valores) {
  getSheet(nomeAba).appendRow(valores)
}

function atualizarCelulasPorId(nomeAba, colunaId, valorId, atualizacoes) {
  const sheet = getSheet(nomeAba)
  const dados = sheet.getDataRange().getValues()
  const headers = dados[0]
  const idIdx = headers.indexOf(colunaId)
  if (idIdx === -1) return false
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idIdx]) === String(valorId)) {
      Object.entries(atualizacoes).forEach(([col, val]) => {
        const cIdx = headers.indexOf(col)
        if (cIdx !== -1) sheet.getRange(i + 1, cIdx + 1).setValue(val)
      })
      return true
    }
  }
  return false
}

// Igual a atualizarCelulasPorId, mas atualiza TODAS as linhas com o mesmo valor
// (usado quando vários registros compartilham um doc, ex.: recibo mensal de EPI).
function atualizarTodasCelulasPorId(nomeAba, colunaId, valorId, atualizacoes) {
  const sheet = getSheet(nomeAba)
  const dados = sheet.getDataRange().getValues()
  const headers = dados[0]
  const idIdx = headers.indexOf(colunaId)
  if (idIdx === -1) return 0
  let n = 0
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idIdx]) === String(valorId)) {
      Object.entries(atualizacoes).forEach(([col, val]) => {
        const cIdx = headers.indexOf(col)
        if (cIdx !== -1) sheet.getRange(i + 1, cIdx + 1).setValue(val)
      })
      n++
    }
  }
  return n
}

function proximoId(nomeAba, colunaId) {
  const dados = lerAbaComoObjetos(nomeAba)
  return dados.reduce((mx, row) => Math.max(mx, parseInt(row[colunaId]) || 0), 0) + 1
}

function listarFuncionarios() {
  return lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS).filter(f => f['STATUS'] === 'Ativo')
}

function cadastrarFuncionario(dados, usuario) {
  const novoId = proximoId(CONFIG.ABAS.FUNCIONARIOS, 'ID')
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  const nomePasta = String(novoId).padStart(3,'0') + '_' + dados.nome_completo.toUpperCase().replace(/\s+/g,'_')

  let linkDrive = ''
  try {
    const pasta = criarPastaFuncionario(novoId, dados.nome_completo)
    linkDrive = 'https://drive.google.com/drive/folders/' + pasta.getId()
  } catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }

  adicionarLinha(CONFIG.ABAS.FUNCIONARIOS, [
    novoId, dados.status || 'Ativo', dados.nome_completo, dados.nome_curto || '',
    dados.cpf || '', dados.rg || '', dados.data_nascimento || '', dados.telefone || '',
    dados.empregador || '', dados.unidade || '', dados.funcao || '', dados.perfil_sst || '',
    dados.data_admissao || hoje, dados.fim_experiencia || '',
    dados.opera_maquina || 'Não', dados.aplica_defensivo || 'Não',
    dados.tam_camisa || '', dados.tam_bota || '',
    nomePasta, linkDrive, dados.email || '', dados.observacoes || '',
    dados.whatsapp_empregador || '',
    dados.banco || '', dados.agencia || '', dados.conta || '', dados.pix || '',
    dados.salario_base || '', dados.comissao_anual || '',
  ])

  cadastrarExamesAutomaticos(novoId, dados.nome_completo, dados.funcao, dados.unidade, dados.perfil_sst)
  logAcao(usuario, 'CADASTRO_FUNCIONARIO', 'ID ' + novoId + ' — ' + dados.nome_completo)
  return { id: novoId, link_drive: linkDrive }
}

function listarExames() {
  return lerAbaComoObjetos(CONFIG.ABAS.EXAMES)
}

function cadastrarExamesAutomaticos(funcId, nome, funcao, unidade, perfil) {
  const exames = lerAbaComoObjetos(CONFIG.ABAS.EXAMES_CONFIG)
    .filter(e => e['PERFIL'] === perfil || e['PERFIL'] === 'TODOS')
  const hoje = new Date()
  exames.forEach(exame => {
    adicionarLinha(CONFIG.ABAS.EXAMES, [
      funcId, nome, funcao, unidade, perfil, 'Admissional', exame['EXAME'],
      '', '', exame['PERIODICIDADE_DIAS'] || 365, '', '', '⏳ PENDENTE', '',
      'Gerado automaticamente — ' + Utilities.formatDate(hoje, 'America/Sao_Paulo', 'dd/MM/yyyy'),
    ])
  })
}

function listarEpiEstoque() { return lerAbaComoObjetos(CONFIG.ABAS.EPI_ESTOQUE) }
function listarEpiEntregas() { return lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS).reverse() }

function entregarEpi(dados, usuario) {
  const func = listarFuncionarios().find(f => String(f['ID']) === String(dados.func_id))
  if (!func) throw new Error('Funcionário não encontrado')

  dados.itens.forEach(item => {
    const sheet = getSheet(CONFIG.ABAS.EPI_ESTOQUE)
    const vals = sheet.getDataRange().getValues()
    const hdrs = vals[0]
    const codIdx = hdrs.indexOf('CÓD.')
    const estIdx = hdrs.indexOf('ESTOQUE ATUAL')
    for (let i = 1; i < vals.length; i++) {
      if (vals[i][codIdx] === item.cod) {
        const est = parseInt(vals[i][estIdx]) || 0
        if (est < parseInt(item.quantidade)) throw new Error('Estoque insuficiente para ' + item.descricao)
        sheet.getRange(i + 1, estIdx + 1).setValue(est - parseInt(item.quantidade))
        break
      }
    }
  })

  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')

  // MODO ACUMULAR: grava as entregas do mês sem enviar para assinatura.
  // O documento consolidado é enviado depois via fecharMesEpi().
  if (dados.metodo_assinatura === 'acumular') {
    const nums = []
    dados.itens.forEach(item => {
      const num = (lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS).length + 1).toString().padStart(4,'0')
      adicionarLinha(CONFIG.ABAS.EPI_ENTREGAS, [
        num, hoje, dados.func_id, func['NOME_COMPLETO'],
        item.cod, item.descricao, item.ca, item.quantidade,
        dados.motivo, 'Acumulado', '', '', '', 'Acumulado no mês',
      ])
      nums.push(num)
    })
    logAcao(usuario, 'EPI_ACUMULADO', 'Func ' + dados.func_id + ' | ' + dados.itens.map(i=>i.cod).join(','))
    return {
      numeros_registro: nums, acumulado: true,
      mensagem: dados.itens.length + ' EPI(s) registrados no mês para ' +
        (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '. Feche o mês para enviar à assinatura.',
    }
  }

  const pdfBase64 = gerarReciboEpiPdf(func, dados.itens, dados.motivo, usuario)
  const nomeDoc   = 'Recibo_EPI_' + (func['NOME_CURTO'] || func['NOME_COMPLETO']) + '_' + hoje.replace(/\//g,'-')
  const usarZapSign = dados.metodo_assinatura !== 'proprio'
  const zap = usarZapSign
    ? enviarParaZapSign(pdfBase64, nomeDoc, func['NOME_COMPLETO'], func['TELEFONE'])
    : { token: '', signUrl: '', signerToken: '' }

  const numeros = []
  dados.itens.forEach(item => {
    const num = (lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS).length + 1).toString().padStart(4,'0')
    adicionarLinha(CONFIG.ABAS.EPI_ENTREGAS, [
      num, hoje, dados.func_id, func['NOME_COMPLETO'],
      item.cod, item.descricao, item.ca, item.quantidade,
      dados.motivo, usarZapSign ? 'Pendente' : 'Aguardando Assinatura', '', zap.token || '', '', usarZapSign ? 'Signer: ' + (zap.signerToken || '') : 'Assinatura Própria',
    ])
    numeros.push(num)
    // O recibo pendente já ia para o Drive; o link é que se perdia aqui, e
    // sem ele não havia como abrir o documento antes de assinado.
    try {
      const linkPendente = salvarPdfNoDrive(dados.func_id, func['NOME_COMPLETO'],
        'EPI_RECIBOS', nomeDoc + '_PENDENTE.pdf', pdfBase64)
      if (linkPendente) definirNaUltimaLinha(CONFIG.ABAS.EPI_ENTREGAS, 'LINK PDF ORIGINAL', linkPendente)
    } catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
  })

  logAcao(usuario, 'ENTREGA_EPI', 'Func ' + dados.func_id + ' | ' + dados.itens.map(i=>i.cod).join(',') + ' | ZapSign: ' + zap.token)
  return {
    numeros_registro:  numeros,
    link_assinatura:   zap.signUrl || '',
    mensagem:          usarZapSign
      ? 'Recibo enviado para WhatsApp de ' + (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '. Aguardando assinatura.'
      : 'Recibo gerado para ' + (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '. Envie o link de assinatura.',
    pdf_base64:        pdfBase64,
    metodo_assinatura: dados.metodo_assinatura || 'zapsign',
  }
}

// Lista os EPIs acumulados (ainda não enviados p/ assinatura), agrupados por funcionário.
function listarEpiAcumulados() {
  const acum = lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS).filter(e => e['ASSINADO?'] === 'Acumulado')
  const porFunc = {}
  acum.forEach(e => {
    const id = String(e['ID FUNC.'])
    if (!porFunc[id]) porFunc[id] = { func_id: id, nome: e['FUNCIONÁRIO'], itens: [] }
    porFunc[id].itens.push({
      cod: e['CÓD. EPI'] || '', descricao: e['DESCRIÇÃO DO EPI'] || '',
      ca: e['Nº CA'] || '', quantidade: e['QUANTIDADE'] || 1,
      data: e['DATA ENTREGA'] || '', motivo: e['MOTIVO ENTREGA'] || '',
    })
  })
  return Object.keys(porFunc).map(k => porFunc[k])
}

// Fecha o mês: consolida os EPIs acumulados de um funcionário em UM recibo e
// envia para assinatura (ZapSign) ou gera o PDF p/ assinatura própria.
function fecharMesEpi(dados, usuario) {
  const func = listarFuncionarios().find(f => String(f['ID']) === String(dados.func_id))
  if (!func) throw new Error('Funcionário não encontrado')

  const sheet = getSheet(CONFIG.ABAS.EPI_ENTREGAS)
  const vals  = sheet.getDataRange().getValues()
  const hdrs  = vals[0]
  const idFuncIdx = hdrs.indexOf('ID FUNC.')
  const statusIdx = hdrs.indexOf('ASSINADO?')
  const zapIdx    = hdrs.indexOf('ZAPSIGN_DOC')
  const codIdx    = hdrs.indexOf('CÓD. EPI')
  const descIdx   = hdrs.indexOf('DESCRIÇÃO DO EPI')
  const caIdx     = hdrs.indexOf('Nº CA')
  const qtdIdx    = hdrs.indexOf('QUANTIDADE')

  const rowsIdx = [], itens = []
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][idFuncIdx]) === String(dados.func_id) && String(vals[r][statusIdx]).trim() === 'Acumulado') {
      rowsIdx.push(r)
      itens.push({ cod: vals[r][codIdx], descricao: vals[r][descIdx], ca: vals[r][caIdx], quantidade: vals[r][qtdIdx] })
    }
  }
  if (!itens.length) throw new Error('Nenhum EPI acumulado para este funcionário')

  const mesRef = dados.competencia || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'MM/yyyy')
  const motivo = 'Entregas do mês ' + mesRef
  const pdfBase64 = gerarReciboEpiPdf(func, itens, motivo, usuario)
  const nomeDoc = 'Recibo_EPI_MENSAL_' + mesRef.replace(/\//g,'-') + '_' + (func['NOME_CURTO'] || func['NOME_COMPLETO'])

  if (dados.metodo_assinatura === 'proprio') {
    // Marca as linhas como aguardando; confirmarAssinatura() as fecha todas juntas.
    rowsIdx.forEach(r => { sheet.getRange(r + 1, statusIdx + 1).setValue('Aguardando Assinatura') })
    logAcao(usuario, 'EPI_FECHAR_MES', 'Func ' + dados.func_id + ' | ' + itens.length + ' itens | ' + mesRef + ' | próprio')
    return {
      pdf_base64: pdfBase64, itens: itens, motivo: motivo, consolidado: true, metodo_assinatura: 'proprio',
      mensagem: 'Recibo mensal gerado para ' + (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '. Envie o link de assinatura.',
    }
  }

  const zap = enviarParaZapSign(pdfBase64, nomeDoc, func['NOME_COMPLETO'], func['TELEFONE'])
  rowsIdx.forEach(r => {
    sheet.getRange(r + 1, statusIdx + 1).setValue('Pendente')
    if (zapIdx >= 0) sheet.getRange(r + 1, zapIdx + 1).setValue(zap.token || '')
  })
  try { salvarPdfNoDrive(dados.func_id, func['NOME_COMPLETO'], 'EPI_RECIBOS', nomeDoc + '_PENDENTE.pdf', pdfBase64) }
  catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
  logAcao(usuario, 'EPI_FECHAR_MES', 'Func ' + dados.func_id + ' | ' + itens.length + ' itens | ' + mesRef + ' | ZapSign: ' + zap.token)
  return {
    consolidado: true, link_assinatura: zap.signUrl || '',
    mensagem: 'Recibo mensal (' + itens.length + ' itens) enviado para WhatsApp de ' +
      (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '. Aguardando assinatura.',
  }
}

function listarFolhas() { return lerAbaComoObjetos(CONFIG.ABAS.FOLHA).reverse() }

function enviarFolha(dados, usuario) {
  const func = listarFuncionarios().find(f => String(f['ID']) === String(dados.func_id))
  if (!func) throw new Error('Funcionário não encontrado')
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  const pdf = dados.pdf_base64 || gerarCapaFolhaPdf(func, dados.competencia, usuario)
  const nomeDoc = nomeDocumentoAssinatura(dados.tipo || 'Folha', dados.competencia, func['NOME_COMPLETO'])
  const zap = enviarParaZapSign(pdf, nomeDoc, func['NOME_COMPLETO'], func['TELEFONE'])
  adicionarLinhaFolha({
    'ID FUNC.':       dados.func_id,
    'FUNCIONÁRIO':    func['NOME_COMPLETO'],
    'COMPETÊNCIA':    dados.competencia,
    'DATA ENVIO':     hoje,
    'STATUS':         'Pendente',
    'ZAPSIGN_DOC':    zap.token || '',
    'OBSERVAÇÕES':    'Signer: ' + (zap.signerToken || ''),
    'VALOR_LIQUIDO':  valorNumerico(dados.valor_liquido),
    'TIPO':           dados.tipo || 'Folha',
    'VERBAS':         verbasParaCelula(normalizarVerbas(dados.verbas)),
    'BASES':          basesParaCelula(normalizarBases(dados.bases)),
    'PARAMETROS':     parametrosParaCelula(normalizarParametros(dados.parametros)),
  })
  try { salvarPdfNoDrive(dados.func_id, func['NOME_COMPLETO'], 'FOLHA_PAGAMENTO', nomeDoc + '_PENDENTE.pdf', pdf) }
  catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
  logAcao(usuario, 'ENVIO_FOLHA', 'Func ' + dados.func_id + ' | ' + dados.competencia + ' | ZapSign: ' + zap.token)
  return { link_assinatura: zap.signUrl || '', mensagem: 'Folha de ' + dados.competencia + ' enviada para WhatsApp de ' + func['NOME_CURTO'] + '. Aguardando assinatura.' }
}

function webhookZapSign(body) {
  const status = body.status || (body.document && body.document.status) || ''
  const docToken = body.token || (body.document && body.document.token) || body.open_id || (body.document && body.document.open_id) || ''
  logAcao('WEBHOOK', 'RECEBIDO', 'status=' + status + ' | token=' + docToken)
  if (status !== 'signed') return { ignorado: true, status: status }
  if (!docToken) return { ignorado: true, motivo: 'token não encontrado' }
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')

  const entregas = lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS)
  const entrega = entregas.find(e => String(e['ZAPSIGN_DOC']).trim() === String(docToken).trim())
  if (entrega) {
    atualizarTodasCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', docToken, { 'ASSINADO?': 'Sim', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
    try {
      const link = salvarPdfNoDrive(entrega['ID FUNC.'], entrega['FUNCIONÁRIO'], 'EPI_RECIBOS', 'Recibo_EPI_' + hoje.replace(/\//g,'-') + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(docToken))
      atualizarTodasCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', docToken, { 'LINK DOC ASSINADO': link })
    } catch(e) { logAcao('WEBHOOK', 'DRIVE_OPCIONAL', e.message) }
    logAcao('WEBHOOK', 'ASSINATURA_EPI', 'Doc: ' + docToken)
    return { ok: true, tipo: 'epi' }
  }

  const folhas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA)
  const folha = folhas.find(f => String(f['ZAPSIGN_DOC']).trim() === String(docToken).trim())
  if (folha) {
    atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', docToken, { 'STATUS': 'Assinado', 'DATA ASSINATURA': hoje })
    try {
      const comp = String(folha['COMPETÊNCIA'] || 'semdata').replace(/\//g,'-')
      const tipoF = tipoDaFolha(folha, docToken)
      const subF = subpastaDoTipo(tipoF)
      const link = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], subF, tipoF + '_' + comp + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(docToken))
      atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', docToken, { 'LINK DOC ASSINADO': link })
      // Ordem de pagamento do valor a receber (folha ou férias)
      try {
        gerarOrdemDeAssinatura({
          func_id:       folha['ID FUNC.'],
          competencia:   String(folha['COMPETÊNCIA'] || ''),
          valor_liquido: folha['VALOR_LIQUIDO'] ? parseFloat(folha['VALOR_LIQUIDO']) : null,
          origem:        tipoF,
          ref_doc:       docToken,
        }, 'SISTEMA')
      } catch(ePagto) { Logger.log('Erro ordem de pagamento (webhook): ' + ePagto.message) }
    } catch(e) { logAcao('WEBHOOK', 'DRIVE_OPCIONAL', e.message) }
    if (tipoDaFolha(folha, docToken) === 'Ferias') confirmarFeriasAssinada(docToken)
    logAcao('WEBHOOK', 'ASSINATURA_FOLHA', 'Doc: ' + docToken)
    return { ok: true, tipo: 'folha' }
  }

  logAcao('WEBHOOK', 'NAO_ENCONTRADO', 'Token: ' + docToken)
  return { ignorado: true, motivo: 'Documento não encontrado: ' + docToken }
}

// ─── Envio para ZapSign ──────────────────────────────────────────
// FIX: normaliza telefone (remove o 55 inicial, pois phone_country já é '55'),
// valida DDD+número e expõe o HTTP code no erro.
// Nome do documento no ZapSign. Ele volta como nome do PDF anexado no e-mail
// de assinatura, e é por ele que o arquivamento no servidor físico identifica
// tipo e competência. Antes ia 'Folha_' cravado em tudo — férias e ponto
// inclusive — e o tipo só existia dentro do PDF, obrigando a classificar por
// OCR. Agora sai no MESMO padrão do arquivo em Y:\RH-2:
//   AAAA.MM.NOME COMPLETO.TIPO      (o mês por extenso é só o nome da PASTA)
// Assim o nome que chega por e-mail já é o nome final do arquivo.
var MESES_ARQ = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO',
                 'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']

var MESES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// Nome do documento no ZapSign: <Tipo>_<Mês>-<Ano>_<NOME COMPLETO>
//
//   Folha_Julho-2026_JOSE NILSON ANTONIO LIMA
//   Ferias_Julho-2026_JOSE NILSON ANTONIO LIMA
//   Ponto_Julho-2026_CARLOS EDUARDO SOUZA
//
// Antes o app mandava 'Folha_...' para TODO documento — férias e ponto
// inclusive — e o tipo só existia dentro do PDF, obrigando o script de RH a
// descobri-lo por OCR. Agora o tipo vem no prefixo.
//
// O formato é de propósito o MESMO que o baixar_rh_email.py já entende sem
// alteração nenhuma: o parse_docname dele testa startswith("FOLHA_"),
// startswith("PONTO") e startswith("FERIAS"), e tira mês/ano do padrão
// <MES>-<ANO>. Ou seja, o servidor ganha o tipo de graça, sem patch.
//
// 'Folha' continua devolvendo a família FOLHA? lá, e o classifica_conteudo
// decide entre recibo, contracheque e comprovante lendo o PDF — que é o
// comportamento de hoje. Férias e ponto passam a ser definitivos pelo nome.
function nomeDocumentoAssinatura(tipo, competencia, nomeCompleto) {
  var t = String(tipo || 'Folha').trim().toUpperCase()
  // EPI mantém prefixo próprio de propósito. O parse_docname do servidor não
  // reconhece 'EPI_...' e manda para revisão — que é o certo: cair em 'Folha'
  // faria um recibo de EPI ser arquivado como recibo de pagamento, calado.
  var prefixo = t === 'FERIAS' || t === 'FÉRIAS' ? 'Ferias'
              : t === 'PONTO'  ? 'Ponto'
              : t === 'EPI'    ? 'EPI'
              : 'Folha'

  var comp = String(competencia || '')
  var ano = '', idxMes = -1
  var m = comp.match(/^([A-Za-zçÇãÃéÉêÊíÍóÓôÔõÕ]+)\s*\/\s*(\d{4})$/)  // "Julho/2026"
  if (m) {
    var nomeMes = m[1].toUpperCase()
      .replace(/[ÁÀÂÃ]/g,'A').replace(/[ÉÈÊ]/g,'E').replace(/Ç/g,'C')
      .replace(/Í/g,'I').replace(/[ÓÔÕ]/g,'O')
    var i = MESES_ARQ.indexOf(nomeMes)
    if (i >= 0) { ano = m[2]; idxMes = i }
  }
  if (!ano) {
    var n = comp.match(/(\d{2})\/(\d{4})/)                            // "07/2026"
    if (n) {
      var mm = parseInt(n[1], 10)
      if (mm >= 1 && mm <= 12) { ano = n[2]; idxMes = mm - 1 }
    }
  }

  var nome = String(nomeCompleto || '').toUpperCase().trim()
  if (idxMes < 0) {
    // Sem competência reconhecida não dá para montar <Mês>-<Ano>. Manda sem,
    // que o servidor manda para revisar — melhor do que inventar uma data.
    return prefixo + '_' + (comp.replace(/[\/\\]/g, '-') || 'SEM-COMPETENCIA') + '_' + nome
  }
  return prefixo + '_' + MESES_NOME[idxMes] + '-' + ano + '_' + nome
}

function enviarParaZapSign(pdfBase64, nomeDoc, nomeSignatario, telefone) {
  var tel = String(telefone || '').replace(/\D/g, '')
  if (tel.length >= 12 && tel.substring(0, 2) === '55') tel = tel.substring(2)
  if (tel.length < 10 || tel.length > 11) {
    throw new Error('Telefone inválido para ' + nomeSignatario + ' (precisa DDD+numero): "' + telefone + '"')
  }

  var payload = {
    name: nomeDoc, base64_pdf: pdfBase64, lang: 'pt-br',
    signers: [{
      name: nomeSignatario,
      phone_country: '55',
      phone_number: tel,
      auth_mode: 'assinaturaTela-tokenWhatsapp', // token de verificação via WhatsApp (não SMS)
      send_automatic_whatsapp: true,
      send_automatic_email: false
    }],
  }
  var res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/docs/', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  })
  var code = res.getResponseCode()
  var data = JSON.parse(res.getContentText())
  if (code !== 200 && code !== 201) {
    throw new Error('ZapSign (HTTP ' + code + '): ' + res.getContentText())
  }
  return {
    token: data.token,
    signUrl: (data.signers && data.signers[0]) ? data.signers[0].sign_url : '',
    signerToken: (data.signers && data.signers[0]) ? data.signers[0].token : ''
  }
}

function baixarPdfAssinadoZapSign(docToken) {
  const res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/docs/' + docToken + '/', { method: 'get', headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN }, muteHttpExceptions: true })
  const data = JSON.parse(res.getContentText())
  const pdfUrl = data.signed_file
  if (!pdfUrl || !pdfUrl.startsWith('http')) throw new Error('PDF assinado não disponível para: ' + docToken)
  const resPdf = UrlFetchApp.fetch(pdfUrl, { muteHttpExceptions: true })
  if (resPdf.getResponseCode() !== 200) throw new Error('Erro ao baixar PDF: HTTP ' + resPdf.getResponseCode())
  return Utilities.base64Encode(resPdf.getContent())
}

function consultarStatusZapSign(docToken) {
  const res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/docs/' + docToken + '/', { method: 'get', headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN }, muteHttpExceptions: true })
  if (res.getResponseCode() !== 200) throw new Error('ZapSign HTTP ' + res.getResponseCode())
  return JSON.parse(res.getContentText()).status || 'pending'
}

function criarPastaFuncionario(id, nomeCompleto) {
  const nomePasta = String(id).padStart(3,'0') + '_' + nomeCompleto.toUpperCase().replace(/\s+/g,'_')
  const raiz = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER)
  const ex = raiz.getFoldersByName(nomePasta)
  if (ex.hasNext()) return ex.next()
  const pasta = raiz.createFolder(nomePasta)
  ;['ASO_EXAMES','EPI_RECIBOS','FOLHA_PAGAMENTO','FERIAS','DOCUMENTOS_ADM'].forEach(s => pasta.createFolder(s))
  return pasta
}

function buscarPastaFuncionario(funcId, nomeCompleto) {
  const nomePasta = String(funcId).padStart(3,'0') + '_' + nomeCompleto.toUpperCase().replace(/\s+/g,'_')
  const raiz = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER)
  const p = raiz.getFoldersByName(nomePasta)
  return p.hasNext() ? p.next() : null
}

function salvarPdfNoDrive(funcId, nomeCompleto, subpasta, nomeArquivo, pdfBase64) {
  const pasta = buscarPastaFuncionario(funcId, nomeCompleto)
  if (!pasta) throw new Error('Pasta do funcionário não encontrada no Drive')
  const subs = pasta.getFoldersByName(subpasta)
  const destino = subs.hasNext() ? subs.next() : pasta.createFolder(subpasta)
  const arq = destino.createFile(Utilities.newBlob(Utilities.base64Decode(pdfBase64), 'application/pdf', nomeArquivo))
  arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
  return arq.getUrl()
}

function gerarReciboEpiPdf(func, itens, motivo, adm) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd 'de' MMMM 'de' yyyy")
  let tabelaItens = ''
  itens.forEach(item => { tabelaItens += '<tr><td>' + item.cod + '</td><td>' + item.descricao + '</td><td>' + (item.ca||'') + '</td><td style="text-align:center">' + item.quantidade + '</td></tr>' })
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}.header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:10px;opacity:.85}h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#1A5C2A;color:white;padding:6px 8px;font-size:10px;text-align:left}td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:10px}.campo{display:flex;gap:8px;margin:4px 0}.label{font-weight:bold;min-width:120px}.termo{background:#f0f9f0;border:1px solid #c8e6c9;border-radius:6px;padding:12px;margin-top:16px;font-size:10px;line-height:1.6}.assinaturas{display:flex;justify-content:center;margin-top:48px}.assinatura{text-align:center}.sig-img{height:72px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px}.linha-ass{border-top:1px solid #333;margin-bottom:6px}.rodape{margin-top:32px;font-size:8px;color:#999;text-align:center}</style></head><body><div class="header"><h1>Fazenda Agua Viva</h1><p>Sistema SST - Recibo de Entrega de EPI</p></div><h2>RECIBO DE ENTREGA DE EPI</h2><h2>Dados do Funcionario</h2><div class="campo"><span class="label">Funcionario:</span>' + func['NOME_COMPLETO'] + '</div><div class="campo"><span class="label">Data da Entrega:</span>' + hoje + '</div><div class="campo"><span class="label">Motivo:</span>' + motivo + '</div><h2>Itens Entregues</h2><table><thead><tr><th>Codigo</th><th>Descricao</th><th>Nr CA</th><th>Qtd.</th></tr></thead><tbody>' + tabelaItens + '</tbody></table><div class="termo"><strong>DECLARACAO DO FUNCIONARIO</strong><br><br>Declaro que recebi os equipamentos listados acima em perfeitas condicoes, que fui orientado quanto ao uso correto e que e de minha responsabilidade a conservacao, higienizacao e comunicacao em caso de danos ou necessidade de substituicao, conforme determina a NR-6.</div><div class="assinaturas"><div class="assinatura"><div class="sig-img"></div><div class="linha-ass"></div><strong>' + func['NOME_COMPLETO'] + '</strong><br>Assinatura do Funcionario</div></div><div class="rodape">Documento gerado em ' + hoje + ' pelo Sistema SST - Fazenda Agua Viva</div></body></html>'
  return Utilities.base64Encode(HtmlService.createHtmlOutput(html).getAs('application/pdf').setName('recibo_epi.pdf').getBytes())
}

function gerarCapaFolhaPdf(func, competencia, adm) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd 'de' MMMM 'de' yyyy")
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}.header h1{margin:0;font-size:18px}h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}.campo{display:flex;gap:8px;margin:6px 0}.label{font-weight:bold;min-width:130px}.termo{background:#f0f9f0;border:1px solid #c8e6c9;border-radius:6px;padding:14px;margin-top:20px;font-size:10px;line-height:1.7}.obs{border:1px solid #ddd;border-radius:4px;height:50px;margin-top:8px}.assinaturas{display:flex;justify-content:space-between;margin-top:60px}.assinatura{text-align:center;flex:1}.linha-ass{border-top:1px solid #333;margin-bottom:6px}.rodape{margin-top:40px;font-size:8px;color:#999;text-align:center}</style></head><body><div class="header"><h1>Fazenda Agua Viva</h1><p>Sistema SST - Recibo de Pagamento de Salario</p></div><h2>COMPROVANTE DE RECEBIMENTO DE SALARIO</h2><div class="campo"><span class="label">Competencia:</span>' + competencia + '</div><div class="campo"><span class="label">Funcionario:</span>' + func['NOME_COMPLETO'] + '</div><div class="campo"><span class="label">CPF:</span>' + func['CPF'] + '</div><div class="campo"><span class="label">Funcao:</span>' + func['FUNCAO'] + '</div><div class="campo"><span class="label">Unidade:</span>' + func['UNIDADE'] + '</div><div class="campo"><span class="label">Empregador:</span>' + func['EMPREGADOR'] + '</div><div class="termo"><strong>DECLARACAO DO FUNCIONARIO</strong><br><br>Declaro que recebi o pagamento de salario referente a competencia ' + competencia + ', conforme demonstrativo disponibilizado pela empresa, e que nao tenho quaisquer reivindicacoes relativas ao periodo em questao.</div><p style="margin-top:16px;font-weight:bold;font-size:10px;">Observacoes:</p><div class="obs"></div><div class="assinaturas"><div class="assinatura"><div class="linha-ass"></div><strong>' + func['NOME_COMPLETO'] + '</strong><br>Assinatura do Funcionario</div><div style="width:60px"></div><div class="assinatura"><div class="linha-ass"></div><strong>' + adm + '</strong><br>Responsavel / ADM</div></div><div class="rodape">Documento gerado em ' + hoje + ' pelo Sistema SST - Fazenda Agua Viva</div></body></html>'
  return Utilities.base64Encode(HtmlService.createHtmlOutput(html).getAs('application/pdf').setName('folha.pdf').getBytes())
}

function logAcao(usuario, acao, detalhe) {
  try {
    adicionarLinha(CONFIG.ABAS.LOG, [Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss'), usuario, acao, detalhe])
  } catch(e) {}
}

function respOk(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data })).setMimeType(ContentService.MimeType.JSON)
}

function respErro(msg, code) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, erro: msg, code: code || 400 })).setMimeType(ContentService.MimeType.JSON)
}

function sincronizarPendentes() {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  let verificados = 0, atualizados = 0, erros = []

  // Um token pode cobrir vários registros (recibo mensal consolidado): checa
  // cada token uma única vez e atualiza TODAS as linhas que o compartilham.
  const epiTokensVistos = {}
  lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS)
    .filter(e => (e['ASSINADO?'] === 'Pendente' || e['ASSINADO?'] === '') && e['ZAPSIGN_DOC'])
    .forEach(entrega => {
      const token = String(entrega['ZAPSIGN_DOC']).trim()
      if (epiTokensVistos[token]) return
      epiTokensVistos[token] = true
      verificados++
      try {
        const status = consultarStatusZapSign(token)
        if (status === 'signed') {
          atualizarTodasCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'ASSINADO?': 'Sim', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
          try {
            const link = salvarPdfNoDrive(entrega['ID FUNC.'], entrega['FUNCIONÁRIO'], 'EPI_RECIBOS', 'Recibo_EPI_' + hoje.replace(/\//g,'-') + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
            atualizarTodasCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': link })
          } catch(de) {}
          atualizados++
        } else if (status === 'refused') {
          atualizarTodasCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'ASSINADO?': 'Recusado', 'DATA ASSINATURA': hoje })
          atualizados++
        }
      } catch(e) { erros.push('EPI ' + token.substring(0,8) + ': ' + e.message) }
    })

  // Lido uma vez só: serve de fallback quando a coluna TIPO está vazia.
  const feriasTokens = tokensDeFerias()
  lerAbaComoObjetos(CONFIG.ABAS.FOLHA)
    .filter(f => (f['STATUS'] === 'Pendente' || f['STATUS'] === '') && f['ZAPSIGN_DOC'])
    .forEach(folha => {
      verificados++
      const token = String(folha['ZAPSIGN_DOC']).trim()
      try {
        const status = consultarStatusZapSign(token)
        if (status === 'signed') {
          atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'STATUS': 'Assinado', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
          const tipoF = tipoDaFolha(folha, token, feriasTokens)
          // Confirma as férias (status + evento no Calendar) ANTES do PDF: se o
          // download/save do PDF falhar, a confirmação de férias não pode ser perdida.
          if (tipoF === 'Ferias') { try { confirmarFeriasAssinada(token) } catch(fe) { erros.push('Ferias ' + token.substring(0,8) + ': ' + fe.message) } }
          try {
            const comp = String(folha['COMPETÊNCIA'] || 'semdata').replace(/\//g,'-')
            const subF = subpastaDoTipo(tipoF)
            const link = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], subF, tipoF + '_' + comp + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
            atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': link })
          } catch(de) {}
          // Mesma ordem de pagamento do webhook: quando a assinatura é
          // detectada por aqui, o webhook não passou, e sem isto o valor
          // nunca chegaria ao extrato. gerarOrdemDeAssinatura não duplica.
          try {
            gerarOrdemDeAssinatura({
              func_id:       folha['ID FUNC.'],
              competencia:   String(folha['COMPETÊNCIA'] || ''),
              valor_liquido: folha['VALOR_LIQUIDO'] ? parseFloat(folha['VALOR_LIQUIDO']) : null,
              origem:        tipoF,
              ref_doc:       token,
            }, 'SYNC')
          } catch(ePag) { erros.push('Ordem ' + token.substring(0,8) + ': ' + ePag.message) }
          atualizados++
        } else if (status === 'refused') {
          atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'STATUS': 'Recusado', 'DATA ASSINATURA': hoje })
          atualizados++
        }
      } catch(e) { erros.push('Folha ' + token.substring(0,8) + ': ' + e.message) }
    })

  // Reconciliação de férias: pega registros que ficaram 'Pendente' na aba FERIAS
  // mesmo já assinados no ZapSign (ex.: falha anterior ao salvar o PDF).
  try { atualizados += reconciliarFerias(erros) } catch(e) { erros.push('ReconcFerias: ' + e.message) }

  logAcao('SYNC', 'SINCRONIZACAO', 'Verificados: ' + verificados + ' | Atualizados: ' + atualizados + ' | Erros: ' + erros.length)
  return { verificados, atualizados, pendentes: verificados - atualizados, erros, horario: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss') }
}

// Auto-cura: confirma na aba FERIAS todo período ainda 'Pendente' cujo documento
// já está assinado (verifica direto no ZapSign, ou pela FOLHA já 'Assinado').
function reconciliarFerias(erros) {
  erros = erros || []
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  if (!sheet) return 0
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return 0
  var hdrs = vals[0]
  var iTok = hdrs.indexOf('REF_TOKEN'), iStatus = hdrs.indexOf('STATUS')
  if (iTok < 0 || iStatus < 0) return 0

  // Índice de tokens de folha já assinados (evita chamada ao ZapSign quando possível)
  var folhaAssinada = {}
  lerAbaComoObjetos(CONFIG.ABAS.FOLHA).forEach(function (f) {
    if (f['STATUS'] === 'Assinado' && f['ZAPSIGN_DOC']) folhaAssinada[String(f['ZAPSIGN_DOC']).trim()] = true
  })

  var corrigidos = 0
  for (var i = 1; i < vals.length; i++) {
    var status = vals[i][iStatus]
    var token = String(vals[i][iTok] || '').trim()
    if (!token || (status !== 'Pendente' && status !== '')) continue
    try {
      var assinado = folhaAssinada[token]
      if (!assinado) { assinado = (consultarStatusZapSign(token) === 'signed') }
      if (assinado) { confirmarFeriasAssinada(token); corrigidos++ }
    } catch (e) { erros.push('Ferias ' + token.substring(0,8) + ': ' + e.message) }
  }
  return corrigidos
}

function syncAutomatico() { sincronizarPendentes() }

function configurarTriggerAutomatico() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncAutomatico') ScriptApp.deleteTrigger(t) })
  ScriptApp.newTrigger('syncAutomatico').timeBased().everyMinutes(30).create()
  return 'Trigger configurado: a cada 30 minutos'
}

function removerTriggerAutomatico() {
  let removidos = 0
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncAutomatico') { ScriptApp.deleteTrigger(t); removidos++ } })
  return 'Triggers removidos: ' + removidos
}

function recuperarPdfsAssinados() {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  let recuperados = 0, erros = []

  lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS).forEach(entrega => {
    const token = String(entrega['ZAPSIGN_DOC'] || '').trim()
    const link  = String(entrega['LINK DOC ASSINADO'] || '').trim()
    if (entrega['ASSINADO?'] !== 'Sim' || !token || link) return
    try {
      const url = salvarPdfNoDrive(entrega['ID FUNC.'], entrega['FUNCIONÁRIO'], 'EPI_RECIBOS', 'Recibo_EPI_' + String(entrega['DATA ASSINATURA']||hoje).replace(/\//g,'-') + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
      atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': url })
      recuperados++
    } catch(e) { erros.push('EPI ' + token.substring(0,8) + ': ' + e.message) }
  })

  const feriasTokensRec = tokensDeFerias()
  lerAbaComoObjetos(CONFIG.ABAS.FOLHA).forEach(folha => {
    const token = String(folha['ZAPSIGN_DOC'] || '').trim()
    const link  = String(folha['LINK DOC ASSINADO'] || '').trim()
    if (folha['STATUS'] !== 'Assinado' || !token || link) return
    try {
      const comp = String(folha['COMPETÊNCIA'] || 'semdata').replace(/\//g,'-')
      const tipoF = tipoDaFolha(folha, token, feriasTokensRec)
      const subF = subpastaDoTipo(tipoF)
      const url = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], subF, tipoF + '_' + comp + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
      atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': url })
      recuperados++
    } catch(e) { erros.push('Folha ' + token.substring(0,8) + ': ' + e.message) }
  })

  const msg = 'Recuperados: ' + recuperados + ' PDFs | Erros: ' + erros.length
  logAcao('SISTEMA', 'RECUPERAR_PDFS', msg)
  return msg
}

function criarTodasPastas() {
  const funcionarios = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
  const sheet = getSheet(CONFIG.ABAS.FUNCIONARIOS)
  const headers = sheet.getDataRange().getValues()[0]
  const idxLink = headers.indexOf('LINK_DRIVE')
  let criadas = 0, erros = 0
  funcionarios.forEach((func, i) => {
    if (!func['ID'] || !func['NOME_COMPLETO']) return
    try {
      const pasta = criarPastaFuncionario(func['ID'], func['NOME_COMPLETO'])
      const link = 'https://drive.google.com/drive/folders/' + pasta.getId()
      if (idxLink !== -1) sheet.getRange(i + 2, idxLink + 1).setValue(link)
      criadas++
    } catch(e) { erros++; Logger.log('ERRO ' + func['ID'] + ': ' + e.message) }
  })
  const msg = 'Concluido: ' + criadas + ' pastas processadas, ' + erros + ' erros.'
  logAcao('SISTEMA', 'CRIAR_PASTAS', msg)
  return msg
}

function processarPaginaFolha(dados, usuario) {
  const funcionarios = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  const comp = dados.competencia || ''
  const compLimpo = comp.replace(/\//g, '-')
  const tipo = dados.tipo || 'Folha'
  const subpasta = subpastaDoTipo(tipo)
  const func = encontrarFuncionarioPorNome(dados.nome_funcionario, funcionarios)
  if (!func) throw new Error('Funcionário não encontrado: ' + dados.nome_funcionario)
  const nomeArq = nomeDocumentoAssinatura(tipo, comp, func['NOME_COMPLETO']) + '_PENDENTE.pdf'
  let linkDrive = ''
  try { linkDrive = salvarPdfNoDrive(func['ID'], func['NOME_COMPLETO'], subpasta, nomeArq, dados.pdf_base64) }
  catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
  let zapToken = '', zapSignUrl = '', zapSignerToken = ''
  if (dados.enviar_zapsign) {
    try {
      const zap = enviarParaZapSign(dados.pdf_base64, nomeDocumentoAssinatura(tipo, comp, func['NOME_COMPLETO']), func['NOME_COMPLETO'], func['TELEFONE'])
      zapToken = zap.token; zapSignUrl = zap.signUrl; zapSignerToken = zap.signerToken
    } catch(e) { logAcao(usuario, 'ERRO_ZAPSIGN', e.message); throw e }
  }
  adicionarLinhaFolha({
    'ID FUNC.':          func['ID'],
    'FUNCIONÁRIO':       func['NOME_COMPLETO'],
    'COMPETÊNCIA':       comp,
    'DATA ENVIO':        hoje,
    'STATUS':            zapToken ? 'Pendente' : 'Salvo',
    'ZAPSIGN_DOC':       zapToken,
    'LINK PDF ORIGINAL': linkDrive,
    'OBSERVAÇÕES':       (zapSignerToken ? 'Signer: ' + zapSignerToken : 'Fracionado') +
                         (dados.inclui_ponto ? ' | Ponto junto' : ''),
    'VALOR_LIQUIDO':     valorNumerico(dados.valor_liquido),
    'TIPO':              tipo,
    'VERBAS':            verbasParaCelula(normalizarVerbas(dados.verbas)),
    'BASES':             basesParaCelula(normalizarBases(dados.bases)),
    'PARAMETROS':        parametrosParaCelula(normalizarParametros(dados.parametros)),
  })
  if (tipo === 'Ferias' && zapToken) registrarFeriasPendente(func['ID'], func['NOME_COMPLETO'], dados.ferias_inicio, dados.ferias_fim, comp, zapToken)
  logAcao(usuario, 'FOLHA_INDIVIDUAL', 'Func ' + func['ID'] + ' | ' + comp)
  return { func_id: func['ID'], nome: func['NOME_COMPLETO'], link_drive: linkDrive, zapsign: zapToken, sign_url: zapSignUrl }
}

function encontrarFuncionarioPorNome(nomeTexto, funcionarios) {
  if (!nomeTexto) return null
  var textoUpper = String(nomeTexto).toUpperCase()
  var melhor = null, maiorMatches = 0
  funcionarios.forEach(function(func) {
    var partes = func['NOME_COMPLETO'].toUpperCase().split(' ').filter(function(p) { return p.length > 3 })
    var matches = partes.filter(function(p) { return textoUpper.indexOf(p) !== -1 }).length
    if (matches >= 2 && matches > maiorMatches) { maiorMatches = matches; melhor = func }
  })
  if (!melhor) {
    funcionarios.forEach(function(func) {
      if (textoUpper.indexOf(func['NOME_COMPLETO'].toUpperCase()) !== -1) melhor = func
    })
  }
  return melhor
}

function identificarFuncionarioPdf(dados) {
  const bytes = Utilities.base64Decode(dados.pdf_base64)
  const blob = Utilities.newBlob(bytes, 'application/pdf', '_ocr_tmp.pdf')
  const raiz = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER)
  const tmpFile = raiz.createFile(blob)
  var texto = ''
  try {
    const converted = Drive.Files.copy({ title: '_ocr_id' }, tmpFile.getId(), { convert: true, ocr: true, ocrLanguage: 'pt' })
    texto = DocumentApp.openById(converted.id).getBody().getText()
    DriveApp.getFileById(converted.id).setTrashed(true)
  } finally { tmpFile.setTrashed(true) }
  const funcionarios = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
  var linhas = texto.split('\n').map(function(l) { return l.trim() })
  for (var i = 0; i < linhas.length; i++) {
    var numLinha = parseInt(linhas[i])
    if (!isNaN(numLinha) && numLinha > 0 && numLinha < 999) {
      var f = funcionarios.find(function(fn) { return parseInt(fn['ID']) === numLinha })
      if (f) return { func_id: f['ID'], nome_encontrado: f['NOME_COMPLETO'], metodo: 'id' }
    }
  }
  var textoUpper = texto.toUpperCase()
  var melhor = null, maiorM = 0
  funcionarios.forEach(function(func) {
    var partes = func['NOME_COMPLETO'].toUpperCase().split(' ').filter(function(p) { return p.length > 3 })
    var m = partes.filter(function(p) { return textoUpper.indexOf(p) !== -1 }).length
    if (m >= 2 && m > maiorM) { maiorM = m; melhor = func }
  })
  if (melhor) return { func_id: melhor['ID'], nome_encontrado: melhor['NOME_COMPLETO'], metodo: 'nome' }
  return { func_id: null, nome_encontrado: null, metodo: 'nenhum' }
}

// ═══════════════════════════════════════════════════════════════════
// IDENTIFICAÇÃO POR IA — Claude API
// Extrai funcionário, tipo de documento e competência do PDF
// ═══════════════════════════════════════════════════════════════════

var MODELO_IA = 'claude-sonnet-4-6'

// Um holerite de 30 rubricas com verbas, bases e parâmetros passa
// folgado de 3.000 tokens. Cortada no meio, a resposta não é JSON e a
// leitura inteira se perde — sem dizer por quê.
var MAX_TOKENS_IA = 8000

// Uma chamada, um lugar para errar. Devolve o motivo em vez de estourar:
// quem chama decide se transforma em erro ou em diagnóstico.
function chamarIA(pdfBase64, prompt) {
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY') || ''
  if (!chave) {
    return { ok: false, etapa: 'chave', erro:
      'A chave da Anthropic não está configurada. No editor do Apps Script: ' +
      'Configurações do projeto → Propriedades do script → adicionar ' +
      'ANTHROPIC_KEY com a chave (sk-ant-...).' }
  }

  var conteudo = []
  if (pdfBase64) {
    conteudo.push({ type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } })
  }
  conteudo.push({ type: 'text', text: prompt })

  var res
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: MODELO_IA,
        max_tokens: MAX_TOKENS_IA,
        messages: [{ role: 'user', content: conteudo }],
      }),
      muteHttpExceptions: true,
    })
  } catch (e) {
    return { ok: false, etapa: 'rede', erro: 'Não consegui falar com a Anthropic: ' + e.message }
  }

  var http = res.getResponseCode()
  var corpo = res.getContentText()
  var data
  try { data = JSON.parse(corpo) } catch (e) { data = null }

  if (http !== 200) {
    var msg = data && data.error ? data.error.message : String(corpo).slice(0, 200)
    Logger.log('Claude API ' + http + ': ' + corpo)
    // Cada código erra por um motivo diferente, e a correção é diferente.
    // "Erro na IA" mandava o usuário adivinhar qual dos quatro era.
    var explica = {
      401: 'A chave da Anthropic foi recusada. Confira ANTHROPIC_KEY nas Propriedades do script.',
      403: 'A chave não tem permissão para este modelo.',
      404: 'O modelo ' + MODELO_IA + ' não foi encontrado nesta conta.',
      429: 'Limite de uso da Anthropic atingido. Espere um pouco e tente de novo.',
      529: 'A Anthropic está sobrecarregada agora. Tente de novo em alguns minutos.',
    }[http]
    if (!explica && http >= 500) explica = 'A Anthropic devolveu erro ' + http + '. Tente de novo.'

    // Saldo zerado chega como 400 — o mesmo código de um pedido malformado.
    // São problemas opostos: um se resolve comprando crédito, o outro
    // mexendo no código. Sem separar, o usuário procura defeito onde não há.
    if (http === 400 && /credit balance|too low|billing/i.test(msg)) {
      return { ok: false, etapa: 'saldo', http: http, erro:
        'A conta da Anthropic está sem crédito. O app está funcionando — é só ' +
        'recarregar em console.anthropic.com → Plans & Billing e tentar de novo.' }
    }

    return { ok: false, etapa: 'http', http: http, erro: (explica || 'Erro ' + http) + ' (' + msg + ')' }
  }

  if (!data || !data.content || !data.content.length) {
    return { ok: false, etapa: 'vazio', http: http, erro: 'A IA respondeu sem conteúdo.' }
  }

  var texto = ''
  data.content.forEach(function (b) { if (b.type === 'text' && b.text) texto += b.text })
  texto = texto.replace(/```json/g, '').replace(/```/g, '').trim()

  return {
    ok: true,
    texto: texto,
    // Resposta truncada: o JSON vem quebrado e o parse falha depois. Saber
    // que foi corte muda o conserto de "a IA errou" para "o limite é baixo".
    cortado: data.stop_reason === 'max_tokens',
    stop_reason: data.stop_reason || '',
    usage: data.usage || null,
    http: http,
  }
}

// Listar modelos não gasta crédito nenhum — não é uma chamada de IA, é uma
// consulta de catálogo. Por isso serve de prova: se ESTA passa e a leitura
// falha por saldo, a chave está boa e o problema é só dinheiro na conta.
// Sem essa separação, "trocar a chave" parece uma saída plausível — e não é.
function pingModelos() {
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY') || ''
  if (!chave) return { http: 0, ok: false, erro: 'sem chave' }
  var res
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/models', {
      method: 'get',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      muteHttpExceptions: true,
    })
  } catch (e) {
    return { http: 0, ok: false, erro: 'não alcancei a Anthropic: ' + e.message }
  }
  var http = res.getResponseCode()
  return { http: http, ok: http === 200,
    erro: http === 200 ? '' : String(res.getContentText()).slice(0, 160) }
}

// Quando a leitura falha, a pergunta seguinte é sempre a mesma: "é a chave?".
// Responde com um fato, não com um palpite.
function anexarProvaDaChave(saida) {
  var m = pingModelos()
  saida.modelos_http  = m.http
  saida.chave_valida  = m.ok
  saida.veredito_chave = m.ok
    ? 'A chave está boa: a Anthropic aceitou ela para listar os modelos, ' +
      'e listar modelos não gasta crédito. Trocar de chave não resolve nada aqui.'
    : (m.http === 401
        ? 'A chave foi recusada de verdade (401). Essa sim precisa ser trocada.'
        : 'Não deu para confirmar a chave (' + (m.http || 'sem resposta') + ').')
  return saida
}

// Testa a leitura sem gravar nada: diz em que etapa parou e o que veio.
// Serve para o usuário descobrir sozinho por que um PDF não é reconhecido.
function diagnosticarIA(dados) {
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY') || ''
  var saida = {
    versao_backend:    VERSAO_BACKEND,
    modelo:            MODELO_IA,
    max_tokens:        MAX_TOKENS_IA,
    chave_configurada: !!chave,
    chave_tamanho:     chave.length,
    // O COMEÇO não identifica nada: toda chave da Anthropic começa com
    // 'sk-ant-api03-'. Mostrar o começo dizia "é uma chave", não "é ESTA
    // chave" — e quem trocou de chave via o mesmo texto de antes.
    // O fim distingue, e é como o próprio console da Anthropic lista as
    // chaves, então dá para casar as duas telas a olho.
    chave_final:       chave ? '…' + chave.slice(-4) : '',
  }

  var pdf = dados && dados.pdf_base64 ? dados.pdf_base64 : ''
  if (!chave) {
    saida.etapa = 'chave'
    saida.erro  = 'ANTHROPIC_KEY não está nas Propriedades do script.'
    return saida
  }

  if (!pdf) {
    // Sem PDF: confere só se a chave e o modelo respondem.
    var ping = chamarIA('', 'Responda apenas: ok')
    saida.etapa = ping.ok ? 'ok' : ping.etapa
    saida.http  = ping.http || 0
    saida.erro  = ping.ok ? '' : ping.erro
    saida.resposta = ping.ok ? String(ping.texto).slice(0, 60) : ''
    if (!ping.ok) anexarProvaDaChave(saida)
    return saida
  }

  var leitura = chamarIA(pdf, PROMPT_HOLERITE)
  saida.http        = leitura.http || 0
  saida.stop_reason = leitura.stop_reason || ''
  saida.cortado     = !!leitura.cortado
  saida.usage       = leitura.usage
  if (!leitura.ok) {
    saida.etapa = leitura.etapa
    saida.erro  = leitura.erro
    anexarProvaDaChave(saida)
    return saida
  }

  saida.tamanho_resposta = leitura.texto.length
  try {
    var obj = JSON.parse(leitura.texto)
    saida.etapa = 'ok'
    saida.lido  = {
      nome_funcionario: obj.nome_funcionario || '',
      competencia:      obj.competencia || '',
      tipo_documento:   obj.tipo_documento || '',
      empregador:       obj.empregador || '',
      valor_liquido:    obj.valor_liquido,
      qtd_verbas:       Array.isArray(obj.verbas) ? obj.verbas.length : 0,
      tem_bases:        !!(obj.bases && Object.keys(obj.bases).length),
      tem_parametros:   !!(obj.parametros && Object.keys(obj.parametros).length),
    }
    // O casamento com o cadastro é a segunda metade do problema: a IA pode
    // ler o nome certo e mesmo assim não achar a pessoa na planilha.
    var funcs = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
    var achou = obj.nome_funcionario
      ? encontrarFuncionarioPorNome(obj.nome_funcionario, funcs) : null
    saida.casou_no_cadastro = !!achou
    saida.func_encontrado   = achou ? achou['NOME_COMPLETO'] : ''
    if (!achou && obj.nome_funcionario) {
      saida.erro = 'A IA leu "' + obj.nome_funcionario + '", mas não achei esse nome ' +
        'entre os ' + funcs.length + ' funcionários cadastrados.'
    }
  } catch (e) {
    saida.etapa = leitura.cortado ? 'cortado' : 'json'
    saida.erro  = leitura.cortado
      ? 'A resposta foi cortada no limite de ' + MAX_TOKENS_IA + ' tokens.'
      : 'A IA respondeu, mas não em JSON.'
    saida.inicio_resposta = leitura.texto.slice(0, 300)
  }
  return saida
}

// O pedido feito à IA. Constante de módulo porque o diagnóstico precisa
// mandar exatamente o mesmo texto — um diagnóstico que testa outro prompt
// não diz nada sobre a leitura de verdade.
var PROMPT_HOLERITE = 'Analise este documento brasileiro (holerite/folha/ferias) e extraia em JSON puro (sem markdown): '
  + 'nome_funcionario (nome completo do trabalhador, nao do empregador), '
  + 'codigo_funcionario (numero matricula), '
  + 'tipo_documento (Folha para holerite ou contracheque, Ponto para folha de ponto, Ferias para aviso ou recibo de ferias, EPI para recibo EPI), '
  + 'competencia (mes e ano referencia ex: Abril/2026), '
  + 'empregador (razao social ou nome do empregador), '
  + 'valor_liquido (valor liquido a receber pelo funcionario — procure por: Valor Liquido, Liquido, Valor a Receber, Net Pay — apenas o numero decimal ex: 3565.07 sem R$ ou ponto de milhar), '
  + 'total_proventos e total_descontos (os totais impressos no rodape, como numero decimal; null se nao houver), '
  // O rodapé do holerite costuma trazer as BASES e o FGTS do mês. É custo do
  // empregador impresso no próprio documento — sem isso teria de vir de uma
  // tabela de alíquotas configurada à mão, e cada empregador tem a sua.
  + 'bases (o quadro de totais do RODAPE do holerite, com: '
  +   'base_inss (base de calculo do INSS / salario de contribuicao), '
  +   'base_fgts (base de calculo do FGTS), '
  +   'fgts_mes (valor do FGTS depositado no mes — procure por: FGTS do Mes, Deposito FGTS, FGTS Recolhido), '
  +   'base_irrf (base de calculo do IRRF), '
  +   'salario_base (o salario contratual impresso no cabecalho, nao o total de proventos), '
  +   'dias_trabalhados (numero de dias do mes considerados), '
  +   'horas_trabalhadas (carga horaria do mes, se impressa), '
  +   'faixa_irrf (a aliquota da faixa de IRRF impressa, ex: 27.50). '
  +   'TODOS como numero decimal, e null quando o campo nao existir no documento — nao calcule nem estime nenhum deles), '
  // O cabeçalho identifica de quem é a folha e QUE folha é. Sem tipo_folha,
  // um holerite de 13º entra na média mensal como se fosse mês comum.
  + 'parametros (o CABECALHO do documento, como TEXTO, null se ausente: '
  +   'cei_cnpj (CEI, CNPJ ou matricula do EMPREGADOR impressa no topo), '
  +   'centro_custo (o campo CC / Centro de Custo / Setor), '
  +   'cbo (o codigo CBO da funcao), '
  +   'departamento, filial, '
  +   'matricula (o codigo/numero DO FUNCIONARIO nesta folha), '
  +   'admissao (data de admissao no formato DD/MM/AAAA), '
  +   'categoria (Mensalista, Horista, Diarista, Safrista — como impresso), '
  +   'tipo_folha (o tipo do calculo: "Mensal", "13o Salario", "Ferias", "Rescisao", '
  +   '"Adiantamento" ou "Complementar" — deduza do titulo do documento, ex: "Folha Mensal" -> "Mensal")), '
  + 'verbas (LISTA de TODAS as linhas de provento e desconto da tabela do holerite, na ordem em que aparecem, cada uma com: '
  +   'codigo (o codigo/rubrica da linha, string, null se nao houver), '
  +   'descricao (o texto exatamente como impresso, ex: "HORAS EXTRAS 50%", "ADICIONAL PERICULOSIDADE"), '
  +   'referencia (a coluna de referencia/quantidade como texto, ex: "12,50", "30,00", "40%"; null se vazia), '
  +   'valor (numero decimal positivo), '
  +   'tipo ("provento" para o que soma ao salario, "desconto" para o que subtrai — INSS, IRRF, vale, adiantamento e faltas sao desconto)). '
  + 'Se for documento de ponto ou EPI, verbas deve ser lista vazia. '
  + 'NAO invente linhas: liste so o que estiver impresso. '
  // A folha da Domínio imprime o MESMO recibo duas vezes na página (via do
  // funcionário e via da empresa). Sem este aviso a IA lista cada verba duas
  // vezes e todo provento dobra — silenciosamente, porque o total impresso
  // continua certo e ninguém confere as linhas uma a uma.
  + 'ATENCAO: muitas folhas imprimem o MESMO recibo DUAS VEZES na mesma pagina '
  + '(uma via do funcionario e uma via da empresa, identicas). Se as duas '
  + 'metades da pagina tiverem o mesmo funcionario e os mesmos valores, extraia '
  + 'UMA vez so: nao repita as verbas nem some os dois blocos. '
  + 'Se as duas metades forem de funcionarios DIFERENTES, extraia a primeira. '
  + 'ferias_inicio e ferias_fim (SE for documento de ferias, as datas de inicio e fim do periodo de gozo no formato YYYY-MM-DD; caso contrario null). '
  + 'Retorne APENAS o JSON sem nenhum texto antes ou depois. '
  + 'Exemplo: {"nome_funcionario":"Joao Silva","codigo_funcionario":"27","tipo_documento":"Folha","competencia":"Julho/2026",'
  + '"empregador":"Fazenda","valor_liquido":3565.07,"total_proventos":4200.00,"total_descontos":634.93,'
  + '"bases":{"base_inss":4200.00,"base_fgts":4200.00,"fgts_mes":336.00,"base_irrf":3822.00,'
  + '"salario_base":2500.00,"dias_trabalhados":30,"horas_trabalhadas":220,"faixa_irrf":27.50},'
  + '"parametros":{"cei_cnpj":"800007697386","centro_custo":"GERAL","cbo":"641010",'
  + '"departamento":"1","filial":"1","matricula":"8","admissao":"22/03/2022",'
  + '"categoria":"Mensalista","tipo_folha":"Mensal"},'
  + '"verbas":[{"codigo":"001","descricao":"SALARIO BASE","referencia":"30,00","valor":2500.00,"tipo":"provento"},'
  + '{"codigo":"102","descricao":"HORAS EXTRAS 50%","referencia":"12,50","valor":425.30,"tipo":"provento"},'
  + '{"codigo":"110","descricao":"ADICIONAL PERICULOSIDADE","referencia":"30%","valor":750.00,"tipo":"provento"},'
  + '{"codigo":"901","descricao":"INSS","referencia":"9,00","valor":378.00,"tipo":"desconto"}],'
  + '"ferias_inicio":null,"ferias_fim":null}'

function identificarDocumentoComIA(dados) {
  var pdfBase64 = dados.pdf_base64
  if (!pdfBase64) throw new Error('PDF não fornecido')

  // As VERBAS são o que permite analisar o histórico depois: sem elas só
  // sobra o líquido, e não dá para saber se subiu por hora extra, por
  // periculosidade ou por reajuste.
  var prompt = PROMPT_HOLERITE

  var leitura = chamarIA(pdfBase64, prompt)
  if (!leitura.ok) throw new Error(leitura.erro)

  var resultado
  try {
    resultado = JSON.parse(leitura.texto)
  } catch (e) {
    Logger.log('Erro parse IA: ' + e.message + ' | texto: ' + leitura.texto)
    // O motivo mais comum de JSON quebrado é a resposta ter sido cortada no
    // meio. Dizer isso é diferente de "não retornou JSON válido": um se
    // resolve aumentando o limite, o outro não.
    throw new Error(leitura.cortado
      ? 'A leitura foi cortada antes de terminar (holerite com muitas linhas). ' +
        'O limite de resposta precisa ser aumentado no Code.gs.'
      : 'A IA respondeu, mas não em JSON. Começo da resposta: ' +
        String(leitura.texto).slice(0, 120))
  }

  var funcionarios = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
  var func = null

  // A matrícula impressa é o número DO SISTEMA DE FOLHA do contador, não o ID
  // deste app. Casar um pelo outro atribui o holerite à pessoa errada em
  // silêncio — e daí sai ordem de pagamento e WhatsApp para quem não é.
  // O nome é a chave; a matrícula só confirma o que o nome já disse.
  var codDoc = parseInt(resultado.codigo_funcionario)

  // O empregador (produtor) que consta no documento é a 2ª chave: cada
  // funcionário pertence a um produtor, então ele desempata homônimos e
  // denuncia um casamento errado que o nome sozinho deixaria passar.
  var doDocumento = funcionarios
  if (resultado.empregador) {
    var comMesmoEmpregador = funcionarios.filter(function(f) {
      return mesmoEmpregador(f['EMPREGADOR'], resultado.empregador)
    })
    if (comMesmoEmpregador.length) doDocumento = comMesmoEmpregador
  }

  if (resultado.nome_funcionario) {
    // 1) Casamento preciso por 2+ partes do nome — evita pegar o empregador
    //    (comum em avisos/recibos de férias, onde a razão social aparece em destaque).
    //    Busca primeiro entre os do mesmo produtor.
    func = encontrarFuncionarioPorNome(resultado.nome_funcionario, doDocumento)
      || encontrarFuncionarioPorNome(resultado.nome_funcionario, funcionarios)

    // 2) Fallback pelo primeiro nome, só quando houver UM único funcionário com
    //    esse primeiro nome (evita atribuir a pessoa errada em nomes repetidos).
    //    Restringir ao produtor do documento resolve casos que antes eram ambíguos.
    if (!func) {
      var primeiro = String(resultado.nome_funcionario).toUpperCase()
        .split(' ').filter(function(p) { return p.length > 2 })[0] || ''
      if (primeiro) {
        var candidatos = doDocumento.filter(function(f) {
          return String(f['NOME_COMPLETO'] || '').toUpperCase().split(' ').indexOf(primeiro) !== -1
        })
        if (candidatos.length === 1) func = candidatos[0]
      }
    }
  }

  // A matrícula concordar com o ID é coincidência boa, não prova; discordar
  // não derruba nada, porque a numeração do contador não tem por que bater
  // com a nossa.
  var matriculaConfere = null
  if (func && codDoc) matriculaConfere = parseInt(func['ID']) === codDoc

  // Confere: o produtor do documento bate com o cadastrado para esse funcionário?
  // Divergência não descarta o casamento, mas derruba a confiança para o app
  // pedir confirmação em vez de aceitar calado.
  var confereEmpregador = null
  if (func && resultado.empregador && func['EMPREGADOR']) {
    confereEmpregador = mesmoEmpregador(func['EMPREGADOR'], resultado.empregador)
  }

  return {
    func_id:        func ? func['ID']            : null,
    func_nome:      func ? func['NOME_COMPLETO'] : resultado.nome_funcionario || '',
    func_telefone:  func ? func['TELEFONE']      : '',
    func_empregador: func ? (func['EMPREGADOR'] || '') : '',
    tipo_documento: resultado.tipo_documento     || 'Folha',
    competencia:    resultado.competencia        || '',
    empregador:     resultado.empregador         || '',
    empregador_confere: confereEmpregador,
    matricula_documento: resultado.codigo_funcionario || '',
    matricula_confere:   matriculaConfere,
    // A IA às vezes devolve "R$ 3.565,07" apesar do pedido de decimal puro.
    // Normaliza aqui: o app e a planilha só veem número.
    valor_liquido:  valorNumerico(resultado.valor_liquido) || null,
    total_proventos: valorNumerico(resultado.total_proventos) || null,
    total_descontos: valorNumerico(resultado.total_descontos) || null,
    verbas:         normalizarVerbas(resultado.verbas),
    bases:          normalizarBases(resultado.bases),
    parametros:     normalizarParametros(resultado.parametros),
    ferias_inicio:  resultado.ferias_inicio      || null,
    ferias_fim:     resultado.ferias_fim         || null,
    ia_confianca:   !func ? 'baixo' : (confereEmpregador === false ? 'medio' : 'alto'),
  }
}

// Compara empregador do cadastro com o extraído do PDF. A razão social vem
// escrita de formas diferentes ("JOAQUIM GATTO COSSUL" vs "Joaquim G. Cossul
// - Fazenda X"), então compara pelos sobrenomes significativos em comum.
function mesmoEmpregador(cadastro, documento) {
  var norm = function(s) {
    return String(s || '').toUpperCase()
      .replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
      .replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/[Ç]/g,'C')
      .replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
  }
  var a = norm(cadastro), b = norm(documento)
  if (!a || !b) return null
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true

  var partesA = a.split(' ').filter(function(p) { return p.length > 3 })
  var partesB = b.split(' ').filter(function(p) { return p.length > 3 })
  if (!partesA.length || !partesB.length) return null
  var comuns = partesA.filter(function(p) { return partesB.indexOf(p) !== -1 })
  return comuns.length >= 2
}

function diagnosticarDocumentoZapSign() {
  const TOKEN = 'COLE_UM_TOKEN_DE_DOC_PARA_TESTE'
  const res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/docs/' + TOKEN + '/', { method: 'get', headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN }, muteHttpExceptions: true })
  const data = JSON.parse(res.getContentText())
  Logger.log('status: ' + data.status)
  Logger.log('signed_file: ' + (data.signed_file ? data.signed_file.substring(0,80) + '...' : 'VAZIO'))
  Logger.log('Campos: ' + Object.keys(data).join(', '))
  return { status: data.status, tem_pdf: !!data.signed_file }
}

// ─── Reenviar notificação de assinatura (WhatsApp/e-mail) ─────────
// FIX: endpoint antigo '/signers/{token}/request-signature-reminder/' não
// existe (dava 404). O correto é reenviar pelo TOKEN DO DOCUMENTO:
// POST /docs/{doc_token}/resend-notifications-bulk/
function reenviarZapSignGAS(dados) {
  var docToken = dados.doc_token || dados.signer_token
  if (!docToken) throw new Error('doc_token não informado')
  var res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/docs/' + docToken + '/resend-notifications-bulk/', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN },
    payload: '{}',
    muteHttpExceptions: true,
  })
  var code = res.getResponseCode()
  if (code !== 200 && code !== 201) {
    throw new Error('ZapSign (HTTP ' + code + '): ' + res.getContentText())
  }
  return { ok: true, mensagem: 'Lembrete reenviado com sucesso' }
}

// ═══════════════════════════════════════════════════════════════════
// ASSINATURA PRÓPRIA — sem ZapSign
// ═══════════════════════════════════════════════════════════════════

var GITHUB_PAGES_URL = 'https://favbalanca-ai.github.io/RH--AV-ESP'

function gerarLinkAssinatura(dados, usuario) {
  const token    = Utilities.getUuid()
  const hoje     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')
  const sheet    = getSheetAssinaturas()
  const func     = listarFuncionarios().find(f => String(f['ID']) === String(dados.func_id))
  if (!func) throw new Error('Funcionário não encontrado')

  sheet.appendRow([
    token,                                    // A: token único
    dados.tipo,                               // B: EPI | Folha | Contracheque
    dados.func_id,                            // C: ID func
    func['NOME_COMPLETO'],                    // D: nome
    dados.referencia || '',                   // E: ex: "Maio/2026" ou "Capacete"
    hoje,                                     // F: data criação
    '',                                       // G: data assinatura
    'Pendente',                               // H: status
    salvarPdfTemporario(dados.pdf_base64, token), // I: fileId do PDF temporário no Drive
    '',                                       // J: link Drive doc assinado
    usuario,                                  // K: quem gerou
    JSON.stringify(dados.itens || []),        // L: itens EPI
    dados.motivo || '',                       // M: motivo
    dados.func_cpf || func['CPF'] || '',     // N: CPF
    dados.func_funcao || func['FUNCAO'] || '', // O: função
    dados.func_unidade || func['UNIDADE'] || '', // P: unidade
    dados.valor_liquido || '',                 // Q: valor líquido (da IA)
  ])

  const link = GITHUB_PAGES_URL + '/assinar.html?t=' + token

  var telRaw = String(func['TELEFONE'] || '').replace(/\D/g,'')
  if (telRaw.length >= 12 && telRaw.substring(0,2) === '55') telRaw = telRaw.substring(2)
  const tel = telRaw
  const waLink = 'https://wa.me/55' + tel + '?text=' + encodeURIComponent(
    'Olá ' + func['NOME_CURTO'] + ', você tem um documento aguardando sua assinatura.\n\n' +
    'Tipo: ' + dados.tipo + '\n' +
    'Ref: ' + (dados.referencia || '') + '\n\n' +
    'Acesse o link para visualizar e assinar:\n' + link
  )

  logAcao(usuario, 'GERAR_LINK_ASSINATURA', 'Token: ' + token + ' | Func: ' + func['NOME_COMPLETO'] + ' | Tipo: ' + dados.tipo)

  return { token, link, wa_link: waLink, mensagem: 'Link gerado para ' + func['NOME_COMPLETO'] }
}

function buscarDocAssinatura(token) {
  if (!token) throw new Error('Token inválido')
  const sheet  = getSheetAssinaturas()
  const dados  = sheet.getDataRange().getValues()
  const headers = dados[0]

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === String(token)) {
      const row = dados[i]
      return {
        token:            row[0],
        tipo:             row[1],
        func_id:          row[2],
        nome_funcionario: row[3],
        referencia:       row[4],
        data_criacao:     row[5],
        data_assinatura:  row[6],
        assinado:         row[7] === 'Assinado',
        pdf_base64:       row[8] ? carregarPdfTemporario(row[8]) : '',
        link_assinado:    row[9],
        itens:            row[11] ? JSON.parse(row[11]) : [],
        motivo:           row[12] || '',
        func_cpf:         row[13] || '',
        func_funcao:      row[14] || '',
        func_unidade:     row[15] || '',
        valor_liquido:    row[16] || null,
      }
    }
  }
  throw new Error('Documento não encontrado')
}

function confirmarAssinatura(token, assinaturaBase64, pdfAssinadoExterno) {
  if (!token || !assinaturaBase64) throw new Error('Dados inválidos')

  const sheet   = getSheetAssinaturas()
  const dados   = sheet.getDataRange().getValues()
  const headers = dados[0]
  const hoje    = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss')

  let rowIdx = -1, rowData = null
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === String(token)) { rowIdx = i; rowData = dados[i]; break }
  }
  if (rowIdx === -1) throw new Error('Token não encontrado')
  if (rowData[7] === 'Assinado') return { ok: true, mensagem: 'Já assinado' }

  const pdfFileId  = String(rowData[8] || '')
  const pdfBase64  = pdfFileId ? carregarPdfTemporario(pdfFileId) : ''
  const tipo       = rowData[1]
  const funcId     = rowData[2]
  const funcNome   = rowData[3]
  const referencia = rowData[4]

  var motivo      = String(rowData[12] || '').trim()
  var funcCpf     = String(rowData[13] || '').trim()
  var funcFuncao  = String(rowData[14] || '').trim()
  var funcUnidade = String(rowData[15] || '').trim()

  var itens = []
  var itensRaw = String(rowData[11] || '').trim()
  if (itensRaw && itensRaw.charAt(0) === '[') {
    try { itens = JSON.parse(itensRaw) }
    catch(e) { Logger.log('Erro parse itens: ' + e.message) }
  }

  // Fallback: busca itens na aba EPI_ENTREGAS pelo funcionário
  if (itens.length === 0 && tipo === 'EPI') {
    var entregas = lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS)
    var entregasFunc = entregas.filter(function(e) {
      return String(e['ID FUNC.']) === String(funcId) && e['ASSINADO?'] !== 'Sim'
    })
    entregasFunc.forEach(function(e) {
      if (e['CÓD. EPI'] || e['DESCRIÇÃO DO EPI']) {
        itens.push({
          cod:        e['CÓD. EPI']        || '',
          descricao:  e['DESCRIÇÃO DO EPI'] || '',
          ca:         e['Nº CA']            || '',
          quantidade: e['QUANTIDADE']       || 1,
        })
        if (!motivo && e['MOTIVO ENTREGA']) motivo = e['MOTIVO ENTREGA']
      }
    })
    Logger.log('Fallback EPI_ENTREGAS: ' + itens.length + ' itens')
  }

  var funcCad = listarFuncionarios().find(function(f) { return String(f['ID']) === String(funcId) })
  if (funcCad) {
    funcFuncao  = funcFuncao  || funcCad['FUNCAO']  || ''
    funcUnidade = funcUnidade || funcCad['UNIDADE'] || ''
    funcCpf     = funcCpf     || funcCad['CPF']     || ''
    if (!motivo) motivo = 'Entrega de EPI'
  }

  var funcObj = { NOME_COMPLETO: funcNome, CPF: funcCpf, FUNCAO: funcFuncao, UNIDADE: funcUnidade }
  var pdfAssinado
  if (pdfAssinadoExterno) {
    pdfAssinado = pdfAssinadoExterno
  } else if (tipo === 'EPI') {
    pdfAssinado = gerarReciboEpiPdfAssinado(funcObj, itens, motivo, assinaturaBase64)
  } else if (tipo === 'Folha' || tipo === 'Ponto' || tipo === 'Ferias') {
    pdfAssinado = gerarFolhaPdfAssinado(pdfBase64, assinaturaBase64, funcNome, tipo, referencia)
  } else {
    pdfAssinado = adicionarAssinaturaAoPdf(pdfBase64, assinaturaBase64, funcNome)
  }

  let linkDrive = ''
  try {
    const nomeArq = tipo + '_' + String(referencia || '').replace(/\//g,'-') + '_ASSINADO.pdf'
    const subpasta = subpastaDoTipo(tipo)
    linkDrive = salvarPdfNoDrive(funcId, funcNome, subpasta, nomeArq, pdfAssinado)
  } catch(e) {
    logAcao('SISTEMA', 'ERRO_DRIVE_ASSINATURA', e.message)
  }

  sheet.getRange(rowIdx + 1, 7).setValue(hoje)       // data assinatura
  sheet.getRange(rowIdx + 1, 8).setValue('Assinado') // status
  sheet.getRange(rowIdx + 1, 10).setValue(linkDrive) // link drive

  try {
    if (tipo === 'EPI') {
      var sheetEpi  = getSheet(CONFIG.ABAS.EPI_ENTREGAS)
      var valsEpi   = sheetEpi.getDataRange().getValues()
      var hdrsEpi   = valsEpi[0]
      var idFuncIdx = hdrsEpi.indexOf('ID FUNC.')
      var statusIdx = hdrsEpi.indexOf('ASSINADO?')
      var dataSigIdx= hdrsEpi.indexOf('DATA ASSINATURA')
      var linkIdx   = hdrsEpi.indexOf('LINK DOC ASSINADO')
      for (var r = 1; r < valsEpi.length; r++) {
        var rowFuncId = String(valsEpi[r][idFuncIdx] || '').trim()
        var rowStatus = String(valsEpi[r][statusIdx]  || '').trim()
        if (rowFuncId === String(funcId) && (rowStatus === 'Aguardando Assinatura' || rowStatus === 'Pendente')) {
          if (statusIdx  >= 0) sheetEpi.getRange(r+1, statusIdx  +1).setValue('Sim')
          if (dataSigIdx >= 0) sheetEpi.getRange(r+1, dataSigIdx +1).setValue(hoje.split(' ')[0])
          if (linkIdx    >= 0) sheetEpi.getRange(r+1, linkIdx    +1).setValue(linkDrive)
        }
      }
    } else {
      var sheetFolha  = getSheet(CONFIG.ABAS.FOLHA)
      var valsFolha   = sheetFolha.getDataRange().getValues()
      var hdrsFolha   = valsFolha[0]
      var fIdIdx      = hdrsFolha.indexOf('ID FUNC.')
      var fStatusIdx  = hdrsFolha.indexOf('STATUS')
      var fDataIdx    = hdrsFolha.indexOf('DATA ASSINATURA')
      var fLinkIdx    = hdrsFolha.indexOf('LINK DOC ASSINADO')
      for (var r = 1; r < valsFolha.length; r++) {
        var rFuncId = String(valsFolha[r][fIdIdx]     || '').trim()
        var rStatus = String(valsFolha[r][fStatusIdx] || '').trim()
        var rTipo = String(hdrsFolha.indexOf('TIPO') >= 0 ? valsFolha[r][hdrsFolha.indexOf('TIPO')] : '').trim()
        var tipoOk = !rTipo || rTipo === '' || rTipo === tipo
        if (rFuncId === String(funcId) && tipoOk &&
            (rStatus === 'Salvo' || rStatus === 'Aguardando Assinatura' || rStatus === 'Pendente')) {
          if (fStatusIdx >= 0) sheetFolha.getRange(r+1, fStatusIdx+1).setValue('Assinado')
          if (fDataIdx   >= 0) sheetFolha.getRange(r+1, fDataIdx  +1).setValue(hoje.split(' ')[0])
          if (fLinkIdx   >= 0) sheetFolha.getRange(r+1, fLinkIdx  +1).setValue(linkDrive)
        }
      }
    }
  } catch(e) { Logger.log('Erro ao atualizar status: ' + e.message) }

  if (tipo === 'Ferias') confirmarFeriasAssinada(token)

  logAcao('SISTEMA', 'ASSINATURA_PROPRIA', 'Token: ' + token + ' | Func: ' + funcNome + ' | Drive: ' + linkDrive)

  // Ordem de pagamento do valor a receber. Ferias entra aqui junto com
  // Folha e Ponto — antes ficava de fora e o valor das férias nunca
  // chegava ao extrato do funcionário.
  try {
    if (tipo === 'Folha' || tipo === 'Ponto' || tipo === 'Ferias') {
      gerarOrdemDeAssinatura({
        func_id:       funcId,
        competencia:   String(referencia),
        valor_liquido: rowData[16] ? parseFloat(rowData[16]) : null,
        origem:        tipo,
        ref_doc:       token,
      }, 'SISTEMA')
    }
  } catch(eNotif) { Logger.log('Erro ordem de pagamento (assinatura própria): ' + eNotif.message) }

  return { ok: true, link_drive: linkDrive }
}

function gerarReciboEpiPdfAssinado(func, itens, motivo, assinaturaBase64) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm")

  var tabelaItens = ''
  if (itens && itens.length) {
    itens.forEach(function(item) {
      tabelaItens += '<tr><td>' + item.cod + '</td><td>' + item.descricao + '</td><td>' + (item.ca||'') + '</td><td style="text-align:center">' + item.quantidade + '</td></tr>'
    })
  }

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}' +
    '.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}' +
    '.header h1{margin:0;font-size:18px}' +
    '.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    'h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px}' +
    'th{background:#1A5C2A;color:white;padding:6px 8px;font-size:10px;text-align:left}' +
    'td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:10px}' +
    '.campo{display:flex;gap:8px;margin:4px 0}' +
    '.label{font-weight:bold;min-width:120px}' +
    '.termo{background:#f0f9f0;border:1px solid #c8e6c9;border-radius:6px;padding:12px;margin-top:16px;font-size:10px;line-height:1.6}' +
    '.assinaturas{display:flex;justify-content:center;margin-top:40px}' +
    '.assinatura{text-align:center;width:340px}' +
    '.sig-img{height:80px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:0}' +
    '.sig-img img{max-height:76px;max-width:300px;object-fit:contain;display:block}' +
    '.linha-ass{border-top:2px solid #333;margin-bottom:6px;margin-top:2px}' +
    '.carimbo{font-size:8px;color:#2E7D32;margin-top:6px;font-style:italic}' +
    '.rodape{margin-top:32px;font-size:8px;color:#999;text-align:center}' +
    '</style></head><body>' +
    '<div class="header"><h1>Fazenda Agua Viva</h1><p>Sistema SST - Recibo de Entrega de EPI</p></div>' +
    '<h2>RECIBO DE ENTREGA DE EPI</h2>' +
    '<h2>Dados do Funcionario</h2>' +
    '<div class="campo"><span class="label">Funcionario:</span>' + func['NOME_COMPLETO'] + '</div>' +
    '<div class="campo"><span class="label">Data da Entrega:</span>' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy') + '</div>' +
    '<div class="campo"><span class="label">Motivo:</span>' + motivo + '</div>' +
    '<h2>Itens Entregues</h2>' +
    '<table><thead><tr><th>Codigo</th><th>Descricao</th><th>Nr CA</th><th>Qtd.</th></tr></thead>' +
    '<tbody>' + tabelaItens + '</tbody></table>' +
    '<div class="termo"><strong>DECLARACAO DO FUNCIONARIO</strong><br><br>' +
    'Declaro que recebi os equipamentos listados acima em perfeitas condicoes, que fui orientado quanto ao ' +
    'uso correto e que e de minha responsabilidade a conservacao, higienizacao e comunicacao em caso de ' +
    'danos ou necessidade de substituicao, conforme determina a NR-6.</div>' +
    '<div class="assinaturas"><div class="assinatura">' +
    '<div class="sig-img"><img src="data:image/png;base64,' + assinaturaBase64 + '" alt="Assinatura"></div>' +
    '<div class="linha-ass"></div>' +
    '<strong>' + func['NOME_COMPLETO'] + '</strong><br>Assinatura do Funcionario' +
    '<div class="carimbo">Assinado digitalmente em ' + hoje + ' — Sistema SST Fazenda Agua Viva</div>' +
    '</div></div>' +
    '<div class="rodape">Documento gerado pelo Sistema SST — Fazenda Agua Viva</div>' +
    '</body></html>'

  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName('recibo_epi_assinado.pdf')
  return Utilities.base64Encode(blob.getBytes())
}

function salvarPdfTemporario(pdfBase64, token) {
  if (!pdfBase64) return ''
  try {
    var raiz  = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER)
    var pasta = null
    var pastas = raiz.getFoldersByName('_ASSINATURAS_TEMP')
    if (pastas.hasNext()) { pasta = pastas.next() }
    else { pasta = raiz.createFolder('_ASSINATURAS_TEMP') }
    var bytes = Utilities.base64Decode(pdfBase64)
    var blob  = Utilities.newBlob(bytes, 'application/pdf', 'temp_' + token + '.pdf')
    var arq   = pasta.createFile(blob)
    arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
    return arq.getId()
  } catch(e) {
    Logger.log('Erro salvarPdfTemporario: ' + e.message)
    return ''
  }
}

function carregarPdfTemporario(fileId) {
  if (!fileId) return ''
  try {
    var arq   = DriveApp.getFileById(fileId)
    var bytes = arq.getBlob().getBytes()
    return Utilities.base64Encode(bytes)
  } catch(e) {
    Logger.log('Erro carregarPdfTemporario: ' + e.message)
    return ''
  }
}

function adicionarAssinaturaAoPdf(pdfBase64, assinaturaBase64, nomeFunc) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm")

  var htmlComAssinatura =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}' +
    '.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}' +
    '.header h1{margin:0;font-size:18px}' +
    '.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    'h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}' +
    '.campo{display:flex;gap:8px;margin:4px 0}' +
    '.label{font-weight:bold;min-width:120px}' +
    '.assinaturas{display:flex;justify-content:center;margin-top:48px}' +
    '.assinatura{text-align:center;width:320px}' +
    '.sig-img{height:72px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px}' +
    '.sig-img img{max-height:68px;max-width:280px;object-fit:contain}' +
    '.linha-ass{border-top:2px solid #1A5C2A;margin-bottom:6px}' +
    '.rodape{margin-top:32px;font-size:8px;color:#999;text-align:center}' +
    '.carimbo{font-size:8px;color:#999;text-align:center;margin-top:4px}' +
    '</style></head><body>' +
    '<div class="header"><h1>Fazenda Agua Viva</h1><p>Sistema SST - Recibo de Entrega de EPI</p></div>' +
    '<h2>RECIBO DE ENTREGA DE EPI</h2>' +
    '<h2>Dados do Funcionario</h2>' +
    '<div class="campo"><span class="label">Funcionario:</span>' + nomeFunc + '</div>' +
    '<div class="campo"><span class="label">Assinado em:</span>' + hoje + '</div>' +
    '<div class="assinaturas"><div class="assinatura">' +
    '<div class="sig-img"><img src="data:image/png;base64,' + assinaturaBase64 + '" alt="Assinatura digital"></div>' +
    '<div class="linha-ass"></div>' +
    '<strong>' + nomeFunc + '</strong><br>Assinatura do Funcionario' +
    '<div class="carimbo">Assinado digitalmente pelo Sistema SST - Fazenda Agua Viva</div>' +
    '</div></div>' +
    '<div class="rodape">Documento gerado pelo Sistema SST — Fazenda Agua Viva</div>' +
    '</body></html>'

  var blob  = HtmlService.createHtmlOutput(htmlComAssinatura).getAs('application/pdf').setName('recibo_assinado.pdf')
  return Utilities.base64Encode(blob.getBytes())
}

// ─── Rodar UMA VEZ para adicionar colunas novas na aba ASSINATURAS ──
function atualizarAbaAssinaturas() {
  const sheet   = getSheetAssinaturas()
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  const novas   = ['ITENS_JSON', 'MOTIVO', 'CPF', 'FUNCAO', 'UNIDADE', 'VALOR_LIQUIDO']
  novas.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      const nextCol = sheet.getLastColumn() + 1
      sheet.getRange(1, nextCol).setValue(col)
    }
  })
  return 'OK'
}

function getSheetAssinaturas() {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  let sheet   = ss.getSheetByName('ASSINATURAS')
  if (!sheet) {
    sheet = ss.insertSheet('ASSINATURAS')
    sheet.appendRow(['TOKEN','TIPO','ID_FUNC','NOME_FUNC','REFERENCIA','DATA_CRIACAO','DATA_ASSINATURA','STATUS','PDF_FILEID','LINK_DRIVE','GERADO_POR','ITENS_JSON','MOTIVO','CPF','FUNCAO','UNIDADE','VALOR_LIQUIDO'])
    sheet.setFrozenRows(1)
  }
  return sheet
}

// ═══════════════════════════════════════════════════════════════════
// ASSINATURA PRÓPRIA — FOLHA DE PAGAMENTO E FOLHA DE PONTO
// ═══════════════════════════════════════════════════════════════════
function processarPaginaProprio(dados, usuario) {
  var func = listarFuncionarios().find(function(f) {
    return String(f['ID']) === String(dados.func_id)
  })
  if (!func) throw new Error('Funcionário não encontrado: ' + dados.func_id)

  var hoje     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  var comp     = dados.competencia || ''
  var compLimpo = String(comp || '').replace(/\//g, '-')
  var tipo     = dados.tipo || 'Folha'
  var subpasta = subpastaDoTipo(tipo)
  var nomeArq  = nomeDocumentoAssinatura(tipo, comp, func['NOME_COMPLETO']) + '_PENDENTE.pdf'

  var linkDrive = ''
  try {
    linkDrive = salvarPdfNoDrive(func['ID'], func['NOME_COMPLETO'], subpasta, nomeArq, dados.pdf_base64)
  } catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }

  adicionarLinhaFolha({
    'ID FUNC.':          func['ID'],
    'FUNCIONÁRIO':       func['NOME_COMPLETO'],
    'COMPETÊNCIA':       comp,
    'DATA ENVIO':        hoje,
    'STATUS':            'Aguardando Assinatura',
    'LINK PDF ORIGINAL': linkDrive,
    'OBSERVAÇÕES':       'Assinatura Própria — ' + tipo +
                         (dados.inclui_ponto ? ' | Ponto junto' : ''),
    'VALOR_LIQUIDO':     valorNumerico(dados.valor_liquido),
    'TIPO':              tipo,
    'VERBAS':            verbasParaCelula(normalizarVerbas(dados.verbas)),
  })

  var linkData = gerarLinkAssinatura({
    tipo:         tipo,
    func_id:      func['ID'],
    referencia:   comp,
    pdf_base64:   dados.pdf_base64,
    func_funcao:  func['FUNCAO']  || '',
    func_unidade: func['UNIDADE'] || '',
    func_cpf:     func['CPF']     || '',
    valor_liquido: dados.valor_liquido || null,
  }, usuario)

  if (tipo === 'Ferias') registrarFeriasPendente(func['ID'], func['NOME_COMPLETO'], dados.ferias_inicio, dados.ferias_fim, comp, linkData.token)

  logAcao(usuario, 'PROC_PAGINA_PROPRIO',
    'Func ' + func['ID'] + ' | ' + tipo + ' ' + comp + ' | Token: ' + linkData.token)

  return {
    func_id:   func['ID'],
    nome:      func['NOME_COMPLETO'],
    link:      linkData.link,
    wa_link:   linkData.wa_link,
    token:     linkData.token,
    link_drive: linkDrive,
  }
}

function gerarFolhaPdfAssinado(pdfBase64Original, assinaturaBase64, funcNome, tipo, competencia) {
  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm")
  var tipoLabel = tipo === 'Ponto' ? 'Folha de Ponto' : tipo === 'Ferias' ? 'Folha de Férias' : 'Folha de Pagamento'

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}' +
    '.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}' +
    '.header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    'h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}' +
    '.campo{display:flex;gap:8px;margin:4px 0}.label{font-weight:bold;min-width:130px}' +
    '.termo{background:#f0f9f0;border:1px solid #c8e6c9;border-radius:6px;padding:14px;margin-top:20px;font-size:10px;line-height:1.7}' +
    '.assinaturas{display:flex;justify-content:center;margin-top:48px}' +
    '.assinatura{text-align:center;width:340px}' +
    '.sig-img{height:80px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:0}' +
    '.sig-img img{max-height:76px;max-width:300px;object-fit:contain;display:block}' +
    '.linha-ass{border-top:2px solid #333;margin-bottom:6px;margin-top:2px}' +
    '.carimbo{font-size:8px;color:#2E7D32;margin-top:6px;font-style:italic}' +
    '.rodape{margin-top:32px;font-size:8px;color:#999;text-align:center}' +
    '</style></head><body>' +
    '<div class="header"><h1>Fazenda Agua Viva</h1><p>Sistema SST — ' + tipoLabel + '</p></div>' +
    '<h2>' + tipoLabel.toUpperCase() + ' — COMPROVANTE DE ASSINATURA</h2>' +
    '<div class="campo"><span class="label">Funcionário:</span>' + funcNome + '</div>' +
    '<div class="campo"><span class="label">Competência:</span>' + competencia + '</div>' +
    '<div class="campo"><span class="label">Data:</span>' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy') + '</div>' +
    '<div class="termo"><strong>DECLARAÇÃO DO FUNCIONÁRIO</strong><br><br>' +
    'Declaro que recebi e conferi o documento referente a <strong>' + tipoLabel + '</strong> ' +
    'da competência <strong>' + competencia + '</strong>, estando de acordo com seu conteúdo ' +
    'e não tendo quaisquer ressalvas relativas ao período em questão.' +
    '</div>' +
    '<div class="assinaturas"><div class="assinatura">' +
    '<div class="sig-img"><img src="data:image/png;base64,' + assinaturaBase64 + '" alt="Assinatura"></div>' +
    '<div class="linha-ass"></div>' +
    '<strong>' + funcNome + '</strong><br>Assinatura do Funcionário' +
    '<div class="carimbo">Assinado digitalmente em ' + hoje + ' — Sistema SST Fazenda Agua Viva</div>' +
    '</div></div>' +
    '<div class="rodape">Documento gerado pelo Sistema SST — Fazenda Agua Viva</div>' +
    '</body></html>'

  var compStr = String(competencia || '').replace(/\//g,'-').replace(/[^a-zA-Z0-9_\-]/g,'')
  var nomeArqSig = tipoLabel.replace(/ /g,'_') + '_' + compStr + '_' + funcNome.split(' ')[0] + '_ASSINADO.pdf'
  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(nomeArqSig)
  return Utilities.base64Encode(blob.getBytes())
}

// ─── Configurar chave da API do Claude (rodar UMA VEZ) ───────────
// Cole a chave APENAS ao rodar; não deixe a chave salva no código.
function configurarChaveIA() {
  var chave = 'COLE_SUA_CHAVE_ANTHROPIC_AQUI'
  if (chave.indexOf('sk-ant-') !== 0) throw new Error('Defina a chave antes de rodar')
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_KEY', chave)
  Logger.log('Chave configurada com sucesso!')
}

// Helper opcional para configurar o token da ZapSign (rodar UMA VEZ)
function configurarTokenZapSign() {
  var token = 'COLE_SEU_TOKEN_ZAPSIGN_AQUI'
  PropertiesService.getScriptProperties().setProperty('ZAPSIGN_TOKEN', token)
  Logger.log('Token ZapSign configurado!')
}

// ═══════════════════════════════════════════════════════════════════
// MÓDULO: CONTROLE DE PAGAMENTO — SALÁRIOS E COMISSÕES
// ═══════════════════════════════════════════════════════════════════

var ABA_COMISSOES       = 'COMISSOES'
var ABA_ADIANTAMENTOS   = 'ADIANTAMENTOS'
var ABA_AUTORIZACOES    = 'AUTORIZACOES_PAGTO'

function inicializarAbasPagamento() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID)

  if (!ss.getSheetByName(ABA_COMISSOES)) {
    var s = ss.insertSheet(ABA_COMISSOES)
    s.appendRow(['ID_FUNC','NOME','ANO','VALOR_ANUAL','OBSERVACOES','DATA_CADASTRO','CADASTRADO_POR'])
    s.setFrozenRows(1)
  }

  if (!ss.getSheetByName(ABA_ADIANTAMENTOS)) {
    var s2 = ss.insertSheet(ABA_ADIANTAMENTOS)
    s2.appendRow(['ID','ID_FUNC','NOME','ANO','DATA_PAGTO','VALOR','FORMA_PAGTO','OBSERVACOES','REGISTRADO_POR'])
    s2.setFrozenRows(1)
  }

  if (!ss.getSheetByName(ABA_AUTORIZACOES)) {
    var s3 = ss.insertSheet(ABA_AUTORIZACOES)
    s3.appendRow(['ID','ID_FUNC','NOME','COMPETENCIA','VALOR_SALARIO','DATA_GERACAO','STATUS','LINK_DOC','GERADO_POR'])
    s3.setFrozenRows(1)
  }

  return 'OK'
}

function cadastrarComissao(dados, usuario) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_COMISSOES)
  var hoje  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')

  var existente = sheet.getDataRange().getValues()
  for (var i = 1; i < existente.length; i++) {
    if (String(existente[i][0]) === String(dados.func_id) && String(existente[i][2]) === String(dados.ano)) {
      sheet.getRange(i+1, 3).setValue(dados.ano)
      sheet.getRange(i+1, 4).setValue(dados.valor_anual)
      sheet.getRange(i+1, 5).setValue(dados.observacoes || '')
      logAcao(usuario, 'COMISSAO_ATUALIZADA', 'Func ' + dados.func_id + ' | ' + dados.ano + ' | R$' + dados.valor_anual)
      return { ok: true, acao: 'atualizado' }
    }
  }

  sheet.appendRow([dados.func_id, func['NOME_COMPLETO'], dados.ano, dados.valor_anual, dados.observacoes || '', hoje, usuario])
  logAcao(usuario, 'COMISSAO_CADASTRADA', 'Func ' + dados.func_id + ' | ' + dados.ano + ' | R$' + dados.valor_anual)
  return { ok: true, acao: 'cadastrado' }
}

function listarComissoes(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_COMISSOES)
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  var lista = vals.slice(1).map(function(row) {
    var obj = {}
    hdrs.forEach(function(h, i) { obj[h] = valorDeCelula(row[i]) })
    return obj
  })
  if (dados && dados.func_id) lista = lista.filter(function(r) { return String(r['ID_FUNC']) === String(dados.func_id) })
  if (dados && dados.ano)     lista = lista.filter(function(r) { return String(r['ANO']) === String(dados.ano) })
  return lista
}

function registrarAdiantamento(dados, usuario) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_ADIANTAMENTOS)
  var vals  = sheet.getDataRange().getValues()
  var id    = vals.length

  sheet.appendRow([
    id, dados.func_id, func['NOME_COMPLETO'],
    dados.ano, dados.data_pagto, dados.valor,
    dados.forma_pagto || 'Pix', dados.observacoes || '', usuario
  ])

  logAcao(usuario, 'ADIANTAMENTO_REGISTRADO',
    'Func ' + dados.func_id + ' | ' + dados.ano + ' | R$' + dados.valor + ' | ' + (dados.forma_pagto||'Pix'))
  return { ok: true, id: id }
}

function listarAdiantamentos(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_ADIANTAMENTOS)
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  var lista = vals.slice(1).map(function(row) {
    var obj = {}
    hdrs.forEach(function(h, i) { obj[h] = valorDeCelula(row[i]) })
    return obj
  })
  if (dados && dados.func_id) lista = lista.filter(function(r) { return String(r['ID_FUNC']) === String(dados.func_id) })
  if (dados && dados.ano)     lista = lista.filter(function(r) { return String(r['ANO']) === String(dados.ano) })
  return lista.reverse()
}

function resumoComissao(dados) {
  var comissoes     = listarComissoes(dados)
  var adiantamentos = listarAdiantamentos(dados)

  var valorAnual = comissoes.length ? parseFloat(comissoes[0]['VALOR_ANUAL']) || 0 : 0

  if (!valorAnual && dados.func_id) {
    var funcs = listarFuncionarios()
    var func  = funcs.find(function(f) { return String(f['ID']) === String(dados.func_id) })
    if (func && func['COMISSAO_ANUAL']) {
      var raw = String(func['COMISSAO_ANUAL']).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.')
      valorAnual = parseFloat(raw) || 0
    }
  }

  var totalPago = adiantamentos.reduce(function(s, a) { return s + (parseFloat(a['VALOR']) || 0) }, 0)
  return {
    valor_anual:   valorAnual,
    total_pago:    totalPago,
    saldo:         valorAnual - totalPago,
    percentual:    valorAnual > 0 ? Math.round((totalPago / valorAnual) * 100) : 0,
    adiantamentos: adiantamentos,
  }
}

// Formata número no padrão brasileiro (1234.5 -> "1.234,50")
function formatBRL(n) {
  n = Number(n) || 0
  var p = Math.abs(n).toFixed(2).split('.')
  var inteiro = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (n < 0 ? '-' : '') + inteiro + ',' + p[1]
}

// ── RECIBO DE ADIANTAMENTO DE COMISSÃO ────────────────────────────
// Gera o recibo em PDF. modo 'impresso' => sem assinatura (linha em branco).
// modo 'assinatura' + assinatura_base64 => carimba a assinatura na posição
// escolhida (sig_x/sig_y/sig_w em % da página A4) e salva no Drive.
function gerarReciboAdiantamento(dados, usuario) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  var valorNum = (typeof dados.valor === 'number') ? dados.valor
               : parseFloat(String(dados.valor || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')) || 0
  var valorFmt = 'R$ ' + formatBRL(valorNum)
  var hojeExt  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd 'de' MMMM 'de' yyyy")
  var comAssin = !!dados.assinatura_base64

  var sigX = dados.sig_x != null ? dados.sig_x : 30
  var sigY = dados.sig_y != null ? dados.sig_y : 72
  var sigW = dados.sig_w != null ? dados.sig_w : 34

  var esc = function(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

  var sigOverlay = comAssin
    ? '<img src="data:image/png;base64,' + dados.assinatura_base64 + '" style="position:absolute;left:' + sigX + '%;top:' + sigY + '%;width:' + sigW + '%;height:auto;">'
    : ''

  var obsLinha = dados.observacoes ? '<div class="campo"><span class="rot">Observações:</span><span>' + esc(dados.observacoes) + '</span></div>' : ''

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '@page{size:A4;margin:0}html,body{margin:0;padding:0}' +
    '.page{position:relative;width:210mm;height:297mm;box-sizing:border-box;font-family:Arial,sans-serif;color:#222}' +
    '.content{padding:20mm 18mm}' +
    '.header{background:#1A5C2A;color:#fff;padding:16px 20px;border-radius:6px}' +
    '.header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    '.titulo{text-align:center;font-size:15px;font-weight:bold;color:#1A5C2A;letter-spacing:.5px;margin:26px 0 4px}' +
    '.valor-box{text-align:center;font-size:22px;font-weight:bold;color:#1A5C2A;margin:6px 0 22px}' +
    '.texto{font-size:12px;line-height:1.8;text-align:justify;margin:14px 0}' +
    '.dados{background:#f6faf3;border:1px solid #d9e8cc;border-radius:8px;padding:14px 16px;margin:18px 0}' +
    '.campo{display:flex;gap:8px;font-size:11px;margin:5px 0}.rot{font-weight:bold;min-width:150px;color:#444}' +
    '.assinaturas{margin-top:70px;text-align:center}' +
    '.linha-ass{width:340px;border-top:1.5px solid #333;margin:0 auto 6px}' +
    '.ass-nome{font-size:12px;font-weight:bold}.ass-sub{font-size:10px;color:#555}' +
    '.local{text-align:center;font-size:11px;margin-top:34px}' +
    '.rodape{position:absolute;bottom:14mm;left:0;right:0;text-align:center;font-size:8px;color:#999}' +
    '</style></head><body><div class="page">' + sigOverlay +
    '<div class="content">' +
    '<div class="header"><h1>Fazenda Água Viva</h1><p>Sistema SST — Recibo de Adiantamento de Comissão</p></div>' +
    '<div class="titulo">RECIBO DE ADIANTAMENTO DE COMISSÃO</div>' +
    '<div class="valor-box">' + valorFmt + '</div>' +
    '<div class="texto">Recebi de <strong>FAZENDA ÁGUA VIVA</strong> a importância de <strong>' + valorFmt +
    '</strong>, a título de <strong>adiantamento de comissão</strong> referente ao exercício de <strong>' + esc(dados.ano || '') +
    '</strong>, dando plena e geral quitação do valor ora recebido.</div>' +
    '<div class="dados">' +
    '<div class="campo"><span class="rot">Funcionário:</span><span>' + esc(func['NOME_COMPLETO']) + '</span></div>' +
    '<div class="campo"><span class="rot">CPF:</span><span>' + esc(func['CPF'] || '—') + '</span></div>' +
    '<div class="campo"><span class="rot">Função / Unidade:</span><span>' + esc((func['FUNCAO'] || '—') + ' · ' + (func['UNIDADE'] || '—')) + '</span></div>' +
    '<div class="campo"><span class="rot">Forma de pagamento:</span><span>' + esc(dados.forma_pagto || 'Pix') + '</span></div>' +
    '<div class="campo"><span class="rot">Data do pagamento:</span><span>' + esc(dados.data_pagto || '—') + '</span></div>' +
    obsLinha +
    '</div>' +
    '<div class="local">' + esc(func['UNIDADE'] || 'Fazenda Água Viva') + ', ' + hojeExt + '.</div>' +
    '<div class="assinaturas"><div class="linha-ass"></div>' +
    '<div class="ass-nome">' + esc(func['NOME_COMPLETO']) + '</div>' +
    '<div class="ass-sub">Assinatura do funcionário</div></div>' +
    '</div>' +
    '<div class="rodape">Documento gerado' + (comAssin ? ' e assinado digitalmente' : '') + ' em ' + hojeExt + ' pelo Sistema SST — Fazenda Água Viva</div>' +
    '</div></body></html>'

  var pdfBytes = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName('recibo_adiantamento.pdf').getBytes()
  var pdfBase64 = Utilities.base64Encode(pdfBytes)

  var resultado = { ok: true, pdf_base64: pdfBase64 }

  if (comAssin) {
    var dataArq = String(dados.data_pagto || hojeExt).replace(/\//g, '-')
    var nomeArq = 'Recibo_Adiantamento_' + dataArq + '_R$' + formatBRL(valorNum).replace(/[.,]/g, '') + '_ASSINADO.pdf'
    try {
      resultado.link = salvarPdfNoDrive(func['ID'], func['NOME_COMPLETO'], 'ADIANTAMENTOS', nomeArq, pdfBase64)
    } catch (e) {
      Logger.log('Erro ao salvar recibo adiantamento no Drive: ' + e.message)
      resultado.aviso = 'PDF gerado, mas não foi salvo no Drive: ' + e.message
    }
    logAcao(usuario || 'SISTEMA', 'RECIBO_ADIANTAMENTO_ASSINADO', 'Func ' + func['ID'] + ' | ' + valorFmt + ' | ' + (dados.data_pagto || ''))
  }

  return resultado
}

function gerarAutorizacaoPagamento(dados, usuario) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  var hoje   = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd 'de' MMMM 'de' yyyy")
  var pdfB64 = gerarPdfAutorizacaoPagamento(func, dados.competencia, dados.valor_salario, hoje, usuario)

  var linkDrive = ''
  try {
    var raiz   = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER)
    var pastas = raiz.getFoldersByName('_AUTORIZACOES_PAGTO')
    var pasta  = pastas.hasNext() ? pastas.next() : raiz.createFolder('_AUTORIZACOES_PAGTO')
    var bytes  = Utilities.base64Decode(pdfB64)
    var blob   = Utilities.newBlob(bytes, 'application/pdf',
      'AutorizacaoPagto_' + func['NOME_COMPLETO'].split(' ')[0] + '_' + String(dados.competencia).replace(/\//g,'-') + '.pdf')
    var arq = pasta.createFile(blob)
    linkDrive = arq.getUrl()
  } catch(e) { logAcao(usuario, 'ERRO_DRIVE_AUTORIZACAO', e.message) }

  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_AUTORIZACOES)
  var id    = sheet.getLastRow()
  sheet.appendRow([id, dados.func_id, func['NOME_COMPLETO'], dados.competencia,
    dados.valor_salario, Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy'),
    'Gerada', linkDrive, usuario])

  logAcao(usuario, 'AUTORIZACAO_GERADA', 'Func ' + dados.func_id + ' | ' + dados.competencia)
  return { ok: true, link_drive: linkDrive, pdf_base64: pdfB64 }
}

function gerarPdfAutorizacaoPagamento(func, competencia, valorSalario, hoje, adm) {
  var valor = parseFloat(valorSalario).toLocaleString('pt-BR', {minimumFractionDigits:2})
  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}' +
    '.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px}' +
    '.header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    'h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin-top:24px}' +
    '.campo{display:flex;gap:8px;margin:6px 0}.label{font-weight:bold;min-width:140px}' +
    '.valor-box{background:#f0f9f0;border:2px solid #1A5C2A;border-radius:8px;padding:16px;margin:20px 0;text-align:center}' +
    '.valor-num{font-size:28px;font-weight:bold;color:#1A5C2A}' +
    '.valor-label{font-size:11px;color:#555;margin-top:4px}' +
    '.termo{background:#f9f9f9;border:1px solid #ddd;border-radius:6px;padding:12px;margin-top:16px;font-size:10px;line-height:1.7}' +
    '.assinaturas{display:flex;justify-content:space-around;margin-top:60px}' +
    '.assinatura{text-align:center;width:200px}' +
    '.linha-ass{border-top:1px solid #333;margin-bottom:6px}' +
    '.rodape{margin-top:32px;font-size:8px;color:#999;text-align:center;font-style:italic}' +
    '.confidencial{background:#FFF3CD;border:1px solid #FFC107;border-radius:4px;padding:6px 10px;font-size:9px;color:#856404;margin-bottom:16px;text-align:center;font-weight:bold}' +
    '</style></head><body>' +
    '<div class="header"><h1>Fazenda Agua Viva</h1><p>Autorização de Pagamento de Salário</p></div>' +
    '<div class="confidencial">DOCUMENTO INTERNO — USO EXCLUSIVO DA ADMINISTRAÇÃO</div>' +
    '<h2>AUTORIZAÇÃO DE PAGAMENTO</h2>' +
    '<div class="campo"><span class="label">Funcionário:</span>' + func['NOME_COMPLETO'] + '</div>' +
    '<div class="campo"><span class="label">Função:</span>' + (func['FUNCAO']||'') + '</div>' +
    '<div class="campo"><span class="label">Unidade:</span>' + (func['UNIDADE']||'') + '</div>' +
    '<div class="campo"><span class="label">Competência:</span>' + competencia + '</div>' +
    '<div class="campo"><span class="label">Data:</span>' + hoje + '</div>' +
    '<div class="valor-box">' +
    '<div class="valor-num">R$ ' + valor + '</div>' +
    '<div class="valor-label">Valor do Salário — ' + competencia + '</div>' +
    '</div>' +
    '<div class="termo">Autorizo o pagamento do salário referente à competência <strong>' + competencia + '</strong> ' +
    'ao funcionário <strong>' + func['NOME_COMPLETO'] + '</strong> no valor de <strong>R$ ' + valor + '</strong>, ' +
    'conforme demonstrativo (holerite) assinado pelo colaborador.</div>' +
    '<div class="assinaturas">' +
    '<div class="assinatura"><div class="linha-ass"></div><strong>' + adm + '</strong><br>Responsável</div>' +
    '<div class="assinatura"><div class="linha-ass"></div><strong>Autorizado por</strong><br>Proprietário</div>' +
    '</div>' +
    '<div class="rodape">Gerado em ' + hoje + ' pelo Sistema SST — Fazenda Agua Viva — CONFIDENCIAL</div>' +
    '</body></html>'

  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName('autorizacao.pdf')
  return Utilities.base64Encode(blob.getBytes())
}

function listarAutorizacoes(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_AUTORIZACOES)
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  var lista = vals.slice(1).map(function(row) {
    var obj = {}
    hdrs.forEach(function(h, i) { obj[h] = valorDeCelula(row[i]) })
    return obj
  })
  if (dados && dados.func_id) lista = lista.filter(function(r) { return String(r['ID_FUNC']) === String(dados.func_id) })
  return lista.reverse()
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICAÇÃO DE PAGAMENTO — WhatsApp para o empregador
// ═══════════════════════════════════════════════════════════════════
function gerarMensagemPagamento(dados) {
  var funcIds = dados.func_ids || [dados.func_id]
  var todos   = listarFuncionarios()
  var mensagens = []

  funcIds.forEach(function(id) {
    var func = todos.find(function(f) { return String(f['ID']) === String(id) })
    if (!func) return

    var mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
    var comp = String(dados.competencia || '').trim()
    if (comp.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      var partes = comp.split('/')
      comp = mesesNomes[parseInt(partes[1]) - 1] + '/' + partes[2]
    }
    if (comp.match(/^\d{2}\/\d{4}$/)) {
      var partes2 = comp.split('/')
      comp = mesesNomes[parseInt(partes2[0]) - 1] + '/' + partes2[1]
    }
    dados.competencia = comp

    var folhas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA)
    var folhasFunc = folhas.filter(function(f) {
      if (String(f['ID FUNC.']).trim() !== String(id).trim()) return false
      if (f['STATUS'] !== 'Assinado') return false
      var compPlan = String(f['COMPETÊNCIA'] || '').trim()
      if (compPlan.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        var pp = compPlan.split('/')
        compPlan = mesesNomes[parseInt(pp[1])-1] + '/' + pp[2]
      }
      return compPlan === comp
    })
    var folha = folhasFunc.find(function(f) { return f['VALOR_LIQUIDO'] && String(f['VALOR_LIQUIDO']).trim() !== '' })
               || folhasFunc[folhasFunc.length - 1] || null

    var normalizarValor = function (v) { return String(valorNumerico(v)) }
    var valorLiquido = dados.valor_liquido ? normalizarValor(String(dados.valor_liquido)) : ''
    if (!valorLiquido && folha) {
      valorLiquido = normalizarValor(String(folha['VALOR_LIQUIDO'] || ''))
    }
    if (!valorLiquido) {
      try {
        var sheetAss = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('ASSINATURAS')
        if (sheetAss) {
          var valsAss = sheetAss.getDataRange().getValues()
          var compBusca = String(dados.competencia || '').trim()
          var funcBusca = String(func['ID'] || '').trim()
          for (var ia = 1; ia < valsAss.length; ia++) {
            var rowComp  = String(valsAss[ia][4] || '').trim()
            var rowFunc  = String(valsAss[ia][2] || '').trim()
            var rowValor = valsAss[ia][16]
            if (rowFunc === funcBusca && rowComp === compBusca && rowValor) {
              valorLiquido = normalizarValor(String(rowValor))
              break
            }
          }
        }
      } catch(eAss) { Logger.log('Erro busca ASSINATURAS: ' + eAss.message) }
    }

    var valorFormatado = ''
    if (valorLiquido && !isNaN(parseFloat(valorLiquido))) {
      var vNum = Math.round(parseFloat(valorLiquido) * 100) / 100
      var vStr = vNum.toFixed(2)
      var partes3 = vStr.split('.')
      var intPart = partes3[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      valorFormatado = 'R$ ' + intPart + ',' + partes3[1]
    }

    var banco   = String(func['BANCO']   || '').trim()
    var agencia = String(func['AGENCIA'] || '').trim()
    var conta   = String(func['CONTA']   || '').trim()
    var pix     = String(func['PIX']     || '').trim()
    var waTelRaw = String(func['WHATSAPP_EMPREGADOR'] || '').replace(/\D/g,'')
    if (waTelRaw.length === 0) waTelRaw = String(func['TELEFONE'] || '').replace(/\D/g,'')
    if (waTelRaw.length >= 12 && waTelRaw.substring(0,2) === '55') waTelRaw = waTelRaw.substring(2)
    var waTel = waTelRaw

    var linhasPagto = []
    if (pix)     linhasPagto.push('PIX: ' + pix)
    if (banco)   linhasPagto.push('Banco: ' + banco)
    if (agencia) linhasPagto.push('Agência: ' + agencia)
    if (conta)   linhasPagto.push('Conta: ' + conta)

    var msg = '✅ *Autorização de Pagamento de Salário*\n\n' +
      '👤 *Funcionário:* ' + func['NOME_COMPLETO'] + '\n' +
      '💼 *Função:* ' + (func['FUNCAO'] || '') + '\n' +
      '📅 *Competência:* ' + dados.competencia + '\n'

    if (valorFormatado) {
      msg += '💰 *Valor líquido:* ' + valorFormatado + '\n'
    } else {
      msg += '💰 *Valor líquido:* (consultar holerite)\n'
    }

    msg += '\n'

    if (linhasPagto.length) {
      msg += '🏦 *Dados para pagamento:*\n' + linhasPagto.join('\n') + '\n'
    } else {
      msg += '⚠️ _Dados bancários não cadastrados — verificar ficha do funcionário_\n'
    }

    msg += '\n✔️ _Holerite assinado pelo funcionário._\n' +
           '_Sistema SST — Fazenda Água Viva_'

    mensagens.push({
      func_id:       func['ID'],
      nome:          func['NOME_COMPLETO'],
      wa_tel:        waTel,
      wa_link:       waTel ? 'https://wa.me/55' + waTel + '?text=' + encodeURIComponent(msg) : '',
      mensagem:      msg,
      valor:         valorLiquido,
      valor_liquido: valorLiquido,
    })
  })

  return mensagens
}

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO DE PAGAMENTOS — PDF com período customizável
// ═══════════════════════════════════════════════════════════════════
function gerarRelatorioPagamentos(dados) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  var dtInicio = new Date(dados.data_inicio)
  var dtFim    = new Date(dados.data_fim)
  dtFim.setHours(23,59,59)

  var folhas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA).filter(function(f) {
    if (String(f['ID FUNC.']) !== String(dados.func_id)) return false
    if (f['STATUS'] !== 'Assinado') return false
    var dt = parseDateBR(f['DATA ASSINATURA'] || f['DATA ENVIO'])
    return dt >= dtInicio && dt <= dtFim
  })

  var adiantamentos = listarAdiantamentos({ func_id: dados.func_id }).filter(function(a) {
    var dt = parseDateBR(a['DATA_PAGTO'])
    return dt >= dtInicio && dt <= dtFim
  })

  var totalSalarios    = folhas.reduce(function(s, f) { return s + (parseFloat(f['VALOR_LIQUIDO']) || 0) }, 0)
  var totalAdiantamentos = adiantamentos.reduce(function(s, a) { return s + (parseFloat(a['VALOR']) || 0) }, 0)
  var totalGeral       = totalSalarios + totalAdiantamentos

  var anoInicio  = dtInicio.getFullYear()
  var comissoes  = listarComissoes({ func_id: dados.func_id, ano: anoInicio })
  var comissaoAnual = comissoes.length ? parseFloat(comissoes[0]['VALOR_ANUAL']) || 0 : 0
  var totalAdiantTodoAno = listarAdiantamentos({ func_id: dados.func_id }).filter(function(a) {
    return new Date(a['DATA_PAGTO']).getFullYear() === anoInicio
  }).reduce(function(s, a) { return s + (parseFloat(a['VALOR']) || 0) }, 0)
  var saldoComissao = comissaoAnual - totalAdiantTodoAno

  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm")
  var periodoLabel = formatarDataBR(dtInicio) + ' a ' + formatarDataBR(dtFim)

  var linhasFolha = folhas.map(function(f) {
    return '<tr>' +
      '<td>' + (f['COMPETÊNCIA'] || '') + '</td>' +
      '<td>' + (f['DATA ASSINATURA'] || f['DATA ENVIO'] || '') + '</td>' +
      '<td style="text-align:right">' + formatarReais(f['VALOR_LIQUIDO'] || 0) + '</td>' +
      '<td style="text-align:center"><span style="color:#1A5C2A;font-weight:bold">OK</span></td>' +
      '</tr>'
  }).join('')

  var linhasAdiant = adiantamentos.map(function(a) {
    return '<tr>' +
      '<td>' + (a['DATA_PAGTO'] || '') + '</td>' +
      '<td>' + (a['FORMA_PAGTO'] || '') + '</td>' +
      '<td>' + (a['OBSERVACOES'] || '') + '</td>' +
      '<td style="text-align:right">' + formatarReais(a['VALOR'] || 0) + '</td>' +
      '</tr>'
  }).join('')

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:30px;color:#222}' +
    '.header{background:#1A5C2A;color:white;padding:16px 20px;border-radius:6px;margin-bottom:20px}' +
    '.header h1{margin:0;font-size:18px}.header p{margin:4px 0 0;font-size:10px;opacity:.85}' +
    '.confidencial{background:#FFF3CD;border:1px solid #FFC107;border-radius:4px;padding:5px 10px;font-size:9px;color:#856404;margin-bottom:16px;text-align:center;font-weight:bold}' +
    'h2{color:#1A5C2A;font-size:13px;border-bottom:2px solid #1A5C2A;padding-bottom:4px;margin:20px 0 10px}' +
    '.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:16px}' +
    '.info-item{display:flex;gap:8px;font-size:11px}.info-label{font-weight:bold;min-width:100px;color:#555}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:16px}' +
    'th{background:#1A5C2A;color:white;padding:7px 9px;font-size:10px;text-align:left}' +
    'td{padding:6px 9px;border-bottom:1px solid #eee;font-size:10px}' +
    'tr:nth-child(even) td{background:#f9f9f9}' +
    '.total-box{background:#f0f9f0;border:2px solid #1A5C2A;border-radius:8px;padding:14px;margin:16px 0}' +
    '.total-row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0}' +
    '.total-row.grande{font-size:15px;font-weight:bold;color:#1A5C2A;border-top:1px solid #c8e6c9;margin-top:8px;padding-top:8px}' +
    '.comissao-box{background:#FFF8E1;border:1px solid #FFC107;border-radius:8px;padding:12px;margin-top:12px}' +
    '.comissao-titulo{font-size:11px;font-weight:bold;color:#856404;margin-bottom:8px}' +
    '.rodape{margin-top:30px;font-size:8px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:10px}' +
    '</style></head><body>' +
    '<div class="header"><h1>Fazenda Água Viva</h1><p>Relatório de Pagamentos — Sistema SST</p></div>' +
    '<div class="confidencial">DOCUMENTO INTERNO — USO EXCLUSIVO DA ADMINISTRAÇÃO</div>' +
    '<h2>Dados do Funcionário</h2>' +
    '<div class="info-grid">' +
    '<div class="info-item"><span class="info-label">Funcionário:</span>' + func['NOME_COMPLETO'] + '</div>' +
    '<div class="info-item"><span class="info-label">Função:</span>' + (func['FUNCAO']||'') + '</div>' +
    '<div class="info-item"><span class="info-label">Unidade:</span>' + (func['UNIDADE']||'') + '</div>' +
    '<div class="info-item"><span class="info-label">Período:</span>' + periodoLabel + '</div>' +
    '</div>' +
    '<h2>Salários Pagos (Contra Cheque Assinado)</h2>' +
    (folhas.length > 0 ?
      '<table><thead><tr><th>Competência</th><th>Data Assinatura</th><th>Valor Líquido</th><th>Status</th></tr></thead><tbody>' + linhasFolha + '</tbody></table>' :
      '<p style="color:#999;font-size:11px;margin-bottom:16px">Nenhum holerite assinado no período.</p>'
    ) +
    '<h2>Adiantamentos de Comissão</h2>' +
    (adiantamentos.length > 0 ?
      '<table><thead><tr><th>Data</th><th>Forma</th><th>Observações</th><th>Valor</th></tr></thead><tbody>' + linhasAdiant + '</tbody></table>' :
      '<p style="color:#999;font-size:11px;margin-bottom:16px">Nenhum adiantamento no período.</p>'
    ) +
    '<div class="total-box">' +
    '<div class="total-row"><span>Total salários no período</span><span>' + formatarReais(totalSalarios) + '</span></div>' +
    '<div class="total-row"><span>Total adiantamentos no período</span><span>' + formatarReais(totalAdiantamentos) + '</span></div>' +
    '<div class="total-row grande"><span>TOTAL GERAL DO PERÍODO</span><span>' + formatarReais(totalGeral) + '</span></div>' +
    '</div>' +
    (comissaoAnual > 0 ?
      '<div class="comissao-box">' +
      '<div class="comissao-titulo">Situação da Comissão ' + anoInicio + ' (uso interno)</div>' +
      '<div class="total-row"><span>Comissão anual acordada</span><span>' + formatarReais(comissaoAnual) + '</span></div>' +
      '<div class="total-row"><span>Total adiantado no ano</span><span>' + formatarReais(totalAdiantTodoAno) + '</span></div>' +
      '<div class="total-row" style="font-weight:bold;color:' + (saldoComissao > 0 ? '#854F0B' : '#1A5C2A') + '"><span>Saldo restante ' + anoInicio + '</span><span>' + formatarReais(saldoComissao) + '</span></div>' +
      '</div>' : ''
    ) +
    '<div class="rodape">Gerado em ' + hoje + ' pelo Sistema SST — Fazenda Água Viva — CONFIDENCIAL<br>' +
    'Este documento é de uso exclusivo da administração e não deve ser compartilhado com terceiros.</div>' +
    '</body></html>'

  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf')
    .setName('Relatorio_' + func['NOME_COMPLETO'].split(' ')[0] + '_' + dados.data_inicio + '_a_' + dados.data_fim + '.pdf')
  return {
    pdf_base64:   Utilities.base64Encode(blob.getBytes()),
    total_salarios:    totalSalarios,
    total_adiantamentos: totalAdiantamentos,
    total_geral:       totalGeral,
    saldo_comissao:    saldoComissao,
    num_folhas:        folhas.length,
    num_adiantamentos: adiantamentos.length,
  }
}

function parseDateBR(str) {
  if (!str) return new Date(0)
  str = String(str).trim()
  if (str.indexOf('/') !== -1) {
    var p = str.split('/')
    if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]))
  }
  return new Date(str)
}

function formatarDataBR(dt) {
  return ('0'+dt.getDate()).slice(-2) + '/' + ('0'+(dt.getMonth()+1)).slice(-2) + '/' + dt.getFullYear()
}

function formatarReais(v) {
  return 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
}

// ─── Atualizar dados do funcionário ──────────────────────────────
function atualizarFuncionario(dados, usuario) {
  if (!dados.id) throw new Error('ID do funcionário não informado')
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  var sheet = ss.getSheetByName(CONFIG.ABAS.FUNCIONARIOS)
  var vals  = sheet.getDataRange().getValues()
  var hdrs  = vals[0]

  var rowIdx = -1
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(dados.id)) { rowIdx = i; break }
  }
  if (rowIdx === -1) throw new Error('Funcionário não encontrado: ' + dados.id)

  var mapa = {
    'nome_completo':       'NOME_COMPLETO',
    'nome_curto':          'NOME_CURTO',
    'funcao':              'FUNCAO',
    'unidade':             'UNIDADE',
    'cpf':                 'CPF',
    'rg':                  'RG',
    'data_nascimento':     'DATA_NASCIMENTO',
    'data_admissao':       'DATA_ADMISSAO',
    'telefone':            'TELEFONE',
    'email':               'EMAIL',
    'perfil_sst':          'PERFIL_SST',
    'empregador':          'EMPREGADOR',
    'opera_maquina':       'OPERA_MAQUINA',
    'aplica_defensivo':    'APLICA_DEFENSIVO',
    'tam_camisa':          'TAM_CAMISA',
    'tam_bota':            'TAM_BOTA',
    'observacoes':         'OBSERVACOES',
    'whatsapp_empregador': 'WHATSAPP_EMPREGADOR',
    'banco':               'BANCO',
    'agencia':             'AGENCIA',
    'conta':               'CONTA',
    'pix':                 'PIX',
    'salario_base':        'SALARIO_BASE',
    'comissao_anual':      'COMISSAO_ANUAL',
  }

  Object.keys(mapa).forEach(function(campo) {
    if (dados[campo] === undefined || dados[campo] === null) return
    var colNome = mapa[campo]
    var colIdx  = hdrs.indexOf(colNome)
    if (colIdx === -1) return
    sheet.getRange(rowIdx + 1, colIdx + 1).setValue(dados[campo])
  })

  logAcao(usuario, 'FUNCIONARIO_ATUALIZADO', 'ID: ' + dados.id + ' | ' + (dados.nome_completo || ''))
  return { id: dados.id, mensagem: 'Dados atualizados com sucesso' }
}

function debugColunasFuncionario() {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABAS.FUNCIONARIOS)
  var hdrs  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  Logger.log('Colunas (' + hdrs.length + '): ' + hdrs.join(' | '))
  var row = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
  hdrs.forEach(function(h, i) {
    if (h) Logger.log('[' + i + '] ' + h + ' = ' + row[i])
  })
}

function adicionarColunasFuncionarios() {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABAS.FUNCIONARIOS)
  var hdrs  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  var novas = ['WHATSAPP_EMPREGADOR', 'BANCO', 'AGENCIA', 'CONTA', 'PIX', 'SALARIO_BASE', 'COMISSAO_ANUAL']
  novas.forEach(function(col) {
    if (hdrs.indexOf(col) === -1) {
      var nextCol = sheet.getLastColumn() + 1
      sheet.getRange(1, nextCol).setValue(col)
    }
  })
  return 'OK'
}

// ─── Colunas da aba FOLHA_PAGAMENTO ────────────────────────────────
// A aba foi criada à mão e o app escrevia nela com appendRow POSICIONAL. Numa
// planilha com menos cabeçalhos do que valores gravados, o excedente ia parar
// em colunas ÓRFÃS (dados sem cabeçalho): o valor caía na coluna K sem ninguém
// chamá-la de VALOR_LIQUIDO, e como o lerAbaComoObjetos indexa por NOME, o
// número existia na planilha mas era invisível para o app. Daí a ordem de
// pagamento sair com "(consultar holerite)" e o extrato sem valor.
//
// Agora: cabeçalho garantido antes de gravar, e gravação por nome de coluna.
var COLUNAS_FOLHA = ['ID FUNC.', 'FUNCIONÁRIO', 'COMPETÊNCIA', 'DATA ENVIO',
                     'STATUS', 'DATA ASSINATURA', 'ZAPSIGN_DOC',
                     'LINK PDF ORIGINAL', 'LINK DOC ASSINADO', 'OBSERVAÇÕES',
                     'VALOR_LIQUIDO', 'TIPO', 'VERBAS', 'BASES', 'PARAMETROS']

// Só estas duas são CRIADAS quando faltam. As outras dez o app já lê por nome
// e sempre estiveram na aba; mexer nelas arriscaria duplicar uma coluna numa
// planilha que grafou o cabeçalho de outro jeito.

// Procura uma coluna sem cabeçalho cujo conteúdo inteiro passe no teste. É
// assim que o histórico já gravado é recuperado em vez de virar coluna nova
// no fim (o que deixaria os valores antigos perdidos para sempre).
function acharColunaOrfa(sheet, hdrs, valida) {
  var vals = sheet.getDataRange().getValues()
  for (var c = 0; c < hdrs.length; c++) {
    if (String(hdrs[c]).trim() !== '') continue
    var bons = 0, ruim = false
    for (var r = 1; r < vals.length && !ruim; r++) {
      var v = vals[r][c]
      if (v === '' || v === null || v === undefined) continue
      if (valida(v)) bons++
      else ruim = true
    }
    if (!ruim && bons > 0) return c
  }
  return -1
}

var TIPOS_FOLHA_VALIDOS = ['FOLHA', 'FERIAS', 'FÉRIAS', 'PONTO', 'EPI']

function garantirColunasFolha() {
  var sheet = getSheet(CONFIG.ABAS.FOLHA)
  if (!sheet) return []
  var ultima = Math.max(1, sheet.getLastColumn())
  var hdrs = sheet.getRange(1, 1, 1, ultima).getValues()[0]
    .map(function (h) { return String(h).trim() })

  // VERBAS é coluna nova, então não tem órfã para adotar — só é criada.
  var orfaDe = {
    'TIPO': function (v) {
      return TIPOS_FOLHA_VALIDOS.indexOf(String(v).trim().toUpperCase()) !== -1
    },
    'VALOR_LIQUIDO': function (v) { return valorNumerico(v) !== '' },
    'VERBAS': null,
    'BASES': null,
    'PARAMETROS': null,
  }

  Object.keys(orfaDe).forEach(function (nome) {
    if (hdrs.indexOf(nome) !== -1) return
    var c = orfaDe[nome] ? acharColunaOrfa(sheet, hdrs, orfaDe[nome]) : -1
    if (c >= 0) {
      sheet.getRange(1, c + 1).setValue(nome)
      hdrs[c] = nome
      Logger.log('Cabeçalho ' + nome + ' recuperado na coluna ' + (c + 1) +
                 ' da aba ' + CONFIG.ABAS.FOLHA)
    } else {
      sheet.getRange(1, hdrs.length + 1).setValue(nome)
      hdrs.push(nome)
      Logger.log('Coluna ' + nome + ' criada na aba ' + CONFIG.ABAS.FOLHA)
    }
  })
  return hdrs
}

// Insere na FOLHA_PAGAMENTO escrevendo por NOME de cabeçalho, nunca por
// posição. Recebe um objeto {'VALOR_LIQUIDO': 3565.07, ...}.
function adicionarLinhaFolha(obj) {
  var hdrs  = garantirColunasFolha()
  var sheet = getSheet(CONFIG.ABAS.FOLHA)
  var linha = [], porNome = {}

  // 1) Pelo NOME do cabeçalho — é assim que a leitura acontece.
  hdrs.forEach(function (h, i) {
    var k = String(h).trim()
    if (Object.prototype.hasOwnProperty.call(obj, k)) { linha[i] = obj[k]; porNome[k] = true }
  })

  // 2) Cabeçalho grafado de outro jeito ('OBS' no lugar de 'OBSERVAÇÕES'):
  //    cai na posição canônica, que é como a aba sempre foi escrita. Não
  //    regride nada e evita criar coluna duplicada.
  COLUNAS_FOLHA.forEach(function (nome, iCanon) {
    if (porNome[nome] || !Object.prototype.hasOwnProperty.call(obj, nome)) return
    if (iCanon < hdrs.length && linha[iCanon] === undefined) linha[iCanon] = obj[nome]
  })

  for (var i = 0; i < hdrs.length; i++) if (linha[i] === undefined) linha[i] = ''
  sheet.appendRow(linha)
  return linha
}

// "R$ 3.565,07", "3.565,07", "3565,07" e 3565.07 viram todos o número 3565.07.
// Grava-se número na planilha, não texto: assim soma, filtra e formata sem
// depender de quem escreveu.
function valorNumerico(v) {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return isNaN(v) ? '' : v
  var s = String(v).replace(/R\$/gi, '').replace(/\s/g, '').trim()
  if (!s) return ''
  if (s.indexOf(',') !== -1) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    var pontos = s.split('.')
    // "3.565" (3 dígitos depois do único ponto) é milhar, não decimal.
    if (pontos.length > 2 || (pontos.length === 2 && pontos[1].length === 3)) {
      s = pontos.join('')
    }
  }
  var n = parseFloat(s)
  return isNaN(n) ? '' : n
}

// ═══════════════════════════════════════════════════════════════════
// VERBAS DO HOLERITE — o que sustenta a análise do histórico
// ═══════════════════════════════════════════════════════════════════
// Cada linha da tabela do holerite (salário base, horas extras,
// periculosidade, INSS...) vira um item. Guardadas em JSON na coluna VERBAS
// da FOLHA_PAGAMENTO, permitem responder "quanto ele fez de hora extra no
// ano" sem reabrir PDF nenhum.

// A descrição vem escrita de um jeito em cada folha ("H.EXTRA 50%",
// "HORAS EXTRAS 50", "HE 50%"). A categoria normaliza isso para agrupar.
var CATEGORIAS_VERBA = [
  { cat: 'HORA_EXTRA',     rotulo: 'Horas extras',      padrao: /(HORAS?|HRS?)[^A-Z]{0,4}EXTRAS?|^HE\b|H\.?\s?EXTRA|EXTRAORDINARIA/ },
  { cat: 'PERICULOSIDADE', rotulo: 'Periculosidade',    padrao: /PERICULOSID|PERIC\b/ },
  { cat: 'INSALUBRIDADE',  rotulo: 'Insalubridade',     padrao: /INSALUBRID|INSALUB\b/ },
  { cat: 'NOTURNO',        rotulo: 'Adicional noturno', padrao: /NOTURN/ },
  { cat: 'DSR',            rotulo: 'DSR',               padrao: /\bDSR\b|DESCANSO SEMANAL|REPOUSO SEMANAL/ },
  { cat: 'DECIMO',         rotulo: '13º salário',       padrao: /13|DECIMO TERCEIRO|GRATIFICACAO NATALINA/ },
  { cat: 'FERIAS',         rotulo: 'Férias',            padrao: /FERIAS|ABONO PECUNIARIO|1\/3 CONSTITUCIONAL|TERCO CONSTITUCIONAL/ },
  { cat: 'PRODUCAO',       rotulo: 'Produção / prêmio', padrao: /PRODUCAO|PRODUTIVID|PREMIO|COMISSAO|BONUS|GRATIFICACAO(?! NATALINA)/ },
  { cat: 'SALARIO',        rotulo: 'Salário base',      padrao: /SALARIO(?!.*FAMILIA)|ORDENADO|VENCIMENTO|DIARIA/ },
  { cat: 'SAL_FAMILIA',    rotulo: 'Salário-família',   padrao: /SALARIO[- ]?FAMILIA/ },
  { cat: 'INSS',           rotulo: 'INSS',              padrao: /\bINSS\b|PREVIDENCIA/ },
  { cat: 'IRRF',           rotulo: 'IRRF',              padrao: /\bIRRF\b|IMPOSTO DE RENDA|\bIR\b/ },
  { cat: 'FGTS',           rotulo: 'FGTS',              padrao: /\bFGTS\b/ },
  { cat: 'VALE',           rotulo: 'Vales e adiantamentos', padrao: /\bVALE\b|ADIANTAMENTO|EMPRESTIMO|CONSIGNADO|FARMACIA|MERCADO/ },
  { cat: 'FALTAS',         rotulo: 'Faltas e atrasos',  padrao: /FALTA|ATRASO|DESCONTO DE DIAS/ },
  { cat: 'CONTRIBUICAO',   rotulo: 'Contribuições',     padrao: /SINDICAL|CONTRIBUICAO|MENSALIDADE|ASSISTENCIAL/ },
]

function semAcento(s) {
  return String(s || '').toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ç/g,'C')
}

function categoriaVerba(descricao) {
  var d = semAcento(descricao)
  // O holerite abrevia com ponto: "I.N.S.S", "D.S.R.", "F.G.T.S". O \b da
  // expressão não casa com isso, e a linha caía em OUTROS — INSS deixava de
  // ser reconhecido como desconto justamente no holerite de verdade.
  d = d.replace(/\b(?:[A-Z]\.){2,}[A-Z]?/g, function (sigla) {
    return sigla.replace(/\./g, '')
  })
  for (var i = 0; i < CATEGORIAS_VERBA.length; i++) {
    if (CATEGORIAS_VERBA[i].padrao.test(d)) return CATEGORIAS_VERBA[i].cat
  }
  return 'OUTROS'
}

// A coluna de referência mistura naturezas: dias (31,00), percentual (30,00)
// e HORAS no formato HH:MM (67:23 = 67h23min). Só o formato com dois-pontos é
// inequívoco, e é justamente o das horas extras.
//
// Ler "67:23" como decimal daria 67,23 — nove minutos a menos por linha, erro
// que se acumula no ano inteiro. Por isso converte só o que tem ':' e deixa o
// resto de fora: melhor não somar do que somar errado.
function horasDaReferencia(ref) {
  var m = String(ref || '').trim().match(/^(\d{1,4}):([0-5]\d)$/)
  if (!m) return null
  return Math.round((parseInt(m[1], 10) + parseInt(m[2], 10) / 60) * 100) / 100
}

function rotuloCategoria(cat) {
  for (var i = 0; i < CATEGORIAS_VERBA.length; i++) {
    if (CATEGORIAS_VERBA[i].cat === cat) return CATEGORIAS_VERBA[i].rotulo
  }
  return 'Outros'
}

// Descontos que a IA marcou como provento (ou vice-versa) bagunçariam o
// total. Categorias sabidamente de desconto mandam mais que o palpite dela.
var CATS_DESCONTO = ['INSS','IRRF','VALE','FALTAS','CONTRIBUICAO']

function normalizarVerbas(lista) {
  if (!lista || !lista.length) return []
  var saida = []
  for (var i = 0; i < lista.length; i++) {
    var v = lista[i] || {}
    var valor = valorNumerico(v.valor)
    var desc  = String(v.descricao || '').trim()
    if (valor === '' || valor === 0 || !desc) continue
    var cat  = categoriaVerba(desc)
    var tipo = String(v.tipo || '').toLowerCase() === 'desconto' ? 'desconto' : 'provento'
    if (CATS_DESCONTO.indexOf(cat) !== -1) tipo = 'desconto'
    var item = {
      codigo:    v.codigo ? String(v.codigo).trim() : '',
      descricao: desc,
      referencia: v.referencia ? String(v.referencia).trim() : '',
      valor:     Math.abs(valor),
      tipo:      tipo,
      categoria: cat,
    }
    var horas = horasDaReferencia(item.referencia)
    if (horas !== null) item.horas = horas
    saida.push(item)
  }
  return saida
}

// Bases e FGTS que o holerite imprime no rodapé. São as únicas parcelas de
// custo patronal que vêm do próprio documento — o resto depende de alíquota
// configurada. Campo ausente fica ausente: não se inventa base.
var CAMPOS_BASE = ['base_inss', 'base_fgts', 'fgts_mes', 'base_irrf',
                   'salario_base', 'dias_trabalhados', 'horas_trabalhadas', 'faixa_irrf']

function normalizarBases(obj) {
  if (!obj) return null
  var saida = {}, achou = false
  CAMPOS_BASE.forEach(function (k) {
    var n = valorNumerico(obj[k])
    if (n !== '' && n > 0) { saida[k] = n; achou = true }
  })
  return achou ? saida : null
}

// Identificação e classificação do documento. Texto, não número — e o que
// mais importa aqui é o tipo_folha: sem ele, um holerite de 13º entra na
// média mensal como se fosse um mês comum e distorce todo o custo.
var CAMPOS_PARAM = ['cei_cnpj', 'centro_custo', 'cbo', 'departamento', 'filial',
                    'matricula', 'admissao', 'categoria', 'tipo_folha']

function normalizarParametros(obj) {
  if (!obj) return null
  var saida = {}, achou = false
  CAMPOS_PARAM.forEach(function (k) {
    var v = String(obj[k] == null ? '' : obj[k]).trim()
    if (v && v.toLowerCase() !== 'null') { saida[k] = v; achou = true }
  })
  return achou ? saida : null
}

function parametrosParaCelula(p) { return p ? JSON.stringify(p) : '' }

function parametrosDaCelula(texto) {
  var t = String(texto || '').trim()
  if (!t) return null
  try {
    var p = JSON.parse(t)
    return p && Object.keys(p).length ? p : null
  } catch (e) { return null }
}

function basesParaCelula(bases) {
  return bases ? JSON.stringify(bases) : ''
}

function basesDaCelula(texto) {
  var t = String(texto || '').trim()
  if (!t) return null
  try {
    var b = JSON.parse(t)
    return b && Object.keys(b).length ? b : null
  } catch (e) { return null }
}

function verbasParaCelula(verbas) {
  return verbas && verbas.length ? JSON.stringify(verbas) : ''
}

function verbasDaCelula(texto) {
  var t = String(texto || '').trim()
  if (!t) return []
  try {
    var v = JSON.parse(t)
    return v && v.length ? v : []
  } catch (e) { return [] }
}

// Histórico da folha de um funcionário, já somado por competência e por
// categoria de verba. É a resposta para "quanto ele fez de hora extra".
function historicoFolha(dados) {
  var funcId = String(dados && dados.func_id || '').trim()
  if (!funcId) throw new Error('Funcionário não informado')
  var ano = dados.ano ? String(dados.ano).trim() : ''

  var func = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
    .find(function (f) { return String(f['ID']) === funcId })

  // Todas as folhas dele, sem filtro de ano: é daqui que sai a lista de anos
  // disponíveis. Calcular os anos DEPOIS do filtro daria lista vazia
  // justamente quando ela importa — quando o ano escolhido não tem nada.
  var todas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA).filter(function (f) {
    if (String(f['ID FUNC.']).trim() !== funcId) return false
    var tipo = String(f['TIPO'] || 'Folha')
    return tipo !== 'Ponto' && tipo !== 'EPI'
  })

  var anos = {}
  todas.forEach(function (f) {
    var a = ordemCompetencia(f['COMPETÊNCIA']).ano
    if (a) anos[a] = (anos[a] || 0) + 1
  })

  var linhas = ano
    ? todas.filter(function (f) { return ordemCompetencia(f['COMPETÊNCIA']).ano === String(ano) })
    : todas

  var meses = [], porCat = {}
  linhas.forEach(function (f) {
    var comp   = String(f['COMPETÊNCIA'] || '').trim()
    var verbas = verbasDaCelula(f['VERBAS'])
    // Célula vazia = nunca passou pela extração. '[]' = passou e não achou
    // nada. Só a primeira merece o convite para reanalisar.
    var naoAnalisado = !String(f['VERBAS'] || '').trim()
    var bases  = basesDaCelula(f['BASES'])
    var param  = parametrosDaCelula(f['PARAMETROS'])
    var ordem  = ordemCompetencia(comp)

    var proventos = 0, descontos = 0
    verbas.forEach(function (v) {
      if (v.tipo === 'desconto') descontos += v.valor
      else proventos += v.valor
      var c = v.categoria || 'OUTROS'
      if (!porCat[c]) porCat[c] = { categoria: c, rotulo: rotuloCategoria(c), tipo: v.tipo,
                                    total: 0, meses: 0, horas: 0 }
      porCat[c].total += v.valor
      if (v.horas) porCat[c].horas += v.horas
    })

    meses.push({
      competencia:   comp,
      ordem:         ordem.chave,
      ano:           ordem.ano,
      tipo:          String(f['TIPO'] || 'Folha'),
      status:        String(f['STATUS'] || ''),
      valor_liquido: valorNumerico(f['VALOR_LIQUIDO']) || 0,
      proventos:     Math.round(proventos * 100) / 100,
      descontos:     Math.round(descontos * 100) / 100,
      link:          String(f['LINK DOC ASSINADO'] || f['LINK PDF ORIGINAL'] || ''),
      verbas:        verbas,
      bases:         bases,
      parametros:    param,
      // "Mensal" é o padrão: folha antiga, extraída antes deste campo existir,
      // é mês comum até prova em contrário.
      tipo_folha:    param && param.tipo_folha ? param.tipo_folha : 'Mensal',
      sem_verbas:    naoAnalisado,
    })
  })

  meses.sort(function (a, b) { return a.ordem - b.ordem })
  // "em quantos meses apareceu" separa o que é fixo do que é eventual
  Object.keys(porCat).forEach(function (c) {
    porCat[c].meses = meses.filter(function (m) {
      return m.verbas.some(function (v) { return (v.categoria || 'OUTROS') === c })
    }).length
    porCat[c].total = Math.round(porCat[c].total * 100) / 100
    porCat[c].horas = Math.round(porCat[c].horas * 100) / 100
  })

  // Quantos meses de cada tipo. Um 13º somado à média mensal como se fosse
  // mês comum inflaria o custo médio de forma invisível.
  var porTipoFolha = {}
  meses.forEach(function (m) {
    porTipoFolha[m.tipo_folha] = (porTipoFolha[m.tipo_folha] || 0) + 1
  })

  // Centro de custo é a dimensão de EQUIPE que vem do próprio documento —
  // mais confiável que a UNIDADE do cadastro, que pode estar desatualizada.
  var centros = {}
  meses.forEach(function (m) {
    var cc = m.parametros && m.parametros.centro_custo
    if (cc) centros[cc] = (centros[cc] || 0) + 1
  })

  var categorias = Object.keys(porCat).map(function (c) { return porCat[c] })
  categorias.sort(function (a, b) { return b.total - a.total })

  // Soma o que o rodapé do holerite informa. Cada campo conta em quantos meses
  // apareceu: um total de FGTS sobre 3 de 12 meses não é o FGTS do ano, e
  // apresentar como se fosse seria pior do que não mostrar.
  var somaBases = {}
  CAMPOS_BASE.forEach(function (k) {
    var comDado = meses.filter(function (m) { return m.bases && m.bases[k] })
    if (!comDado.length) return
    somaBases[k] = {
      total: Math.round(comDado.reduce(function (s2, m) { return s2 + m.bases[k] }, 0) * 100) / 100,
      meses: comDado.length,
    }
  })

  return {
    func_id:    funcId,
    nome:       func ? func['NOME_COMPLETO'] : '',
    funcao:     func ? (func['FUNCAO'] || '') : '',
    // { '2026': 7, '2025': 12 } — permite dizer "não há nada em 2026, mas há
    // 12 folhas em 2025" em vez de só "nenhuma folha registrada"
    anos:       Object.keys(anos).sort().reverse(),
    anos_qtd:   anos,
    total_folhas: todas.length,
    ano_filtro: ano || '',
    meses:      meses,
    categorias: categorias,
    bases:      somaBases,
    tipos_folha: porTipoFolha,
    centros_custo: Object.keys(centros),
    // Só as horas que vieram em HH:MM — as demais referências (dias,
    // percentual) não são horas e ficam de fora de propósito.
    horas_por_categoria: categorias.filter(function (c) { return c.horas > 0 })
      .map(function (c) { return { categoria: c.categoria, rotulo: c.rotulo, horas: c.horas } }),
    meses_com_base: meses.filter(function (m) { return !!m.bases }).length,
    total_liquido:   Math.round(meses.reduce(function (s, m) { return s + m.valor_liquido }, 0) * 100) / 100,
    total_proventos: Math.round(meses.reduce(function (s, m) { return s + m.proventos }, 0) * 100) / 100,
    total_descontos: Math.round(meses.reduce(function (s, m) { return s + m.descontos }, 0) * 100) / 100,
    sem_verbas:      meses.filter(function (m) { return m.sem_verbas }).length,
  }
}

// "Julho/2026" e "07/2026" viram um número ordenável (202607).
function ordemCompetencia(comp) {
  var c = String(comp || '').trim()
  // "2026-07-01T07:00:00.000Z" — lê os números do texto, não pela data: o
  // ISO vem em UTC e converter para o fuso local mudaria o mês na virada.
  var iso = c.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { chave: parseInt(iso[1]) * 100 + parseInt(iso[2]), ano: iso[1] }
  var m = c.match(/^([A-Za-zçÇãÃéÉêÊíÍóÓôÔõÕ]+)\s*\/\s*(\d{4})$/)
  if (m) {
    var i = MESES_ARQ.indexOf(semAcento(m[1]))
    if (i >= 0) return { chave: parseInt(m[2]) * 100 + (i + 1), ano: m[2] }
  }
  var n = c.match(/(\d{1,2})\s*\/\s*(\d{4})/)
  if (n) return { chave: parseInt(n[2]) * 100 + parseInt(n[1]), ano: n[2] }
  var d = c.match(/(\d{4})/)
  return { chave: d ? parseInt(d[1]) * 100 : 0, ano: d ? d[1] : '' }
}

function garantirColunaTipoFolha() {
  return garantirColunasFolha().indexOf('TIPO')
}

function adicionarColunaTipoFolha() {
  garantirColunasFolha()
  return 'OK'
}

// ═══════════════════════════════════════════════════════════════════
// FLUXO DE PAGAMENTO COMPLETO
// ═══════════════════════════════════════════════════════════════════

var ABA_PAGAMENTOS = 'PAGAMENTOS'

function inicializarAbaPagamentos() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  var sheet = ss.getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) {
    sheet = ss.insertSheet(ABA_PAGAMENTOS)
    sheet.appendRow([
      'ID', 'ID_FUNC', 'NOME_FUNC', 'COMPETENCIA', 'VALOR_LIQUIDO',
      'DATA_GERACAO', 'STATUS',
      'WA_LINK_EMPREGADOR', 'MSG_EMPREGADOR',
      'DATA_CONFIRMACAO', 'CANCELADO',
      'DATA_PAGAMENTO', 'COMPROVANTE_FILEID', 'COMPROVANTE_LINK',
      'LINK_HOLERITE', 'TOKEN_CONFIRMACAO'
    ])
    sheet.setFrozenRows(1)
  }
  return 'OK'
}

function salvarNotificacaoPendente(funcId, funcNome, competencia, waLink, mensagem, linkHolerite, valorLiquido) {
  inicializarAbaPagamentos()
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var hoje  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')
  var id    = 'PAG-' + new Date().getTime()

  sheet.appendRow([
    id, funcId, funcNome, String(competencia), valorLiquido || '',
    hoje, 'Aguardando Notificação',
    waLink, mensagem,
    '', '',
    '', '', '',
    linkHolerite, ''
  ])
  return id
}

function listarPagamentos(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  var lista = vals.slice(1).map(function(row) {
    var obj = {}
    hdrs.forEach(function(h, i) { obj[h] = valorDeCelula(row[i]) })
    return obj
  })
  if (dados && dados.func_id) lista = lista.filter(function(r) { return String(r['ID_FUNC']) === String(dados.func_id) })
  if (dados && dados.status)  lista = lista.filter(function(r) { return r['STATUS'] === dados.status })
  return preencherLinkDocumento(lista).reverse()
}

// A coluna LINK_HOLERITE existe desde sempre mas nunca foi gravada. Em vez de
// migrar a planilha, o link é resolvido na leitura, a partir da FOLHA — assim
// vale também para as ordens antigas, sem mexer em nada do que está lá.
//
// Casa primeiro pelo token do documento (REF_DOC), que é exato. Sem ele, cai
// para funcionário + competência, que é o que as ordens antigas têm.
function preencherLinkDocumento(lista) {
  if (!lista.length) return lista
  if (lista.every(function (p) { return String(p['LINK_HOLERITE'] || '').trim() })) return lista

  var folhas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA)
  var porToken = {}, porFuncComp = {}
  folhas.forEach(function (f) {
    var link = String(f['LINK DOC ASSINADO'] || '').trim() || String(f['LINK PDF ORIGINAL'] || '').trim()
    if (!link) return
    var tok = String(f['ZAPSIGN_DOC'] || '').trim()
    if (tok) porToken[tok] = link
    var chave = String(f['ID FUNC.']).trim() + '|' + ordemCompetencia(f['COMPETÊNCIA']).chave
    // O assinado ganha do pendente quando os dois existem para a competência.
    if (!porFuncComp[chave] || String(f['LINK DOC ASSINADO'] || '').trim()) porFuncComp[chave] = link
  })

  lista.forEach(function (p) {
    if (String(p['LINK_HOLERITE'] || '').trim()) return
    var ref = String(p['REF_DOC'] || '').trim()
    if (ref && porToken[ref]) { p['LINK_HOLERITE'] = porToken[ref]; return }
    var chave = String(p['ID_FUNC']).trim() + '|' + ordemCompetencia(p['COMPETENCIA']).chave
    if (porFuncComp[chave]) p['LINK_HOLERITE'] = porFuncComp[chave]
  })
  return lista
}

function confirmarNotificacao(dados, usuario) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var vals  = sheet.getDataRange().getValues()
  var hdrs  = vals[0]
  var idIdx = hdrs.indexOf('ID')

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][idIdx]) === String(dados.id)) {
      var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')

      var valorNum = valorNumerico(dados.valor_liquido)
      if (valorNum !== '') {
        sheet.getRange(i+1, hdrs.indexOf('VALOR_LIQUIDO')+1).setValue(valorNum)
        var msgAtual = String(vals[i][hdrs.indexOf('MSG_EMPREGADOR')] || '')
        var valorFmt = 'R$ ' + Number(valorNum).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
        msgAtual = msgAtual.replace('(consultar holerite)', valorFmt)
                           .replace('(verificar holerite)', valorFmt)
        sheet.getRange(i+1, hdrs.indexOf('MSG_EMPREGADOR')+1).setValue(msgAtual)

        var waLink = String(vals[i][hdrs.indexOf('WA_LINK_EMPREGADOR')] || '')
        var newWaLink = waLink.split('?text=')[0] + '?text=' + encodeURIComponent(msgAtual)
        sheet.getRange(i+1, hdrs.indexOf('WA_LINK_EMPREGADOR')+1).setValue(newWaLink)
      }

      sheet.getRange(i+1, hdrs.indexOf('STATUS')+1).setValue('Notificado')
      var dataNotifIdx = hdrs.indexOf('DATA_CONFIRMACAO')
      if (dataNotifIdx >= 0) sheet.getRange(i+1, dataNotifIdx+1).setValue(hoje)
      logAcao(usuario, 'NOTIFICACAO_ENVIADA', 'ID: ' + dados.id)

      return {
        wa_link: sheet.getRange(i+1, hdrs.indexOf('WA_LINK_EMPREGADOR')+1).getValue(),
        mensagem: sheet.getRange(i+1, hdrs.indexOf('MSG_EMPREGADOR')+1).getValue()
      }
    }
  }
  throw new Error('Pagamento não encontrado: ' + dados.id)
}

function cancelarNotificacao(dados, usuario) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var vals  = sheet.getDataRange().getValues()
  var hdrs  = vals[0]
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][hdrs.indexOf('ID')]) === String(dados.id)) {
      sheet.getRange(i+1, hdrs.indexOf('STATUS')+1).setValue('Cancelado')
      var canceladoIdx = hdrs.indexOf('CANCELADO')
      if (canceladoIdx >= 0) sheet.getRange(i+1, canceladoIdx+1).setValue('Sim')
      logAcao(usuario, 'NOTIFICACAO_CANCELADA', 'ID: ' + dados.id)
      return { ok: true }
    }
  }
  throw new Error('Não encontrado')
}

// ═══════════════════════════════════════════════════════════════════
// FLUXO DE PAGAMENTO — Empregador confirma via link
// ═══════════════════════════════════════════════════════════════════

var GITHUB_PAGES_URL_PAGTO = 'https://favbalanca-ai.github.io/RH--AV-ESP'

function gerarLinkConfirmacaoPagamento(dados, usuario) {
  var func = listarFuncionarios().find(function(f) { return String(f['ID']) === String(dados.func_id) })
  if (!func) throw new Error('Funcionário não encontrado')

  inicializarAbaPagamentos()
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var hoje  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')
  var token = Utilities.getUuid()
  var link  = GITHUB_PAGES_URL_PAGTO + '/pagar.html?t=' + token

  var waTelRaw = String(func['WHATSAPP_EMPREGADOR'] || func['TELEFONE'] || '').replace(/\D/g,'')
  if (waTelRaw.length >= 12 && waTelRaw.substring(0,2) === '55') waTelRaw = waTelRaw.substring(2)

  var mesesNomes2 = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  var compNorm = String(dados.competencia || '')
  if (compNorm.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    var p2 = compNorm.split('/')
    compNorm = mesesNomes2[parseInt(p2[1])-1] + '/' + p2[2]
    dados.competencia = compNorm
  }

  var valorNum = valorNumerico(dados.valor_liquido)
  var valorFmt = valorNum !== ''
    ? 'R$ ' + Number(valorNum).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
    : '(verificar holerite)'

  var linhasPix = []
  if (func['PIX'])     linhasPix.push('PIX: ' + func['PIX'])
  if (func['BANCO'])   linhasPix.push('Banco: ' + func['BANCO'])
  if (func['AGENCIA']) linhasPix.push('Agência: ' + func['AGENCIA'])
  if (func['CONTA'])   linhasPix.push('Conta: ' + func['CONTA'])

  var origemLabel = dados.origem === 'Ferias' ? 'Férias'
                  : dados.origem === 'Ponto'  ? 'Folha de Ponto'
                  : 'Folha de Pagamento'

  var msg = '✅ *Autorização de Pagamento*\n\n' +
    '👤 *Funcionário:* ' + func['NOME_COMPLETO'] + '\n' +
    '💼 *Função:* ' + (func['FUNCAO'] || '') + '\n' +
    '📄 *Referente a:* ' + origemLabel + '\n' +
    '📅 *Competência:* ' + dados.competencia + '\n' +
    '💰 *Valor líquido:* ' + valorFmt + '\n'

  if (linhasPix.length) msg += '\n🏦 *Dados para pagamento:*\n' + linhasPix.join('\n') + '\n'

  msg += '\nApós efetuar o pagamento, confirme pelo link:\n' + link +
    '\n\n_Sistema SST — Fazenda Água Viva_'

  var waLink = waTelRaw ? 'https://wa.me/55' + waTelRaw + '?text=' + encodeURIComponent(msg) : ''

  var id = 'PAG-' + new Date().getTime()
  var compStr = String(dados.competencia || '')
  var mesesStr = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  if (compStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    var pp = compStr.split('/')
    compStr = mesesStr[parseInt(pp[1])-1] + '/' + pp[2]
  }

  sheet.appendRow([
    id, func['ID'], func['NOME_COMPLETO'], compStr, valorNum,
    hoje, 'Aguardando Pagamento',
    waLink, msg,
    '', '',
    '', '', '',
    '', token
  ])

  logAcao(usuario, 'LINK_PAGAMENTO_GERADO', 'Func ' + func['ID'] + ' | ' + dados.competencia + ' | Token: ' + token)
  return { token: token, link: link, wa_link: waLink, mensagem: msg }
}

// ─── ORDEM DE PAGAMENTO A PARTIR DA ASSINATURA ─────────────────────
// Toda folha ou férias assinada vira uma ordem de pagamento na aba
// PAGAMENTOS — que é a mesma fonte do extrato do funcionário.
// ORIGEM diz de onde veio o valor (Folha/Ferias/Ponto) e REF_DOC guarda o
// token do documento assinado, que serve de chave contra duplicidade:
// o webhook do ZapSign e a sincronização manual podem detectar a mesma
// assinatura, e sem isso o funcionário ganharia duas ordens.
function garantirColunasPagamento() {
  inicializarAbaPagamentos()
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) return {}
  var ultima = Math.max(1, sheet.getLastColumn())
  var hdrs   = sheet.getRange(1, 1, 1, ultima).getValues()[0]
  ;['ORIGEM', 'REF_DOC'].forEach(function (nome) {
    if (hdrs.indexOf(nome) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(nome)
      hdrs.push(nome)
      Logger.log('Coluna ' + nome + ' criada na aba ' + ABA_PAGAMENTOS)
    }
  })
  return { origem: hdrs.indexOf('ORIGEM'), refDoc: hdrs.indexOf('REF_DOC') }
}

// Grava ORIGEM/REF_DOC na última linha inserida, pela coluna certa. O
// appendRow das ordens é posicional e não conhece essas colunas novas.
function definirOrigemUltimaOrdem(origem, refDoc) {
  var idx = garantirColunasPagamento()
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var linha = sheet.getLastRow()
  if (idx.origem >= 0) sheet.getRange(linha, idx.origem + 1).setValue(origem || 'Folha')
  if (idx.refDoc >= 0) sheet.getRange(linha, idx.refDoc + 1).setValue(refDoc || '')
}

// Já existe ordem para este documento? Procura pelo token do documento e,
// se ele não estiver disponível, cai para funcionário + competência + origem.
function jaExisteOrdemPagamento(funcId, competencia, origem, refDoc) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) return false
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return false
  var hdrs = vals[0]
  var iFunc = hdrs.indexOf('ID_FUNC'), iComp = hdrs.indexOf('COMPETENCIA')
  var iOrig = hdrs.indexOf('ORIGEM'),  iRef  = hdrs.indexOf('REF_DOC')
  var iCanc = hdrs.indexOf('CANCELADO')
  var alvo  = String(refDoc || '').trim()

  for (var i = 1; i < vals.length; i++) {
    if (iCanc >= 0 && String(vals[i][iCanc]).trim() === 'Sim') continue
    if (alvo && iRef >= 0 && String(vals[i][iRef]).trim() === alvo) return true
    if (!alvo && iFunc >= 0 && iComp >= 0) {
      var mesmaOrigem = iOrig < 0 || String(vals[i][iOrig] || 'Folha') === String(origem || 'Folha')
      if (String(vals[i][iFunc]) === String(funcId) &&
          String(vals[i][iComp]) === String(competencia) && mesmaOrigem) return true
    }
  }
  return false
}

// Ponto único de entrada: chamado pelos três caminhos que detectam uma
// assinatura (webhook, sincronização manual e assinatura própria).
function gerarOrdemDeAssinatura(dados, usuario) {
  var funcId = dados.func_id
  var comp   = String(dados.competencia || '')
  var origem = dados.origem || 'Folha'
  var refDoc = dados.ref_doc || ''
  if (!funcId || !comp) return { ignorado: true, motivo: 'func_id ou competência ausente' }

  garantirColunasPagamento()
  if (jaExisteOrdemPagamento(funcId, comp, origem, refDoc)) {
    return { ignorado: true, motivo: 'ordem já existente' }
  }

  var res = gerarLinkConfirmacaoPagamento({
    func_id:       funcId,
    competencia:   comp,
    valor_liquido: dados.valor_liquido || null,
    origem:        origem,
  }, usuario || 'SISTEMA')

  definirOrigemUltimaOrdem(origem, refDoc)
  logAcao(usuario || 'SISTEMA', 'ORDEM_PAGAMENTO',
    'Func ' + funcId + ' | ' + origem + ' ' + comp + ' | R$ ' + (dados.valor_liquido || '?'))
  return res
}

function buscarPagamento(token) {
  if (!token) throw new Error('Token inválido')
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) throw new Error('Aba PAGAMENTOS não encontrada')

  var vals = sheet.getDataRange().getValues()

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][15]) === String(token)) {
      var row      = vals[i]
      var funcId   = row[1]
      var funcNome = row[2]
      var func     = listarFuncionarios().find(function(f) { return String(f['ID']) === String(funcId) }) || {}

      return {
        token:        token,
        id:           row[0],
        func_id:      funcId,
        nome_func:    funcNome,
        funcao:       func['FUNCAO']   || '',
        competencia:  String(row[3]),
        valor_liquido: (function(v) {
          if (!v) return null
          var s = String(v).trim()
          if (s.indexOf(',') === -1) return parseFloat(s) || null
          return parseFloat(s.replace(/\./g,'').replace(',','.')) || null
        })(row[4]),
        status:       row[6],
        data_pagamento: row[11] || '',
        pix:     func['PIX']     || '',
        banco:   func['BANCO']   || '',
        agencia: func['AGENCIA'] || '',
        conta:   func['CONTA']   || '',
      }
    }
  }
  throw new Error('Pagamento não encontrado')
}

function registrarComprovante(dados) {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  var shPag = ss.getSheetByName('PAGAMENTOS')
  if (!shPag) return { erro: 'Aba PAGAMENTOS não encontrada' }
  var rows  = shPag.getDataRange().getValues()
  var hdrs  = rows[0]
  var iToken = hdrs.indexOf('TOKEN_CONFIRMACAO')
  var iCompFile = hdrs.indexOf('COMPROVANTE_FILEID')
  var iCompLink = hdrs.indexOf('COMPROVANTE_LINK')
  var iIdFunc   = hdrs.indexOf('ID_FUNC')
  var iNomeFunc = hdrs.indexOf('NOME_FUNC')
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][iToken]) === String(dados.token)) {
      var funcId   = rows[r][iIdFunc]
      var funcNome = rows[r][iNomeFunc]
      if (dados.comprovante_base64) {
        var ext      = dados.extensao || 'jpg'
        var nomeArq  = 'Comprovante_' + Utilities.formatDate(new Date(),'America/Sao_Paulo','dd-MM-yyyy') + '.' + ext
        var linkDrive = salvarPdfNoDrive(funcId, funcNome, 'FOLHA_PAGAMENTO', nomeArq, dados.comprovante_base64)
        shPag.getRange(r+1, iCompFile+1).setValue((linkDrive.split('/d/')[1] || '').split('/')[0] || '')
        shPag.getRange(r+1, iCompLink+1).setValue(linkDrive)
      }
      logAcao('EMPREGADOR', 'COMPROVANTE_REGISTRADO', funcNome + ' — via pagar.html')
      return { mensagem: 'Comprovante registrado com sucesso' }
    }
  }
  return { erro: 'Token não encontrado' }
}

function confirmarPagamentoEmpregador(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var vals  = sheet.getDataRange().getValues()
  var hdrs  = vals[0]
  // Por NOME de cabeçalho: é esta gravação que tira a ordem do painel de
  // "aguardando". Escrita por posição, uma coluna a mais na planilha faria
  // o status nunca virar "Pago" e a pendência ficaria eterna.
  var iTok  = hdrs.indexOf('TOKEN_CONFIRMACAO')
  var iSt   = hdrs.indexOf('STATUS')
  var iDtPg = hdrs.indexOf('DATA_PAGAMENTO')
  var iComp = hdrs.indexOf('COMPROVANTE_LINK')
  var iConf = hdrs.indexOf('DATA_CONFIRMACAO')
  if (iTok < 0) iTok = 15

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iTok]) === String(dados.token)) {
      var funcId   = vals[i][hdrs.indexOf('ID_FUNC') >= 0 ? hdrs.indexOf('ID_FUNC') : 1]
      var funcNome = vals[i][hdrs.indexOf('NOME_FUNC') >= 0 ? hdrs.indexOf('NOME_FUNC') : 2]
      var comp     = vals[i][hdrs.indexOf('COMPETENCIA') >= 0 ? hdrs.indexOf('COMPETENCIA') : 3]
      var hoje     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')

      var linkDrive = ''
      try {
        var ext    = dados.extensao || 'jpg'
        var nome   = 'Comprovante_' + String(comp).replace(/\//g,'-') + '_' + (dados.data_pagamento||'').replace(/\//g,'-') + '.' + ext
        linkDrive  = salvarPdfNoDrive(funcId, funcNome, 'FOLHA_PAGAMENTO', nome, dados.comprovante_base64)
      } catch(e) { Logger.log('Erro Drive comprovante: ' + e.message) }

      if (iSt   >= 0) sheet.getRange(i+1, iSt   + 1).setValue('Pago')
      if (iDtPg >= 0) sheet.getRange(i+1, iDtPg + 1).setValue(dados.data_pagamento || hoje.split(' ')[0])
      if (iComp >= 0) sheet.getRange(i+1, iComp + 1).setValue(linkDrive)
      if (iConf >= 0) sheet.getRange(i+1, iConf + 1).setValue(hoje)

      logAcao('EMPREGADOR', 'PAGAMENTO_CONFIRMADO', 'Token: ' + dados.token + ' | Func: ' + funcNome + ' | ' + comp)
      return { ok: true, link_drive: linkDrive }
    }
  }
  throw new Error('Token não encontrado')
}

// Marca a ordem como paga direto do app. Existe porque nem todo pagamento
// passa pelo link: dinheiro, transferência feita na mão, Pix pelo banco.
// Sem isto a ordem ficava "aguardando" para sempre no painel.
function marcarPago(dados, usuario) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  if (!sheet) throw new Error('Aba PAGAMENTOS não encontrada')
  var vals = sheet.getDataRange().getValues()
  var hdrs = vals[0]
  var iId     = hdrs.indexOf('ID')
  var iStatus = hdrs.indexOf('STATUS')
  var iData   = hdrs.indexOf('DATA_PAGAMENTO')
  var iConf   = hdrs.indexOf('DATA_CONFIRMACAO')
  if (iId < 0 || iStatus < 0) throw new Error('Aba PAGAMENTOS sem as colunas ID/STATUS')

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iId]) !== String(dados.id)) continue
    if (String(vals[i][iStatus]) === 'Pago') return { ok: true, ja_estava: true }
    sheet.getRange(i + 1, iStatus + 1).setValue('Pago')
    if (iData >= 0) sheet.getRange(i + 1, iData + 1).setValue(dados.data_pagamento || agora.split(' ')[0])
    if (iConf  >= 0) sheet.getRange(i + 1, iConf  + 1).setValue(agora)
    logAcao(usuario, 'PAGAMENTO_MANUAL', 'ID: ' + dados.id + ' | ' + (vals[i][2] || ''))
    return { ok: true, id: dados.id }
  }
  throw new Error('Ordem de pagamento não encontrada: ' + dados.id)
}

// Reprocessa holerites JÁ enviados para extrair as verbas — sem isto a
// análise só começaria a existir daqui para frente, e o pedido era ver
// TODO o histórico. Lê o PDF que ficou no Drive e passa pela mesma IA.
//
// O Apps Script corta a execução em 6 minutos, então vai em lotes: devolve
// quantos faltam para o app chamar de novo até zerar.
function reanalisarFolhas(dados, usuario) {
  var funcId = dados && dados.func_id ? String(dados.func_id).trim() : ''
  var limite = Math.max(1, Math.min(parseInt(dados && dados.limite) || 4, 10))

  var hdrs  = garantirColunasFolha()
  var sheet = getSheet(CONFIG.ABAS.FOLHA)
  var vals  = sheet.getDataRange().getValues()
  var iFunc = hdrs.indexOf('ID FUNC.')
  var iTipo = hdrs.indexOf('TIPO')
  var iVerb = hdrs.indexOf('VERBAS')
  var iVal  = hdrs.indexOf('VALOR_LIQUIDO')
  var iBase = hdrs.indexOf('BASES')
  var iParam = hdrs.indexOf('PARAMETROS')
  var iOrig = hdrs.indexOf('LINK PDF ORIGINAL')
  var iAss  = hdrs.indexOf('LINK DOC ASSINADO')

  var pendentes = []
  for (var i = 1; i < vals.length; i++) {
    if (funcId && String(vals[i][iFunc]).trim() !== funcId) continue
    var tipo = String(vals[i][iTipo] || 'Folha')
    if (tipo === 'Ponto' || tipo === 'EPI') continue
    if (String(vals[i][iVerb] || '').trim()) continue
    var link = String(vals[i][iAss] || '').trim() || String(vals[i][iOrig] || '').trim()
    if (!link) continue
    pendentes.push({ linha: i + 1, link: link })
  }

  var feitos = 0, erros = []
  var lote = pendentes.slice(0, limite)
  for (var j = 0; j < lote.length; j++) {
    try {
      var id = extrairIdDoDrive(lote[j].link)
      if (!id) throw new Error('link do Drive não reconhecido')
      var b64 = Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes())
      var r   = identificarDocumentoComIA({ pdf_base64: b64 })
      var verbas = normalizarVerbas(r.verbas)
      // Marca SEMPRE, mesmo sem verba nenhuma (PDF escaneado que a IA não
      // leu). Sem marcar, a linha continuava no topo da fila: o app repetia o
      // mesmo lote de 4 PDFs até 30 vezes, pagando a IA em cada volta e nunca
      // chegando nas linhas seguintes. '[]' significa "já analisado, nada
      // encontrado" e é diferente de célula vazia, que é "nunca analisado".
      sheet.getRange(lote[j].linha, iVerb + 1)
        .setValue(verbas.length ? verbasParaCelula(verbas) : '[]')
      var bases = normalizarBases(r.bases)
      if (iBase >= 0 && bases) sheet.getRange(lote[j].linha, iBase + 1).setValue(basesParaCelula(bases))
      var param = normalizarParametros(r.parametros)
      if (iParam >= 0 && param) sheet.getRange(lote[j].linha, iParam + 1).setValue(parametrosParaCelula(param))
      // não sobrescreve um líquido que já estava lá
      if (iVal >= 0 && !String(vals[lote[j].linha - 1][iVal] || '').trim() && r.valor_liquido) {
        sheet.getRange(lote[j].linha, iVal + 1).setValue(valorNumerico(r.valor_liquido))
      }
      feitos++
    } catch (e) {
      erros.push('linha ' + lote[j].linha + ': ' + e.message)
    }
  }

  logAcao(usuario, 'REANALISE_FOLHAS', feitos + ' processada(s), ' + erros.length + ' erro(s)')
  return {
    processados: feitos,
    restantes:   Math.max(0, pendentes.length - lote.length),
    erros:       erros,
  }
}

function liquidarSalario(dados, usuario) {
  return gerarLinkConfirmacaoPagamento(dados, usuario)
}

// ═══════════════════════════════════════════════════════════════════
// FÉRIAS — Calendário + Google Calendar
// ═══════════════════════════════════════════════════════════════════
var ABA_FERIAS = 'FERIAS'

function inicializarAbaFerias() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  if (!ss.getSheetByName(ABA_FERIAS)) {
    var s = ss.insertSheet(ABA_FERIAS)
    s.appendRow(['ID_FUNC','NOME_FUNC','INICIO','FIM','COMPETENCIA','DATA_ENVIO','STATUS','REF_TOKEN','EVENTO_ID'])
    s.setFrozenRows(1)
  }
  return 'OK'
}

// Aceita 'YYYY-MM-DD' ou 'dd/mm/yyyy'
function parseDataFlex(s) {
  if (!s) return null
  s = String(s).trim()
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  var b = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (b) return new Date(parseInt(b[3]), parseInt(b[2]) - 1, parseInt(b[1]))
  var d = new Date(s)
  return isNaN(d) ? null : d
}

// Todos os REF_TOKEN da aba FERIAS, para reconhecer um documento de férias
// mesmo quando a coluna TIPO da FOLHA_PAGAMENTO está vazia (linhas antigas).
function tokensDeFerias() {
  var mapa = {}
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  if (!sheet) return mapa
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return mapa
  var iTok = vals[0].indexOf('REF_TOKEN')
  if (iTok < 0) return mapa
  for (var i = 1; i < vals.length; i++) {
    var t = String(vals[i][iTok] || '').trim()
    if (t) mapa[t] = true
  }
  return mapa
}

// Tipo do documento de uma linha da FOLHA_PAGAMENTO. A coluna TIPO é a fonte
// principal; quando ela falta ou está vazia, o token da aba FERIAS decide —
// é o que impede um recibo de férias de ser arquivado como folha de pagamento.
function tipoDaFolha(folha, token, feriasTokens) {
  var t = String((folha && folha['TIPO']) || '').trim()
  if (t) return t
  var tk = String(token || (folha && folha['ZAPSIGN_DOC']) || '').trim()
  if (tk && (feriasTokens || tokensDeFerias())[tk]) return 'Ferias'
  return 'Folha'
}

function subpastaDoTipo(tipo) {
  return tipo === 'Ferias' ? 'FERIAS' : tipo === 'EPI' ? 'EPI_RECIBOS' : 'FOLHA_PAGAMENTO'
}

function extrairIdDoDrive(url) {
  var m = String(url || '').match(/[-\w]{25,}/)
  return m ? m[0] : ''
}

// Conserta o que já foi arquivado errado: percorre a FOLHA_PAGAMENTO, acha as
// linhas que são de férias (pela aba FERIAS), preenche a coluna TIPO e move o
// PDF assinado da pasta FOLHA_PAGAMENTO para a pasta FERIAS do funcionário.
// Idempotente — rodar de novo não duplica nada.
function corrigirArquivamentoFerias() {
  var iTipo = garantirColunaTipoFolha()
  var sheet = getSheet(CONFIG.ABAS.FOLHA)
  if (!sheet) return { ok: false, erro: 'Aba ' + CONFIG.ABAS.FOLHA + ' não encontrada' }

  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return { ok: true, marcados: 0, movidos: 0, erros: [] }

  var hdrs   = vals[0]
  var iTok   = hdrs.indexOf('ZAPSIGN_DOC')
  var iLink  = hdrs.indexOf('LINK DOC ASSINADO')
  var iFunc  = hdrs.indexOf('ID FUNC.')
  var iNome  = hdrs.indexOf('FUNCIONÁRIO')
  var feriasTokens = tokensDeFerias()
  var marcados = 0, movidos = 0, erros = []

  // Índice cru (sem lerAbaComoObjetos) para o número da linha bater com a planilha
  for (var i = 1; i < vals.length; i++) {
    var token = iTok  >= 0 ? String(vals[i][iTok]  || '').trim() : ''
    var tipoAtual = iTipo >= 0 ? String(vals[i][iTipo] || '').trim() : ''
    if (!token) continue
    if (tipoAtual && tipoAtual !== 'Ferias') continue           // já classificado como outra coisa
    if (!tipoAtual && !feriasTokens[token]) continue            // sem TIPO e não é férias

    // 1) preenche a coluna TIPO nas linhas antigas
    if (!tipoAtual && iTipo >= 0) {
      sheet.getRange(i + 1, iTipo + 1).setValue('Ferias')
      marcados++
    }

    // 2) move o PDF assinado para a subpasta FERIAS
    var link = iLink >= 0 ? String(vals[i][iLink] || '').trim() : ''
    if (!link) continue
    try {
      var id = extrairIdDoDrive(link)
      if (!id) continue
      var arq = DriveApp.getFileById(id)
      var pastaFunc = buscarPastaFuncionario(vals[i][iFunc], String(vals[i][iNome] || ''))
      if (!pastaFunc) { erros.push(vals[i][iNome] + ': pasta do funcionário não encontrada'); continue }

      var pais = arq.getParents(), jaCerto = false
      while (pais.hasNext()) { if (pais.next().getName() === 'FERIAS') jaCerto = true }
      if (jaCerto) continue

      var subs = pastaFunc.getFoldersByName('FERIAS')
      arq.moveTo(subs.hasNext() ? subs.next() : pastaFunc.createFolder('FERIAS'))
      movidos++
    } catch (e) { erros.push(String(vals[i][iNome] || '?') + ': ' + e.message) }
  }

  logAcao('SISTEMA', 'CORRIGIR_ARQUIVAMENTO_FERIAS',
    'TIPO preenchido: ' + marcados + ' | PDFs movidos: ' + movidos + ' | Erros: ' + erros.length)
  return { ok: true, marcados: marcados, movidos: movidos, erros: erros }
}

// Registra um período de férias como Pendente (ao enviar a Folha de Férias)
function registrarFeriasPendente(funcId, nome, inicio, fim, competencia, refToken) {
  inicializarAbaFerias()
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  var hoje  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  sheet.appendRow([funcId, nome, inicio || '', fim || '', competencia || '', hoje, 'Pendente', refToken || '', ''])
}

// Marca as férias como Assinadas e cria o evento no Google Calendar
function confirmarFeriasAssinada(refToken) {
  try {
    var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
    if (!sheet) return
    var vals = sheet.getDataRange().getValues()
    var hdrs = vals[0]
    var iTok = hdrs.indexOf('REF_TOKEN'), iStatus = hdrs.indexOf('STATUS'), iEvt = hdrs.indexOf('EVENTO_ID')
    var iNome = hdrs.indexOf('NOME_FUNC'), iIni = hdrs.indexOf('INICIO'), iFim = hdrs.indexOf('FIM')
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][iTok]) === String(refToken) && refToken) {
        if (vals[i][iStatus] === 'Assinado') return
        sheet.getRange(i + 1, iStatus + 1).setValue('Assinado')
        var evtId = ''
        try { evtId = criarEventoFerias(vals[i][iNome], vals[i][iIni], vals[i][iFim]) }
        catch (e) { Logger.log('Erro Google Calendar: ' + e.message) }
        if (iEvt >= 0 && evtId) sheet.getRange(i + 1, iEvt + 1).setValue(evtId)
        return
      }
    }
  } catch (e) { Logger.log('confirmarFeriasAssinada erro: ' + e.message) }
}

// Cria um evento de dia inteiro no Google Calendar para o período de férias
function criarEventoFerias(nome, inicio, fim) {
  var di = parseDataFlex(inicio)
  var df = parseDataFlex(fim || inicio)
  if (!di) return ''
  if (!df) df = di
  var fimExclusivo = new Date(df.getTime())
  fimExclusivo.setDate(fimExclusivo.getDate() + 1) // all-day: fim é exclusivo
  var cal = CalendarApp.getDefaultCalendar()
  var evt = cal.createAllDayEvent('🌴 Férias — ' + nome, di, fimExclusivo, {
    description: 'Período de férias assinado — Sistema SST Fazenda Água Viva'
  })
  return evt.getId()
}

// Lista todos os períodos de férias (para o calendário do app)
function listarFerias() {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  return vals.slice(1).map(function (row) {
    var o = {}
    hdrs.forEach(function (h, i) {
      var v = row[i]
      if (v instanceof Date) v = Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd')
      o[h] = v
    })
    return o
  })
}

// ─── PLANEJAMENTO DE FÉRIAS ────────────────────────────────────────
// Períodos simulados no app viram linhas com STATUS 'Planejado'. Ficam no
// calendário junto com os demais, mas não geram documento nem evento no
// Calendar — viram Pendente de verdade só quando a folha de férias é enviada.
function salvarPlanoFerias(dados, usuario) {
  inicializarAbaFerias()
  var itens = (dados && dados.periodos) || []
  if (!itens.length) throw new Error('Nenhum período informado')

  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  var hoje  = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  var carimbo = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMddHHmmss')
  var funcs = listarFuncionarios()
  var salvos = []

  itens.forEach(function (p, i) {
    var func = funcs.find(function (f) { return String(f['ID']) === String(p.func_id) })
    if (!func) return
    var token = 'PLAN-' + carimbo + '-' + (i + 1)
    sheet.appendRow([
      func['ID'], func['NOME_COMPLETO'], p.inicio || '', p.fim || '',
      p.competencia || '', hoje, 'Planejado', token, '',
    ])
    salvos.push({ func_id: func['ID'], nome: func['NOME_COMPLETO'], ref_token: token })
  })

  logAcao(usuario, 'PLANO_FERIAS', salvos.length + ' período(s) planejado(s)')
  return { salvos: salvos.length, periodos: salvos }
}

// Remove um período do plano. Só apaga linhas 'Planejado': as pendentes e
// assinadas têm documento atrelado e não podem sumir por aqui.
function excluirPlanoFerias(dados, usuario) {
  var refToken = dados && dados.ref_token
  if (!refToken) throw new Error('ref_token não informado')
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  if (!sheet) throw new Error('Aba FERIAS não encontrada')
  var vals = sheet.getDataRange().getValues()
  var hdrs = vals[0]
  var iTok = hdrs.indexOf('REF_TOKEN'), iStatus = hdrs.indexOf('STATUS')
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iTok]) === String(refToken)) {
      if (String(vals[i][iStatus]).trim() !== 'Planejado') {
        throw new Error('Só é possível excluir períodos com status Planejado')
      }
      sheet.deleteRow(i + 1)
      logAcao(usuario, 'PLANO_FERIAS_EXCLUIDO', refToken)
      return { ok: true }
    }
  }
  throw new Error('Período não encontrado')
}

// Ajuste manual do período de férias (edita datas/status pelo REF_TOKEN)
function atualizarFerias(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_FERIAS)
  if (!sheet) throw new Error('Aba FERIAS não encontrada')
  var vals = sheet.getDataRange().getValues()
  var hdrs = vals[0]
  var iTok = hdrs.indexOf('REF_TOKEN'), iIni = hdrs.indexOf('INICIO'), iFim = hdrs.indexOf('FIM')
  var iStatus = hdrs.indexOf('STATUS'), iEvt = hdrs.indexOf('EVENTO_ID'), iNome = hdrs.indexOf('NOME_FUNC')
  for (var i = 1; i < vals.length; i++) {
    if (dados.ref_token && String(vals[i][iTok]) === String(dados.ref_token)) {
      if (dados.inicio !== undefined) sheet.getRange(i + 1, iIni + 1).setValue(dados.inicio || '')
      if (dados.fim !== undefined)    sheet.getRange(i + 1, iFim + 1).setValue(dados.fim || '')
      if (dados.status)               sheet.getRange(i + 1, iStatus + 1).setValue(dados.status)
      var statusAtual = dados.status || vals[i][iStatus]
      var ini = dados.inicio !== undefined ? dados.inicio : vals[i][iIni]
      var fim = dados.fim !== undefined ? dados.fim : vals[i][iFim]
      var evtAtual = iEvt >= 0 ? String(vals[i][iEvt] || '') : ''
      if (statusAtual === 'Assinado' && ini && !evtAtual) {
        try {
          var id = criarEventoFerias(vals[i][iNome], ini, fim)
          if (id && iEvt >= 0) sheet.getRange(i + 1, iEvt + 1).setValue(id)
        } catch (e) { Logger.log('Erro Google Calendar: ' + e.message) }
      }
      return { ok: true }
    }
  }
  throw new Error('Registro de férias não encontrado')
}

// Rodar UMA VEZ: autoriza o acesso ao Google Calendar (cria e apaga um evento teste)
function testarCalendario() {
  var cal = CalendarApp.getDefaultCalendar()
  var hoje = new Date()
  var evt = cal.createAllDayEvent('Teste SST (pode apagar)', hoje, new Date(hoje.getTime() + 86400000))
  Logger.log('Evento de teste criado: ' + evt.getId())
  return 'OK — Google Calendar autorizado'
}

// ─── Log de auditoria para o app ─────────────────────────────────
function listarLog(dados) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('LOG_ACOES')
  if (!sheet) return []
  var vals = sheet.getDataRange().getValues()
  if (vals.length < 2) return []
  var hdrs = vals[0]
  return vals.slice(1).reverse().slice(0, 100).map(function(row) {
    var obj = {}
    hdrs.forEach(function(h, i) { obj[h] = valorDeCelula(row[i]) })
    return obj
  })
}

// ═══════════════════════════════════════════════════════════════════
// TRIGGER: COMPROVANTE VIA EMAIL (time-based a cada 5 min)
// ═══════════════════════════════════════════════════════════════════

function verificarEmailsComprovante() {
  var ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  var shPag   = ss.getSheetByName('PAGAMENTOS')
  var shFunc  = ss.getSheetByName('FUNCIONARIOS')
  if (!shPag || !shFunc) return

  var threads = GmailApp.search('is:unread to:fav.balanca@gmail.com', 0, 20)
  if (!threads.length) return

  var funcRows = shFunc.getDataRange().getValues()
  var funcHdrs = funcRows[0]
  var iEmail   = funcHdrs.indexOf('EMAIL')
  var iWaEmp   = funcHdrs.indexOf('WHATSAPP_EMPREGADOR')
  var iNome    = funcHdrs.indexOf('NOME_COMPLETO')
  var iId      = funcHdrs.indexOf('ID')

  var pagRows  = shPag.getDataRange().getValues()
  var pagHdrs  = pagRows[0]
  var iPagIdFunc     = pagHdrs.indexOf('ID_FUNC')
  var iPagStatus     = pagHdrs.indexOf('STATUS')
  var iPagCompFile   = pagHdrs.indexOf('COMPROVANTE_FILEID')
  var iPagCompLink   = pagHdrs.indexOf('COMPROVANTE_LINK')
  var iPagDataPag    = pagHdrs.indexOf('DATA_PAGAMENTO')

  threads.forEach(function(thread) {
    var msgs = thread.getMessages()
    msgs.forEach(function(msg) {
      if (msg.isUnread()) {
        var remetente = msg.getFrom()
        var emailMatch = remetente.match(/<(.+)>/)
        var emailRem   = emailMatch ? emailMatch[1].toLowerCase() : remetente.toLowerCase()

        var funcId = null, funcNome = null
        for (var i = 1; i < funcRows.length; i++) {
          var empEmail = String(funcRows[i][iEmail] || '').toLowerCase().trim()
          if (empEmail && empEmail === emailRem) {
            funcId   = funcRows[i][iId]
            funcNome = funcRows[i][iNome]
            break
          }
        }

        if (!funcId) {
          var assunto = msg.getSubject().toLowerCase()
          for (var j = 1; j < funcRows.length; j++) {
            var nome = String(funcRows[j][iNome] || '').toLowerCase()
            var id   = String(funcRows[j][iId]   || '')
            if (nome && assunto.indexOf(nome.split(' ')[0]) !== -1) {
              funcId   = funcRows[j][iId]
              funcNome = funcRows[j][iNome]
              break
            }
            if (id && assunto.indexOf('id:' + id) !== -1) {
              funcId   = funcRows[j][iId]
              funcNome = funcRows[j][iNome]
              break
            }
          }
        }

        var anexos = msg.getAttachments()
        if (!anexos.length) { msg.markRead(); return }

        anexos.forEach(function(anexo) {
          var mime = anexo.getContentType()
          if (mime.indexOf('pdf') === -1 && mime.indexOf('image') === -1) return

          var pasta = funcId
            ? (buscarPastaFuncionario(funcId, funcNome) || obterOuCriarPastaRaiz('COMPROVANTES_NAO_IDENTIFICADOS'))
            : obterOuCriarPastaRaiz('COMPROVANTES_NAO_IDENTIFICADOS')

          var nomeArq = 'Comprovante_Email_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd-MM-yyyy_HH-mm') + '_' + anexo.getName()
          var arquivo = pasta.createFile(anexo.copyBlob().setName(nomeArq))
          var linkArq = 'https://drive.google.com/file/d/' + arquivo.getId() + '/view?usp=drivesdk'

          if (funcId) {
            for (var r = 1; r < pagRows.length; r++) {
              if (String(pagRows[r][iPagIdFunc]) === String(funcId) &&
                  pagRows[r][iPagStatus]  === 'Aguardando Pagamento') {
                var rowNum = r + 1
                shPag.getRange(rowNum, iPagStatus    + 1).setValue('Pago')
                shPag.getRange(rowNum, iPagDataPag   + 1).setValue(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy'))
                shPag.getRange(rowNum, iPagCompFile  + 1).setValue(arquivo.getId())
                shPag.getRange(rowNum, iPagCompLink  + 1).setValue(linkArq)
                logAcao('EMAIL', 'EMAIL_COMPROVANTE', funcNome + ' — de ' + emailRem)
                break
              }
            }
          } else {
            logAcao('EMAIL', 'EMAIL_NAO_IDENTIFICADO', 'Comprovante de ' + emailRem + ' — ' + linkArq)
          }
        })

        msg.markRead()
      }
    })
  })
}

function obterOuCriarPastaRaiz(nomePasta) {
  var pastas = DriveApp.getFoldersByName(nomePasta)
  if (pastas.hasNext()) return pastas.next()
  return DriveApp.createFolder(nomePasta)
}

function instalarTriggerEmail() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'verificarEmailsComprovante') {
      ScriptApp.deleteTrigger(t)
    }
  })
  ScriptApp.newTrigger('verificarEmailsComprovante')
    .timeBased()
    .everyMinutes(5)
    .create()
  Logger.log('Trigger instalado — verificando emails a cada 5 min')
}

// ═══════════════════════════════════════════════════════════════════
// CUSTO DE MÃO DE OBRA
// O holerite mostra o que sai do bolso do funcionário. O custo do
// empregador é outra conta: a folha bruta mais a parte patronal mais o
// que ainda não saiu do caixa mas já foi gerado (13º e férias).
// ═══════════════════════════════════════════════════════════════════

// Regime de recolhimento da parte patronal. Produtor rural pode recolher
// sobre a folha ou sobre a comercialização — e em 'Receita' o INSS
// patronal, o RAT e os terceiros NÃO saem da folha. Cobrar os dois seria
// contar o mesmo tributo duas vezes.
var REGIMES_ENCARGO = ['Folha', 'Receita']

// Alíquotas de partida, não verdade fiscal. Ficam na aba ENCARGOS para o
// contador ajustar por empregador; o app mostra qual alíquota gerou qual
// número justamente para essa conferência ser possível.
var ENCARGOS_PADRAO = {
  regime:          'Folha',
  inss_patronal:   20,
  rat:             2,
  terceiros:       2.5,
  fgts:            8,
  provisao_13:     true,
  provisao_ferias: true,
}

var COLUNAS_ENCARGOS = ['EMPREGADOR', 'REGIME', 'INSS_PATRONAL', 'RAT', 'TERCEIROS',
                        'FGTS', 'PROVISAO_13', 'PROVISAO_FERIAS', 'CONFERIDO',
                        'OBSERVAÇÕES']

// Chave de comparação de empregador: o cadastro escreve "Joaquim Gatto" e o
// holerite "JOAQUIM GATTO COSSUL". Sem normalizar, cada grafia vira um
// empregador diferente e o custo aparece dividido.
function chaveEmpregador(nome) {
  return semAcento(String(nome || '')).replace(/[^A-Z0-9]/g, '')
}

function garantirAbaEncargos() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID)
  var sheet = ss.getSheetByName(CONFIG.ABAS.ENCARGOS)
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ABAS.ENCARGOS)
    sheet.appendRow(COLUNAS_ENCARGOS)
    sheet.setFrozenRows(1)
  }
  var hdrs = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h).trim() })
  COLUNAS_ENCARGOS.forEach(function (col) {
    if (hdrs.indexOf(col) < 0) {
      hdrs.push(col)
      sheet.getRange(1, hdrs.length).setValue(col)
    }
  })
  return { sheet: sheet, hdrs: hdrs }
}

// Uma linha por empregador do cadastro, com os padrões — para o contador
// abrir a planilha e corrigir, em vez de precisar adivinhar o formato.
function semearEncargos() {
  var g = garantirAbaEncargos()
  var existentes = {}
  lerAbaComoObjetos(CONFIG.ABAS.ENCARGOS).forEach(function (l) {
    existentes[chaveEmpregador(l['EMPREGADOR'])] = true
  })
  var criados = []
  var vistos = {}
  lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS).forEach(function (f) {
    var emp = String(f['EMPREGADOR'] || '').trim()
    var k = chaveEmpregador(emp)
    if (!emp || !k || vistos[k] || existentes[k]) return
    vistos[k] = true
    var linha = COLUNAS_ENCARGOS.map(function (c) {
      switch (c) {
        case 'EMPREGADOR':      return emp
        case 'REGIME':          return ENCARGOS_PADRAO.regime
        case 'INSS_PATRONAL':   return ENCARGOS_PADRAO.inss_patronal
        case 'RAT':             return ENCARGOS_PADRAO.rat
        case 'TERCEIROS':       return ENCARGOS_PADRAO.terceiros
        case 'FGTS':            return ENCARGOS_PADRAO.fgts
        case 'PROVISAO_13':     return 'SIM'
        case 'PROVISAO_FERIAS': return 'SIM'
        // Nasce NÃO de propósito: a linha existe, mas ninguém confirmou as
        // alíquotas ainda. É o que faz o app avisar em vez de apresentar
        // um palpite como se fosse a conta do contador.
        case 'CONFERIDO':       return 'NAO'
        default:                return 'Alíquotas padrão — confirmar com o contador'
      }
    })
    g.sheet.appendRow(linha)
    criados.push(emp)
  })
  return criados
}

function simNao(v, padrao) {
  var t = semAcento(String(v == null ? '' : v)).trim()
  if (!t) return padrao
  return t !== 'NAO' && t !== 'N' && t !== 'FALSE' && t !== '0'
}

function taxaPercentual(v, padrao) {
  var n = valorNumerico(v)
  return n === '' ? padrao : n
}

// Devolve uma função: dado o nome do empregador, quais alíquotas valem.
// Empregador sem linha na aba usa o padrão e é marcado como tal.
function lerEncargos() {
  var porChave = {}
  var linhas = []
  try { linhas = lerAbaComoObjetos(CONFIG.ABAS.ENCARGOS) } catch (e) { linhas = [] }
  linhas.forEach(function (l) {
    var k = chaveEmpregador(l['EMPREGADOR'])
    if (!k) return
    var regime = String(l['REGIME'] || ENCARGOS_PADRAO.regime).trim()
    if (REGIMES_ENCARGO.indexOf(regime) < 0) regime = ENCARGOS_PADRAO.regime
    porChave[k] = {
      empregador:      String(l['EMPREGADOR'] || '').trim(),
      regime:          regime,
      inss_patronal:   taxaPercentual(l['INSS_PATRONAL'], ENCARGOS_PADRAO.inss_patronal),
      rat:             taxaPercentual(l['RAT'], ENCARGOS_PADRAO.rat),
      terceiros:       taxaPercentual(l['TERCEIROS'], ENCARGOS_PADRAO.terceiros),
      fgts:            taxaPercentual(l['FGTS'], ENCARGOS_PADRAO.fgts),
      provisao_13:     simNao(l['PROVISAO_13'], true),
      provisao_ferias: simNao(l['PROVISAO_FERIAS'], true),
      observacoes:     String(l['OBSERVAÇÕES'] || l['OBSERVACOES'] || '').trim(),
      // Alguém abriu, olhou e disse que está certo. Sem isso, o número é
      // uma estimativa — e o app precisa dizer isso na tela.
      conferido:       simNao(l['CONFERIDO'], false),
      configurado:     true,
    }
  })
  return function (nome) {
    var k = chaveEmpregador(nome)
    if (porChave[k]) return porChave[k]
    var padrao = {}
    Object.keys(ENCARGOS_PADRAO).forEach(function (c) { padrao[c] = ENCARGOS_PADRAO[c] })
    padrao.empregador  = String(nome || '').trim()
    padrao.observacoes = ''
    padrao.conferido   = false
    padrao.configurado = false
    return padrao
  }
}

function salvarEncargos(dados, usuario) {
  var lista = (dados && dados.encargos) || []
  if (!lista.length) throw new Error('Nada para salvar')
  var g = garantirAbaEncargos()
  var vals = g.sheet.getDataRange().getValues()
  var col = function (nome) { return g.hdrs.indexOf(nome) + 1 }

  var salvos = 0
  lista.forEach(function (e) {
    var k = chaveEmpregador(e.empregador)
    if (!k) return
    var linha = -1
    for (var i = 1; i < vals.length; i++) {
      if (chaveEmpregador(vals[i][g.hdrs.indexOf('EMPREGADOR')]) === k) { linha = i + 1; break }
    }
    if (linha < 0) {
      g.sheet.appendRow(COLUNAS_ENCARGOS.map(function (c) {
        return c === 'EMPREGADOR' ? String(e.empregador).trim() : ''
      }))
      linha = g.sheet.getLastRow()
      vals = g.sheet.getDataRange().getValues()
    }
    var regime = String(e.regime || ENCARGOS_PADRAO.regime).trim()
    if (REGIMES_ENCARGO.indexOf(regime) < 0) regime = ENCARGOS_PADRAO.regime
    g.sheet.getRange(linha, col('REGIME')).setValue(regime)
    g.sheet.getRange(linha, col('INSS_PATRONAL')).setValue(taxaPercentual(e.inss_patronal, ENCARGOS_PADRAO.inss_patronal))
    g.sheet.getRange(linha, col('RAT')).setValue(taxaPercentual(e.rat, ENCARGOS_PADRAO.rat))
    g.sheet.getRange(linha, col('TERCEIROS')).setValue(taxaPercentual(e.terceiros, ENCARGOS_PADRAO.terceiros))
    g.sheet.getRange(linha, col('FGTS')).setValue(taxaPercentual(e.fgts, ENCARGOS_PADRAO.fgts))
    g.sheet.getRange(linha, col('PROVISAO_13')).setValue(e.provisao_13 === false ? 'NAO' : 'SIM')
    g.sheet.getRange(linha, col('PROVISAO_FERIAS')).setValue(e.provisao_ferias === false ? 'NAO' : 'SIM')
    g.sheet.getRange(linha, col('CONFERIDO')).setValue(e.conferido ? 'SIM' : 'NAO')
    if (e.observacoes != null) g.sheet.getRange(linha, col('OBSERVAÇÕES')).setValue(String(e.observacoes))
    salvos++
  })

  logAcao(usuario, 'ENCARGOS_SALVOS', lista.map(function (e) { return e.empregador }).join(', '))
  return { salvos: salvos }
}

function listarEncargos() {
  semearEncargos()
  var buscar = lerEncargos()
  var vistos = {}, saida = []
  lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS).forEach(function (f) {
    var emp = String(f['EMPREGADOR'] || '').trim()
    var k = chaveEmpregador(emp)
    if (!emp || !k || vistos[k]) return
    vistos[k] = true
    saida.push(buscar(emp))
  })
  saida.sort(function (a, b) { return a.empregador.localeCompare(b.empregador) })
  return { encargos: saida, padrao: ENCARGOS_PADRAO, regimes: REGIMES_ENCARGO }
}

var UM_DOZE  = 1 / 12          // 13º: um mês a cada doze
var FERIAS_F = (1 / 12) * 4 / 3 // férias: um mês a cada doze, mais o terço

// A conta de uma competência. Recebe a linha já lida (verbas, bases,
// tipo de folha) e as alíquotas do empregador dela.
function custoDaCompetencia(m, enc) {
  var bases = m.bases || {}
  // A base do INSS é o número mais confiável para os encargos: já vem do
  // holerite com as verbas não incidentes fora. Sem ela, os proventos
  // servem de aproximação — e a linha fica marcada como estimada.
  var base = bases.base_inss || 0
  var baseEstimada = false
  if (!base) { base = m.proventos; baseEstimada = true }

  var sobreFolha = enc.regime !== 'Receita'
  var inss = sobreFolha ? base * enc.inss_patronal / 100 : 0
  var rat  = sobreFolha ? base * enc.rat / 100 : 0
  var terc = sobreFolha ? base * enc.terceiros / 100 : 0

  // O FGTS não muda com o regime, e quando o holerite imprime "F.G.T.S do
  // Mês" esse é o valor real recolhido — melhor que qualquer alíquota.
  var fgtsImpresso = !!bases.fgts_mes
  var fgts = fgtsImpresso ? bases.fgts_mes : (bases.base_fgts || base) * enc.fgts / 100

  // Provisão só sobre mês comum. Provisionar 13º em cima do próprio 13º
  // seria criar custo que não existe.
  var mensal = (m.tipo_folha || 'Mensal') === 'Mensal'
  var taxaEnc = (sobreFolha ? (enc.inss_patronal + enc.rat + enc.terceiros) : 0) + enc.fgts
  var prov13 = 0, provFerias = 0
  if (mensal && enc.provisao_13)     prov13     = m.proventos * UM_DOZE  * (1 + taxaEnc / 100)
  if (mensal && enc.provisao_ferias) provFerias = m.proventos * FERIAS_F * (1 + taxaEnc / 100)

  var encargos  = inss + rat + terc + fgts
  var provisoes = prov13 + provFerias
  return {
    base_encargo:  base,
    base_estimada: baseEstimada,
    inss: inss, rat: rat, terceiros: terc, fgts: fgts,
    fgts_impresso: fgtsImpresso,
    encargos: encargos,
    prov_13: prov13, prov_ferias: provFerias, provisoes: provisoes,
    custo_total: m.proventos + encargos + provisoes,
  }
}

function novoBalde(rotulo, extra) {
  var b = {
    rotulo: rotulo, folhas: 0, meses: {}, funcionarios: {},
    proventos: 0, descontos: 0, liquido: 0,
    inss: 0, rat: 0, terceiros: 0, fgts: 0, encargos: 0,
    prov_13: 0, prov_ferias: 0, provisoes: 0, custo_total: 0,
    he_horas: 0, he_valor: 0, faltas: 0,
    fgts_impresso: 0, fgts_estimado: 0, base_estimada: 0, sem_verbas: 0,
  }
  if (extra) Object.keys(extra).forEach(function (k) { b[k] = extra[k] })
  return b
}

function acumularBalde(b, m, c) {
  b.folhas++
  if (m.competencia) b.meses[m.competencia] = true
  if (m.func_id) b.funcionarios[m.func_id] = true
  b.proventos   += m.proventos
  b.descontos   += m.descontos
  b.liquido     += m.valor_liquido
  b.inss        += c.inss
  b.rat         += c.rat
  b.terceiros   += c.terceiros
  b.fgts        += c.fgts
  b.encargos    += c.encargos
  b.prov_13     += c.prov_13
  b.prov_ferias += c.prov_ferias
  b.provisoes   += c.provisoes
  b.custo_total += c.custo_total
  b.he_horas    += m.he_horas
  b.he_valor    += m.he_valor
  b.faltas      += m.faltas
  if (c.fgts_impresso) b.fgts_impresso++; else b.fgts_estimado++
  if (c.base_estimada) b.base_estimada++
  if (m.sem_verbas) b.sem_verbas++
}

function fecharBalde(b) {
  var r2 = function (n) { return Math.round(n * 100) / 100 }
  var saida = {
    rotulo:      b.rotulo,
    folhas:      b.folhas,
    meses:       Object.keys(b.meses).length,
    funcionarios: Object.keys(b.funcionarios).length,
    proventos:   r2(b.proventos),
    descontos:   r2(b.descontos),
    liquido:     r2(b.liquido),
    inss:        r2(b.inss),
    rat:         r2(b.rat),
    terceiros:   r2(b.terceiros),
    fgts:        r2(b.fgts),
    encargos:    r2(b.encargos),
    prov_13:     r2(b.prov_13),
    prov_ferias: r2(b.prov_ferias),
    provisoes:   r2(b.provisoes),
    custo_total: r2(b.custo_total),
    he_horas:    r2(b.he_horas),
    he_valor:    r2(b.he_valor),
    faltas:      r2(b.faltas),
    fgts_impresso: b.fgts_impresso,
    fgts_estimado: b.fgts_estimado,
    base_estimada: b.base_estimada,
    sem_verbas:    b.sem_verbas,
    // Quanto custa cada real de salário bruto. É o número que responde
    // "quanto custa contratar mais um".
    multiplicador: b.proventos ? Math.round(b.custo_total / b.proventos * 1000) / 1000 : 0,
    // A parte da folha que não é salário contratado — o que dá para
    // reduzir sem demitir ninguém.
    he_pct: b.proventos ? Math.round(b.he_valor / b.proventos * 1000) / 10 : 0,
  }
  Object.keys(b).forEach(function (k) {
    if (saida[k] === undefined && k !== 'meses' && k !== 'funcionarios') saida[k] = b[k]
  })
  saida.custo_mes = saida.meses ? r2(b.custo_total / saida.meses) : 0
  return saida
}

// Custo de mão de obra por empregador, com os recortes de equipe.
// Eixo padrão: competência (o custo pertence ao mês em que o trabalho
// aconteceu), não a data do pagamento.
function custoMdo(dados) {
  var d = dados || {}
  var ano = d.ano ? String(d.ano).trim() : ''
  var filtroEmp = d.empregador ? chaveEmpregador(d.empregador) : ''
  var buscarEnc = lerEncargos()

  var funcs = {}
  lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS).forEach(function (f) {
    funcs[String(f['ID']).trim()] = {
      nome:       String(f['NOME_COMPLETO'] || '').trim(),
      empregador: String(f['EMPREGADOR'] || '').trim(),
      unidade:    String(f['UNIDADE'] || '').trim(),
      funcao:     String(f['FUNCAO'] || '').trim(),
      status:     String(f['STATUS'] || '').trim(),
      salario:    valorNumerico(f['SALARIO_BASE']) || 0,
    }
  })

  var todas = lerAbaComoObjetos(CONFIG.ABAS.FOLHA).filter(function (f) {
    var tipo = String(f['TIPO'] || 'Folha')
    return tipo !== 'Ponto' && tipo !== 'EPI'
  })

  var anosQtd = {}
  todas.forEach(function (f) {
    var a = ordemCompetencia(f['COMPETÊNCIA']).ano
    if (a) anosQtd[a] = (anosQtd[a] || 0) + 1
  })

  var porEmp = {}, porFunc = {}, porUnidade = {}, porFuncao = {}, porMes = {}
  var porCategoria = {}, porTipoFolha = {}
  var geral = novoBalde('Total')
  var comEncargo = {}   // alíquotas efetivamente usadas, por empregador
  var usadas = 0, foraDoAno = 0, semFuncionario = 0

  todas.forEach(function (f) {
    var ordem = ordemCompetencia(f['COMPETÊNCIA'])
    if (ano && ordem.ano !== String(ano)) { foraDoAno++; return }

    var funcId = String(f['ID FUNC.'] || '').trim()
    var func = funcs[funcId]
    if (!func) { semFuncionario++; return }
    if (filtroEmp && chaveEmpregador(func.empregador) !== filtroEmp) return

    var verbas = verbasDaCelula(f['VERBAS'])
    var param  = parametrosDaCelula(f['PARAMETROS'])
    var proventos = 0, descontos = 0, heHoras = 0, heValor = 0, faltas = 0

    verbas.forEach(function (v) {
      var cat = v.categoria || 'OUTROS'
      if (v.tipo === 'desconto') descontos += v.valor
      else proventos += v.valor
      if (cat === 'HORA_EXTRA') { heValor += v.valor; heHoras += (v.horas || 0) }
      if (cat === 'FALTAS') faltas += v.valor
      if (!porCategoria[cat]) {
        porCategoria[cat] = { categoria: cat, rotulo: rotuloCategoria(cat),
                              tipo: v.tipo, total: 0, horas: 0, folhas: 0 }
      }
      porCategoria[cat].total += v.valor
      porCategoria[cat].horas += (v.horas || 0)
      porCategoria[cat].folhas++
    })

    var m = {
      func_id:       funcId,
      competencia:   String(f['COMPETÊNCIA'] || '').trim(),
      ordem:         ordem.chave,
      ano:           ordem.ano,
      bases:         basesDaCelula(f['BASES']),
      tipo_folha:    param && param.tipo_folha ? param.tipo_folha : 'Mensal',
      centro_custo:  (param && param.centro_custo) || '',
      valor_liquido: valorNumerico(f['VALOR_LIQUIDO']) || 0,
      proventos:     proventos,
      descontos:     descontos,
      he_horas:      heHoras,
      he_valor:      heValor,
      faltas:        faltas,
      sem_verbas:    !String(f['VERBAS'] || '').trim(),
    }

    // Uma folha sem verba extraída não tem proventos: entra na conta de
    // qualidade, não na de custo. Somá-la como zero faria a média cair
    // sem que ninguém entendesse por quê.
    if (m.sem_verbas && !m.proventos) {
      geral.sem_verbas++
      var ke0 = chaveEmpregador(func.empregador) || 'SEM'
      if (!porEmp[ke0]) porEmp[ke0] = novoBalde(func.empregador || 'Sem empregador')
      porEmp[ke0].sem_verbas++
      return
    }

    var enc = buscarEnc(func.empregador)
    var c = custoDaCompetencia(m, enc)
    usadas++
    porTipoFolha[m.tipo_folha] = (porTipoFolha[m.tipo_folha] || 0) + 1

    var ke = chaveEmpregador(func.empregador) || 'SEM'
    if (!porEmp[ke]) porEmp[ke] = novoBalde(func.empregador || 'Sem empregador')
    comEncargo[ke] = enc
    acumularBalde(porEmp[ke], m, c)

    if (!porFunc[funcId]) {
      porFunc[funcId] = novoBalde(func.nome, {
        func_id: funcId, empregador: func.empregador, unidade: func.unidade,
        funcao: func.funcao, status: func.status, salario_base: func.salario,
      })
    }
    acumularBalde(porFunc[funcId], m, c)

    var un = m.centro_custo || func.unidade || 'Sem unidade'
    if (!porUnidade[un]) porUnidade[un] = novoBalde(un)
    acumularBalde(porUnidade[un], m, c)

    var fn = func.funcao || 'Sem função'
    if (!porFuncao[fn]) porFuncao[fn] = novoBalde(fn)
    acumularBalde(porFuncao[fn], m, c)

    var chaveMes = m.ordem || 0
    if (!porMes[chaveMes]) {
      porMes[chaveMes] = novoBalde(m.competencia, { ordem: chaveMes, ano: m.ano })
    }
    acumularBalde(porMes[chaveMes], m, c)

    acumularBalde(geral, m, c)
  })

  var lista = function (mapa) {
    return Object.keys(mapa).map(function (k) { return fecharBalde(mapa[k]) })
      .sort(function (a, b) { return b.custo_total - a.custo_total })
  }

  // Empregador cujas folhas do período são todas não analisadas não tem
  // custo a mostrar — um bloco de R$ 0,00 e multiplicador 0,00× pareceria
  // um defeito. O aviso de qualidade já conta essas folhas.
  var empregadores = Object.keys(porEmp).filter(function (k) {
    return porEmp[k].folhas > 0
  }).map(function (k) {
    var b = fecharBalde(porEmp[k])
    var e = comEncargo[k] || buscarEnc(porEmp[k].rotulo)
    b.regime      = e.regime
    b.aliquotas   = { inss_patronal: e.inss_patronal, rat: e.rat,
                      terceiros: e.terceiros, fgts: e.fgts }
    b.configurado = e.configurado
    b.conferido   = e.conferido
    b.provisao_13 = e.provisao_13
    b.provisao_ferias = e.provisao_ferias
    return b
  }).sort(function (a, b) { return b.custo_total - a.custo_total })

  var pessoas = lista(porFunc)
  var meses = Object.keys(porMes).map(function (k) { return fecharBalde(porMes[k]) })
    .sort(function (a, b) { return a.ordem - b.ordem })

  // Concentração de hora extra: quantos por cento do total estão em quantas
  // pessoas. Muita hora extra em pouca gente é dimensionamento errado — e
  // risco trabalhista, não só custo.
  var comHe = pessoas.filter(function (p) { return p.he_valor > 0 })
    .sort(function (a, b) { return b.he_valor - a.he_valor })
  var totalHe = comHe.reduce(function (s, p) { return s + p.he_valor }, 0)
  var fatia = function (n) {
    if (!totalHe) return 0
    var soma = comHe.slice(0, n).reduce(function (s, p) { return s + p.he_valor }, 0)
    return Math.round(soma / totalHe * 1000) / 10
  }

  var categorias = Object.keys(porCategoria).map(function (k) {
    var c = porCategoria[k]
    c.total = Math.round(c.total * 100) / 100
    c.horas = Math.round(c.horas * 100) / 100
    return c
  }).sort(function (a, b) { return b.total - a.total })

  return {
    ano_filtro:   ano,
    anos:         Object.keys(anosQtd).sort().reverse(),
    anos_qtd:     anosQtd,
    empregador_filtro: d.empregador || '',
    total:        fecharBalde(geral),
    // Se o período já contém um 13º ou umas férias pagos, esse valor está
    // na folha bruta E foi provisionado nos meses anteriores. A tela precisa
    // dizer isso — senão o total soma a mesma coisa duas vezes em silêncio.
    tipos_folha:  porTipoFolha,
    empregadores: empregadores,
    funcionarios: pessoas,
    unidades:     lista(porUnidade),
    funcoes:      lista(porFuncao),
    meses:        meses,
    categorias:   categorias,
    concentracao_he: {
      total:   Math.round(totalHe * 100) / 100,
      pessoas: comHe.length,
      top3:    fatia(3),
      top5:    fatia(5),
      maiores: comHe.slice(0, 5).map(function (p) {
        return { nome: p.rotulo, valor: p.he_valor, horas: p.he_horas }
      }),
    },
    // Sem isto o usuário não tem como saber se o número é sólido ou se
    // metade das folhas ficou de fora da conta.
    qualidade: {
      folhas_no_periodo: usadas + geral.sem_verbas,
      calculadas:        usadas,
      sem_verbas:        geral.sem_verbas,
      base_estimada:     geral.base_estimada,
      fgts_impresso:     geral.fgts_impresso,
      fgts_estimado:     geral.fgts_estimado,
      sem_funcionario:   semFuncionario,
      fora_do_ano:       foraDoAno,
    },
  }
}
