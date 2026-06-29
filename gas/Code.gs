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
    LOG:            'LOG_ACOES',
  }
}

function doPost(e) {
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
      case 'enviar_folha':                return respOk(enviarFolha(body.dados, usuario))
      case 'listar_folhas':               return respOk(listarFolhas())
      case 'sincronizar':                 return respOk(sincronizarPendentes())
      case 'reenviar_zapsign':            return respOk(reenviarZapSignGAS(body.dados))
      case 'gerar_link_assinatura':       return respOk(gerarLinkAssinatura(body.dados, usuario))
      case 'processar_pagina_proprio':    return respOk(processarPaginaProprio(body.dados, usuario))
      case 'identificar_com_ia':          return respOk(identificarDocumentoComIA(body.dados))

      // Módulo Pagamento — somente ADM
      case 'cadastrar_comissao':          return respOk(cadastrarComissao(body.dados, usuario))
      case 'listar_comissoes':            return respOk(listarComissoes(body.dados))
      case 'registrar_adiantamento':      return respOk(registrarAdiantamento(body.dados, usuario))
      case 'listar_adiantamentos':        return respOk(listarAdiantamentos(body.dados))
      case 'resumo_comissao':             return respOk(resumoComissao(body.dados))
      case 'gerar_autorizacao_pagamento': return respOk(gerarAutorizacaoPagamento(body.dados, usuario))
      case 'listar_autorizacoes':         return respOk(listarAutorizacoes(body.dados))
      case 'gerar_msg_pagamento':         return respOk(gerarMensagemPagamento(body.dados))
      case 'gerar_relatorio_pagamentos': return respOk(gerarRelatorioPagamentos(body.dados))
      case 'liquidar_salario':              return respOk(liquidarSalario(body.dados, usuario))
      case 'listar_log':                 return respOk(listarLog(body.dados))
      case 'listar_pagamentos_func':        return respOk(listarPagamentos(body.dados))
      case 'listar_pagamentos':           return respOk(listarPagamentos(body.dados))
      case 'confirmar_notificacao':       return respOk(confirmarNotificacao(body.dados, usuario))
      case 'cancelar_notificacao':        return respOk(cancelarNotificacao(body.dados, usuario))
      case 'processar_pagina_folha':      return respOk(processarPaginaFolha(body.dados, usuario))
      case 'identificar_funcionario_pdf': return respOk(identificarFuncionarioPdf(body.dados))
      default: return respErro('Ação desconhecida: ' + acao)
    }
  } catch (err) {
    logAcao('SISTEMA', 'ERRO', err.message)
    return respErro('Erro interno: ' + err.message)
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'SST API ativa' }))
    .setMimeType(ContentService.MimeType.JSON)
}

function verificarLogin(usuario, senha) {
  if (!usuario || !senha) return null
  const senhaCorreta = CONFIG.ADM_USERS[usuario.toLowerCase()]
  if (!senhaCorreta || senhaCorreta !== senha) return null
  return usuario
}

function getSheet(nomeAba) {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(nomeAba)
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
      headers.forEach((h, i) => {
        const v = row[i]
        if (v instanceof Date) {
          obj[h] = v.getFullYear() === 1899 ? '' : Utilities.formatDate(v, 'America/Sao_Paulo', 'dd/MM/yyyy')
        } else {
          obj[h] = v ?? ''
        }
      })
      return obj
    })
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
    try { salvarPdfNoDrive(dados.func_id, func['NOME_COMPLETO'], 'EPI_RECIBOS', nomeDoc + '_PENDENTE.pdf', pdfBase64) }
    catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
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

function listarFolhas() { return lerAbaComoObjetos(CONFIG.ABAS.FOLHA).reverse() }

function enviarFolha(dados, usuario) {
  const func = listarFuncionarios().find(f => String(f['ID']) === String(dados.func_id))
  if (!func) throw new Error('Funcionário não encontrado')
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy')
  const pdf = dados.pdf_base64 || gerarCapaFolhaPdf(func, dados.competencia, usuario)
  const nomeDoc = 'Folha_' + dados.competencia.replace(/\//g,'-') + '_' + (func['NOME_CURTO'] || func['NOME_COMPLETO'])
  const zap = enviarParaZapSign(pdf, nomeDoc, func['NOME_COMPLETO'], func['TELEFONE'])
  adicionarLinha(CONFIG.ABAS.FOLHA, [
    dados.func_id,        // A: ID FUNC.
    func['NOME_COMPLETO'],// B: FUNCIONÁRIO
    dados.competencia,    // C: COMPETÊNCIA
    hoje,                 // D: DATA ENVIO
    'Pendente',           // E: STATUS
    '',                   // F: DATA ASSINATURA
    zap.token || '',      // G: ZAPSIGN_DOC
    '',                   // H: LINK PDF ORIGINAL
    '',                   // I: LINK DOC ASSINADO
    'Signer: ' + (zap.signerToken || ''), // J: OBSERVAÇÕES
    dados.valor_liquido || '', // K: VALOR_LIQUIDO
  ])
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
    atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', docToken, { 'ASSINADO?': 'Sim', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
    try {
      const link = salvarPdfNoDrive(entrega['ID FUNC.'], entrega['FUNCIONÁRIO'], 'EPI_RECIBOS', 'Recibo_EPI_' + hoje.replace(/\//g,'-') + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(docToken))
      atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', docToken, { 'LINK DOC ASSINADO': link })
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
      const link = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], 'FOLHA_PAGAMENTO', 'Folha_' + comp + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(docToken))
      atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', docToken, { 'LINK DOC ASSINADO': link })
      // Gera link de confirmação de pagamento para o empregador
      try {
        var funcId2  = folha['ID FUNC.']
        var comp2    = String(folha['COMPETÊNCIA'] || '')
        var valorLiq = folha['VALOR_LIQUIDO'] ? parseFloat(folha['VALOR_LIQUIDO']) : null
        if (funcId2 && comp2) {
          gerarLinkConfirmacaoPagamento({ func_id: funcId2, competencia: comp2, valor_liquido: valorLiq }, 'SISTEMA')
          Logger.log('Link pagamento gerado via ZapSign para func ' + funcId2 + ' | ' + comp2)
        }
      } catch(ePagto) { Logger.log('Erro link pagamento ZapSign: ' + ePagto.message) }
    } catch(e) { logAcao('WEBHOOK', 'DRIVE_OPCIONAL', e.message) }
    logAcao('WEBHOOK', 'ASSINATURA_FOLHA', 'Doc: ' + docToken)
    return { ok: true, tipo: 'folha' }
  }

  logAcao('WEBHOOK', 'NAO_ENCONTRADO', 'Token: ' + docToken)
  return { ignorado: true, motivo: 'Documento não encontrado: ' + docToken }
}

// ─── Envio para ZapSign ──────────────────────────────────────────
// FIX: normaliza telefone (remove o 55 inicial, pois phone_country já é '55'),
// valida DDD+número e expõe o HTTP code no erro.
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
  ;['ASO_EXAMES','EPI_RECIBOS','FOLHA_PAGAMENTO','DOCUMENTOS_ADM'].forEach(s => pasta.createFolder(s))
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
  const destino = subs.hasNext() ? subs.next() : pasta
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

  lerAbaComoObjetos(CONFIG.ABAS.EPI_ENTREGAS)
    .filter(e => (e['ASSINADO?'] === 'Pendente' || e['ASSINADO?'] === '') && e['ZAPSIGN_DOC'])
    .forEach(entrega => {
      verificados++
      const token = String(entrega['ZAPSIGN_DOC']).trim()
      try {
        const status = consultarStatusZapSign(token)
        if (status === 'signed') {
          atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'ASSINADO?': 'Sim', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
          try {
            const link = salvarPdfNoDrive(entrega['ID FUNC.'], entrega['FUNCIONÁRIO'], 'EPI_RECIBOS', 'Recibo_EPI_' + hoje.replace(/\//g,'-') + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
            atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': link })
          } catch(de) {}
          atualizados++
        } else if (status === 'refused') {
          atualizarCelulasPorId(CONFIG.ABAS.EPI_ENTREGAS, 'ZAPSIGN_DOC', token, { 'ASSINADO?': 'Recusado', 'DATA ASSINATURA': hoje })
          atualizados++
        }
      } catch(e) { erros.push('EPI ' + token.substring(0,8) + ': ' + e.message) }
    })

  lerAbaComoObjetos(CONFIG.ABAS.FOLHA)
    .filter(f => (f['STATUS'] === 'Pendente' || f['STATUS'] === '') && f['ZAPSIGN_DOC'])
    .forEach(folha => {
      verificados++
      const token = String(folha['ZAPSIGN_DOC']).trim()
      try {
        const status = consultarStatusZapSign(token)
        if (status === 'signed') {
          atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'STATUS': 'Assinado', 'DATA ASSINATURA': hoje, 'LINK DOC ASSINADO': '' })
          try {
            const comp = String(folha['COMPETÊNCIA'] || 'semdata').replace(/\//g,'-')
            const link = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], 'FOLHA_PAGAMENTO', 'Folha_' + comp + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
            atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'LINK DOC ASSINADO': link })
          } catch(de) {}
          atualizados++
        } else if (status === 'refused') {
          atualizarCelulasPorId(CONFIG.ABAS.FOLHA, 'ZAPSIGN_DOC', token, { 'STATUS': 'Recusado', 'DATA ASSINATURA': hoje })
          atualizados++
        }
      } catch(e) { erros.push('Folha ' + token.substring(0,8) + ': ' + e.message) }
    })

  logAcao('SYNC', 'SINCRONIZACAO', 'Verificados: ' + verificados + ' | Atualizados: ' + atualizados + ' | Erros: ' + erros.length)
  return { verificados, atualizados, pendentes: verificados - atualizados, erros, horario: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss') }
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

  lerAbaComoObjetos(CONFIG.ABAS.FOLHA).forEach(folha => {
    const token = String(folha['ZAPSIGN_DOC'] || '').trim()
    const link  = String(folha['LINK DOC ASSINADO'] || '').trim()
    if (folha['STATUS'] !== 'Assinado' || !token || link) return
    try {
      const comp = String(folha['COMPETÊNCIA'] || 'semdata').replace(/\//g,'-')
      const url = salvarPdfNoDrive(folha['ID FUNC.'], folha['FUNCIONÁRIO'], 'FOLHA_PAGAMENTO', 'Folha_' + comp + '_' + token.substring(0,8) + '_ASSINADO.pdf', baixarPdfAssinadoZapSign(token))
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
  const func = encontrarFuncionarioPorNome(dados.nome_funcionario, funcionarios)
  if (!func) throw new Error('Funcionário não encontrado: ' + dados.nome_funcionario)
  const nomeArq = 'Folha_' + compLimpo + '_' + (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '.pdf'
  let linkDrive = ''
  try { linkDrive = salvarPdfNoDrive(func['ID'], func['NOME_COMPLETO'], 'FOLHA_PAGAMENTO', nomeArq, dados.pdf_base64) }
  catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }
  let zapToken = '', zapSignUrl = '', zapSignerToken = ''
  if (dados.enviar_zapsign) {
    try {
      const zap = enviarParaZapSign(dados.pdf_base64, 'Folha_' + compLimpo + '_' + func['NOME_COMPLETO'].split(' ')[0], func['NOME_COMPLETO'], func['TELEFONE'])
      zapToken = zap.token; zapSignUrl = zap.signUrl; zapSignerToken = zap.signerToken
    } catch(e) { logAcao(usuario, 'ERRO_ZAPSIGN', e.message); throw e }
  }
  adicionarLinha(CONFIG.ABAS.FOLHA, [func['ID'], func['NOME_COMPLETO'], comp, hoje, zapToken ? 'Pendente' : 'Salvo', '', zapToken, linkDrive, '', zapSignerToken ? 'Signer: ' + zapSignerToken : 'Fracionado'])
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
function identificarDocumentoComIA(dados) {
  var pdfBase64 = dados.pdf_base64
  if (!pdfBase64) throw new Error('PDF não fornecido')

  var prompt = 'Analise este holerite/folha de pagamento brasileiro e extraia em JSON puro (sem markdown): nome_funcionario (nome completo do trabalhador, nao do empregador), codigo_funcionario (numero matricula), tipo_documento (Folha para holerite ou contracheque, Ponto para folha de ponto, EPI para recibo EPI), competencia (mes e ano referencia ex: Abril/2026), empregador (razao social ou nome do empregador), valor_liquido (valor liquido a receber pelo funcionario — procure por: Valor Liquido, Liquido, Valor a Receber, Net Pay — retorne apenas o numero decimal ex: 3565.07 sem R$ ou ponto de milhar). Retorne APENAS o JSON sem nenhum texto antes ou depois. Exemplo: {"nome_funcionario":"Joao Silva","codigo_funcionario":"27","tipo_documento":"Folha","competencia":"Abril/2026","empregador":"Fazenda","valor_liquido":3565.07}'

  var payload = {
    model: 'claude-sonnet-4-6', // FIX: 'claude-opus-4-6' não é um ID válido
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [{
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
      }, {
        type: 'text',
        text: prompt
      }]
    }]
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key':         PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY'),
      'anthropic-version': '2023-06-01',
    },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  }

  var res  = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options)
  var data = JSON.parse(res.getContentText())

  if (res.getResponseCode() !== 200) {
    Logger.log('Claude API erro: ' + res.getContentText())
    throw new Error('Erro na IA: ' + (data.error ? data.error.message : res.getContentText()))
  }

  var texto = data.content[0].text.trim()
  Logger.log('IA retornou: ' + texto)

  var resultado
  try {
    texto = texto.replace(/```json/g,'').replace(/```/g,'').trim()
    resultado = JSON.parse(texto)
  } catch(e) {
    Logger.log('Erro parse IA: ' + e.message + ' | texto: ' + texto)
    throw new Error('IA não retornou JSON válido')
  }

  var funcionarios = lerAbaComoObjetos(CONFIG.ABAS.FUNCIONARIOS)
  var func = null

  if (resultado.codigo_funcionario) {
    var cod = parseInt(resultado.codigo_funcionario)
    func = funcionarios.find(function(f) { return parseInt(f['ID']) === cod })
  }

  if (!func && resultado.nome_funcionario) {
    var nomeUpper = resultado.nome_funcionario.toUpperCase()
    func = funcionarios.find(function(f) {
      return f['NOME_COMPLETO'].toUpperCase().indexOf(nomeUpper.split(' ')[0]) !== -1 ||
             nomeUpper.indexOf(f['NOME_COMPLETO'].toUpperCase().split(' ')[0]) !== -1
    })
  }

  return {
    func_id:        func ? func['ID']            : null,
    func_nome:      func ? func['NOME_COMPLETO'] : resultado.nome_funcionario || '',
    func_telefone:  func ? func['TELEFONE']      : '',
    tipo_documento: resultado.tipo_documento     || 'Folha',
    competencia:    resultado.competencia        || '',
    empregador:     resultado.empregador         || '',
    valor_liquido:  resultado.valor_liquido      || null,
    ia_confianca:   func ? 'alto' : 'baixo',
  }
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

// ─── Reenviar link ZapSign para signatário ───────────────────────
function reenviarZapSignGAS(dados) {
  const signerToken = dados.signer_token
  if (!signerToken) throw new Error('signer_token não informado')
  const res = UrlFetchApp.fetch(CONFIG.ZAPSIGN_URL + '/signers/' + signerToken + '/request-signature-reminder/', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + CONFIG.ZAPSIGN_TOKEN },
    muteHttpExceptions: true,
  })
  if (res.getResponseCode() !== 200 && res.getResponseCode() !== 201) {
    throw new Error('ZapSign erro: ' + res.getContentText())
  }
  return { ok: true, mensagem: 'Link reenviado com sucesso' }
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
  } else if (tipo === 'Folha' || tipo === 'Ponto') {
    pdfAssinado = gerarFolhaPdfAssinado(pdfBase64, assinaturaBase64, funcNome, tipo, referencia)
  } else {
    pdfAssinado = adicionarAssinaturaAoPdf(pdfBase64, assinaturaBase64, funcNome)
  }

  let linkDrive = ''
  try {
    const nomeArq = tipo + '_' + String(referencia || '').replace(/\//g,'-') + '_ASSINADO.pdf'
    const subpasta = tipo === 'EPI' ? 'EPI_RECIBOS' : 'FOLHA_PAGAMENTO'
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

  logAcao('SISTEMA', 'ASSINATURA_PROPRIA', 'Token: ' + token + ' | Func: ' + funcNome + ' | Drive: ' + linkDrive)

  // Notificação automática ao empregador com link de confirmação de pagamento
  try {
    if (tipo === 'Folha' || tipo === 'Ponto') {
      var valorLiquidoDoc = rowData[16] ? parseFloat(rowData[16]) : null
      gerarLinkConfirmacaoPagamento({
        func_id:       funcId,
        competencia:   String(referencia),
        valor_liquido: valorLiquidoDoc,
      }, 'SISTEMA')
    }
  } catch(eNotif) { Logger.log('Erro notif pagamento: ' + eNotif.message) }

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
  var subpasta = 'FOLHA_PAGAMENTO'
  var nomeArq  = tipo + '_' + compLimpo + '_' + (func['NOME_CURTO'] || func['NOME_COMPLETO'].split(' ')[0]) + '_PENDENTE.pdf'

  var linkDrive = ''
  try {
    linkDrive = salvarPdfNoDrive(func['ID'], func['NOME_COMPLETO'], subpasta, nomeArq, dados.pdf_base64)
  } catch(e) { logAcao(usuario, 'ERRO_DRIVE', e.message) }

  adicionarLinha(CONFIG.ABAS.FOLHA, [
    func['ID'],           // A: ID FUNC.
    func['NOME_COMPLETO'],// B: FUNCIONÁRIO
    comp,                 // C: COMPETÊNCIA
    hoje,                 // D: DATA ENVIO
    'Aguardando Assinatura', // E: STATUS
    '',                   // F: DATA ASSINATURA
    '',                   // G: ZAPSIGN_DOC
    linkDrive,            // H: LINK PDF ORIGINAL
    '',                   // I: LINK DOC ASSINADO
    'Assinatura Própria — ' + tipo, // J: OBSERVAÇÕES
    dados.valor_liquido || '', // K: VALOR_LIQUIDO
  ])

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
  var tipoLabel = tipo === 'Ponto' ? 'Folha de Ponto' : 'Folha de Pagamento'

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
    hdrs.forEach(function(h, i) { obj[h] = row[i] })
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
    hdrs.forEach(function(h, i) { obj[h] = row[i] })
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
    hdrs.forEach(function(h, i) { obj[h] = row[i] })
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

    function normalizarValor(v) {
      if (!v) return ''
      var s = String(v).trim()
      s = s.replace(/R\$\s*/g, '').trim()
      if (s.indexOf(',') === -1 && s.indexOf('.') !== -1) return s
      if (s.indexOf(',') !== -1) return s.replace(/\./g,'').replace(',','.')
      return s
    }
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
    hdrs.forEach(function(h, i) { obj[h] = row[i] })
    return obj
  })
  if (dados && dados.func_id) lista = lista.filter(function(r) { return String(r['ID_FUNC']) === String(dados.func_id) })
  if (dados && dados.status)  lista = lista.filter(function(r) { return r['STATUS'] === dados.status })
  return lista.reverse()
}

function confirmarNotificacao(dados, usuario) {
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(ABA_PAGAMENTOS)
  var vals  = sheet.getDataRange().getValues()
  var hdrs  = vals[0]
  var idIdx = hdrs.indexOf('ID')

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][idIdx]) === String(dados.id)) {
      var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')

      if (dados.valor_liquido) {
        sheet.getRange(i+1, hdrs.indexOf('VALOR_LIQUIDO')+1).setValue(dados.valor_liquido)
        var msgAtual = String(vals[i][hdrs.indexOf('MSG_EMPREGADOR')] || '')
        var valorFmt = 'R$ ' + parseFloat(dados.valor_liquido).toLocaleString('pt-BR', {minimumFractionDigits:2})
        msgAtual = msgAtual.replace('(consultar holerite)', valorFmt)
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

  var valorFmt = dados.valor_liquido
    ? 'R$ ' + parseFloat(dados.valor_liquido).toLocaleString('pt-BR', {minimumFractionDigits:2})
    : '(verificar holerite)'

  var linhasPix = []
  if (func['PIX'])     linhasPix.push('PIX: ' + func['PIX'])
  if (func['BANCO'])   linhasPix.push('Banco: ' + func['BANCO'])
  if (func['AGENCIA']) linhasPix.push('Agência: ' + func['AGENCIA'])
  if (func['CONTA'])   linhasPix.push('Conta: ' + func['CONTA'])

  var msg = '✅ *Autorização de Pagamento*\n\n' +
    '👤 *Funcionário:* ' + func['NOME_COMPLETO'] + '\n' +
    '💼 *Função:* ' + (func['FUNCAO'] || '') + '\n' +
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
    id, func['ID'], func['NOME_COMPLETO'], compStr, dados.valor_liquido || '',
    hoje, 'Aguardando Pagamento',
    waLink, msg,
    '', '',
    '', '', '',
    '', token
  ])

  logAcao(usuario, 'LINK_PAGAMENTO_GERADO', 'Func ' + func['ID'] + ' | ' + dados.competencia + ' | Token: ' + token)
  return { token: token, link: link, wa_link: waLink, mensagem: msg }
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

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][15]) === String(dados.token)) {
      var funcId   = vals[i][1]
      var funcNome = vals[i][2]
      var comp     = vals[i][3]
      var hoje     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')

      var linkDrive = ''
      try {
        var ext    = dados.extensao || 'jpg'
        var nome   = 'Comprovante_' + String(comp).replace(/\//g,'-') + '_' + (dados.data_pagamento||'').replace(/\//g,'-') + '.' + ext
        linkDrive  = salvarPdfNoDrive(funcId, funcNome, 'FOLHA_PAGAMENTO', nome, dados.comprovante_base64)
      } catch(e) { Logger.log('Erro Drive comprovante: ' + e.message) }

      sheet.getRange(i+1, 7).setValue('Pago')
      sheet.getRange(i+1, 12).setValue(dados.data_pagamento || hoje.split(' ')[0])
      sheet.getRange(i+1, 14).setValue(linkDrive)
      sheet.getRange(i+1, 10).setValue(hoje)

      logAcao('EMPREGADOR', 'PAGAMENTO_CONFIRMADO', 'Token: ' + dados.token + ' | Func: ' + funcNome + ' | ' + comp)
      return { ok: true, link_drive: linkDrive }
    }
  }
  throw new Error('Token não encontrado')
}

function liquidarSalario(dados, usuario) {
  return gerarLinkConfirmacaoPagamento(dados, usuario)
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
    hdrs.forEach(function(h, i) { obj[h] = row[i] })
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
