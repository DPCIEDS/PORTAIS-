/**
 * DP360 - E-MAIL AUTOMATICO DO TERMO DE PENDENCIA (7 DIAS)
 * Mesmo projeto Apps Script da planilha DATABASE (junto com Código.js e Espelho.js).
 *
 * O QUE FAZ:
 * - Monitora a aba CHECKLIST_ADMISSAO a cada 30 minutos (UNICO gatilho
 *   desta automacao; nao mexe no gatilho de 1 minuto do Código.js).
 * - Quando a coluna "Termo pendencia 7 dias" estiver marcada (checkbox = TRUE)
 *   e existir um arquivo em "Link termo pendencia", envia um e-mail para a
 *   pessoa (colunas "Nome" e "E-mail") anexando o Termo de Pendencia e
 *   pedindo o envio dos documentos faltantes para dp@cieds.org.br.
 * - Toda mensagem enviada vai com copia (Cc) para dp@cieds.org.br.
 * - O lembrete se REPETE a cada ciclo de 30 minutos, pessoa por pessoa,
 *   ate que uma das duas coisas aconteca primeiro:
 *     a) a coluna "Documentos completos" daquela pessoa fique marcada
 *        (ela concluiu o envio); ou
 *     b) o prazo geral EMAILPEND.ULTIMO_INSTANTE_ENVIO (23/09/2026) passe,
 *        quando entao o gatilho automatico e removido para todo mundo.
 * - Cada envio fica registrado (historico/auditoria) na aba oculta
 *   EMAILPEND.ABA_LOG, mas esse registro NAO impede o reenvio.
 *
 * COMO USAR (1x):
 * 1) Execute instalarEmailTermoPendencia() e autorize.
 * 2) Pronto: a partir daí roda sozinho a cada 30 minutos.
 *    (tambem da pra rodar na hora pelo menu "DP360 - Checklist").
 */

const EMAILPEND = {
  ABA_CHECKLIST: 'CHECKLIST_ADMISSAO',
  ABA_LOG: 'LOG_EMAILS_TERMO_PENDENCIA',

  CAMPO_NOME: 'Nome',
  CAMPO_EMAIL: 'E-mail',
  CAMPO_PROTOCOLO: 'Protocolo',
  CAMPO_TERMO_FLAG: 'Termo pendencia 7 dias',
  CAMPO_TERMO_URL: 'Link termo pendencia',
  CAMPO_FALTANTES: 'Documentos faltantes',
  CAMPO_DOCS_COMPLETOS: 'Documentos completos',

  EMAIL_DP: 'dp@cieds.org.br',
  INTERVALO_MINUTOS: 30,

  // Prazo fixo informado para esta rodada de cobranca (em vez do prazo
  // individual de 7 dias calculado por pessoa). Ajuste ou remova esta
  // data quando ela passar, senao o e-mail vai citar uma data no passado.
  PRAZO_FIXO: new Date(2026, 8, 23),

  // A partir deste instante o script para de enviar e-mails deste tipo
  // (nao pode mandar e-mail como este apos 23/09) e remove o proprio
  // gatilho automatico. Fim do dia 23/09/2026.
  ULTIMO_INSTANTE_ENVIO: new Date(2026, 8, 23, 23, 59, 59),

  CABECALHOS_LOG: ['Nome', 'E-mail', 'Protocolo', 'Link termo pendencia', 'Data envio']
};

function instalarEmailTermoPendencia() {
  obterOuCriarLogEmailPendencia_();

  if (_epPrazoEncerrado_()) {
    SpreadsheetApp.getActive().toast(
      'O prazo para este envio (ate ' + _epFormatarData_(EMAILPEND.ULTIMO_INSTANTE_ENVIO) +
        ') ja passou. Nenhuma automacao de envio foi instalada.',
      'DP360',
      8
    );
    return;
  }

  enviarEmailsTermoPendencia();
  instalarTriggerEmailPendencia_();
  SpreadsheetApp.getActive().toast(
    'E-mail automatico do Termo de Pendencia instalado. Verificacao a cada ' +
      EMAILPEND.INTERVALO_MINUTOS + ' minutos, ate ' + _epFormatarData_(EMAILPEND.ULTIMO_INSTANTE_ENVIO) + '.',
    'DP360',
    6
  );
}

function instalarTriggerEmailPendencia_() {
  _epRemoverTriggerEnvio_();
  ScriptApp.newTrigger('enviarEmailsTermoPendencia').timeBased().everyMinutes(EMAILPEND.INTERVALO_MINUTOS).create();
}

function _epRemoverTriggerEnvio_() {
  const fn = 'enviarEmailsTermoPendencia';
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}

function _epPrazoEncerrado_() {
  return new Date().getTime() > EMAILPEND.ULTIMO_INSTANTE_ENVIO.getTime();
}

function _epFormatarData_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'dd/MM/yyyy');
}

function enviarEmailsTermoPendenciaAgora() {
  if (_epPrazoEncerrado_()) {
    SpreadsheetApp.getActive().toast(
      'O prazo para este envio (ate ' + _epFormatarData_(EMAILPEND.ULTIMO_INSTANTE_ENVIO) +
        ') ja passou. Nenhum e-mail sera enviado.',
      'DP360',
      8
    );
    return;
  }
  const qtd = enviarEmailsTermoPendencia();
  SpreadsheetApp.getActive().toast(
    qtd > 0 ? (qtd + ' e-mail(s) de pendencia enviado(s).') : 'Nenhum e-mail novo para enviar.',
    'DP360',
    6
  );
}

/**
 * Retorna a quantidade de e-mails enviados nesta execucao.
 * Reenvia a cada ciclo para quem ainda estiver com o termo pendente,
 * ate que "Documentos completos" fique marcado para aquela pessoa.
 * Nao envia nada apos EMAILPEND.ULTIMO_INSTANTE_ENVIO (e desinstala o
 * proprio gatilho automatico quando detecta que o prazo passou).
 */
function enviarEmailsTermoPendencia() {
  if (_epPrazoEncerrado_()) {
    _epRemoverTriggerEnvio_();
    return 0;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(EMAILPEND.ABA_CHECKLIST);
    if (!sh) return 0;

    const linhas = lerComoObjetos_(sh);
    if (!linhas.length) return 0;

    const shLog = obterOuCriarLogEmailPendencia_();
    let enviados = 0;

    linhas.forEach(row => {
      const flag = bool_(row[EMAILPEND.CAMPO_TERMO_FLAG]);
      const termoUrl = txt_(row[EMAILPEND.CAMPO_TERMO_URL]);
      const docsCompletos = bool_(row[EMAILPEND.CAMPO_DOCS_COMPLETOS]);
      // Para de insistir assim que a pessoa completar os documentos.
      if (!flag || !termoUrl || docsCompletos) return;

      const nome = txt_(row[EMAILPEND.CAMPO_NOME]);
      const email = normalizarEmail_(row[EMAILPEND.CAMPO_EMAIL]);
      if (!nome || !email || email.indexOf('@') < 0) return;

      try {
        enviarUmEmailTermoPendencia_(row, nome, email, termoUrl);
        registrarEmailEnviado_(shLog, nome, email, txt_(row[EMAILPEND.CAMPO_PROTOCOLO]), termoUrl);
        enviados++;
      } catch (e) {
        console.error('Falha ao enviar e-mail de pendencia para ' + nome + ' (' + email + '): ' + e.stack);
      }
    });

    return enviados;
  } finally {
    lock.releaseLock();
  }
}

function enviarUmEmailTermoPendencia_(row, nome, email, termoUrl) {
  const faltantesTxt = txt_(row[EMAILPEND.CAMPO_FALTANTES]);
  const faltantes = faltantesTxt ? faltantesTxt.split(';').map(s => s.trim()).filter(Boolean) : [];

  const prazoTxt = _epFormatarData_(EMAILPEND.PRAZO_FIXO);

  const listaHtml = faltantes.length
    ? '<ul style="margin:8px 0 8px 20px;padding:0;">' +
        faltantes.map(d => '<li style="margin-bottom:4px;">' + _epEscapeHtml_(d) + '</li>').join('') +
      '</ul>'
    : '<p>os documentos relacionados no Termo de Pendencia em anexo</p>';

  const prazoLinha = '<p>Solicitamos o envio dos documentos pendentes ate o dia <strong>' + prazoTxt + '</strong>.</p>';

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:#000000;">' +
    '<p>Prezado(a) ' + _epEscapeHtml_(nomeParaEmail_(nome)) + ',</p>' +
    '<p>Na conferencia dos documentos apresentados para o seu processo admissional junto ao CIEDS, ' +
    'identificamos que a relacao documental ainda nao esta completa. Segue em anexo o Termo de Pendencia Documental.</p>' +
    '<p>Documentos pendentes:</p>' +
    listaHtml +
    prazoLinha +
    '<p>Por favor, envie os documentos pendentes diretamente para o e-mail <strong>' + EMAILPEND.EMAIL_DP + '</strong>.</p>' +
    '<p>Qualquer duvida, estamos a disposicao.</p>' +
    '<p>Atenciosamente,<br>Departamento Pessoal &middot; CIEDS</p>' +
    '</div>';

  const anexos = [];
  try {
    const id = extrairIdDrive_(termoUrl);
    if (id) anexos.push(DriveApp.getFileById(id).getBlob().setName('Termo_Pendencia_' + limparNomeArquivo_(nome) + '.pdf'));
  } catch (e) {
    console.error('Nao foi possivel anexar o Termo de Pendencia de ' + nome + ': ' + e);
  }

  MailApp.sendEmail({
    to: email,
    cc: EMAILPEND.EMAIL_DP,
    subject: 'Pendencia de Documentos Admissionais - ' + nome,
    htmlBody: html,
    attachments: anexos
  });
}

function obterOuCriarLogEmailPendencia_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(EMAILPEND.ABA_LOG);
  if (!sh) {
    sh = ss.insertSheet(EMAILPEND.ABA_LOG);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  // Garante o cabecalho atual (cobre tambem uma versao anterior do log,
  // que tinha uma coluna "Chave" a mais).
  const atual = sh.getRange(1, 1, 1, EMAILPEND.CABECALHOS_LOG.length).getValues()[0];
  if (atual.join('|') !== EMAILPEND.CABECALHOS_LOG.join('|')) {
    sh.getRange(1, 1, 1, EMAILPEND.CABECALHOS_LOG.length).setValues([EMAILPEND.CABECALHOS_LOG]);
  }
  return sh;
}

function registrarEmailEnviado_(shLog, nome, email, protocolo, termoUrl) {
  shLog.appendRow([nome, email, protocolo, termoUrl, new Date()]);
}

function _epEscapeHtml_(s) {
  return txt_(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
