/**
 * DP360 - ENVIO DE EMAILS DE EXAME ADMISSIONAL - LEVA_AMANHA (isolado)
 * ARQUIVO NOVO, SEPARADO DE "Controle Admissao.js"
 *
 * Criado em 2026-09-23 para o novo lote combinado no chat (levas
 * quinta/sexta reorganizadas). E uma COPIA isolada do fluxo de
 * "Controle Admissao.js", apontando pra uma aba propria
 * (CONTROLE_EXAME_LEVA_AMANHA) em vez da aba de producao
 * (CONTROLE_EXAME_ADMISSIONAL).
 *
 * Por que um arquivo/aba separados, e nao reaproveitar a aba de producao:
 * - a aba de producao ja tem 195 pessoas marcadas como "E-mail enviado" de
 *   levas anteriores; misturar lotes na mesma aba arrisca reenviar ou
 *   confundir status de quem ja foi processado.
 * - qualquer erro no fluxo novo fica contido aqui, sem tocar no gatilho
 *   nem nas propriedades do fluxo de producao (PROP_LIBERADO e nome de
 *   gatilho sao proprios deste arquivo).
 *
 * SEGURANCA (igual ao arquivo original):
 * - instalarEnvioEmailsLevaAmanha() NAO envia nenhum email.
 * - o envio automatico nasce BLOQUEADO.
 * - primeiro rode gerarPreviewPrimeiroEmailLevaAmanha().
 * - somente depois de validar o preview, rode liberarEnvioAutomaticoLevaAmanha().
 *
 * Colunas resolvidas por NOME de cabecalho (nao por posicao fixa) - mesma
 * correcao aplicada no arquivo original.
 */

const EMAIL_LEVA_AMANHA = {
  ABA_CONTROLE: 'CONTROLE_EXAME_LEVA_AMANHA',
  ABA_PREVIEW: 'PREVIEW_EMAIL_LEVA_AMANHA',

  PROP_LIBERADO: 'DP360_EMAIL_LEVA_AMANHA_LIBERADO',

  CAB_NOME: 'Nome',
  CAB_EMAIL: 'E-mail',
  CAB_PROTOCOLO: 'Protocolo',
  CAB_DATA_EXAME: 'Data do exame',
  CAB_HORARIO: 'Horário',
  CAB_LOCAL_EXAME: 'Local do exame',
  CAB_ENDERECO_CIEDS: 'Endereço CIEDS',
  CAB_STATUS_AGENDAMENTO: 'Status do agendamento',

  CAB_EMAIL_ENVIADO: 'E-mail enviado',
  CAB_EMAIL_ENVIADO_EM: 'Data/hora envio',
  CAB_ERRO_ENVIO: 'Erro envio',
  CAB_SITUACAO: 'Situação do Envio',

  ASSUNTO: 'Exame Admissional - CIEDS',
  REMETENTE_NOME: 'Departamento Pessoal - CIEDS',
  EMAIL_CC: 'dp@cieds.org.br',
  EMAIL_TESTE: 'taynarasilva2411@gmail.com',

  LOCAL_EXAME_PADRAO: 'Avenida Rio Branco, 116 - 7º andar',
  ENDERECO_CIEDS_PADRAO: 'Rua Presidente Vargas, 417 - 18º andar - Centro',
  HORARIO_PADRAO: '12h',

  MAX_EMAILS_POR_EXECUCAO: 20,

  // Posicao FIXA do painel de botoes, sempre nas mesmas colunas, a direita
  // de tudo (independente de onde as colunas de dados terminarem). Nao usa
  // "proxima coluna livre" para o botao nao "andar" quando novas colunas de
  // dados forem adicionadas.
  COL_BOTAO_ENVIAR_LABEL: 20, // T1
  COL_BOTAO_ENVIAR_CHECK: 21, // U1
  COL_BOTAO_TESTE_LABEL: 22,  // V1
  COL_BOTAO_TESTE_CHECK: 23,  // W1

  HANDLER_ON_EDIT: 'aoEditarBotaoLevaAmanha'
};


function resolverColunasLevaAmanha_(sh, nomesObrigatorios) {
  const ultimaColuna = Math.max(sh.getLastColumn(), 1);
  const cabecalhos = sh.getRange(1, 1, 1, ultimaColuna).getValues()[0];

  const porNome = {};
  cabecalhos.forEach(function (valor, indice) {
    const chave = normalizarLevaAmanha_(valor);
    if (chave && !(chave in porNome)) {
      porNome[chave] = indice + 1;
    }
  });

  const resolvido = {};
  const faltando = [];

  nomesObrigatorios.forEach(function (nome) {
    const coluna = porNome[normalizarLevaAmanha_(nome)];
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


function prepararColunasLevaAmanha_(sh) {
  const cabecalhosProprios = [
    EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO,
    EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO_EM,
    EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO
  ];

  const ultimaColunaAtual = Math.max(sh.getLastColumn(), 1);
  const cabecalhosAtuais = sh.getRange(1, 1, 1, ultimaColunaAtual).getValues()[0];

  const porNome = {};
  cabecalhosAtuais.forEach(function (valor, indice) {
    const chave = normalizarLevaAmanha_(valor);
    if (chave && !(chave in porNome)) {
      porNome[chave] = indice + 1;
    }
  });

  const resultado = {};
  let proximaColunaLivre = ultimaColunaAtual + 1;

  cabecalhosProprios.forEach(function (nome) {
    const chave = normalizarLevaAmanha_(nome);
    if (porNome[chave]) {
      resultado[nome] = porNome[chave];
      return;
    }
    const coluna = proximaColunaLivre;
    sh.getRange(1, coluna).setValue(nome);
    resultado[nome] = coluna;
    proximaColunaLivre += 1;
  });

  const colEnviado = resultado[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO];
  const colEnviadoEm = resultado[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO_EM];
  const colErro = resultado[EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO];

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
 * EXECUTAR UMA VEZ, depois que a aba CONTROLE_EXAME_LEVA_AMANHA existir e
 * estiver preenchida (Nome, E-mail, Protocolo, Data do exame, Horário,
 * Local do exame, Status do agendamento = AGENDADO).
 *
 * NAO envia email e NAO instala gatilho de envio.
 */
function instalarEnvioEmailsLevaAmanha() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);

  if (!sh) {
    throw new Error(
      'A aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE +
      ' nao foi encontrada.'
    );
  }

  prepararColunasLevaAmanha_(sh);
  garantirAbaPreviewLevaAmanha_();
  configurarPainelLevaAmanha_(sh);
  atualizarSituacaoEnvioLevaAmanha_(sh);

  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_LEVA_AMANHA.PROP_LIBERADO, 'NAO');

  removerGatilhosLevaAmanha_();
  instalarGatilhoEdicaoLevaAmanha_();

  ss.toast(
    'Modulo LEVA_AMANHA instalado em modo seguro. Nenhum e-mail foi enviado. Agora execute gerarPreviewPrimeiroEmailLevaAmanha().',
    'DP360',
    10
  );
}


/**
 * Deixa a linha 1 (cabecalho) sempre visivel ao rolar, e monta o painel de
 * botoes (checkbox) em posicao fixa: "ENVIAR E-MAILS" e "TESTE (so pra
 * mim)". Idempotente - pode rodar de novo sem duplicar nada.
 */
function configurarPainelLevaAmanha_(sh) {
  sh.setFrozenRows(1);

  const ultimaColunaDados = Math.max(
    sh.getLastColumn(),
    EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_CHECK
  );
  sh.getRange(1, 1, 1, ultimaColunaDados)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF');

  const labelEnviar = sh.getRange(1, EMAIL_LEVA_AMANHA.COL_BOTAO_ENVIAR_LABEL);
  if (!textoLevaAmanha_(labelEnviar.getValue())) {
    labelEnviar.setValue('▶ CLIQUE NO CHECKBOX AO LADO PARA ENVIAR E-MAILS');
  }
  const checkEnviar = sh.getRange(1, EMAIL_LEVA_AMANHA.COL_BOTAO_ENVIAR_CHECK);
  if (typeof checkEnviar.getValue() !== 'boolean') {
    checkEnviar.insertCheckboxes().setValue(false);
  }
  sh.setColumnWidth(EMAIL_LEVA_AMANHA.COL_BOTAO_ENVIAR_LABEL, 320);
  sh.setColumnWidth(EMAIL_LEVA_AMANHA.COL_BOTAO_ENVIAR_CHECK, 40);

  const labelTeste = sh.getRange(1, EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_LABEL);
  if (!textoLevaAmanha_(labelTeste.getValue())) {
    labelTeste.setValue('▶ TESTE - envia 1 e-mail de exemplo só pra mim');
  }
  const checkTeste = sh.getRange(1, EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_CHECK);
  if (typeof checkTeste.getValue() !== 'boolean') {
    checkTeste.insertCheckboxes().setValue(false);
  }
  sh.setColumnWidth(EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_LABEL, 300);
  sh.setColumnWidth(EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_CHECK, 40);
}


/**
 * Gatilho instalavel de edicao (precisa ser instalavel, nao simples, porque
 * o botao de envio real chama MailApp, que gatilho simples onEdit(e) nao
 * tem permissao de usar). Nome de handler exclusivo deste arquivo - nao
 * colide com nenhum outro onEdit do projeto.
 */
function instalarGatilhoEdicaoLevaAmanha_() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === EMAIL_LEVA_AMANHA.HANDLER_ON_EDIT) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(EMAIL_LEVA_AMANHA.HANDLER_ON_EDIT)
    .forSpreadsheet(ss)
    .onEdit()
    .create();
}


/**
 * Handler do gatilho instalavel. So reage a edicao exatamente nos dois
 * checkboxes do painel, e so quando o valor virou TRUE (marcado). Depois de
 * agir, desmarca o checkbox de volta (assim ele funciona como um botao, nao
 * como um estado permanente).
 */
function aoEditarBotaoLevaAmanha(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== EMAIL_LEVA_AMANHA.ABA_CONTROLE) return;
  if (e.range.getRow() !== 1) return;
  if (e.value !== 'TRUE') return;

  const coluna = e.range.getColumn();

  if (coluna === EMAIL_LEVA_AMANHA.COL_BOTAO_ENVIAR_CHECK) {
    try {
      enviarEmailsLevaAmanha();
    } finally {
      e.range.setValue(false);
      atualizarSituacaoEnvioLevaAmanha_(sh);
    }
    return;
  }

  if (coluna === EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_CHECK) {
    try {
      enviarEmailTesteLevaAmanha_();
    } finally {
      e.range.setValue(false);
    }
    return;
  }
}


/**
 * Envia UM e-mail de teste (com o conteudo do primeiro colaborador
 * elegivel, ou um exemplo generico se nao houver nenhum ainda pronto) SOMENTE
 * para EMAIL_LEVA_AMANHA.EMAIL_TESTE. Nao marca nenhuma linha como enviada -
 * e so um teste de conteudo/entrega.
 */
function enviarEmailTesteLevaAmanha_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);
  if (!sh) throw new Error('A aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE + ' nao foi encontrada.');

  let msg;
  const lastRow = sh.getLastRow();

  if (lastRow >= 2) {
    const colunas = resolverColunasLevaAmanha_(sh, [
      EMAIL_LEVA_AMANHA.CAB_NOME,
      EMAIL_LEVA_AMANHA.CAB_EMAIL,
      EMAIL_LEVA_AMANHA.CAB_DATA_EXAME,
      EMAIL_LEVA_AMANHA.CAB_HORARIO,
      EMAIL_LEVA_AMANHA.CAB_LOCAL_EXAME,
      EMAIL_LEVA_AMANHA.CAB_ENDERECO_CIEDS,
      EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO
    ]);
    const lastCol = Math.max(sh.getLastColumn(), EMAIL_LEVA_AMANHA.COL_BOTAO_TESTE_CHECK);
    const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let linhaEscolhida = dados[0];
    for (let i = 0; i < dados.length; i++) {
      const nome = textoLevaAmanha_(dados[i][colunas[EMAIL_LEVA_AMANHA.CAB_NOME] - 1]);
      if (nome) { linhaEscolhida = dados[i]; break; }
    }
    msg = montarEmailLevaAmanha_(linhaEscolhida, colunas);
  } else {
    msg = {
      nome: 'Exemplo de Teste',
      assunto: EMAIL_LEVA_AMANHA.ASSUNTO,
      texto: 'Este e um e-mail de teste do modulo LEVA_AMANHA. Nenhum colaborador cadastrado ainda.',
      html: '<p>Este e um e-mail de teste do modulo LEVA_AMANHA. Nenhum colaborador cadastrado ainda.</p>'
    };
  }

  MailApp.sendEmail({
    to: EMAIL_LEVA_AMANHA.EMAIL_TESTE,
    subject: '[TESTE] ' + msg.assunto,
    body: '(ESTE E UM TESTE - nao e um agendamento real)\n\n' + msg.texto,
    htmlBody: '<p><strong>(ESTE E UM TESTE - nao e um agendamento real)</strong></p>' + msg.html,
    name: EMAIL_LEVA_AMANHA.REMETENTE_NOME
  });

  SpreadsheetApp.getActive().toast(
    'E-mail de teste enviado para ' + EMAIL_LEVA_AMANHA.EMAIL_TESTE + '.',
    'DP360',
    8
  );
}


/**
 * Recalcula a coluna "Situação do Envio" com valor LITERAL (nao formula -
 * de proposito, depois do problema de formula quebrada/#REF! na planilha de
 * producao, este modulo evita formula em qualquer coluna propria). Estados:
 * "JA ENVIADO", "PRONTO PARA ENVIAR", "NAO ENVIAR (dados incompletos ou nao
 * agendado)".
 */
function atualizarSituacaoEnvioLevaAmanha_(sh) {
  const colunas = resolverColunasLevaAmanha_(sh, [
    EMAIL_LEVA_AMANHA.CAB_NOME,
    EMAIL_LEVA_AMANHA.CAB_EMAIL,
    EMAIL_LEVA_AMANHA.CAB_DATA_EXAME,
    EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO
  ]);
  const colunasProprias = prepararColunasLevaAmanha_(sh);

  let colSituacao = colunasProprias[EMAIL_LEVA_AMANHA.CAB_SITUACAO];
  if (!colSituacao) {
    const ultimaColuna = sh.getLastColumn();
    const cabecalhos = sh.getRange(1, 1, 1, ultimaColuna).getValues()[0];
    const jaExiste = cabecalhos.findIndex(function (h) {
      return normalizarLevaAmanha_(h) === normalizarLevaAmanha_(EMAIL_LEVA_AMANHA.CAB_SITUACAO);
    });
    colSituacao = jaExiste >= 0 ? jaExiste + 1 : ultimaColuna + 1;
    sh.getRange(1, colSituacao).setValue(EMAIL_LEVA_AMANHA.CAB_SITUACAO);
    sh.setColumnWidth(colSituacao, 260);
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return colSituacao;

  const lastCol = Math.max(sh.getLastColumn(), colSituacao);
  const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const situacoes = dados.map(function (row) {
    const nome = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_NOME] - 1]);
    const email = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_EMAIL] - 1]);
    const dataExame = row[colunas[EMAIL_LEVA_AMANHA.CAB_DATA_EXAME] - 1];
    const status = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO] - 1]);
    const jaEnviado = row[colunasProprias[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO] - 1] === true;

    if (!nome) return [''];
    if (jaEnviado) return ['JA ENVIADO'];
    if (email && dataExame && normalizarLevaAmanha_(status) === 'AGENDADO') {
      return ['PRONTO PARA ENVIAR'];
    }
    return ['NAO ENVIAR (dados incompletos ou nao agendado)'];
  });

  sh.getRange(2, colSituacao, situacoes.length, 1).setValues(situacoes);
  return colSituacao;
}


function gerarPreviewPrimeiroEmailLevaAmanha() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);

  if (!sh) {
    throw new Error('A aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE + ' nao foi encontrada.');
  }

  const colunas = resolverColunasLevaAmanha_(sh, [
    EMAIL_LEVA_AMANHA.CAB_NOME,
    EMAIL_LEVA_AMANHA.CAB_EMAIL,
    EMAIL_LEVA_AMANHA.CAB_DATA_EXAME,
    EMAIL_LEVA_AMANHA.CAB_HORARIO,
    EMAIL_LEVA_AMANHA.CAB_LOCAL_EXAME,
    EMAIL_LEVA_AMANHA.CAB_ENDERECO_CIEDS,
    EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO
  ]);
  const colunasProprias = prepararColunasLevaAmanha_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('Nao ha colaboradores na aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE + '.');
  }

  const lastCol = Math.max(sh.getLastColumn(), colunasProprias[EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO]);
  const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let escolhido = null;
  let linhaEscolhida = null;

  for (let i = 0; i < dados.length; i++) {
    const row = dados[i];

    const nome = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_NOME] - 1]);
    const email = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_EMAIL] - 1]);
    const dataExame = row[colunas[EMAIL_LEVA_AMANHA.CAB_DATA_EXAME] - 1];
    const status = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO] - 1]);
    const enviado = row[colunasProprias[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO] - 1] === true;

    if (
      nome &&
      email &&
      dataExame &&
      normalizarLevaAmanha_(status) === 'AGENDADO' &&
      !enviado
    ) {
      escolhido = montarEmailLevaAmanha_(row, colunas);
      linhaEscolhida = i + 2;
      break;
    }
  }

  if (!escolhido) {
    throw new Error(
      'Nao encontrei colaborador AGENDADO, com e-mail preenchido e ainda nao enviado em ' +
      EMAIL_LEVA_AMANHA.ABA_CONTROLE + '.'
    );
  }

  const preview = garantirAbaPreviewLevaAmanha_();
  preview.clear();

  preview.getRange('A1:B1')
    .setValues([['PREVIEW DO EMAIL - LEVA AMANHA', 'VALOR']])
    .setBackground('#333333')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  preview.getRange('A2:B7').setValues([
    ['Linha no controle', linhaEscolhida],
    ['Destinatario', escolhido.para],
    ['Copia (CC)', EMAIL_LEVA_AMANHA.EMAIL_CC],
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
    'PREVIEW APENAS - NENHUM EMAIL FOI ENVIADO - CC: ' + EMAIL_LEVA_AMANHA.EMAIL_CC
  );
  preview.getRange('B12').setFontWeight('bold');

  SpreadsheetApp.flush();

  ss.toast(
    'Preview criado na aba ' + EMAIL_LEVA_AMANHA.ABA_PREVIEW + '. Nenhum e-mail foi enviado.',
    'DP360',
    8
  );

  return escolhido;
}


/**
 * Funcoes "de operacao" pensadas para rodar direto pelo EDITOR do Apps
 * Script (seletor de funcao + Executar), sem precisar clicar em nada na
 * planilha. Tudo aqui e so uma casca fina sobre as funcoes que ja existem
 * acima - nao reimplementa nada.
 */

/** Roda esta primeiro: mostra quantos estao PRONTO/JA ENVIADO/NAO ENVIAR. */
function LEVA_AMANHA_verSituacao() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);
  if (!sh) throw new Error('A aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE + ' nao foi encontrada.');

  const colSituacao = atualizarSituacaoEnvioLevaAmanha_(sh);
  const lastRow = sh.getLastRow();

  const contagem = {};
  if (lastRow >= 2) {
    const valores = sh.getRange(2, colSituacao, lastRow - 1, 1).getValues();
    valores.forEach(function (linha) {
      const situacao = textoLevaAmanha_(linha[0]);
      if (!situacao) return;
      contagem[situacao] = (contagem[situacao] || 0) + 1;
    });
  }

  const linhas = Object.keys(contagem).map(function (k) { return k + ': ' + contagem[k]; });
  const resumo = linhas.length ? linhas.join('\n') : '(nenhuma linha com nome preenchido ainda)';

  Logger.log(resumo);
  ss.toast(resumo.replace(/\n/g, ' | '), 'LEVA_AMANHA - situacao', 15);
  return contagem;
}


/** Roda esta segunda: manda 1 e-mail de exemplo SO para taynarasilva2411@gmail.com. */
function LEVA_AMANHA_enviarTeste() {
  enviarEmailTesteLevaAmanha_();
}


/**
 * Roda esta terceira, so depois de conferir o teste: libera o envio (se
 * ainda nao estiver liberado) e dispara o envio real agora mesmo (ate 20
 * pessoas nesta execucao - se sobrar mais gente PRONTO PARA ENVIAR, o
 * gatilho de 1 em 1 minuto continua mandando o resto sozinho).
 */
function LEVA_AMANHA_enviarDeVerdadeAgora() {
  const liberado = PropertiesService.getScriptProperties()
    .getProperty(EMAIL_LEVA_AMANHA.PROP_LIBERADO);

  if (liberado !== 'SIM') {
    liberarEnvioAutomaticoLevaAmanha();
  }

  enviarEmailsLevaAmanha();

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);
  atualizarSituacaoEnvioLevaAmanha_(sh);

  LEVA_AMANHA_verSituacao();
}


/** Para o envio automatico a qualquer momento (o gatilho de 1 em 1 minuto). */
function LEVA_AMANHA_pararEnvio() {
  pausarEnvioAutomaticoLevaAmanha();
}


function liberarEnvioAutomaticoLevaAmanha() {
  const ss = SpreadsheetApp.getActive();

  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_LEVA_AMANHA.PROP_LIBERADO, 'SIM');

  removerGatilhosLevaAmanha_();

  ScriptApp.newTrigger('enviarEmailsLevaAmanha')
    .timeBased()
    .everyMinutes(1)
    .create();

  ss.toast(
    'Envio automatico LEVA_AMANHA LIBERADO. O sistema verificara novos agendamentos a cada 1 minuto.',
    'DP360',
    10
  );
}


function pausarEnvioAutomaticoLevaAmanha() {
  PropertiesService.getScriptProperties()
    .setProperty(EMAIL_LEVA_AMANHA.PROP_LIBERADO, 'NAO');

  removerGatilhosLevaAmanha_();

  SpreadsheetApp.getActive().toast(
    'Envio automatico LEVA_AMANHA PAUSADO.',
    'DP360',
    8
  );
}


function enviarEmailsLevaAmanha() {
  const liberado = PropertiesService.getScriptProperties()
    .getProperty(EMAIL_LEVA_AMANHA.PROP_LIBERADO);

  if (liberado !== 'SIM') {
    Logger.log('Envio LEVA_AMANHA bloqueado. Execute liberarEnvioAutomaticoLevaAmanha() apos validar o preview.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_CONTROLE);

    if (!sh) {
      throw new Error('A aba ' + EMAIL_LEVA_AMANHA.ABA_CONTROLE + ' nao foi encontrada.');
    }

    const colunas = resolverColunasLevaAmanha_(sh, [
      EMAIL_LEVA_AMANHA.CAB_NOME,
      EMAIL_LEVA_AMANHA.CAB_EMAIL,
      EMAIL_LEVA_AMANHA.CAB_DATA_EXAME,
      EMAIL_LEVA_AMANHA.CAB_HORARIO,
      EMAIL_LEVA_AMANHA.CAB_LOCAL_EXAME,
      EMAIL_LEVA_AMANHA.CAB_ENDERECO_CIEDS,
      EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO
    ]);
    const colunasProprias = prepararColunasLevaAmanha_(sh);

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    const lastCol = Math.max(sh.getLastColumn(), colunasProprias[EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO]);
    const dados = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let enviados = 0;

    for (let i = 0; i < dados.length; i++) {
      if (enviados >= EMAIL_LEVA_AMANHA.MAX_EMAILS_POR_EXECUCAO) break;

      const row = dados[i];
      const linha = i + 2;

      const nome = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_NOME] - 1]);
      const email = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_EMAIL] - 1]);
      const dataExame = row[colunas[EMAIL_LEVA_AMANHA.CAB_DATA_EXAME] - 1];
      const status = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_STATUS_AGENDAMENTO] - 1]);
      const jaEnviado = row[colunasProprias[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO] - 1] === true;

      if (
        !nome ||
        !email ||
        !dataExame ||
        normalizarLevaAmanha_(status) !== 'AGENDADO' ||
        jaEnviado
      ) {
        continue;
      }

      try {
        const msg = montarEmailLevaAmanha_(row, colunas);

        MailApp.sendEmail({
          to: msg.para,
          cc: EMAIL_LEVA_AMANHA.EMAIL_CC,
          subject: msg.assunto,
          body: msg.texto,
          htmlBody: msg.html,
          name: EMAIL_LEVA_AMANHA.REMETENTE_NOME
        });

        sh.getRange(linha, colunasProprias[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO])
          .setValue(true)
          .insertCheckboxes();

        sh.getRange(linha, colunasProprias[EMAIL_LEVA_AMANHA.CAB_EMAIL_ENVIADO_EM])
          .setValue(new Date())
          .setNumberFormat('dd/MM/yyyy HH:mm:ss');

        sh.getRange(linha, colunasProprias[EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO]).clearContent();

        enviados++;

      } catch (erro) {
        sh.getRange(linha, colunasProprias[EMAIL_LEVA_AMANHA.CAB_ERRO_ENVIO]).setValue(String(erro));
      }
    }

    SpreadsheetApp.flush();
    Logger.log('LEVA_AMANHA: emails enviados nesta execucao: ' + enviados);

  } finally {
    lock.releaseLock();
  }
}


function montarEmailLevaAmanha_(row, colunas) {
  const nome = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_NOME] - 1]);
  const para = textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_EMAIL] - 1]);

  const data = converterDataLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_DATA_EXAME] - 1]);

  const dataTxt = data
    ? Utilities.formatDate(
        data,
        Session.getScriptTimeZone() || 'America/Sao_Paulo',
        'dd/MM/yyyy'
      )
    : '';

  const horario =
    textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_HORARIO] - 1]) ||
    EMAIL_LEVA_AMANHA.HORARIO_PADRAO;

  const horarioTxt = normalizarHorarioLevaAmanha_(horario);

  const local =
    textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_LOCAL_EXAME] - 1]) ||
    EMAIL_LEVA_AMANHA.LOCAL_EXAME_PADRAO;

  const enderecoCieds =
    textoLevaAmanha_(row[colunas[EMAIL_LEVA_AMANHA.CAB_ENDERECO_CIEDS] - 1]) ||
    EMAIL_LEVA_AMANHA.ENDERECO_CIEDS_PADRAO;

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
      '<p>Prezado(a) <strong>' + escaparHtmlLevaAmanha_(nomeParaEmail_(nome)) + '</strong>,</p>' +
      '<p>Seu exame admissional foi agendado conforme as informações abaixo:</p>' +
      '<p>' +
        '<strong>Local do exame:</strong> ' + escaparHtmlLevaAmanha_(local) + '<br>' +
        '<strong>Data:</strong> ' + escaparHtmlLevaAmanha_(dataTxt) + '<br>' +
        '<strong>Horário:</strong> ' + escaparHtmlLevaAmanha_(horarioTxt) +
      '</p>' +
      '<p>Por gentileza, compareça ao local do exame portando <strong>RG e CPF</strong>.</p>' +
      '<p><strong>Após a realização do exame admissional, dirija-se ao CIEDS para concluir o seu processo de admissão.</strong></p>' +
      '<p><strong>Endereço do CIEDS:</strong> ' + escaparHtmlLevaAmanha_(enderecoCieds) + '.</p>' +
      '<p>Atenciosamente,<br><strong>Departamento Pessoal - CIEDS</strong></p>' +
    '</div>';

  return {
    nome: nome,
    para: para,
    assunto: EMAIL_LEVA_AMANHA.ASSUNTO,
    texto: texto,
    html: html,
    dataTxt: dataTxt
  };
}


function garantirAbaPreviewLevaAmanha_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(EMAIL_LEVA_AMANHA.ABA_PREVIEW);

  if (!sh) {
    sh = ss.insertSheet(EMAIL_LEVA_AMANHA.ABA_PREVIEW);
  }

  return sh;
}


function removerGatilhosLevaAmanha_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'enviarEmailsLevaAmanha') {
      ScriptApp.deleteTrigger(t);
    }
  });
}


function normalizarHorarioLevaAmanha_(valor) {
  if (!valor) return '12h';

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

  const s = textoLevaAmanha_(valor);
  if (!s) return '12h';

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const partes = s.split(':');
    const h = Number(partes[0]);
    const m = Number(partes[1]);

    if (m === 0) return h + 'h';
    return h + 'h' + String(m).padStart(2, '0');
  }

  const matchDateText = s.match(/\b(\d{1,2}):(\d{2}):\d{2}\b/);
  if (matchDateText) {
    const h = Number(matchDateText[1]);
    const m = Number(matchDateText[2]);

    if (m === 0) return h + 'h';
    return h + 'h' + String(m).padStart(2, '0');
  }

  return s;
}

function converterDataLevaAmanha_(valor) {
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


function escaparHtmlLevaAmanha_(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function textoLevaAmanha_(v) {
  return String(
    v === null || v === undefined ? '' : v
  ).trim();
}


function normalizarLevaAmanha_(v) {
  return textoLevaAmanha_(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
