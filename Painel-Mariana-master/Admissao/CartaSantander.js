// =====================================================================================
// [2026-09-30] CARTA DE ABERTURA DE CONTA SALÁRIO NO SANTANDER
// Quem informa no formulário um banco diferente do Santander recebe por e-mail, ao concluir o
// cadastro, a carta do DP para abrir a conta salário. Nome, e-mail, função (Posto de Trabalho),
// salário e data de admissão vêm da aba BASE da DATABASE. RG, CPF e endereço vêm do formulário.
// A carta sai do modelo em Google Docs CONFIG.CARTA_MODELO_ID (dá para editar o texto lá).
// O resultado fica na coluna "Carta Santander" da aba CADASTROS:
//   "Não se aplica (Santander)" | "PENDENTE" | "ENVIADA em ... para ..." | "NÃO ENVIADA: motivo"
// Para mandar de novo as que ficaram PENDENTE/NÃO ENVIADA: rodar reenviarCartasSantander().
// =====================================================================================

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

/** Nome comparável: sem acento, sem pontuação, maiúsculas/minúsculas e espaços iguais. */
function _normNome_(s) {
  return _normCabecalho_(s).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Procura a pessoa na aba BASE: primeiro pelo nome, depois pelo e-mail do formulário. */
function _buscarNaBase_(ss, nome, email) {
  const aba = ss.getSheetByName(CONFIG.ABA_BASE);
  if (!aba) throw new Error('aba ' + CONFIG.ABA_BASE + ' não encontrada na DATABASE');
  const valores = aba.getDataRange().getValues();
  if (valores.length < 2) return null;
  const cab = valores[0].map(_normCabecalho_);
  const col = function (n) { return cab.indexOf(_normCabecalho_(n)); };
  // [2026-10-27] A coluna foi renomeada para "Nome Completo" na BASE; "Nome" continua aceito.
  const c = {
    nome: col('Nome Completo') > -1 ? col('Nome Completo') : col('Nome'), email: col('E-mail'), funcao: col('Posto de Trabalho'),
    salario: col('Salário'), admissao: col('Data de Admissão')
  };
  if (c.nome < 0) throw new Error('coluna "Nome Completo" (ou "Nome") não encontrada na aba ' + CONFIG.ABA_BASE);

  const alvoNome = _normNome_(nome);
  const alvoEmail = String(email || '').trim().toLowerCase();
  let porNome = null, porEmail = null;
  for (let i = 1; i < valores.length; i++) {
    const r = valores[i];
    if (alvoNome && _normNome_(r[c.nome]) === alvoNome) porNome = r;
    else if (alvoEmail && c.email > -1 && String(r[c.email]).trim().toLowerCase() === alvoEmail) porEmail = r;
  }
  const r = porNome || porEmail;
  if (!r) return null;
  const pega = function (i) { return i > -1 ? r[i] : ''; };
  return {
    nome: String(pega(c.nome)).trim(),
    email: String(pega(c.email)).trim(),
    funcao: String(pega(c.funcao)).trim(),
    salario: pega(c.salario),
    admissao: pega(c.admissao)
  };
}

function _soDigitos_(v, tamanho) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d && tamanho && d.length < tamanho) d = ('0'.repeat(tamanho) + d).slice(-tamanho);
  return d;
}

function _fmtCpf_(v) {
  const d = _soDigitos_(v, 11);
  return d.length === 11 ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9) : String(v || '').trim();
}

function _fmtCep_(v) {
  const d = _soDigitos_(v, 8);
  return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || '').trim();
}

/** 4229.34 -> "4.229,34"; texto ("4.229,34", "R$ 4.229,34") fica como está, sem o "R$". */
function _fmtSalario_(v) {
  if (typeof v === 'number' && isFinite(v)) {
    const p = v.toFixed(2).split('.');
    return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
  }
  return String(v == null ? '' : v).replace(/R\$\s*/i, '').trim();
}

function _fmtData_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, 'America/Sao_Paulo', 'dd/MM/yyyy');
  const s = String(v == null ? '' : v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[3] + '/' + iso[2] + '/' + iso[1] : s;
}

function _dataPorExtenso_(d) {
  const dia = Number(Utilities.formatDate(d, 'America/Sao_Paulo', 'd'));
  const mes = Number(Utilities.formatDate(d, 'America/Sao_Paulo', 'M'));
  const ano = Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy');
  return dia + ' de ' + MESES_PT[mes - 1] + ' de ' + ano;
}

function _enderecoCarta_(dados) {
  const t = function (v) { return String(v == null ? '' : v).trim(); };
  let s = t(dados.logradouro);
  if (t(dados.numero)) s += ', ' + t(dados.numero);
  if (t(dados.complemento)) s += ' - ' + t(dados.complemento);
  if (t(dados.bairro)) s += ' - ' + t(dados.bairro);
  const cidade = [t(dados.cidade), t(dados.uf)].filter(String).join(' - ');
  if (cidade) s += ' – ' + cidade;
  return s.toUpperCase();
}

/** Copia o modelo, troca os {{CAMPOS}}, devolve o PDF e joga a cópia na lixeira. */
function _gerarCartaSantanderPdf_(campos, nomeArquivo) {
  const copia = DriveApp.getFileById(CONFIG.CARTA_MODELO_ID).makeCopy('TEMP - ' + nomeArquivo);
  try {
    const doc = DocumentApp.openById(copia.getId());
    const corpo = doc.getBody();
    Object.keys(campos).forEach(function (k) {
      // Sem "$" no valor: no replaceText ele pode ser lido como referência de grupo.
      const valor = String(campos[k] == null ? '' : campos[k]).replace(/\$/g, '');
      corpo.replaceText('\\{\\{' + k + '\\}\\}', valor);
    });
    doc.saveAndClose();
    return copia.getAs(MimeType.PDF).setName(nomeArquivo + '.pdf');
  } finally {
    copia.setTrashed(true);
  }
}

// [2026-10-01] Logotipo branco do CIEDS (o mesmo do topo do formulário), 133x68 px, vai dentro do
// e-mail (cid:logoCieds) para aparecer mesmo quando o leitor bloqueia imagens externas.
const LOGO_EMAIL_B64 = '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';

function _escHtml_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Corpo do e-mail em HTML, com as cores do formulário (verde CIEDS). Tabelas e estilos inline
 *  porque é o que Gmail e Outlook respeitam. */
function _htmlEmailCarta_(primeiroNome, teste) {
  const VERDE = '#18564A', VERDE_MEDIO = '#247662', TINTA = '#173029', CINZA = '#5b6f69', LINHA = '#e3ebe8', FUNDO = '#f4f7f6';
  const fonte = 'font-family:Arial,Helvetica,sans-serif;';
  const ola = primeiroNome ? 'Olá, ' + _escHtml_(primeiroNome) + '!' : 'Olá!';
  const passo = function (n, texto) {
    return '<tr>' +
      '<td valign="top" style="padding:0 12px 12px 0;width:28px">' +
        '<div style="' + fonte + 'width:26px;height:26px;line-height:26px;border-radius:13px;background:' + VERDE_MEDIO +
        ';color:#ffffff;font-size:13px;font-weight:bold;text-align:center">' + n + '</div></td>' +
      '<td valign="top" style="' + fonte + 'padding:3px 0 12px 0;font-size:15px;line-height:22px;color:' + TINTA + '">' + texto + '</td>' +
    '</tr>';
  };
  return '' +
  '<div style="margin:0;padding:0;background:' + FUNDO + '">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + FUNDO + '">' +
  '<tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ' + LINHA + ';border-radius:14px;border-collapse:separate;overflow:hidden">' +

      // Cabeçalho verde com o logotipo
      '<tr><td style="background:' + VERDE + ';padding:20px 28px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          '<td valign="middle"><img src="cid:logoCieds" width="67" height="34" alt="CIEDS" style="display:block;border:0;height:34px;width:auto;' + fonte + 'color:#ffffff;font-size:20px;font-weight:bold"></td>' +
          '<td valign="middle" align="right" style="' + fonte + 'color:#cfe5de;font-size:12px;letter-spacing:.6px;text-transform:uppercase">Departamento de Pessoal</td>' +
        '</tr></table>' +
      '</td></tr>' +

      (teste ? '<tr><td style="' + fonte + 'background:#fff3d9;color:#77510a;font-size:12px;font-weight:bold;text-align:center;padding:8px 28px">E-MAIL DE TESTE, COM DADOS FICTÍCIOS</td></tr>' : '') +

      // Corpo
      '<tr><td style="padding:30px 28px 8px 28px">' +
        '<div style="' + fonte + 'font-size:13px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;color:' + VERDE_MEDIO + ';margin:0 0 6px 0">Cadastro de admissão</div>' +
        '<h1 style="' + fonte + 'font-size:22px;line-height:28px;margin:0 0 16px 0;color:' + TINTA + '">Carta para abertura de conta salário no Santander</h1>' +
        '<p style="' + fonte + 'font-size:15px;line-height:23px;margin:0 0 12px 0;color:' + TINTA + '">' + ola + '</p>' +
        '<p style="' + fonte + 'font-size:15px;line-height:23px;margin:0 0 22px 0;color:' + TINTA + '">Recebemos o seu cadastro de admissão no CIEDS. Como você informou que ainda não tem conta no Santander, ' +
          'enviamos em anexo a <b>carta do CIEDS para abertura da sua conta salário no Banco Santander</b>.</p>' +
      '</td></tr>' +

      // Caixa "O que fazer agora"
      '<tr><td style="padding:0 28px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef6f3;border:1px solid #d3e8e0;border-radius:12px;border-collapse:separate">' +
        '<tr><td style="padding:18px 20px 6px 20px">' +
          '<div style="' + fonte + 'font-size:14px;font-weight:bold;color:' + VERDE + ';margin:0 0 12px 0">O que fazer agora</div>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
            passo(1, 'Abra a carta em PDF que está <b>em anexo</b> neste e-mail. Você pode imprimir ou mostrar no celular.') +
            passo(2, 'Leve a carta a uma <b>agência do Santander</b>, junto com os seus documentos pessoais.') +
          '</table>' +
        '</td></tr></table>' +
      '</td></tr>' +

      // Contato
      '<tr><td style="padding:24px 28px 8px 28px">' +
        '<p style="' + fonte + 'font-size:14px;line-height:21px;margin:0 0 6px 0;color:' + CINZA + '">Ficou com alguma dúvida? Fale com o Departamento de Pessoal:</p>' +
        '<p style="' + fonte + 'font-size:14px;line-height:22px;margin:0;color:' + TINTA + '">' +
          'E-mail: <a href="mailto:dp@cieds.org.br" style="color:' + VERDE_MEDIO + ';font-weight:bold;text-decoration:none">dp@cieds.org.br</a><br>' +
          'Telefone: <b>(21) 2544-4516</b></p>' +
      '</td></tr>' +

      // Assinatura
      '<tr><td style="padding:22px 28px 28px 28px">' +
        '<p style="' + fonte + 'font-size:15px;line-height:22px;margin:0;color:' + TINTA + '">Atenciosamente,<br><b>Departamento de Pessoal</b><br>' +
          '<span style="color:' + CINZA + '">CIEDS</span></p>' +
      '</td></tr>' +

      // Rodapé
      '<tr><td style="' + fonte + 'background:' + FUNDO + ';border-top:1px solid ' + LINHA + ';padding:14px 28px;font-size:12px;line-height:18px;color:' + CINZA + '">' +
        'Mensagem automática, enviada após o envio do seu cadastro de admissão.' +
      '</td></tr>' +

    '</table>' +
  '</td></tr></table></div>';
}

function _emailCartaSantander_(para, primeiroNome, pdf, teste) {
  const ola = primeiroNome ? 'Olá, ' + primeiroNome + '!' : 'Olá!';
  const texto = ola + '\n\n' +
    'Recebemos o seu cadastro de admissão no CIEDS. Como você informou que ainda não tem conta no Santander, ' +
    'enviamos em anexo a carta do CIEDS para abertura da sua conta salário no Banco Santander.\n\n' +
    'O que fazer agora:\n' +
    '1. Abra a carta em PDF que está em anexo neste e-mail. Você pode imprimir ou mostrar no celular.\n' +
    '2. Leve a carta a uma agência do Santander, junto com os seus documentos pessoais.\n\n' +
    'Ficou com alguma dúvida? Fale com o Departamento de Pessoal:\n' +
    'E-mail: dp@cieds.org.br\nTelefone: (21) 2544-4516\n\n' +
    'Atenciosamente,\nDepartamento de Pessoal\nCIEDS';
  MailApp.sendEmail({
    to: para,
    subject: (teste ? '[TESTE] ' : '') + 'CIEDS - Carta para abertura de conta salário no Santander',
    body: texto,
    htmlBody: _htmlEmailCarta_(primeiroNome, teste),
    inlineImages: { logoCieds: Utilities.newBlob(Utilities.base64Decode(LOGO_EMAIL_B64), 'image/png', 'cieds.png') },
    name: 'Departamento de Pessoal - CIEDS',
    attachments: [pdf]
  });
}

/**
 * Gera e envia a carta para uma pessoa e grava o resultado na coluna Carta Santander.
 * Nunca lança erro: devolve { enviada: true|false, texto: 'o que foi gravado na coluna' }.
 */
function _enviarCartaSantander_(dados, protocolo, pastaId, ss) {
  let texto;
  let enviada = false;
  try {
    ss = ss || _getPlanilha_();
    if (_ehSantander_(dados.banco)) {
      texto = CARTA_NAO_SE_APLICA;
    } else {
      const base = _buscarNaBase_(ss, dados.nomeCompleto, dados.emailPessoal);
      if (!base) {
        texto = 'NÃO ENVIADA: nome não encontrado na aba ' + CONFIG.ABA_BASE;
      } else {
        const faltam = [];
        if (!base.funcao) faltam.push('Posto de Trabalho');
        if (!_fmtSalario_(base.salario)) faltam.push('Salário');
        if (!_fmtData_(base.admissao)) faltam.push('Data de Admissão');
        const para = base.email || String(dados.emailPessoal || '').trim();
        if (!para) faltam.push('E-mail');
        if (faltam.length) {
          texto = 'NÃO ENVIADA: falta ' + faltam.join(', ') + ' na aba ' + CONFIG.ABA_BASE;
        } else {
          const nome = (base.nome || String(dados.nomeCompleto || '')).trim().toUpperCase();
          const pdf = _gerarCartaSantanderPdf_({
            DATA: _dataPorExtenso_(new Date()),
            NOME: nome,
            RG: String(dados.rgNumero || '').trim(),
            CPF: _fmtCpf_(dados.cpf),
            ENDERECO: _enderecoCarta_(dados),
            CEP: _fmtCep_(dados.cep),
            FUNCAO: base.funcao.toUpperCase(),
            SALARIO: _fmtSalario_(base.salario),
            ADMISSAO: _fmtData_(base.admissao)
          }, 'Carta abertura de conta Santander - ' + nome);

          const primeiro = nome.split(' ')[0];
          _emailCartaSantander_(para, primeiro.charAt(0) + primeiro.slice(1).toLowerCase(), pdf, false);
          enviada = true;
          texto = 'ENVIADA em ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') +
            ' para ' + para;

          // Cópia na pasta do cadastro, para o DP ter o que foi enviado.
          // Sem a palavra "kit" no nome: a API procura o kit por esse termo na pasta.
          if (pastaId) {
            try {
              DriveApp.getFolderById(pastaId).createFile(pdf.copyBlob().setName('Carta abertura de conta Santander.pdf'));
            } catch (e) {
              texto += ' (cópia na pasta falhou: ' + (e && e.message ? e.message : e) + ')';
            }
          }
        }
      }
    }
  } catch (err) {
    texto = 'NÃO ENVIADA: erro - ' + String(err && err.message ? err.message : err);
  }
  try {
    _gravarStatusCarta_(ss || _getPlanilha_(), protocolo, texto);
  } catch (e) {
    Logger.log('Carta Santander ' + protocolo + ': não gravou o status (' + e + '): ' + texto);
  }
  return { enviada: enviada, texto: texto };
}

/** Grava o texto na coluna Carta Santander da linha do protocolo (procura de baixo para cima). */
function _gravarStatusCarta_(ss, protocolo, texto) {
  const aba = ss.getSheetByName(CONFIG.ABA);
  const ultCol = aba.getLastColumn(), ultLin = aba.getLastRow();
  if (ultLin < 2) return;
  const cab = aba.getRange(1, 1, 1, ultCol).getValues()[0].map(_normCabecalho_);
  const cCarta = cab.indexOf(_normCabecalho_(CONFIG.CARTA_COLUNA));
  const cProt = cab.indexOf(_normCabecalho_('Protocolo'));
  if (cCarta < 0 || cProt < 0) throw new Error('coluna ' + CONFIG.CARTA_COLUNA + ' ou Protocolo não encontrada');
  const prots = aba.getRange(2, cProt + 1, ultLin - 1, 1).getValues();
  for (let i = prots.length - 1; i >= 0; i--) {
    if (String(prots[i][0]).trim() === String(protocolo)) {
      aba.getRange(i + 2, cCarta + 1).setValue(texto);
      return;
    }
  }
  throw new Error('protocolo ' + protocolo + ' não encontrado na aba ' + CONFIG.ABA);
}

/**
 * Manda de novo a carta para os cadastros com PENDENTE ou NÃO ENVIADA na coluna Carta Santander
 * (por exemplo, depois de acertar o nome da pessoa na aba BASE). Com um protocolo, manda só para
 * aquele cadastro, qualquer que seja o status. Rodar pelo editor; o resultado sai no registro.
 */
function reenviarCartasSantander(protocolo) {
  const ss = _getPlanilha_();
  const aba = ss.getSheetByName(CONFIG.ABA);
  const valores = aba.getDataRange().getValues();
  const cab = valores[0].map(_normCabecalho_);
  const idx = function (n) { return cab.indexOf(_normCabecalho_(n)); };
  const cCarta = idx(CONFIG.CARTA_COLUNA), cProt = idx('Protocolo'), cPasta = idx('Pasta no Drive');
  if (cCarta < 0 || cProt < 0) { Logger.log('Coluna ' + CONFIG.CARTA_COLUNA + ' ou Protocolo não encontrada.'); return []; }

  const alvo = typeof protocolo === 'string' ? protocolo.trim() : '';
  const resultado = [];
  for (let i = 1; i < valores.length; i++) {
    const r = valores[i];
    const prot = String(r[cProt] || '').trim();
    if (!prot) continue;
    if (alvo ? prot !== alvo : !/^(PENDENTE|NÃO ENVIADA)/i.test(String(r[cCarta] || ''))) continue;
    const dados = {};
    CAMPOS.forEach(function (c) { const j = idx(c[1]); if (j > -1) dados[c[0]] = r[j]; });
    const pastaId = cPasta > -1 ? (String(r[cPasta] || '').match(/[-\w]{25,}/) || [''])[0] : '';
    resultado.push(prot + ' (' + dados.nomeCompleto + '): ' + _enviarCartaSantander_(dados, prot, pastaId, ss).texto);
  }
  Logger.log(resultado.length ? resultado.join('\n') : 'Nada para reenviar.');
  return resultado;
}

/**
 * Rodar UMA VEZ pelo editor, logado como a conta que publica o formulário (autodppessoal):
 * autoriza o envio de e-mail e o uso do Google Docs, e manda uma carta de exemplo, com dados
 * fictícios, para CONFIG.CARTA_TESTE_EMAIL. Sem essa autorização o formulário publicado não abre.
 */
function testarCartaSantander() {
  const pdf = _gerarCartaSantanderPdf_({
    DATA: _dataPorExtenso_(new Date()),
    NOME: 'MARIA DE TESTE DA SILVA',
    RG: '12.345.678-9',
    CPF: '123.456.789-09',
    ENDERECO: 'RUA DE TESTE, 100 - APTO 201 - CENTRO – RIO DE JANEIRO - RJ',
    CEP: '20000-000',
    FUNCAO: 'ASSISTENTE SOCIAL',
    SALARIO: '4.501,48',
    ADMISSAO: '01/10/2026'
  }, 'Carta abertura de conta Santander - TESTE');
  _emailCartaSantander_(CONFIG.CARTA_TESTE_EMAIL, 'Maria', pdf, true);
  // Confere também a leitura da aba BASE (sem enviar nada).
  const ss = _getPlanilha_();
  const aba = ss.getSheetByName(CONFIG.ABA_BASE);
  Logger.log('Carta de teste enviada para ' + CONFIG.CARTA_TESTE_EMAIL + '. Aba BASE: ' +
    (aba ? (aba.getLastRow() - 1) + ' linhas.' : 'NÃO ENCONTRADA.'));
}
