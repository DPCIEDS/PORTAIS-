/**
 * ===================================================================
 * GERENCIAMENTO DE FÉRIAS — Solicitação, Aprovação/Recusa e Gatilhos
 * ===================================================================
 * Planilha: "Previsão Férias 2026"
 *
 * ESTE ARQUIVO É COMPLEMENTAR ao SplitFeriasAutomatico.gs — não o
 * substitui. Cole este código como um NOVO ARQUIVO dentro do mesmo
 * projeto de Apps Script (Extensões > Apps Script > ícone "+" ao lado
 * de "Arquivos" > Script > dê o nome "GerenciamentoFerias").
 *
 * O QUE ESTE SCRIPT FAZ:
 *
 * 1) SOLICITAÇÃO DO GESTOR
 *    Quando o AppSheet grava a data em "Solicitado pelo Gestor":
 *      - E-mail ao gestor confirmando o recebimento (retorno em 15 dias)
 *      - E-mail a ferias@cieds.org.br avisando de nova solicitação
 *
 * 2) APROVAÇÃO / RECUSA PELO DP (marcado direto na planilha)
 *      - "Aprovado DP" = Sim  → e-mail ao gestor confirmando as férias
 *      - "Aprovado DP" = Não + "Motivo Recusa" preenchido →
 *           e-mail ao gestor com o motivo, linha é ARQUIVADA na aba
 *           "Arquivo - Recusadas" e uma NOVA LINHA em branco (mesmo
 *           colaborador, sem agendamento) é criada para reiniciar o ciclo
 *
 * 3) GATILHO — AGENDADA MAS SEM ALTERDATA (20 dias antes do início)
 *      Alerta para ferias@cieds.org.br
 *
 * 4) GATILHO — E-MAIL DE JANELA TRIMESTRAL (60 dias antes do trimestre)
 *      Consolida por gestor os pendentes de agendamento, com destaque
 *      para quem está com prazo apertado ("Compulsória" no mês da janela)
 *
 * 5) GATILHO — LEMBRETE (7 dias sem resposta do gestor)
 *      Responde na MESMA THREAD do e-mail de janela, uma única vez
 *
 * INSTALAÇÃO (depois de colar este código):
 *   1) Rode a função "setupSistema" uma vez manualmente (selecione ela
 *      no menu suspenso ao lado do botão "Executar" e clique em Executar).
 *      Isso cria as colunas novas, as abas de apoio, os menus suspensos
 *      e os gatilhos automáticos. Aceite as autorizações pedidas.
 *   2) Preencha a constante LINK_APPSHEET abaixo com o link do seu app
 *      assim que ele estiver publicado.
 *   3) Pronto — os gatilhos passam a rodar sozinhos.
 * ===================================================================
 */

// ==================== CONFIGURAÇÃO ====================
var SHEET_NAME = 'Previsão Férias 2026';
var ARQUIVO_RECUSADAS = 'Arquivo - Recusadas';
var CONTROLE_JANELAS = 'Controle Janelas';

var FERIAS_EMAIL = 'ferias@cieds.org.br';
var LINK_APPSHEET = 'COLE_AQUI_O_LINK_DO_APPSHEET'; // <-- atualizar quando o app estiver publicado

var DIAS_RETORNO_DP = 15;
var DIAS_ANTES_ALTERDATA = 20;
var DIAS_ANTES_JANELA = 60;
var DIAS_LEMBRETE = 7;

var MOTIVOS_RECUSA = [
  'Financeiro',
  'Período de gozo fora do permitido em legislação',
  'Solicitação com prazo inferior a 90 dias de antecedência'
];

var COLUNAS_NOVAS = [
  'ID Único',
  'Solicitado pelo Gestor',
  'Aprovado DP',
  'Data Aprovação DP',
  'Motivo Recusa',
  'Alerta 20 dias Enviado'
];

// ==================== SETUP (rodar uma vez manualmente) ====================
function setupSistema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" não encontrada.');

  // 1) cria colunas novas se não existirem
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  COLUNAS_NOVAS.forEach(function (nome) {
    if (headers.indexOf(nome) === -1) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(nome);
      headers.push(nome);
    }
  });

  var col = getColMap(sheet);
  var lastRow = Math.max(sheet.getLastRow(), 2);

  // 1b) preenche "ID Único" nas linhas que ainda não têm
  if (lastRow >= 2) {
    var idRange = sheet.getRange(2, col['ID Único'], lastRow - 1, 1);
    var idValues = idRange.getValues();
    var mudou = false;
    for (var i = 0; i < idValues.length; i++) {
      if (!idValues[i][0]) {
        idValues[i][0] = Utilities.getUuid();
        mudou = true;
      }
    }
    if (mudou) idRange.setValues(idValues);
  }

  // 2) lista suspensa "Aprovado DP"
  var validAprovado = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Sim', 'Não'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, col['Aprovado DP'], lastRow - 1, 1).setDataValidation(validAprovado);

  // 3) lista suspensa "Motivo Recusa"
  var validMotivo = SpreadsheetApp.newDataValidation()
    .requireValueInList(MOTIVOS_RECUSA, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, col['Motivo Recusa'], lastRow - 1, 1).setDataValidation(validMotivo);

  // 4) aba "Arquivo - Recusadas"
  var arquivoSheet = ss.getSheetByName(ARQUIVO_RECUSADAS);
  if (!arquivoSheet) {
    arquivoSheet = ss.insertSheet(ARQUIVO_RECUSADAS);
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headerRow.push('Data Arquivamento');
    arquivoSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  }

  // 5) aba "Controle Janelas"
  var controleSheet = ss.getSheetByName(CONTROLE_JANELAS);
  if (!controleSheet) {
    controleSheet = ss.insertSheet(CONTROLE_JANELAS);
    controleSheet.getRange(1, 1, 1, 7).setValues([[
      'Gestor', 'Email Gestor', 'Janela', 'Códigos Colaboradores',
      'Data Envio', 'Thread Id', 'Lembrete Enviado'
    ]]);
  }

  // 6) gatilho instalável de edição (para solicitação/aprovação)
  var triggers = ScriptApp.getProjectTriggers();
  var temOnEditInstalavel = triggers.some(function (t) {
    return t.getHandlerFunction() === 'onEditGerenciamentoFerias';
  });
  if (!temOnEditInstalavel) {
    ScriptApp.newTrigger('onEditGerenciamentoFerias')
      .forSpreadsheet(ss)
      .onEdit()
      .create();
  }

  // 7) gatilho diário (janelas, lembretes, vencimento alterdata)
  var temDiario = triggers.some(function (t) {
    return t.getHandlerFunction() === 'rotinaDiaria';
  });
  if (!temDiario) {
    ScriptApp.newTrigger('rotinaDiaria')
      .timeBased()
      .everyDays(1)
      .atHour(7)
      .create();
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Setup concluído com sucesso.');
}

// ==================== HELPERS ====================
function getColMap(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i + 1; });
  return col;
}

function getMainSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function formatarData(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

// ==================== 1) e 2) GATILHO DE EDIÇÃO ====================
function onEditGerenciamentoFerias(e) {
  return; // [DESATIVADO 30/09/2026] gatilho de edição não faz mais nada
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) return;

    var row = e.range.getRow();
    if (row < 2) return;

    var col = getColMap(sheet);
    var editedCol = e.range.getColumn();

    if (editedCol === col['Solicitado pelo Gestor']) {
      handleSolicitacaoGestor(sheet, row, col, e);
    }

    if (editedCol === col['Aprovado DP'] || editedCol === col['Motivo Recusa']) {
      handleAprovacaoDP(sheet, row, col);
    }
  } catch (err) {
    Logger.log('Erro no onEditGerenciamentoFerias: ' + err);
  }
}

function handleSolicitacaoGestor(sheet, row, col, e) {
  var novoValor = e.value;
  var valorAntigo = e.oldValue;
  if (!novoValor || valorAntigo) return; // só dispara na transição vazio -> preenchido

  var rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var nome = rowData[col['Nome'] - 1];
  var emailGestor = rowData[col['Email gestor'] - 1];
  var gestor = rowData[col['Gestão'] - 1];
  var inicio = rowData[col['Agendamento Inicio'] - 1];
  var fim = rowData[col['Agendamento Fim'] - 1];

  if (emailGestor && emailGestor.toString().indexOf('@') > -1) {
    MailApp.sendEmail({
      to: emailGestor,
      subject: 'Solicitação de férias recebida — ' + nome,
      htmlBody:
        'Olá, ' + gestor + '.<br><br>' +
        'Recebemos a solicitação de agendamento de férias para <b>' + nome + '</b>' +
        (inicio ? (', de ' + formatarData(inicio) + ' a ' + formatarData(fim)) : '') + '.<br><br>' +
        'O DP vai analisar e retornar em até <b>' + DIAS_RETORNO_DP + ' dias</b> com a confirmação.<br><br>' +
        'Você pode acompanhar e gerenciar a equipe pelo link: <a href="' + LINK_APPSHEET + '">' + LINK_APPSHEET + '</a><br><br>' +
        'Departamento Pessoal — CIEDS'
    });
  }

  MailApp.sendEmail({
    to: FERIAS_EMAIL,
    subject: 'Nova solicitação de férias para aprovação — ' + nome,
    htmlBody:
      'Nova solicitação de férias registrada:<br><br>' +
      '<b>Colaborador:</b> ' + nome + '<br>' +
      '<b>Gestor:</b> ' + gestor + ' (' + emailGestor + ')<br>' +
      '<b>Período solicitado:</b> ' + (inicio ? (formatarData(inicio) + ' a ' + formatarData(fim)) : 'não informado') + '<br>' +
      '<b>Linha na planilha:</b> ' + row + '<br><br>' +
      'Acesse a planilha para aprovar ou recusar.'
  });
}

function handleAprovacaoDP(sheet, row, col) {
  var rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var aprovado = rowData[col['Aprovado DP'] - 1];
  var motivo = rowData[col['Motivo Recusa'] - 1];
  var dataAprovacao = rowData[col['Data Aprovação DP'] - 1];

  if (!aprovado) return;
  if (dataAprovacao) return; // já processado, evita reenviar e-mail duplicado

  var nome = rowData[col['Nome'] - 1];
  var emailGestor = rowData[col['Email gestor'] - 1];
  var gestor = rowData[col['Gestão'] - 1];
  var inicio = rowData[col['Agendamento Inicio'] - 1];
  var fim = rowData[col['Agendamento Fim'] - 1];

  if (aprovado === 'Sim') {
    sheet.getRange(row, col['Data Aprovação DP']).setValue(new Date());

    if (emailGestor && emailGestor.toString().indexOf('@') > -1) {
      MailApp.sendEmail({
        to: emailGestor,
        subject: 'Férias confirmadas — ' + nome,
        htmlBody:
          'Olá, ' + gestor + '.<br><br>' +
          'As férias de <b>' + nome + '</b>, de ' + formatarData(inicio) + ' a ' + formatarData(fim) +
          ', foram <b>confirmadas</b> pelo DP.<br><br>' +
          'Departamento Pessoal — CIEDS'
      });
    }
    return;
  }

  if (aprovado === 'Não') {
    if (!motivo) return; // aguarda o motivo ser preenchido antes de processar

    sheet.getRange(row, col['Data Aprovação DP']).setValue(new Date());

    if (emailGestor && emailGestor.toString().indexOf('@') > -1) {
      MailApp.sendEmail({
        to: emailGestor,
        subject: 'Férias não aprovadas — ' + nome,
        htmlBody:
          'Olá, ' + gestor + '.<br><br>' +
          'A solicitação de férias de <b>' + nome + '</b>' +
          (inicio ? (', de ' + formatarData(inicio) + ' a ' + formatarData(fim)) : '') +
          ', <b>não foi aprovada</b> pelo DP.<br><br>' +
          '<b>Motivo:</b> ' + motivo + '<br><br>' +
          'Por favor, agende um novo período pelo link: <a href="' + LINK_APPSHEET + '">' + LINK_APPSHEET + '</a><br><br>' +
          'Departamento Pessoal — CIEDS'
      });
    }

    arquivarERecomecarCiclo(sheet, row, col);
  }
}

function arquivarERecomecarCiclo(sheet, row, col) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var arquivoSheet = ss.getSheetByName(ARQUIVO_RECUSADAS);
  var lastColMain = sheet.getLastColumn();

  var rowValues = sheet.getRange(row, 1, 1, lastColMain).getValues()[0];

  // 1) copia a linha para o arquivo, com data de arquivamento
  var arquivoRow = rowValues.slice();
  arquivoRow.push(new Date());
  arquivoSheet.getRange(arquivoSheet.getLastRow() + 1, 1, 1, arquivoRow.length).setValues([arquivoRow]);

  // 2) insere nova linha em branco (reinicia o ciclo) logo abaixo da atual
  sheet.insertRowAfter(row);
  var newRow = row + 1;
  var origRange = sheet.getRange(row, 1, 1, lastColMain);
  var destRange = sheet.getRange(newRow, 1, 1, lastColMain);
  origRange.copyTo(destRange);

  // limpa os campos do ciclo de agendamento/aprovação na linha nova
  ['Agendamento Inicio', 'Agendamento Fim', 'Solicitado pelo Gestor',
   'Aprovado DP', 'Data Aprovação DP', 'Motivo Recusa'].forEach(function (nomeCol) {
    if (col[nomeCol]) sheet.getRange(newRow, col[nomeCol]).clearContent();
  });
  if (col['Split Processado']) sheet.getRange(newRow, col['Split Processado']).clearContent();

  // gera um ID novo (esta linha reinicia o ciclo, é um novo registro)
  if (col['ID Único']) sheet.getRange(newRow, col['ID Único']).setValue(Utilities.getUuid());

  // 3) remove a linha original (agora arquivada e substituída pela nova)
  sheet.deleteRow(row);
}

// ==================== ROTINA DIÁRIA (gatilho de tempo) ====================
function rotinaDiaria() {
  return; // [DESATIVADO 30/09/2026] sem lembretes, janelas ou alertas diários
  verificarVencimentoAlterdata();
  enviarEmailsJanela();
  enviarLembretes7Dias();
}

// ---- 3) Gatilho: agendada sem Alterdata, 20 dias antes ----
function verificarVencimentoAlterdata() {
  var sheet = getMainSheet();
  var col = getColMap(sheet);
  var data = sheet.getDataRange().getValues();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  var pendentes = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var inicio = row[col['Agendamento Inicio'] - 1];
    var alterdata = row[col['Alterdata'] - 1];
    var jaAlertado = row[col['Alerta 20 dias Enviado'] - 1];

    if (!inicio) continue; // não agendada ainda
    if (alterdata === true) continue; // já processada no Alterdata
    if (jaAlertado === true) continue; // já alertamos essa linha

    var dataInicio = new Date(inicio);
    dataInicio.setHours(0, 0, 0, 0);
    var diffDias = Math.round((dataInicio - hoje) / (1000 * 60 * 60 * 24));

    if (diffDias <= DIAS_ANTES_ALTERDATA && diffDias >= 0) {
      pendentes.push({
        nome: row[col['Nome'] - 1],
        inicio: dataInicio,
        linha: i + 1
      });
    }
  }

  if (pendentes.length === 0) return;

  var corpo = pendentes.map(function (p) {
    return '- ' + p.nome + ' — início em ' + formatarData(p.inicio) + ' (linha ' + p.linha + ')';
  }).join('<br>');

  MailApp.sendEmail({
    to: FERIAS_EMAIL,
    subject: 'Alerta: férias planejadas sem processamento no Alterdata',
    htmlBody:
      'As férias abaixo estão agendadas e faltam ' + DIAS_ANTES_ALTERDATA + ' dias ou menos para o início, ' +
      'mas ainda não constam como processadas no Alterdata:<br><br>' + corpo
  });

  // marca como alertadas para não repetir todo dia
  pendentes.forEach(function (p) {
    sheet.getRange(p.linha, col['Alerta 20 dias Enviado']).setValue(true);
  });
}

// ---- 4) Gatilho: e-mail de janela trimestral (60 dias antes) ----
function enviarEmailsJanela() {
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  var quarterInfo = getProximaJanela(hoje);
  if (!quarterInfo) return; // hoje não é o dia de disparo de nenhuma janela

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var controleSheet = ss.getSheetByName(CONTROLE_JANELAS);
  var controleData = controleSheet.getDataRange().getValues();

  var sheet = getMainSheet();
  var col = getColMap(sheet);
  var data = sheet.getDataRange().getValues();

  // agrupa colaboradores pendentes (sem Agendamento Inicio) por gestor
  var porGestor = {}; // email gestor -> { gestorNome, prioridade: [], resto: [] }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var emailGestor = row[col['Email gestor'] - 1];
    if (!emailGestor || emailGestor.toString().indexOf('@') === -1) continue;

    var inicio = row[col['Agendamento Inicio'] - 1];
    if (inicio) continue; // já agendado, não entra na janela

    var concederAte = row[col['Conceder até'] - 1];
    if (!concederAte) continue;

    var prazoLimite = new Date(concederAte);
    prazoLimite.setDate(prazoLimite.getDate() - 10);

    var item = {
      nome: row[col['Nome'] - 1],
      codigo: row[col['Código'] - 1],
      concederAte: concederAte,
      linha: i + 1
    };

    if (!porGestor[emailGestor]) {
      porGestor[emailGestor] = {
        gestorNome: row[col['Gestão'] - 1],
        prioridade: [],
        resto: []
      };
    }

    if (prazoLimite >= quarterInfo.inicio && prazoLimite <= quarterInfo.fim) {
      porGestor[emailGestor].prioridade.push(item);
    } else {
      porGestor[emailGestor].resto.push(item);
    }
  }

  Object.keys(porGestor).forEach(function (emailGestor) {
    var info = porGestor[emailGestor];
    if (info.prioridade.length === 0 && info.resto.length === 0) return;

    // evita reenviar pro mesmo gestor na mesma janela
    var jaEnviado = controleData.some(function (r) {
      return r[1] === emailGestor && r[2] === quarterInfo.label;
    });
    if (jaEnviado) return;

    var htmlPrioridade = info.prioridade.length
      ? '<p><b style="color:red;">Prioridade (prazo dentro da janela ' + quarterInfo.label + '):</b><br>' +
        info.prioridade.map(function (p) { return '- ' + p.nome + ' (conceder até ' + formatarData(p.concederAte) + ')'; }).join('<br>') +
        '</p>'
      : '';

    var htmlResto = info.resto.length
      ? '<p><b>Restante da equipe (fora da janela atual, para visibilidade):</b><br>' +
        info.resto.map(function (p) { return '- ' + p.nome + ' (conceder até ' + formatarData(p.concederAte) + ')'; }).join('<br>') +
        '</p>'
      : '';

    var draft = GmailApp.createDraft(
      emailGestor,
      'Agendamento de férias da equipe — janela ' + quarterInfo.label,
      '', // corpo em texto simples vazio, usamos htmlBody
      {
        htmlBody:
          'Olá, ' + info.gestorNome + '.<br><br>' +
          'Está chegando a janela de agendamento de férias (' + quarterInfo.label + '). ' +
          'Seguem os colaboradores da sua equipe que ainda precisam ter o período definido:<br>' +
          htmlPrioridade + htmlResto +
          '<br>Preencha o agendamento pelo link: <a href="' + LINK_APPSHEET + '">' + LINK_APPSHEET + '</a><br><br>' +
          'Departamento Pessoal — CIEDS'
      }
    );
    var msg = draft.send();
    var threadId = msg.getThread().getId();

    var codigos = info.prioridade.concat(info.resto).map(function (p) { return p.codigo; }).join(',');

    controleSheet.appendRow([
      info.gestorNome, emailGestor, quarterInfo.label, codigos,
      new Date(), threadId, false
    ]);
  });
}

// calcula se hoje é o dia de disparo (60 dias antes) de alguma das próximas janelas
function getProximaJanela(hoje) {
  var ano = hoje.getFullYear();
  var trimestres = [
    { mes: 0, label: ano + '-T1' },
    { mes: 3, label: ano + '-T2' },
    { mes: 6, label: ano + '-T3' },
    { mes: 9, label: ano + '-T4' },
    { mes: 0, label: (ano + 1) + '-T1', anoSeguinte: true }
  ];

  for (var i = 0; i < trimestres.length; i++) {
    var t = trimestres[i];
    var anoTrimestre = t.anoSeguinte ? ano + 1 : ano;
    var inicio = new Date(anoTrimestre, t.mes, 1);
    var fim = new Date(anoTrimestre, t.mes + 3, 0);

    var disparo = new Date(inicio);
    disparo.setDate(disparo.getDate() - DIAS_ANTES_JANELA);
    disparo.setHours(0, 0, 0, 0);

    if (disparo.getTime() === hoje.getTime()) {
      return { inicio: inicio, fim: fim, label: t.label };
    }
  }
  return null;
}

// ---- 5) Gatilho: lembrete de 7 dias sem resposta ----
function enviarLembretes7Dias() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var controleSheet = ss.getSheetByName(CONTROLE_JANELAS);
  var controleData = controleSheet.getDataRange().getValues();

  var sheet = getMainSheet();
  var col = getColMap(sheet);
  var dadosSheet = sheet.getDataRange().getValues();

  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  for (var i = 1; i < controleData.length; i++) {
    var linha = controleData[i];
    var dataEnvio = linha[4];
    var threadId = linha[5];
    var lembreteEnviado = linha[6];
    if (!dataEnvio || lembreteEnviado === true) continue;

    var dataLimite = new Date(dataEnvio);
    dataLimite.setDate(dataLimite.getDate() + DIAS_LEMBRETE);
    dataLimite.setHours(0, 0, 0, 0);

    if (hoje.getTime() < dataLimite.getTime()) continue;

    var codigos = linha[3].toString().split(',').map(function (c) { return c.trim(); });

    // verifica se ainda falta algum agendamento entre os códigos daquela janela
    var faltaAlgum = codigos.some(function (codigo) {
      var linhaFuncionario = dadosSheet.find(function (r) {
        return r[col['Código'] - 1].toString() === codigo;
      });
      if (!linhaFuncionario) return false; // pode ter sido removido/desligado
      return !linhaFuncionario[col['Agendamento Inicio'] - 1];
    });

    if (!faltaAlgum) {
      controleSheet.getRange(i + 1, 7).setValue(true); // já completou, não precisa lembrete
      continue;
    }

    try {
      var thread = GmailApp.getThreadById(threadId);
      thread.reply(
        'Lembrete: ainda faltam agendamentos de férias da sua equipe pendentes. ' +
        'Por favor, preencha pelo link: ' + LINK_APPSHEET
      );
    } catch (err) {
      Logger.log('Erro ao responder thread ' + threadId + ': ' + err);
    }

    controleSheet.getRange(i + 1, 7).setValue(true);
  }
}