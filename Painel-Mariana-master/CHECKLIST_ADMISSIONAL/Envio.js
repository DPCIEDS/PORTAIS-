const ID_MODELO_CARTA = '15Q0OK88ev5CjRQXrSuCvL100oCuU1ZuPPCB2g0y8BfA'; 
const ID_FORMULARIO_BRADESCO = '1VmSevuwTDjMAqIYEabV_TdDiFvKMHNm4';
const CC_EMAILS = 'atendimentovip@yiabroker.com.br, dp@cieds.org.br, anaqueiroz.rj@cieds.org.br, paulogabriel.rj@cieds.org.br';
const LOTACOES_PERMITIDAS = ["COLETIVO APRENDIZ PRUDENTIAL", "PRUDENTIAL SP", "COLETIVO APRENDIZ BRUNEL ENERGY"];
const NOME_ABA = "ADMISSÃO/2026";

function dispararEnvioLotação(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();
  const valorAlterado = e.value;

  if (sheet.getName() !== NOME_ABA) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return h.toString().trim(); });
  const col = {
    lotacao: headers.indexOf("LOTAÇÃO") + 1,
    email: headers.indexOf("EMAIL") + 1,
    status: headers.indexOf("STATUS ENVIO DE EMAIL") + 1,
    nome: headers.indexOf("NOME") + 1,
    dataAdm: headers.indexOf("DATA DE ADMISSÃO") + 1
  };

  if (range.getColumn() === col.lotacao && LOTACOES_PERMITIDAS.indexOf(valorAlterado) !== -1) {
    
    const linha = range.getRow();
    const celulaStatus = sheet.getRange(linha, col.status);
    const celulaEmail = sheet.getRange(linha, col.email);
    const nomeCandidato = sheet.getRange(linha, col.nome).getValue();

    const ui = SpreadsheetApp.getUi();
    const resposta = ui.prompt(
      '📍 Envio de E-mail para a inclusão de plano de saúde',
      'Informe o e-mail do colaborador: ' + nomeCandidato,
      ui.ButtonSet.OK_CANCEL
    );

    if (resposta.getSelectedButton() === ui.Button.OK) {
      const emailDigitado = resposta.getResponseText().trim();

      if (emailDigitado.indexOf('@') === -1) {
        ui.alert("Erro: O e-mail digitado parece inválido.");
        return;
      }

      try {
        celulaStatus.setValue("⏳ Enviando...");
        celulaEmail.setValue(emailDigitado);

        const dadosLinha = sheet.getRange(linha, 1, 1, sheet.getLastColumn()).getValues()[0];
        const colConfigZeroBase = {};
        for (let chave in col) { colConfigZeroBase[chave] = col[chave] - 1; }

        enviarEmailCandidato(dadosLinha, colConfigZeroBase);

        const agora = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy HH:mm");
        celulaStatus.setValue("✅ ENVIADO em " + agora);
        
      } catch (erro) {
        ui.alert("Erro técnico: " + erro.message);
        celulaStatus.setValue("❌ Erro no envio");
      }
    }
  }
}

function enviarEmailCandidato(row, colConfig) {
  const nome = row[colConfig.nome];
  const email = row[colConfig.email];
  const dataAdm = row[colConfig.dataAdm];

  let dataFormatada = dataAdm;
  if (dataAdm instanceof Date) {
    dataFormatada = Utilities.formatDate(dataAdm, "GMT-3", 'dd/MM/yyyy');
  }

  const templateFile = DriveApp.getFileById(ID_MODELO_CARTA);
  const tempFile = templateFile.makeCopy('temp_carta_' + nome);
  const tempFileId = tempFile.getId();

  Utilities.sleep(2000); 

  try {
    const doc = DocumentApp.openById(tempFileId);
    const body = doc.getBody();
    
    // CORREÇÃO: replaceText substitui todas as ocorrências por padrão, 
    // mas garantimos que o texto seja exatamente o que está no Doc.
    body.replaceText('\\{\\{NOME\\}\\}', nome);
    body.replaceText('\\{\\{DATA_ADMISSÃO\\}\\}', dataFormatada);
    
    doc.saveAndClose();
    
    const blobCarta = tempFile.getAs(MimeType.PDF);
    blobCarta.setName("Carta de Inclusão - " + nome + ".pdf");

    const blobFormulario = DriveApp.getFileById(ID_FORMULARIO_BRADESCO).getBlob();
    blobFormulario.setName("Formulário Bradesco Saúde.pdf");

    // CORPO DO EMAIL PROFISSIONAL
    const corpoHTML = `
      <div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f373d;">
        <p>Olá, <b>${nome}</b>,</p>
        
        <p>Seja bem-vindo(a)! Para darmos prosseguimento ao seu processo de admissão, encaminhamos em anexo os documentos necessários para a sua inclusão no plano de saúde.</p>
        
        <div style="background-color: #f4f4f4; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0;">
          <strong>Instruções importantes:</strong><br>
          <ol>
            <li>Favor realizar o preenchimento apenas do <b>Formulário Bradesco Saúde</b>.</li>
            <li>A <b>Carta de Inclusão</b> é um documento informativo e já segue preenchida com seus dados.</li>
            <li>Após preencher, por favor, responda a este e-mail (Responder a todos) <b>anexando os dois documentos</b> (o Formulário preenchido e a Carta) em até 24 horas.</li>
          </ol>
        </div>
        
        <p>No corpo da resposta, confirme que o preenchimento foi concluído para que possamos validar junto à corretora.</p>
        
        <p>Qualquer dúvida, estamos à disposição.</p>
        
        <br>
        <p>Atenciosamente,</p>
        <p><b>Departamento de Pessoal - CIEDS</b></p>
      </div>
    `;

    MailApp.sendEmail({
      to: email,
      cc: CC_EMAILS,
      subject: "INCLUSÃO DE PLANO DE SAÚDE - " + nome,
      htmlBody: corpoHTML,
      attachments: [blobCarta, blobFormulario]
    });

  } finally {
    tempFile.setTrashed(true);
  }
}