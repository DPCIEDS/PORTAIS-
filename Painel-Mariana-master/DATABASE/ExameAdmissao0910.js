/**
 * [2026-10-02] E-MAIL DO EXAME ADMISSIONAL (fila em massa por Data de Admissão)
 * Menu "Admissão" > "Enviar e-mail do exame admissional".
 *
 * Quem entra: quem tem Data de Admissão a partir de EXAME_0910.ADMISSAO_A_PARTIR_DE na aba BASE, já preencheu o
 * formulário (está na aba CADASTROS, em qualquer data). Todos fazem o exame desta admissão, mesmo
 * quem já tinha feito exame numa leva anterior. A fila segue a ordem de preenchimento do
 * formulário. Ver _ex10Sincronizar_.
 * [2026-10-20, a pedido da Taynara] DATAS_ADMISSAO virou lista (era uma única data fixa, '09/10') —
 * pra incluir uma nova leva (ex.: as 17 pessoas de 21/10) só acrescenta a data aqui, sem editar
 * mais nada no resto do arquivo (só esse array é lido para decidir quem entra na fila em massa).
 * [2026-10-22, a pedido da Taynara] A lista virou uma data mínima: entra na fila em massa qualquer
 * Data de Admissão igual ou depois de ADMISSAO_A_PARTIR_DE (09/10/2026). Assim uma leva nova entra
 * sozinha, sem editar o script. Quem foi admitido antes de 09/10 continua fora, para não mandar
 * e-mail a quem já fez exame nas levas antigas (que ficavam em outras abas de controle).
 *
 * Como funciona: a pessoa escolhe a DATA do exame na janela. O sistema agenda os próximos da fila
 * nessa data, até 96 por dia (48 às 12h e 48 às 14h; datas com outro limite em VAGAS_POR_DATA), grava na aba
 * "CONTROLE DE EXAME A PARTIR 09/10" (mesmas colunas das outras abas de controle, nome mantido por
 * já estar em uso — serve pra qualquer leva, não só a de 09/10) e envia o e-mail do exame. Para a
 * data seguinte, é só abrir de novo e escolher a outra data: a fila continua de onde parou. Se a
 * mesma data for escolhida de novo, completa as vagas que sobraram nela.
 *
 * Os e-mails saem pela conta de quem clicou, com cópia para dp@cieds.org.br, com o mesmo texto das
 * outras abas de controle de exame. Só usa serviços que o projeto já usava (planilha, menu, MailApp).
 *
 * [2026-10-05] Botão "Agendar uma pessoa específica": escolhe uma pessoa da BASE (qualquer data de
 * admissão, inclusive quem é de antes de ADMISSAO_A_PARTIR_DE ou não tem data nenhuma — ver soAvulso),
 * a data e o horário, e o e-mail sai na hora. Serve para separar colegas da mesma lotação em dias
 * diferentes e para quem ainda não preencheu o formulário. Ver exame0910AgendarAvulso.
 * Na mesma tela dá para REMARCAR quem já tem data (quem faltou): a pessoa recebe um e-mail
 * "REMARCADO" com a nova data e a data antiga fica na coluna Histórico. Ver exame0910Remarcar.
 */

const EXAME_0910 = {
  ABA: 'CONTROLE DE EXAME A PARTIR 09/10',
  // [2026-10-22] Entra na fila em massa quem tem Data de Admissão igual ou depois desta (aaaa-mm-dd).
  // Antes era uma lista fixa de datas ('2026-10-09', '2026-10-21'): leva nova ficava de fora.
  ADMISSAO_A_PARTIR_DE: '2026-10-09',
  HORARIOS: [
    { celula: '12:00', texto: '12h', vagas: 48 },
    { celula: '14:00', texto: '14h', vagas: 48 }
  ],
  // [2026-10-06] Datas com limite diferente do padrão (48 + 48 = 96). Chave aaaa-mm-dd, vagas por horário.
  VAGAS_POR_DATA: {
    '2026-10-07': { '12:00': 50, '14:00': 50 } // quarta 07/10: 100 pessoas (pedido do DP)
  },
  LOCAL: 'Avenida Rio Branco, 116 - 7º andar',
  ORIENTACAO: 'Após a realização do exame admissional, dirija-se ao CIEDS para concluir o seu processo de admissão.',
  ENDERECO_CIEDS: 'Rua Presidente Vargas, 417 - 18º andar - Centro',
  ASSUNTO: 'Exame Admissional - CIEDS',
  REMETENTE: 'Departamento Pessoal - CIEDS',
  CC: 'dp@cieds.org.br',
  EMAIL_EXEMPLO: 'taynarasilva2411@gmail.com', // destino do botão "Enviar e-mail de exemplo"
  LOTE: 25,
  TEMPO_MAX_MS: 240000,
  CAB: ['Ordem', 'Nome', 'E-mail', 'Protocolo', 'Documentação completa em', 'Data do exame', 'Horário',
    'Local do exame', 'Orientação após o exame', 'Endereço CIEDS', 'Status do agendamento', 'Texto do e-mail',
    'E-mail enviado', 'Data/hora envio', 'Erro envio', 'Histórico'] // Histórico: remarcações (05/10)
};

function exame0910Abrir() {
  const html = HtmlService.createHtmlOutputFromFile('ExameAdmissao0910Dialogo').setWidth(640).setHeight(700); // [2026-10-23] maior: horários e remarcar várias
  SpreadsheetApp.getUi().showModalDialog(html, 'E-mail do exame admissional');
}

function _ex10Norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function _ex10Cpf_(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d ? ('00000000000' + d).slice(-11) : '';
}
function _ex10EhData_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v); }
/** Data da planilha (Date ou texto dd/mm/aaaa) -> 'dd/MM/yyyy'. */
function _ex10Br_(v, tz) {
  if (_ex10EhData_(v)) return Utilities.formatDate(v, tz, 'dd/MM/yyyy');
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[3] : '';
}
function _ex10Iso_(br) { const p = String(br).split('/'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : ''; }
function _ex10Mapa_(cab) {
  const n = cab.map(_ex10Norm_);
  return function (nome) { return n.indexOf(_ex10Norm_(nome)); }; // índice 0-based, -1 se não há
}

/** Aba de controle: cria se não existir; cria no fim só as colunas que faltarem. */
function _ex10Aba_(ss) {
  let aba = ss.getSheetByName(EXAME_0910.ABA);
  if (!aba) {
    aba = ss.insertSheet(EXAME_0910.ABA);
    aba.getRange(1, 1, 1, EXAME_0910.CAB.length).setValues([EXAME_0910.CAB])
      .setFontWeight('bold').setBackground('#18564A').setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle');
    aba.setFrozenRows(1);
    const linhas = Math.max(aba.getMaxRows() - 1, 1);
    // Data e horário como texto, igual às outras abas de controle de exame.
    aba.getRange(2, EXAME_0910.CAB.indexOf('Data do exame') + 1, linhas, 1).setNumberFormat('@');
    aba.getRange(2, EXAME_0910.CAB.indexOf('Horário') + 1, linhas, 1).setNumberFormat('@');
    return aba;
  }
  const cab = aba.getRange(1, 1, 1, Math.max(aba.getLastColumn(), 1)).getValues()[0];
  const col = _ex10Mapa_(cab);
  const faltam = EXAME_0910.CAB.filter(function (h) { return col(h) < 0; });
  if (faltam.length) aba.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
  return aba;
}

/** Lê a aba de controle: linhas com conteúdo e o índice das colunas. */
function _ex10LerAba_(aba) {
  const valores = aba.getDataRange().getValues();
  const col = _ex10Mapa_(valores[0] || []);
  const c = {};
  EXAME_0910.CAB.forEach(function (h) { c[h] = col(h); });
  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    const r = valores[i];
    if (!String(r[c['Nome']] || '').trim() && !String(r[c['Protocolo']] || '').trim()) continue;
    linhas.push({ linha: i + 1, r: r });
  }
  return { c: c, linhas: linhas };
}

/** Data/hora da planilha (Date ou texto dd/mm/aaaa hh:mm:ss) -> milissegundos; Infinity se não der. */
function _ex10Momento_(v) {
  if (_ex10EhData_(v)) return v.getTime();
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime() : Infinity;
}

function _ex10NomeN_(s) { return _ex10Norm_(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

/** Mesmo primeiro nome, ou pelo menos 2 sobrenomes em comum (sem de/da/do/dos/das/e). */
function _ex10NomesCompativeis_(a, b) {
  const part = { de: 1, da: 1, 'do': 1, dos: 1, das: 1, e: 1 };
  const ta = _ex10NomeN_(a).split(' ').filter(function (t) { return t && !part[t]; });
  const tb = _ex10NomeN_(b).split(' ').filter(function (t) { return t && !part[t]; });
  if (!ta.length || !tb.length) return false;
  if (ta[0] === tb[0]) return true;
  const sb = {};
  tb.forEach(function (t) { sb[t] = true; });
  return ta.filter(function (t) { return sb[t]; }).length >= 2;
}

/**
 * [2026-10-05] Pessoas da BASE com admissão a partir de ADMISSAO_A_PARTIR_DE e, para quem já preencheu o formulário, o primeiro
 * preenchimento na CADASTROS. Devolve as pessoas (na ordem da BASE) e os elegíveis da fila (na ordem
 * de preenchimento do formulário).
 * Cruzamento BASE x CADASTROS: pelo CPF quando o nome também combina (há CPF de uma pessoa
 * cadastrado na BASE para outra) e, se não achar, pelo nome (há CPF digitado diferente).
 */
function _ex10Pessoas0910_(ss, tz) {
  const base = ss.getSheetByName('BASE').getDataRange().getValues();
  const b = _ex10Mapa_(base[0]);
  // [2026-10-27] A coluna foi renomeada para "Nome Completo" na BASE; "Nome" continua aceito.
  const bNome = b('Nome Completo') > -1 ? b('Nome Completo') : b('Nome'), bEmail = b('E-mail'), bCpf = b('CPF'), bAdm = b('Data de Admissão');
  const bPosto = b('Posto'), bDep = b('Departamento');
  if (bAdm < 0) throw new Error('A aba BASE precisa da coluna "Data de Admissão".');
  const pessoas = [], porCpf = {}, porNome = {}, outras = [];
  for (let i = 1; i < base.length; i++) {
    // [2026-10-09] Todas as pessoas da BASE entram no "Agendar uma pessoa específica"; só quem tem
    // admissão a partir de EXAME_0910.ADMISSAO_A_PARTIR_DE entra na fila em massa (soAvulso = admissão
    // antes dessa data, ou sem data).
    const admBr = _ex10Br_(base[i][bAdm], tz);
    const admIso = _ex10Iso_(admBr);
    const soAvulso = !admIso || admIso < EXAME_0910.ADMISSAO_A_PARTIR_DE;
    const p = {
      linhaBase: i + 1,
      admissao: admBr, soAvulso: soAvulso,
      nome: String(base[i][bNome] || '').trim(),
      email: bEmail > -1 ? String(base[i][bEmail] || '').trim() : '',
      posto: String((bPosto > -1 && base[i][bPosto]) || (bDep > -1 && base[i][bDep]) || '').trim(),
      visto: false, prot: '', nomeForm: '', emailForm: '', envio: ''
    };
    if (soAvulso) { if (p.nome) outras.push({ p: p, cpf: bCpf > -1 ? _ex10Cpf_(base[i][bCpf]) : '' }); continue; }
    pessoas.push(p);
    const cpf = bCpf > -1 ? _ex10Cpf_(base[i][bCpf]) : '';
    if (cpf) porCpf[cpf] = p;
    const nn = _ex10NomeN_(p.nome);
    if (nn) porNome[nn] = Object.prototype.hasOwnProperty.call(porNome, nn) ? null : p; // nome repetido: não usa
  }

  // CADASTROS, na ordem de preenchimento
  const cad = ss.getSheetByName('CADASTROS').getDataRange().getValues();
  const k = _ex10Mapa_(cad[0]);
  const kCpf = k('CPF'), kProt = k('Protocolo'), kNome = k('Nome completo'), kEmail = k('E-mail pessoal'), kEnvio = k('Data/hora do envio');
  if (kProt < 0) throw new Error('A aba CADASTROS precisa da coluna "Protocolo".');
  const elegiveis = [];
  // Ordem de preenchimento: pela data/hora do envio (empate: ordem da linha).
  const ordemCad = [];
  for (let i = 1; i < cad.length; i++) ordemCad.push({ i: i, t: kEnvio > -1 ? _ex10Momento_(cad[i][kEnvio]) : i });
  ordemCad.sort(function (a, b2) { return a.t - b2.t || a.i - b2.i; });
  const resolvida = {}; // linhas da CADASTROS ligadas a alguém da BASE na 1ª passada
  const ligar = function (p, i, o, prot, nomeCad) {
    p.visto = true; // vale o primeiro preenchimento da pessoa
    p.prot = prot;
    p.nomeForm = nomeCad;
    p.emailForm = kEmail > -1 ? String(cad[i][kEmail] || '').trim() : '';
    p.envio = kEnvio > -1 ? cad[i][kEnvio] : '';
    if (p.soAvulso) return; // outra data de admissão: não entra na fila em massa
    elegiveis.push({ prot: prot, nome: _ex10NomePessoa_(p), email: _ex10EmailPessoa_(p), envio: p.envio, pessoa: p, ordem: o });
  };
  for (let o = 0; o < ordemCad.length; o++) {
    const i = ordemCad[o].i;
    const nomeCad = kNome > -1 ? String(cad[i][kNome] || '').trim() : '';
    const cpf = kCpf > -1 ? _ex10Cpf_(cad[i][kCpf]) : '';
    let p = null;
    if (cpf && porCpf[cpf] && _ex10NomesCompativeis_(porCpf[cpf].nome, nomeCad)) p = porCpf[cpf];
    if (!p) p = porNome[_ex10NomeN_(nomeCad)] || null;
    if (!p) continue;
    resolvida[i] = true;
    if (p.visto) continue;
    const prot = String(cad[i][kProt] || '').trim();
    if (!prot) continue;
    ligar(p, i, o, prot, nomeCad);
  }

  // [2026-10-07] 2ª passada, só para quem da BASE ficou sem formulário e só com linhas da CADASTROS
  // que não foram ligadas a ninguém na 1ª passada (quem já está ligado não muda):
  // - o mesmo nome sem "de/da/do/dos/das/e" (BASE "MAYARA DE SOUZA SILVA" x formulário
  //   "Mayara de Souza da Silva", com CPF errado na BASE);
  // - ou o mesmo e-mail, com nome compatível.
  // Nome ou e-mail repetido entre as pessoas que sobraram não vale.
  const PART = { de: 1, da: 1, 'do': 1, dos: 1, das: 1, e: 1 };
  const semPart = function (nome) { return _ex10NomeN_(nome).split(' ').filter(function (t) { return t && !PART[t]; }).join(' '); };
  const unico = function (mapa, k, p) { if (k) mapa[k] = Object.prototype.hasOwnProperty.call(mapa, k) ? null : p; };
  const porNomeSP = {}, porEmailB = {};
  pessoas.forEach(function (p) {
    if (p.visto) return;
    unico(porNomeSP, semPart(p.nome), p);
    unico(porEmailB, String(p.email || '').trim().toLowerCase(), p);
  });
  for (let o = 0; o < ordemCad.length; o++) {
    const i = ordemCad[o].i;
    if (resolvida[i]) continue;
    const prot = String(cad[i][kProt] || '').trim();
    if (!prot) continue;
    const nomeCad = kNome > -1 ? String(cad[i][kNome] || '').trim() : '';
    const emailCad = kEmail > -1 ? String(cad[i][kEmail] || '').trim().toLowerCase() : '';
    let p = porNomeSP[semPart(nomeCad)] || null;
    if (!p && emailCad && porEmailB[emailCad] && _ex10NomesCompativeis_(porEmailB[emailCad].nome, nomeCad)) p = porEmailB[emailCad];
    if (!p || p.visto) continue;
    ligar(p, i, o, prot, nomeCad);
  }
  elegiveis.sort(function (a, b2) { return a.ordem - b2.ordem; }); // ordem de preenchimento

  // [2026-10-09] Pessoas de outras datas de admissão: entram depois, para não mudar o cruzamento
  // de ADMISSAO_A_PARTIR_DE. Formulário delas (só informativo): CPF com nome compatível, nome igual ou
  // e-mail com nome compatível; vale o primeiro preenchimento. Nunca entram na fila em massa.
  const xCpf = {}, xNome = {}, xEmail = {};
  outras.forEach(function (x) {
    if (x.cpf) unico(xCpf, x.cpf, x.p);
    unico(xNome, _ex10NomeN_(x.p.nome), x.p);
    unico(xEmail, String(x.p.email || '').trim().toLowerCase(), x.p);
  });
  for (let o = 0; o < ordemCad.length && outras.length; o++) {
    const i = ordemCad[o].i;
    const prot = String(cad[i][kProt] || '').trim();
    if (!prot) continue;
    const nomeCad = kNome > -1 ? String(cad[i][kNome] || '').trim() : '';
    const cpf = kCpf > -1 ? _ex10Cpf_(cad[i][kCpf]) : '';
    const emailCad = kEmail > -1 ? String(cad[i][kEmail] || '').trim().toLowerCase() : '';
    let p = null;
    if (cpf && xCpf[cpf] && _ex10NomesCompativeis_(xCpf[cpf].nome, nomeCad)) p = xCpf[cpf];
    if (!p) p = xNome[_ex10NomeN_(nomeCad)] || null;
    if (!p && emailCad && xEmail[emailCad] && _ex10NomesCompativeis_(xEmail[emailCad].nome, nomeCad)) p = xEmail[emailCad];
    if (!p || p.visto) continue;
    ligar(p, i, o, prot, nomeCad); // soAvulso: ligar não põe na fila
  }
  outras.forEach(function (x) { pessoas.push(x.p); });
  // [2026-10-26] Data/hora do envio de TODO protocolo da CADASTROS, para completar "Documentação
  // completa em" pela linha da aba (ver _ex10CompletarDocumentacao_), mesmo quando o protocolo da
  // linha não é o primeiro preenchimento da pessoa ou a linha foi gravada por outra automação.
  const envioPorProt = {};
  if (kEnvio > -1) for (let i = 1; i < cad.length; i++) {
    const prot = String(cad[i][kProt] || '').trim();
    if (prot && cad[i][kEnvio] !== '' && cad[i][kEnvio] != null && !Object.prototype.hasOwnProperty.call(envioPorProt, prot)) envioPorProt[prot] = cad[i][kEnvio];
  }
  return { pessoas: pessoas, elegiveis: elegiveis, envioPorProt: envioPorProt };
}

/**
 * Nome usado no e-mail: o digitado pela pessoa no formulário (o da BASE pode ter anotações do DP,
 * como "POSTO MIGRADO", vir cortado ou com outra grafia). A BASE só entra se não houver formulário.
 */
function _ex10NomePessoa_(p) { return nomeParaEmail_(p.nomeForm || p.nome).toUpperCase(); }
/** E-mail usado: o do formulário; se for inválido ou não houver formulário, o da BASE. */
function _ex10EmailPessoa_(p) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(p.emailForm || '').trim()) ? String(p.emailForm).trim() : p.email;
}
/** [2026-10-06] Vagas de um horário numa data (aaaa-mm-dd): a exceção da data em VAGAS_POR_DATA ou o padrão do horário. */
function _ex10Vagas_(iso, h) {
  const d = EXAME_0910.VAGAS_POR_DATA[String(iso)];
  return d && Object.prototype.hasOwnProperty.call(d, h.celula) ? Number(d[h.celula]) : h.vagas;
}
function _ex10HorarioTexto_(celula) {
  const v = String(celula == null ? '' : celula).trim();
  const h = EXAME_0910.HORARIOS.filter(function (y) { return y.celula === v; })[0];
  if (h) return h.texto;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) + 'h' + (m[2] === '00' ? '' : m[2]) : v; // 09:30 -> 9h30
}
/**
 * [2026-10-09] Horário escolhido no "Agendar uma pessoa específica": um dos HORARIOS (com limite de
 * vagas) ou qualquer outro hh:mm, sem limite de vagas. null se não for um horário válido.
 */
function _ex10Horario_(celula) {
  const v = String(celula == null ? '' : celula).trim();
  const h = EXAME_0910.HORARIOS.filter(function (y) { return y.celula === v; })[0];
  if (h) return h;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? { celula: v, texto: _ex10HorarioTexto_(v), vagas: Infinity } : null;
}

/**
 * [2026-10-23] Horários escolhidos na tela principal para agendar a fila: [{ celula: 'hh:mm', quantidade: n }],
 * na ordem em que a fila é distribuída. A quantidade é quantas pessoas agendar AGORA naquele horário
 * (a pessoa decide, mesmo passando do padrão de 48). Recusa horário inválido ou repetido.
 */
function _ex10HorariosEscolhidos_(escolhidos) {
  if (!Array.isArray(escolhidos) || !escolhidos.length) throw new Error('Escolha pelo menos um horário.');
  const vistos = {};
  return escolhidos.map(function (e) {
    const h = _ex10Horario_(e && e.celula);
    if (!h) throw new Error('Horário inválido: ' + (e && e.celula ? e.celula : '(vazio)') + '.');
    if (vistos[h.celula]) throw new Error('O horário ' + h.texto + ' está repetido.');
    vistos[h.celula] = true;
    const n = Number(e.quantidade);
    if (!(n >= 0 && n <= 500 && Math.floor(n) === n)) throw new Error('Quantidade inválida para as ' + h.texto + ' (use de 0 a 500).');
    return { h: h, vagas: n };
  });
}

/** [2026-10-23] Chave de uma linha da aba de controle para a remarcação em grupo (o número da linha muda quando a fila é refeita). */
function _ex10ChaveLinha_(x, c) {
  const prot = String(x.r[c['Protocolo']] || '').trim();
  return prot ? 'P:' + prot : 'N:' + _ex10NomeN_(x.r[c['Nome']]) + '|' + String(x.r[c['E-mail']] || '').trim().toLowerCase();
}

/**
 * [2026-10-05] Índice da aba de controle para achar a linha de uma pessoa: pelo Protocolo (quem
 * entrou pela fila) e, nas linhas agendadas à mão sem protocolo (quem foi agendado antes de
 * preencher o formulário), pelo nome e pelo e-mail.
 */
function _ex10IndiceAba_(lido, tz) {
  const c = lido.c, ix = { prot: {}, nome: {}, email: {} };
  lido.linhas.forEach(function (x) {
    const prot = String(x.r[c['Protocolo']] || '').trim();
    if (prot) { if (!ix.prot[prot]) ix.prot[prot] = x; return; }
    if (!_ex10Br_(x.r[c['Data do exame']], tz)) return;
    const nn = _ex10NomeN_(x.r[c['Nome']]);
    if (nn && !ix.nome[nn]) ix.nome[nn] = x;
    const em = String(x.r[c['E-mail']] || '').trim().toLowerCase();
    if (em && !ix.email[em]) ix.email[em] = x;
  });
  return ix;
}
/** Linha agendada à mão (sem protocolo) que é desta pessoa, pelo nome (BASE ou formulário) ou e-mail. */
function _ex10LinhaAvulsa_(ix, p) {
  const nomes = [p.nome, p.nomeForm].filter(Boolean).map(function (n) { return _ex10NomeN_(nomeParaEmail_(n)); });
  for (let i = 0; i < nomes.length; i++) if (nomes[i] && ix.nome[nomes[i]]) return ix.nome[nomes[i]];
  const ems = [p.email, p.emailForm].map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
  for (let i = 0; i < ems.length; i++) if (ix.email[ems[i]]) return ix.email[ems[i]];
  return null;
}
function _ex10LinhaDaPessoa_(ix, p) { return _ex10LinhaAvulsa_(ix, p) || (p.prot && ix.prot[p.prot]) || null; }

/** Nomes da aba Cancelados (se existir), para avisar na janela. */
function _ex10Cancelados_(ss) {
  const aba = ss.getSheetByName('Cancelados');
  const out = {};
  if (!aba) return out;
  const v = aba.getDataRange().getValues();
  const cn = _ex10Mapa_(v[0] || [])('Nome');
  if (cn < 0) return out;
  for (let i = 1; i < v.length; i++) { const nn = _ex10NomeN_(v[i][cn]); if (nn) out[nn] = true; }
  return out;
}

/**
 * [2026-10-02] Quem entra na fila do exame: tem Data de Admissão a partir de EXAME_0910.ADMISSAO_A_PARTIR_DE na
 * aba BASE e já preencheu o formulário (aba CADASTROS, em qualquer data). Todos fazem o exame desta
 * admissão, mesmo quem já fez exame numa leva anterior (pedido da Taynara).
 * A fila segue a ordem de preenchimento do formulário, pela coluna "Data/hora do envio" da
 * CADASTROS (as linhas antigas da aba foram reordenadas); vale o primeiro preenchimento da pessoa.
 * Cruzamento BASE x CADASTROS: pelo CPF quando o nome também combina (há CPF de uma pessoa
 * cadastrado na BASE para outra) e, se não achar, pelo nome (há CPF digitado diferente).
 * Linhas da aba que ainda não têm data de exame formam a fila e são refeitas nessa ordem; linhas
 * que já têm data de exame não mudam.
 */
function _ex10Sincronizar_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const aba = _ex10Aba_(ss);
  const pe = _ex10Pessoas0910_(ss, tz); // BASE (admissão a partir de ADMISSAO_A_PARTIR_DE) x CADASTROS
  const elegiveis = pe.elegiveis;

  // Fila da aba = linhas sem data de exame. Refaz na ordem do formulário quando mudou.
  let atual = _ex10LerAba_(aba);
  const c = atual.c;
  _ex10CompletarDocumentacao_(aba, atual, elegiveis, pe.envioPorProt);
  const comData = {}, emailAntes = {};
  const comDataNome = {}, comDataEmail = {}; // [2026-10-26] quem já tem exame marcado na aba, por nome e e-mail
  const filaAtual = [];
  atual.linhas.forEach(function (x) {
    const prot = String(x.r[c['Protocolo']] || '').trim();
    if (_ex10Br_(x.r[c['Data do exame']], tz)) {
      comData[prot] = true;
      const nn = _ex10NomeN_(nomeParaEmail_(x.r[c['Nome']]));
      if (nn) comDataNome[nn] = true;
      const em = String(x.r[c['E-mail']] || '').trim().toLowerCase();
      if (em) comDataEmail[em] = true;
    }
    else { filaAtual.push({ prot: prot, linha: x.linha }); emailAntes[prot] = String(x.r[c['E-mail']] || '').trim(); }
  });
  // [2026-10-05] Quem foi agendado à mão antes de preencher o formulário (linha sem protocolo)
  // não volta para a fila quando preencher.
  const ixAvulso = _ex10IndiceAba_(atual, tz);
  // [2026-10-26] Também não volta para a fila quem já tem exame com OUTRO protocolo (preencheu o
  // formulário duas vezes, ou a linha foi gravada por outra automação com o 2º protocolo): mesmo nome
  // (da BASE ou do formulário) ou mesmo e-mail de uma linha com data de exame. Sem isso a pessoa
  // recebia um segundo e-mail de exame ao agendar a fila.
  const jaTemExame = function (e) {
    if (comData[e.prot]) return true;
    const p = e.pessoa;
    const nomes = [p.nome, p.nomeForm].filter(Boolean).map(function (n) { return _ex10NomeN_(nomeParaEmail_(n)); });
    if (nomes.some(function (n) { return n && comDataNome[n]; })) return true;
    return [p.email, p.emailForm, e.email].some(function (m) { const k = String(m || '').trim().toLowerCase(); return k && comDataEmail[k]; });
  };
  const fila = elegiveis.filter(function (e) { return !jaTemExame(e) && !_ex10LinhaAvulsa_(ixAvulso, e.pessoa); });
  const protsAtuais = filaAtual.map(function (x) { return x.prot; });
  const protsNovos = fila.map(function (e) { return e.prot; });
  const naNova = {}; protsNovos.forEach(function (p) { naNova[p] = true; });
  const naAtual = {}; protsAtuais.forEach(function (p) { naAtual[p] = true; });
  const resultado = {
    aba: aba,
    pessoas: pe.pessoas,
    novas: protsNovos.filter(function (p) { return !naAtual[p]; }).length,
    removidas: protsAtuais.filter(function (p) { return !naNova[p]; }).length
  };
  if (JSON.stringify(protsAtuais) === JSON.stringify(protsNovos)) return resultado;

  const ehPrefixo = protsAtuais.every(function (p, i) { return protsNovos[i] === p; });
  let aEscrever = fila;
  if (!ehPrefixo) {
    // Apaga as linhas da fila (em blocos de linhas seguidas, de baixo para cima) e reescreve.
    const linhas = filaAtual.map(function (x) { return x.linha; }).sort(function (a, b2) { return b2 - a; });
    let i = 0;
    while (i < linhas.length) {
      let fim = linhas[i], ini = fim;
      while (i + 1 < linhas.length && linhas[i + 1] === ini - 1) { i++; ini = linhas[i]; }
      aba.deleteRows(ini, fim - ini + 1);
      i++;
    }
    atual = _ex10LerAba_(aba);
  } else {
    aEscrever = fila.slice(protsAtuais.length); // só acrescenta no fim
  }
  let ultimaLinha = 1;
  atual.linhas.forEach(function (x) { ultimaLinha = Math.max(ultimaLinha, x.linha); });
  if (aEscrever.length) {
    const novas = aEscrever.map(function (e) {
      const linha = new Array(c['Erro envio'] + 1).fill('');
      linha[c['Nome']] = e.nome;
      linha[c['E-mail']] = emailAntes[e.prot] || e.email; // mantém e-mail corrigido à mão na aba
      linha[c['Protocolo']] = e.prot;
      linha[c['Documentação completa em']] = e.envio;
      return linha;
    });
    aba.getRange(ultimaLinha + 1, 1, novas.length, novas[0].length).setValues(novas);
  }
  // Ordem = posição na aba (1, 2, 3...).
  const total = _ex10LerAba_(aba).linhas.length;
  if (total) {
    const ordens = [];
    for (let n = 1; n <= total; n++) ordens.push([n]);
    aba.getRange(2, c['Ordem'] + 1, total, 1).setValues(ordens);
  }
  return resultado;
}

/**
 * [2026-10-05] Linha da aba com protocolo e sem "Documentação completa em" recebe a data/hora do
 * envio do formulário (CADASTROS). Três linhas criadas em 05/10 às 14:40 ficaram sem essa data;
 * assim qualquer linha que fique em branco se completa na próxima vez que a janela abrir.
 */
function _ex10CompletarDocumentacao_(aba, lido, elegiveis, envioCadastros) {
  const c = lido.c;
  const cDoc = c['Documentação completa em'], cProt = c['Protocolo'];
  if (cDoc < 0 || cProt < 0) return 0;
  // [2026-10-26] Vale a data do PRÓPRIO protocolo da linha na CADASTROS (envioCadastros), não só a de
  // quem está na fila: em 23–24/10 linhas gravadas por outra automação ficaram sem essa data.
  const envioPorProt = {};
  Object.keys(envioCadastros || {}).forEach(function (p) { envioPorProt[p] = envioCadastros[p]; });
  elegiveis.forEach(function (e) { if (e.prot && e.envio !== '' && e.envio != null) envioPorProt[e.prot] = e.envio; });
  let n = 0;
  lido.linhas.forEach(function (x) {
    const prot = String(x.r[cProt] || '').trim();
    const doc = x.r[cDoc];
    if (!prot || (doc !== '' && doc != null) || !Object.prototype.hasOwnProperty.call(envioPorProt, prot)) return;
    aba.getRange(x.linha, cDoc + 1).setValue(envioPorProt[prot]);
    x.r[cDoc] = envioPorProt[prot];
    n++;
  });
  return n;
}

/** Resumo para a janela: fila sem data e o que já foi agendado por data. */
function exame0910Resumo() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const sinc = _ex10Sincronizar_(ss);
    const lido = _ex10LerAba_(sinc.aba);
    const c = lido.c;
    let aguardando = 0;
    const porData = {};
    lido.linhas.forEach(function (x) {
      const br = _ex10Br_(x.r[c['Data do exame']], tz);
      if (!br) { aguardando++; return; }
      const d = porData[br] || (porData[br] = { br: br, iso: _ex10Iso_(br), total: 0, porHorario: {}, enviados: 0, pendentes: 0, erros: 0 });
      d.total++;
      const h = String(x.r[c['Horário']] || '').trim();
      d.porHorario[h] = (d.porHorario[h] || 0) + 1;
      if (x.r[c['E-mail enviado']] === true) d.enviados++; else d.pendentes++;
      if (x.r[c['E-mail enviado']] !== true && String(x.r[c['Erro envio']] || '').trim()) d.erros++;
    });
    return {
      aba: EXAME_0910.ABA,
      aguardando: aguardando,
      novasAgora: sinc.novas,
      removidasAgora: sinc.removidas,
      totalNaAba: lido.linhas.length,
      datas: Object.keys(porData).map(function (k) { return porData[k]; }).sort(function (a, b) { return a.iso < b.iso ? -1 : 1; }),
      horarios: EXAME_0910.HORARIOS,
      vagasPorData: EXAME_0910.VAGAS_POR_DATA,
      hoje: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')
    };
  } finally {
    lock.releaseLock();
  }
}

const DIAS_SEMANA_EX10 = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
function _ex10DiaSemana_(dataBr) {
  const p = String(dataBr).split('/');
  return p.length === 3 ? DIAS_SEMANA_EX10[new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0])).getDay()] : '';
}
/** Assunto com a data e o horário, para aparecer já na caixa de entrada. */
function _ex10Assunto_(dataBr, horarioTexto, remarcado) {
  return EXAME_0910.ASSUNTO + (remarcado ? ' - REMARCADO' : '') + ' - ' + dataBr + ' às ' + horarioTexto;
}

/**
 * Texto do e-mail. [2026-10-02] A data (com o dia da semana) e o horário em que a pessoa deve
 * comparecer ficam em destaque, logo no começo, no assunto e no texto simples.
 */
/** [2026-10-09] remarcado: 'dia' (só a data mudou), 'hora' (só o horário) ou 'ambos'/true (os dois). */
function _ex10NovoQue_(remarcado) {
  return remarcado === 'dia' ? 'no novo dia' : remarcado === 'hora' ? 'no novo horário' : 'no novo dia e horário';
}
/** [2026-10-09] O que mudou na última remarcação registrada no Histórico ("de X às Y para Z às W."). */
function _ex10RemarcadoDoHistorico_(hist) {
  const ms = String(hist || '').match(/de (\d{2}\/\d{2}\/\d{4}) às (\S+) para (\d{2}\/\d{2}\/\d{4}) às (\S+?)\./g);
  if (!ms) return 'ambos';
  const m = ms[ms.length - 1].match(/de (\S+) às (\S+) para (\S+) às (\S+?)\./);
  const mudouDia = m[1] !== m[3], mudouHora = m[2] !== m[4];
  return mudouDia && mudouHora ? 'ambos' : mudouDia ? 'dia' : mudouHora ? 'hora' : 'ambos';
}
function _ex10Textos_(nome, dataBr, horarioTexto, remarcado) {
  nome = nomeParaEmail_(nome);
  const dia = _ex10DiaSemana_(dataBr);
  const dataCompleta = (dia ? dia + ', ' : '') + dataBr;
  const novo = _ex10NovoQue_(remarcado);
  const texto =
    'Prezado(a) ' + nome + ',\n\n' +
    (remarcado ? 'Seu exame admissional foi REMARCADO. Compareça ' + novo + ' abaixo:\n\n'
      : 'Seu exame admissional foi agendado. Compareça no dia e no horário abaixo:\n\n') +
    'DATA: ' + dataCompleta + '\n' +
    'HORÁRIO: ' + horarioTexto + '\n' +
    'LOCAL DO EXAME: ' + EXAME_0910.LOCAL + '\n\n' +
    'Por gentileza, compareça ao local do exame portando RG e CPF.\n\n' +
    EXAME_0910.ORIENTACAO + '\n\n' +
    'Endereço do CIEDS: ' + EXAME_0910.ENDERECO_CIEDS + '.\n\n' +
    'Atenciosamente,\n' +
    'Departamento Pessoal - CIEDS';
  const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const f = 'font-family:Arial,Helvetica,sans-serif;';
  const linhaInfo = function (rotulo, valor, grande) {
    return '<tr><td style="' + f + 'padding:6px 16px 6px 0;font-size:13px;color:#5b6f69;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;vertical-align:top">' + rotulo + '</td>' +
      '<td style="' + f + 'padding:6px 0;font-size:' + (grande ? '22px' : '15px') + ';font-weight:bold;color:#173029;line-height:1.3">' + esc(valor) + '</td></tr>';
  };
  const html =
    '<div style="' + f + 'font-size:15px;color:#202124;line-height:1.6;max-width:600px">' +
      '<p>Prezado(a) <strong>' + esc(nome) + '</strong>,</p>' +
      (remarcado ? '<p>Seu exame admissional foi <strong>REMARCADO</strong>. <strong>Compareça ' + novo + ' abaixo:</strong></p>'
        : '<p>Seu exame admissional foi agendado. <strong>Compareça no dia e no horário abaixo:</strong></p>') +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#eef6f3;border:2px solid #247662;border-radius:12px;border-collapse:separate;margin:6px 0 18px 0">' +
        '<tr><td style="padding:14px 18px">' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
            linhaInfo('Data', dataCompleta, true) +
            linhaInfo('Horário', horarioTexto, true) +
            linhaInfo('Local do exame', EXAME_0910.LOCAL, false) +
          '</table>' +
        '</td></tr>' +
      '</table>' +
      '<p>Por gentileza, compareça ao local do exame portando <strong>RG e CPF</strong>.</p>' +
      '<p><strong>' + esc(EXAME_0910.ORIENTACAO) + '</strong></p>' +
      '<p><strong>Endereço do CIEDS:</strong> ' + esc(EXAME_0910.ENDERECO_CIEDS) + '.</p>' +
      '<p>Atenciosamente,<br><strong>Departamento Pessoal - CIEDS</strong></p>' +
    '</div>';
  return { texto: texto, html: html, assunto: _ex10Assunto_(dataBr, horarioTexto, remarcado) };
}

/**
 * Agenda os próximos da fila na data escolhida (aaaa-mm-dd), preenchendo as vagas que sobram em
 * cada horário (48 às 12h, depois 48 às 14h, ou o limite da data em VAGAS_POR_DATA). Não envia e-mail: o envio é feito em seguida, em
 * lotes, por exame0910EnviarLote.
 * [2026-10-23] escolhidos (opcional): os horários e quantas pessoas em cada um, escolhidos na tela
 * (ver _ex10HorariosEscolhidos_). Sem isso, vale o padrão acima.
 */
function exame0910Agendar(iso, escolhidos) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Escolha uma data válida.');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    if (iso < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) throw new Error('A data do exame não pode ser no passado.');
    const sinc = _ex10Sincronizar_(ss);
    const aba = sinc.aba;
    const lido = _ex10LerAba_(aba);
    const c = lido.c;
    const p = iso.split('-');
    const br = p[2] + '/' + p[1] + '/' + p[0];

    const ocupadas = {};
    const fila = [];
    lido.linhas.forEach(function (x) {
      const dataLinha = _ex10Br_(x.r[c['Data do exame']], tz);
      if (!dataLinha) { fila.push(x); return; }
      if (dataLinha === br) {
        const h = String(x.r[c['Horário']] || '').trim();
        ocupadas[h] = (ocupadas[h] || 0) + 1;
      }
    });
    fila.sort(function (a, b) { return (Number(a.r[c['Ordem']]) || a.linha) - (Number(b.r[c['Ordem']]) || b.linha); });

    const planos = (escolhidos && escolhidos.length) ? _ex10HorariosEscolhidos_(escolhidos)
      : EXAME_0910.HORARIOS.map(function (h) { return { h: h, vagas: Math.max(0, _ex10Vagas_(iso, h) - (ocupadas[h.celula] || 0)) }; });
    const resultado = { data: br, agendados: 0, porHorario: {} };
    let i = 0;
    planos.forEach(function (pl) {
      const h = pl.h, vagas = pl.vagas;
      resultado.porHorario[h.celula] = 0;
      for (let v = 0; v < vagas && i < fila.length; v++, i++) {
        const x = fila[i];
        _ex10MarcarAgendado_(aba, c, x.linha, String(x.r[c['Nome']] || '').trim(), br, h);
        resultado.porHorario[h.celula]++;
        resultado.agendados++;
      }
    });
    SpreadsheetApp.flush();
    resultado.restamNaFila = fila.length - i;
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Envia o e-mail para quem está AGENDADO na data escolhida e ainda não recebeu. Em lotes: a
 * janela chama de novo enquanto houver restantes. inicioMs = início da rodada (0 na primeira
 * chamada); linha que já foi tratada nesta rodada (inclusive com erro) não é tentada de novo.
 */
function exame0910EnviarLote(iso, inicioMs) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const comeco = Date.now();
    const inicio = inicioMs ? Number(inicioMs) : comeco;
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const aba = _ex10Aba_(ss);
    const lido = _ex10LerAba_(aba);
    const c = lido.c;
    const p = String(iso).split('-');
    const br = p[2] + '/' + p[1] + '/' + p[0];

    const fila = lido.linhas.filter(function (x) {
      if (_ex10Br_(x.r[c['Data do exame']], tz) !== br) return false;
      if (_ex10Norm_(x.r[c['Status do agendamento']]) !== 'agendado') return false;
      if (x.r[c['E-mail enviado']] === true) return false;
      const ultimo = x.r[c['Data/hora envio']];
      // [2026-10-02] Quem já recebeu não recebe de novo: envio registrado sem erro conta como enviado,
      // mesmo que a caixinha "E-mail enviado" tenha sido desmarcada.
      if (_ex10EhData_(ultimo) && !String(x.r[c['Erro envio']] || '').trim()) return false;
      return !(_ex10EhData_(ultimo) && ultimo.getTime() >= inicio);
    });

    const enviados = [], erros = [];
    let parouPorCota = false, processados = 0;
    for (let k = 0; k < fila.length && processados < EXAME_0910.LOTE; k++) {
      if (Date.now() - comeco > EXAME_0910.TEMPO_MAX_MS) break;
      const x = fila[k];
      const nome = String(x.r[c['Nome']] || '').trim();
      const email = String(x.r[c['E-mail']] || '').trim();
      const horarioCelula = String(x.r[c['Horário']] || '').trim();
      const horarioTexto = _ex10HorarioTexto_(horarioCelula);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && MailApp.getRemainingDailyQuota() < 2) { parouPorCota = true; break; } // destinatário + cópia
      const hist = c['Histórico'] > -1 ? String(x.r[c['Histórico']] || '').trim() : '';
      const remarcado = hist ? _ex10RemarcadoDoHistorico_(hist) : false; // reenvio de remarcação que deu erro
      const erro = _ex10EnviarLinha_(aba, c, x.linha, nome, email, br, horarioTexto, remarcado);
      processados++;
      if (erro) erros.push({ nome: nome || '(sem nome)', motivo: erro }); else enviados.push(nome);
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

/**
 * [2026-10-02] Botão "Enviar e-mail de exemplo" da janela: manda o e-mail do exame, com dados
 * fictícios, só para EXAME_0910.EMAIL_EXEMPLO (sem cópia para o DP). Não mexe na aba de controle.
 */
function exame0910EnviarExemplo(iso, horarioCelula) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Escolha uma data válida.');
  const p = String(iso).split('-');
  const br = p[2] + '/' + p[1] + '/' + p[0];
  const h = _ex10Horario_(horarioCelula) || EXAME_0910.HORARIOS[0]; // [2026-10-23] qualquer hh:mm (o 1º horário escolhido na tela)
  const t = _ex10Textos_('MARIA DE TESTE DA SILVA', br, h.texto);
  MailApp.sendEmail({
    to: EXAME_0910.EMAIL_EXEMPLO,
    subject: '[EXEMPLO] ' + t.assunto,
    body: 'E-MAIL DE EXEMPLO, com dados fictícios. É assim que o candidato recebe.\n\n' + t.texto,
    htmlBody: '<p style="font-family:Arial,sans-serif;background:#fff3d9;color:#77510a;padding:8px 12px;border-radius:8px;font-size:13px">' +
      '<strong>E-MAIL DE EXEMPLO, com dados fictícios.</strong> É assim que o candidato recebe.</p>' + t.html,
    name: EXAME_0910.REMETENTE
  });
  return { para: EXAME_0910.EMAIL_EXEMPLO, assunto: '[EXEMPLO] ' + t.assunto };
}

/** Preenche a linha como AGENDADO na data e horário (texto), com local, orientação e texto do e-mail. */
function _ex10MarcarAgendado_(aba, c, linha, nome, br, h, remarcado) {
  const t = _ex10Textos_(nome, br, h.texto, remarcado);
  const set = function (col, valor) { aba.getRange(linha, c[col] + 1).setValue(valor); };
  aba.getRange(linha, c['Data do exame'] + 1).setNumberFormat('@').setValue(br);
  aba.getRange(linha, c['Horário'] + 1).setNumberFormat('@').setValue(h.celula);
  set('Local do exame', EXAME_0910.LOCAL);
  set('Orientação após o exame', EXAME_0910.ORIENTACAO);
  set('Endereço CIEDS', EXAME_0910.ENDERECO_CIEDS);
  set('Status do agendamento', 'AGENDADO');
  set('Texto do e-mail', t.texto);
  aba.getRange(linha, c['E-mail enviado'] + 1).insertCheckboxes(); // desmarcada
}

/** Envia o e-mail do exame de uma linha e registra na aba. Devolve o erro ('' se enviou). */
function _ex10EnviarLinha_(aba, c, linha, nome, email, br, horarioTexto, remarcado) {
  let erro = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) erro = email ? 'e-mail inválido: ' + email : 'sem e-mail';
  else {
    const t = _ex10Textos_(nome, br, horarioTexto, remarcado);
    try {
      MailApp.sendEmail({ to: email, cc: EXAME_0910.CC, subject: t.assunto, body: t.texto, htmlBody: t.html, name: EXAME_0910.REMETENTE });
    } catch (e) {
      erro = String(e && e.message ? e.message : e);
    }
  }
  aba.getRange(linha, c['E-mail enviado'] + 1).insertCheckboxes().setValue(!erro);
  aba.getRange(linha, c['Data/hora envio'] + 1).setValue(new Date()).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  aba.getRange(linha, c['Erro envio'] + 1).setValue(erro);
  aba.getRange(linha, 1, 1, c['Erro envio'] + 1).setBackground(erro ? '#fde9ee' : null); // erro fica em vermelho
  return erro;
}

/**
 * [2026-10-05] AGENDAR UMA PESSOA ESPECÍFICA (botão na janela do exame).
 * Lista todas as pessoas da BASE (qualquer data de admissão), com a data de exame de quem já tem, a lotação
 * (para separar colegas do mesmo posto em dias diferentes), se já preencheu o formulário e as
 * vagas ocupadas por data e horário.
 */
function exame0910Avulsos() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const sinc = _ex10Sincronizar_(ss);
    const lido = _ex10LerAba_(sinc.aba);
    const c = lido.c;
    const ix = _ex10IndiceAba_(lido, tz);
    const cancelados = _ex10Cancelados_(ss);
    const ocupacao = {};
    lido.linhas.forEach(function (x) {
      const br = _ex10Br_(x.r[c['Data do exame']], tz);
      if (!br) return;
      const h = String(x.r[c['Horário']] || '').trim();
      ocupacao[br] = ocupacao[br] || {};
      ocupacao[br][h] = (ocupacao[br][h] || 0) + 1;
    });
    const pessoas = sinc.pessoas.filter(function (p) { return p.nome; }).map(function (p) {
      const x = _ex10LinhaDaPessoa_(ix, p);
      return {
        id: p.linhaBase,
        nomeBase: p.nome,
        nome: x ? String(x.r[c['Nome']] || '').trim() : _ex10NomePessoa_(p),
        email: x ? String(x.r[c['E-mail']] || '').trim() : _ex10EmailPessoa_(p),
        posto: p.posto,
        admissao: p.soAvulso ? (p.admissao ? p.admissao.slice(0, 5) : 'sem data') : '', // vazio = admissão a partir de ADMISSAO_A_PARTIR_DE
        preencheu: !!p.prot,
        preencheuEm: p.prot ? _ex10Br_(p.envio, tz) : '',
        cancelado: !!cancelados[_ex10NomeN_(p.nome)],
        data: x ? _ex10Br_(x.r[c['Data do exame']], tz) : '',
        horario: x ? _ex10HorarioTexto_(x.r[c['Horário']]) : '',
        horarioCelula: x ? String(x.r[c['Horário']] || '').trim() : '',
        historico: x && c['Histórico'] > -1 ? String(x.r[c['Histórico']] || '').trim() : ''
      };
    });
    return { pessoas: pessoas, ocupacao: ocupacao, horarios: EXAME_0910.HORARIOS, vagasPorData: EXAME_0910.VAGAS_POR_DATA, hoje: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') };
  } finally {
    lock.releaseLock();
  }
}

/**
 * [2026-10-05] Agenda UMA pessoa (linha da BASE) na data e horário escolhidos e envia o e-mail do
 * exame na hora, com cópia para o DP. Vale também para quem ainda não preencheu o formulário: a
 * linha entra na aba sem protocolo e, quando a pessoa preencher, ela não volta para a fila.
 * Recusa: data no passado, horário completo e quem já tem data de exame.
 */
function exame0910AgendarAvulso(linhaBase, nomeBase, iso, horarioCelula) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Escolha uma data válida.');
  const h = _ex10Horario_(horarioCelula); // [2026-10-09] qualquer hh:mm
  if (!h) throw new Error('Escolha o horário do exame.');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    if (iso < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) throw new Error('A data do exame não pode ser no passado.');
    const sinc = _ex10Sincronizar_(ss);
    const aba = sinc.aba;
    const p = sinc.pessoas.filter(function (x) { return x.linhaBase === Number(linhaBase); })[0];
    if (!p || _ex10NomeN_(p.nome) !== _ex10NomeN_(nomeBase)) {
      throw new Error('A aba BASE mudou enquanto a janela estava aberta. Feche a janela e abra de novo.');
    }
    const lido = _ex10LerAba_(aba);
    const c = lido.c;
    const existente = _ex10LinhaDaPessoa_(_ex10IndiceAba_(lido, tz), p);
    if (existente && _ex10Br_(existente.r[c['Data do exame']], tz)) {
      throw new Error(String(existente.r[c['Nome']] || p.nome).trim() + ' já está agendado(a) para ' +
        _ex10Br_(existente.r[c['Data do exame']], tz) + ' às ' + _ex10HorarioTexto_(existente.r[c['Horário']]) + '.');
    }
    const pd = iso.split('-');
    const br = pd[2] + '/' + pd[1] + '/' + pd[0];
    let ocupadas = 0, ultima = 1;
    lido.linhas.forEach(function (x) {
      ultima = Math.max(ultima, x.linha);
      if (_ex10Br_(x.r[c['Data do exame']], tz) === br && String(x.r[c['Horário']] || '').trim() === h.celula) ocupadas++;
    });
    if (ocupadas >= _ex10Vagas_(iso, h)) {
      throw new Error('O horário das ' + h.texto + ' de ' + br + ' já está completo (' + _ex10Vagas_(iso, h) + ' pessoas). Escolha outro horário ou outro dia.');
    }

    let linha, nome, email;
    if (existente) { // já estava na fila (preencheu o formulário): usa a linha dela
      linha = existente.linha;
      nome = String(existente.r[c['Nome']] || '').trim() || _ex10NomePessoa_(p);
      email = String(existente.r[c['E-mail']] || '').trim() || _ex10EmailPessoa_(p);
    } else {
      linha = ultima + 1;
      nome = _ex10NomePessoa_(p);
      email = _ex10EmailPessoa_(p);
      const nova = new Array(c['Erro envio'] + 1).fill('');
      nova[c['Ordem']] = lido.linhas.length + 1;
      nova[c['Nome']] = nome;
      nova[c['E-mail']] = email;
      nova[c['Protocolo']] = p.prot;
      nova[c['Documentação completa em']] = p.envio;
      aba.getRange(linha, 1, 1, nova.length).setValues([nova]);
    }
    _ex10MarcarAgendado_(aba, c, linha, nome, br, h);
    SpreadsheetApp.flush();

    let erro = '', semCota = false;
    if (MailApp.getRemainingDailyQuota() < 2) semCota = true; // destinatário + cópia
    else erro = _ex10EnviarLinha_(aba, c, linha, nome, email, br, h.texto);
    SpreadsheetApp.flush();
    return {
      nome: nome, email: email, data: br, dia: _ex10DiaSemana_(br), horario: h.texto,
      enviado: !erro && !semCota, erro: erro, semCota: semCota, preencheu: !!p.prot
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * [2026-10-05] REMARCAR quem já tem data (por exemplo, quem faltou ao exame). Muda a data e o
 * horário na mesma linha, guarda a data antiga na coluna Histórico e envia na hora um e-mail
 * "REMARCADO" com a nova data, com cópia para o DP. É a única forma de alguém receber um segundo
 * e-mail de exame, e só acontece quando o DP escolhe remarcar na janela.
 */
function exame0910Remarcar(linhaBase, nomeBase, iso, horarioCelula) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Escolha uma data válida.');
  const h = _ex10Horario_(horarioCelula); // [2026-10-09] qualquer hh:mm
  if (!h) throw new Error('Escolha o horário do exame.');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    if (iso < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) throw new Error('A data do exame não pode ser no passado.');
    const sinc = _ex10Sincronizar_(ss);
    const aba = sinc.aba;
    const p = sinc.pessoas.filter(function (x) { return x.linhaBase === Number(linhaBase); })[0];
    if (!p || _ex10NomeN_(p.nome) !== _ex10NomeN_(nomeBase)) {
      throw new Error('A aba BASE mudou enquanto a janela estava aberta. Feche a janela e abra de novo.');
    }
    const lido = _ex10LerAba_(aba);
    const c = lido.c;
    const x = _ex10LinhaDaPessoa_(_ex10IndiceAba_(lido, tz), p);
    const dataAntes = x ? _ex10Br_(x.r[c['Data do exame']], tz) : '';
    if (!dataAntes) throw new Error(_ex10NomePessoa_(p) + ' ainda não tem data de exame. Use "Agendar".');
    const nome = String(x.r[c['Nome']] || '').trim() || _ex10NomePessoa_(p);
    const email = String(x.r[c['E-mail']] || '').trim() || _ex10EmailPessoa_(p);
    const celAntes = String(x.r[c['Horário']] || '').trim();
    const pd = iso.split('-');
    const br = pd[2] + '/' + pd[1] + '/' + pd[0];
    if (dataAntes === br && celAntes === h.celula) throw new Error('Essa já é a data e o horário do exame de ' + nome + '.');
    let ocupadas = 0;
    lido.linhas.forEach(function (y) {
      if (y.linha !== x.linha && _ex10Br_(y.r[c['Data do exame']], tz) === br && String(y.r[c['Horário']] || '').trim() === h.celula) ocupadas++;
    });
    if (ocupadas >= _ex10Vagas_(iso, h)) {
      throw new Error('O horário das ' + h.texto + ' de ' + br + ' já está completo (' + _ex10Vagas_(iso, h) + ' pessoas). Escolha outro horário ou outro dia.');
    }

    const antes = dataAntes + ' às ' + _ex10HorarioTexto_(celAntes);
    const registro = 'Remarcado em ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm') + ': de ' + antes + ' para ' + br + ' às ' + h.texto + '.';
    const histAntes = String(x.r[c['Histórico']] || '').trim();
    aba.getRange(x.linha, c['Histórico'] + 1).setValue(histAntes ? histAntes + ' ' + registro : registro);
    const oQue = dataAntes !== br && celAntes !== h.celula ? 'ambos' : dataAntes !== br ? 'dia' : 'hora'; // [2026-10-09] texto do e-mail
    _ex10MarcarAgendado_(aba, c, x.linha, nome, br, h, oQue);
    SpreadsheetApp.flush();

    let erro = '', semCota = false;
    if (MailApp.getRemainingDailyQuota() < 2) { // destinatário + cópia
      semCota = true; // fica como "não enviado": a tela principal envia depois, escolhendo a nova data
      aba.getRange(x.linha, c['E-mail enviado'] + 1).insertCheckboxes().setValue(false);
      aba.getRange(x.linha, c['Data/hora envio'] + 1).setValue('');
      aba.getRange(x.linha, c['Erro envio'] + 1).setValue('');
    } else {
      erro = _ex10EnviarLinha_(aba, c, x.linha, nome, email, br, h.texto, oQue);
    }
    SpreadsheetApp.flush();
    return {
      nome: nome, email: email, antes: antes, data: br, dia: _ex10DiaSemana_(br), horario: h.texto,
      enviado: !erro && !semCota, erro: erro, semCota: semCota
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * [2026-10-23] REMARCAR VÁRIAS PESSOAS (botão na janela do exame, pedido da Taynara).
 * Quem está marcado numa data (inclusive data passada, para quem faltou), com a chave de cada linha
 * (_ex10ChaveLinha_), o horário e a situação do e-mail. Só lê a aba de controle.
 */
function exame0910PessoasDaData(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Escolha uma data válida.');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const lido = _ex10LerAba_(_ex10Aba_(ss));
    const c = lido.c;
    const pd = String(iso).split('-');
    const br = pd[2] + '/' + pd[1] + '/' + pd[0];
    return lido.linhas.filter(function (x) { return _ex10Br_(x.r[c['Data do exame']], tz) === br; }).map(function (x) {
      const cel = String(x.r[c['Horário']] || '').trim();
      return {
        chave: _ex10ChaveLinha_(x, c),
        nome: String(x.r[c['Nome']] || '').trim(),
        email: String(x.r[c['E-mail']] || '').trim(),
        horarioCelula: cel,
        horario: _ex10HorarioTexto_(cel),
        enviado: x.r[c['E-mail enviado']] === true,
        erro: String(x.r[c['Erro envio']] || '').trim(),
        historico: c['Histórico'] > -1 ? String(x.r[c['Histórico']] || '').trim() : ''
      };
    }).sort(function (a, b) { return a.horarioCelula < b.horarioCelula ? -1 : a.horarioCelula > b.horarioCelula ? 1 : (a.nome < b.nome ? -1 : 1); });
  } finally {
    lock.releaseLock();
  }
}

/**
 * [2026-10-23] Remarca as pessoas escolhidas (chaves de exame0910PessoasDaData) da data isoOrigem
 * para a nova data e horário. Igual a exame0910Remarcar, pessoa por pessoa: guarda a data antiga no
 * Histórico e deixa a linha pronta para o e-mail "REMARCADO", que sai em seguida por
 * exame0910EnviarLote(iso) (que lê o Histórico para escrever o que mudou).
 * Em rodadas: trabalha até TEMPO_MAX_MS e devolve quantas faltam; a janela chama de novo. Quem já
 * está na data e no horário novos conta como feito; quem não está mais na data de origem (alguém
 * mexeu na aba) entra em naoEncontrados e não é mexido.
 */
function exame0910RemarcarVarios(chaves, isoOrigem, iso, horarioCelula) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoOrigem))) throw new Error('Escolha uma data válida.');
  const h = _ex10Horario_(horarioCelula);
  if (!h) throw new Error('Escolha o horário do exame.');
  if (!Array.isArray(chaves) || !chaves.length) throw new Error('Marque pelo menos uma pessoa.');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Já há um envio em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const comeco = Date.now();
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    if (iso < Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')) throw new Error('A data do exame não pode ser no passado.');
    const aba = _ex10Aba_(ss);
    const lido = _ex10LerAba_(aba);
    const c = lido.c;
    const pd = String(iso).split('-'), po = String(isoOrigem).split('-');
    const br = pd[2] + '/' + pd[1] + '/' + pd[0], brOrigem = po[2] + '/' + po[1] + '/' + po[0];
    const porChave = {};
    lido.linhas.forEach(function (x) { const k = _ex10ChaveLinha_(x, c); if (!porChave[k]) porChave[k] = x; });

    const agora = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
    let remarcados = 0, jaFeitos = 0, restantes = 0;
    const naoEncontrados = [];
    for (let k = 0; k < chaves.length; k++) {
      const x = porChave[String(chaves[k])];
      if (!x) { naoEncontrados.push(String(chaves[k]).replace(/^[PN]:/, '').split('|')[0]); continue; }
      const nome = String(x.r[c['Nome']] || '').trim();
      const dataAtual = _ex10Br_(x.r[c['Data do exame']], tz);
      const celAtual = String(x.r[c['Horário']] || '').trim();
      if (dataAtual === br && celAtual === h.celula) { jaFeitos++; continue; } // já remarcado (rodada anterior)
      if (dataAtual !== brOrigem) { naoEncontrados.push(nome || '(sem nome)'); continue; }
      if (Date.now() - comeco > EXAME_0910.TEMPO_MAX_MS) { restantes++; continue; }
      const antes = dataAtual + ' às ' + _ex10HorarioTexto_(celAtual);
      const registro = 'Remarcado em ' + agora + ': de ' + antes + ' para ' + br + ' às ' + h.texto + '.';
      const histAntes = String(x.r[c['Histórico']] || '').trim();
      aba.getRange(x.linha, c['Histórico'] + 1).setValue(histAntes ? histAntes + ' ' + registro : registro);
      const oQue = dataAtual !== br && celAtual !== h.celula ? 'ambos' : dataAtual !== br ? 'dia' : 'hora';
      _ex10MarcarAgendado_(aba, c, x.linha, nome, br, h, oQue);
      // o e-mail "REMARCADO" sai por exame0910EnviarLote: a linha volta a ficar como "não enviado"
      aba.getRange(x.linha, c['E-mail enviado'] + 1).insertCheckboxes().setValue(false);
      aba.getRange(x.linha, c['Data/hora envio'] + 1).setValue('');
      aba.getRange(x.linha, c['Erro envio'] + 1).setValue('');
      remarcados++;
    }
    SpreadsheetApp.flush();
    return { data: br, horario: h.texto, remarcados: remarcados, jaFeitos: jaFeitos, restantes: restantes, naoEncontrados: naoEncontrados };
  } finally {
    lock.releaseLock();
  }
}
