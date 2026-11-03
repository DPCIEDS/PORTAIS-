/*************************************************************************************************
 * SINCRONIZAÇÃO COM O RAIO-X (v2) — atualiza, insere, e confere Rescisão/Movimentações
 * -----------------------------------------------------------------------------------------------
 * Roda quantas vezes quiser (sempre que tiver um RAIO-X mais novo). Casa por matrícula.
 * NUNCA apaga nada — toda mudança de valor vira uma linha na aba SINCRONIZACAO_HISTORICO.
 *
 * v2: corrige 2 problemas achados testando com o arquivo real:
 *   1) "nome" estava pegando "Nome da Empresa" em vez de "Nome do Funcionário" (cabeçalhos
 *      parecidos demais). Agora usa uma LISTA de padrões em ordem de prioridade por campo.
 *   2) A coluna "Situação Funcionário" não tem valor "Inativo" — quem sai simplesmente PARA DE
 *      APARECER no relatório. Por isso, "quem saiu" agora é detectado por AUSÊNCIA (estava na
 *      base, não apareceu neste RAIO-X), não por texto de situação.
 *************************************************************************************************/

function _acharColunaPrioridade_(header, listaRegex) {
  for (let i = 0; i < listaRegex.length; i++) {
    const idx = header.findIndex(h => listaRegex[i].test(h));
    if (idx > -1) return idx;
  }
  return -1;
}

function _normalizarSheetIdGoogle_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) throw new Error('Informe o ID da planilha do Raio-X.');

  const match = raw.match(/\/d\/([A-Za-z0-9-_]{10,})/i) || raw.match(/[?&]key=([A-Za-z0-9-_]{10,})/i);
  const id = match ? match[1] : raw;

  if (!/^[A-Za-z0-9-_]{10,}$/.test(id)) {
    throw new Error('ID da planilha do Raio-X inválido. Cole apenas o ID da planilha ou a URL completa do Google Sheets.');
  }

  return id;
}

function _raioXDadosFromSheet_(raioXSheetId) {
  const id = _normalizarSheetIdGoogle_(raioXSheetId);
  const ssRaioX = SpreadsheetApp.openById(id);
  const shRaioX = ssRaioX.getSheets()[0];
  const dados = shRaioX.getDataRange().getValues();
  if (!dados || !dados.length || !dados[0] || !dados[0].length) {
    throw new Error('A planilha do Raio-X está vazia.');
  }
  const header = dados[0].map(h => String(h || '').trim());
  // [2026-10-21] o fuso da planilha do Raio-X decide em que dia cai cada data dela (ver _raioxDia_)
  return { shRaioX, dados, header, fuso: ssRaioX.getSpreadsheetTimeZone() || DP360.FUSO };
}

function _raioXColunas_(header) {
  return {
    matricula: _acharColunaPrioridade_(header, [
      /matr[ií]cula/i,
      /^funcion[aá]rio$/i,
      /funcion[aá]rio/i
    ]),
    nome: _acharColunaPrioridade_(header, [
      /^nome do funcion[aá]rio$/i,
      /nome do funcion[aá]rio/i,
      /^nome$/i,
      /nome/i
    ]),
    departamento: _acharColunaPrioridade_(header, [/^departamento$/i, /departamento/i]),
    cargo: _acharColunaPrioridade_(header, [
      /^fun[cç][aã]o$/i,
      /^cargo$/i,
      /fun[cç][aã]o/i,
      /cargo/i
    ]),
    salario: _acharColunaPrioridade_(header, [/sal[aá]rio/i]),
    situacao: _acharColunaPrioridade_(header, [/situa[cç][aã]o/i]),
    cidade: _acharColunaPrioridade_(header, [/^cidade$/i]),
    uf: _acharColunaPrioridade_(header, [/^uf$/i]),
    admissao: _acharColunaPrioridade_(header, [/admiss[aã]o/i]),
    horario: _acharColunaPrioridade_(header, [/hor[aá]rio/i]),
    cpf: _acharColunaPrioridade_(header, [/^cpf/i]),
    // [2026-10-21] empresa (para separar matrículas iguais e ignorar empresas fora do Portal) e data de demissão
    empresa: _acharColunaPrioridade_(header, [/^empresa$/i]),
    nomeEmpresa: _acharColunaPrioridade_(header, [/^nome da empresa$/i]),
    demissao: _acharColunaPrioridade_(header, [/^demiss[aã]o$/i]),
    // [2026-10-29] identidade e dados bancários (envio de férias ao financeiro; o DP inclui essas colunas no Raio-X)
    identidade: _acharColunaPrioridade_(header, [/^identidade$/i, /^rg$/i]),
    banco: _acharColunaPrioridade_(header, [/^banco$/i, /^banco\b/i]),
    agencia: _acharColunaPrioridade_(header, [/^ag[eê]ncia$/i, /^ag[eê]ncia\b/i]),
    conta: _acharColunaPrioridade_(header, [/^conta$/i, /^conta (corrente|banc[aá]ria|sal[aá]rio)/i, /^n[º°o.]*\s*(da )?conta\b/i])
  };
}

// [2026-10-21] Empresas do Raio-X que NÃO entram no Portal (empregados domésticos de pessoas físicas:
// 00016 e 00018), a pedido do DP. Comparação pelo código sem zeros à esquerda.
const RAIOX_EMPRESAS_IGNORADAS = ['16', '18'];
// [2026-10-21] O alerta da importação vai só para este e-mail (antes: rescisao@ com cópia para dp@).
const RAIOX_EMAIL_ALERTA = 'taynarasilva.rj@cieds.org.br';

function _raioxEmpresaCod_(v) { return String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, ''); }

/** [2026-11-03] Texto do Raio-X com os espaços seguidos (o Alterdata manda "3ª CAS -  CRAS") trocados por um só.
 *  Número e data ficam como estão. Sem isso, o departamento muda de nome e perde a regra de Benefícios. */
function _raioxTexto_(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v; }

/** Dia (aaaa-mm-dd) de uma data do Raio-X, lido no fuso da planilha de onde ela veio. */
function _raioxDia_(v, fuso) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, fuso || DP360.FUSO, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

/** Data para gravar no MASTER: meio-dia no fuso do projeto (o MASTER está em America/Sao_Paulo desde 21/10). */
function _raioxData_(iso) {
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}

/** Cria no fim da aba as colunas que faltarem (ex.: SALARIO_BASE e HORARIO, guardadas desde 21/10). */
function _raioxGarantirColunas_(sh, nomes, comoTexto) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const faltam = nomes.filter(n => header.indexOf(n) === -1);
  if (faltam.length) sh.getRange(1, header.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
  // [2026-10-29] colunas de texto (agência "0087", conta "0741-2"): formato texto para não virar número
  faltam.forEach((n, i) => { if ((comoTexto || []).indexOf(n) > -1) sh.getRange(2, header.length + 1 + i, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@'); });
  return faltam;
}

function raioxExecutar(acao, p, user) {
  const payload = p || {};
  switch (acao) {
    case 'RAIOX.PREVIEW':
      return raioxPreview(user, payload);
    case 'RAIOX.IMPORTAR':
      return raioxImportar(user, payload);
    default:
      throw new Error('Ação de Raio-X desconhecida: ' + acao);
  }
}

function raioxPreview(user, p) {
  const { header, dados } = _raioXDadosFromSheet_(p.sheetId);
  const col = _raioXColunas_(header);
  const camposEncontrados = Object.keys(col).filter(k => col[k] > -1);

  if (col.matricula === -1) throw new Error('Não encontrei a coluna de matrícula no Raio-X.');
  if (col.nome === -1) throw new Error('Não encontrei a coluna de nome do funcionário no Raio-X.');

  const mapa = {};
  for (let r = 1; r < dados.length; r++) {
    const matricula = _normalizarMatricula_(dados[r][col.matricula]);
    if (!matricula) continue;
    mapa[matricula] = true;
  }

  return {
    ok: true,
    colunasReconhecidas: camposEncontrados.reduce((o, k) => { o[k] = header[col[k]]; return o; }, {}),
    totalLinhas: dados.length - 1,
    totalMatriculas: Object.keys(mapa).length,
    mensagem: 'Preview do Raio-X validado com ' + (dados.length - 1) + ' linhas e ' + Object.keys(mapa).length + ' matrículas únicas.'
  };
}

function _raioxAlertaRescisao_(resultado) {
  const hoje = new Date();
  const lista = (arr) => (arr && arr.length ? arr.map(x => x.nome + ' (' + x.matricula + ')').join('<br>') : 'Nenhum');
  const body = [
    '<p>Olá,</p>',
    '<p>O portal do DP importou um novo arquivo do Raio-X e encontrou itens para revisão de rescisão.</p>',
    '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif">',
    '<tr><th align="left" style="background:#f3f6f8">Tipo</th><th align="left" style="background:#f3f6f8">Detalhes</th></tr>',
    '<tr><td>Ativo no Raio-X com desligamento registrado</td><td>' + lista(resultado.ativosEmDesligamento) + '</td></tr>',
    '<tr><td>Saíram do Raio-X nesta importação e foram marcados como desligados</td><td>' + lista(resultado.marcadosComoDesligadosAutomaticamente) + '</td></tr>',
    '</table>',
    '<p>Data da verificação: ' + hoje.toLocaleString('pt-BR') + '</p>'
  ].join('');

  // [2026-10-21] só para RAIOX_EMAIL_ALERTA (pedido do DP); antes ia para rescisao@ com cópia para dp@
  MailApp.sendEmail({
    to: RAIOX_EMAIL_ALERTA,
    subject: 'Alerta Raio-X: inconsistência de desligamento',
    htmlBody: body
  });

  return true;
}

function raioxImportar(user, p) {
  const sheetId = String(p.sheetId || '').trim();
  const preview = raioxPreview(user, { sheetId: sheetId });
  const resultado = sincronizarRaioX(sheetId);
  const CONTROLE_ID = '1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc';
  const shResc = SpreadsheetApp.openById(CONTROLE_ID).getSheetByName('RESCISAO_CASOS');
  const casosResc = shResc ? _sheetToObjects_(shResc) : [];
  const hoje = _hojeFerias_();

  // Ativo no Raio-X com desligamento já efetivado no fluxo de rescisão do Portal: vale conferir.
  const ativosEmDesligamento = [];
  (resultado._ativosNoRaioX || []).forEach(x => {
    const temResc = casosResc.some(c => {
      if (_normalizarMatricula_(c.MATRICULA) !== x.matricula) return false;
      if (String(c.STATUS || '').toUpperCase() === 'CANCELADO') return false;
      const d = _dataF_(c.DATA_DEMISSAO);
      return d && d <= hoje;
    });
    if (temResc) ativosEmDesligamento.push({ matricula: x.matricula, nome: x.nome });
  });
  delete resultado._ativosNoRaioX;

  resultado.preview = preview;
  resultado.ativosEmDesligamento = ativosEmDesligamento;
  // [2026-10-21] quem sumiu do Raio-X já vem em marcadosComoDesligadosAutomaticamente (só os novos)
  resultado.desapareceramSemControle = [];

  const novosDesligados = resultado.marcadosComoDesligadosAutomaticamente || [];
  if (ativosEmDesligamento.length || novosDesligados.length) {
    try { _raioxAlertaRescisao_(resultado); } catch (e) { console.error('raioxImportar: falha ao mandar o alerta: ' + e); }
  }

  return {
    ok: true,
    mensagem: 'Raio-X importado com sucesso.',
    preview: preview,
    sincronizacao: resultado,
    alertasEnviados: {
      ativosEmDesligamento: ativosEmDesligamento.length,
      desapareceramSemControle: novosDesligados.length,
      para: RAIOX_EMAIL_ALERTA
    }
  };
}

/**
 * [FIX] Lê a CONTROLE.2026 (aba RESCISAO — a mesma que o módulo de Homologação usa, fonte de
 * verdade do DP para quem foi desligado, com data de demissão) e marca DIRETO na MASTER:
 * SITUACAO='Desligado' + DATA_DESLIGAMENTO. Não depende de RAIO-X — RAIO-X entra só depois,
 * como cruzamento/validação (ver sincronizarRaioX). Idempotente: quem já está com SITUACAO e
 * DATA_DESLIGAMENTO corretos não é regravado.
 * opcoes.ateHoje: só marca quem tem a demissão até hoje (usado pela rotina de sexta, que não tem
 * um Raio-X novo para corrigir depois quem ainda está em aviso prévio).
 */
function sincronizarDesligadosDaRescisao(ssMasterOpcional, opcoes) {
  const ateHoje = !!(opcoes && opcoes.ateHoje);
  const hojeIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const shControle = SpreadsheetApp.openById(RESC.CONTROLE_ID).getSheetByName(RESC.ABAS.CONTROLE);
  if (!shControle) return { atualizados: 0, naoEncontrados: [] };

  const ultimaLinha = shControle.getLastRow();
  if (ultimaLinha < RESC.CONTROLE_LINHA_INICIAL) return { atualizados: 0, naoEncontrados: [] };

  const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
  const dados = shControle.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.DEMISSAO).getValues();

  const ssMaster = ssMasterOpcional || SpreadsheetApp.openById(DP360.MASTER_ID);
  const shColab = ssMaster.getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const headerColab = _garantirColunaDataDesligamento_(shColab);
  const idxMatricula = headerColab.indexOf('MATRICULA');
  const idxSituacao = headerColab.indexOf('SITUACAO');
  const idxDataDeslig = headerColab.indexOf('DATA_DESLIGAMENTO');

  const linhasColab = shColab.getRange(2, 1, Math.max(0, shColab.getLastRow() - 1), headerColab.length).getValues();
  const porMatricula = {};
  linhasColab.forEach((linha, i) => {
    const mat = _normalizarMatricula_(linha[idxMatricula]);
    if (mat && !porMatricula[mat]) porMatricula[mat] = { linha: i + 2, valores: linha };
  });

  let shHist = ssMaster.getSheetByName('SINCRONIZACAO_HISTORICO');
  if (!shHist) {
    shHist = ssMaster.insertSheet('SINCRONIZACAO_HISTORICO');
    shHist.getRange(1, 1, 1, 5).setValues([['MATRICULA', 'CAMPO', 'VALOR_ANTIGO', 'VALOR_NOVO', 'SINCRONIZADO_EM']]);
    shHist.setFrozenRows(1);
  }

  const agora = new Date();
  const logMudancas = [];
  const naoEncontrados = [];
  let atualizados = 0;

  dados.forEach(row => {
    const matricula = _normalizarMatricula_(row[RESC.COL.MATRICULA - 1]);
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!matricula || !demissao) return; // sem desligamento registrado, nao e rescisao

    const alvo = porMatricula[matricula];
    if (!alvo) { naoEncontrados.push({ matricula: matricula, nome: nome }); return; }

    const situacaoAtual = String(alvo.valores[idxSituacao] || '');
    const jaDesligado = /DESLIGAD|DEMITID|INATIVO/i.test(situacaoAtual);
    const dataAtual = alvo.valores[idxDataDeslig];
    const dataAtualIso = dataAtual instanceof Date ? Utilities.formatDate(dataAtual, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    const demissaoIso = demissao instanceof Date ? Utilities.formatDate(demissao, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(demissao);

    if (ateHoje && demissao instanceof Date && demissaoIso > hojeIso) return; // demissão futura: ainda não
    if (jaDesligado && dataAtualIso === demissaoIso) return; // já está tudo certo

    if (!jaDesligado) {
      shColab.getRange(alvo.linha, idxSituacao + 1).setValue('Desligado');
      logMudancas.push([matricula, 'SITUACAO', situacaoAtual, 'Desligado', agora]);
    }
    if (dataAtualIso !== demissaoIso) {
      shColab.getRange(alvo.linha, idxDataDeslig + 1).setValue(demissao);
      logMudancas.push([matricula, 'DATA_DESLIGAMENTO', dataAtual || '', demissao, agora]);
    }
    atualizados++;
  });

  if (logMudancas.length) {
    shHist.getRange(shHist.getLastRow() + 1, 1, logMudancas.length, 5).setValues(logMudancas);
  }
  if (atualizados) _invalidarCacheFerias_();

  return { atualizados: atualizados, naoEncontrados: naoEncontrados };
}

/**
 * [2026-10-21] Um filtro comum deixado na aba COLABORADORES fazia o Apps Script ignorar, sem erro,
 * as datas gravadas nas linhas escondidas. A sincronização tira o filtro, grava e recoloca igual.
 */
function sincronizarRaioX(raioXSheetId) {
  const shFiltro = SpreadsheetApp.openById(DP360.MASTER_ID).getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const filtro = shFiltro.getFilter();
  let guardado = null;
  if (filtro) {
    const r = filtro.getRange(), criterios = [];
    for (let c = r.getColumn(); c <= r.getLastColumn(); c++) {
      const cr = filtro.getColumnFilterCriteria(c);
      if (cr) criterios.push({ coluna: c, criterio: cr.copy().build() });
    }
    guardado = { a1: r.getA1Notation(), criterios: criterios };
    filtro.remove();
    SpreadsheetApp.flush();
  }
  try {
    return _sincronizarRaioXNucleo_(raioXSheetId);
  } finally {
    if (guardado) {
      try {
        const novo = shFiltro.getRange(guardado.a1).createFilter();
        guardado.criterios.forEach(x => novo.setColumnFilterCriteria(x.coluna, x.criterio));
      } catch (e) { console.error('sincronizarRaioX: não consegui recolocar o filtro: ' + e); }
    }
  }
}

function _sincronizarRaioXNucleo_(raioXSheetId) {
  const { dados, header, fuso } = _raioXDadosFromSheet_(raioXSheetId);
  const col = _raioXColunas_(header);

  const camposEncontrados = Object.keys(col).filter(k => col[k] > -1);
  console.log('Colunas reconhecidas no RAIO-X: ' + camposEncontrados.map(k => k + '=' + header[col[k]]).join(', '));

  if (col.matricula === -1) throw new Error('Não encontrei a coluna de matrícula no RAIO-X.');
  if (col.nome === -1) throw new Error('Não encontrei a coluna de nome do funcionário no RAIO-X.');

  // ---- monta o mapa do RAIO-X por matrícula ----
  // [2026-10-21] ignora as empresas que não entram no Portal; se a mesma matrícula aparecer em duas
  // empresas, fica a primeira linha e a outra vira alerta (antes a última linha apagava a primeira).
  const raioXPorMatricula = {};
  const ignoradasPorEmpresa = [];
  const matriculasRepetidas = [];
  for (let r = 1; r < dados.length; r++) {
    const emp = col.empresa > -1 ? _raioxEmpresaCod_(dados[r][col.empresa]) : '';
    const m = _normalizarMatricula_(dados[r][col.matricula]);
    if (!m) continue;
    const nome = String(_raioxTexto_(dados[r][col.nome]) || '').trim();
    if (emp && RAIOX_EMPRESAS_IGNORADAS.indexOf(emp) > -1) { ignoradasPorEmpresa.push({ matricula: m, nome: nome, empresa: dados[r][col.empresa] }); continue; }
    if (raioXPorMatricula[m]) {
      matriculasRepetidas.push({ matricula: m, nome: nome, empresa: col.empresa > -1 ? dados[r][col.empresa] : '', jaUsadaPor: raioXPorMatricula[m].nome });
      continue;
    }
    const linha = {};
    Object.keys(col).forEach(k => { if (col[k] > -1) linha[k] = _raioxTexto_(dados[r][col[k]]); });
    linha.admissaoIso = col.admissao > -1 ? _raioxDia_(dados[r][col.admissao], fuso) : '';
    linha.demissaoIso = col.demissao > -1 ? _raioxDia_(dados[r][col.demissao], fuso) : '';
    raioXPorMatricula[m] = linha;
  }

  // ---- prepara a aba de histórico (append-only) ----
  const ssMaster = SpreadsheetApp.openById(DP360.MASTER_ID);
  let shHist = ssMaster.getSheetByName('SINCRONIZACAO_HISTORICO');
  if (!shHist) {
    shHist = ssMaster.insertSheet('SINCRONIZACAO_HISTORICO');
    shHist.getRange(1, 1, 1, 5).setValues([['MATRICULA', 'CAMPO', 'VALOR_ANTIGO', 'VALOR_NOVO', 'SINCRONIZADO_EM']]);
    shHist.setFrozenRows(1);
  }
  const logMudancas = [];

  // [FIX] MASTER precisa refletir quem já foi desligado segundo a CONTROLE.2026 (fonte de
  // verdade do DP para rescisões) DIRETO, sem depender de RAIO-X pra isso — RAIO-X é só o
  // cruzamento/validação que roda depois.
  const resultadoRescisao = sincronizarDesligadosDaRescisao(ssMaster);

  // ---- COLABORADORES: atualiza quem já existe ----
  const shColab = ssMaster.getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  // [2026-10-21] salário e horário passam a ser guardados (pedido do DP)
  const colunasCriadas = _raioxGarantirColunas_(shColab, ['SALARIO_BASE', 'HORARIO', 'IDENTIDADE', 'BANCO', 'AGENCIA', 'CONTA'],
    ['IDENTIDADE', 'BANCO', 'AGENCIA', 'CONTA']);
  const headerColab = shColab.getRange(1, 1, 1, shColab.getLastColumn()).getValues()[0];
  const idxColab = {};
  headerColab.forEach((h, i) => { idxColab[h] = i; });

  // [2026-10-21] o Alterdata é a fonte: nome também é atualizado; admissão e demissão à parte (são datas)
  const mapaCampoParaColuna = {
    nome: 'NOME', departamento: 'DEPARTAMENTO_ATUAL', cargo: 'CARGO', salario: 'SALARIO_BASE',
    situacao: 'SITUACAO', cidade: 'CIDADE', uf: 'UF', horario: 'HORARIO',
    identidade: 'IDENTIDADE', banco: 'BANCO', agencia: 'AGENCIA', conta: 'CONTA'
  };

  const ultimaLinha = shColab.getLastRow();
  const todasAsLinhas = shColab.getRange(2, 1, ultimaLinha - 1, headerColab.length).getValues();
  const matriculasNaBase = new Set();
  const ativosNoRaioX = [];

  let atualizados = 0;
  const agora = new Date();
  const iso = (v) => _raioxDia_(v, DP360.FUSO);
  const grava = (linhaPlanilha, coluna, valorParaGravar, antigoTexto, novoTexto, matricula) => {
    shColab.getRange(linhaPlanilha, idxColab[coluna] + 1).setValue(valorParaGravar);
    logMudancas.push([matricula, coluna, antigoTexto, novoTexto, agora]);
  };

  todasAsLinhas.forEach((linha, i) => {
    const matricula = _normalizarMatricula_(linha[idxColab['MATRICULA']]);
    if (!matricula) return;
    matriculasNaBase.add(matricula);

    const doRaioX = raioXPorMatricula[matricula];
    if (!doRaioX) return; // não apareceu neste RAIO-X — tratado depois (saída)
    ativosNoRaioX.push({ matricula: matricula, nome: String(doRaioX.nome || linha[idxColab['NOME']] || '').trim() });

    let mudou = false;
    Object.keys(mapaCampoParaColuna).forEach(campo => {
      if (doRaioX[campo] === undefined) return;
      const colunaDestino = mapaCampoParaColuna[campo];
      const idxDestino = idxColab[colunaDestino];
      if (idxDestino === undefined) return;

      const bruto = doRaioX[campo];
      const valorNovo = String(bruto == null ? '' : bruto).trim();
      const valorAntigo = String(linha[idxDestino] == null ? '' : linha[idxDestino]).trim();

      if (valorNovo && valorNovo !== valorAntigo) {
        // número (salário) vai como número: texto como "4296.65" viraria outro valor no locale pt_BR
        grava(i + 2, colunaDestino, typeof bruto === 'number' ? bruto : valorNovo, valorAntigo, valorNovo, matricula);
        mudou = true;
      }
    });

    if (doRaioX.admissaoIso && idxColab['DATA_ADMISSAO'] !== undefined && iso(linha[idxColab['DATA_ADMISSAO']]) !== doRaioX.admissaoIso) {
      grava(i + 2, 'DATA_ADMISSAO', _raioxData_(doRaioX.admissaoIso), iso(linha[idxColab['DATA_ADMISSAO']]), doRaioX.admissaoIso, matricula);
      mudou = true;
    }
    if (doRaioX.demissaoIso && idxColab['DATA_DESLIGAMENTO'] !== undefined && iso(linha[idxColab['DATA_DESLIGAMENTO']]) !== doRaioX.demissaoIso) {
      grava(i + 2, 'DATA_DESLIGAMENTO', _raioxData_(doRaioX.demissaoIso), iso(linha[idxColab['DATA_DESLIGAMENTO']]), doRaioX.demissaoIso, matricula);
      mudou = true;
    }
    if (doRaioX.empresa && idxColab['EMPRESA_COD'] !== undefined && !String(linha[idxColab['EMPRESA_COD']] || '').trim()) {
      grava(i + 2, 'EMPRESA_COD', String(doRaioX.empresa), '', String(doRaioX.empresa), matricula);
      if (doRaioX.nomeEmpresa && idxColab['EMPRESA'] !== undefined && !String(linha[idxColab['EMPRESA']] || '').trim()) {
        grava(i + 2, 'EMPRESA', String(doRaioX.nomeEmpresa), '', String(doRaioX.nomeEmpresa), matricula);
      }
      mudou = true;
    }

    if (mudou) atualizados++;
  });

  // ---- COLABORADORES: insere quem é novo (de uma vez só) ----
  const novos = [];
  const linhasNovas = [];
  Object.keys(raioXPorMatricula).forEach(matricula => {
    if (matriculasNaBase.has(matricula)) return;

    const d = raioXPorMatricula[matricula];
    // Toda pessoa inserida aqui nasce sem GESTOR_EMAIL (o Raio-X não traz gestor): marca O_QUE_FALTA.
    linhasNovas.push(headerColab.map(colNome => {
      switch (colNome) {
        case 'ID_COLABORADOR': return 'COL-' + Utilities.getUuid().slice(0, 8).toUpperCase();
        case 'EMPRESA_COD': return d.empresa != null ? String(d.empresa) : '';
        case 'EMPRESA': return d.nomeEmpresa || '';
        case 'MATRICULA': return matricula;
        case 'NOME': return d.nome || '';
        case 'CPF': return d.cpf || '';
        case 'DEPARTAMENTO_ATUAL': return d.departamento || '';
        case 'CARGO': return d.cargo || '';
        case 'SALARIO_BASE': return d.salario === undefined ? '' : d.salario;
        case 'SITUACAO': return d.situacao || '';
        case 'CIDADE': return d.cidade || '';
        case 'UF': return d.uf || '';
        case 'DATA_ADMISSAO': return d.admissaoIso ? _raioxData_(d.admissaoIso) : '';
        case 'DATA_DESLIGAMENTO': return d.demissaoIso ? _raioxData_(d.demissaoIso) : '';
        case 'HORARIO': return d.horario || '';
        case 'IDENTIDADE': return d.identidade == null ? '' : String(d.identidade);
        case 'BANCO': return d.banco == null ? '' : String(d.banco);
        case 'AGENCIA': return d.agencia == null ? '' : String(d.agencia);
        case 'CONTA': return d.conta == null ? '' : String(d.conta);
        case 'O_QUE_FALTA': return 'Falta definir gestor';
        default: return '';
      }
    }));
    novos.push({ matricula: matricula, nome: d.nome || '' });
    logMudancas.push([matricula, 'NOVO_COLABORADOR', '', d.nome || '', agora]);
  });
  if (linhasNovas.length) {
    const primeira = shColab.getLastRow() + 1;
    shColab.getRange(primeira, 1, linhasNovas.length, headerColab.length).setValues(linhasNovas);
    ['DATA_ADMISSAO', 'DATA_DESLIGAMENTO'].forEach(n => {
      if (idxColab[n] === undefined) return;
      try { shColab.getRange(primeira, idxColab[n] + 1, linhasNovas.length, 1).setNumberFormat('dd/MM/yyyy'); } catch (e) { /* formato é só aparência */ }
    });
  }

  // ---- quem SUMIU do RAIO-X: não está mais no Alterdata -> desligado ----
  // [2026-10-21] Marca pela LINHA (antes procurava pelo NOME e podia desligar um homônimo ativo),
  // pula quem já estava desligado (antes regravava a data de desligamento com a data do dia),
  // pula PJ, cadastros DUPLICADO-* e empresas que não entram no Portal.
  const marcadosDesligados = [];
  todasAsLinhas.forEach((linha, i) => {
    const matTexto = String(linha[idxColab['MATRICULA']] || '').trim();
    const matricula = _normalizarMatricula_(matTexto);
    if (!matricula || raioXPorMatricula[matricula]) return;
    if (/^DUPLICADO/i.test(matTexto)) return;

    const tipoContrato = String(linha[idxColab['TIPO_CONTRATO']] || '').trim().toUpperCase();
    const vinculoDescricao = String(linha[idxColab['VINCULO_DESCRICAO']] || '').trim().toUpperCase();
    if (tipoContrato === 'PJ' || vinculoDescricao === 'PJ') return;
    if (RAIOX_EMPRESAS_IGNORADAS.indexOf(_raioxEmpresaCod_(linha[idxColab['EMPRESA_COD']])) > -1) return;

    const situacao = String(linha[idxColab['SITUACAO']] || '');
    if (/DESLIGAD|DEMITID|INATIVO/i.test(situacao)) return; // já estava desligado: não mexe

    const nome = String(linha[idxColab['NOME']] || '').trim();
    grava(i + 2, 'SITUACAO', 'Desligado', situacao, 'Desligado', matricula);
    if (idxColab['DATA_DESLIGAMENTO'] !== undefined && !iso(linha[idxColab['DATA_DESLIGAMENTO']])) {
      grava(i + 2, 'DATA_DESLIGAMENTO', _raioxData_(Utilities.formatDate(agora, DP360.FUSO, 'yyyy-MM-dd')), '', 'saiu do Raio-X', matricula);
    }
    marcadosDesligados.push({ matricula: matricula, nome: nome, ok: true, detalhe: 'não está mais no Raio-X' });
  });

  if (logMudancas.length) {
    shHist.getRange(shHist.getLastRow() + 1, 1, logMudancas.length, 5).setValues(logMudancas);
  }
  if (logMudancas.length) _invalidarCacheFerias_();

  // ---- sinal leve (não bloqueante): quem está em Aviso Prévio agora, pra acompanhar ----
  const emAvisoPrevio = [];
  if (col.situacao > -1) {
    Object.keys(raioXPorMatricula).forEach(matricula => {
      const situacao = String(raioXPorMatricula[matricula].situacao || '');
      if (/aviso pr[eé]vio/i.test(situacao)) {
        emAvisoPrevio.push({ matricula: matricula, nome: raioXPorMatricula[matricula].nome || '' });
      }
    });
  }

  // ---- CONFERE COM MOVIMENTAÇÕES: aprovadas pelo DP mas que ainda não refletiram no RAIO-X ----
  const CONTROLE_ID = '1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc';
  const shMov = SpreadsheetApp.openById(CONTROLE_ID).getSheetByName('MOVIMENTACOES_CASOS');
  const casosMov = shMov ? _sheetToObjects_(shMov) : [];
  const movimentacoesNaoRefletidas = [];

  casosMov.filter(m => String(m.STATUS) === 'DP_APROVADA').forEach(m => {
    const matricula = _normalizarMatricula_(m.MATRICULA);
    const doRaioX = raioXPorMatricula[matricula];
    if (!doRaioX) return;

    let campoEsperado = null, valorEsperado = null, valorAtual = null;
    if (m.TIPO_COD === 'TRANSFERENCIA_DEPARTAMENTO') {
      campoEsperado = 'departamento'; valorEsperado = m.DEPARTAMENTO_NOVO; valorAtual = doRaioX.departamento;
    } else if (m.TIPO_COD === 'ALTERACAO_CARGO') {
      campoEsperado = 'cargo'; valorEsperado = m.CARGO_NOVO; valorAtual = doRaioX.cargo;
    } else if (m.TIPO_COD === 'ALTERACAO_SALARIO') {
      campoEsperado = 'salario'; valorEsperado = m.SALARIO_NOVO; valorAtual = doRaioX.salario;
    }

    if (campoEsperado && valorEsperado &&
        String(valorAtual || '').trim().toUpperCase() !== String(valorEsperado).trim().toUpperCase()) {
      movimentacoesNaoRefletidas.push({
        matricula: matricula, nome: m.NOME, tipo: m.TIPO, esperado: valorEsperado, noRaioX: valorAtual || '(vazio)'
      });
    }
  });

  const resultado = {
    desligadosSincronizadosDaRescisao: resultadoRescisao.atualizados,
    desligadosDaRescisaoNaoEncontradosNaMaster: resultadoRescisao.naoEncontrados,
    colunasReconhecidasNoRaioX: camposEncontrados.reduce((o, k) => { o[k] = header[col[k]]; return o; }, {}),
    colunasCriadasNaMaster: colunasCriadas,
    ignoradasPorEmpresa: ignoradasPorEmpresa.length,
    matriculasRepetidas: matriculasRepetidas,
    colaboradoresAtualizados: atualizados,
    colaboradoresNovos: novos.length,
    novosExemplos: novos.slice(0, 10),
    alertaSumiramSemRescisao: marcadosDesligados,
    marcadosComoDesligadosAutomaticamente: marcadosDesligados,
    alertaEmAvisoPrevio: emAvisoPrevio,
    alertaMovimentacoesNaoRefletidas: movimentacoesNaoRefletidas,
    mudancasRegistradasNoHistorico: logMudancas.length,
    _ativosNoRaioX: ativosNoRaioX
  };

  // Colaborador novo (sem período aquisitivo ainda) ou afastamento novo mudam períodos: roda as 3
  // rotinas de férias na sequência. Se falhar, não derruba a sincronização (já gravada).
  try {
    const fechados = fecharPeriodosEmCurso();
    const marcados = marcarPeriodosAfastados();
    const gerados = gerarPeriodos();

    resultado.periodosAtualizadosAutomaticamente = {
      fecharPeriodosEmCurso: fechados,
      marcarPeriodosAfastados: marcados,
      gerarPeriodos: gerados
    };
  } catch (e) {
    resultado.periodosAtualizadosAutomaticamente = { erro: 'Falhou ao atualizar períodos: ' + e.message };
    console.error('sincronizarRaioX: falha ao encadear rotinas de período: ' + e);
  }

  console.log(JSON.stringify(Object.assign({}, resultado, { _ativosNoRaioX: undefined }), null, 2));
  return resultado;
}

/**
 * Rotina de toda sexta (gatilho de criarGatilhoSincronizacaoRaioX).
 * [FIX 2026-10-21] Antes reaplicava sempre o mesmo arquivo, "RAIO-X 30.07.2026.xlsx": quem foi
 * admitido depois de julho nunca entrava na base, cerca de 140 pessoas trocavam de situação toda
 * semana (Desligado ↔ Ativo) e quem um Raio-X mais novo incluísse seria marcado desligado na sexta
 * seguinte, por não estar no arquivo de julho. Agora o Raio-X só é aplicado quando alguém importa um
 * arquivo novo pelo portal (raioxImportar). A sexta só marca os desligados da CONTROLE.2026 com
 * demissão até hoje; os períodos de férias já são atualizados todo dia por rotinaDiariaFerias.
 */
function rodarSincronizacaoRaioX() {
  const r = sincronizarDesligadosDaRescisao(null, { ateHoje: true });
  const resultado = { desligadosSincronizadosDaRescisao: r.atualizados, naoEncontradosNaMaster: r.naoEncontrados.length };
  console.log(JSON.stringify(resultado));
  return resultado;
}

/**
 * Cria o gatilho automático: toda sexta-feira às 12h, roda rodarSincronizacaoRaioX() sozinho.
 * Rode esta função UMA vez só (não precisa repetir). Rodar de novo por engano cria um
 * segundo gatilho igual, duplicando a sincronização — se isso acontecer, veja
 * listarGatilhosRaioX() e apague o duplicado manualmente em Editor > Gatilhos (relógio).
 * Isso NÃO impede de continuar rodando rodarSincronizacaoRaioX() manualmente quando quiser.
 */
function criarGatilhoSincronizacaoRaioX() {
  ScriptApp.newTrigger('rodarSincronizacaoRaioX')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(12)
    .create();

  return 'Gatilho criado: sincronização automática toda sexta-feira às 12h.';
}

/** Lista os gatilhos existentes ligados a esse projeto, pra conferir se não duplicou. */
function listarGatilhosRaioX() {
  const gatilhos = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'rodarSincronizacaoRaioX')
    .map(t => ({ funcao: t.getHandlerFunction(), tipo: String(t.getEventType()) }));

  console.log(JSON.stringify(gatilhos, null, 2));
  return gatilhos;
}