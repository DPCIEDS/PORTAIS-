/**
 * ===================================================================
 * AUTOMAÇÃO: Split de férias parcialmente agendadas
 *              + Geração automática de ID Único
 * ===================================================================
 * Planilha: "Previsão Férias 2026"
 *
 * O que faz:
 *
 * 1) ID ÚNICO AUTOMÁTICO (bloco novo):
 *    Sempre que a coluna "Código" (A) de uma linha for preenchida e a
 *    coluna "ID Único" dessa linha estiver vazia, o script gera um UUID
 *    automaticamente. Cobre tanto digitação célula a célula quanto
 *    colar várias linhas de uma vez.
 *
 * 2) SPLIT DE FÉRIAS (já existia):
 *    Quando alguém preenche "Agendamento Inicio" (N) e "Agendamento Fim" (O)
 *    de um colaborador, e o número de dias agendados é MENOR do que o saldo
 *    em "Dias a serem gozados" (L), o script:
 *
 *      a) Insere uma NOVA linha logo abaixo, copiando os dados do colaborador,
 *         com:
 *           - Agendamento Inicio / Agendamento Fim em branco (ainda não agendado)
 *           - "Dias gozados" = valor da linha anterior + dias agendados nesta
 *             rodada (o agendamento passa a contar como gozo no saldo consolidado)
 *           - "Dias a serem gozados" = saldo restante (o que sobrou)
 *      A linha original (que já ficou com o agendamento específico em N/O)
 *      mantém "Dias gozados" como estava - ela passa a representar só o
 *      registro daquele agendamento pontual, não o saldo consolidado.
 *      Assim o saldo remanescente continua aparecendo no Calendário como
 *      "Compulsória" (sem agendamento) até ser agendado também.
 *
 * Instalação:
 *   1) Na planilha, vá em Extensões > Apps Script
 *   2) Substitua o conteúdo do arquivo (Code.gs) por este código
 *   3) Salve (ícone de disquete)
 *   4) Na primeira execução o Google vai pedir autorização — aceite
 *      (é normal, o script só acessa esta planilha)
 *   5) Pronto — funciona automaticamente a partir daí, sem precisar rodar nada manualmente
 * ===================================================================
 */

var SHEET_NAME = 'Previsão Férias 2026';
var CONTROL_COL_HEADER = 'Split Processado'; // coluna de controle criada automaticamente

/**
 * ===================================================================
 * BACKFILL (rodar manualmente UMA VEZ para preencher ID Único de
 * linhas antigas que já existiam antes deste script, como a da
 * Ana Paula). Depois disso, o onEdit cuida sozinho das linhas novas.
 *
 * Como rodar:
 *   1) No Apps Script, selecione esta função no menu suspenso ao lado
 *      do botão "Executar" (não deixe selecionado "onEdit")
 *   2) Clique em Executar
 *   3) Confira a planilha - todas as linhas com Código preenchido e
 *      ID Único vazio devem estar preenchidas agora
 * ===================================================================
 */
function preencherIdsFaltantes() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i + 1; });

  var colCodigo = col['Código'];
  var colIdUnico = col['ID Único'];
  if (!colCodigo || !colIdUnico) {
    Logger.log('Não encontrei as colunas "Código" ou "ID Único". Confira os cabeçalhos.');
    return;
  }

  var lastRow = sheet.getLastRow();
  var codigos = sheet.getRange(2, colCodigo, lastRow - 1, 1).getValues();
  var ids = sheet.getRange(2, colIdUnico, lastRow - 1, 1).getValues();

  var preenchidos = 0;
  for (var i = 0; i < codigos.length; i++) {
    var codigoVal = codigos[i][0];
    var idVal = ids[i][0];
    if (codigoVal !== '' && codigoVal !== null && (idVal === '' || idVal === null)) {
      sheet.getRange(2 + i, colIdUnico).setValue(Utilities.getUuid());
      preenchidos++;
    }
  }
  Logger.log('IDs preenchidos: ' + preenchidos);
}

function onEdit(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) return;

    var startRow = e.range.getRow();
    var numRows = e.range.getNumRows();
    var startCol = e.range.getColumn();
    var numCols = e.range.getNumColumns();

    if (startRow < 2) return; // ignora edição no cabeçalho

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i + 1; });

    // ===============================================================
    // BLOCO NOVO: gera ID Único automaticamente para linhas novas
    // Roda em QUALQUER edição que toque a coluna "Código", antes do
    // filtro do split (que só olha Agendamento Inicio/Fim).
    // ===============================================================
    var colCodigo = col['Código'];
    var colIdUnico = col['ID Único'];
    if (colCodigo && colIdUnico) {
      var tocouCodigo = (startCol <= colCodigo && colCodigo < startCol + numCols);
      if (tocouCodigo) {
        for (var rIdx = startRow; rIdx < startRow + numRows; rIdx++) {
          var codigoVal = sheet.getRange(rIdx, colCodigo).getValue();
          var idCell = sheet.getRange(rIdx, colIdUnico);
          if (codigoVal !== '' && codigoVal !== null && idCell.getValue() === '') {
            idCell.setValue(Utilities.getUuid());
          }
        }
      }
    }
    // ===============================================================
    // FIM DO BLOCO NOVO
    // ===============================================================

    var colAgendInicio = col['Agendamento Inicio'];
    var colAgendFim = col['Agendamento Fim'];
    if (!colAgendInicio || !colAgendFim) return;

    // Só reage se a edição tocou nas colunas de agendamento
    var editedAgend = false;
    for (var c = startCol; c < startCol + numCols; c++) {
      if (c === colAgendInicio || c === colAgendFim) editedAgend = true;
    }
    if (!editedAgend) return;

    // garante que a coluna de controle existe (cria se preciso)
    var colControl = col[CONTROL_COL_HEADER];
    if (!colControl) {
      colControl = sheet.getLastColumn() + 1;
      sheet.getRange(1, colControl).setValue(CONTROL_COL_HEADER);
      col[CONTROL_COL_HEADER] = colControl;
    }

    // processa cada linha tocada pela edição (cobre também cola em massa/paste)
    // processa de baixo para cima para não bagunçar os números de linha ao inserir
    var rowsToProcess = [];
    for (var r = startRow; r < startRow + numRows; r++) {
      rowsToProcess.push(r);
    }
    rowsToProcess.sort(function (a, b) { return b - a; });

    rowsToProcess.forEach(function (row) {
      processarLinha(sheet, row, col);
    });

  } catch (err) {
    Logger.log('Erro no onEdit: ' + err);
  }
}

function processarLinha(sheet, row, col) {
  var lastCol = sheet.getLastColumn();
  var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

  var agendInicio = rowData[col['Agendamento Inicio'] - 1];
  var agendFim = rowData[col['Agendamento Fim'] - 1];
  if (!agendInicio || !agendFim) return; // só processa quando os DOIS estiverem preenchidos

  var jaProcessado = rowData[col[CONTROL_COL_HEADER] - 1];
  if (jaProcessado === 'SPLIT_OK') return; // evita duplicar o split se editarem de novo

  var diasSeremGozados = Number(rowData[col['Dias a serem gozados'] - 1]) || 0;
  if (diasSeremGozados <= 0) return;

  var msPerDay = 1000 * 60 * 60 * 24;
  var diasAgendados = Math.round((agendFim - agendInicio) / msPerDay) + 1;

  if (diasAgendados >= diasSeremGozados) {
    // agendou tudo (ou mais) - nao precisa dividir, so marca como processado
    sheet.getRange(row, col[CONTROL_COL_HEADER]).setValue('SPLIT_OK');
    return;
  }

  var diferenca = diasSeremGozados - diasAgendados;

  // "Dias gozados" da linha original NÃO muda - ela passa a representar
  // apenas o registro pontual deste agendamento (que já está em N/O).
  var diasGozadosAtual = Number(rowData[col['Dias gozados'] - 1]) || 0;

  // marca a linha atual como processada (evita reprocessar no futuro)
  sheet.getRange(row, col[CONTROL_COL_HEADER]).setValue('SPLIT_OK');

  // 2) Insere nova linha logo abaixo com o saldo remanescente
  sheet.insertRowAfter(row);
  var newRow = row + 1;

  // copia toda a linha (valores + formulas, que se auto-ajustam pra nova linha)
  var origRange = sheet.getRange(row, 1, 1, lastCol);
  var destRange = sheet.getRange(newRow, 1, 1, lastCol);
  origRange.copyTo(destRange);

  // ajusta os campos que mudam na linha nova (saldo remanescente, ainda nao agendado)
  sheet.getRange(newRow, col['Agendamento Inicio']).clearContent();
  sheet.getRange(newRow, col['Agendamento Fim']).clearContent();
  // "Dias gozados" da linha nova = valor anterior + dias agora agendados
  // (o agendamento passa a contar como gozo no saldo consolidado que segue)
  sheet.getRange(newRow, col['Dias gozados']).setValue(diasGozadosAtual + diasAgendados);
  sheet.getRange(newRow, col['Dias a serem gozados']).setValue(diferenca);
  sheet.getRange(newRow, col[CONTROL_COL_HEADER]).clearContent(); // ainda nao processada

  // se existir coluna "Abono", zera na linha nova (abono se refere ao agendamento ja feito)
  if (col['Abono']) {
    sheet.getRange(newRow, col['Abono']).clearContent();
  }

  // a linha nova é um novo registro em aberto (saldo ainda não agendado) -
  // não pode herdar o mesmo "ID Único" da linha original, senão duplica a
  // chave usada pelo AppSheet. Também limpa os campos do ciclo de
  // solicitação/aprovação, caso por algum motivo já estivessem preenchidos.
  if (col['ID Único']) {
    sheet.getRange(newRow, col['ID Único']).setValue(Utilities.getUuid());
  }
  ['Solicitado pelo Gestor', 'Aprovado DP', 'Data Aprovação DP', 'Motivo Recusa'].forEach(function (nomeCol) {
    if (col[nomeCol]) sheet.getRange(newRow, col[nomeCol]).clearContent();
  });
}