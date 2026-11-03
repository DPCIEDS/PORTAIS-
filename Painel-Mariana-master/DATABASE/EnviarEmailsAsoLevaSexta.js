/**
 * Envio isolado do lote de 13 pessoas sem ASO da leva de sexta.
 *
 * A aba PREVIEW_EMAIL_LEVA_SEXTA deve conter as colunas:
 * Lote | Nome | E-mail | Protocolo | Assunto | Corpo | Status |
 * Data/hora envio | Erro
 *
 * Fluxo:
 * 1. Execute prepararEnvioAsoLevaSexta() apenas se as linhas estiverem em ERRO.
 * 2. Execute previsualizarEmailsAsoLevaSexta() para conferir os destinatários.
 * 3. Execute enviarEmailsAsoLevaSexta() para enviar exclusivamente este lote.
 */

const EMAIL_ASO_LEVA_SEXTA = {
  PLANILHA_ID: '1hCMuXFX41J-gAnieI5uo8Uf4hiNx18N37xej0NEyQZ0',
  ABA: 'PREVIEW_EMAIL_LEVA_SEXTA',
  LOTE: 'ASO_SEM_EXAME_2026-09-24',
  REMETENTE: 'Departamento Pessoal - CIEDS'
};

function prepararEnvioAsoLevaSexta() {
  const itens = obterItensAsoLevaSexta_(true);
  const aba = obterAbaAsoLevaSexta_();
  const agora = new Date();
  let rearmados = 0;

  itens.forEach(function (item) {
    // Nunca altera uma linha já marcada como enviada.
    if (item.status === 'ENVIADO' || item.dataEnvio) return;
    if (item.status !== 'PENDENTE') {
      aba.getRange(item.linha, item.colunas.status).setValue('PENDENTE');
      aba.getRange(item.linha, item.colunas.erro).clearContent();
      rearmados++;
    }
  });

  SpreadsheetApp.flush();
  Logger.log('Linhas rearmadas para envio: ' + rearmados + ' em ' + agora);
  return rearmados;
}

function previsualizarEmailsAsoLevaSexta() {
  const itens = obterItensAsoLevaSexta_(false);
  const resumo = itens.map(function (item) {
    return { linha: item.linha, nome: item.nome, email: item.email, protocolo: item.protocolo };
  });
  Logger.log(JSON.stringify(resumo, null, 2));
  return resumo;
}

function enviarEmailsAsoLevaSexta() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Já existe um envio em andamento. Tente novamente em instantes.');

  try {
    const aba = obterAbaAsoLevaSexta_();
    const itens = obterItensAsoLevaSexta_(false);
    const resultado = [];

    itens.forEach(function (item) {
      try {
        GmailApp.sendEmail(item.email, textoSemAnotacaoNome_(item.assunto), textoSemAnotacaoNome_(item.corpo), {
          name: EMAIL_ASO_LEVA_SEXTA.REMETENTE
        });
        aba.getRange(item.linha, item.colunas.status).setValue('ENVIADO');
        aba.getRange(item.linha, item.colunas.dataEnvio).setValue(new Date())
          .setNumberFormat('dd/MM/yyyy HH:mm:ss');
        aba.getRange(item.linha, item.colunas.erro).clearContent();
        resultado.push({ nome: item.nome, email: item.email, status: 'ENVIADO' });
      } catch (erro) {
        aba.getRange(item.linha, item.colunas.status).setValue('ERRO');
        aba.getRange(item.linha, item.colunas.erro).setValue(String(erro));
        resultado.push({ nome: item.nome, email: item.email, status: 'ERRO', erro: String(erro) });
      }
    });

    SpreadsheetApp.flush();
    Logger.log(JSON.stringify(resultado, null, 2));
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

function obterAbaAsoLevaSexta_() {
  const aba = SpreadsheetApp.openById(EMAIL_ASO_LEVA_SEXTA.PLANILHA_ID)
    .getSheetByName(EMAIL_ASO_LEVA_SEXTA.ABA);
  if (!aba) throw new Error('Aba não encontrada: ' + EMAIL_ASO_LEVA_SEXTA.ABA);
  return aba;
}

function obterItensAsoLevaSexta_(incluirNaoPendentes) {
  const aba = obterAbaAsoLevaSexta_();
  garantirColunasControleAsoLevaSexta_(aba);
  const valores = aba.getDataRange().getDisplayValues();
  if (valores.length < 2) return [];

  const cabecalho = valores[0];
  const coluna = function (nome) {
    const indice = cabecalho.indexOf(nome);
    if (indice < 0) throw new Error('Coluna obrigatória ausente: ' + nome);
    return indice;
  };
  const colunas = {
    lote: coluna('Lote'),
    nome: coluna('Nome'),
    email: coluna('E-mail'),
    protocolo: coluna('Protocolo'),
    assunto: coluna('Assunto'),
    corpo: coluna('Corpo'),
    status: coluna('Status') + 1,
    dataEnvio: coluna('Data/hora envio') + 1,
    erro: coluna('Erro') + 1
  };

  return valores.slice(1).map(function (linha, indice) {
    return {
      linha: indice + 2,
      nome: linha[colunas.nome].trim(),
      email: linha[colunas.email].trim(),
      protocolo: linha[colunas.protocolo].trim(),
      assunto: linha[colunas.assunto],
      corpo: linha[colunas.corpo],
      status: linha[colunas.status - 1].trim(),
      dataEnvio: linha[colunas.dataEnvio - 1].trim(),
      lote: linha[colunas.lote].trim(),
      colunas: colunas
    };
  }).filter(function (item) {
    if (item.lote !== EMAIL_ASO_LEVA_SEXTA.LOTE) return false;
    if (!item.nome || !item.email || !item.assunto || !item.corpo) return false;
    return incluirNaoPendentes || item.status === 'PENDENTE';
  });
}

// A aba foi criada inicialmente sem a coluna "Erro". Mantém a compatibilidade
// e cria somente as colunas de controle que estiverem ausentes.
function garantirColunasControleAsoLevaSexta_(aba) {
  const ultimaColuna = Math.max(aba.getLastColumn(), 1);
  const cabecalho = aba.getRange(1, 1, 1, ultimaColuna).getDisplayValues()[0];
  const obrigatorias = ['Status', 'Data/hora envio', 'Erro'];
  const faltantes = obrigatorias.filter(function (nome) {
    return cabecalho.indexOf(nome) === -1;
  });

  if (faltantes.length) {
    aba.getRange(1, ultimaColuna + 1, 1, faltantes.length).setValues([faltantes]);
  }
}
