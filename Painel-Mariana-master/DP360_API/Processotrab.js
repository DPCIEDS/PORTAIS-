/*************************************************************************************************
 * MÓDULO PROCESSOS TRABALHISTAS · DP360, arquivo PROCESSOTRAB.gs
 * -----------------------------------------------------------------------------------------------
 * Controle de pagamento de FGTS e INSS determinados em processo trabalhista (sentença ou acordo).
 * Só existe no Portal do DP, o gestor nunca solicita nem visualiza nada aqui.
 *
 * Cole como NOVO arquivo no projeto DP360_API (ao lado de Codigo.gs, FERIAS.gs, AFASTAMENTOS.gs,
 * RESCISAO.gs). Depende de helpers já existentes no projeto: _colaboradores_, _salvarDocumento_ e
 * _pastaDoColaborador_ (AFASTAMENTOS.gs), _slug_ (AFASTAMENTOS.gs), _rescMoeda_ (RESCISAO.gs),
 * _sheetToObjects_, _atualizarLinha_, _headers_, _auditar_, _dataF_, _isoF_, _fmtBRF_,
 * _hojeFerias_, _normalizarEmail_, _uuid_, _sim_.
 *
 * O QUE ESTE MÓDULO FAZ:
 *   REGISTRAR                → DP abre o processo: número, colaborador, valores devidos de FGTS
 *                              e/ou INSS, data da decisão/acordo, prazo de pagamento.
 *   REGISTRAR_PAGAMENTO_FGTS → DP informa a data do pagamento do FGTS e anexa a guia paga.
 *   REGISTRAR_PAGAMENTO_INSS → idem para o INSS (guia GPS/GRU).
 *   CANCELAR                 → marca um lançamento como cancelado (nunca apaga, append-only).
 *   LISTAR / FILA            → consulta com o status calculado na hora (PENDENTE, PARCIAL, PAGO,
 *                              CANCELADO) e a flag "atrasado" (passou do prazo e falta pagar).
 *   INDICADORES               → contagem por status, para acompanhamento.
 *
 * STATUS é CALCULADO a cada leitura a partir dos pagamentos registrados, nunca fica "preso" com
 * um valor desatualizado. A única gravação manual no STATUS é o cancelamento.
 *
 * A aba PROCESSOS_TRABALHISTAS é criada por este módulo na MESMA planilha CONTROLE DE PAGAMENTO
 * (reaproveita RESC.CONTROLE_ID do RESCISAO.gs, por isso este arquivo depende do RESCISAO.gs
 * estar carregado no projeto).
 *
 * PARA PLUGAR NO KERNEL:
 *   1) Codigo.gs → registrar o módulo em _modulosDisponiveis_() (bloco pronto no fim deste arquivo)
 *   2) FERIAS.gs → adicionar o roteamento de PROCESSOTRAB.* no executar() (bloco pronto no fim)
 *   3) rode UMA vez: procTrabSetup()
 *   4) adicione PROCESSOTRAB na coluna MODULOS dos usuários do DP que vão cuidar disso
 *      (ADMIN já enxerga tudo; GESTOR nunca tem acesso, não há permissão de GESTOR aqui)
 *************************************************************************************************/

const PROCTRAB = {
  VERSAO: '1.0.0',

  ABA: 'PROCESSOS_TRABALHISTAS',

  COLUNAS: [
    'ID_PROCESSO', 'NUMERO_PROCESSO',
    'ID_COLABORADOR', 'MATRICULA', 'NOME', 'EMPRESA_COD', 'EMPRESA',
    'VALOR_FGTS', 'VALOR_INSS',
    'DATA_DECISAO', 'PRAZO_PAGAMENTO', 'STATUS',
    'DATA_PAGAMENTO_FGTS', 'GUIA_FGTS_LINK',
    'DATA_PAGAMENTO_INSS', 'GUIA_INSS_LINK',
    'ESCRITORIO_RESPONSAVEL', 'CASO_RESCISAO_ORIGEM', 'OBSERVACAO',
    'REGISTRADO_POR', 'REGISTRADO_EM', 'ATUALIZADO_POR', 'ATUALIZADO_EM',
    'HISTORICO_JSON'
  ]
};

/* ============================================================================================ */
/*  ROTEADOR DO MÓDULO                                                                           */
/* ============================================================================================ */

function procTrabExecutar(acao, p, user) {
  switch (acao) {
    case 'PROCESSOTRAB.CONTEXTO':              return procTrabContexto(user, p);
    case 'PROCESSOTRAB.RESUMO':                return procTrabResumo(user, p);
    case 'PROCESSOTRAB.FILA':                  return procTrabFila(user, p);
    case 'PROCESSOTRAB.LISTAR':                return procTrabListar(user, p);
    case 'PROCESSOTRAB.REGISTRAR':              return procTrabRegistrar(user, p);
    case 'PROCESSOTRAB.REGISTRAR_PAGAMENTO_FGTS': return procTrabRegistrarPagamentoFgts(user, p);
    case 'PROCESSOTRAB.REGISTRAR_PAGAMENTO_INSS': return procTrabRegistrarPagamentoInss(user, p);
    case 'PROCESSOTRAB.CANCELAR':               return procTrabCancelar(user, p);
    case 'PROCESSOTRAB.INDICADORES':            return procTrabIndicadores(user, p);
    default:
      throw new Error('Ação de processos trabalhistas desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  INFRA                                                                                        */
/* ============================================================================================ */

// Reaproveita a mesma planilha CONTROLE DE PAGAMENTO que o RESCISAO.gs já usa.
// Mesma planilha da Rescisão (RESC.CONTROLE_ID) — reaproveita o cache de _ssControle_()
// em vez de abrir a mesma planilha uma segunda vez.
function _ssProcTrab_() { return _ssControle_(); }

function _shProcTrab_() {
  const sh = _ssProcTrab_().getSheetByName(PROCTRAB.ABA);
  if (!sh) throw new Error('Aba não encontrada: ' + PROCTRAB.ABA + '. Rode procTrabSetup() uma vez.');
  return sh;
}

/** Cria a aba PROCESSOS_TRABALHISTAS se ainda não existir. Rode procTrabSetup() uma vez. */
function garantirAbaProcessosTrabalhistas() {
  const ss = _ssProcTrab_();
  let sh = ss.getSheetByName(PROCTRAB.ABA);

  if (!sh) {
    sh = ss.insertSheet(PROCTRAB.ABA);
    sh.getRange(1, 1, 1, PROCTRAB.COLUNAS.length).setValues([PROCTRAB.COLUNAS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, PROCTRAB.COLUNAS.length).setFontWeight('bold');
    return 'Aba PROCESSOS_TRABALHISTAS criada.';
  }

  const h = _headers_(sh);
  const faltando = PROCTRAB.COLUNAS.filter(c => h.indexOf(c) === -1);
  if (faltando.length) {
    let col = sh.getLastColumn();
    faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));
    return 'Colunas acrescentadas: ' + faltando.join(', ');
  }
  return 'Aba PROCESSOS_TRABALHISTAS já está pronta.';
}

function _procTrabPorId_(id) {
  return _sheetToObjects_(_shProcTrab_()).find(x => String(x.ID_PROCESSO) === String(id)) || null;
}

/**
 * Calcula o status de exibição (nunca fica desatualizado, pois é derivado a cada leitura) e a
 * flag "atrasado" (passou do prazo e ainda falta algum pagamento devido).
 */
function _procTrabStatusCalculado_(o) {
  if (String(o.STATUS || '').toUpperCase() === 'CANCELADO') {
    return { status: 'CANCELADO', atrasado: false };
  }

  const devFgts = Number(o.VALOR_FGTS || 0) > 0;
  const devInss = Number(o.VALOR_INSS || 0) > 0;
  const pagoFgts = !!o.DATA_PAGAMENTO_FGTS;
  const pagoInss = !!o.DATA_PAGAMENTO_INSS;

  const completo = (!devFgts || pagoFgts) && (!devInss || pagoInss);
  const algumPago = (devFgts && pagoFgts) || (devInss && pagoInss);

  if (completo) return { status: 'PAGO', atrasado: false };

  const prazo = _dataF_(o.PRAZO_PAGAMENTO);
  const atrasado = !!(prazo && prazo.getTime() < _hojeFerias_().getTime());

  return { status: algumPago ? 'PARCIAL' : 'PENDENTE', atrasado: atrasado };
}

function _procTrabResumoLinha_(o) {
  const calc = _procTrabStatusCalculado_(o);
  return {
    id: o.ID_PROCESSO,
    numeroProcesso: o.NUMERO_PROCESSO,
    idColaborador: o.ID_COLABORADOR,
    matricula: o.MATRICULA,
    nome: o.NOME,
    empresa: o.EMPRESA,
    valorFgts: o.VALOR_FGTS || '',
    valorInss: o.VALOR_INSS || '',
    dataDecisao: _isoF_(o.DATA_DECISAO),
    prazoPagamento: _isoF_(o.PRAZO_PAGAMENTO),
    status: calc.status,
    atrasado: calc.atrasado,
    dataPagamentoFgts: _isoF_(o.DATA_PAGAMENTO_FGTS),
    guiaFgtsLink: o.GUIA_FGTS_LINK || '',
    dataPagamentoInss: _isoF_(o.DATA_PAGAMENTO_INSS),
    guiaInssLink: o.GUIA_INSS_LINK || '',
    escritorioResponsavel: o.ESCRITORIO_RESPONSAVEL || '',
    casoRescisaoOrigem: o.CASO_RESCISAO_ORIGEM || '',
    observacao: o.OBSERVACAO || '',
    registradoPor: o.REGISTRADO_POR,
    registradoEm: _isoF_(o.REGISTRADO_EM)
  };
}

/* ============================================================================================ */
/*  CONTEXTO / RESUMO / FILA / LISTAR                                                            */
/* ============================================================================================ */

// Só existe visão global, não há escopo de gestor neste módulo.
function procTrabContexto(user, p) {
  return { ok: true, modulo: 'PROCESSOTRAB', versao: PROCTRAB.VERSAO, processos: procTrabListar(user, p).processos };
}

function procTrabResumo(user, p) { return procTrabResumoDe(procTrabContexto(user, p)); }

function procTrabResumoDe(ctx) {
  const abertos = ctx.processos.filter(x => x.status !== 'PAGO' && x.status !== 'CANCELADO');
  const atrasados = abertos.filter(x => x.atrasado);

  return {
    modulo: 'PROCESSOTRAB',
    nome: 'Processos Trabalhistas',
    icone: '⚖️',
    contadores: {
      abertos: abertos.length,
      atrasados: atrasados.length,
      pagos: ctx.processos.filter(x => x.status === 'PAGO').length
    },
    precisaDeVoce: atrasados.slice(0, 8).map(x => ({
      id: x.id, nome: x.nome,
      detalhe: 'Prazo ' + (x.prazoPagamento ? x.prazoPagamento : ',') + ' já venceu'
    })),
    emAndamento: abertos.slice(0, 8).map(x => ({
      nome: x.nome, numeroProcesso: x.numeroProcesso, status: x.status, prazo: x.prazoPagamento
    }))
  };
}

function procTrabListar(user, p) {
  p = p || {};
  const todos = _sheetToObjects_(_shProcTrab_()).map(_procTrabResumoLinha_);

  const filtroStatus = String(p.status || '').toUpperCase();
  const somenteAtrasados = _sim_(p.somenteAtrasados);

  const filtrados = todos.filter(x =>
    (!filtroStatus || x.status === filtroStatus) &&
    (!somenteAtrasados || x.atrasado)
  ).sort((a, b) => String(a.prazoPagamento || '').localeCompare(String(b.prazoPagamento || '')));

  return { ok: true, total: filtrados.length, processos: filtrados };
}

/** Fila para o Portal do DP: já vem agrupada por etapa. */
function procTrabFila(user, p) {
  const todos = procTrabListar(user, {}).processos;

  return {
    ok: true,
    modulo: 'PROCESSOTRAB',
    atrasados: todos.filter(x => x.atrasado),
    pendentes: todos.filter(x => !x.atrasado && x.status === 'PENDENTE'),
    parciais: todos.filter(x => !x.atrasado && x.status === 'PARCIAL'),
    pagos: todos.filter(x => x.status === 'PAGO').slice(0, 30),
    cancelados: todos.filter(x => x.status === 'CANCELADO').slice(0, 30)
  };
}

function procTrabIndicadores(user, p) {
  const todos = procTrabListar(user, p).processos;
  const porStatus = {};
  todos.forEach(x => { porStatus[x.status] = (porStatus[x.status] || 0) + 1; });

  return {
    ok: true,
    total: todos.length,
    porStatus: porStatus,
    atrasados: todos.filter(x => x.atrasado).length
  };
}

/* ============================================================================================ */
/*  REGISTRAR + PAGAMENTOS + CANCELAR                                                            */
/* ============================================================================================ */

/**
 * Abre um novo processo trabalhista com FGTS e/ou INSS a pagar.
 * payload:
 *   numeroProcesso, idColaborador (opcional, preenche dados automaticamente se achar na base)
 *   matricula, nome, empresaCod, empresa   (usar se o colaborador já não estiver na base ativa)
 *   valorFgts, valorInss   (ao menos um dos dois deve ser informado e maior que zero)
 *   dataDecisao, prazoPagamento
 *   escritorioResponsavel (opcional), casoRescisaoOrigem (opcional, ID_CASO da RESCISAO_CASOS)
 *   observacao (opcional)
 */
function procTrabRegistrar(user, p) {
  const valorFgts = Number(String(p.valorFgts || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  const valorInss = Number(String(p.valorInss || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;

  if (valorFgts <= 0 && valorInss <= 0) {
    throw new Error('Informe ao menos um valor: FGTS e/ou INSS, maior que zero.');
  }

  if (!String(p.numeroProcesso || '').trim()) throw new Error('Informe o número do processo.');

  const dataDecisao = _dataF_(p.dataDecisao);
  if (!dataDecisao) throw new Error('Informe a data da decisão/acordo.');

  const prazoPagamento = _dataF_(p.prazoPagamento);
  if (!prazoPagamento) throw new Error('Informe o prazo de pagamento.');

  let c = null;
  if (p.idColaborador) {
    c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(p.idColaborador));
  }

  const matricula = (c && c.MATRICULA) || p.matricula || '';
  const nome = (c && c.NOME) || p.nome || '';
  const empresaCod = (c && c.EMPRESA_COD) || p.empresaCod || '';
  const empresa = (c && c.EMPRESA) || p.empresa || '';

  if (!nome) throw new Error('Informe ao menos o nome do colaborador (direto ou via idColaborador).');

  const idProcesso = 'PT-' + _uuid_().slice(0, 8).toUpperCase();
  const historico = [{
    em: _agoraISO_(), por: _normalizarEmail_(user.EMAIL), evento: 'REGISTRADO', de: '', para: 'PENDENTE'
  }];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = _shProcTrab_();
    const h = _headers_(sh);

    const dados = {
      ID_PROCESSO: idProcesso,
      NUMERO_PROCESSO: String(p.numeroProcesso).trim(),
      ID_COLABORADOR: (c && c.ID_COLABORADOR) || p.idColaborador || '',
      MATRICULA: matricula,
      NOME: nome,
      EMPRESA_COD: empresaCod,
      EMPRESA: empresa,
      VALOR_FGTS: valorFgts > 0 ? _rescMoeda_(valorFgts) : '',
      VALOR_INSS: valorInss > 0 ? _rescMoeda_(valorInss) : '',
      DATA_DECISAO: dataDecisao,
      PRAZO_PAGAMENTO: prazoPagamento,
      STATUS: 'PENDENTE',
      DATA_PAGAMENTO_FGTS: '',
      GUIA_FGTS_LINK: '',
      DATA_PAGAMENTO_INSS: '',
      GUIA_INSS_LINK: '',
      ESCRITORIO_RESPONSAVEL: String(p.escritorioResponsavel || ''),
      CASO_RESCISAO_ORIGEM: String(p.casoRescisaoOrigem || ''),
      OBSERVACAO: String(p.observacao || ''),
      REGISTRADO_POR: _normalizarEmail_(user.EMAIL),
      REGISTRADO_EM: new Date(),
      ATUALIZADO_POR: _normalizarEmail_(user.EMAIL),
      ATUALIZADO_EM: new Date(),
      HISTORICO_JSON: JSON.stringify(historico)
    };

    sh.appendRow(h.map(col => (dados[col] === undefined ? '' : dados[col])));
  } finally {
    lock.releaseLock();
  }

  _auditar_('PROCTRAB_REGISTRADO', user.EMAIL, 'PROCESSOTRAB.REGISTRAR', true,
    nome + ': processo ' + p.numeroProcesso + ' (FGTS ' + (valorFgts || 0) + ' / INSS ' + (valorInss || 0) + ')',
    { id: idProcesso });

  return { ok: true, id: idProcesso, mensagem: 'Processo trabalhista registrado.' };
}

function _procTrabPatch_(id, patch, user, evento) {
  const sh = _shProcTrab_();
  const h = _headers_(sh);
  const o = _procTrabPorId_(id);
  if (!o) throw new Error('Processo não encontrado: ' + id);

  let hist = [];
  try { hist = JSON.parse(o.HISTORICO_JSON || '[]'); } catch (e) { hist = []; }
  hist.push({ em: _agoraISO_(), por: _normalizarEmail_(user.EMAIL), evento: evento, de: o.STATUS, para: patch.STATUS || o.STATUS });

  patch.HISTORICO_JSON = JSON.stringify(hist);
  patch.ATUALIZADO_POR = _normalizarEmail_(user.EMAIL);
  patch.ATUALIZADO_EM = new Date();

  _atualizarLinha_(sh, o._rowNumber, h, patch);

  _auditar_('PROCTRAB_' + evento, user.EMAIL, 'PROCESSOTRAB', true, o.NOME + ': ' + evento, { id: id });

  return Object.assign({}, o, patch);
}

/** payload: id, dataPagamento, guiaBase64?, guiaNome?, guiaTipo? */
function procTrabRegistrarPagamentoFgts(user, p) {
  const o = _procTrabPorId_(p.id);
  if (!o) throw new Error('Processo não encontrado.');
  if (!(Number(String(o.VALOR_FGTS || '0').replace(/[^\d.,]/g, '').replace(',', '.')) > 0)) {
    throw new Error('Este processo não tem valor de FGTS registrado.');
  }

  const data = _dataF_(p.dataPagamento);
  if (!data) throw new Error('Informe a data do pagamento do FGTS.');

  let link = '';
  if (p.guiaBase64) {
    const c = { ID_COLABORADOR: o.ID_COLABORADOR, NOME: o.NOME, MATRICULA: o.MATRICULA };
    link = _salvarDocumento_(c, 'guia_fgts_processo', p.guiaBase64,
      p.guiaNome || 'guia_fgts.pdf', p.guiaTipo || 'application/pdf', data);
  }

  _procTrabPatch_(p.id, {
    DATA_PAGAMENTO_FGTS: data,
    GUIA_FGTS_LINK: link || o.GUIA_FGTS_LINK || ''
  }, user, 'PAGAMENTO_FGTS_REGISTRADO');

  return { ok: true, mensagem: 'Pagamento do FGTS registrado (' + _fmtBRF_(data) + ').' };
}

/** payload: id, dataPagamento, guiaBase64?, guiaNome?, guiaTipo? */
function procTrabRegistrarPagamentoInss(user, p) {
  const o = _procTrabPorId_(p.id);
  if (!o) throw new Error('Processo não encontrado.');
  if (!(Number(String(o.VALOR_INSS || '0').replace(/[^\d.,]/g, '').replace(',', '.')) > 0)) {
    throw new Error('Este processo não tem valor de INSS registrado.');
  }

  const data = _dataF_(p.dataPagamento);
  if (!data) throw new Error('Informe a data do pagamento do INSS.');

  let link = '';
  if (p.guiaBase64) {
    const c = { ID_COLABORADOR: o.ID_COLABORADOR, NOME: o.NOME, MATRICULA: o.MATRICULA };
    link = _salvarDocumento_(c, 'guia_inss_processo', p.guiaBase64,
      p.guiaNome || 'guia_inss.pdf', p.guiaTipo || 'application/pdf', data);
  }

  _procTrabPatch_(p.id, {
    DATA_PAGAMENTO_INSS: data,
    GUIA_INSS_LINK: link || o.GUIA_INSS_LINK || ''
  }, user, 'PAGAMENTO_INSS_REGISTRADO');

  return { ok: true, mensagem: 'Pagamento do INSS registrado (' + _fmtBRF_(data) + ').' };
}

/** payload: id, motivo. Nunca apaga a linha, só marca como cancelado, preservando o histórico. */
function procTrabCancelar(user, p) {
  const o = _procTrabPorId_(p.id);
  if (!o) throw new Error('Processo não encontrado.');

  _procTrabPatch_(p.id, {
    STATUS: 'CANCELADO',
    OBSERVACAO: (o.OBSERVACAO ? o.OBSERVACAO + ' | ' : '') + 'Cancelado: ' + String(p.motivo || '')
  }, user, 'CANCELADO');

  return { ok: true, mensagem: 'Processo marcado como cancelado.' };
}

/* ============================================================================================ */
/*  SETUP + DIAGNÓSTICO (funções sem parâmetro, rode pelo ▶)                                    */
/* ============================================================================================ */

/** Rode UMA vez: cria a aba e semeia a permissão de DP. */
function procTrabSetup() {
  const r1 = garantirAbaProcessosTrabalhistas();
  const r2 = semearPermissoesProcessoTrabalhista();
  const msg = 'PROCESSOS TRABALHISTAS pronto.\n- ' + r1 + '\n- ' + r2 +
    '\n\nAplique os 2 patches (Codigo.gs e FERIAS.gs) descritos no cabeçalho deste arquivo, ' +
    'e adicione PROCESSOTRAB na coluna MODULOS dos usuários do DP responsáveis ' +
    '(ADMIN já enxerga tudo; GESTOR nunca tem acesso a este módulo).';
  console.log(msg);
  return msg;
}

function semearPermissoesProcessoTrabalhista() {
  const ss = _configSS_();
  const sh = ss.getSheetByName(DP360.SHEETS.PERMISSOES);
  if (!sh) throw new Error('Aba PERMISSOES não encontrada. Rode setupDP360() primeiro.');

  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh).map(r =>
    String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  // Só DP, nunca GESTOR. ADMIN já é wildcard '*' em outro lugar do kernel.
  const novas = [
    ['DP', 'PROCESSOTRAB.*', 'Sim', 'GLOBAL', 'Controle de pagamento de FGTS/INSS de processo trabalhista.']
  ];

  let add = 0;
  novas.forEach(linha => {
    const chave = linha[0].toUpperCase() + '|' + linha[1].toUpperCase();
    if (existentes.indexOf(chave) === -1) {
      const obj = { PERFIL: linha[0], ACAO: linha[1], PERMITIDO: linha[2], ESCOPO: linha[3], DESCRICAO: linha[4] };
      sh.appendRow(h.map(col => (obj[col] === undefined ? '' : obj[col])));
      add++;
    }
  });

  if (typeof _limparCachePermissoes_ === 'function') _limparCachePermissoes_();

  return add ? (add + ' permissão(ões) adicionada(s).') : 'Permissão já estava presente.';
}

function diagnosticarProcessosTrabalhistas() {
  const sh = _ssProcTrab_().getSheetByName(PROCTRAB.ABA);
  const registros = sh ? _sheetToObjects_(sh) : [];

  const out = {
    versao: PROCTRAB.VERSAO,
    abaExiste: !!sh,
    processosRegistrados: registros.length,
    porStatusCalculado: {}
  };

  registros.map(_procTrabResumoLinha_).forEach(x => {
    out.porStatusCalculado[x.status] = (out.porStatusCalculado[x.status] || 0) + 1;
  });

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ============================================================================================ */
/*  PATCHES PRONTOS PARA COLAR NO KERNEL                                                         */
/* ============================================================================================ */

/*
--- Codigo.gs, dentro de _modulosDisponiveis_() ---

  if (typeof procTrabResumo === 'function') {
    m.PROCESSOTRAB = {
      nome: 'Processos Trabalhistas',
      permissao: 'PROCESSOTRAB.CONTEXTO',
      resumo: procTrabResumo,
      resumoDe: procTrabResumoDe,
      contexto: procTrabContexto
    };
  }

--- FERIAS.gs, dentro de executar(), logo após o bloco de RESCISAO.* ---

  if (acao.indexOf('PROCESSOTRAB.') === 0 && typeof procTrabExecutar === 'function') {
    return procTrabExecutar(acao, payload || {}, user);
  }
*/