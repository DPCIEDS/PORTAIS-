/**
 * ===================================================================
 * AUTOMAÇÃO DE FÉRIAS — Integração com o Autentique
 * ===================================================================
 * Planilha: "Previsão Férias 2026"
 *
 * COLE ESTE CÓDIGO COMO UM NOVO ARQUIVO dentro do mesmo projeto de
 * Apps Script (Extensões > Apps Script > "+" ao lado de Arquivos >
 * Script > nomeie como "AutentiqueFerias").
 *
 * O QUE FAZ (menu "Automações Férias"):
 *
 *   1) ENVIAR RECIBOS PARA AUTENTIQUE
 *      - Lê os PDFs da pasta de origem no Drive
 *      - Extrai do nome do arquivo: nome, data início e data fim
 *      - Valida contra a planilha (Nome + Agendamento Início + Fim)
 *        com comparação tolerante (acentos, caixa, espaços)
 *      - Envia ao Autentique com 2 signatários: DP + colaborador
 *      - Grava o ID retornado em "ID Autentique" (evita reenvio)
 *
 *   2) ATUALIZAR STATUS E BAIXAR ASSINADOS
 *      - Percorre a planilha buscando SEMPRE pelo "ID Autentique"
 *      - Atualiza "Status Autentique"
 *      - Quando todos assinaram, baixa o PDF assinado para a pasta
 *        de destino, renomeando (sem datas) e evitando duplicados
 *
 * INSTALAÇÃO (uma vez):
 *   1) Gere um token de API no painel do Autentique (Chaves de API).
 *   2) Rode a função "configurarTokenAutentique" UMA VEZ, colando o
 *      token no lugar indicado dentro dela (ou use a caixa de diálogo).
 *   3) Recarregue a planilha para o menu "Automações Férias" aparecer.
 *
 * ATENÇÃO — onOpen:
 *   Se o seu projeto JÁ tem uma função onOpen (ex.: do menu de
 *   Rescisões), NÃO cole a onOpen daqui de novo. Em vez disso,
 *   adicione a linha de menu dentro da sua onOpen existente chamando
 *   "criarMenuFeriasAutentique(SpreadsheetApp.getUi())" — veja o
 *   comentário na função onOpen mais abaixo.
 * ===================================================================
 */

// ==================== CONFIGURAÇÃO ====================
var AUTQ = {
  ABA_DADOS: 'Previsão Férias 2026',
  PRIMEIRA_LINHA_DADOS: 2,

  PASTA_RECIBOS_ID:   '1_OMgm_P2XPszuWiwaumgJSqx4EeIMLEB', // origem (recibos a enviar)
  PASTA_ASSINADOS_ID: '1-Z6KuJPri3Vve8qD2OkRZ5FqB393y346', // destino (assinados baixados)

  EMAIL_DP: 'dp@cieds.org.br',

  ENDPOINT: 'https://api.autentique.com.br/v2/graphql',
  PROP_TOKEN: 'AUTENTIQUE_TOKEN',
  SANDBOX: false, // true = documentos de teste (não gastam créditos)

  FUSO: 'America/Sao_Paulo',

  // Cabeçalhos na planilha (busca tolerante a acento/caixa; aceita variações).
  COL_NOME:   ['Nome'],
  COL_INICIO: ['Agendamento Inicio', 'Agendamento Início'],
  COL_FIM:    ['Agendamento Fim'],
  COL_EMAIL:  ['E-mail', 'Email colaborador', 'Email do colaborador', 'E-mail colaborador', 'Email'],
  COL_CPF:    ['CPF'],

  // Estas duas são criadas automaticamente se não existirem.
  COL_ID_AUTENTIQUE: 'ID Autentique',
  COL_STATUS:        'Status Autentique'
};

// ==================== MENU ====================
function onOpen() {
  // Se você JÁ tem uma onOpen no projeto, apague esta função e
  // apenas chame criarMenuFeriasAutentique(...) dentro da sua onOpen.
  criarMenuFeriasAutentique(SpreadsheetApp.getUi());
}

function criarMenuFeriasAutentique(ui) {
  ui.createMenu('Automações Férias🌴')
    .addItem('1. Enviar Recibos para Autentique', 'enviarRecibosParaAutentique')
    .addItem('2. Atualizar Status e Baixar Assinados', 'atualizarStatusEBaixarAssinados')
    .addToUi();
}

// ==================== TOKEN ====================
function configurarTokenAutentique() {
  // Opção A: cole o token aqui e rode a função uma vez.
  var TOKEN = 'COLE_AQUI_O_SEU_TOKEN_DO_AUTENTIQUE';

  if (!TOKEN || TOKEN.indexOf('COLE_AQUI') === 0) {
    // Opção B: se não colou acima, abre uma caixa para digitar.
    var ui = SpreadsheetApp.getUi();
    var resp = ui.prompt('Token do Autentique',
      'Cole o token de API do Autentique:', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    TOKEN = String(resp.getResponseText() || '').trim();
  }

  if (!TOKEN) throw new Error('Token vazio.');

  PropertiesService.getScriptProperties().setProperty(AUTQ.PROP_TOKEN, TOKEN);
  SpreadsheetApp.getActiveSpreadsheet().toast('Token do Autentique salvo com sucesso.');
}

function _tokenAutentique_() {
  var t = PropertiesService.getScriptProperties().getProperty(AUTQ.PROP_TOKEN);
  if (!t) {
    throw new Error('Token do Autentique não configurado. Rode "configurarTokenAutentique" uma vez.');
  }
  return t;
}

// ==================== HELPERS DE PLANILHA ====================
function _aba_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTQ.ABA_DADOS);
  if (!aba) throw new Error('Aba "' + AUTQ.ABA_DADOS + '" não encontrada.');
  return aba;
}

function _normalizar_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')     // tira pontuação/caracteres especiais
    .replace(/\s+/g, ' ')             // colapsa espaços
    .trim();
}

// Mapa de cabeçalhos normalizados -> índice (1-based).
function _mapaCab_(aba) {
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var mapa = {};
  cab.forEach(function (h, i) { mapa[_normalizar_(h)] = i + 1; });
  return mapa;
}

// Encontra a coluna a partir de uma lista de nomes possíveis.
function _acharCol_(mapa, candidatos) {
  var lista = Array.isArray(candidatos) ? candidatos : [candidatos];
  for (var i = 0; i < lista.length; i++) {
    var idx = mapa[_normalizar_(lista[i])];
    if (idx) return idx;
  }
  return 0;
}

// Garante que uma coluna exista; cria no fim se não existir. Retorna índice.
function _garantirCol_(aba, mapa, nome) {
  var idx = mapa[_normalizar_(nome)];
  if (idx) return idx;
  var nova = aba.getLastColumn() + 1;
  aba.getRange(1, nova).setValue(nome);
  mapa[_normalizar_(nome)] = nova;
  return nova;
}

// Resolve todas as colunas de uma vez (e cria ID/Status se faltarem).
function _colunas_(aba) {
  var mapa = _mapaCab_(aba);

  var c = {
    nome:   _acharCol_(mapa, AUTQ.COL_NOME),
    inicio: _acharCol_(mapa, AUTQ.COL_INICIO),
    fim:    _acharCol_(mapa, AUTQ.COL_FIM),
    email:  _acharCol_(mapa, AUTQ.COL_EMAIL),
    cpf:    _acharCol_(mapa, AUTQ.COL_CPF),
    id:     _garantirCol_(aba, mapa, AUTQ.COL_ID_AUTENTIQUE),
    status: _garantirCol_(aba, mapa, AUTQ.COL_STATUS)
  };

  var faltando = [];
  if (!c.nome)   faltando.push('Nome');
  if (!c.inicio) faltando.push('Agendamento Início');
  if (!c.fim)    faltando.push('Agendamento Fim');
  if (!c.email)  faltando.push('E-mail do colaborador');
  // CPF é opcional (a validação de CPF no Autentique só é aplicada se houver valor).

  if (faltando.length) {
    throw new Error('Não encontrei as colunas: ' + faltando.join(', ') +
      '. Ajuste os nomes em AUTQ.COL_* no topo do script.');
  }

  return c;
}

function _dataParaChave_(valor) {
  // Converte Date OU texto (dd-mm-aaaa / dd/mm/aaaa) para "dd-mm-aaaa".
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, AUTQ.FUSO, 'dd-MM-yyyy');
  }
  var m = String(valor || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return '';
  var d = ('0' + m[1]).slice(-2);
  var mo = ('0' + m[2]).slice(-2);
  var a = m[3].length === 2 ? '20' + m[3] : m[3];
  return d + '-' + mo + '-' + a;
}

// ==================== PARSE DO NOME DO ARQUIVO ====================
// Padrão: RECIBO DE FERIAS - NOME - DD-MM-YYYY - DD-MM-YYYY.pdf
function _parseNomeArquivo_(nomeArq) {
  var re = /^\s*recibo\s+de\s+f[eé]rias\s*-\s*(.+?)\s*-\s*(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})\s*\.pdf\s*$/i;
  var m = String(nomeArq || '').match(re);
  if (!m) return null;
  return { nome: m[1].trim(), inicio: m[2], fim: m[3] };
}

// ==================== ITEM 1: ENVIAR RECIBOS ====================
function enviarRecibosParaAutentique() {
  var logs = [];
  var enviados = 0, pulados = 0, erros = 0;

  try {
    _tokenAutentique_(); // valida cedo

    var aba = _aba_();
    var c = _colunas_(aba);

    var ultLin = aba.getLastRow();
    if (ultLin < AUTQ.PRIMEIRA_LINHA_DADOS) {
      throw new Error('Sem dados na planilha.');
    }

    var nLinhas = ultLin - AUTQ.PRIMEIRA_LINHA_DADOS + 1;
    var dados = aba.getRange(AUTQ.PRIMEIRA_LINHA_DADOS, 1, nLinhas, aba.getLastColumn()).getValues();

    var pasta = DriveApp.getFolderById(AUTQ.PASTA_RECIBOS_ID);
    var arquivos = pasta.getFilesByType(MimeType.PDF);

    while (arquivos.hasNext()) {
      var arq = arquivos.next();
      var nomeArq = arq.getName();

      var info = _parseNomeArquivo_(nomeArq);
      if (!info) {
        erros++;
        logs.push('✗ IGNORADO (nome fora do padrão): ' + nomeArq);
        continue;
      }

      // Procura a ÚNICA linha que casa nome + início + fim.
      var chaveNome = _normalizar_(info.nome);
      var casados = [];
      for (var i = 0; i < dados.length; i++) {
        var row = dados[i];
        if (_normalizar_(row[c.nome - 1]) !== chaveNome) continue;
        if (_dataParaChave_(row[c.inicio - 1]) !== info.inicio) continue;
        if (_dataParaChave_(row[c.fim - 1]) !== info.fim) continue;
        casados.push({ linha: AUTQ.PRIMEIRA_LINHA_DADOS + i, row: row });
      }

      if (casados.length === 0) {
        erros++;
        logs.push('✗ SEM CORRESPONDÊNCIA na planilha: ' + nomeArq +
          ' (nome="' + info.nome + '", ' + info.inicio + ' a ' + info.fim + ')');
        continue;
      }
      if (casados.length > 1) {
        erros++;
        logs.push('✗ AMBÍGUO (' + casados.length + ' linhas casam): ' + nomeArq);
        continue;
      }

      var alvo = casados[0];
      var linha = alvo.linha;
      var row = alvo.row;

      // Já enviado?
      var idExistente = String(row[c.id - 1] || '').trim();
      if (idExistente) {
        pulados++;
        logs.push('• JÁ ENVIADO (ID ' + idExistente + '): ' + info.nome);
        continue;
      }

      var email = String(row[c.email - 1] || '').trim();
      if (email.indexOf('@') === -1) {
        erros++;
        logs.push('✗ E-MAIL do colaborador ausente/ inválido: ' + info.nome);
        continue;
      }
      var cpf = c.cpf ? String(row[c.cpf - 1] || '').replace(/\D/g, '') : '';

      var nomeDoc = 'RECIBO DE FÉRIAS - ' + String(row[c.nome - 1] || info.nome).trim().toUpperCase();

      try {
        var blob = arq.getBlob().setName(nomeArq);
        var idNovo = _autqCriarDocumento_(nomeDoc, blob, email, cpf, String(row[c.nome - 1] || info.nome).trim());

        aba.getRange(linha, c.id).setValue(idNovo);
        aba.getRange(linha, c.status).setValue('Enviado');
        // atualiza cache local para não reenviar se o mesmo colaborador tiver 2 recibos
        row[c.id - 1] = idNovo;

        enviados++;
        logs.push('✓ ENVIADO: ' + info.nome + ' — ID ' + idNovo);
      } catch (errEnvio) {
        erros++;
        logs.push('✗ ERRO ao enviar ' + info.nome + ': ' + (errEnvio.message || errEnvio));
      }
    }

  } catch (err) {
    logs.push('✗ FALHA GERAL: ' + (err.message || err));
  }

  var resumo = 'Envio concluído — ' + enviados + ' enviado(s), ' +
    pulados + ' pulado(s), ' + erros + ' erro(s).';
  logs.forEach(function (l) { console.log(l); });
  console.log(resumo);

  _mostrarResumo_('Enviar Recibos para Autentique', resumo, logs);
}

// Cria o documento no Autentique (multipart/form-data). Retorna o ID.
function _autqCriarDocumento_(nomeDoc, blob, emailColab, cpfColab, nomeColab) {
  var sandbox = AUTQ.SANDBOX ? 'sandbox: true, ' : '';

  var query =
    'mutation CreateDoc($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {' +
      'createDocument(' + sandbox + 'document: $document, signers: $signers, file: $file) {' +
        'id name created_at signatures { public_id name email }' +
      '}' +
    '}';

  // Signatário do colaborador; só inclui configs.cpf se houver CPF.
  var signerColab = { email: emailColab, action: 'SIGN' };
  if (nomeColab) signerColab.name = nomeColab;
  if (cpfColab) signerColab.configs = { cpf: cpfColab };

  var variables = {
    document: { name: nomeDoc },
    signers: [
      { email: AUTQ.EMAIL_DP, action: 'SIGN' }, // 1º signatário: DP
      signerColab                               // 2º signatário: colaborador
    ],
    file: null
  };

  var payload = {
    operations: JSON.stringify({ query: query, variables: variables }),
    map: JSON.stringify({ file: ['variables.file'] }),
    file: blob // vira a parte "file" do multipart
  };

  var resp = UrlFetchApp.fetch(AUTQ.ENDPOINT, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + _tokenAutentique_() },
    payload: payload, // objeto com Blob => UrlFetchApp monta multipart/form-data
    muteHttpExceptions: true
  });

  var json = _parseResposta_(resp);

  if (json.errors && json.errors.length) {
    throw new Error(_erroGraphQL_(json.errors));
  }
  var id = json.data && json.data.createDocument && json.data.createDocument.id;
  if (!id) throw new Error('Resposta sem ID do documento.');
  return id;
}

// ==================== ITEM 2: ATUALIZAR STATUS / BAIXAR ====================
function atualizarStatusEBaixarAssinados() {
  var logs = [];
  var baixados = 0, atualizados = 0, semId = 0, erros = 0;

  try {
    _tokenAutentique_();

    var aba = _aba_();
    var c = _colunas_(aba);

    var ultLin = aba.getLastRow();
    if (ultLin < AUTQ.PRIMEIRA_LINHA_DADOS) throw new Error('Sem dados na planilha.');

    var nLinhas = ultLin - AUTQ.PRIMEIRA_LINHA_DADOS + 1;
    var dados = aba.getRange(AUTQ.PRIMEIRA_LINHA_DADOS, 1, nLinhas, aba.getLastColumn()).getValues();

    var pastaDestino = DriveApp.getFolderById(AUTQ.PASTA_ASSINADOS_ID);

    for (var i = 0; i < dados.length; i++) {
      var linha = AUTQ.PRIMEIRA_LINHA_DADOS + i;
      var row = dados[i];

      var id = String(row[c.id - 1] || '').trim();
      if (!id) { semId++; continue; } // sem ID => ignora (regra do fluxo)

      var nomeColab = String(row[c.nome - 1] || '').trim();

      var doc;
      try {
        doc = _autqBuscarDocumento_(id);
      } catch (errBusca) {
        aba.getRange(linha, c.status).setValue('Erro ao consultar');
        erros++;
        logs.push('✗ ERRO ao consultar ' + nomeColab + ' (ID ' + id + '): ' + (errBusca.message || errBusca));
        continue;
      }

      if (!doc) {
        aba.getRange(linha, c.status).setValue('Documento não encontrado');
        logs.push('✗ NÃO ENCONTRADO: ' + nomeColab + ' (ID ' + id + ')');
        continue;
      }

      var assinaturas = doc.signatures || [];
      var totalSign = assinaturas.length;
      var assinadas = assinaturas.filter(function (s) {
        return s && s.signed && s.signed.created_at;
      }).length;

      var status;
      if (totalSign > 0 && assinadas >= totalSign) {
        status = 'Assinado';
      } else if (assinadas > 0) {
        status = 'Parcialmente assinado';
      } else {
        status = 'Aguardando assinatura';
      }

      aba.getRange(linha, c.status).setValue(status);
      atualizados++;
      logs.push('• ' + nomeColab + ': ' + status + ' (' + assinadas + '/' + totalSign + ')');

      // Download só quando 100% assinado.
      if (status !== 'Assinado') continue;

      var urlAssinado = doc.files && doc.files.signed;
      if (!urlAssinado) {
        logs.push('  ⚠ Assinado, mas sem URL do arquivo assinado ainda: ' + nomeColab);
        continue;
      }

      var nomeFinal = 'RECIBO DE FÉRIAS - ' + nomeColab.toUpperCase() + '.pdf';

      // Evita download duplicado.
      if (pastaDestino.getFilesByName(nomeFinal).hasNext()) {
        logs.push('  • Já existe na pasta de assinados (não baixado de novo): ' + nomeFinal);
        continue;
      }

      try {
        var blobAssinado = _baixarArquivo_(urlAssinado, nomeFinal);
        pastaDestino.createFile(blobAssinado);
        baixados++;
        logs.push('  ⬇ BAIXADO: ' + nomeFinal);
      } catch (errDown) {
        erros++;
        logs.push('  ✗ ERRO ao baixar assinado de ' + nomeColab + ': ' + (errDown.message || errDown));
      }
    }

  } catch (err) {
    logs.push('✗ FALHA GERAL: ' + (err.message || err));
  }

  var resumo = 'Status atualizado — ' + atualizados + ' linha(s), ' +
    baixados + ' baixado(s), ' + semId + ' sem ID (ignorada), ' + erros + ' erro(s).';
  logs.forEach(function (l) { console.log(l); });
  console.log(resumo);

  _mostrarResumo_('Atualizar Status e Baixar Assinados', resumo, logs);
}

// Consulta o documento pelo ID. Retorna null se não existir.
function _autqBuscarDocumento_(id) {
  var query =
    'query Doc($id: UUID!) {' +
      'document(id: $id) {' +
        'id name created_at ' +
        'files { original signed pades } ' +
        'signatures { public_id name email signed { created_at } rejected { created_at } }' +
      '}' +
    '}';

  var resp = UrlFetchApp.fetch(AUTQ.ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + _tokenAutentique_() },
    payload: JSON.stringify({ query: query, variables: { id: id } }),
    muteHttpExceptions: true
  });

  var json = _parseResposta_(resp);

  if (json.errors && json.errors.length) {
    // "not found" costuma vir como erro do GraphQL; tratamos como não encontrado.
    var msg = _erroGraphQL_(json.errors).toLowerCase();
    if (msg.indexOf('not found') > -1 || msg.indexOf('não encontrad') > -1 ||
        msg.indexOf('encontrado') > -1) {
      return null;
    }
    throw new Error(_erroGraphQL_(json.errors));
  }

  return (json.data && json.data.document) ? json.data.document : null;
}

function _baixarArquivo_(url, nomeFinal) {
  var full = /^https?:\/\//i.test(url) ? url : ('https://api.autentique.com.br' + url);
  var resp = UrlFetchApp.fetch(full, {
    headers: { Authorization: 'Bearer ' + _tokenAutentique_() },
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('HTTP ' + resp.getResponseCode() + ' ao baixar o PDF assinado.');
  }
  return resp.getBlob().setName(nomeFinal);
}

// ==================== UTILIDADES DE RESPOSTA ====================
function _parseResposta_(resp) {
  var code = resp.getResponseCode();
  var texto = resp.getContentText();
  var json;
  try {
    json = JSON.parse(texto);
  } catch (e) {
    throw new Error('Resposta não-JSON do Autentique (HTTP ' + code + '): ' +
      texto.slice(0, 300));
  }
  if (code >= 400 && !(json.errors)) {
    throw new Error('HTTP ' + code + ' do Autentique: ' + texto.slice(0, 300));
  }
  return json;
}

function _erroGraphQL_(errors) {
  return errors.map(function (e) { return e.message || JSON.stringify(e); }).join(' | ');
}

function _mostrarResumo_(titulo, resumo, logs) {
  var corpo = resumo + '\n\n' + logs.slice(0, 40).join('\n');
  if (logs.length > 40) corpo += '\n\n… (+' + (logs.length - 40) + ' linhas — veja os Logs de execução)';
  try {
    SpreadsheetApp.getUi().alert(titulo, corpo, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getActiveSpreadsheet().toast(resumo);
  }
}