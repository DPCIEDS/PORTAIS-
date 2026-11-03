/**
 * [2026-10-01] ENVIO DO FORMULÁRIO DE ADMISSÃO PELA ABA BASE
 * Menu "Admissão" > "Enviar formulário de admissão": a pessoa escolhe uma Data de Admissão da aba
 * BASE e o link do formulário vai por e-mail para todos com essa data, com cópia para o DP.
 * O resultado de cada envio fica nas colunas "Status do Envio", "Data/Hora do Envio" e "Erro".
 *
 * - Por padrão só envia para quem ainda não está como ENVIADO; há opção de reenviar para todos.
 * - Envia em lotes (o diálogo chama envioFormEnviarLote várias vezes) para não passar do limite
 *   de tempo do Apps Script; se parar no meio, é só abrir de novo e enviar: continua de onde parou.
 * - Os e-mails saem pela conta de quem clicou no menu (cota diária de e-mails dessa conta).
 * - Só usa serviços que o projeto já usava (planilha, menu, MailApp): não pede autorização nova
 *   para os gatilhos que já rodam aqui.
 * ATENÇÃO: este arquivo define onOpen. Se outro arquivo do projeto também definir onOpen, um
 * sobrescreve o outro; nesse caso junte os menus numa função só.
 */

const ENVIO_FORM = {
  ABA: 'BASE',
  LINK: 'https://script.google.com/macros/s/AKfycby8hRnkrntmM7bcLY38AfVYdPcyP6spm-MADeJiBz3K-2hufsOSx_ZYnbvcVBIHCdeGwQ/exec',
  CC: 'dp@cieds.org.br',
  REMETENTE: 'Departamento de Pessoal - CIEDS',
  ASSUNTO: 'CIEDS - Cadastro de admissão: preencha o formulário',
  COL: {
    // [2026-10-27] A coluna foi renomeada para "Nome Completo" na BASE; "Nome" continua aceito.
    NOME: ['Nome Completo', 'Nome'], EMAIL: 'E-mail', FUNCAO: 'Posto de Trabalho', ADMISSAO: 'Data de Admissão',
    STATUS: 'Status do Envio', DATA_HORA: 'Data/Hora do Envio', ERRO: 'Erro'
  },
  LOTE: 25,              // e-mails por chamada do diálogo
  TEMPO_MAX_MS: 240000   // para de pegar novos e-mails depois de 4 min numa chamada
};

function onOpen() {
  SpreadsheetApp.getUi()
    // [2026-10-23] ícones e grupos: formulário, exame e cancelamento (o Google não deixa pôr cor no menu)
    .createMenu('📋 Admissão')
    // [2026-10-26] Convite e lembrete num item só (pedido da Taynara): a janela manda o convite para quem
    // ainda não recebeu e o lembrete para quem recebeu e não preencheu (LembreteFormularioAdmissao.js).
    .addItem('📨 Formulário de admissão: enviar e lembrar', 'abrirEnvioFormularioAdmissao')
    .addSeparator()
    .addItem('🩺 Exame admissional: agendar e remarcar', 'exame0910Abrir') // [2026-10-02] ver ExameAdmissao0910.js
    .addSeparator()
    .addItem('❌ Cancelar admissão (registrar em Cancelados)', 'abrirCancelarAdmissao') // [2026-10-21] ver CancelarAdmissao.js
    .addToUi();
}

function abrirEnvioFormularioAdmissao() {
  const html = HtmlService.createHtmlOutputFromFile('EnvioFormularioDialogo').setWidth(580).setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Formulário de admissão: enviar e lembrar');
}

/** Lê a aba BASE e devolve as linhas com o índice das colunas (cabeçalho comparado sem acento). */
function _envioFormLerBase_() {
  const ss = SpreadsheetApp.getActive();
  const aba = ss.getSheetByName(ENVIO_FORM.ABA);
  if (!aba) throw new Error('Aba ' + ENVIO_FORM.ABA + ' não encontrada.');
  const valores = aba.getDataRange().getValues();
  const norm = function (s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  };
  const cab = (valores[0] || []).map(norm);
  const c = {};
  // Uma coluna pode ter mais de um nome aceito (lista): vale o primeiro que existir no cabeçalho.
  Object.keys(ENVIO_FORM.COL).forEach(function (k) {
    const nomes = [].concat(ENVIO_FORM.COL[k]);
    c[k] = -1;
    for (let i = 0; i < nomes.length && c[k] < 0; i++) c[k] = cab.indexOf(norm(nomes[i]));
  });
  ['NOME', 'EMAIL', 'ADMISSAO', 'STATUS', 'DATA_HORA', 'ERRO'].forEach(function (k) {
    if (c[k] < 0) throw new Error('Coluna "' + [].concat(ENVIO_FORM.COL[k]).join('" ou "') + '" não encontrada na aba ' + ENVIO_FORM.ABA + '.');
  });
  return { ss: ss, aba: aba, valores: valores, c: c, tz: ss.getSpreadsheetTimeZone() };
}

function _envioFormEhData_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v);
}

/** Data de Admissão -> 'yyyy-MM-dd' (aceita data da planilha ou texto dd/mm/aaaa). */
function _envioFormIso_(v, tz) {
  if (_envioFormEhData_(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

function _envioFormBr_(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

/**
 * [2026-10-23] Quem já preencheu o formulário (está na aba CADASTROS). Mesma comparação do lembrete
 * e do exame: CPF com nome compatível, ou o nome, ou o e-mail. Devolve uma função
 * (nome, email, cpf) -> true/false. Sem a aba CADASTROS, ninguém conta como preenchido.
 */
function _envioFormJaPreencheu_(ss) {
  const aba = ss.getSheetByName('CADASTROS');
  if (!aba) return function () { return false; };
  const cad = aba.getDataRange().getValues();
  const k = _ex10Mapa_(cad[0] || []);
  const kCpf = k('CPF'), kNome = k('Nome completo'), kEmail = k('E-mail pessoal');
  const nomesPorCpf = {}, nomes = {}, emails = {};
  for (let i = 1; i < cad.length; i++) {
    const nome = kNome > -1 ? String(cad[i][kNome] || '') : '';
    const cpf = kCpf > -1 ? _ex10Cpf_(cad[i][kCpf]) : '';
    if (cpf) (nomesPorCpf[cpf] = nomesPorCpf[cpf] || []).push(nome);
    if (_ex10NomeN_(nome)) nomes[_ex10NomeN_(nome)] = true;
    const em = kEmail > -1 ? String(cad[i][kEmail] || '').trim().toLowerCase() : '';
    if (em) emails[em] = true;
  }
  return function (nome, email, cpf) {
    const c = _ex10Cpf_(cpf);
    const porCpf = c && (nomesPorCpf[c] || []).some(function (n) { return _ex10NomesCompativeis_(nome, n); });
    const em = String(email || '').trim().toLowerCase();
    return !!(porCpf || nomes[_ex10NomeN_(nome)] || (em && emails[em]));
  };
}

/** [2026-10-23] Linha da BASE de quem já preencheu o formulário: fica fora da contagem e do envio. */
function _envioFormPreencheuLinha_(b, jaPreencheu, r) {
  if (b.cCpf === undefined) b.cCpf = _ex10Mapa_(b.valores[0])('CPF'); // acha a coluna uma vez só
  return jaPreencheu(String(r[b.c.NOME] || '').trim(), String(r[b.c.EMAIL] || '').trim(), b.cCpf > -1 ? r[b.cCpf] : '');
}

/**
 * Datas de admissão disponíveis, com quantas pessoas e quantas ainda não receberam.
 * [2026-10-23] Quem já preencheu o formulário não entra na contagem (pedido da Taynara): total,
 * enviados e pendentes contam só quem ainda não preencheu; preencheram vem à parte. Data em que
 * todos já preencheram não aparece.
 * [2026-10-26] Quem está na aba Cancelados também fica de fora (como no lembrete), contado à parte.
 * [2026-10-27] Toda data da BASE aparece, mesmo sem nada para enviar hoje (pedido da Taynara: "toda vez
 * que colocar novas pessoas com novas datas de admissão, tem que aparecer aqui"). convidadosHoje = quem
 * recebeu o convite hoje e ainda não preencheu (o lembrete para essas pessoas só vale a partir de amanhã).
 */
function envioFormListarDatas() {
  const b = _envioFormLerBase_();
  const jaPreencheu = _envioFormJaPreencheu_(b.ss);
  const cancelados = _ex10Cancelados_(b.ss);
  const hoje = Utilities.formatDate(new Date(), b.tz, 'yyyy-MM-dd');
  const porData = {};
  for (let i = 1; i < b.valores.length; i++) {
    const r = b.valores[i];
    if (!String(r[b.c.NOME] || '').trim() && !String(r[b.c.EMAIL] || '').trim()) continue;
    const iso = _envioFormIso_(r[b.c.ADMISSAO], b.tz);
    if (!iso) continue;
    const d = porData[iso] || (porData[iso] = { iso: iso, br: _envioFormBr_(iso), total: 0, enviados: 0, preencheram: 0, cancelados: 0, convidadosHoje: 0 });
    if (cancelados[_ex10NomeN_(r[b.c.NOME])]) { d.cancelados++; continue; }
    if (_envioFormPreencheuLinha_(b, jaPreencheu, r)) { d.preencheram++; continue; }
    d.total++;
    if (String(r[b.c.STATUS] || '').trim().toUpperCase() === 'ENVIADO') {
      d.enviados++;
      const em = r[b.c.DATA_HORA];
      if (_envioFormEhData_(em) && Utilities.formatDate(em, b.tz, 'yyyy-MM-dd') === hoje) d.convidadosHoje++;
    }
  }
  return Object.keys(porData).sort().map(function (k) {
    const d = porData[k];
    d.pendentes = d.total - d.enviados;
    return d;
  });
}

/**
 * Envia um lote. inicioMs = momento em que o envio começou (0 na primeira chamada: o servidor
 * define e devolve). Uma linha já tratada nesta rodada (Data/Hora do Envio >= inicio) não é
 * enviada de novo, nem quando deu erro.
 */
function envioFormEnviarLote(iso, reenviar, inicioMs) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const comeco = Date.now();
    const inicio = inicioMs ? Number(inicioMs) : comeco;
    const b = _envioFormLerBase_();
    const jaPreencheu = _envioFormJaPreencheu_(b.ss);
    const cancelados = _ex10Cancelados_(b.ss); // [2026-10-26] quem está em Cancelados não recebe o convite

    const fila = [];
    for (let i = 1; i < b.valores.length; i++) {
      const r = b.valores[i];
      if (_envioFormIso_(r[b.c.ADMISSAO], b.tz) !== iso) continue;
      if (!String(r[b.c.NOME] || '').trim() && !String(r[b.c.EMAIL] || '').trim()) continue;
      const ultimo = r[b.c.DATA_HORA];
      if (_envioFormEhData_(ultimo) && ultimo.getTime() >= inicio) continue; // já tratada nesta rodada
      if (!reenviar && String(r[b.c.STATUS] || '').trim().toUpperCase() === 'ENVIADO') continue;
      if (_envioFormPreencheuLinha_(b, jaPreencheu, r)) continue; // [2026-10-23] já preencheu: não recebe de novo, nem no reenvio
      if (cancelados[_ex10NomeN_(r[b.c.NOME])]) continue;
      fila.push(i);
    }

    const enviados = [], erros = [];
    let parouPorCota = false, processados = 0;
    for (let k = 0; k < fila.length && processados < ENVIO_FORM.LOTE; k++) {
      if (Date.now() - comeco > ENVIO_FORM.TEMPO_MAX_MS) break;
      const i = fila[k], r = b.valores[i];
      const nome = String(r[b.c.NOME] || '').trim();
      const email = String(r[b.c.EMAIL] || '').trim();
      let status = 'ENVIADO', erro = '';
      if (!email) { status = 'ERRO'; erro = 'sem e-mail na aba BASE'; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { status = 'ERRO'; erro = 'e-mail inválido: ' + email; }
      else {
        if (MailApp.getRemainingDailyQuota() < 2) { parouPorCota = true; break; } // destinatário + cópia
        try {
          _envioFormEmail_(email, nome, _envioFormBr_(iso), b.c.FUNCAO > -1 ? String(r[b.c.FUNCAO] || '').trim() : '');
        } catch (e) {
          status = 'ERRO'; erro = String(e && e.message ? e.message : e);
        }
      }
      const linha = i + 1;
      b.aba.getRange(linha, b.c.STATUS + 1).setValue(status);
      b.aba.getRange(linha, b.c.DATA_HORA + 1).setValue(new Date());
      b.aba.getRange(linha, b.c.ERRO + 1).setValue(erro);
      processados++;
      if (status === 'ENVIADO') enviados.push(nome || email); else erros.push({ nome: nome || '(sem nome)', motivo: erro });
    }
    SpreadsheetApp.flush();
    return {
      inicio: inicio,
      enviados: enviados.length,
      erros: erros,
      restantes: parouPorCota ? fila.length - processados : Math.max(0, fila.length - processados),
      parouPorCota: parouPorCota,
      cotaRestante: MailApp.getRemainingDailyQuota()
    };
  } finally {
    lock.releaseLock();
  }
}

function _envioFormEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _envioFormPrimeiroNome_(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/**
 * [2026-10-26] Janela única "Formulário de admissão: enviar e lembrar": por data de admissão, quantos
 * recebem o convite (envioFormListarDatas) e quantos recebem o lembrete (lembreteFormListar).
 */
function formAdmResumo() {
  const porData = {};
  envioFormListarDatas().forEach(function (d) { porData[d.iso] = { iso: d.iso, br: d.br, convite: d, lembrete: null }; });
  lembreteFormListar().forEach(function (d) {
    (porData[d.iso] = porData[d.iso] || { iso: d.iso, br: d.br, convite: null, lembrete: null }).lembrete = d;
  });
  return Object.keys(porData).sort().map(function (k) { return porData[k]; });
}

/** [2026-10-26] E-mail de exemplo do convite, com dados fictícios, só para o e-mail de teste (sem cópia para o DP). */
function envioFormEnviarExemplo(iso) {
  const br = /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? _envioFormBr_(iso) : '09/10/2026';
  _envioFormEmail_(LEMBRETE_FORM.EMAIL_EXEMPLO, 'MARIA DE TESTE DA SILVA', br, 'AGENTE ADMINISTRATIVO', true);
  return { para: LEMBRETE_FORM.EMAIL_EXEMPLO, assunto: '[EXEMPLO] ' + ENVIO_FORM.ASSUNTO };
}

function _envioFormEmail_(para, nome, dataBr, funcao, exemplo) {
  const primeiro = _envioFormPrimeiroNome_(nome);
  const ola = primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!';
  const texto = ola + '\n\n' +
    'Para dar andamento à sua admissão no CIEDS, preencha o formulário de cadastro e envie os documentos solicitados.\n\n' +
    'Data de admissão: ' + dataBr + (funcao ? '\nFunção: ' + funcao : '') + '\n\n' +
    'Acesse o formulário: ' + ENVIO_FORM.LINK + '\n\n' +
    'Antes de começar:\n' +
    '- Tenha em mãos os seus documentos. A lista completa aparece na primeira tela do formulário.\n' +
    '- Você pode preencher pelo celular ou pelo computador.\n' +
    '- Ao final, a tela mostra a confirmação de que o cadastro foi enviado.\n\n' +
    'Ficou com alguma dúvida? Fale com o Departamento de Pessoal:\nE-mail: dp@cieds.org.br\nTelefone: (21) 2544-4516\n\n' +
    'Atenciosamente,\nDepartamento de Pessoal\nCIEDS';
  const opcoes = {
    to: para,
    cc: ENVIO_FORM.CC,
    subject: ENVIO_FORM.ASSUNTO,
    body: texto,
    htmlBody: _envioFormHtml_(primeiro, dataBr, funcao),
    inlineImages: { logoCieds: Utilities.newBlob(Utilities.base64Decode(ENVIO_FORM_LOGO_B64), 'image/png', 'cieds.png') },
    name: ENVIO_FORM.REMETENTE
  };
  if (exemplo) { // [2026-10-26] exemplo: sem cópia para o DP, com aviso no topo
    delete opcoes.cc;
    opcoes.subject = '[EXEMPLO] ' + ENVIO_FORM.ASSUNTO;
    opcoes.body = 'E-MAIL DE EXEMPLO, com dados fictícios.\n\n' + texto;
    opcoes.htmlBody = '<p style="font-family:Arial,sans-serif;background:#fff3d9;color:#77510a;padding:8px 12px;border-radius:8px;font-size:13px">' +
      '<strong>E-MAIL DE EXEMPLO, com dados fictícios.</strong> É assim que o candidato recebe o convite.</p>' + opcoes.htmlBody;
  }
  MailApp.sendEmail(opcoes);
}

/** Corpo do e-mail no mesmo visual da carta do Santander (verde CIEDS, tabelas e estilos inline).
 *  v (opcional): textos de outra versão do e-mail (kicker, titulo, intro, botao, nota) - usado pelo lembrete. */
function _envioFormHtml_(primeiro, dataBr, funcao, v) {
  v = v || {};
  const VERDE = '#18564A', VERDE_MEDIO = '#247662', TINTA = '#173029', CINZA = '#5b6f69', LINHA = '#e3ebe8', FUNDO = '#f4f7f6';
  const fonte = 'font-family:Arial,Helvetica,sans-serif;';
  const ola = primeiro ? 'Olá, ' + _envioFormEsc_(primeiro) + '!' : 'Olá!';
  const dica = function (t) {
    return '<tr><td valign="top" style="padding:0 10px 8px 0;' + fonte + 'color:' + VERDE_MEDIO + ';font-size:15px;line-height:22px">&#10003;</td>' +
      '<td valign="top" style="' + fonte + 'padding:0 0 8px 0;font-size:14px;line-height:21px;color:' + TINTA + '">' + t + '</td></tr>';
  };
  const dado = function (rotulo, valor) {
    return '<tr><td style="' + fonte + 'padding:3px 14px 3px 0;font-size:13px;color:' + CINZA + ';white-space:nowrap">' + rotulo + '</td>' +
      '<td style="' + fonte + 'padding:3px 0;font-size:14px;font-weight:bold;color:' + TINTA + '">' + _envioFormEsc_(valor) + '</td></tr>';
  };
  return '' +
  '<div style="margin:0;padding:0;background:' + FUNDO + '">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + FUNDO + '">' +
  '<tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ' + LINHA + ';border-radius:14px;border-collapse:separate;overflow:hidden">' +
      '<tr><td style="background:' + VERDE + ';padding:20px 28px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          '<td valign="middle"><img src="cid:logoCieds" width="67" height="34" alt="CIEDS" style="display:block;border:0;height:34px;width:auto;' + fonte + 'color:#ffffff;font-size:20px;font-weight:bold"></td>' +
          '<td valign="middle" align="right" style="' + fonte + 'color:#cfe5de;font-size:12px;letter-spacing:.6px;text-transform:uppercase">Departamento de Pessoal</td>' +
        '</tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:30px 28px 6px 28px">' +
        '<div style="' + fonte + 'font-size:13px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;color:' + VERDE_MEDIO + ';margin:0 0 6px 0">' + (v.kicker || 'Cadastro de admissão') + '</div>' +
        '<h1 style="' + fonte + 'font-size:22px;line-height:28px;margin:0 0 16px 0;color:' + TINTA + '">' + (v.titulo || 'Preencha o seu cadastro de admissão') + '</h1>' +
        '<p style="' + fonte + 'font-size:15px;line-height:23px;margin:0 0 12px 0;color:' + TINTA + '">' + ola + '</p>' +
        '<p style="' + fonte + 'font-size:15px;line-height:23px;margin:0 0 18px 0;color:' + TINTA + '">' + (v.intro || 'Para dar andamento à sua admissão no CIEDS, preencha o formulário de cadastro e envie os documentos solicitados.') + '</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0">' +
          dado('Data de admissão', dataBr) + (funcao ? dado('Função', funcao) : '') +
        '</table>' +
      '</td></tr>' +
      '<tr><td align="center" style="padding:0 28px 24px 28px">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:' + VERDE_MEDIO + ';border-radius:10px">' +
          '<a href="' + ENVIO_FORM.LINK + '" target="_blank" style="' + fonte + 'display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">' + (v.botao || 'Preencher o formulário') + '</a>' +
        '</td></tr></table>' +
      '</td></tr>' +
      (v.nota ? '<tr><td align="center" style="' + fonte + 'padding:0 28px 22px 28px;font-size:13px;line-height:19px;color:' + CINZA + '">' + v.nota + '</td></tr>' : '') +
      '<tr><td style="padding:0 28px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef6f3;border:1px solid #d3e8e0;border-radius:12px;border-collapse:separate">' +
        '<tr><td style="padding:16px 20px 8px 20px">' +
          '<div style="' + fonte + 'font-size:14px;font-weight:bold;color:' + VERDE + ';margin:0 0 10px 0">Antes de começar</div>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
            dica('Tenha em mãos os seus documentos. A lista completa aparece na primeira tela do formulário.') +
            dica('Você pode preencher pelo celular ou pelo computador.') +
            dica('Ao final, a tela mostra a confirmação de que o cadastro foi enviado.') +
          '</table>' +
        '</td></tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 28px 8px 28px">' +
        '<p style="' + fonte + 'font-size:14px;line-height:21px;margin:0 0 6px 0;color:' + CINZA + '">Ficou com alguma dúvida? Fale com o Departamento de Pessoal:</p>' +
        '<p style="' + fonte + 'font-size:14px;line-height:22px;margin:0;color:' + TINTA + '">' +
          'E-mail: <a href="mailto:dp@cieds.org.br" style="color:' + VERDE_MEDIO + ';font-weight:bold;text-decoration:none">dp@cieds.org.br</a><br>' +
          'Telefone: <b>(21) 2544-4516</b></p>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 28px 28px 28px">' +
        '<p style="' + fonte + 'font-size:15px;line-height:22px;margin:0;color:' + TINTA + '">Atenciosamente,<br><b>Departamento de Pessoal</b><br>' +
          '<span style="color:' + CINZA + '">CIEDS</span></p>' +
      '</td></tr>' +
      '<tr><td style="' + fonte + 'background:' + FUNDO + ';border-top:1px solid ' + LINHA + ';padding:14px 28px;font-size:12px;line-height:18px;color:' + CINZA + '">' +
        'Se o botão não abrir, copie e cole este endereço no navegador:<br>' +
        '<a href="' + ENVIO_FORM.LINK + '" style="color:' + VERDE_MEDIO + ';word-break:break-all">' + ENVIO_FORM.LINK + '</a>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table></div>';
}

// Logotipo branco do CIEDS (o mesmo do formulário), 133x68 px, embutido no e-mail (cid:logoCieds).
const ENVIO_FORM_LOGO_B64 = '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';
