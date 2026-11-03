/**
 * [2026-10-05] LEMBRETE DO FORMULÁRIO DE ADMISSÃO
 * Menu "Admissão" > "Enviar lembrete do formulário (quem não preencheu)".
 *
 * Quem recebe: está na aba BASE com a Data de Admissão escolhida, já recebeu o convite (Status do
 * Envio = ENVIADO) e ainda não aparece na aba CADASTROS. Fica de fora quem está na aba Cancelados.
 * A comparação com a CADASTROS é a mesma do exame (ExameAdmissao0910.js): CPF com nome compatível,
 * ou o nome, ou o e-mail.
 *
 * O e-mail tem o mesmo visual e o mesmo link do convite (EnvioFormularioAdmissao.js), com cópia para
 * o DP. Cada envio fica registrado na aba LEMBRETE_FORMULARIO (com cargo e departamento da BASE; as
 * colunas são achadas pelo nome do cabeçalho). Por padrão a mesma pessoa recebe no máximo um
 * lembrete por dia; em outro dia dá para mandar de novo para quem continuar sem preencher.
 * [2026-10-07] Na janela, "Enviar de novo para quem já recebeu lembrete hoje" manda outra vez no
 * mesmo dia (pedido da Taynara). Dentro de uma mesma rodada ninguém recebe duas vezes.
 * [2026-10-26] Não tem mais janela nem item de menu próprios: o lembrete sai pela janela única
 * "Formulário de admissão: enviar e lembrar" (EnvioFormularioAdmissao.js / EnvioFormularioDialogo).
 * Quem recebeu o convite hoje não recebe lembrete no mesmo dia.
 */

const LEMBRETE_FORM = {
  ABA_LOG: 'LEMBRETE_FORMULARIO',
  CAB_LOG: ['Data/hora', 'Data de admissão', 'Nome', 'Cargo', 'Departamento', 'E-mail', 'Linha BASE', 'Status', 'Erro'],
  ASSUNTO: 'Lembrete: preencha o seu cadastro de admissão o quanto antes - CIEDS',
  EMAIL_EXEMPLO: 'taynarasilva2411@gmail.com', // destino do botão "Enviar e-mail de exemplo"
  VARIANTE: {
    kicker: 'Lembrete',
    titulo: 'Seu cadastro de admissão ainda não foi preenchido',
    intro: 'Ainda não recebemos o seu cadastro de admissão. Para não atrasar a sua admissão no CIEDS, preencha o formulário e envie os documentos solicitados <b>o quanto antes</b>.',
    botao: 'Preencher o formulário agora',
    nota: 'Se você já preencheu o formulário nos últimos dias, desconsidere este lembrete.'
  }
};

function _lembFormAbaLog_(ss) {
  let aba = ss.getSheetByName(LEMBRETE_FORM.ABA_LOG);
  if (!aba) {
    aba = ss.insertSheet(LEMBRETE_FORM.ABA_LOG);
    aba.getRange(1, 1, 1, LEMBRETE_FORM.CAB_LOG.length).setValues([LEMBRETE_FORM.CAB_LOG]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  // Coluna que faltar no cabeçalho entra no fim (a aba pode ter sido criada com menos colunas).
  const cab = _lembFormCabLog_(aba);
  const faltam = LEMBRETE_FORM.CAB_LOG.filter(function (h) { return cab.indexOf(h) === -1; });
  if (faltam.length) aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
  return aba;
}

function _lembFormCabLog_(aba) {
  const n = Math.max(1, aba.getLastColumn());
  const cab = aba.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x || '').trim(); });
  while (cab.length && !cab[cab.length - 1]) cab.pop();
  return cab;
}

/** Lembretes já registrados: por linha da BASE, o último envio sem erro e o último registro. */
function _lembFormLog_(ss, tz) {
  const aba = _lembFormAbaLog_(ss);
  const v = aba.getDataRange().getValues();
  const cab = _lembFormCabLog_(aba);
  const cQuando = cab.indexOf('Data/hora'), cLinha = cab.indexOf('Linha BASE'), cStatus = cab.indexOf('Status');
  const hoje = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const porLinha = {};
  for (let i = 1; i < v.length; i++) {
    const quando = v[i][cQuando], linha = String(v[i][cLinha] || '').trim();
    if (!linha || !_envioFormEhData_(quando)) continue;
    const p = porLinha[linha] || (porLinha[linha] = { ultimo: 0, enviadoHoje: false });
    p.ultimo = Math.max(p.ultimo, quando.getTime());
    if (String(v[i][cStatus] || '').trim().toUpperCase() === 'ENVIADO' && Utilities.formatDate(quando, tz, 'yyyy-MM-dd') === hoje) p.enviadoHoje = true;
  }
  return porLinha;
}

/** Pessoas da BASE (por data de admissão) que receberam o convite e ainda não preencheram. */
function _lembFormPendentes_() {
  const b = _envioFormLerBase_();
  const ss = b.ss;
  const cpfBase = _ex10Mapa_(b.valores[0])('CPF');
  const depBase = _ex10Mapa_(b.valores[0])('Departamento');

  const jaPreencheu = _envioFormJaPreencheu_(ss); // [2026-10-23] mesma regra do envio do formulário (EnvioFormularioAdmissao.js)
  const cancelados = {};
  const abaCanc = ss.getSheetByName('Cancelados');
  if (abaCanc) {
    const vc = abaCanc.getDataRange().getValues();
    const cn = _ex10Mapa_(vc[0] || [])('Nome');
    for (let i = 1; i < vc.length; i++) if (cn > -1 && _ex10NomeN_(vc[i][cn])) cancelados[_ex10NomeN_(vc[i][cn])] = true;
  }

  const hoje = Utilities.formatDate(new Date(), b.tz, 'yyyy-MM-dd');
  const lista = [];
  for (let i = 1; i < b.valores.length; i++) {
    const r = b.valores[i];
    const nome = String(r[b.c.NOME] || '').trim();
    const email = String(r[b.c.EMAIL] || '').trim();
    if (!nome && !email) continue;
    const iso = _envioFormIso_(r[b.c.ADMISSAO], b.tz);
    if (!iso) continue;
    if (String(r[b.c.STATUS] || '').trim().toUpperCase() !== 'ENVIADO') continue; // sem convite: usar o envio do formulário
    // [2026-10-26] convite enviado hoje: o lembrete só faz sentido a partir de amanhã (e assim ninguém
    // recebe convite e lembrete na mesma rodada da janela única)
    const conviteEm = r[b.c.DATA_HORA];
    if (_envioFormEhData_(conviteEm) && Utilities.formatDate(conviteEm, b.tz, 'yyyy-MM-dd') === hoje) continue;
    if (cancelados[_ex10NomeN_(nome)]) continue;
    if (jaPreencheu(nome, email, cpfBase > -1 ? r[cpfBase] : '')) continue; // já preencheu
    lista.push({
      linha: i + 1, iso: iso, nome: nome, email: email,
      funcao: b.c.FUNCAO > -1 ? String(r[b.c.FUNCAO] || '').trim() : '',
      departamento: depBase > -1 ? String(r[depBase] || '').trim() : ''
    });
  }
  return { ss: ss, tz: b.tz, lista: lista };
}

/** Para a janela: datas de admissão com gente sem preencher. */
function lembreteFormListar() {
  const p = _lembFormPendentes_();
  const log = _lembFormLog_(p.ss, p.tz);
  const porData = {};
  p.lista.forEach(function (x) {
    const d = porData[x.iso] || (porData[x.iso] = { iso: x.iso, br: _envioFormBr_(x.iso), pendentes: 0, lembradosHoje: 0, lembradosHojeSemEmail: 0, semEmail: 0, aEnviar: 0 });
    d.pendentes++;
    const l = log[String(x.linha)];
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email);
    if (l && l.enviadoHoje) { d.lembradosHoje++; if (!emailOk) d.lembradosHojeSemEmail++; } // e-mail mudou na BASE depois
    else if (!emailOk) d.semEmail++;
    else d.aEnviar++;
  });
  return Object.keys(porData).sort().map(function (k) { return porData[k]; });
}

/**
 * Envia um lote de lembretes para a data (aaaa-mm-dd). inicioMs = início da rodada (0 na primeira
 * chamada). Quem já foi tratado nesta rodada (inclusive com erro) não recebe de novo; quem já
 * recebeu lembrete hoje só recebe de novo com reenviarHoje = true.
 */
function lembreteFormEnviarLote(iso, inicioMs, reenviarHoje) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const comeco = Date.now();
    const inicio = inicioMs ? Number(inicioMs) : comeco;
    const p = _lembFormPendentes_();
    const log = _lembFormLog_(p.ss, p.tz);
    const abaLog = _lembFormAbaLog_(p.ss);
    const cabLog = _lembFormCabLog_(abaLog);
    const fila = p.lista.filter(function (x) {
      if (x.iso !== iso) return false;
      const l = log[String(x.linha)];
      return !(l && ((l.enviadoHoje && !reenviarHoje) || l.ultimo >= inicio));
    });

    const enviados = [], erros = [];
    let parouPorCota = false, processados = 0;
    for (let k = 0; k < fila.length && processados < ENVIO_FORM.LOTE; k++) {
      if (Date.now() - comeco > ENVIO_FORM.TEMPO_MAX_MS) break;
      const x = fila[k];
      let status = 'ENVIADO', erro = '';
      if (!x.email) { status = 'ERRO'; erro = 'sem e-mail na aba BASE'; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email)) { status = 'ERRO'; erro = 'e-mail inválido: ' + x.email; }
      else {
        if (MailApp.getRemainingDailyQuota() < 2) { parouPorCota = true; break; } // destinatário + cópia
        try {
          _lembFormEnviar_(x.email, ENVIO_FORM.CC, LEMBRETE_FORM.ASSUNTO, x.nome, _envioFormBr_(iso), x.funcao, false);
        } catch (e) {
          status = 'ERRO'; erro = String(e && e.message ? e.message : e);
        }
      }
      const reg = { 'Data/hora': new Date(), 'Data de admissão': _envioFormBr_(iso), 'Nome': x.nome, 'Cargo': x.funcao,
        'Departamento': x.departamento, 'E-mail': x.email, 'Linha BASE': x.linha, 'Status': status, 'Erro': erro };
      abaLog.appendRow(cabLog.map(function (h) { return Object.prototype.hasOwnProperty.call(reg, h) ? reg[h] : ''; }));
      processados++;
      if (status === 'ENVIADO') enviados.push(x.nome || x.email); else erros.push({ nome: x.nome || '(sem nome)', motivo: erro });
    }
    SpreadsheetApp.flush();
    return {
      inicio: inicio,
      enviados: enviados.length,
      erros: erros,
      restantes: Math.max(0, fila.length - processados),
      parouPorCota: parouPorCota
    };
  } finally {
    lock.releaseLock();
  }
}

/** Botão "Enviar e-mail de exemplo": manda o lembrete com dados fictícios só para LEMBRETE_FORM.EMAIL_EXEMPLO. */
function lembreteFormEnviarExemplo(iso) {
  const br = /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? _envioFormBr_(iso) : '09/10/2026';
  const assunto = '[EXEMPLO] ' + LEMBRETE_FORM.ASSUNTO;
  _lembFormEnviar_(LEMBRETE_FORM.EMAIL_EXEMPLO, '', assunto, 'MARIA DE TESTE DA SILVA', br, 'AGENTE ADMINISTRATIVO', true);
  return { para: LEMBRETE_FORM.EMAIL_EXEMPLO, assunto: assunto };
}

function _lembFormEnviar_(para, cc, assunto, nome, dataBr, funcao, exemplo) {
  const primeiro = _envioFormPrimeiroNome_(nomeParaEmail_(nome));
  const v = LEMBRETE_FORM.VARIANTE;
  const texto = (primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!') + '\n\n' +
    'Ainda não recebemos o seu cadastro de admissão. Para não atrasar a sua admissão no CIEDS, preencha o formulário e envie os documentos solicitados o quanto antes.\n\n' +
    'Data de admissão: ' + dataBr + (funcao ? '\nFunção: ' + funcao : '') + '\n\n' +
    'Acesse o formulário: ' + ENVIO_FORM.LINK + '\n\n' +
    v.nota + '\n\n' +
    'Ficou com alguma dúvida? Fale com o Departamento de Pessoal:\nE-mail: dp@cieds.org.br\nTelefone: (21) 2544-4516\n\n' +
    'Atenciosamente,\nDepartamento de Pessoal\nCIEDS';
  let html = _envioFormHtml_(primeiro, dataBr, funcao, v);
  if (exemplo) {
    html = '<p style="font-family:Arial,sans-serif;background:#fff3d9;color:#77510a;padding:8px 12px;border-radius:8px;font-size:13px">' +
      '<strong>E-MAIL DE EXEMPLO, com dados fictícios.</strong> É assim que o candidato recebe o lembrete.</p>' + html;
  }
  const opcoes = {
    to: para,
    subject: assunto,
    body: (exemplo ? 'E-MAIL DE EXEMPLO, com dados fictícios.\n\n' : '') + texto,
    htmlBody: html,
    inlineImages: { logoCieds: Utilities.newBlob(Utilities.base64Decode(ENVIO_FORM_LOGO_B64), 'image/png', 'cieds.png') },
    name: ENVIO_FORM.REMETENTE
  };
  if (cc) opcoes.cc = cc;
  MailApp.sendEmail(opcoes);
}
