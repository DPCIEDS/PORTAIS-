/**
 * DP360 - ENVIO AUTOMATICO DE EMAILS DE EXAME ADMISSIONAL
 * ARQUIVO SEPARADO
 *
 * Este arquivo NAO altera:
 * - CHECKLIST_ADMISSAO
 * - codigo do checklist
 * - codigo do controle de exames
 *
 * Ele apenas le a aba CONTROLE_EXAME_ADMISSIONAL.
 *
 * SEGURANCA:
 * - instalarEnvioEmailsExameAdmissional() NAO envia nenhum email.
 * - o envio automatico nasce BLOQUEADO.
 * - primeiro rode gerarPreviewPrimeiroEmailExame().
 * - somente depois de validar o preview, rode liberarEnvioAutomaticoEmailsExame().
 *
 * Fluxo:
 * documentacao completa -> controle agenda exame -> preview -> liberacao -> envio automatico.
 *
 * CORRIGIDO em 2026-09-23: os indices de coluna eram fixos (numero da coluna
 * hardcoded). A planilha real tem uma coluna extra sem cabecalho entre
 * "Nome" e "E-mail", o que deslocava a leitura de "E-mail" em diante para a
 * coluna errada (o script achava que o e-mail sempre estava vazio). Agora os
 * indices sao resolvidos em tempo de execucao pelo NOME do cabecalho, entao
 * inserir/mover coluna no meio nao quebra mais a leitura.
 */

const EMAIL_EXAME = {
  ABA_CONTROLE: 'CONTROLE_EXAME_ADMISSIONAL',
  ABA_PREVIEW: 'PREVIEW_EMAIL_EXAME',

  PROP_LIBERADO: 'DP360_EMAIL_EXAME_LIBERADO',

  // Cabecalhos esperados na aba de controle (ja existentes na origem).
  // A busca e por NOME, nao por posicao - resistente a colunas inseridas.
  CAB_NOME: 'Nome',
  CAB_EMAIL: 'E-mail',
  CAB_PROTOCOLO: 'Protocolo',
  CAB_DATA_EXAME: 'Data do exame',
  CAB_HORARIO: 'Horário',
  CAB_LOCAL_EXAME: 'Local do exame',
  CAB_ENDERECO_CIEDS: 'Endereço CIEDS',
  CAB_STATUS_AGENDAMENTO: 'Status do agendamento',

  // Colunas exclusivas deste arquivo - criadas automaticamente se nao
  // existirem, sempre apos a ultima coluna ja usada na aba (nunca em
  // posicao fixa).
  CAB_EMAIL_ENVIADO: 'E-mail enviado',
  CAB_EMAIL_ENVIADO_EM: 'Data/hora envio',
  CAB_ERRO_ENVIO: 'Erro envio',

  ASSUNTO: 'Exame Admissional - CIEDS',
  REMETENTE_NOME: 'Departamento Pessoal - CIEDS',
  EMAIL_CC: 'dp@cieds.org.br',

  LOCAL_EXAME_PADRAO: 'Avenida Rio Branco, 116 - 7º andar',
  ENDERECO_CIEDS_PADRAO: 'Rua Presidente Vargas, 417 - 18º andar - Centro',
  HORARIO_PADRAO: '12h',

  // Quantidade maxima por execucao.
  // Mantem a rotina leve e evita estouro do Apps Script.
  MAX_EMAILS_POR_EXECUCAO: 20
};


/**
 * Le a linha 1 da aba e resolve, por NOME de cabecalho, a coluna de cada
 * campo que a funcao chamadora precisar. Lanca erro claro se um cabecalho
 * obrigatorio nao existir - nunca adivinha posicao.
 */
function resolverColunasControle_(sh, nomesObrigatorios) {
  const ultimaColuna = Math.max(sh.getLastColumn(), 1);
  const cabecalhos = sh.getRange(1, 1, 1, ultimaColuna).getValues()[0];

  const porNome = {};
  cabecalhos.forEach(function (valor, indice) {
    const chave = normalizar_(valor);
    if (chave && !(chave in porNome)) {
      porNome[chave] = indice + 1;
    }
  });

  const resolvido = {};
  const faltando = [];

  nomesObrigatorios.forEach(function (nome) {
    const coluna = porNome[normalizar_(nome)];
    if (coluna) {
      resolvido[nome] = coluna;
    } else {
      faltando.push(nome);
    }
  });

  if (faltando.length > 0) {
    throw new Error(
      'Cabecalho(s) nao encontrado(s) em "' + sh.getName() + '": ' +
      faltando.join(', ') +
      '. Confira a linha 1 da aba antes de rodar de novo.'
    );
  }

  return resolvido;
}


/**
 * Garante que as 3 colunas exclusivas deste arquivo existem na aba,
 * procurando por NOME primeiro. Se algum cabecalho nao existir ainda, cria
 * na proxima coluna livre (ultima coluna + 1), nunca em posicao fixa.
 * Retorna o mapa {nome do cabecalho -> numero da coluna}.
 */
function prepararColunasControleEmail_(sh) {
  const cabecalhosProprios = [
    EMAIL_EXAME.CAB_EMAIL_ENVIADO,
    EMAIL_EXAME.CAB_EMAIL_ENVIADO_EM,
    EMAIL_EXAME.CAB_ERRO_ENVIO
  ];

  const ultimaColunaAtual = Math.max(sh.getLastColumn(), 1);
  const cabecalhosAtuais = sh.getRange(1, 1, 1, ultimaColunaAtual).getValues()[0];

  const porNome = {};
  cabecalhosAtuais.forEach(function (valor, indice) {
    const chave = normalizar_(valor);
    if (chave && !(chave in porNome)) {
      porNome[chave] = indice + 1;
    }
  });

  const resultado = {};
  let proximaColunaLivre = ultimaColunaAtual + 1;

  cabecalhosProprios.forEach(function (nome) {
    const chave = normalizar_(nome);
    if (porNome[chave]) {
      resultado[nome] = porNome[chave];
      return;
    }
    const coluna = proximaColunaLivre;
    sh.getRange(1, coluna).setValue(nome);
    resultado[nome] = coluna;
    proximaColunaLivre += 1;
  });

  const colEnviado = resultado[EMAIL_EXAME.CAB_EMAIL_ENVIADO];
  const colEnviadoEm = resultado[EMAIL_EXAME.CAB_EMAIL_ENVIADO_EM];
  const colErro = resultado[EMAIL_EXAME.CAB_ERRO_ENVIO];

  sh.getRange(1, colEnviado, 1, 3)
    .setBackground('#333333')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  const qtd = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, colEnviado, qtd, 1).insertCheckboxes();

  sh.setColumnWidth(colEnviado, 110);
  sh.setColumnWidth(colEnviadoEm, 145);
  sh.setColumnWidth(colErro, 260);

  return resultado;
}


/**
 * EXECUTAR UMA VEZ.
 *
 * Prepara as colunas de controle e cria a aba de preview.
 * NAO envia email e NAO instala gatilho de envio.
 */
function instalarEnvioEmailsExameAdmissional() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_EXAME.ABA_CONTROLE);

  if (!sh) {
    throw new Error(
      'A aba ' + EMAIL_EXAME.ABA_CONTROLE +
      ' nao foi encontrada. Instale primeiro o controle de exame admissional.'
    );
  }

  prepararColunasControleEmail_(sh);
  garantirAbaPreviewEmail_();

  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_EXAME.PROP_LIBERADO, 'NAO');

  removerGatilhosEmailExame_();

  ss.toast(
    'Modulo de e-mail instalado em modo seguro. Nenhum e-mail foi enviado. Agora execute gerarPreviewPrimeiroEmailExame().',
    'DP360',
    10
  );
}


/**
 * Gera o preview do PRIMEIRO colaborador elegivel.
 * Nao envia nada.
 *
 * Retorna um objeto com destinatario, assunto e corpo.
 */
function gerarPreviewPrimeiroEmailExame() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_EXAME.ABA_CONTROLE);

  if (!sh) {
    throw new Error('A aba de controle de exames nao foi encontrada.');
  }

  const colunas = resolverColunasControle_(sh, [
    EMAIL_EXAME.CAB_NOME,
    EMAIL_EXAME.CAB_EMAIL,
    EMAIL_EXAME.CAB_DATA_EXAME,
    EMAIL_EXAME.CAB_HORARIO,
    EMAIL_EXAME.CAB_LOCAL_EXAME,
    EMAIL_EXAME.CAB_ENDERECO_CIEDS,
    EMAIL_EXAME.CAB_STATUS_AGENDAMENTO
  ]);
  const colunasProprias = prepararColunasControleEmail_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('Nao ha colaboradores no controle de exame.');
  }

  const lastCol = Math.max(sh.getLastColumn(), colunasProprias[EMAIL_EXAME.CAB_ERRO_ENVIO]);
  const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let escolhido = null;
  let linhaEscolhida = null;

  for (let i = 0; i < dados.length; i++) {
    const row = dados[i];

    const nome = texto_(row[colunas[EMAIL_EXAME.CAB_NOME] - 1]);
    const email = texto_(row[colunas[EMAIL_EXAME.CAB_EMAIL] - 1]);
    const dataExame = row[colunas[EMAIL_EXAME.CAB_DATA_EXAME] - 1];
    const status = texto_(row[colunas[EMAIL_EXAME.CAB_STATUS_AGENDAMENTO] - 1]);
    const enviado = row[colunasProprias[EMAIL_EXAME.CAB_EMAIL_ENVIADO] - 1] === true;

    if (
      nome &&
      email &&
      dataExame &&
      normalizar_(status) === 'AGENDADO' &&
      !enviado
    ) {
      escolhido = montarEmailExame_(row, colunas);
      linhaEscolhida = i + 2;
      break;
    }
  }

  if (!escolhido) {
    throw new Error(
      'Nao encontrei colaborador AGENDADO, com e-mail preenchido e ainda nao enviado.'
    );
  }

  const preview = garantirAbaPreviewEmail_();
  preview.clear();

  preview.getRange('A1:B1')
    .setValues([['PREVIEW DO EMAIL', 'VALOR']])
    .setBackground('#333333')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  preview.getRange('A2:B7').setValues([
    ['Linha no controle', linhaEscolhida],
    ['Destinatario', escolhido.para],
    ['Copia (CC)', EMAIL_EXAME.EMAIL_CC],
    ['Nome', escolhido.nome],
    ['Assunto', escolhido.assunto],
    ['Data do exame', escolhido.dataTxt]
  ]);

  preview.getRange('A9').setValue('CORPO DO EMAIL');
  preview.getRange('A9').setFontWeight('bold');

  preview.getRange('A10')
    .setValue(escolhido.texto)
    .setWrap(true)
    .setVerticalAlignment('top');

  preview.setColumnWidth(1, 190);
  preview.setColumnWidth(2, 430);
  preview.setRowHeight(10, 280);

  preview.getRange('A12').setValue('STATUS');
  preview.getRange('B12').setValue(
    'PREVIEW APENAS - NENHUM EMAIL FOI ENVIADO - CC: ' + EMAIL_EXAME.EMAIL_CC
  );

  preview.getRange('B12')
    .setFontWeight('bold');

  SpreadsheetApp.flush();

  ss.toast(
    'Preview criado na aba ' + EMAIL_EXAME.ABA_PREVIEW + '. Nenhum e-mail foi enviado.',
    'DP360',
    8
  );

  Logger.log('DESTINATARIO: ' + escolhido.para);
  Logger.log('COPIA (CC): ' + EMAIL_EXAME.EMAIL_CC);
  Logger.log('ASSUNTO: ' + escolhido.assunto);
  Logger.log('CORPO:\n' + escolhido.texto);

  return escolhido;
}


/**
 * Somente execute esta funcao DEPOIS de validar o preview.
 *
 * Libera o envio e cria o gatilho automatico de 1 minuto.
 */
function liberarEnvioAutomaticoEmailsExame() {
  const ss = SpreadsheetApp.getActive();

  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_EXAME.PROP_LIBERADO, 'SIM');

  removerGatilhosEmailExame_();

  ScriptApp.newTrigger('enviarEmailsExameAdmissional')
    .timeBased()
    .everyMinutes(1)
    .create();

  ss.toast(
    'Envio automatico LIBERADO. O sistema verificara novos agendamentos a cada 1 minuto.',
    'DP360',
    10
  );
}


/**
 * Pausa imediatamente o envio automatico.
 */
function pausarEnvioAutomaticoEmailsExame() {
  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_EXAME.PROP_LIBERADO, 'NAO');

  removerGatilhosEmailExame_();

  SpreadsheetApp.getActive().toast(
    'Envio automatico de exames PAUSADO.',
    'DP360',
    8
  );
}


/**
 * Funcao chamada pelo gatilho.
 *
 * Somente envia quando:
 * - liberacao = SIM;
 * - status = AGENDADO;
 * - data do exame preenchida;
 * - e-mail preenchido;
 * - checkbox "E-mail enviado" ainda desmarcado.
 */
function enviarEmailsExameAdmissional() {
  const liberado = PropertiesService.getScriptProperties()
    .getProperty(EMAIL_EXAME.PROP_LIBERADO);

  if (liberado !== 'SIM') {
    Logger.log('Envio bloqueado. Execute liberarEnvioAutomaticoEmailsExame() apos validar o preview.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(EMAIL_EXAME.ABA_CONTROLE);

    if (!sh) {
      throw new Error('A aba de controle de exames nao foi encontrada.');
    }

    const colunas = resolverColunasControle_(sh, [
      EMAIL_EXAME.CAB_NOME,
      EMAIL_EXAME.CAB_EMAIL,
      EMAIL_EXAME.CAB_DATA_EXAME,
      EMAIL_EXAME.CAB_HORARIO,
      EMAIL_EXAME.CAB_LOCAL_EXAME,
      EMAIL_EXAME.CAB_ENDERECO_CIEDS,
      EMAIL_EXAME.CAB_STATUS_AGENDAMENTO
    ]);
    const colunasProprias = prepararColunasControleEmail_(sh);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    const lastCol = Math.max(sh.getLastColumn(), colunasProprias[EMAIL_EXAME.CAB_ERRO_ENVIO]);
    const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let enviados = 0;

    for (let i = 0; i < dados.length; i++) {
      if (enviados >= EMAIL_EXAME.MAX_EMAILS_POR_EXECUCAO) break;

      const row = dados[i];
      const linha = i + 2;

      const nome = texto_(row[colunas[EMAIL_EXAME.CAB_NOME] - 1]);
      const email = texto_(row[colunas[EMAIL_EXAME.CAB_EMAIL] - 1]);
      const dataExame = row[colunas[EMAIL_EXAME.CAB_DATA_EXAME] - 1];
      const status = texto_(row[colunas[EMAIL_EXAME.CAB_STATUS_AGENDAMENTO] - 1]);
      const jaEnviado = row[colunasProprias[EMAIL_EXAME.CAB_EMAIL_ENVIADO] - 1] === true;

      if (
        !nome ||
        !email ||
        !dataExame ||
        normalizar_(status) !== 'AGENDADO' ||
        jaEnviado
      ) {
        continue;
      }

      try {
        const msg = montarEmailExame_(row, colunas);

        MailApp.sendEmail({
          to: msg.para,
          cc: EMAIL_EXAME.EMAIL_CC,
          subject: msg.assunto,
          body: msg.texto,
          htmlBody: msg.html,
          name: EMAIL_EXAME.REMETENTE_NOME
        });

        sh.getRange(linha, colunasProprias[EMAIL_EXAME.CAB_EMAIL_ENVIADO])
          .setValue(true)
          .insertCheckboxes();

        sh.getRange(linha, colunasProprias[EMAIL_EXAME.CAB_EMAIL_ENVIADO_EM])
          .setValue(new Date())
          .setNumberFormat('dd/MM/yyyy HH:mm:ss');

        sh.getRange(linha, colunasProprias[EMAIL_EXAME.CAB_ERRO_ENVIO]).clearContent();

        enviados++;

      } catch (erro) {
        sh.getRange(linha, colunasProprias[EMAIL_EXAME.CAB_ERRO_ENVIO]).setValue(String(erro));
      }
    }

    SpreadsheetApp.flush();

    Logger.log('Emails enviados nesta execucao: ' + enviados);

  } finally {
    lock.releaseLock();
  }
}


/**
 * Opcional: envia SOMENTE o email que esta no preview.
 *
 * Mantive separado por seguranca.
 * Use apenas se quiser testar deliberadamente um envio real.
 */
function enviarEmailDoPreviewParaDestinatarioReal() {
  const liberado = PropertiesService.getScriptProperties()
    .getProperty(EMAIL_EXAME.PROP_LIBERADO);

  if (liberado !== 'SIM') {
    throw new Error(
      'O envio ainda esta bloqueado. Valide o preview e execute liberarEnvioAutomaticoEmailsExame().'
    );
  }

  const preview = garantirAbaPreviewEmail_();

  const destinatario = texto_(preview.getRange('B3').getValue());
  const nome = texto_(preview.getRange('B5').getValue());
  const assunto = texto_(preview.getRange('B6').getValue());
  const corpo = texto_(preview.getRange('A10').getValue());

  if (!destinatario || !assunto || !corpo) {
    throw new Error('O preview nao esta preenchido.');
  }

  MailApp.sendEmail({
    to: destinatario,
    cc: EMAIL_EXAME.EMAIL_CC,
    subject: assunto,
    body: corpo,
    name: EMAIL_EXAME.REMETENTE_NOME
  });

  SpreadsheetApp.getActive().toast(
    'Email do preview enviado para ' + nome + '.',
    'DP360',
    8
  );
}


function montarEmailExame_(row, colunas) {
  const nome = texto_(row[colunas[EMAIL_EXAME.CAB_NOME] - 1]);
  const para = texto_(row[colunas[EMAIL_EXAME.CAB_EMAIL] - 1]);

  const data = converterData_(row[colunas[EMAIL_EXAME.CAB_DATA_EXAME] - 1]);

  const dataTxt = data
    ? Utilities.formatDate(
        data,
        Session.getScriptTimeZone() || 'America/Sao_Paulo',
        'dd/MM/yyyy'
      )
    : '';

  const horario =
    texto_(row[colunas[EMAIL_EXAME.CAB_HORARIO] - 1]) ||
    EMAIL_EXAME.HORARIO_PADRAO;

  const horarioTxt = normalizarHorario_(horario);

  const local =
    texto_(row[colunas[EMAIL_EXAME.CAB_LOCAL_EXAME] - 1]) ||
    EMAIL_EXAME.LOCAL_EXAME_PADRAO;

  const enderecoCieds =
    texto_(row[colunas[EMAIL_EXAME.CAB_ENDERECO_CIEDS] - 1]) ||
    EMAIL_EXAME.ENDERECO_CIEDS_PADRAO;

  const texto =
    'Prezado(a) ' + nomeParaEmail_(nome) + ',\n\n' +
    'Seu exame admissional foi agendado conforme as informações abaixo:\n\n' +
    'Local do exame: ' + local + '\n' +
    'Data: ' + dataTxt + '\n' +
    'Horário: ' + horarioTxt + '\n\n' +
    'Por gentileza, compareça ao local do exame portando RG e CPF.\n\n' +
    'Após a realização do exame admissional, dirija-se ao CIEDS para concluir o seu processo de admissão.\n\n' +
    'Endereço do CIEDS: ' + enderecoCieds + '.\n\n' +
    'Atenciosamente,\n' +
    'Departamento Pessoal - CIEDS';

  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124;line-height:1.6">' +
      '<p>Prezado(a) <strong>' + escaparHtml_(nomeParaEmail_(nome)) + '</strong>,</p>' +
      '<p>Seu exame admissional foi agendado conforme as informações abaixo:</p>' +
      '<p>' +
        '<strong>Local do exame:</strong> ' + escaparHtml_(local) + '<br>' +
        '<strong>Data:</strong> ' + escaparHtml_(dataTxt) + '<br>' +
        '<strong>Horário:</strong> ' + escaparHtml_(horarioTxt) +
      '</p>' +
      '<p>Por gentileza, compareça ao local do exame portando <strong>RG e CPF</strong>.</p>' +
      '<p><strong>Após a realização do exame admissional, dirija-se ao CIEDS para concluir o seu processo de admissão.</strong></p>' +
      '<p><strong>Endereço do CIEDS:</strong> ' + escaparHtml_(enderecoCieds) + '.</p>' +
      '<p>Atenciosamente,<br><strong>Departamento Pessoal - CIEDS</strong></p>' +
    '</div>';

  return {
    nome: nome,
    para: para,
    assunto: EMAIL_EXAME.ASSUNTO,
    texto: texto,
    html: html,
    dataTxt: dataTxt
  };
}


function garantirAbaPreviewEmail_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(EMAIL_EXAME.ABA_PREVIEW);

  if (!sh) {
    sh = ss.insertSheet(EMAIL_EXAME.ABA_PREVIEW);
  }

  return sh;
}


function removerGatilhosEmailExame_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (
      t.getHandlerFunction() ===
      'enviarEmailsExameAdmissional'
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });
}


function normalizarHorario_(valor) {
  if (!valor) return '12h';

  // Quando a célula do Sheets contém somente horário, o Apps Script
  // normalmente devolve um objeto Date em 30/12/1899.
  if (
    Object.prototype.toString.call(valor) === '[object Date]' &&
    !isNaN(valor.getTime())
  ) {
    const hh = Utilities.formatDate(
      valor,
      Session.getScriptTimeZone() || 'America/Sao_Paulo',
      'HH'
    );

    const mm = Utilities.formatDate(
      valor,
      Session.getScriptTimeZone() || 'America/Sao_Paulo',
      'mm'
    );

    const h = Number(hh);

    if (Number(mm) === 0) return h + 'h';
    return h + 'h' + mm;
  }

  const s = texto_(valor);
  if (!s) return '12h';

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const partes = s.split(':');
    const h = Number(partes[0]);
    const m = Number(partes[1]);

    if (m === 0) return h + 'h';
    return h + 'h' + String(m).padStart(2, '0');
  }

  // Caso o Sheets devolva a data-base como texto
  const matchDateText = s.match(/\b(\d{1,2}):(\d{2}):\d{2}\b/);
  if (matchDateText) {
    const h = Number(matchDateText[1]);
    const m = Number(matchDateText[2]);

    if (m === 0) return h + 'h';
    return h + 'h' + String(m).padStart(2, '0');
  }

  return s;
}

function converterData_(valor) {
  if (!valor) return null;

  if (
    Object.prototype.toString.call(valor) === '[object Date]' &&
    !isNaN(valor.getTime())
  ) {
    return new Date(valor.getTime());
  }

  const s = String(valor).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (m) {
    d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1])
    );

    if (!isNaN(d.getTime())) return d;
  }

  return null;
}


function escaparHtml_(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function texto_(v) {
  return String(
    v === null || v === undefined ? '' : v
  ).trim();
}


function normalizar_(v) {
  return texto_(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
