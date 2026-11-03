/**
 * AUTOMAÇÃO DE ENVIO DE EMAIL PARA EXAME DE ADMISSÃO DOS COLABORADORES
 * Função principal conectada ao acionador instalável "Ao editar"
 */
function dispararEmail(e) {
  if (!e) return;

  const ss = e.source;
  const sheet = ss.getActiveSheet();
  const range = e.range;

  const NOME_DA_ABA = "ADMISSÃO/2026";

  const EMAILS_DESTINO = "gr2@vitalsaudeocupacional.com.br, gr6@vitalsaudeocupacional.com.br";
  const EMAIL_COPIA = "dp@cieds.org.br, anaqueiroz.rj@cieds.org.br";

  if (sheet.getName() !== NOME_DA_ABA) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return h.toString().trim(); });
  const col = {
    nome: headers.indexOf("NOME") + 1,
    cpf: headers.indexOf("CPF") + 1,
    nascimento: headers.indexOf("DATA DE NASCIMENTO") + 1,
    projeto: headers.indexOf("LOTAÇÃO") + 1,
    funcao: headers.indexOf("CARGO") + 1,
    admissao: headers.indexOf("DATA DE ADMISSÃO") + 1,
    bairro: headers.indexOf("BAIRRO") + 1,
    cidade: headers.indexOf("CIDADE") + 1,
    uf: headers.indexOf("UF") + 1,
    gatilho: headers.indexOf("GATILHO ENVIAR EMAIL PARA VITAL") + 1,
    status: headers.indexOf("STATUS DE ENVIO") + 1
  };

  if (range.getColumn() !== col.gatilho) return;

  const colunasFaltando = Object.keys(col).filter(function (chave) { return col[chave] === 0; });
  if (colunasFaltando.length > 0) {
    sheet.getRange(range.getRow(), range.getColumn()).setNote(
      "❌ Cabeçalho não encontrado na linha 1: " + colunasFaltando.join(", ")
    );
    return;
  }

  const linha = range.getRow();
  const valorGatilho = range.getValue();

  const celulaStatus = sheet.getRange(linha, col.status);
  const celulaGatilho = sheet.getRange(linha, col.gatilho);

  try {
    celulaStatus.setValue("⏳ Processando envio...");

    if (!(valorGatilho instanceof Date)) {
      if (valorGatilho !== "") {
        celulaStatus.setValue("❌ Erro: insira uma data válida na coluna GATILHO ENVIAR EMAIL PARA VITAL");
        celulaGatilho.setBackground("#f4cccc");
      } else {
        celulaStatus.clearContent();
        celulaGatilho.setBackground(null);
      }
      return;
    }

    const statusAtual = celulaStatus.getValue().toString();

    if (statusAtual.includes("Enviado em")) {
      celulaStatus.setValue("⚠️ E-mail já enviado anteriormente");
      return;
    }

    const usuarioAtivo = Session.getActiveUser().getEmail() || EMAIL_COPIA;

    const dataAgendamentoFormatada = Utilities.formatDate(
      valorGatilho,
      "GMT-3",
      "dd/MM/yyyy"
    );

    const dados = {
      nome: sheet.getRange(linha, col.nome).getValue(),
      cpf: sheet.getRange(linha, col.cpf).getDisplayValue(),
      nascimento: sheet.getRange(linha, col.nascimento).getDisplayValue(),
      projeto: sheet.getRange(linha, col.projeto).getValue(),
      funcao: sheet.getRange(linha, col.funcao).getValue(),
      admissao: sheet.getRange(linha, col.admissao).getDisplayValue(),

      bairro: sheet.getRange(linha, col.bairro).getValue(),
      cidade: sheet.getRange(linha, col.cidade).getValue(),
      uf: sheet.getRange(linha, col.uf).getValue(),

      dataGatilho: dataAgendamentoFormatada
    };

    let camposFaltando = [];

    if (!dados.nome) camposFaltando.push("Nome (NOME)");
    if (!dados.cpf) camposFaltando.push("CPF (CPF)");
    if (!dados.nascimento) camposFaltando.push("Nascimento (DATA DE NASCIMENTO)");
    if (!dados.funcao) camposFaltando.push("Função (CARGO)");
    if (!dados.projeto) camposFaltando.push("Projeto (LOTAÇÃO)");
    if (!dados.admissao) camposFaltando.push("Admissão (DATA DE ADMISSÃO)");
    if (!dados.bairro) camposFaltando.push("Bairro (BAIRRO)");
    if (!dados.cidade) camposFaltando.push("Cidade (CIDADE)");
    if (!dados.uf) camposFaltando.push("UF (UF)");

    if (camposFaltando.length > 0) {
      celulaStatus.setValue("⚠️ Pendente: " + camposFaltando.join(", "));
      celulaGatilho.setBackground("#f4cccc");
      return;
    }

    let assinaturaHTML = "";

    const configSheet = ss.getSheetByName("Config");
    if (configSheet) {
      assinaturaHTML = configSheet.getRange("B1").getValue();
    }

    enviarEmailHTML(
      dados,
      EMAILS_DESTINO,
      EMAIL_COPIA,
      usuarioAtivo,
      assinaturaHTML
    );

    const agora = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yy HH:mm");

    celulaStatus.setValue("✅ Enviado em: " + agora);
    celulaGatilho.setBackground("#d9ead3");

  } catch (erro) {
    celulaStatus.setValue("❌ Erro Técnico: " + erro.message);
    celulaGatilho.setBackground("#f4cccc");
  }
}


function enviarEmailHTML(dados, destinatarios, copiaEmail, usuarioAtivo, assinaturaHTML) {
  const assunto = "AGENDAMENTO DE EXAME ADMISSIONAL - " + dados.nome;

  const corpoHTML = `
    <div style="font-family: Arial, sans-serif; color: #000; line-height: 1.5; font-size: 13px;">
      
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">
        Solicitação de Exame Admissional
      </h2>

      <hr style="border: 0; border-top: 1px solid #ccc; margin-bottom: 20px;">

      <p style="margin-bottom: 20px;">
        Olá, segue abaixo os dados para o agendamento do Exame Admissional do profissional, 
        na data de <strong>${dados.dataGatilho}</strong>:
      </p>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 5px 0; font-weight: bold; width: 160px; border-bottom: 1px solid #f0f0f0;">Nome:</td>
          <td style="padding: 5px 0; text-transform: uppercase; border-bottom: 1px solid #f0f0f0;">${dados.nome}</td>
        </tr>

        <tr>
          <td style="padding: 5px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">CPF:</td>
          <td style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">${dados.cpf}</td>
        </tr>

        <tr>
          <td style="padding: 5px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">Data de Nascimento:</td>
          <td style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">${dados.nascimento}</td>
        </tr>

        <tr>
          <td style="padding: 5px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">Função:</td>
          <td style="padding: 5px 0; text-transform: uppercase; border-bottom: 1px solid #f0f0f0;">${dados.funcao}</td>
        </tr>

        <tr>
          <td style="padding: 5px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">Projeto:</td>
          <td style="padding: 5px 0; text-transform: uppercase; border-bottom: 1px solid #f0f0f0;">${dados.projeto}</td>
        </tr>

        <tr>
          <td style="padding: 5px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">Data de Admissão:</td>
          <td style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">${dados.admissao}</td>
        </tr>
      </table>

      <p style="margin-bottom: 15px;">
        <strong>Localização:</strong><br>
        O profissional reside no bairro ${dados.bairro}, ${dados.cidade} / ${dados.uf}.
      </p>
      
      <p>Fico no aguardo da confirmação do horário e local do exame.</p>
      
      <br>
      ${assinaturaHTML}
    </div>
  `;

  MailApp.sendEmail({
    to: destinatarios,
    cc: copiaEmail,
    subject: assunto,
    htmlBody: corpoHTML,
    replyTo: usuarioAtivo
  });
}