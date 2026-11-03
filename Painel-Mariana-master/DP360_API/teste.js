
/**************************************************************
 * DP360 - RECUPERAÇÃO DE KITS ASSINADOS
 *
 * Recupera os documentos assinados do Autentique.
 * Valida o PDF antes de salvar no Drive.
 * Atualiza a URL na ADMISSOES_TRATATIVA.
 *
 * Não envia documentos para assinatura novamente.
 * Não exclui documentos anteriores.
 **************************************************************/

function recuperarKitsAssinados() {

  var usuario = {
    EMAIL: Session.getActiveUser().getEmail() ||
      'recuperacao_manual'
  };

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var resultado = {
    recuperados: 0,
    jaValidos: 0,
    pendentes: 0,
    erros: 0,
    detalhes: []
  };

  var inicio = Date.now();

  // Processamento em lotes para evitar timeout.
  var LIMITE = 15;
  var MAX_TEMPO = 4 * 60 * 1000;

  for (var i = 0; i < cadastros.length; i++) {

    if (resultado.recuperados >= LIMITE) break;

    if (Date.now() - inicio > MAX_TEMPO) break;

    var cad = cadastros[i];

    var proto = String(
      cad[ADM_COL.PROTOCOLO] || ''
    ).trim();

    var nome = String(
      cad[ADM_COL.NOME] || ''
    ).trim();

    if (!proto) continue;

    var trat = tratMapa[proto] || {};

    var docId = String(
      trat.KIT_ID_AUTENTIQUE || ''
    ).trim();

    if (!docId) continue;

    try {

      // 1. CONFERE SE JÁ EXISTE UM PDF VÁLIDO

      var linkAtual = String(
        trat.ASSINATURA_URL || ''
      ).trim();

      if (linkAtual) {

        var idAtual = _kitExtrairIdDrive_(linkAtual);

        if (idAtual) {

          try {

            var atual = DriveApp.getFileById(idAtual);

            if (_kitArquivoValido_(atual)) {

              resultado.jaValidos++;

              continue;
            }

          } catch (erroArquivo) {
            // Arquivo antigo indisponível ou inválido.
            // Prossegue com a recuperação.
          }

        }

      }

      // 2. CONSULTA O AUTENTIQUE

      var info = _reciboConsultarDocumento_(docId);

      if (!info || info.rejeitado) {

        resultado.pendentes++;

        resultado.detalhes.push({
          nome: nome,
          protocolo: proto,
          status: 'PENDENTE',
          motivo: 'Documento rejeitado ou não localizado.'
        });

        continue;
      }

      if (!info.assinado) {

        resultado.pendentes++;

        continue;
      }

      if (!info.urlAssinado) {

        throw new Error(
          'Autentique não retornou a URL do PDF assinado.'
        );
      }

      // 3. BAIXA O DOCUMENTO

      var resposta = UrlFetchApp.fetch(
        info.urlAssinado,
        {
          method: 'get',
          followRedirects: true,
          muteHttpExceptions: true,
          headers: {
            Accept: 'application/pdf'
          }
        }
      );

      var http = resposta.getResponseCode();

      if (http !== 200) {

        throw new Error(
          'Falha no download. HTTP ' + http
        );
      }

      var blob = resposta.getBlob();

      var bytes = blob.getBytes();

      // 4. VALIDA A ASSINATURA DO ARQUIVO PDF

      if (!_kitBytesPDF_(bytes)) {

        var tipo = resposta.getHeaders()['Content-Type'] ||
          resposta.getHeaders()['content-type'] ||
          'não informado';

        throw new Error(
          'O Autentique não retornou um PDF válido. ' +
          'HTTP: ' + http +
          ' | Content-Type: ' + tipo +
          ' | Bytes: ' + bytes.length
        );
      }

      // 5. LOCALIZA A PASTA CORRETA DO FUNCIONÁRIO

      var pastaPessoa = _admPastaDoCadastro_(cad);

      var pastaAssinados = _admSubpasta_(
        pastaPessoa,
        ADM.SUBPASTAS.ASSINADO
      );

      var nomeArquivo =
        'KIT ADMISSIONAL - ' +
        nome +
        ' - ASSINADO.pdf';

      blob.setName(nomeArquivo);

      blob.setContentType(MimeType.PDF);

      // 6. SALVA O NOVO ARQUIVO

      var novoArquivo = pastaAssinados.createFile(blob);

      // 7. CONFERE O ARQUIVO SALVO

      if (!_kitArquivoValido_(novoArquivo)) {

        throw new Error(
          'O arquivo salvo no Drive não passou na validação.'
        );
      }

      var novoLink = novoArquivo.getUrl();

      // 8. ATUALIZA A DATABASE

      _admUpsertTratativa_(
        cad,
        {
          ASSINATURA_STATUS: ADM.STATUS.ASSINADO,
          ASSINATURA_URL: novoLink,
          KIT_ASSINADO_EM:
            trat.KIT_ASSINADO_EM || _agoraISO_()
        },
        {
          data: _agoraISO_(),
          usuario: usuario.EMAIL,
          acao: 'KIT_ASSINADO_RECUPERADO',
          arquivo: nomeArquivo
        }
      );

      resultado.recuperados++;

      resultado.detalhes.push({
        nome: nome,
        protocolo: proto,
        status: 'RECUPERADO',
        link: novoLink
      });

    } catch (err) {

      resultado.erros++;

      resultado.detalhes.push({
        nome: nome,
        protocolo: proto,
        status: 'ERRO',
        motivo: String(
          err && err.message ? err.message : err
        )
      });

    }

  }

  Logger.log(
    JSON.stringify(resultado, null, 2)
  );

  return resultado;
}


/**************************************************************
 * VALIDA SE O CONTEÚDO REALMENTE É UM PDF
 **************************************************************/

function _kitBytesPDF_(bytes) {

  if (!bytes || bytes.length < 100) {
    return false;
  }

  // Assinatura de arquivo PDF: %PDF-

  return (
    (bytes[0] & 255) === 37 &&
    (bytes[1] & 255) === 80 &&
    (bytes[2] & 255) === 68 &&
    (bytes[3] & 255) === 70 &&
    (bytes[4] & 255) === 45
  );
}


/**************************************************************
 * VALIDA O ARQUIVO EXISTENTE NO GOOGLE DRIVE
 **************************************************************/

function _kitArquivoValido_(arquivo) {

  if (!arquivo) return false;

  if (arquivo.getMimeType() !== MimeType.PDF) {
    return false;
  }

  if (arquivo.getSize() < 100) {
    return false;
  }

  var bytes = arquivo.getBlob().getBytes();

  return _kitBytesPDF_(bytes);
}


/**************************************************************
 * EXTRAI ID DE UM LINK DO GOOGLE DRIVE
 **************************************************************/

function _kitExtrairIdDrive_(url) {

  var texto = String(url || '');

  var match = texto.match(
    /\/d\/([a-zA-Z0-9_-]+)/
  );

  if (match) {
    return match[1];
  }

  match = texto.match(
    /[?&]id=([a-zA-Z0-9_-]+)/
  );

  return match ? match[1] : '';
}