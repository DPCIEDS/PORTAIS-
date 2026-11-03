/**
 * DP360 - ESPELHO SOMENTE CONSULTA (OTIMIZADO)
 *
 * Use no MESMO projeto Apps Script da DATABASE.
 *
 * Objetivo:
 * - espelho separado, somente para consulta;
 * - atualiza a cada 1 minuto;
 * - NÃO recria formatação/filtro/larguras a cada ciclo;
 * - usa LockService para impedir execuções sobrepostas;
 * - sincroniza apenas os valores da área usada;
 * - preserva caixas de seleção no espelho;
 *
 * IMPORTANTE:
 * Compartilhe a planilha espelho com a equipe como LEITOR.
 */

const ESPELHO_RO = {
  PROP_ID: 'DP360_CHECKLIST_ESPELHO_ID',
  NOME_ARQUIVO: 'DP360 - Checklist Admissional - Equipe',
  ABA: 'CHECKLIST_ADMISSAO',
  INTERVALO_MINUTOS: 1,
  COLUNAS_CHECKBOX: [6,7,8,9,10,11,12,13,14,15],
  LARGURAS: {
    1: 260, 2: 220, 3: 180, 4: 180, 5: 170,
    6: 110, 7: 110, 8: 125, 9: 110, 10: 90,
    11: 110, 12: 130, 13: 110, 14: 105, 15: 110,
    16: 300, 17: 105, 18: 220, 19: 90, 20: 145
  }
};

function instalarEspelhoChecklistSomenteLeitura() {
  const origem = SpreadsheetApp.getActiveSpreadsheet();
  const shOrigem = origem.getSheetByName(ESPELHO_RO.ABA);
  if (!shOrigem) throw new Error('A aba ' + ESPELHO_RO.ABA + ' não foi encontrada na DATABASE.');

  const props = PropertiesService.getScriptProperties();
  let espelho = null;
  const id = props.getProperty(ESPELHO_RO.PROP_ID);

  if (id) {
    try { espelho = SpreadsheetApp.openById(id); } catch (e) {}
  }

  if (!espelho) {
    espelho = SpreadsheetApp.create(ESPELHO_RO.NOME_ARQUIVO);
    props.setProperty(ESPELHO_RO.PROP_ID, espelho.getId());
  }

  let sh = espelho.getSheetByName(ESPELHO_RO.ABA);
  if (!sh) {
    sh = espelho.getSheets()[0];
    sh.setName(ESPELHO_RO.ABA);
  }

  prepararLayoutEspelho_(sh, shOrigem);
  sincronizarEspelhoChecklistRapido();
  instalarTriggerEspelhoRapido_();

  const url = espelho.getUrl();
  Logger.log('PLANILHA ESPELHO: ' + url);
  try {
    SpreadsheetApp.getUi().alert(
      'Espelho pronto',
      'A planilha espelho está configurada para atualizar a cada 1 minuto.\n\n' +
      'Compartilhe-a com a equipe como LEITOR:\n\n' + url,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {}
  return url;
}

function sincronizarEspelhoChecklistRapido() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Sincronização ignorada: outra execução ainda está em andamento.');
    return;
  }

  try {
    const origem = SpreadsheetApp.getActiveSpreadsheet();
    const shOrigem = origem.getSheetByName(ESPELHO_RO.ABA);
    if (!shOrigem) return;

    const espelho = abrirEspelhoRO_();
    if (!espelho) throw new Error('Espelho ainda não criado. Execute instalarEspelhoChecklistSomenteLeitura().');

    const shDestino = espelho.getSheetByName(ESPELHO_RO.ABA);
    if (!shDestino) throw new Error('A aba do espelho não foi encontrada.');

    const lastRow = shOrigem.getLastRow();
    const lastCol = shOrigem.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return;

    const dados = shOrigem.getRange(1, 1, lastRow, lastCol).getValues();

    if (shDestino.getMaxRows() < lastRow) {
      shDestino.insertRowsAfter(shDestino.getMaxRows(), lastRow - shDestino.getMaxRows());
    }
    if (shDestino.getMaxColumns() < lastCol) {
      shDestino.insertColumnsAfter(shDestino.getMaxColumns(), lastCol - shDestino.getMaxColumns());
    }

    shDestino.getRange(1, 1, lastRow, lastCol).setValues(dados);

    const destinoLastRow = shDestino.getLastRow();
    if (destinoLastRow > lastRow) {
      shDestino.getRange(lastRow + 1, 1, destinoLastRow - lastRow, lastCol).clearContent();
    }

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function prepararLayoutEspelho_(shDestino, shOrigem) {
  const lastRow = Math.max(shOrigem.getLastRow(), 2);
  const lastCol = Math.max(shOrigem.getLastColumn(), 1);

  if (shDestino.getMaxRows() < lastRow) {
    shDestino.insertRowsAfter(shDestino.getMaxRows(), lastRow - shDestino.getMaxRows());
  }
  if (shDestino.getMaxColumns() < lastCol) {
    shDestino.insertColumnsAfter(shDestino.getMaxColumns(), lastCol - shDestino.getMaxColumns());
  }

  shDestino.clear();

  shDestino.getRange(1, 1, 1, lastCol)
    .setBackground('#3F4650')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  shDestino.setFrozenRows(1);

  shDestino.getRange(2, 1, lastRow - 1, lastCol)
    .setBackground('#FFFFFF')
    .setFontColor('#202124')
    .setVerticalAlignment('middle');

  ESPELHO_RO.COLUNAS_CHECKBOX.forEach(function(col) {
    if (col <= lastCol) {
      shDestino.getRange(2, col, shDestino.getMaxRows() - 1, 1)
        .insertCheckboxes()
        .setHorizontalAlignment('center');
    }
  });

  if (lastCol >= 17) {
    shDestino.getRange(2, 17, shDestino.getMaxRows() - 1, 1).setNumberFormat('dd/MM/yyyy');
  }
  if (lastCol >= 19) {
    shDestino.getRange(2, 19, shDestino.getMaxRows() - 1, 1).setNumberFormat('0%');
  }
  if (lastCol >= 20) {
    shDestino.getRange(2, 20, shDestino.getMaxRows() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  }

  Object.keys(ESPELHO_RO.LARGURAS).forEach(function(k) {
    const col = Number(k);
    if (col <= lastCol) shDestino.setColumnWidth(col, ESPELHO_RO.LARGURAS[k]);
  });

  const filtro = shDestino.getFilter();
  if (filtro) filtro.remove();
  shDestino.getRange(1, 1, Math.max(lastRow, 2), lastCol).createFilter();
}

function instalarTriggerEspelhoRapido_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction();
    if (
      fn === 'sincronizarEspelhoChecklist' ||
      fn === 'espelhoChecklistOnEdit' ||
      fn === 'sincronizarEspelhoChecklistRapido'
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sincronizarEspelhoChecklistRapido')
    .timeBased()
    .everyMinutes(ESPELHO_RO.INTERVALO_MINUTOS)
    .create();
}

function abrirEspelhoRO_() {
  const id = PropertiesService.getScriptProperties().getProperty(ESPELHO_RO.PROP_ID);
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch (e) { return null; }
}

function mostrarLinkEspelhoChecklist() {
  const ss = abrirEspelhoRO_();
  if (!ss) throw new Error('Espelho não localizado.');
  Logger.log(ss.getUrl());
  try { SpreadsheetApp.getUi().alert(ss.getUrl()); } catch (e) {}
  return ss.getUrl();
}

function listarTriggersEspelhoChecklist() {
  const lista = ScriptApp.getProjectTriggers()
    .map(function(t) { return t.getHandlerFunction() + ' | ' + t.getEventType(); })
    .filter(function(x) { return x.toLowerCase().indexOf('espelho') >= 0; });

  Logger.log(lista.join('\n'));
  return lista;
}
