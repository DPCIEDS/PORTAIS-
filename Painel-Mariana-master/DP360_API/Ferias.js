/*************************************************************************************************
 * DP360_API · FERIAS.gs, Módulo de Férias (v1.0.0)
 * -----------------------------------------------------------------------------------------------
 * Cole como NOVO arquivo no projeto DP360_API (ao lado do Codigo.gs).
 *
 * ⚠️ PATCH OBRIGATÓRIO: APAGUE a função executar() do Codigo.gs.
 *    A versão nova está aqui embaixo e faz o roteamento dos módulos.
 *
 * PRINCÍPIOS
 *   - Saldo é CALCULADO, nunca lido de célula: direito - gozados_anteriores - (deferidas+pendentes)
 *   - SOLICITACOES é append-only. Indeferir/cancelar muda STATUS; nada é apagado.
 *   - O escopo do gestor vem da DP360_MASTER em tempo real, nunca de coluna copiada.
 *   - Toda escrita passa por aqui e vai para a AUDITORIA.
 *   - O custo é calculado com o salário VIGENTE (HISTÓRICO) e congelado em snapshot ao deferir.
 *
 * AÇÕES
 *   FERIAS.CONTEXTO   (gestor) equipe + saldos + solicitações
 *   FERIAS.SOLICITAR  (gestor) cria solicitação (gozo + abono)
 *   FERIAS.CANCELAR   (gestor) cancela a própria solicitação, se ainda PENDENTE
 *   FERIAS.FILA       (DP)     fila de aprovação + impacto no mês
 *   FERIAS.DEFERIR    (DP)     defere e congela o custo
 *   FERIAS.INDEFERIR  (DP)     indefere com motivo (saldo volta sozinho)
 *   FERIAS.CALENDARIO (DP)     custo por mês x teto
 *************************************************************************************************/

const FERIAS = {
  VERSAO: '1.0.0',

  SHEET_ID: '1gX_uwAY4Go4oaqDsPV4qZlN3l2ZFwWqtNuERzQy3WzQ',
  AFASTAMENTOS_ID: '1zYYtJG8RyOcrPZiEkDNZtXWr0AZKrkgS3DuaV9zukO0',

  ABAS: {
    PERIODOS: 'PERIODOS',
    SOLICITACOES: 'SOLICITACOES',
    PARAMETROS: 'PARAMETROS',
    FIM_DE_ANO: 'FIM_DE_ANO'
  },

  // Status de período que NÃO geram saldo nem custo.
  STATUS_INATIVOS: ['PERDIDO', 'CONGELADO'],

  // EM_CURSO = período aquisitivo ainda correndo. Não dá direito a gozo ainda,
  // mas é NELE que a lei permite pedir a venda de dias (art. 143 §1º).
  STATUS_SEM_SALDO: ['PERDIDO', 'CONGELADO', 'EM_CURSO'],

  // Colunas de controle do abono. Criadas no FIM da aba PERIODOS por garantirColunasAbono().
  COLUNAS_ABONO: [
    'ABONO_STATUS',          // (vazio) | SOLICITADO | LIBERADO | RECUSADO
    'ABONO_DIAS_PEDIDOS',    // quantos dias o colaborador quer vender
    'ABONO_SOLICITADO_POR',  // gestor que registrou o pedido do colaborador
    'ABONO_SOLICITADO_EM',   // quando o pedido entrou no portal
    'ABONO_AUTORIZADO',      // Sim/Não, o DP confirmou
    'ABONO_PEDIDO_EM',       // data em que o colaborador pediu
    'ABONO_AUTORIZADO_POR',  // quem do DP confirmou
    'ABONO_EXCECAO',         // Sim/Não, liberado fora do prazo
    'ABONO_JUSTIFICATIVA'
  ],

  // Colunas de controle do envio ao financeiro. Criadas no FIM da aba SOLICITACOES
  // por garantirColunasFinanceiro().
  COLUNAS_FINANCEIRO: [
    'ENVIADO_FINANCEIRO_EM',       // quando o DP mandou pro financeiro (pelo portal)
    'ENVIADO_FINANCEIRO_POR',
    'DOCUMENTO_FINANCEIRO_LINK',   // link do Drive do documento anexado, se houver
    'VENCIMENTO_PAGAMENTO',        // congelado no envio: data-limite pro financeiro pagar
    'WEB_FINANCEIRO',              // [2026-10-29] número de controle WEB (ex.: WEB:1011/2026), ver FeriasFinanceiro.js
    'VALOR_LIQUIDO',               // [2026-10-29] valor líquido das férias (do BI Férias ou digitado)
    'LOTE_FINANCEIRO'              // [2026-10-29] lote do envio por departamento (LOTE-aaaammdd-hhmmss)
  ],

  // Antecedência mínima exigida pelo financeiro entre o envio e o vencimento do pagamento.
  FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS: 3,

  // As 4 janelas anuais de agendamento. Datas em 'MM-DD' (o ano é sempre o corrente/próximo,
  // calculado na hora). agendamentoInicio pode cair no ano ANTERIOR ao gozo (ex.: agenda em
  // dezembro pra gozar em abril) — por isso tudo aqui é comparado só por mês/dia, sem ano fixo.
  JANELAS: [
    { id: 1, nome: '1ª janela (jan-mar)', gozoInicio: '01-01', gozoFim: '03-31', agendInicio: '09-01', agendFim: '09-14', retornoDPInicio: '09-15', retornoDPFim: '09-30' },
    { id: 2, nome: '2ª janela (abr-jun)', gozoInicio: '04-01', gozoFim: '06-30', agendInicio: '12-01', agendFim: '12-14', retornoDPInicio: '12-15', retornoDPFim: '12-30' },
    { id: 3, nome: '3ª janela (jul-set)', gozoInicio: '07-01', gozoFim: '09-30', agendInicio: '03-01', agendFim: '03-14', retornoDPInicio: '03-15', retornoDPFim: '03-30' },
    { id: 4, nome: '4ª janela (out-dez)', gozoInicio: '10-01', gozoFim: '12-31', agendInicio: '06-01', agendFim: '06-14', retornoDPInicio: '06-15', retornoDPFim: '06-30' }
  ],

  // Opções fixas de férias de fim de ano (fica configurável aqui, ano a ano).
  OPCOES_FIM_DE_ANO: [
    { id: 'OPCAO_1', inicio: '2026-12-15', fim: '2026-12-24', dias: 10 },
    { id: 'OPCAO_2', inicio: '2026-12-28', fim: '2027-01-06', dias: 10 }
  ],

  // Prazos específicos da campanha de fim de ano 2026 (independentes das 4 janelas normais).
  FIM_DE_ANO_INICIO_GESTOR: '2026-09-09',  // janela do gestor: 09/09 a 22/09 (data EXIBIDA no portal)
  FIM_DE_ANO_PERMITIR_ANTES: false,  // TRUE: libera agendar antes de 09/09 sem mudar o texto; false trava de verdade em 09/09
  FIM_DE_ANO_PRAZO_GESTOR: '2026-09-22',
  FIM_DE_ANO_PRAZO_DP: '2026-10-08',       // janela do DP: 23/09 a 08/10 (15 dias após 22/09)

  // Lista validada pelo DP (relatório de conferência): só quem está aqui participa da
  // campanha de fim de ano 2026, além das demais travas (saldo, timing, cargo, etc.).
  FIM_DE_ANO_MATRICULAS_PERMITIDAS: [
    "000033",
    "107449",
    "110770",
    "111132",
    "111663",
    "8039",
    "8041",
    "103152",
    "103679",
    "103736",
    "104937",
    "105264",
    "105359",
    "105997",
    "107249",
    "107282",
    "107328",
    "107587",
    "108289",
    "108780",
    "108872",
    "109363",
    "109444",
    "109663",
    "110506",
    "110509",
    "110738",
    "110739",
    "111065",
    "111227",
    "111260",
    "111358",
    "111626",
    "111629",
    "111654",
    "111688",
    "111770",
    "111347",
    "108500",
    "110944",
    "110947",
    "110969",
    "110995",
    "111116",
    "111769",
    "103209",
    "107898",
    "109135",
    "109160",
    "109611",
    "111508",
    "111775",
    "404",
    "105358",
    "106409",
    "107102",
    "107766",
    "107962",
    "108226",
    "108795",
    "109264",
    "110032",
    "110053",
    "110362",
    "110870",
    "110893",
    "110907",
    "110928",
    "110931",
    "111081",
    "111136",
    "111228",
    "111439",
    "111478",
    "111584",
    "111621",
    "111661",
    "109827",
    "108296",
    "108443",
    "108494",
    "108771",
    "109491",
    "110445",
    "108442",
    "107728",
    "110740",
    "110924",
    "26",
    "28",
    "29",
    "31",
    "32",
    "105904",
    "110001",
    "110031",
    "111111",
    "111556",
    "111349",
    "111646",
    "111647",
    "106343",
    "109442",
    "109477",
    "109487",
    "109992",
    "109993",
    "109628",
    "109630",
    "109624",
    "109625",
    "110253",
    "109646",
    "110086",
    "103915",
    "106344",
    "111447",
    "109818",
    "111348",
    "108231",
    "108290",
    "111084",
    "111441",
    "110935",
    "111261",
    "111262",
    "111321",
    "111720",
    "100901"
  ],

  // Regras (default; a aba PARAMETROS sobrescreve)
  DIAS_INICIO_BLOQUEADOS: [4, 5, 6, 0],   // qui, sex, sáb, dom
  ANTECEDENCIA_MINIMA_DIAS: 30,
  CALENDARIO_MESES: 12,

  // Art. 143 §1º: o abono deve ser pedido até 15 dias ANTES do fim do período aquisitivo.
  ABONO_PRAZO_ANTES_FIM_AQUIS: 15,
  ABONO_MAXIMO_DIAS: 10,
  BLOQUEAR_INICIO_FERIADO: true,
  DIAS_VESPERA_FERIADO: 2,
  FATOR_ENCARGOS: 1.0,                    // 1.0 = só bruto + 1/3. Suba se quiser incluir encargos.

  // Fracionamento, CLT art. 134 §1º
  MAX_FRACOES: 3,
  FRACAO_MAIOR_MINIMA: 14,
  FRACAO_MINIMA: 5,

  STATUS_ATIVOS: ['PENDENTE', 'DEFERIDA'],

  CACHE_SEG: 45,
  CTX_CACHE_SEG: 900   // 15 min. Qualquer escrita aposenta o cache antes disso.
};

/* ============================================================================================ */
/*  ROTEADOR, substitui o executar() do Codigo.gs                                               */
/* ============================================================================================ */

function executar(token, acao, payload) {
  const sess = _validarTokenOuErro_(token);
  const user = _obterUsuario_(sess.email);

  if (!user) throw new Error('Usuário não encontrado.');
  if (!_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) throw new Error('Usuário sem permissão de acesso.');

  acao = String(acao || '').toUpperCase();

  if (!_usuarioPodeAcao_(user, acao)) {
    _auditar_('PERMISSAO_NEGADA', sess.email, acao, false, 'Sem permissão.', { perfil: user.PERFIL });
    throw new Error('Usuário sem permissão para executar a ação: ' + acao);
  }

  if (acao.indexOf('FERIAS.') === 0) {
    return _feriasExecutar_(acao, payload || {}, user);
  }

  if (acao.indexOf('AFASTAMENTOS.') === 0 && typeof afastExecutar === 'function') {
    return afastExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('RESCISAO.') === 0 && typeof rescExecutar === 'function') {
    return rescExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('PROCESSOTRAB.') === 0 && typeof procTrabExecutar === 'function') {
    return procTrabExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('MOVIMENTACAO.') === 0 && typeof movExecutar === 'function') {
    return movExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('BENEFICIOS.') === 0 && typeof beneficiosExecutar === 'function') {
    return beneficiosExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('RAIOX.') === 0 && typeof raioxExecutar === 'function') {
    return raioxExecutar(acao, payload || {}, user);
  }

  if (acao.indexOf('ADMISSAO.') === 0 && typeof admExecutar === 'function') {
    return admExecutar(acao, payload || {}, user);
  }

  return {
    ok: false,
    erro: 'Módulo ainda não implementado: ' + acao
  };
}
/**
 * RESUMO, versão leve, para o painel inicial. Só contadores e o que precisa de ação.
 * É isto que o kernel chama em CARGA. O contexto completo só vem quando o gestor abre a aba.
 */
function feriasResumo(user, p) {
  return feriasResumoDe(feriasContexto(user, p));
}

/** [PERF] Deriva o resumo de um contexto JÁ calculado, sem recalcular nada. */
function feriasResumoDe(ctx) {
  const c = ctx.colaboradores;

  // Equipe grande sem departamento escolhido: os contadores vêm da lista de deptos.
  if (ctx.equipeGrande && !ctx.pessoasCarregadas) {
    const d = ctx.departamentos;
    return {
      modulo: 'FERIAS', nome: 'Férias', icone: '🌴',
      contadores: {
        pessoas: ctx.totalNaEquipe,
        comSaldo: d.reduce((t, x) => t + x.comSaldo, 0),
        prazoApertado: d.reduce((t, x) => t + x.criticos, 0),
        aguardandoDP: d.reduce((t, x) => t + Number(x.aguardandoDP || 0), 0),
        confirmadas: d.reduce((t, x) => t + Number(x.confirmadas || 0), 0),
        abonoNoPrazo: 0
      },
      precisaDeVoce: [],
      emAndamento: [],
      visao: ctx.visao,
      podeAlternarVisao: ctx.podeAlternarVisao,
      tamanhoEquipePropria: ctx.tamanhoEquipePropria,
      equipeGrande: true
    };
  }

  const idsComSaldo = {};
  const idsCriticos = {};
  const idsPendentes = {};
  const idsConfirmadas = {};

  c.forEach(x => {
    const id = _idColaboradorFerias_(x.idColaborador) || String(x.nome || '');
    if (x.saldo > 0) idsComSaldo[id] = true;
    if ((x.urgencia === 'CRITICO' || x.urgencia === 'VENCIDO') && x.saldo > 0) idsCriticos[id] = true;
  });

  // Mantém apenas um alerta crítico por pessoa, mesmo se houver um card adicional referente
  // a outro período com solicitação ativa.
  const criticosVistos = {};
  const criticos = c.filter(x => {
    const id = _idColaboradorFerias_(x.idColaborador) || String(x.nome || '');
    if (!idsCriticos[id] || criticosVistos[id]) return false;
    criticosVistos[id] = true;
    return true;
  });

  const pendentes = [];
  const confirmadas = [];

  c.forEach(x => x.solicitacoes.forEach(s => {
    const idPessoa = _idColaboradorFerias_(x.idColaborador) || String(x.nome || '');
    if (s.status === 'PENDENTE') {
      idsPendentes[idPessoa] = true;
      pendentes.push({ id: s.id, nome: x.nome, inicio: s.inicio, fim: s.fim, dias: s.dias, abono: s.abono });
    }
    if (s.status === 'DEFERIDA' && s.inicio) {
      idsConfirmadas[idPessoa] = true;
      confirmadas.push({ nome: x.nome, inicio: s.inicio, fim: s.fim, dias: s.dias });
    }
  }));

  return {
    modulo: 'FERIAS',
    nome: 'Férias',
    icone: '🌴',

    contadores: {
      pessoas: ctx.totalNaEquipe === undefined ? Object.keys(
        c.reduce((m, x) => {
          m[_idColaboradorFerias_(x.idColaborador) || String(x.nome || '')] = true;
          return m;
        }, {})
      ).length : ctx.totalNaEquipe,
      comSaldo: Object.keys(idsComSaldo).length,
      prazoApertado: Object.keys(idsCriticos).length,
      aguardandoDP: Object.keys(idsPendentes).length,
      confirmadas: Object.keys(idsConfirmadas).length,
      abonoNoPrazo: (ctx.abonoEmCurso || []).filter(x => x.podePedir).length
    },

    // o que exige ação do gestor, vai direto para "O que precisa de você"
    precisaDeVoce: criticos.slice(0, 8).map(x => ({
      idPeriodo: x.idPeriodo,
      nome: x.nome,
      detalhe: x.saldo + ' dias a tirar · prazo até ' + x.concederAte,
      diasRestantes: x.diasAteVencer
    })),

    emAndamento: pendentes,
    visao: ctx.visao,
    podeAlternarVisao: ctx.podeAlternarVisao,
    tamanhoEquipePropria: ctx.tamanhoEquipePropria
  };
}

function _feriasExecutar_(acao, p, user) {
  switch (acao) {
    case 'FERIAS.CONTEXTO':   return feriasContexto(user, p);
    case 'FERIAS.RESUMO':     return feriasResumo(user, p);
    case 'FERIAS.SOLICITAR':  return feriasSolicitar(user, p);
    case 'FERIAS.CANCELAR':   return feriasCancelar(user, p);
    case 'FERIAS.FILA':       return feriasFila(user);
    case 'FERIAS.DEFERIR':    return feriasDecidir(user, p, 'DEFERIDA');
    case 'FERIAS.INDEFERIR':  return feriasDecidir(user, p, 'INDEFERIDA');
    case 'FERIAS.CALENDARIO': return feriasCalendario(user, p);
    case 'FERIAS.RECIBOS':             return feriasRecibosLista(user, p);
    case 'FERIAS.ENVIAR_RECIBO':       return feriasReciboEnviarUm(user, p);
    case 'FERIAS.ENVIAR_RECIBOS_LOTE': return feriasReciboEnviarLote(user, p);
    case 'FERIAS.VERIFICAR_RECIBO':    return feriasReciboVerificar(user, p);
    case 'FERIAS.BAIXAR_RECIBO':       return feriasReciboBaixar(user, p);
    case 'FERIAS.BAIXAR_RECIBOS_LOTE': return feriasReciboBaixarLote(user, p);
    case 'FERIAS.VER_RECIBO':              return feriasReciboVerDocumento(user, p);
    case 'FERIAS.CANCELAR_RECIBO':         return feriasReciboCancelarPorId(user, p);
    case 'FERIAS.VERIFICAR_RECIBOS_LOTE':  return feriasRecibosVerificarTodos(user);
    case 'FERIAS.DEFINIR_TETO': return feriasDefinirTeto(user, p);
    case 'FERIAS.PROVISAO':        return feriasProvisao(user, p);
    case 'FERIAS.PAINEL_DP':       return feriasPainelDP(user, p);
    case 'FERIAS.SOLICITAR_ABONO': return feriasSolicitarAbono(user, p);
    case 'FERIAS.ABONO_EM_CURSO_GLOBAL': return feriasAbonoEmCursoGlobal(user, p);
    case 'FERIAS.AUTORIZAR_ABONO': return feriasAutorizarAbono(user, p);
    case 'FERIAS.REVOGAR_ABONO':   return feriasRevogarAbono(user, p);
    case 'FERIAS.ENVIAR_FINANCEIRO_LOTE': return feriasEnviarFinanceiroLote(user, p);
    case 'FERIAS.AGENDADAS':         return feriasAgendadas(user, p);
    // [2026-10-29] envio ao financeiro por departamento (FeriasFinanceiro.js)
    case 'FERIAS.FINANCEIRO_SALVAR':       return feriasFinanceiroSalvar(user, p);
    case 'FERIAS.FINANCEIRO_IMPORTAR_BI':  return feriasFinanceiroImportarBI(user, p);
    case 'FERIAS.FINANCEIRO_ENVIAR_DEPTO': return feriasFinanceiroEnviarDepto(user, p);
    case 'FERIAS.FINANCEIRO_LER_ARQUIVO':  return feriasFinanceiroLerArquivo(user, p);   // [2026-11-03] arquivo bancário preenche valor e conta
    case 'FERIAS.ELEGIVEIS_FIM_DE_ANO': return feriasElegiveisFimDeAno(user, p);
    case 'FERIAS.AGENDADOS_FIM_DE_ANO': return feriasAgendadosFimDeAno(user, p);
    case 'FERIAS.AGENDAR_FIM_DE_ANO':   return feriasAgendarFimDeAno(user, p);
    case 'FERIAS.BUSCAR_COLABORADOR':   return feriasBuscarColaborador(user, p);
    default: throw new Error('Ação de férias desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  ACESSO ÀS PLANILHAS                                                                          */
/* ============================================================================================ */

/**
 * [PERF] Tudo aqui é memoizado POR EXECUÇÃO.
 * Cada SpreadsheetApp.openById() e cada getRange().getValues() é uma ida à rede.
 * Sem memo, _feriasParam_ sozinho abria a planilha ~900 vezes (uma por período).
 */
var _SS_FERIAS_ = null;
var _SH_FERIAS_ = {};
var _PARAMS_ = null;

function _ssFerias_() {
  if (!_SS_FERIAS_) _SS_FERIAS_ = SpreadsheetApp.openById(FERIAS.SHEET_ID);
  return _SS_FERIAS_;
}

function _shFerias_(nome) {
  if (!_SH_FERIAS_[nome]) _SH_FERIAS_[nome] = _ssFerias_().getSheetByName(nome);
  return _SH_FERIAS_[nome];
}

function _paramsTabela_() {
  if (_PARAMS_) return _PARAMS_;

  _PARAMS_ = {};

  _sheetToObjects_(_shFerias_(FERIAS.ABAS.PARAMETROS)).forEach(r => {
    const k = String(r.CHAVE || '').toUpperCase().trim();
    if (k) _PARAMS_[k] = r.VALOR;
  });

  return _PARAMS_;
}

function _feriasParam_(chave, padrao) {
  const v = _paramsTabela_()[String(chave).toUpperCase().trim()];

  if (v === '' || v === null || v === undefined) return padrao;

  return v;
}

/**
 * Escreve/atualiza um parâmetro na aba PARAMETROS da DP360_FERIAS.
 * Usado pelos módulos para guardar configuração (ex.: pasta do Drive dos afastamentos).
 */
function _setFeriasParam_(chave, valor) {
  chave = String(chave).toUpperCase().trim();

  const sh = _shFerias_(FERIAS.ABAS.PARAMETROS);
  const h = _headers_(sh);
  const iChave = h.indexOf('CHAVE');
  const iValor = h.indexOf('VALOR');

  if (iChave === -1 || iValor === -1) {
    throw new Error('A aba PARAMETROS precisa ter as colunas CHAVE e VALOR.');
  }

  const existente = _sheetToObjects_(sh).find(r => String(r.CHAVE).toUpperCase().trim() === chave);

  if (existente) {
    sh.getRange(existente._rowNumber, iValor + 1).setValue(valor);
  } else {
    const linha = [];
    linha[iChave] = chave;
    linha[iValor] = valor;
    sh.appendRow(linha);
  }

  _PARAMS_ = null;    // invalida o cache de parâmetros (era _TABELAS_ errado)
  _TABELAS_ = null;
  // [2026-09-24] Parâmetros entram nos cálculos (ex.: teto do mês no painel do DP): troca o
  // selo para os caches entre execuções não servirem o valor antigo.
  _novoSeloFerias_();
  return valor;
}

/* ---- cache entre execuções (CacheService) ---- */

function _chaveCtx_(email, visao) {
  return 'FCTX_' + Utilities.base64EncodeWebSafe(_normalizarEmail_(email) + '|' + visao).replace(/=+$/, '');
}

/** CacheService aceita 100KB por chave. Contextos maiores são partidos em pedaços. */
function _cachePut_(chave, obj) {
  const cache = CacheService.getScriptCache();
  const txt = JSON.stringify(obj);
  const TAM = 90000;

  try {
    if (txt.length <= TAM) {
      cache.put(chave, txt, FERIAS.CTX_CACHE_SEG);
      cache.put(chave + '_n', '1', FERIAS.CTX_CACHE_SEG);
      return;
    }

    const partes = Math.ceil(txt.length / TAM);
    if (partes > 20) return;   // >1,8MB: aí é a visão global, que não usa este cache

    const mapa = {};
    for (let i = 0; i < partes; i++) mapa[chave + '_' + i] = txt.substr(i * TAM, TAM);

    mapa[chave + '_n'] = String(partes);
    cache.putAll(mapa, FERIAS.CTX_CACHE_SEG);
  } catch (e) { /* cache é otimização: falhar aqui não pode quebrar nada */ }
}

function _cacheGet_(chave) {
  const cache = CacheService.getScriptCache();

  try {
    const n = Number(cache.get(chave + '_n') || 0);
    if (!n) return null;

    if (n === 1) {
      const t = cache.get(chave);
      return t ? JSON.parse(t) : null;
    }

    const chaves = [];
    for (let i = 0; i < n; i++) chaves.push(chave + '_' + i);

    const partes = cache.getAll(chaves);
    let txt = '';

    for (let i = 0; i < n; i++) {
      if (!partes[chave + '_' + i]) return null;   // pedaço expirou: descarta tudo
      txt += partes[chave + '_' + i];
    }

    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

/**
 * Toda escrita muda os dados de TODOS os gestores em potencial.
 * Em vez de rastrear quem invalidar, usamos um selo de versão:
 * a chave do cache carrega o selo, e mudar o selo aposenta o cache inteiro.
 */
function _seloFerias_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('FERIAS_SELO');

  if (!s) {
    s = String(Date.now());
    props.setProperty('FERIAS_SELO', s);
  }

  return s;
}

function _novoSeloFerias_() {
  PropertiesService.getScriptProperties().setProperty('FERIAS_SELO', String(Date.now()));
}

/** Zera todos os caches em memória. Chamado após qualquer escrita. */
function _invalidarCacheFerias_() {
  _SS_FERIAS_ = null;
  _SS_MASTER_ = null;
  _SS_AFAST_ = null;
  _SH_FERIAS_ = {};
  _PARAMS_ = null;
  _CACHE_HISTORICO_ = null;
  Cadastro.limparCache();
  _CACHE_AFAST_ = null;
  _CACHE_COLAB_POR_ID_ = null;
  _CACHE_PERIODOS_ = null;
  _CACHE_SOLICITACOES_ = null;
  _CACHE_FIMDEANO_ = null;
  _IDX_SOL_REF_ = null;
  _IDX_SOL_POR_PERIODO_ = null;
  _TABELAS_ = null;

  // aposenta o cache entre execuções (o contexto de todo mundo pode ter mudado)
  _novoSeloFerias_();
}

// [PERF] Cache por execução — sem isso, cada chamada relia a planilha inteira do zero.
// Como periodos/solicitacoes são chamadas várias vezes dentro da mesma requisição
// (contexto, painel, calendário...), isso evita reler 2000+ linhas repetidas vezes.
var _CACHE_PERIODOS_ = null;
var _CACHE_SOLICITACOES_ = null;
var _CACHE_FIMDEANO_ = null;

function _periodos_() {
  if (_CACHE_PERIODOS_) return _CACHE_PERIODOS_;
  _CACHE_PERIODOS_ = _sheetToObjects_(_shFerias_(FERIAS.ABAS.PERIODOS));
  return _CACHE_PERIODOS_;
}

function _solicitacoes_() {
  if (_CACHE_SOLICITACOES_) return _CACHE_SOLICITACOES_;
  _CACHE_SOLICITACOES_ = _sheetToObjects_(_shFerias_(FERIAS.ABAS.SOLICITACOES));
  return _CACHE_SOLICITACOES_;
}

/**
 * Espelhamento da campanha de fim de ano: lê a aba FIM_DE_ANO da DP360_FERIAS e devolve a
 * lista de matrículas elegíveis (curada pelo DP). Se a aba não existir ou estiver vazia, cai
 * na lista chumbada FERIAS.FIM_DE_ANO_MATRICULAS_PERMITIDAS (não quebra nada).
 * As REGRAS (14 dias, opção 1/2, dia de início) continuam no código — isto é só "quem participa".
 */
function _normalizarCabecalhoFimDeAno_(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function _linhaFimDeAnoNormalizada_(linha) {
  const out = {};
  Object.keys(linha || {}).forEach(function (cabecalho) {
    const chave = _normalizarCabecalhoFimDeAno_(cabecalho);
    if (chave && out[chave] === undefined) out[chave] = linha[cabecalho];
  });
  return out;
}

function _flagFimDeAnoAtiva_(valor) {
  if (valor === true || valor === 1) return true;
  const flag = String(valor === null || valor === undefined ? '' : valor).trim().toUpperCase();
  return ['SIM', 'S', 'TRUE', 'VERDADEIRO', '1', 'X'].indexOf(flag) > -1;
}

function _fimDeAnoMatriculasPermitidas_() {
  if (_CACHE_FIMDEANO_) return _CACHE_FIMDEANO_;

  var lista = [];
  try {
    var sh = _shFerias_(FERIAS.ABAS.FIM_DE_ANO);
    if (sh) {
      _sheetToObjects_(sh).forEach(function (r) {
        var linha = _linhaFimDeAnoNormalizada_(r);
        var m = _normalizarMatricula_(linha.MATRICULA);
        if (!m) return;
        // Se houver coluna de flag (FIM_DE_ANO/ELEGIVEL), respeita; senão, cada linha já é elegível.
        var temFlag = linha.FIM_DE_ANO !== undefined || linha.ELEGIVEL !== undefined;
        var flag = linha.FIM_DE_ANO !== undefined ? linha.FIM_DE_ANO : linha.ELEGIVEL;
        if (!temFlag || _flagFimDeAnoAtiva_(flag)) lista.push(m);
      });
    }
  } catch (e) {
    lista = [];
  }

  if (!lista.length) {
    lista = (FERIAS.FIM_DE_ANO_MATRICULAS_PERMITIDAS || []).map(_normalizarMatricula_);
  }

  const unicas = {};
  lista.forEach(function (matricula) {
    matricula = _normalizarMatricula_(matricula);
    if (matricula) unicas[matricula] = true;
  });

  _CACHE_FIMDEANO_ = Object.keys(unicas);
  return _CACHE_FIMDEANO_;
}

/** Diagnostico somente leitura da correspondencia entre a equipe da Mariana e a lista anual. */
function diagnosticarMatriculasFimDeAnoMariana() {
  const resolucao = _resolverEquipeFeriasPorNomes_(
    _rosterAtivoFerias_(),
    FERIAS_EQUIPE_MARIANA_NOMES
  );
  const permitidas = {};
  _fimDeAnoMatriculasPermitidas_().forEach(m => { permitidas[m] = true; });

  const pessoas = resolucao.pessoas.map(function (pessoa) {
    const normalizada = _normalizarMatricula_(pessoa.matricula);
    return {
      id: pessoa.id,
      nome: pessoa.nome,
      matriculaOriginal: pessoa.matricula,
      matriculaNormalizada: normalizada,
      constaNaLista: !!permitidas[normalizada]
    };
  });

  const out = {
    ok: true,
    totalEquipe: pessoas.length,
    totalMatriculasPermitidas: Object.keys(permitidas).length,
    totalDaEquipeNaLista: pessoas.filter(p => p.constaNaLista).length,
    pessoas: pessoas
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/** Testes puros dos aliases de cabecalho e flags; nao acessa planilhas nem propriedades. */
function testarLeituraMatriculasFimDeAnoMock() {
  const casos = [
    { linha: { 'MATRICULA': '001234.0', 'ELEGIVEL': 'SIM' }, matricula: '1234', ativa: true },
    { linha: { 'MATR\u00cdCULA': "'001.234", 'ELEG\u00cdVEL': 'X' }, matricula: '1234', ativa: true },
    { linha: { 'matricula ': '001234,0', 'fim de ano': false }, matricula: '1234', ativa: false },
    { linha: { 'Matr\u00edcula': '1 234' }, matricula: '1234', ativa: true }
  ];

  casos.forEach(function (caso, i) {
    const linha = _linhaFimDeAnoNormalizada_(caso.linha);
    const matricula = _normalizarMatricula_(linha.MATRICULA);
    const temFlag = linha.FIM_DE_ANO !== undefined || linha.ELEGIVEL !== undefined;
    const flag = linha.FIM_DE_ANO !== undefined ? linha.FIM_DE_ANO : linha.ELEGIVEL;
    const ativa = !temFlag || _flagFimDeAnoAtiva_(flag);
    if (matricula !== caso.matricula || ativa !== caso.ativa) {
      throw new Error('Falha no caso ' + (i + 1) + ' da leitura de matriculas de fim de ano.');
    }
  });

  return { ok: true, totalCasos: casos.length };
}

/**
 * Cria as colunas de controle do abono no fim da aba PERIODOS. Rode UMA vez.
 * Colunas novas sempre vão para o fim: não deslocam nada que já existe.
 */
function garantirColunasAbono() {
  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  let h = _headers_(sh);

  const faltando = FERIAS.COLUNAS_ABONO.filter(c => h.indexOf(c) === -1);

  if (!faltando.length) return 'Colunas de abono já existem.';

  let col = sh.getLastColumn();

  if (sh.getMaxColumns() < col + faltando.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), col + faltando.length - sh.getMaxColumns());
  }

  faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));

  _invalidarCacheFerias_();

  const msg = 'Colunas criadas na aba PERIODOS: ' + faltando.join(', ') + '.';
  _auditar_('FERIAS_COLUNAS_ABONO', '', 'garantirColunasAbono', true, msg, {});
  console.log(msg);
  return msg;
}

/**
 * Cria as colunas de controle do envio ao financeiro no fim da aba SOLICITACOES. Rode UMA vez.
 */
function garantirColunasFinanceiro() {
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  let h = _headers_(sh);

  const faltando = FERIAS.COLUNAS_FINANCEIRO.filter(c => h.indexOf(c) === -1);

  if (!faltando.length) return 'Colunas do financeiro já existem.';

  let col = sh.getLastColumn();

  if (sh.getMaxColumns() < col + faltando.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), col + faltando.length - sh.getMaxColumns());
  }

  faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));

  _invalidarCacheFerias_();

  const msg = 'Colunas criadas na aba SOLICITACOES: ' + faltando.join(', ') + '.';
  console.log(msg);
  return msg;
}

/**
 * FERIAS.ENVIAR_FINANCEIRO, o DP marca que mandou a solicitação deferida pro financeiro,
 * opcionalmente anexando o documento. Congela a data de vencimento do pagamento no momento
 * do envio (pra medir antecedência depois, mesmo que o cálculo de dias úteis mude no futuro).
 * payload: { idSolicitacao, arquivoBase64?, arquivoNome?, arquivoTipo? }
 */
/**
 * FERIAS.ENVIAR_FINANCEIRO_LOTE — o DP escolhe manualmente quais solicitações (já deferidas)
 * fazem parte do mesmo envio ao financeiro, anexa UM arquivo (que pode cobrir várias pessoas),
 * e o sistema manda UM e-mail consolidado cobrindo exatamente esse grupo. Substitui o antigo
 * fluxo de "um clique por pessoa" — agora quem decide o agrupamento é o DP, não uma regra
 * automática de departamento/data.
 * payload: { ids: [idSolicitacao, ...], arquivoBase64, arquivoNome, arquivoTipo }
 */
function feriasEnviarFinanceiroLote(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Apenas o Departamento Pessoal pode enviar ao financeiro.');

  const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
  if (!ids.length) throw new Error('Selecione pelo menos uma solicitação.');

  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);

  if (h.indexOf('ENVIADO_FINANCEIRO_EM') === -1) {
    throw new Error('Rode garantirColunasFinanceiro() uma vez antes de usar esta função.');
  }

  const todas = _sheetToObjects_(sh);
  const selecionadas = ids.map(id => todas.find(x => String(x.ID_SOLICITACAO) === id)).filter(Boolean);

  if (selecionadas.length !== ids.length) {
    throw new Error('Alguma solicitação selecionada não foi encontrada (pode já ter sido cancelada).');
  }

  const foraDoDeferido = selecionadas.filter(s => String(s.STATUS).toUpperCase() !== 'DEFERIDA');
  if (foraDoDeferido.length) {
    throw new Error('Só é possível enviar solicitações já deferidas. Fora do padrão: ' +
      foraDoDeferido.map(s => s.NOME).join(', '));
  }

  // Aceita um ou mais arquivos (ex.: arquivo bancário + aviso de férias).
  const arquivos = Array.isArray(p.arquivos) ? p.arquivos
    : (p.arquivoBase64 ? [{ base64: p.arquivoBase64, nome: p.arquivoNome, tipo: p.arquivoTipo }] : []);

  const links = [];
  const blobsParaAnexar = [];

  arquivos.forEach((arq, i) => {
    if (!arq || !arq.base64) return;

    const bytes = Utilities.base64Decode(arq.base64);
    const nomeArquivo = arq.nome ||
      ('ferias_lote_' + Utilities.formatDate(new Date(), DP360.FUSO, 'yyyyMMdd_HHmmss') + '_' + (i + 1) + '.pdf');
    const blob = Utilities.newBlob(bytes, arq.tipo || 'application/pdf', nomeArquivo);

    blobsParaAnexar.push(blob); // vai anexado de verdade no e-mail

    try {
      // arquiva no Drive também, como registro (o e-mail já leva o anexo real)
      const raizId = _feriasParam_('FINANCEIRO_DRIVE_PASTA_ID', '');
      const arquivo = raizId ? DriveApp.getFolderById(raizId).createFile(blob) : DriveApp.createFile(blob);
      links.push({ nome: arquivo.getName(), url: arquivo.getUrl() });
    } catch (e) {
      console.error('Falha ao arquivar um dos documentos no Drive (segue só como anexo do e-mail): ' + e);
    }
  });

  // Mantém compatibilidade: DOCUMENTO_FINANCEIRO_LINK grava o primeiro link (a coluna é
  // só um resumo pra listagem); os links completos vão todos no corpo do e-mail.
  const link = links.length ? links[0].url : '';

  const uteisAntes = Number(_feriasParam_('DIAS_UTEIS_PAGAMENTO_ANTES', 2));
  const minima = Number(_feriasParam_('FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS', FERIAS.FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS));
  const agora = new Date();

  let algumForaDoPrazo = false;
  const resumo = []; // { nome, vencimento(Date) } — pra montar o e-mail sem reler a planilha

  selecionadas.forEach(s => {
    const inicio = _dataF_(s.DATA_INICIO);
    let vencimento = inicio ? _subtrairUteis_(inicio, uteisAntes) : null;

    // O financeiro não paga sexta, sábado nem domingo — se cair num desses dias,
    // antecipa pro dia útil anterior.
    if (vencimento) {
      while ([0, 5, 6].indexOf(vencimento.getDay()) > -1) { // dom=0, sex=5, sáb=6
        vencimento = _addDiasF_(vencimento, -1);
      }
    }

    _atualizarLinha_(sh, s._rowNumber, h, {
      ENVIADO_FINANCEIRO_EM: agora,
      ENVIADO_FINANCEIRO_POR: _normalizarEmail_(user.EMAIL),
      DOCUMENTO_FINANCEIRO_LINK: link,
      VENCIMENTO_PAGAMENTO: vencimento
    });

    const antecedenciaDias = vencimento ? Math.round((vencimento - agora) / 86400000) : null;
    if (antecedenciaDias !== null && antecedenciaDias < minima) algumForaDoPrazo = true;

    resumo.push({ nome: s.NOME, vencimento: vencimento });
  });

  _invalidarCacheFerias_();

  _auditar_('FERIAS_ENVIADO_FINANCEIRO_LOTE', user.EMAIL, 'FERIAS.ENVIAR_FINANCEIRO_LOTE', true,
    selecionadas.length + ' solicitação(ões) enviada(s) ao financeiro em lote' +
    (algumForaDoPrazo ? ' (ALGUMA FORA DO PRAZO MÍNIMO)' : ''),
    { ids: ids });

  const emailFinanceiro = _feriasParam_('EMAIL_FINANCEIRO', '');
  if (emailFinanceiro) {
    // se todo mundo tem o mesmo vencimento, mostra uma data só no topo; senão, mostra
    // o vencimento de cada um na própria linha.
    const vencimentosUnicos = {};
    resumo.forEach(r => { if (r.vencimento) vencimentosUnicos[_isoF_(r.vencimento)] = true; });
    const mesmoVencimento = Object.keys(vencimentosUnicos).length === 1;
    const vencimentoTopo = mesmoVencimento ? _dataF_(Object.keys(vencimentosUnicos)[0]) : null;

    const linhasNomes = resumo.map(r =>
      '<li>' + _escapeHtml_(r.nome) + (mesmoVencimento ? '' : ' — vencimento ' + _fmtBRF_(r.vencimento)) + '</li>'
    ).join('');

    const corpo =
      '<p>Seguem as férias deferidas para pagamento, neste mesmo envio.</p>' +
      _quadro_([
        ['Total de pessoas', String(resumo.length)],
        ['Vencimento do pagamento', mesmoVencimento ? _fmtBRF_(vencimentoTopo) : 'Ver por pessoa abaixo']
      ]) +
      '<ul style="line-height:1.9;font-size:13.5px">' + linhasNomes + '</ul>' +
      (blobsParaAnexar.length
        ? '<p style="font-size:13px;color:#6b7c81">📎 ' + blobsParaAnexar.length + ' arquivo(s) anexado(s) a este e-mail.</p>' : '') +
      (algumForaDoPrazo
        ? '<p style="font-size:13px;color:#b3261e">⚠️ Pelo menos uma pessoa deste envio está com menos de ' +
          minima + ' dia(s) de antecedência do vencimento.</p>' : '');

    const assuntoVenc = mesmoVencimento ? ('vencimento ' + _fmtBRF_(vencimentoTopo)) : (resumo.length + ' pessoa(s)');
    _enviar_(emailFinanceiro, 'Férias para pagamento, ' + assuntoVenc,
      _moldura_('Férias para pagamento', corpo, '', false), blobsParaAnexar);
  }

  return {
    ok: true,
    enviados: resumo.length,
    algumForaDoPrazo: algumForaDoPrazo,
    mensagem: resumo.length + ' solicitação(ões) enviada(s) ao financeiro.' +
      (algumForaDoPrazo ? ' Atenção: pelo menos uma está com menos de ' + minima + ' dia(s) de antecedência.' : '')
  };
}

/**
 * FERIAS.AGENDADAS, o painel de acompanhamento: toda solicitação DEFERIDA, com o status
 * do envio ao financeiro. payload: { competencia? } (MM/AAAA, opcional)
 */
function feriasAgendadas(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Esta área é do Departamento Pessoal.');

  const minima = Number(_feriasParam_('FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS', FERIAS.FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS));
  const hoje = _hojeFerias_();

  let lista = _solicitacoes_().filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA');

  if (p && p.competencia) {
    const partes = String(p.competencia).split('/');
    const mm = partes[0], yyyy = partes[1];
    lista = lista.filter(s => {
      const ini = _dataF_(s.DATA_INICIO);
      return ini && ini.getMonth() + 1 === Number(mm) && ini.getFullYear() === Number(yyyy);
    });
  }

  // [2026-10-29] recibos da pasta FÉRIAS (para o envio por departamento); se o Drive falhar, a lista sai sem eles
  let idxRecibos = {};
  try { idxRecibos = _ferfinIndiceRecibos_(); } catch (e) { console.error('feriasAgendadas: recibos: ' + e); }

  const agendadas = lista.map(s => {
    const inicio = _dataF_(s.DATA_INICIO);
    const enviadoEm = _dataF_(s.ENVIADO_FINANCEIRO_EM);
    // [2026-10-29] quem não foi enviado usa a regra nova de pagamento (seg/ter → quinta anterior; qua → segunda)
    const vencimento = _dataF_(s.VENCIMENTO_PAGAMENTO) || (inicio ? _ferfinDataPagamento_(inicio).data : null);

    const antecedenciaDias = (enviadoEm && vencimento) ? Math.round((vencimento - enviadoEm) / 86400000) : null;

    return {
      id: s.ID_SOLICITACAO,
      idColaborador: s.ID_COLABORADOR,
      nome: s.NOME,
      departamento: (_colaboradorPorId_(s.ID_COLABORADOR) || {}).DEPARTAMENTO_ATUAL || '',
      inicio: _isoF_(s.DATA_INICIO),
      fim: _isoF_(s.DATA_FIM),
      dias: Number(s.DIAS || 0),
      abono: Number(s.ABONO || 0),
      custoPrevisto: Number(s.CUSTO_PREVISTO || 0),
      decididoEm: _isoF_(s.DECIDIDO_EM),
      vencimentoPagamento: vencimento ? _isoF_(vencimento) : '',
      enviadoFinanceiro: !!enviadoEm,
      enviadoFinanceiroEm: enviadoEm ? _isoF_(enviadoEm) : '',
      enviadoFinanceiroPor: s.ENVIADO_FINANCEIRO_POR || '',
      documentoLink: s.DOCUMENTO_FINANCEIRO_LINK || '',
      antecedenciaDias: antecedenciaDias,
      dentroDoPrazo: antecedenciaDias === null ? null : antecedenciaDias >= minima,
      precisaEnviar: !enviadoEm && vencimento && vencimento >= hoje,
      financeiro: _ferfinDadosItem_(s, idxRecibos)
    };
  }).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));

  return {
    ok: true,
    total: agendadas.length,
    pendentesDeEnvio: agendadas.filter(a => !a.enviadoFinanceiro).length,
    agendadas: agendadas
  };
}

/**
 * FERIAS.SOLICITAR_ABONO, o GESTOR registra o pedido do colaborador.
 * Só funciona enquanto o período aquisitivo está em curso e dentro do prazo legal.
 * O pedido fica SOLICITADO até o DP confirmar.
 *
 * payload: { idPeriodo, dias }
 */
/**
 * FERIAS.ABONO_EM_CURSO_GLOBAL — versão leve, só pro DP, que lista quem está com período em
 * curso (elegível pra pedir venda de dias) EM TODA A EMPRESA. Diferente de FERIAS.CONTEXTO com
 * visao GLOBAL, não monta o contexto completo de ninguém (custo/saldo/urgência de cada período),
 * então não esbarra no limite de segurança da visão global pesada.
 */
function feriasAbonoEmCursoGlobal(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Esta área é do Departamento Pessoal.');

  const prazoDias = Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', FERIAS.ABONO_PRAZO_ANTES_FIM_AQUIS));
  const abonoMaxPadrao = Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS));
  const hojeF = _hojeFerias_();

  const emCurso = _periodos_()
    .filter(x => String(x.STATUS || '').toUpperCase() === 'EM_CURSO')
    .filter(x => !_semDireitoAFerias_(_colaboradorPorId_(x.ID_COLABORADOR)))
    .map(x => {
      const fimAquis = _dataF_(x.AQUIS_FIM);
      const limite = fimAquis ? _addDiasF_(fimAquis, -prazoDias) : null;
      const noPrazo = limite ? (hojeF <= limite) : false;
      const st = String(x.ABONO_STATUS || '').toUpperCase();

      return {
        idPeriodo: x.ID_PERIODO,
        idColaborador: _idColaboradorFerias_(x.ID_COLABORADOR),
        nome: (rosterPorId[_idColaboradorFerias_(x.ID_COLABORADOR)] || {}).NOME || x.NOME,
        periodoAquisitivo: _fmtBRF_(x.AQUIS_INICIO) + ' a ' + _fmtBRF_(fimAquis),
        fimAquisitivo: _fmtBRF_(fimAquis),
        prazoPedido: limite ? _fmtBRF_(limite) : '',
        diasAteOPrazo: limite ? Math.round((limite - hojeF) / 86400000) : null,
        noPrazo: noPrazo,
        maximoDias: Math.min(abonoMaxPadrao, Math.floor(Number(x.DIAS_DIREITO || 30) / 3)),
        status: st || 'NAO_PEDIDO',
        diasPedidos: Number(x.ABONO_DIAS_PEDIDOS || 0),
        podePedir: noPrazo && !st
      };
    })
    .filter(x => x.noPrazo || x.status === 'SOLICITADO' || x.status === 'LIBERADO')
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return { ok: true, abonoEmCurso: emCurso };
}

function feriasSolicitarAbono(user, p) {
  const idPeriodo = String(p.idPeriodo || '').trim();
  const dias = Math.floor(Number(p.dias || 0));

  if (!idPeriodo) throw new Error('Período não informado.');
  if (dias < 1) throw new Error('Informe quantos dias o colaborador quer vender.');

  _invalidarCacheFerias_();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
    const h = _headers_(sh);

    if (h.indexOf('ABONO_STATUS') === -1) {
      throw new Error('Rode garantirColunasAbono() uma vez antes de usar esta função.');
    }

    const periodo = _sheetToObjects_(sh).find(x => String(x.ID_PERIODO) === idPeriodo);
    if (!periodo) throw new Error('Período não encontrado.');

    // Escopo: gestor só pede para a própria equipe.
    if (String(user.PERFIL).toUpperCase() === 'GESTOR') {
      const equipe = _equipeDoGestor_(user.EMAIL);
      if (equipe.indexOf(String(periodo.ID_COLABORADOR)) === -1) {
        throw new Error('Este colaborador não está na sua equipe.');
      }
    }

    const st = String(periodo.ABONO_STATUS || '').toUpperCase();

    if (st === 'SOLICITADO') throw new Error('Já existe um pedido de venda de dias em análise para este período.');
    if (st === 'LIBERADO') throw new Error('A venda de dias já está liberada para este período.');

    // Prazo legal (art. 143 §1º): até 15 dias antes do fim do período aquisitivo.
    const fimAquis = _dataF_(periodo.AQUIS_FIM);
    const prazo = Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', FERIAS.ABONO_PRAZO_ANTES_FIM_AQUIS));
    const limite = fimAquis ? _addDiasF_(fimAquis, -prazo) : null;

    if (!limite || _hojeFerias_() > limite) {
      throw new Error(
        'O prazo para pedir a venda de dias deste período terminou' +
        (limite ? ' em ' + _fmtBRF_(limite) : '') + '. ' +
        'A lei exige o pedido até ' + prazo + ' dias antes do fim do período aquisitivo (art. 143 §1º).'
      );
    }

    const maximo = Math.min(
      Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS)),
      Math.floor(Number(periodo.DIAS_DIREITO || 30) / 3)
    );

    if (dias > maximo) {
      throw new Error('O máximo permitido é ' + maximo + ' dias (um terço do período, art. 143).');
    }

    _atualizarLinha_(sh, periodo._rowNumber, h, {
      ABONO_STATUS: 'SOLICITADO',
      ABONO_DIAS_PEDIDOS: dias,
      ABONO_SOLICITADO_POR: _normalizarEmail_(user.EMAIL),
      ABONO_SOLICITADO_EM: new Date(),
      ABONO_PEDIDO_EM: _hojeFerias_()
    });

    _invalidarCacheFerias_();

    _auditar_('FERIAS_ABONO_SOLICITADO', user.EMAIL, 'FERIAS.SOLICITAR_ABONO', true,
      periodo.NOME + ': pedido de venda de ' + dias + ' dia(s), dentro do prazo.',
      { idPeriodo: idPeriodo, dias: dias });

    const colabLive = _colaboradorPorId_(periodo.ID_COLABORADOR) || {};
    _mailAbonoSolicitado_(user.EMAIL, colabLive.GESTOR_EMAIL || '', periodo.NOME, dias, limite,
      colabLive.DEPARTAMENTO_ATUAL || '');

    return {
      ok: true,
      status: 'SOLICITADO',
      mensagem: 'Pedido registrado! O Departamento Pessoal vai confirmar, e aí a venda de dias ' +
        'fica disponível quando as férias forem agendadas.'
    };

  } finally {
    lock.releaseLock();
  }
}

function _mailAbonoSolicitado_(registradoPor, gestorEmail, nome, dias, limite, departamento) {
  if (gestorEmail) {
    const corpo =
      '<p>Recebemos o pedido de <b>venda de dias de férias</b> (abono) e ele está dentro do prazo. 👍</p>' +
      _quadro_([
        ['Colaborador(a)', _escapeHtml_(nome)],
        ['Dias a vender', dias + ' dia(s)'],
        ['Prazo legal', 'até ' + _fmtBRF_(limite)]
      ]) +
      '<p>O Departamento Pessoal confere e registra. Depois disso, na hora de agendar as férias, ' +
      'a opção de vender dias já aparece liberada no portal para essa pessoa.</p>';

    _enviar_(gestorEmail, 'Pedido de venda de dias registrado, ' + nome,
      _moldura_('Pedido de abono recebido', corpo, '', false));
  }

  const portalDP = _portalDPUrl_();

  const corpoDP =
    '<p>Um pedido de venda de dias foi registrado, dentro do prazo legal.</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(nome)],
      ['Departamento', _escapeHtml_(departamento || ',')],
      ['Dias', dias + ' dia(s)'],
      ['Registrado por', _escapeHtml_(registradoPor)],
      ['Prazo legal', 'até ' + _fmtBRF_(limite)]
    ]) +
    '<p>Confirme no Portal do DP para liberar a opção no agendamento.</p>' +
    (portalDP ? '<p style="margin-top:22px"><a href="' + portalDP + '" style="color:#0E5A6B;font-weight:700">🔗 Abrir o Portal do DP</a></p>' : '');

  _enviar_(_emailDoDP_(), 'Pedido de venda de dias, ' + nome, _moldura_('Abono para confirmar', corpoDP, '', false));
}

/**
 * FERIAS.AUTORIZAR_ABONO, só DP/ADMIN.
 * Registra que o colaborador pediu a venda de dias, e quando.
 * payload: { idPeriodo, pedidoEm (yyyy-mm-dd), excecao (bool), justificativa }
 */
function feriasAutorizarAbono(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();

  if (perfil !== 'DP' && perfil !== 'ADMIN') {
    throw new Error('Apenas o Departamento Pessoal pode autorizar a venda de dias.');
  }

  const idPeriodo = String(p.idPeriodo || '').trim();
  if (!idPeriodo) throw new Error('Período não informado.');

  _invalidarCacheFerias_();

  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);

  if (h.indexOf('ABONO_AUTORIZADO') === -1) {
    throw new Error('Rode garantirColunasAbono() uma vez antes de usar esta função.');
  }

  const periodo = _sheetToObjects_(sh).find(x => String(x.ID_PERIODO) === idPeriodo);
  if (!periodo) throw new Error('Período não encontrado.');

  const pedidoEm = p.pedidoEm ? _dataF_(p.pedidoEm) : _hojeFerias_();
  const fimAquis = _dataF_(periodo.AQUIS_FIM);
  const prazo = Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', FERIAS.ABONO_PRAZO_ANTES_FIM_AQUIS));
  const limite = fimAquis ? _addDiasF_(fimAquis, -prazo) : null;

  const dentroDoPrazo = limite ? (pedidoEm <= limite) : false;
  const excecao = !!p.excecao;

  if (!dentroDoPrazo && !excecao) {
    throw new Error(
      'O pedido em ' + _fmtBRF_(pedidoEm) + ' está fora do prazo legal (art. 143 §1º: até ' +
      _fmtBRF_(limite) + '). Para autorizar mesmo assim, marque como EXCEÇÃO e justifique.'
    );
  }

  if (excecao && !String(p.justificativa || '').trim()) {
    throw new Error('Exceção exige justificativa.');
  }

  _atualizarLinha_(sh, periodo._rowNumber, h, {
    ABONO_STATUS: 'LIBERADO',
    ABONO_AUTORIZADO: 'Sim',
    ABONO_PEDIDO_EM: pedidoEm,
    ABONO_AUTORIZADO_POR: _normalizarEmail_(user.EMAIL),
    ABONO_EXCECAO: excecao ? 'Sim' : 'Não',
    ABONO_JUSTIFICATIVA: String(p.justificativa || '')
  });

  _invalidarCacheFerias_();

  _auditar_('FERIAS_ABONO_AUTORIZADO', user.EMAIL, 'FERIAS.AUTORIZAR_ABONO', true,
    periodo.NOME + ': venda de dias liberada' + (excecao ? ' POR EXCEÇÃO' : ' (pedido no prazo)') + '.',
    { idPeriodo: idPeriodo, pedidoEm: _isoF_(pedidoEm), excecao: excecao });

  return {
    ok: true,
    dentroDoPrazo: dentroDoPrazo,
    excecao: excecao,
    mensagem: 'Venda de dias liberada para ' + periodo.NOME +
      (excecao ? ' (exceção registrada).' : '.')
  };
}

/** Revoga a autorização de abono. */
function feriasRevogarAbono(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Apenas o DP pode revogar.');

  _invalidarCacheFerias_();

  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);
  const periodo = _sheetToObjects_(sh).find(x => String(x.ID_PERIODO) === String(p.idPeriodo));

  if (!periodo) throw new Error('Período não encontrado.');

  _atualizarLinha_(sh, periodo._rowNumber, h, {
    ABONO_STATUS: 'RECUSADO',
    ABONO_AUTORIZADO: 'Não',
    ABONO_JUSTIFICATIVA: String(p.justificativa || 'Autorização revogada pelo DP.')
  });

  _invalidarCacheFerias_();
  _auditar_('FERIAS_ABONO_REVOGADO', user.EMAIL, 'FERIAS.REVOGAR_ABONO', true, periodo.NOME, {});

  return { ok: true, mensagem: 'Autorização de venda de dias revogada.' };
}

/* ---- AFASTAMENTOS ---- */

var _SS_AFAST_ = null;
function _ssAfastamentos_() {
  if (!_SS_AFAST_) _SS_AFAST_ = SpreadsheetApp.openById(FERIAS.AFASTAMENTOS_ID);
  return _SS_AFAST_;
}

/**
 * Lê a DP360_AFASTAMENTOS e devolve, por colaborador:
 *   { reinicia: [ {inicio, retorno, dias, tipo} ], congela: [...], emAberto: bool }
 * A regra vem da aba TIPOS, se o DP mudar a regra lá, o código obedece.
 */
var _CACHE_AFAST_ = null;

function _afastamentosPorColaborador_() {
  if (_CACHE_AFAST_) return _CACHE_AFAST_;

  // ⚠️ Antes lia a aba antiga 'AFASTAMENTOS', que ninguém mais alimenta, o módulo de
  // Afastamentos (Fatia 1+2, usado pelo Portal/DP) grava tudo em 'OCORRENCIAS'.
  // Por isso os períodos aquisitivos nunca reconheciam afastamentos reais.
  const sh = _ssAfastamentos_().getSheetByName('OCORRENCIAS');
  const mapa = {};

  // CLT art. 133, IV: mais de 6 meses (180 dias) de afastamento no período aquisitivo faz
  // perder o direito e reinicia a contagem a partir do retorno. Até 6 meses, só congela
  // (suspende a contagem, mas não reinicia). Calculado pela duração real, não depende de
  // nenhuma coluna de "tipo" pré-marcada, que pode não existir com esse nome na sua planilha.
  const LIMITE_REINICIA_DIAS = 180;

  if (sh) {
    _sheetToObjects_(sh).forEach(a => {
      const id = String(a.ID_COLABORADOR || '');
      if (!id) return;

      if (!mapa[id]) mapa[id] = { reinicia: [], congela: [], emAberto: false };

      const status = String(a.STATUS || '').toUpperCase();
      const emAberto = status !== '' && status !== 'ENCERRADO';
      if (emAberto) mapa[id].emAberto = true;

      const dIni = _dataF_(a.DATA_INICIO);
      // tolerante ao nome do campo de retorno, pega o que existir
      const dFimPrevisto = _dataF_(a.DATA_RETORNO || a.DATA_FIM_PREVISTA);
      const dFimEfetivo = dFimPrevisto || (emAberto ? _hojeFerias_() : null);

      if (!dIni) return;

      const dias = dFimEfetivo ? Math.round((dFimEfetivo - dIni) / 86400000) + 1 : Number(a.DIAS || 0);

      const reg = {
        tipo: a.TIPO || a.TIPO_COD || '',
        inicio: _isoF_(dIni),
        retorno: dFimPrevisto ? _isoF_(dFimPrevisto) : '',
        dias: dias,
        emAberto: emAberto
      };

      if (dias > LIMITE_REINICIA_DIAS) mapa[id].reinicia.push(reg);
      else mapa[id].congela.push(reg);
    });
  }

  // ⚠️ 31/07/2026: a aba 'OCORRENCIAS' está vazia — quem alimenta afastamento de verdade hoje
  // é a sincronização do Alterdata, que grava na aba 'AFASTAMENTOS' (ORIGEM=ALTERDATA_*).
  // Sem isto, ninguém em benefício/licença/aposentadoria por invalidez era reconhecido como
  // afastado, e o período aquisitivo seguia contando normalmente (bug real: fazia a
  // importação de férias aprovar pedidos de gente com benefício do INSS em curso).
  const shAlterdata = _ssAfastamentos_().getSheetByName('AFASTAMENTOS');
  if (shAlterdata) {
    _sheetToObjects_(shAlterdata).forEach(a => {
      const id = String(a.ID_COLABORADOR || '');
      if (!id) return;

      if (!mapa[id]) mapa[id] = { reinicia: [], congela: [], emAberto: false };

      const emAberto = /sim/i.test(a.EM_ABERTO);
      if (emAberto) mapa[id].emAberto = true;

      const dIni = _dataF_(a.DATA_INICIO);
      const dFimPrevisto = _dataF_(a.DATA_RETORNO || a.DATA_FIM_PREVISTA);
      const dFimEfetivo = dFimPrevisto || (emAberto ? _hojeFerias_() : null);
      if (!dIni) return;

      const dias = dFimEfetivo ? Math.round((dFimEfetivo - dIni) / 86400000) + 1 : Number(a.DIAS || 0);

      const reg = {
        tipo: a.TIPO || a.TIPO_COD || '',
        inicio: _isoF_(dIni),
        retorno: dFimPrevisto ? _isoF_(dFimPrevisto) : '',
        dias: dias,
        emAberto: emAberto
      };

      // O Alterdata já manda a classificação pronta (EFEITO_PERIODO); confiamos nela e só
      // caímos no critério de dias (mesma regra da OCORRENCIAS) quando ela vier vazia.
      const efeito = String(a.EFEITO_PERIODO || '').toUpperCase();
      if (efeito === 'REINICIA') mapa[id].reinicia.push(reg);
      else if (efeito === 'CONGELA') mapa[id].congela.push(reg);
      else if (dias > LIMITE_REINICIA_DIAS) mapa[id].reinicia.push(reg);
      else mapa[id].congela.push(reg);
    });
  }

  _CACHE_AFAST_ = mapa;
  return mapa;
}

/**
 * O período foi atingido por um afastamento?
 *   PERDIDO   → afastamento que reinicia, com sobreposição ao período (art. 133 IV)
 *   CONGELADO → afastamento que suspende o contrato e ainda está em aberto
 */
function _efeitoAfastamentoNoPeriodo_(periodo, afast) {
  const info = afast[String(periodo.ID_COLABORADOR)];
  if (!info) return null;

  const ini = _dataF_(periodo.AQUIS_INICIO);
  const fim = _dataF_(periodo.AQUIS_FIM);
  if (!ini || !fim) return null;

  function sobrepoe(a) {
    const aIni = _dataF_(a.inicio);
    if (!aIni) return false;
    const aFim = a.emAberto ? _hojeFerias_() : (_dataF_(a.retorno) || _hojeFerias_());
    return aIni <= fim && aFim >= ini;
  }

  const r = info.reinicia.filter(sobrepoe)[0];
  if (r) {
    return {
      status: 'PERDIDO',
      motivo: 'Afastamento (' + r.tipo + ') de ' + r.dias + ' dias no curso do período aquisitivo. ' +
              'CLT art. 133 IV: direito perdido; novo período conta do retorno.'
    };
  }

  const c = info.congela.filter(sobrepoe)[0];
  if (c) {
    return {
      status: 'CONGELADO',
      motivo: 'Contrato suspenso (' + c.tipo + '). O período aquisitivo para de correr até o retorno.'
    };
  }

  // Contrato SUSPENSO HOJE: mesmo que o período já estivesse adquirido, o gozo é impossível
  // e o prazo concessivo não corre. Sai do calendário operacional e vira passivo suspenso.
  const abertoAgora =
    info.reinicia.filter(a => a.emAberto)[0] || info.congela.filter(a => a.emAberto)[0];

  if (abertoAgora) {
    return {
      status: 'CONGELADO',
      motivo: 'Colaborador afastado desde ' + _fmtBRF_(_dataF_(abertoAgora.inicio)) +
              ' (' + abertoAgora.tipo + '). Contrato suspenso: gozo impossível e prazo concessivo ' +
              'não corre. Reavaliar no retorno.'
    };
  }

  return null;
}

/** O colaborador está afastado neste momento? */
function _estaAfastadoAgora_(idColaborador, afast) {
  const info = afast[String(idColaborador)];
  if (!info) return false;
  return !!info.emAberto;
}

/* O leitor de cadastro mudou de casa para o Cadastro.gs (porta única). Este atalho mantém os
   ~18 pontos que chamam _colaboradores_() funcionando sem alteração. Migração para
   Cadastro.todos() acontece módulo a módulo no passo (c). */
function _colaboradores_() {
  return Cadastro.todos();
}

/**
 * TESTE: busca rápida de colaboradores por nome ou matrícula, para a caixa de busca do
 * cabeçalho do Portal do DP. Só considera quem está ativo (mesma regra de
 * _colaboradorEstaAtivo_). Reaproveita o prefixo FERIAS.* de propósito — assim qualquer
 * perfil DP/ADMIN que já usa o portal já tem permissão, sem precisar semear módulo novo.
 */
function feriasBuscarColaborador(user, p) {
  const termo = _normalizarTextoBusca_(p && p.termo);
  if (!termo || termo.length < 2) return { ok: true, resultados: [] };

  const resultados = _colaboradores_()
    .filter(c => {
      const sit = String(c.SITUACAO || '').toUpperCase();
      if (sit.indexOf('DESLIGAD') > -1 || sit.indexOf('DEMITID') > -1 || sit.indexOf('INATIVO') > -1) return false;
      const alvo = _normalizarTextoBusca_(c.NOME) + ' ' + _normalizarTextoBusca_(c.MATRICULA);
      return alvo.indexOf(termo) > -1;
    })
    .slice(0, 8)
    .map(c => ({
      idColaborador: c.ID_COLABORADOR,
      nome: c.NOME,
      matricula: c.MATRICULA,
      departamento: c.DEPARTAMENTO_ATUAL || '',
      cargo: c.FUNCAO || ''
    }));

  return { ok: true, resultados: resultados };
}

function _normalizarTextoBusca_(s) {
  var baixo = String.fromCharCode(768);
  var alto = String.fromCharCode(879);
  var re = new RegExp('[' + baixo + '-' + alto + ']', 'g');
  return String(s || '').normalize('NFD').replace(re, '').trim().toLowerCase();
}

/**
 * [CENTRALIZAÇÃO] Consulta AO VIVO um colaborador na MASTER, por ID.
 * Use isto em vez de confiar em NOME/DEPARTAMENTO/EMPRESA/GESTOR_EMAIL/MATRICULA
 * copiados dentro de um período ou solicitação, aquela cópia é uma fotografia do
 * momento em que a linha foi criada e fica desatualizada se a MASTER mudar depois
 * (ex.: uma Movimentação de departamento ou de gestor).
 * Indexado uma vez por execução; invalidado junto com o resto do cache em _invalidarCacheFerias_.
 */
var _CACHE_COLAB_POR_ID_ = null;

function _colaboradorPorId_(id) {
  if (!_CACHE_COLAB_POR_ID_) {
    _CACHE_COLAB_POR_ID_ = {};
    _colaboradores_().forEach(c => { _CACHE_COLAB_POR_ID_[String(c.ID_COLABORADOR)] = c; });
  }
  return _CACHE_COLAB_POR_ID_[String(id)] || null;
}

/**
 * [PERF] Escopo do gestor.
 * A lista de IDs por gestor é pequena, muda pouco e é lida em TODA requisição.
 * Fica no CacheService por 30 min, evita reler as 1.293 linhas da MASTER a cada clique.
 * Se alguém trocar de gestor na MASTER, o efeito aparece em até 30 min
 * (ou na hora, chamando limparCacheEquipes()).
 */
function _equipeDoGestor_(email) {
  email = _normalizarEmail_(email);
  if (!email) return [];

  const cache = CacheService.getScriptCache();
  const chave = 'EQUIPE_' + Utilities.base64EncodeWebSafe(email).replace(/=+$/, '');

  const hit = cache.get(chave);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* segue e recalcula */ }
  }

  const ids = _colaboradores_()
    .filter(c => _normalizarEmail_(c.GESTOR_EMAIL) === email)
    .map(c => String(c.ID_COLABORADOR));

  try { cache.put(chave, JSON.stringify(ids), 1800); } catch (e) { /* lista grande demais: segue sem cache */ }

  return ids;
}

/**
 * Identificador canônico usado somente pelo contexto de Férias. A planilha pode devolver
 * matrículas/IDs como número ou texto; normalizar aqui impede que a mesma pessoa seja perdida
 * (ou contada duas vezes) por diferença de tipo e espaços acidentais.
 */
function _idColaboradorFerias_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

/** Departamento ao vivo do cadastro, com um rótulo estável para valores vazios. */
function _departamentoColaboradorFerias_(colaborador) {
  return String((colaborador && colaborador.DEPARTAMENTO_ATUAL) || '').trim() || '(sem departamento)';
}

/**
 * Roster ativo do MASTER para o contexto de Férias.
 *
 * - parte de pessoas, não de PERIODOS;
 * - elimina IDs vazios e duplicados (a última linha do MASTER é a fotografia vigente);
 * - usa a mesma regra central de desligamento já adotada pelo módulo;
 * - não filtra aprendiz aqui, pois o chamador precisa manter separadamente o tamanho real
 *   da equipe ativa e o roster exibível no agendamento de férias.
 */
function _rosterAtivoFerias_() {
  const porId = {};

  _colaboradores_().forEach(c => {
    const id = _idColaboradorFerias_(c.ID_COLABORADOR);
    if (id) porId[id] = c;
  });

  return Object.keys(porId)
    .map(id => porId[id])
    .filter(c => _colaboradorEstaAtivo_(c.ID_COLABORADOR));
}

/*
 * Exceção de escopo exclusiva do módulo Férias.
 *
 * A MASTER ainda não representa corretamente a equipe da Mariana. Não alteramos
 * _equipeDoGestor_ porque ele também protege Afastamentos, Rescisão, Movimentações e
 * Benefícios. Aqui, os nomes servem SOMENTE para resolver e validar uma vez os IDs
 * canônicos; o escopo usado nas requisições fica gravado em ScriptProperties.
 */
const FERIAS_EQUIPE_MARIANA_EMAIL = 'marianazenicola.rj@cieds.org.br';
const FERIAS_EQUIPE_MARIANA_PROP = 'FERIAS_EQUIPE_MARIANA_IDS_V1';
const FERIAS_EQUIPE_MARIANA_NOMES = [
  'WANGELA CAETANO DOS SANTOS',
  'JOSENILDO CORDEIRO DA SILVA',
  'ANA PAULA MACHADO QUEIROZ',
  'MARCELO LIMA GONCALVES',
  'KARLA CRISTINE DE CARVALHO',
  'PAULO GABRIEL FERREIRA MARTINS',
  'TAYNARA MONTEIRO DA SILVA',
  'DANIEL DE MOURA SAMPAIO',
  'MARIA CLARA OLIVEIRA MACHADO',
  'MARIA VITORIA MAURO DUARTE',
  'JESSICA OLIVEIRA DE SOUZA DIAS'
];

/** Normalização estrita para comparar nomes, tolerando acentos e espaços acidentais. */
function _normalizarNomeEquipeFerias_(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Resolve nomes contra um roster que o chamador já garantiu ser ATIVO.
 * Cada nome precisa apontar para exatamente uma pessoa e cada pessoa precisa ter ID.
 * Função pura para permitir teste com mocks, sem planilha nem ScriptProperties.
 */
function _resolverEquipeFeriasPorNomes_(rosterAtivo, nomesEsperados) {
  const roster = Array.isArray(rosterAtivo) ? rosterAtivo : [];
  const nomes = Array.isArray(nomesEsperados) ? nomesEsperados : [];
  const alvos = nomes.map(_normalizarNomeEquipeFerias_);

  if (!alvos.length || alvos.some(n => !n)) {
    throw new Error('Configuração da equipe de Férias sem nomes válidos.');
  }

  const alvosUnicos = {};
  alvos.forEach(n => { alvosUnicos[n] = (alvosUnicos[n] || 0) + 1; });
  const repetidosNaConfiguracao = Object.keys(alvosUnicos).filter(n => alvosUnicos[n] !== 1);
  if (repetidosNaConfiguracao.length) {
    throw new Error('Configuração da equipe de Férias possui nome repetido: ' + repetidosNaConfiguracao.join(', ') + '.');
  }

  const porNome = {};
  roster.forEach(c => {
    const nome = _normalizarNomeEquipeFerias_(c && c.NOME);
    if (!nome) return;
    if (!porNome[nome]) porNome[nome] = [];
    porNome[nome].push(c);
  });

  const problemas = [];
  const pessoas = [];

  alvos.forEach((nomeNormalizado, i) => {
    const candidatos = porNome[nomeNormalizado] || [];
    if (candidatos.length !== 1) {
      problemas.push(
        nomes[i] + ': ' + candidatos.length + ' correspondência(s) ativa(s)' +
        (candidatos.length
          ? ' [IDs ' + candidatos.map(c => _idColaboradorFerias_(c.ID_COLABORADOR) || '(vazio)').join(', ') + ']'
          : '')
      );
      return;
    }

    const c = candidatos[0];
    const id = _idColaboradorFerias_(c.ID_COLABORADOR);
    if (!id) {
      problemas.push(nomes[i] + ': colaborador sem ID_COLABORADOR.');
      return;
    }

    pessoas.push({
      id: id,
      nome: String(c.NOME || '').trim(),
      matricula: String(c.MATRICULA || '').trim(),
      email: _normalizarEmail_(c.EMAIL_INSTITUCIONAL || c.EMAIL || ''),
      gestorEmail: _normalizarEmail_(c.GESTOR_EMAIL || '')
    });
  });

  if (problemas.length) {
    throw new Error(
      'Equipe de Férias da Mariana não foi configurada: a resolução precisa ser única e completa. ' +
      problemas.join(' | ')
    );
  }

  const ids = pessoas.map(p => p.id);
  const idsUnicos = {};
  ids.forEach(id => { idsUnicos[id] = true; });
  if (Object.keys(idsUnicos).length !== nomes.length) {
    throw new Error('Equipe de Férias da Mariana possui IDs duplicados. Nenhuma configuração foi aplicada.');
  }

  return { ids: ids, pessoas: pessoas };
}

/**
 * Confere se os IDs persistidos ainda representam exatamente os 11 nomes no roster ATIVO.
 * Se alguém sair, trocar de ID ou surgir homônimo, falha fechado até reconfiguração explícita.
 */
function _validarIdsEquipeFeriasMariana_(idsArmazenados, rosterAtivo) {
  if (!Array.isArray(idsArmazenados)) {
    throw new Error('IDs persistidos da equipe de Férias da Mariana estão em formato inválido.');
  }

  const ids = idsArmazenados.map(_idColaboradorFerias_);
  const unicos = {};
  ids.forEach(id => { if (id) unicos[id] = true; });

  if (ids.length !== FERIAS_EQUIPE_MARIANA_NOMES.length ||
      Object.keys(unicos).length !== FERIAS_EQUIPE_MARIANA_NOMES.length) {
    throw new Error(
      'IDs persistidos da equipe de Férias da Mariana precisam conter exatamente ' +
      FERIAS_EQUIPE_MARIANA_NOMES.length + ' pessoas únicas.'
    );
  }

  const resolucaoAtual = _resolverEquipeFeriasPorNomes_(rosterAtivo, FERIAS_EQUIPE_MARIANA_NOMES);
  const atualOrdenado = resolucaoAtual.ids.slice().sort().join('|');
  const armazenadoOrdenado = ids.slice().sort().join('|');

  if (atualOrdenado !== armazenadoOrdenado) {
    throw new Error(
      'A equipe ativa da Mariana mudou desde a configuração. Rode diagnosticarEquipeFeriasMariana() ' +
      'e, depois de conferir os 11 nomes, reconfigurarEquipeFeriasMariana().'
    );
  }

  return resolucaoAtual;
}

function _payloadEquipeFeriasMariana_(resolucao, origem) {
  return {
    versao: 1,
    emailGestor: FERIAS_EQUIPE_MARIANA_EMAIL,
    ids: resolucao.ids.slice(),
    configuradoEm: new Date().toISOString(),
    origem: origem || 'resolucao_inicial'
  };
}

/**
 * Escopo canônico usado SOMENTE por Férias.
 * Demais gestores continuam exatamente na regra compartilhada de GESTOR_EMAIL.
 */
function _equipeFeriasDoGestor_(email) {
  email = _normalizarEmail_(email);
  if (email !== FERIAS_EQUIPE_MARIANA_EMAIL) return _equipeDoGestor_(email);

  const rosterAtivo = _rosterAtivoFerias_();
  const props = PropertiesService.getScriptProperties();
  const bruto = props.getProperty(FERIAS_EQUIPE_MARIANA_PROP);

  if (!bruto) {
    // Só persiste depois que os 11 nomes forem resolvidos de forma única e completa.
    const resolucaoInicial = _resolverEquipeFeriasPorNomes_(rosterAtivo, FERIAS_EQUIPE_MARIANA_NOMES);
    props.setProperty(
      FERIAS_EQUIPE_MARIANA_PROP,
      JSON.stringify(_payloadEquipeFeriasMariana_(resolucaoInicial, 'resolucao_inicial'))
    );
    return resolucaoInicial.ids.slice();
  }

  let salvo;
  try {
    salvo = JSON.parse(bruto);
  } catch (e) {
    throw new Error(
      'Configuração persistida da equipe de Férias da Mariana está corrompida. ' +
      'Rode diagnosticarEquipeFeriasMariana() antes de reconfigurar.'
    );
  }

  if (!salvo || Number(salvo.versao) !== 1 ||
      _normalizarEmail_(salvo.emailGestor) !== FERIAS_EQUIPE_MARIANA_EMAIL) {
    throw new Error('Configuração persistida da equipe de Férias da Mariana é inválida. Acesso bloqueado por segurança.');
  }

  return _validarIdsEquipeFeriasMariana_(salvo.ids, rosterAtivo).ids.slice();
}

/** Diagnóstico somente leitura: não cria, corrige nem apaga a propriedade persistida. */
function diagnosticarEquipeFeriasMariana() {
  const rosterAtivo = _rosterAtivoFerias_();
  const bruto = PropertiesService.getScriptProperties().getProperty(FERIAS_EQUIPE_MARIANA_PROP);
  const out = {
    emailGestor: FERIAS_EQUIPE_MARIANA_EMAIL,
    nomesEsperados: FERIAS_EQUIPE_MARIANA_NOMES.slice(),
    totalEsperado: FERIAS_EQUIPE_MARIANA_NOMES.length,
    propriedadeConfigurada: !!bruto,
    resolucaoAtual: null,
    configuracaoPersistida: null
  };

  try {
    out.resolucaoAtual = _resolverEquipeFeriasPorNomes_(rosterAtivo, FERIAS_EQUIPE_MARIANA_NOMES);
  } catch (e) {
    out.resolucaoAtual = { ok: false, erro: e.message };
  }

  if (bruto) {
    try {
      const salvo = JSON.parse(bruto);
      const validado = _validarIdsEquipeFeriasMariana_(salvo && salvo.ids, rosterAtivo);
      out.configuracaoPersistida = {
        ok: true,
        versao: salvo.versao,
        configuradoEm: salvo.configuradoEm || '',
        origem: salvo.origem || '',
        ids: validado.ids,
        pessoas: validado.pessoas
      };
    } catch (e) {
      out.configuracaoPersistida = { ok: false, erro: e.message };
    }
  }

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Reconfiguração explícita e atômica: valida os 11 nomes antes de substituir a propriedade.
 * Não aceita parâmetros, portanto não permite ampliar o escopo por engano.
 */
function reconfigurarEquipeFeriasMariana() {
  const rosterAtivo = _rosterAtivoFerias_();
  const resolucao = _resolverEquipeFeriasPorNomes_(rosterAtivo, FERIAS_EQUIPE_MARIANA_NOMES);
  const props = PropertiesService.getScriptProperties();
  const anteriorBruto = props.getProperty(FERIAS_EQUIPE_MARIANA_PROP);
  let idsAnteriores = [];

  if (anteriorBruto) {
    try { idsAnteriores = (JSON.parse(anteriorBruto).ids || []).map(_idColaboradorFerias_); }
    catch (e) { idsAnteriores = []; }
  }

  props.setProperty(
    FERIAS_EQUIPE_MARIANA_PROP,
    JSON.stringify(_payloadEquipeFeriasMariana_(resolucao, 'reconfiguracao_manual'))
  );

  _invalidarCacheFerias_();
  try {
    const sufixo = Utilities.base64EncodeWebSafe(FERIAS_EQUIPE_MARIANA_EMAIL).replace(/=+$/, '');
    const cache = CacheService.getScriptCache();
    cache.remove('FIMDEANO_V3_' + sufixo);
    cache.remove('FIMDEANO_AGENDADOS_V1_' + sufixo);
    cache.remove('FIMDEANO_V2_' + sufixo);
    cache.remove('FIMDEANO_' + sufixo); // aposenta também a chave anterior
  } catch (e) { /* a configuração continua válida mesmo se a limpeza do cache falhar */ }

  const out = {
    ok: true,
    total: resolucao.ids.length,
    alterouIds: idsAnteriores.slice().sort().join('|') !== resolucao.ids.slice().sort().join('|'),
    ids: resolucao.ids,
    pessoas: resolucao.pessoas
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/** Testes puros com roster mockado; não lê planilhas e não grava ScriptProperties. */
function testarEquipeFeriasMarianaMock() {
  function afirmar(condicao, mensagem) {
    if (!condicao) throw new Error('Falha no mock da equipe de Férias: ' + mensagem);
  }

  const roster = FERIAS_EQUIPE_MARIANA_NOMES.map((nome, i) => ({
    ID_COLABORADOR: 'MOCK-' + (i + 1),
    NOME: i === 0 ? '  WÂNGELA   CAETANO DOS SANTOS  ' : nome,
    MATRICULA: String(9000 + i),
    EMAIL_INSTITUCIONAL: 'mock' + i + '@cieds.org.br',
    GESTOR_EMAIL: FERIAS_EQUIPE_MARIANA_EMAIL
  }));

  const resolvido = _resolverEquipeFeriasPorNomes_(roster, FERIAS_EQUIPE_MARIANA_NOMES);
  afirmar(resolvido.ids.length === 11, 'deveria resolver os 11 nomes.');
  afirmar(_validarIdsEquipeFeriasMariana_(resolvido.ids, roster).ids.length === 11,
    'IDs resolvidos deveriam ser válidos.');

  const payloadSerializado = JSON.stringify(_payloadEquipeFeriasMariana_(resolvido, 'teste_mock'));
  const payloadRelido = JSON.parse(payloadSerializado);
  afirmar(payloadRelido.ids.length === 11 &&
      _validarIdsEquipeFeriasMariana_(payloadRelido.ids, roster).ids.length === 11,
    'IDs deveriam permanecer válidos depois de persistir e reler o JSON.');

  let rejeitouAusente = false;
  try { _resolverEquipeFeriasPorNomes_(roster.slice(0, 10), FERIAS_EQUIPE_MARIANA_NOMES); }
  catch (e) { rejeitouAusente = true; }
  afirmar(rejeitouAusente, 'deveria rejeitar nome ausente.');

  let rejeitouHomonimo = false;
  try {
    _resolverEquipeFeriasPorNomes_(roster.concat([{
      ID_COLABORADOR: 'MOCK-HOMONIMO',
      NOME: FERIAS_EQUIPE_MARIANA_NOMES[0]
    }]), FERIAS_EQUIPE_MARIANA_NOMES);
  } catch (e) { rejeitouHomonimo = true; }
  afirmar(rejeitouHomonimo, 'deveria rejeitar correspondência duplicada.');

  let rejeitouIdAntigo = false;
  try {
    const idsAntigos = resolvido.ids.slice();
    idsAntigos[0] = 'MOCK-ID-ANTIGO';
    _validarIdsEquipeFeriasMariana_(idsAntigos, roster);
  } catch (e) { rejeitouIdAntigo = true; }
  afirmar(rejeitouIdAntigo, 'deveria rejeitar ID persistido divergente.');

  return {
    ok: true,
    totalResolvido: resolvido.ids.length,
    serializacaoPersistidaOk: true,
    rejeitouAusente: rejeitouAusente,
    rejeitouHomonimo: rejeitouHomonimo,
    rejeitouIdAntigo: rejeitouIdAntigo
  };
}

/** Zera o cache de equipes (use depois de mexer em GESTOR_EMAIL na MASTER). Só limpa quem AINDA
 *  aparece como GESTOR_EMAIL de alguém na MASTER — se um gestor ficou com equipe ZERADA
 *  (todo mundo foi tirado dele), use limparCacheEquipeDe(email) direto, porque esse gestor não
 *  aparece mais nesta varredura e o cache antigo dele nunca seria limpo por aqui. */
function limparCacheEquipes() {
  const cache = CacheService.getScriptCache();

  _colaboradores_().forEach(c => {
    const e = _normalizarEmail_(c.GESTOR_EMAIL);
    if (!e) return;
    cache.remove('EQUIPE_' + Utilities.base64EncodeWebSafe(e).replace(/=+$/, ''));
  });

  return 'Cache de equipes limpo.';
}

/** Zera o cache de equipe de UM gestor específico, direto pelo e-mail — mais certeiro que
 *  limparCacheEquipes() quando você sabe exatamente quem mudou (ex.: acabou de editar
 *  GESTOR_EMAIL na MASTER pra várias pessoas do time de alguém e quer ver o efeito na hora,
 *  sem esperar os 30 min do cache, ou quando o gestor ficou com equipe zerada). */
function limparCacheEquipeDe(email) {
  const e = _normalizarEmail_(email);
  if (!e) throw new Error('Informe um e-mail. Ex.: limparCacheEquipeDe("saulo@cieds.org.br")');
  CacheService.getScriptCache().remove('EQUIPE_' + Utilities.base64EncodeWebSafe(e).replace(/=+$/, ''));
  return 'Cache de equipe limpo para ' + e + '.';
}

/** Atalho pronto pra rodar direto pelo menu Executar (sem precisar digitar e-mail como
 *  parâmetro) — limpa o cache de equipe do Saulo especificamente. Pode apagar depois de
 *  resolvido, ou deixar — não faz mal nenhum ficar aí. */
function limparCacheEquipeSaulo() {
  return limparCacheEquipeDe('sauloluna.rj@coletivoaprendiz.org.br');
}

/** DIAGNÓSTICO — mostra exatamente quem o Portal de Férias entende hoje como equipe do Saulo
 *  (mesmo cálculo de tamanhoEquipePropria/roster do gestor: ativo na MASTER, GESTOR_EMAIL dele,
 *  sem aprendiz). Compare a lista com o que deveria ser, pra confirmar se bateu. */
function mostrarEquipeSaulo() {
  const email = 'sauloluna.rj@coletivoaprendiz.org.br';
  const idsEquipePropria = _equipeFeriasDoGestor_(email);
  const idsSet = {};
  idsEquipePropria.forEach(id => { idsSet[_idColaboradorFerias_(id)] = true; });

  const rosterAtivo = _rosterAtivoFerias_(); // já exclui quem está desligado
  const equipe = rosterAtivo.filter(c =>
    idsSet[_idColaboradorFerias_(c.ID_COLABORADOR)] && !_semDireitoAFerias_(c));

  const linhas = equipe.map(c =>
    c.NOME + ' | matrícula ' + (c.MATRICULA || '-') + ' | cargo ' + (c.CARGO || '-') + ' | situação ' + (c.SITUACAO || '-'));

  const relatorio = 'Equipe do Saulo no Portal de Férias agora: ' + equipe.length + ' pessoa(s)\n' + linhas.join('\n');
  console.log(relatorio);
  return relatorio;
}

/* [REMOVIDO 2026-09-17] Os quatro fixes pontuais de GESTOR_EMAIL (ajustarHierarquiaGestores20260908,
 * corrigirGestorEquipeMauana20260914, corrigirGestorMarianaLuciane20260914 e o diagnóstico que os
 * acompanhava) cumpriram a função em setembro/2026 e ficaram parados no editor — como cada um é
 * idempotente contra um valor FIXO daquela data, rodar qualquer um de novo por engano reverteria
 * silenciosamente uma troca de gestor mais recente e legítima. Identificado como a causa mais
 * provável de gestores "trocando sozinhos". Removidos em vez de mantidos como referência morta.
 */

/* ============================================================================================ */
/*  SALDO, a conta que substitui o split                                                        */
/* ============================================================================================ */

/**
 * Colapsa múltiplos períodos aquisitivos da mesma pessoa em UM só, o "da vez".
 *
 * Regra do DP:
 *   - Enquanto um período tiver saldo (não foi 100% agendado/aprovado), é ELE que aparece.
 *   - O próximo período só aparece quando o anterior é totalmente consumido.
 *   - Ordem: sempre o mais ANTIGO primeiro (o que vence antes).
 *   - Se todos os com-saldo acabaram, mostra o EM_CURSO mais antigo (retrato da equipe).
 *
 * "Consumido" = saldo <= 0 considerando solicitações PENDENTE ou DEFERIDA
 * (ou seja, agendado conta mesmo antes de aprovado; se for recusado, o saldo volta e ele reaparece).
 */
function _periodoVigentePorPessoa_(periodos, solicitacoes) {
  const porPessoa = {};

  periodos.forEach(p => {
    // [FIX] A aba PERIODOS não tem coluna ID_COLABORADOR — só MATRICULA. Agrupar pelo
    // ID_COLABORADOR (sempre vazio aqui) descartava todo mundo antes mesmo de escolher o
    // período vigente. MATRICULA identifica a pessoa de forma confiável dentro desta planilha.
    const id = _normalizarMatricula_(p.MATRICULA);
    if (!id) return;
    if (!porPessoa[id]) porPessoa[id] = [];
    porPessoa[id].push(p);
  });

  const escolhidos = [];

  Object.keys(porPessoa).forEach(id => {
    const lista = porPessoa[id];

    // ordena do mais antigo para o mais novo pelo início do aquisitivo
    lista.sort((a, b) => {
      const da = _dataF_(a.AQUIS_INICIO), db = _dataF_(b.AQUIS_INICIO);
      if (da && db) return da - db;
      return 0;
    });

    const jaEscolhido = {};

    // 1) o mais antigo que ainda tem saldo de gozo — representa a pessoa pra
    //    agendar (cards Disponíveis/Aguardando o DP).
    const comSaldo = lista.find(p => _saldoDoPeriodo_(p, solicitacoes) > 0);

    if (comSaldo) {
      escolhidos.push(comSaldo);
      jaEscolhido[comSaldo.ID_PERIODO] = true;
    } else {
      // 2) nenhum com saldo: mostra o EM_CURSO mais antigo (recém-admitido, retrato da equipe)
      const emCurso = lista.find(p => String(p.STATUS || '').toUpperCase() === 'EM_CURSO');
      if (emCurso) {
        escolhidos.push(emCurso);
        jaEscolhido[emCurso.ID_PERIODO] = true;
      } else if (lista.length) {
        // 3) fallback: o mais recente (tudo já gozado, some do "disponível", mas não perde a pessoa)
        const ultimo = lista[lista.length - 1];
        escolhidos.push(ultimo);
        jaEscolhido[ultimo.ID_PERIODO] = true;
      }
    }

    // 4) qualquer OUTRO período da mesma pessoa que ainda tenha uma solicitação
    //    PENDENTE ou DEFERIDA — entra como item separado, pra "Confirmadas" e
    //    "Aguardando o DP" continuarem mostrando o período REAL do agendamento,
    //    mesmo depois que um período novo aparecer como o "vigente" pra agendar.
    const idxSol = _indiceSolicitacoesPorPeriodo_(solicitacoes);

    lista.forEach(p => {
      if (jaEscolhido[p.ID_PERIODO]) return;

      const doPeriodo = idxSol[String(p.ID_PERIODO)] || [];
      const temSolicitacaoAtiva = doPeriodo.some(s =>
        ['PENDENTE', 'DEFERIDA'].indexOf(String(s.STATUS || '').toUpperCase()) > -1);

      if (temSolicitacaoAtiva) {
        escolhidos.push(p);
        jaEscolhido[p.ID_PERIODO] = true;
      }
    });
  });

  return escolhidos;
}

/**
 * [PERF] O gargalo real do sistema: _saldoDoPeriodo_ e _fracoesDoPeriodo_ eram chamadas
 * centenas/milhares de vezes por carregamento (uma vez por período), e CADA chamada
 * escaneava a lista INTEIRA de solicitações do zero. Com 2000+ períodos e milhares de
 * solicitações, isso virava milhões de comparações por página carregada.
 * Agora o índice (solicitações agrupadas por ID_PERIODO) é montado UMA vez, e reaproveitado
 * enquanto for exatamente o mesmo array de solicitações (é sempre o mesmo, na prática,
 * porque vem do _solicitacoes_() cacheado) — se algum dia vier um array diferente, o índice
 * é refeito sozinho, sem quebrar nada.
 */
var _IDX_SOL_REF_ = null;
var _IDX_SOL_POR_PERIODO_ = null;

function _indiceSolicitacoesPorPeriodo_(solicitacoes) {
  if (_IDX_SOL_REF_ === solicitacoes && _IDX_SOL_POR_PERIODO_) return _IDX_SOL_POR_PERIODO_;

  _IDX_SOL_REF_ = solicitacoes;
  _IDX_SOL_POR_PERIODO_ = {};
  solicitacoes.forEach(s => {
    const k = String(s.ID_PERIODO);
    if (!_IDX_SOL_POR_PERIODO_[k]) _IDX_SOL_POR_PERIODO_[k] = [];
    _IDX_SOL_POR_PERIODO_[k].push(s);
  });
  return _IDX_SOL_POR_PERIODO_;
}

function _saldoDoPeriodo_(periodo, solicitacoes) {
  // Perdido, congelado ou ainda em curso: não gera saldo de gozo.
  if (FERIAS.STATUS_SEM_SALDO.indexOf(String(periodo.STATUS || '').toUpperCase()) > -1) return 0;

  const direito = Number(periodo.DIAS_DIREITO || 0);
  const anteriores = Number(periodo.DIAS_GOZADOS_ANTERIORES || 0);

  const doPeriodo = _indiceSolicitacoesPorPeriodo_(solicitacoes)[String(periodo.ID_PERIODO)] || [];
  const comprometidos = doPeriodo
    .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
    .reduce((soma, s) => soma + Number(s.DIAS || 0) + Number(s.ABONO || 0), 0);

  return direito - anteriores - comprometidos;
}

/**
 * Recalcula e GRAVA de volta, na própria aba PERIODOS, as colunas DIAS_SOLICITADOS e SALDO
 * de um período específico — pra planilha refletir sempre a situação real, pra quem olha
 * ela direto (sem passar pelo portal). Chamada sempre que uma solicitação daquele período
 * é criada, cancelada, ou tem seu status decidido (deferida/indeferida).
 */
function _atualizarSaldoNoPeriodo_(idPeriodo) {
  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);

  const colDiasSol = h.indexOf('DIAS_SOLICITADOS');
  const colSaldo = h.indexOf('SALDO');
  if (colDiasSol === -1 && colSaldo === -1) return; // planilha sem essas colunas, nada a fazer

  const periodos = _sheetToObjects_(sh);
  const periodo = periodos.find(p => String(p.ID_PERIODO) === String(idPeriodo));
  if (!periodo) return;

  const sols = _solicitacoes_();
  const doPeriodo = _indiceSolicitacoesPorPeriodo_(sols)[String(idPeriodo)] || [];

  const diasSolicitados = doPeriodo
    .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
    .reduce((soma, s) => soma + Number(s.DIAS || 0) + Number(s.ABONO || 0), 0);

  const saldo = _saldoDoPeriodo_(periodo, sols);

  if (colDiasSol > -1) sh.getRange(periodo._rowNumber, colDiasSol + 1).setValue(diasSolicitados);
  if (colSaldo > -1) sh.getRange(periodo._rowNumber, colSaldo + 1).setValue(saldo);
}

function _fracoesDoPeriodo_(idPeriodo, solicitacoes) {
  const doPeriodo = _indiceSolicitacoesPorPeriodo_(solicitacoes)[String(idPeriodo)] || [];
  return doPeriodo
    .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
    .filter(s => Number(s.DIAS || 0) > 0);   // abono puro não é fração de gozo
}

/**
 * DIAS_GOZADOS_ANTERIORES, em períodos migrados, às vezes embute dias de abono (venda)
 * junto com o gozo real — ex.: colaborador vendeu 10 e tirou 5, e a migração gravou só "15"
 * nessa coluna. Abono não é fração de descanso (não conta pro art. 134 §1º), então pra
 * checar se a pessoa "já tem uma fração de 14 dias" precisamos descontar o abono já liberado
 * desse período antes de comparar. Sem isso, alguém que só tirou 5 dias reais aparece como
 * se já tivesse cumprido a exigência de 14 dias.
 */
function _gozoRealAnterior_(periodo) {
  const anteriores = Number(periodo.DIAS_GOZADOS_ANTERIORES || 0);
  const abonoEmbutido = String(periodo.ABONO_STATUS || '').toUpperCase() === 'LIBERADO'
    ? Number(periodo.ABONO_DIAS_PEDIDOS || 0)
    : 0;
  return Math.max(0, anteriores - abonoEmbutido);
}

/**
 * [TEMP-DIAG] Busca colaboradores por trecho do nome e mostra, pra cada um, quem é o gestor
 * hoje (GESTOR_EMAIL) — pra investigar "não apareceu pro meu gestor" sem precisar abrir a
 * planilha. `emailGestorEsperado`, se vier, marca se bate ou não com o GESTOR_EMAIL atual.
 */
function _diagnosticoPessoaGestor_(trechoNome, emailGestorEsperado) {
  const alvo = String(trechoNome || '').toUpperCase().trim();
  const emailEsperado = _normalizarEmail_(emailGestorEsperado || '');

  const encontrados = _colaboradores_()
    .filter(c => String(c.NOME || '').toUpperCase().indexOf(alvo) > -1)
    .map(c => {
      const gestorAtual = _normalizarEmail_(c.GESTOR_EMAIL || '');
      return {
        matricula: c.MATRICULA,
        nome: c.NOME,
        situacao: c.SITUACAO,
        departamento: c.DEPARTAMENTO_ATUAL,
        gestorEmailAtual: c.GESTOR_EMAIL || '(vazio)',
        bateComGestorEsperado: emailEsperado ? (gestorAtual === emailEsperado) : null
      };
    });

  return { buscaPor: alvo, emailGestorEsperado: emailEsperado || null, total: encontrados.length, encontrados: encontrados };
}

/**
 * [TEMP-DIAG] Cabeçalho + linhas da aba FIM_DE_ANO (a lista real que manda na elegibilidade —
 * o array chumbado FERIAS.FIM_DE_ANO_MATRICULAS_PERMITIDAS só é usado se essa aba vier vazia).
 */
function _diagnosticoAbaFimDeAno_() {
  const sh = _shFerias_(FERIAS.ABAS.FIM_DE_ANO);
  if (!sh) return { ok: false, motivo: 'Aba FIM_DE_ANO não encontrada.' };
  const linhas = _sheetToObjects_(sh);
  return {
    headers: _headers_(sh),
    totalLinhas: linhas.length,
    linhas: linhas.slice(0, 5),
    temMatricula33: linhas.some(function (r) {
      return _normalizarMatricula_(_linhaFimDeAnoNormalizada_(r).MATRICULA) === '33';
    })
  };
}

/**
 * [TEMP-DIAG] Repete o MESMO caminho de _feriasElegiveisFimDeAnoCalcular_ pra UM e-mail de
 * gestor + UMA matrícula, mas sem sair silenciosamente no primeiro "return" — anota em qual
 * passo ela cairia fora, e por quê. Não reimplementa a regra, só instrumenta a mesma.
 */
function _diagnosticoTracaFimDeAno_(email, matriculaBusca) {
  const matriculaBuscaNorm = _normalizarMatricula_(matriculaBusca);
  const idsEquipe = _equipeFeriasDoGestor_(email);
  const idsEquipeSet = {};
  idsEquipe.forEach(id => { idsEquipeSet[_idColaboradorFerias_(id)] = true; });

  const periodos = _periodos_().filter(x =>
    !!idsEquipeSet[_idColaboradorFerias_(x.ID_COLABORADOR)] &&
    ['PERDIDO', 'CONGELADO'].indexOf(String(x.STATUS || '').toUpperCase()) === -1);
  const sols = _solicitacoes_();
  const matriculasPermitidas = {};
  _fimDeAnoMatriculasPermitidas_().forEach(m => { matriculasPermitidas[m] = true; });

  const meusPeriodos = periodos.filter(x => _normalizarMatricula_(x.MATRICULA) === matriculaBuscaNorm);
  if (!meusPeriodos.length) {
    return { passo: 'PERIODOS_DA_EQUIPE', ok: false, detalhe: 'Nenhum período dessa matrícula caiu no filtro de equipe (ou está PERDIDO/CONGELADO).' };
  }

  const id = String(meusPeriodos[0].ID_COLABORADOR);

  const jaSolicitouNestaCampanha = sols.some(s =>
    _idColaboradorFerias_(s.ID_COLABORADOR) === _idColaboradorFerias_(id) &&
    FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
    String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1
  );
  if (jaSolicitouNestaCampanha) return { passo: 'JA_SOLICITOU_CAMPANHA', ok: false };

  const lista = meusPeriodos.slice().sort((a, b) => {
    const da = _dataF_(a.AQUIS_INICIO), db = _dataF_(b.AQUIS_INICIO);
    return (da && db) ? da - db : 0;
  });

  const alvo = lista.find(per => _saldoFimDeAno_(per, sols) >= 10);
  if (!alvo) return { passo: 'SALDO_10', ok: false, periodos: lista.map(p => ({ idPeriodo: p.ID_PERIODO, saldo: _saldoFimDeAno_(p, sols) })) };

  const colabLive = _colaboradorPorId_(alvo.ID_COLABORADOR);
  if (!colabLive) return { passo: 'COLABORADOR_LIVE', ok: false, idPeriodoAlvo: alvo.ID_PERIODO };
  if (!_colaboradorEstaAtivo_(alvo.ID_COLABORADOR)) {
    return { passo: 'COLABORADOR_ATIVO', ok: false, situacao: colabLive.SITUACAO };
  }

  const matriculaAlvo = _normalizarMatricula_(colabLive.MATRICULA) || _normalizarMatricula_(alvo.MATRICULA);
  if (!matriculasPermitidas[matriculaAlvo]) {
    return { passo: 'MATRICULA_PERMITIDA', ok: false, matriculaAlvo: matriculaAlvo };
  }

  if (_semDireitoAFerias_(colabLive)) {
    return {
      passo: 'SEM_DIREITO_A_FERIAS', ok: false,
      ehAprendiz: _ehAprendiz_(colabLive), cargo: colabLive.CARGO, perfilSistema: colabLive.PERFIL_SISTEMA
    };
  }

  const saldo = _saldoFimDeAno_(alvo, sols);
  const aquisFim = _dataF_(alvo.AQUIS_FIM);
  const concederAte = _dataF_(alvo.CONCEDER_ATE);

  const opcoes = FERIAS.OPCOES_FIM_DE_ANO.map(o => {
    if (aquisFim && _dataF_(o.inicio) <= aquisFim) {
      return { id: o.id, disponivel: false, motivoCodigo: 'AQUIS_FIM_NAO_COMPLETOU', aquisFim: _fmtBRF_(aquisFim) };
    }
    return _calcularOpcaoFimDeAno_(alvo, o.id, saldo, sols);
  });

  return {
    passo: 'RESULTADO_FINAL', ok: true,
    idPeriodoAlvo: alvo.ID_PERIODO, saldo: saldo,
    aquisInicio: _fmtBRF_(_dataF_(alvo.AQUIS_INICIO)), aquisFim: _fmtBRF_(aquisFim),
    concederAte: _fmtBRF_(concederAte),
    cargo: colabLive.CARGO,
    opcoes: opcoes
  };
}

/**
 * [TEMP-DIAG] Mostra as linhas de PERIODOS de alguém (por trecho do nome), com o
 * ID_COLABORADOR que cada período usa e pra qual cadastro (COLABORADORES) isso resolve —
 * pra achar período órfão/ligado ao cadastro errado quando a pessoa tem registro duplicado.
 */
function _diagnosticoPeriodosPessoa_(trechoNome) {
  const alvo = String(trechoNome || '').toUpperCase().trim();
  const periodos = _periodos_().filter(p => String(p.NOME || '').toUpperCase().indexOf(alvo) > -1);

  return periodos.map(p => {
    const colab = _colaboradorPorId_(p.ID_COLABORADOR);
    return {
      idPeriodo: p.ID_PERIODO,
      nomeNoPeriodo: p.NOME,
      matriculaNoPeriodo: p.MATRICULA,
      idColaboradorNoPeriodo: p.ID_COLABORADOR,
      statusPeriodo: p.STATUS,
      diasDireito: p.DIAS_DIREITO,
      aquisInicio: _fmtBRF_(_dataF_(p.AQUIS_INICIO)),
      aquisFim: _fmtBRF_(_dataF_(p.AQUIS_FIM)),
      saldoFimDeAno: _saldoFimDeAno_(p, _solicitacoes_()),
      colaboradorResolvido: colab
        ? { id: colab.ID_COLABORADOR, nome: colab.NOME, matricula: colab.MATRICULA, situacao: colab.SITUACAO, gestorEmail: colab.GESTOR_EMAIL }
        : null
    };
  });
}

/**
 * [TEMP-DIAG] Mostra a equipe que _equipeFeriasDoGestor_ (a função REAL usada pelo portal)
 * devolve pra um e-mail — pra investigar "não vejo essa pessoa na minha equipe" comparando
 * com o GESTOR_EMAIL de cada um. Também mostra se existe conta USUARIOS pra esse e-mail.
 */
function _diagnosticoEquipeGestor_(email) {
  const emailNorm = _normalizarEmail_(email);
  const usuario = _obterUsuario_(emailNorm);
  const idsEquipe = _equipeFeriasDoGestor_(emailNorm);
  const idsSet = {};
  idsEquipe.forEach(id => { idsSet[_idColaboradorFerias_(id)] = true; });

  const equipe = _colaboradores_()
    .filter(c => idsSet[_idColaboradorFerias_(c.ID_COLABORADOR)])
    .map(c => ({ matricula: c.MATRICULA, nome: c.NOME, situacao: c.SITUACAO, gestorEmail: c.GESTOR_EMAIL }));

  return {
    emailConsultado: emailNorm,
    usuarioEncontrado: usuario ? { email: usuario.EMAIL, nome: usuario.NOME, perfil: usuario.PERFIL, ativo: usuario.ATIVO } : null,
    tamanhoEquipe: equipe.length,
    equipe: equipe
  };
}

/**
 * [TEMP-DIAG] Situação da campanha de fim de ano 2026 pra CADA pessoa da lista validada
 * (FIM_DE_ANO_MATRICULAS_PERMITIDAS), não só quem tem problema. Agrupado por status pra
 * ficar fácil de ler: quem já agendou, quem está elegível esperando o gestor agendar, quem
 * não tem saldo suficiente, quem não tem opção disponível (14 dias), etc.
 */
function _diagnosticoStatusFimDeAno_() {
  const roster = _rosterAtivoFerias_();
  const periodos = _periodos_().filter(x =>
    ['PERDIDO', 'CONGELADO'].indexOf(String(x.STATUS || '').toUpperCase()) === -1);
  const sols = _solicitacoes_();

  const rosterPorMatricula = {};
  roster.forEach(function (c) {
    const mat = _normalizarMatricula_(c.MATRICULA);
    if (mat) rosterPorMatricula[mat] = c;
  });

  function idColabDoPeriodo(x) {
    const direto = _idColaboradorFerias_(x.ID_COLABORADOR);
    if (direto) return direto;
    const porMat = rosterPorMatricula[_normalizarMatricula_(x.MATRICULA)];
    return porMat ? _idColaboradorFerias_(porMat.ID_COLABORADOR) : direto;
  }

  const periodosPorId = {};
  periodos.forEach(function (per) {
    const id = idColabDoPeriodo(per);
    if (!id) return;
    if (!periodosPorId[id]) periodosPorId[id] = [];
    periodosPorId[id].push(per);
  });

  const linhas = [];

  _fimDeAnoMatriculasPermitidas_().forEach(function (matOriginal) {
    const mat = _normalizarMatricula_(matOriginal);
    const colab = rosterPorMatricula[mat];

    if (!colab) {
      linhas.push({ matricula: matOriginal, nome: null, status: 'NAO_ENCONTRADO_NO_CADASTRO_ATIVO' });
      return;
    }

    const nome = colab.NOME;
    const id = _idColaboradorFerias_(colab.ID_COLABORADOR);

    if (_semDireitoAFerias_(colab)) {
      linhas.push({ matricula: mat, nome: nome, status: 'APRENDIZ_SEM_DIREITO' });
      return;
    }
    if (!_colaboradorEstaAtivo_(colab.ID_COLABORADOR)) {
      linhas.push({ matricula: mat, nome: nome, status: 'DESLIGADO_OU_AFASTADO' });
      return;
    }

    const meusPeriodos = (periodosPorId[id] || []).slice().sort(function (a, b) {
      const da = _dataF_(a.AQUIS_INICIO), db = _dataF_(b.AQUIS_INICIO);
      return (da && db) ? da - db : 0;
    });

    if (!meusPeriodos.length) {
      linhas.push({ matricula: mat, nome: nome, status: 'SEM_PERIODO_CADASTRADO' });
      return;
    }

    const solAgendada = sols.find(function (s) {
      return _idColaboradorFerias_(s.ID_COLABORADOR) === id &&
        FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
        String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1;
    });

    if (solAgendada) {
      linhas.push({
        matricula: mat, nome: nome, status: 'AGENDADO',
        dataInicio: _fmtBRF_(_dataF_(solAgendada.DATA_INICIO)),
        dataFim: _fmtBRF_(_dataF_(solAgendada.DATA_FIM)),
        statusSolicitacao: solAgendada.STATUS
      });
      return;
    }

    const alvo = meusPeriodos.find(function (per) { return _saldoFimDeAno_(per, sols) >= 10; });

    if (!alvo) {
      const maiorSaldo = meusPeriodos.reduce(function (m, per) {
        return Math.max(m, _saldoFimDeAno_(per, sols));
      }, 0);
      linhas.push({ matricula: mat, nome: nome, status: 'SALDO_INSUFICIENTE', saldoAtual: maiorSaldo });
      return;
    }

    const saldo = _saldoFimDeAno_(alvo, sols);
    const aquisFim = _dataF_(alvo.AQUIS_FIM);
    const detalheOpcoes = [];
    let temOpcaoValida = false;

    FERIAS.OPCOES_FIM_DE_ANO.forEach(function (o) {
      if (aquisFim && _dataF_(o.inicio) <= aquisFim) {
        detalheOpcoes.push({ id: o.id, disponivel: false,
          motivo: 'Período aquisitivo só termina depois de ' + o.inicio + '.' });
        return;
      }
      const calc = _calcularOpcaoFimDeAno_(alvo, o.id, saldo, sols);
      if (calc.disponivel) temOpcaoValida = true;
      detalheOpcoes.push({ id: o.id, disponivel: calc.disponivel, motivo: calc.motivo || null });
    });

    linhas.push({
      matricula: mat, nome: nome,
      status: temOpcaoValida ? 'ELEGIVEL_AGUARDANDO_AGENDAMENTO' : 'SEM_OPCAO_DISPONIVEL_14_DIAS',
      saldo: saldo,
      opcoes: temOpcaoValida ? undefined : detalheOpcoes
    });
  });

  linhas.sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || '')); });

  const porStatus = {};
  linhas.forEach(function (l) {
    if (!porStatus[l.status]) porStatus[l.status] = [];
    porStatus[l.status].push(l);
  });

  const resumo = {};
  Object.keys(porStatus).forEach(function (k) { resumo[k] = porStatus[k].length; });

  return { resumo: resumo, porStatus: porStatus };
}

/**
 * [TEMP-DIAG] Mesma lógica de _feriasElegiveisFimDeAnoCalcular_, mas SEM restringir por
 * equipe de um gestor (varre todo mundo da lista FIM_DE_ANO_MATRICULAS_PERMITIDAS) e SEM
 * descartar quem não tem nenhuma opção disponível — pelo contrário, é só isso que reporta.
 * É pra achar quem "sumiu" da tela do gestor porque a Opção 1 E a Opção 2 ficaram indisponíveis
 * (normalmente por causa da regra dos 14 dias corridos, art. 134 §1º), e por isso ninguém
 * consegue agendar as férias de fim de ano dessa pessoa.
 */
function _diagnosticoFimDeAnoNaoResolvido_() {
  const periodos = _periodos_().filter(x =>
    ['PERDIDO', 'CONGELADO'].indexOf(String(x.STATUS || '').toUpperCase()) === -1);
  const sols = _solicitacoes_();
  const matriculasPermitidas = {};
  _fimDeAnoMatriculasPermitidas_().forEach(m => { matriculasPermitidas[m] = true; });

  const porPessoa = {};
  periodos.forEach(per => {
    const id = String(per.ID_COLABORADOR);
    if (!porPessoa[id]) porPessoa[id] = [];
    porPessoa[id].push(per);
  });

  const problemas = [];

  Object.keys(porPessoa).forEach(id => {
    const jaSolicitouNestaCampanha = sols.some(s =>
      _idColaboradorFerias_(s.ID_COLABORADOR) === _idColaboradorFerias_(id) &&
      FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
      String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1
    );
    if (jaSolicitouNestaCampanha) return; // já resolvido, agendado

    const lista = porPessoa[id].sort((a, b) => {
      const da = _dataF_(a.AQUIS_INICIO), db = _dataF_(b.AQUIS_INICIO);
      return (da && db) ? da - db : 0;
    });

    const alvo = lista.find(per => _saldoFimDeAno_(per, sols) >= 10);
    if (!alvo) return; // sem saldo suficiente, não é caso da campanha

    const colabLive = _colaboradorPorId_(alvo.ID_COLABORADOR);
    if (!colabLive) return;
    if (!_colaboradorEstaAtivo_(alvo.ID_COLABORADOR)) return;

    const matriculaAlvo = _normalizarMatricula_(colabLive.MATRICULA) ||
      _normalizarMatricula_(alvo.MATRICULA);
    if (!matriculasPermitidas[matriculaAlvo]) return;

    if (_semDireitoAFerias_(colabLive)) return;

    const saldo = _saldoFimDeAno_(alvo, sols);
    const aquisFim = _dataF_(alvo.AQUIS_FIM);

    const detalheOpcoes = [];
    let temOpcaoValida = false;

    FERIAS.OPCOES_FIM_DE_ANO.forEach(o => {
      if (aquisFim && _dataF_(o.inicio) <= aquisFim) {
        detalheOpcoes.push({ id: o.id, disponivel: false,
          motivo: 'Período aquisitivo só termina depois de ' + o.inicio + '; ainda não teria direito.' });
        return;
      }
      const calc = _calcularOpcaoFimDeAno_(alvo, o.id, saldo, sols);
      if (calc.disponivel) temOpcaoValida = true;
      detalheOpcoes.push({ id: o.id, disponivel: calc.disponivel, motivo: calc.motivo || null });
    });

    if (temOpcaoValida) return; // essa pessoa tem opção disponível, não é o caso

    problemas.push({
      nome: alvo.NOME,
      matricula: matriculaAlvo,
      idPeriodo: alvo.ID_PERIODO,
      saldo: saldo,
      aquisInicio: _fmtBRF_(_dataF_(alvo.AQUIS_INICIO)),
      aquisFim: _fmtBRF_(aquisFim),
      opcoes: detalheOpcoes
    });
  });

  problemas.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  return problemas;
}

/**
 * [TEMP-DIAG] Lista quem tem saldo de férias em aberto sem nenhuma fração já feita (ou
 * a fazer, de uma vez) que cumpra os 14 dias corridos exigidos pelo art. 134 §1º da CLT —
 * ou seja, o saldo que sobrou "encalhou": não dá pra agendar do jeito que está, precisa o DP
 * decidir algo (esticar um pedido futuro, corrigir GOZADOS_ANTERIORES, etc).
 * Reaproveita a mesma lógica de _validarSolicitacao_ (linhas ~2179 e ~3005), só que sobre o
 * estado atual em vez de sobre um pedido novo. Remover esta função e o gancho no doGet depois
 * de tirar o relatório — não é pra ficar em produção.
 */
function _diagnosticoFracao14_() {
  const periodos = _periodos_();
  const solicitacoes = _solicitacoes_();

  const linhas = [];
  periodos.forEach(function (periodo) {
    const status = String(periodo.STATUS || '').toUpperCase();
    if (FERIAS.STATUS_SEM_SALDO.indexOf(status) > -1) return; // PERDIDO/CONGELADO/EM_CURSO fora

    const saldo = _saldoDoPeriodo_(periodo, solicitacoes);
    if (saldo <= 0) return; // nada em aberto pra agendar

    const anteriores = _gozoRealAnterior_(periodo);
    const fracoes = _fracoesDoPeriodo_(periodo.ID_PERIODO, solicitacoes);
    const maiorFracao = fracoes.reduce(function (m, f) { return Math.max(m, Number(f.DIAS || 0)); }, 0);
    const jaTem14 = anteriores >= FERIAS.FRACAO_MAIOR_MINIMA || maiorFracao >= FERIAS.FRACAO_MAIOR_MINIMA;

    if (!jaTem14 && saldo < FERIAS.FRACAO_MAIOR_MINIMA) {
      linhas.push({
        nome: periodo.NOME,
        matricula: periodo.MATRICULA,
        idPeriodo: periodo.ID_PERIODO,
        statusPeriodo: status,
        diasDireito: Number(periodo.DIAS_DIREITO || 0),
        gozadosAnteriores: anteriores,
        maiorFracaoJaAgendada: maiorFracao,
        saldoEncalhado: saldo,
        concederAte: periodo.CONCEDER_ATE
      });
    }
  });

  linhas.sort(function (a, b) { return String(a.concederAte).localeCompare(String(b.concederAte)); });
  return linhas;
}

/* ============================================================================================ */
/*  VALIDAÇÕES, CLT                                                                             */
/* ============================================================================================ */

function _validarSolicitacao_(periodo, dias, abono, inicio, solicitacoes) {
  const erros = [];

  const direito = Number(periodo.DIAS_DIREITO || 0);
  const saldo = _saldoDoPeriodo_(periodo, solicitacoes);
  const total = dias + abono;

  if (dias < 0 || abono < 0) erros.push('Dias e abono não podem ser negativos.');
  if (total <= 0) erros.push('Informe ao menos 1 dia de gozo ou de abono.');

  if (total > saldo) {
    erros.push('Saldo insuficiente: pedido de ' + total + ' dia(s) (gozo ' + dias +
      ' + abono ' + abono + '), saldo disponível é ' + saldo + '.');
  }

  // Abono, CLT art. 143: até 1/3 do período de férias a que tem direito.
  const abonoMax = Math.min(
    Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS)),
    Math.floor(direito / 3)
  );

  const abonoJa = solicitacoes
    .filter(s => String(s.ID_PERIODO) === String(periodo.ID_PERIODO))
    .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
    .reduce((t, s) => t + Number(s.ABONO || 0), 0);

  if (abono + abonoJa > abonoMax) {
    erros.push('Abono máximo é ' + abonoMax + ' dia(s) por período (art. 143). ' +
      'Já solicitados: ' + abonoJa + '.');
  }

  // O abono (venda de dias) só é permitido se o DP tiver REGISTRADO o pedido do colaborador.
  // Art. 143 §1º: o pedido tem que ser feito dentro do período aquisitivo, até 15 dias do fim.
  // O DP pode liberar por EXCEÇÃO, com justificativa, e isso fica na auditoria.
  if (abono > 0 && !_sim_(periodo.ABONO_AUTORIZADO)) {
    erros.push(
      'A venda de dias (abono) ainda não foi liberada para este período. ' +
      'O colaborador precisa ter solicitado ao Departamento Pessoal dentro do período aquisitivo ' +
      '(art. 143 §1º). Fale com o DP: se o pedido foi feito no prazo, eles registram e a opção libera.'
    );
  }

  // Fracionamento, CLT art. 134 §1º
  if (dias > 0) {
    const fracoes = _fracoesDoPeriodo_(periodo.ID_PERIODO, solicitacoes);
    const maxFracoes = Number(_feriasParam_('MAX_FRACOES', FERIAS.MAX_FRACOES));

    if (fracoes.length + 1 > maxFracoes) {
      erros.push('As férias podem ser divididas em no máximo ' + maxFracoes +
        ' períodos (art. 134 §1º). Já existem ' + fracoes.length + '.');
    }

    if (dias < FERIAS.FRACAO_MINIMA) {
      erros.push('Nenhum período de gozo pode ser menor que ' + FERIAS.FRACAO_MINIMA +
        ' dias corridos (art. 134 §1º).');
    }

    // Um dos períodos precisa ter 14+ dias. Só cobramos isso quando o saldo restante
    // não permitir mais criar uma fração de 14 dias.
    // Gozo anterior ao sistema (migrado) pode já ter cumprido a fração de 14 dias.
    // (abono já liberado é descontado — venda de dias não é fração de descanso)
    const anteriores = _gozoRealAnterior_(periodo);

    const jaTem14 =
      anteriores >= FERIAS.FRACAO_MAIOR_MINIMA ||
      fracoes.some(s => Number(s.DIAS || 0) >= FERIAS.FRACAO_MAIOR_MINIMA);

    const saldoDepois = saldo - total;

    if (!jaTem14 && dias < FERIAS.FRACAO_MAIOR_MINIMA && saldoDepois < FERIAS.FRACAO_MAIOR_MINIMA) {
      erros.push('Um dos períodos precisa ter pelo menos ' + FERIAS.FRACAO_MAIOR_MINIMA +
        ' dias corridos (art. 134 §1º). Com este pedido, não sobraria saldo para isso.');
    }
  }

  // Datas
  if (dias > 0) {
    if (!inicio || isNaN(inicio.getTime())) {
      erros.push('Data de início inválida.');
    } else {
      const hoje = _hojeFerias_();
      const antecedencia = Number(_feriasParam_('ANTECEDENCIA_MINIMA_DIAS', FERIAS.ANTECEDENCIA_MINIMA_DIAS));
      const minima = _addDiasF_(hoje, antecedencia);

      if (inicio < minima) {
        erros.push('O início deve ter ao menos ' + antecedencia + ' dias de antecedência (a partir de ' +
          _fmtBRF_(minima) + ').');
      }

      // Trava dura: período ainda em curso não gera direito a gozo (CLT art. 130).
      // Regra do DP: pode agendar mesmo com o aquisitivo em curso, DESDE QUE o início
      // das férias seja após o fim do período aquisitivo. A trava é pela DATA, não pelo status.
      const aquisFim = _dataF_(periodo.AQUIS_FIM);
      if (aquisFim && inicio <= aquisFim) {
        erros.push('O gozo só pode começar após o fim do período aquisitivo (' +
          _fmtBRF_(aquisFim) + '). Escolha uma data a partir de ' +
          _fmtBRF_(_addDiasF_(aquisFim, 1)) + '.');
      }

      // Segurança: se o período está EM_CURSO mas não tem AQUIS_FIM preenchido,
      // não há como validar a data, aí sim bloqueia (dado incompleto).
      if (!aquisFim && String(periodo.STATUS || '').toUpperCase() === 'EM_CURSO') {
        erros.push('Este período aquisitivo está em curso e sem data de término cadastrada. ' +
          'O DP precisa completar o cadastro antes de agendar.');
      }

      const concederAte = _dataF_(periodo.CONCEDER_ATE);
      if (concederAte && inicio > concederAte) {
        erros.push('O início ultrapassa o limite legal "conceder até" (' + _fmtBRF_(concederAte) + ').');
      }

      const bloqueados = String(_feriasParam_('DIAS_INICIO_BLOQUEADOS', FERIAS.DIAS_INICIO_BLOQUEADOS.join(',')))
        .split(',').map(x => Number(String(x).trim()));

      if (bloqueados.indexOf(inicio.getDay()) > -1) {
        const nomes = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
        erros.push('As férias não podem começar em ' + nomes[inicio.getDay()] +
          ' (art. 134 §3º). Escolha de segunda a quarta-feira.');
      }

      const fer = _motivoFeriadoF_(inicio);
      if (fer) erros.push(fer);

      // Sobreposição: duas solicitações ativas (PENDENTE/DEFERIDA) da MESMA pessoa não podem
      // ter datas conflitantes — nem entre frações do mesmo período, nem entre períodos
      // aquisitivos diferentes (a pessoa pode ter mais de um período aberto ao mesmo tempo).
      const fim = _addDiasF_(inicio, dias - 1);
      const conflito = solicitacoes.find(s =>
        _idColaboradorFerias_(s.ID_COLABORADOR) === _idColaboradorFerias_(periodo.ID_COLABORADOR) &&
        FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
        _dataF_(s.DATA_INICIO) && _dataF_(s.DATA_FIM) &&
        inicio <= _dataF_(s.DATA_FIM) && fim >= _dataF_(s.DATA_INICIO)
      );
      if (conflito) {
        erros.push('Já existe uma solicitação ativa de ' + _fmtBRF_(_dataF_(conflito.DATA_INICIO)) +
          ' a ' + _fmtBRF_(_dataF_(conflito.DATA_FIM)) + ' que se sobrepõe a este período. ' +
          'Cancele ou ajuste a existente antes de pedir de novo.');
      }
    }
  }

  return erros;
}

/* ============================================================================================ */
/*  AÇÕES DO GESTOR                                                                              */
/* ============================================================================================ */

function feriasContexto(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  const ehDP = (perfil === 'DP' || perfil === 'ADMIN');

  const visaoPedida = String((p && p.visao) || (ehDP ? 'GLOBAL' : 'GESTOR')).toUpperCase();

  // Só a visão de EQUIPE usa cache. A global (DP) é pesada e tem paginação própria.
  if (visaoPedida === 'GESTOR') {
    const dep = String((p && p.departamento) || '');
    // A versão do contrato faz o primeiro acesso após este patch ignorar contextos antigos,
    // que eram calculados a partir de PERIODOS e podiam trazer a equipe vazia.
    const chaveCache = _chaveCtx_(user.EMAIL, 'GESTOR|ROSTER_V4|' + dep + '|' + _seloFerias_());

    const doCache = _cacheGet_(chaveCache);
    if (doCache) return doCache;

    const out = _feriasContextoCalcular_(user, p, perfil, ehDP);
    _cachePut_(chaveCache, out);
    return out;
  }

  return _feriasContextoCalcular_(user, p, perfil, ehDP);
}

function _feriasContextoCalcular_(user, p, perfil, ehDP) {

  // Quem é DP/ADMIN pode alternar entre a visão da própria equipe e a visão global.
  const visao = String((p && p.visao) || (ehDP ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const comoGestor = (visao === 'GESTOR') || !ehDP;

  const periodos = _periodos_();
  const solicitacoes = _solicitacoes_();
  const afast = _afastamentosPorColaborador_();

  // O contexto nasce do cadastro de pessoas, e não de PERIODOS. Assim, quem pertence à
  // equipe continua aparecendo mesmo quando o DP ainda não gerou seu período aquisitivo.
  const rosterAtivo = _rosterAtivoFerias_();
  const emailGestor = _normalizarEmail_(user.EMAIL);
  const idsEquipePropria = _equipeFeriasDoGestor_(emailGestor);
  const idsEquipePropriaSet = {};
  idsEquipePropria.forEach(id => { idsEquipePropriaSet[_idColaboradorFerias_(id)] = true; });
  // [FIX] Aprendiz (menor aprendiz) não conta nem aparece como parte da equipe do gestor —
  // pedido explícito, reverte o comportamento anterior (aprendiz aparecia no retrato de "toda
  // a equipe", só ficava de fora da elegibilidade de férias). Filtra aqui, na origem, pra
  // tamanhoEquipePropria/podeAlternarVisao e a lista da equipe ficarem consistentes.
  const equipePropriaAtiva = rosterAtivo.filter(c =>
    !!idsEquipePropriaSet[_idColaboradorFerias_(c.ID_COLABORADOR)] && !_semDireitoAFerias_(c));

  const rosterDoEscopoAtivo = comoGestor ? equipePropriaAtiva : rosterAtivo;

  // "Toda a equipe" representa o roster ativo do escopo (pra visão GESTOR, já sem quem não tem
  // direito a férias — ver acima). Na visão GLOBAL/DP, essas pessoas (aprendizes e PJ sem cargo
  // de gestão) ainda aparecem no retrato geral, mas seguem fora do roster elegível e, portanto,
  // nunca recebem período, saldo, solicitação ou ação de agendamento neste contexto.
  const rosterCompleto = rosterDoEscopoAtivo;
  const rosterElegivel = rosterCompleto.filter(c => !_semDireitoAFerias_(c));
  const totalSemDireitoFerias = rosterCompleto.length - rosterElegivel.length;

  const rosterPorId = {};
  rosterElegivel.forEach(c => {
    rosterPorId[_idColaboradorFerias_(c.ID_COLABORADOR)] = c;
  });

  // [FIX] A aba PERIODOS nunca teve coluna ID_COLABORADOR — só MATRICULA. Casar período com
  // pessoa pelo ID_COLABORADOR (como o resto da função faz, corretamente, para dados que vêm
  // do roster) sempre dava vazio aqui, então TODO MUNDO caía como "sem período cadastrado",
  // mesmo tendo período de verdade na planilha. Resolve por MATRICULA (normalizada, tolera
  // zeros à esquerda e os artefatos que o Excel/Sheets cria tipo "12345.0") e usa o
  // ID_COLABORADOR real do roster a partir daí — o resto da função não precisa mudar.
  const rosterPorMatricula = {};
  rosterElegivel.forEach(c => {
    const mat = _normalizarMatricula_(c.MATRICULA);
    if (mat) rosterPorMatricula[mat] = c;
  });
  function _idColaboradorDoPeriodo_(x) {
    const direto = _idColaboradorFerias_(x.ID_COLABORADOR);
    if (direto && rosterPorId[direto]) return direto;
    const porMatricula = rosterPorMatricula[_normalizarMatricula_(x.MATRICULA)];
    return porMatricula ? _idColaboradorFerias_(porMatricula.ID_COLABORADOR) : direto;
  }

  // [FIX] A checagem original exigia x.ID_PERIODO preenchido — coluna que também não existe
  // na aba PERIODOS (só em SOLICITACOES, que já usa o esquema novo PER-xxxx/COL-xxxx). Como
  // isso nunca vinha preenchido, filtrava TODO período pra fora. Troquei pelo sinal que
  // realmente indica um período aquisitivo completo nesta planilha: ter as datas gravadas.
  const periodosDoEscopo = periodos.filter(x =>
    !!rosterPorId[_idColaboradorDoPeriodo_(x)] && !!_dataF_(x.AQUIS_INICIO) && !!_dataF_(x.AQUIS_FIM));

  // Uma pessoa pode ter vários períodos aquisitivos. A função também preserva um período
  // adicional quando ele possui solicitação ativa, comportamento necessário para os cards.
  const periodosExibiveis = _periodoVigentePorPessoa_(periodosDoEscopo, solicitacoes);

  // Estado consolidado por PESSOA. Ele alimenta departamentos e contadores sem inflar os
  // números quando um colaborador possui dois ou mais períodos na planilha.
  const estadoPorPessoa = {};
  periodosExibiveis.forEach(x => {
    const id = _idColaboradorDoPeriodo_(x);
    if (!id) return;

    if (!estadoPorPessoa[id]) {
      estadoPorPessoa[id] = {
        temPeriodo: false, comSaldo: false, critico: false,
        aguardandoDP: false, confirmadas: false
      };
    }

    const estado = estadoPorPessoa[id];
    estado.temPeriodo = true;

    const saldo = _saldoDoPeriodo_(x, solicitacoes);
    if (saldo > 0) estado.comSaldo = true;

    const limitePessoa = _dataF_(x.CONCEDER_ATE);
    const diasAteLimite = limitePessoa
      ? Math.round((limitePessoa - _hojeFerias_()) / 86400000)
      : null;

    if (saldo > 0 && diasAteLimite !== null && diasAteLimite < 60 &&
        !_estaAfastadoAgora_(id, afast)) {
      estado.critico = true;
    }

    const doPeriodo = _indiceSolicitacoesPorPeriodo_(solicitacoes)[String(x.ID_PERIODO)] || [];
    if (doPeriodo.some(s => String(s.STATUS || '').toUpperCase() === 'PENDENTE')) {
      estado.aguardandoDP = true;
    }
    if (doPeriodo.some(s =>
      String(s.STATUS || '').toUpperCase() === 'DEFERIDA' && !!_dataF_(s.DATA_INICIO))) {
      estado.confirmadas = true;
    }
  });

  // Lista de departamentos da equipe (leve): sempre vai, para montar o filtro no topo.
  // O total vem do roster, inclusive para quem ainda não possui PERIODOS.
  const deptoMap = {};
  rosterCompleto.forEach(c => {
    const id = _idColaboradorFerias_(c.ID_COLABORADOR);
    const d = _departamentoColaboradorFerias_(c);
    const estado = estadoPorPessoa[id] || {};
    const semDireito = _semDireitoAFerias_(c);

    if (!deptoMap[d]) {
      deptoMap[d] = {
        nome: d, total: 0, comSaldo: 0, criticos: 0,
        aguardandoDP: 0, confirmadas: 0, semPeriodo: 0,
        elegiveisFerias: 0, semDireitoFerias: 0
      };
    }

    deptoMap[d].total++;
    if (semDireito) {
      deptoMap[d].semDireitoFerias++;
      return;
    }

    deptoMap[d].elegiveisFerias++;
    if (estado.comSaldo) deptoMap[d].comSaldo++;
    if (estado.critico) deptoMap[d].criticos++;
    if (estado.aguardandoDP) deptoMap[d].aguardandoDP++;
    if (estado.confirmadas) deptoMap[d].confirmadas++;
    if (!estado.temPeriodo) deptoMap[d].semPeriodo++;
  });

  const departamentos = Object.keys(deptoMap)
    .map(k => deptoMap[k])
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  // Equipe grande: se não escolheu departamento, NÃO carrega a lista de gente ainda.
  // Vale tanto pro gestor com equipe grande (ex.: Vander) quanto pra visão geral do DP/ADMIN —
  // nos dois casos, é melhor pedir pra escolher um departamento do que travar ou carregar
  // um volume gigante de uma vez.
  const filtroDepto = String((p && p.departamento) || '').trim();
  const LIMIAR = Number(_feriasParam_('EQUIPE_LIMIAR_DEPTO', 60));
  const equipeGrande = rosterCompleto.length > LIMIAR;

  let carregarPessoas = true;
  let rosterVisivel = rosterCompleto;

  // Aplicar o filtro ao roster (não aos períodos) garante que pessoas sem período também
  // sejam encontradas. Em equipes pequenas o filtro normalmente vem vazio, mas respeitá-lo
  // torna o contrato consistente e seguro em chamadas diretas da API.
  if (filtroDepto) {
    rosterVisivel = rosterCompleto.filter(c =>
      _departamentoColaboradorFerias_(c) === filtroDepto);
  } else if (equipeGrande) {
    carregarPessoas = false;   // só os departamentos; a pessoa escolhe um
  }

  // Guarda de segurança: mesmo depois de filtrar por departamento, se ainda assim vier um
  // volume gigante (departamento gigante, ou erro de cadastro apontando gente demais pro
  // mesmo departamento), evita travar o carregamento.
  const limite = Number(_feriasParam_('CONTEXTO_MAX_REGISTROS', 400));

  if (carregarPessoas && rosterVisivel.length > limite) {
    throw new Error(
      'Este filtro ainda traz ' + rosterVisivel.length + ' pessoas - pesado demais para carregar de uma vez. ' +
      'Tente um departamento mais específico, ou use o Portal do DP (que também carrega por filtro).'
    );
  }

  const idsVisiveis = {};
  rosterVisivel.forEach(c => {
    idsVisiveis[_idColaboradorFerias_(c.ID_COLABORADOR)] = true;
  });

  const meus = carregarPessoas
    ? periodosExibiveis.filter(x => !!idsVisiveis[_idColaboradorDoPeriodo_(x)])
    : [];

  let colaboradores = meus.map(p => {
    const idColaborador = _idColaboradorDoPeriodo_(p);
    const cLive = rosterPorId[idColaborador] || _colaboradorPorId_(p.ID_COLABORADOR) || {};
    const saldo = _saldoDoPeriodo_(p, solicitacoes);
    const concederAte = _dataF_(p.CONCEDER_ATE);
    const diasAte = concederAte ? Math.round((concederAte - _hojeFerias_()) / 86400000) : null;

    const fimAquis = _dataF_(p.AQUIS_FIM);
    const prazoAbono = fimAquis
      ? _addDiasF_(fimAquis, -Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', 15)))
      : null;
    const abonoNoPrazo = prazoAbono ? (_hojeFerias_() <= prazoAbono) : false;

    const doPeriodoAtual = _indiceSolicitacoesPorPeriodo_(solicitacoes)[String(p.ID_PERIODO)] || [];

    const abonoJa = doPeriodoAtual
      .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
      .reduce((t, s) => t + Number(s.ABONO || 0), 0);

    const abonoMax = Math.max(0, Math.min(
      Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS)),
      Math.floor(Number(p.DIAS_DIREITO || 0) / 3)
    ) - abonoJa);

    const autorizado = _sim_(p.ABONO_AUTORIZADO);

    const sols = doPeriodoAtual
      .map(s => ({
        id: s.ID_SOLICITACAO,
        dias: Number(s.DIAS || 0),
        abono: Number(s.ABONO || 0),
        inicio: _isoF_(s.DATA_INICIO),
        fim: _isoF_(s.DATA_FIM),
        status: String(s.STATUS || '').toUpperCase(),
        motivo: s.MOTIVO || '',
        solicitadoPor: s.SOLICITADO_POR || '',
        decididoEm: _isoF_(s.DECIDIDO_EM)
      }));

    const statusPeriodo = String(p.STATUS || '').toUpperCase();
    const emCurso = statusPeriodo === 'EM_CURSO';
    const disponivelEm = emCurso && fimAquis ? _addDiasF_(fimAquis, 1) : null;
    const afastadoAgora = _estaAfastadoAgora_(idColaborador, afast);

    return {
      idPeriodo: p.ID_PERIODO,
      idColaborador: idColaborador,
      nome: cLive.NOME || p.NOME || ('Colaborador ' + idColaborador),
      empresa: cLive.EMPRESA || p.EMPRESA || '',
      departamento: _departamentoColaboradorFerias_(cLive),
      matricula: cLive.MATRICULA || p.MATRICULA || '',
      cargo: cLive.CARGO || cLive.FUNCAO || '',
      periodoAquisitivo: _fmtBRF_(_dataF_(p.AQUIS_INICIO)) + ' a ' + _fmtBRF_(_dataF_(p.AQUIS_FIM)),
      aquisFimISO: _isoF_(p.AQUIS_FIM),
      diasDireito: Number(p.DIAS_DIREITO || 0),
      saldo: saldo,
      semPeriodo: false,
      naoElegivelFerias: false,
      aprendiz: false,
      // Recém-admitido: período aquisitivo ainda correndo. Aparece no retrato da equipe,
      // mas não pode agendar ainda, o front mostra "disponível a partir de X".
      emCurso: emCurso,
      disponivelEmISO: disponivelEm ? _isoF_(disponivelEm) : '',
      disponivelEm: disponivelEm ? _fmtBRF_(disponivelEm) : '',
      concederAte: _fmtBRF_(concederAte),
      concederAteISO: _isoF_(p.CONCEDER_ATE),
      diasAteVencer: diasAte,
      // Afastado agora não entra como "prazo apertado" (não pode agendar mesmo, então não
      // faz sentido pressionar o gestor com um prazo que ele não controla).
      afastadoAgora: afastadoAgora,
      // VENCIDO (diasAte negativo) é distinto de CRITICO: já passou do prazo legal, não só
      // "está apertado" — o gestor não consegue mais agendar pela janela normal de datas.
      urgencia: afastadoAgora ? '' : (diasAte === null ? '' : (diasAte < 0 ? 'VENCIDO' : (diasAte < 60 ? 'CRITICO' : (diasAte < 120 ? 'ATENCAO' : 'OK')))),
      podeSolicitar: saldo > 0,

      abono: {
        permitido: autorizado && abonoMax > 0,
        maximo: autorizado ? abonoMax : 0,
        autorizadoPeloDP: autorizado,
        excecao: _sim_(p.ABONO_EXCECAO),
        pedidoEm: p.ABONO_PEDIDO_EM ? _fmtBRF_(p.ABONO_PEDIDO_EM) : '',
        noPrazo: abonoNoPrazo,
        prazoFinal: prazoAbono ? _fmtBRF_(prazoAbono) : '',
        aviso: !autorizado
          ? 'A venda de dias precisa ser solicitada pelo colaborador ao Departamento Pessoal, ' +
            'dentro do período aquisitivo (o prazo deste período era até ' +
            (prazoAbono ? _fmtBRF_(prazoAbono) : ',') + '). Depois que o DP registrar o pedido, a opção libera aqui.'
          : (abonoMax <= 0 ? 'O limite de venda de dias deste período já foi usado.' : '')
      },

      solicitacoes: sols
    };
  });

  // Completa o retrato com quem está na equipe ativa, mas ainda não possui PERIODOS, e
  // também com quem não tem direito a férias (aprendiz ou PJ sem cargo de gestão). Ambos
  // seguem o contrato completo e são não agendáveis, mas usam flags distintas para o front
  // explicar corretamente o motivo.
  if (carregarPessoas) {
    const idsComPeriodo = {};
    colaboradores.forEach(c => {
      idsComPeriodo[_idColaboradorFerias_(c.idColaborador)] = true;
    });

    rosterVisivel.forEach(c => {
      const id = _idColaboradorFerias_(c.ID_COLABORADOR);
      const aprendiz = _semDireitoAFerias_(c);
      if (!id || (!aprendiz && idsComPeriodo[id])) return;

      const afastadoAgora = _estaAfastadoAgora_(id, afast);

      if (aprendiz) {
        const motivo = _ehAprendiz_(c) ? 'Contrato de aprendizagem' : 'PJ sem cargo de gestão';
        colaboradores.push({
          idPeriodo: '',
          idColaborador: id,
          nome: c.NOME || ('Colaborador ' + id),
          empresa: c.EMPRESA || '',
          departamento: _departamentoColaboradorFerias_(c),
          matricula: c.MATRICULA || '',
          cargo: c.CARGO || c.FUNCAO || '',
          periodoAquisitivo: motivo,
          aquisFimISO: '',
          diasDireito: 0,
          saldo: 0,
          semPeriodo: false,
          naoElegivelFerias: true,
          aprendiz: true,
          emCurso: false,
          disponivelEmISO: '',
          disponivelEm: '',
          concederAte: '',
          concederAteISO: '',
          diasAteVencer: null,
          afastadoAgora: afastadoAgora,
          urgencia: '',
          podeSolicitar: false,
          abono: {
            permitido: false,
            maximo: 0,
            autorizadoPeloDP: false,
            excecao: false,
            pedidoEm: '',
            noPrazo: false,
            prazoFinal: '',
            aviso: motivo + ': não há agendamento de gozo de férias neste módulo.'
          },
          solicitacoes: []
        });
        return;
      }

      colaboradores.push({
        idPeriodo: '',
        idColaborador: id,
        nome: c.NOME || ('Colaborador ' + id),
        empresa: c.EMPRESA || '',
        departamento: _departamentoColaboradorFerias_(c),
        matricula: c.MATRICULA || '',
        cargo: c.CARGO || c.FUNCAO || '',
        periodoAquisitivo: 'Período ainda não cadastrado',
        aquisFimISO: '',
        diasDireito: 0,
        saldo: 0,
        semPeriodo: true,
        naoElegivelFerias: false,
        aprendiz: false,
        emCurso: false,
        disponivelEmISO: '',
        disponivelEm: '',
        concederAte: '',
        concederAteISO: '',
        diasAteVencer: null,
        afastadoAgora: afastadoAgora,
        urgencia: '',
        podeSolicitar: false,
        abono: {
          permitido: false,
          maximo: 0,
          autorizadoPeloDP: false,
          excecao: false,
          pedidoEm: '',
          noPrazo: false,
          prazoFinal: '',
          aviso: 'O Departamento Pessoal ainda não cadastrou o período aquisitivo desta pessoa.'
        },
        solicitacoes: []
      });
    });
  }

  colaboradores.sort((a, b) => {
    const prazoA = a.diasAteVencer === null ? 99999 : a.diasAteVencer;
    const prazoB = b.diasAteVencer === null ? 99999 : b.diasAteVencer;
    return prazoA - prazoB || String(a.nome || '').localeCompare(String(b.nome || ''));
  });

  // Períodos EM CURSO: não dá para agendar férias, mas DÁ para pedir a venda de dias, se no prazo.
  const prazoDias = Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', FERIAS.ABONO_PRAZO_ANTES_FIM_AQUIS));
  const abonoMaxPadrao = Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS));
  const hojeF = _hojeFerias_();

  const emCurso = meus
    .filter(x => String(x.STATUS || '').toUpperCase() === 'EM_CURSO')
    .map(x => {
      const fimAquis = _dataF_(x.AQUIS_FIM);
      const limite = fimAquis ? _addDiasF_(fimAquis, -prazoDias) : null;
      const noPrazo = limite ? (hojeF <= limite) : false;
      const st = String(x.ABONO_STATUS || '').toUpperCase();

      return {
        idPeriodo: x.ID_PERIODO,
        idColaborador: x.ID_COLABORADOR,
        nome: x.NOME,
        periodoAquisitivo: _fmtBRF_(x.AQUIS_INICIO) + ' a ' + _fmtBRF_(fimAquis),
        fimAquisitivo: _fmtBRF_(fimAquis),
        prazoPedido: limite ? _fmtBRF_(limite) : '',
        diasAteOPrazo: limite ? Math.round((limite - hojeF) / 86400000) : null,
        noPrazo: noPrazo,
        maximoDias: Math.min(abonoMaxPadrao, Math.floor(Number(x.DIAS_DIREITO || 30) / 3)),
        status: st || 'NAO_PEDIDO',
        diasPedidos: Number(x.ABONO_DIAS_PEDIDOS || 0),
        podePedir: noPrazo && !st
      };
    })
    .filter(x => x.noPrazo || x.status === 'SOLICITADO' || x.status === 'LIBERADO')
    .sort((a, b) => (a.diasAteOPrazo || 0) - (b.diasAteOPrazo || 0));

  const rosterDoResumo = carregarPessoas ? rosterVisivel : rosterCompleto;
  const resumoRoster = rosterDoResumo.reduce((acc, c) => {
    if (_semDireitoAFerias_(c)) {
      acc.semDireitoFerias++;
      return acc;
    }

    acc.elegiveisFerias++;
    const estado = estadoPorPessoa[_idColaboradorFerias_(c.ID_COLABORADOR)] || {};
    if (estado.comSaldo) acc.comSaldo++;
    if (estado.critico) acc.criticos++;
    if (estado.aguardandoDP) acc.pendentes++;
    if (estado.confirmadas) acc.confirmadas++;
    if (!estado.temPeriodo) acc.semPeriodo++;
    return acc;
  }, {
    comSaldo: 0, criticos: 0, pendentes: 0, confirmadas: 0,
    semPeriodo: 0, elegiveisFerias: 0, semDireitoFerias: 0
  });

  return {
    ok: true,
    modulo: 'FERIAS',
    versao: FERIAS.VERSAO,
    perfil: user.PERFIL,

    visao: comoGestor ? 'GESTOR' : 'GLOBAL',
    podeAlternarVisao: ehDP && equipePropriaAtiva.length > 0,
    tamanhoEquipePropria: equipePropriaAtiva.length,

    guiaUrl: String(_feriasParam_('GUIA_FERIAS_URL', '')),

    regras: {
      antecedenciaMinimaDias: Number(_feriasParam_('ANTECEDENCIA_MINIMA_DIAS', FERIAS.ANTECEDENCIA_MINIMA_DIAS)),
      abonoMaximoDias: Number(_feriasParam_('ABONO_MAXIMO_DIAS', FERIAS.ABONO_MAXIMO_DIAS)),
      diasInicioBloqueados: FERIAS.DIAS_INICIO_BLOQUEADOS,
      fracaoMinima: FERIAS.FRACAO_MINIMA,
      fracaoMaiorMinima: FERIAS.FRACAO_MAIOR_MINIMA,
      maxFracoes: FERIAS.MAX_FRACOES,
      feriados: _feriadosMapF_()
    },
    resumo: {
      // Contagens de pessoas, não de períodos/cards.
      colaboradores: rosterDoResumo.length,
      comSaldo: resumoRoster.comSaldo,
      criticos: resumoRoster.criticos,
      pendentes: resumoRoster.pendentes,
      confirmadas: resumoRoster.confirmadas,
      semPeriodo: resumoRoster.semPeriodo,
      elegiveisFerias: resumoRoster.elegiveisFerias,
      semDireitoFerias: resumoRoster.semDireitoFerias
    },

    colaboradores: colaboradores,
    abonoEmCurso: carregarPessoas ? emCurso : [],

    // filtro de departamento (para equipes grandes)
    equipeGrande: equipeGrande,
    pessoasCarregadas: carregarPessoas,
    departamentoAtivo: filtroDepto,
    departamentos: departamentos,
    totalNaEquipe: rosterCompleto.length,
    totalElegiveisFerias: rosterElegivel.length,
    totalNoFiltro: rosterVisivel.length,
    totalSemDireitoFerias: totalSemDireitoFerias,
    totalSemPeriodo: departamentos.reduce((t, d) => t + d.semPeriodo, 0)
  };
}

/* ============================================================================================ */
/*  FÉRIAS DE FIM DE ANO — uma opção por pessoa, com extensão automática pra cumprir a lei       */
/* ============================================================================================ */

/**
 * Saldo "projetado" pra fins de fim de ano: ignora a trava de EM_CURSO, porque o gozo
 * dessas férias só acontece em dezembro/janeiro — se o período aquisitivo já vai ter
 * encerrado até lá, a pessoa TEM direito, mesmo que hoje o status ainda esteja em curso.
 * PERDIDO/CONGELADO continuam sem saldo de verdade (isso não é sobre data, é sobre direito).
 */
/**
 * Colaborador ainda está no quadro? Falso se a linha já não existe mais na MASTER, OU se a
 * SITUACAO indica desligamento. Usado pra tirar quem já saiu das telas de férias, mesmo
 * quando o sumiço do RAIO-X nunca foi formalizado por uma rescisão dentro do DP360.
 */
function _colaboradorEstaAtivo_(idColaborador) {
  const c = _colaboradorPorId_(idColaborador);
  if (!c) return false;
  const sit = String(c.SITUACAO || '').toUpperCase();
  return sit.indexOf('DESLIGAD') === -1 && sit.indexOf('DEMITID') === -1 && sit.indexOf('INATIVO') === -1;
}

/** Garante que a MASTER tenha a coluna DATA_DESLIGAMENTO (cria ao final se não existir). */
function _garantirColunaDataDesligamento_(sh) {
  const h = _headers_(sh);
  if (h.indexOf('DATA_DESLIGAMENTO') > -1) return h;
  sh.getRange(1, h.length + 1).setValue('DATA_DESLIGAMENTO');
  return h.concat(['DATA_DESLIGAMENTO']);
}

/**
 * Conserto manual pra quem já saiu de verdade (sumiu do RAIO-X) mas nunca teve uma rescisão
 * registrada dentro do DP360 — por isso continuava aparecendo nas telas de férias como se
 * ainda estivesse no quadro. Aceita nome OU matrícula.
 * dataDesligamento é opcional — se não vier, usa hoje (fallback pra quando não se sabe a data
 * real, ex.: sumiço detectado só pela ausência no RAIO-X, sem registro formal de rescisão).
 */
function marcarColaboradorDesligado(nomeOuMatricula, dataDesligamento) {
  const colaboradores = _colaboradores_();
  const alvo = String(nomeOuMatricula).toUpperCase().trim();

  const c = colaboradores.find(x =>
    String(x.NOME || '').toUpperCase().trim() === alvo ||
    _normalizarMatricula_(x.MATRICULA) === _normalizarMatricula_(nomeOuMatricula));

  if (!c) return { erro: 'Colaborador não encontrado: ' + nomeOuMatricula };

  const sh = _masterSS_().getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const h = _garantirColunaDataDesligamento_(sh);

  _atualizarLinha_(sh, c._rowNumber, h, {
    SITUACAO: 'Desligado',
    DATA_DESLIGAMENTO: dataDesligamento || new Date()
  });
  _invalidarCacheFerias_();

  return { ok: true, mensagem: c.NOME + ' (matrícula ' + (c.MATRICULA || ',') + ') marcado(a) como desligado(a). Deixa de aparecer nas telas de férias a partir de agora.' };
}

/**
 * Teste manual e autolimpante: cria um colaborador FAKE (matrícula TESTE999) só pra essa
 * execução, roda marcarColaboradorDesligado() nele, confere o resultado na planilha, e apaga
 * a linha de teste no final — não toca em nenhum colaborador real. Rode direto no editor
 * (selecione esta função e clique em Executar) e leia o resultado no log de execução.
 */
function testarMarcarColaboradorDesligado() {
  const MATRICULA_TESTE = 'TESTE999';
  const NOME_TESTE = 'TESTE AUTOMACAO (pode apagar)';

  const sh = _masterSS_().getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const headerColab = _headers_(sh);
  const idxMatricula = headerColab.indexOf('MATRICULA');
  const idxSituacao = headerColab.indexOf('SITUACAO');
  if (idxMatricula === -1) throw new Error('Coluna MATRICULA não encontrada em COLABORADORES.');
  if (idxSituacao === -1) throw new Error('Coluna SITUACAO não encontrada em COLABORADORES.');

  // Limpa resíduo de uma execução de teste anterior, se sobrou.
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha > 1) {
    const matriculas = sh.getRange(2, idxMatricula + 1, ultimaLinha - 1, 1).getValues();
    for (let i = matriculas.length - 1; i >= 0; i--) {
      if (String(matriculas[i][0]) === MATRICULA_TESTE) sh.deleteRow(i + 2);
    }
  }

  const linha = headerColab.map(h => {
    if (h === 'ID_COLABORADOR') return 'TESTE-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    if (h === 'MATRICULA') return MATRICULA_TESTE;
    if (h === 'NOME') return NOME_TESTE;
    if (h === 'SITUACAO') return 'Ativo';
    return '';
  });
  sh.appendRow(linha);
  const linhaTeste = sh.getLastRow();
  _invalidarCacheFerias_(); // garante que marcarColaboradorDesligado enxergue a linha recém-criada

  let resultado, situacaoDepois;
  try {
    resultado = marcarColaboradorDesligado(MATRICULA_TESTE);
    situacaoDepois = sh.getRange(linhaTeste, idxSituacao + 1).getValue();

    console.log('Resultado de marcarColaboradorDesligado(): ' + JSON.stringify(resultado));
    console.log('SITUACAO gravada na planilha: "' + situacaoDepois + '"');
    console.log(situacaoDepois === 'Desligado'
      ? '✅ TESTE PASSOU: a função atualiza SITUACAO corretamente.'
      : '❌ TESTE FALHOU: SITUACAO não ficou "Desligado".');
  } finally {
    sh.deleteRow(linhaTeste); // limpeza: nunca deixa o fake na base, mesmo se algo der errado acima
    _invalidarCacheFerias_();
  }

  return { resultado: resultado, situacaoGravada: situacaoDepois, passou: situacaoDepois === 'Desligado' };
}

function _saldoFimDeAno_(periodo, solicitacoes) {
  const status = String(periodo.STATUS || '').toUpperCase();
  if (status === 'PERDIDO' || status === 'CONGELADO') return 0;

  const direito = Number(periodo.DIAS_DIREITO || 0);
  const anteriores = Number(periodo.DIAS_GOZADOS_ANTERIORES || 0);

  const doPeriodo = _indiceSolicitacoesPorPeriodo_(solicitacoes)[String(periodo.ID_PERIODO)] || [];
  const comprometidos = doPeriodo
    .filter(s => FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1)
    .reduce((soma, s) => soma + Number(s.DIAS || 0) + Number(s.ABONO || 0), 0);

  return direito - anteriores - comprometidos;
}

/**
 * Lista, dentro da equipe do gestor, quem tem saldo pra tirar férias de fim de ano
 * (saldo projetado >= 10, e pelo menos uma das opções cai depois do fim do aquisitivo dela).
 * Cada pessoa vem só com as opções que fazem sentido pro caso dela (ex.: se o aquisitivo só
 * termina depois de 15/12, a Opção 1 nem aparece — só a Opção 2).
 */
function feriasElegiveisFimDeAno(user, p) {
  // [PERF] Cada chamada dessa é uma execução separada do srvCarregar principal, então o
  // cache "por execução" não ajuda aqui — essa função sempre relê periodos/solicitacoes do
  // zero. Como a elegibilidade não muda segundo a segundo, cacheia o resultado pronto por
  // gestor, por um tempo curto (5 min). Refresca sozinho depois disso.
  const email = _normalizarEmail_(user.EMAIL);
  const cache = CacheService.getScriptCache();
  const chave = 'FIMDEANO_V3_' + Utilities.base64EncodeWebSafe(email).replace(/=+$/, '');

  const hit = cache.get(chave);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* segue e recalcula */ }
  }

  const resultado = _feriasElegiveisFimDeAnoCalcular_(user, p);

  try { cache.put(chave, JSON.stringify(resultado), 300); } catch (e) { /* resultado grande demais: segue sem cache */ }

  return resultado;
}

function _feriasElegiveisFimDeAnoCalcular_(user, p) {
  const idsEquipe = _equipeFeriasDoGestor_(user.EMAIL);
  const idsEquipeSet = {};
  idsEquipe.forEach(id => { idsEquipeSet[_idColaboradorFerias_(id)] = true; });
  const periodos = _periodos_().filter(x =>
    !!idsEquipeSet[_idColaboradorFerias_(x.ID_COLABORADOR)] &&
    ['PERDIDO', 'CONGELADO'].indexOf(String(x.STATUS || '').toUpperCase()) === -1);
  const sols = _solicitacoes_();
  const matriculasPermitidas = {};
  _fimDeAnoMatriculasPermitidas_().forEach(m => { matriculasPermitidas[m] = true; });

  const porPessoa = {};
  periodos.forEach(per => {
    const id = String(per.ID_COLABORADOR);
    if (!porPessoa[id]) porPessoa[id] = [];
    porPessoa[id].push(per);
  });

  const elegiveis = [];
  const bloqueados = [];

  Object.keys(porPessoa).forEach(id => {
    const jaSolicitouNestaCampanha = sols.some(s =>
      _idColaboradorFerias_(s.ID_COLABORADOR) === _idColaboradorFerias_(id) &&
      FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
      String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1
    );
    if (jaSolicitouNestaCampanha) return;

    const lista = porPessoa[id].sort((a, b) => {
      const da = _dataF_(a.AQUIS_INICIO), db = _dataF_(b.AQUIS_INICIO);
      return (da && db) ? da - db : 0;
    });

    // o mais antigo período com saldo projetado suficiente
    const alvo = lista.find(per => _saldoFimDeAno_(per, sols) >= 10);
    if (!alvo) return;

    // Filtros da campanha 2026: só quem está na lista validada pelo DP, ainda está no
    // quadro (não foi desligado), e não é aprendiz (aprendiz não tem direito a férias,
    // só recebe o valor na rescisão).
    const colabLive = _colaboradorPorId_(alvo.ID_COLABORADOR);
    if (!colabLive) return; // já não existe mais no quadro atual
    if (!_colaboradorEstaAtivo_(alvo.ID_COLABORADOR)) return; // situação indica desligado

    const matriculaAlvo = _normalizarMatricula_(colabLive.MATRICULA) ||
      _normalizarMatricula_(alvo.MATRICULA);
    if (!matriculasPermitidas[matriculaAlvo]) return;

    if (_semDireitoAFerias_(colabLive)) return;

    const saldo = _saldoFimDeAno_(alvo, sols);
    const aquisFim = _dataF_(alvo.AQUIS_FIM);
    const concederAte = _dataF_(alvo.CONCEDER_ATE);

    const opcoesValidas = [];
    let algumaVencida = false;

    FERIAS.OPCOES_FIM_DE_ANO.forEach(o => {
      if (aquisFim && _dataF_(o.inicio) <= aquisFim) return; // ainda não teria direito nessa data

      const calc = _calcularOpcaoFimDeAno_(alvo, o.id, saldo, sols);
      if (!calc.disponivel) {
        if (calc.motivoCodigo === 'CONCEDER_ATE_VENCIDO') algumaVencida = true;
        return; // ex.: a Opção 1 cairia num dia de início bloqueado
      }

      opcoesValidas.push({
        id: o.id,
        inicio: _fmtBRF_(calc.inicio),
        fim: _fmtBRF_(calc.fim),
        dias: calc.dias
      });
    });

    if (opcoesValidas.length) {
      elegiveis.push({
        idPeriodo: alvo.ID_PERIODO,
        idColaborador: alvo.ID_COLABORADOR,
        nome: alvo.NOME,
        saldo: saldo,
        opcoes: opcoesValidas
      });
      return;
    }

    // Nenhuma opção da campanha coube porque o prazo legal "conceder até" dela já passou (ou
    // passa) antes das duas datas fixas de dezembro — não é "ainda não é elegível" (isso é
    // normal, período aquisitivo em curso), é o saldo dela já estar atrasado de verdade.
    // Avisa o gestor em vez de só sumir a pessoa da lista, silenciosamente.
    if (algumaVencida) {
      bloqueados.push({
        idPeriodo: alvo.ID_PERIODO,
        idColaborador: alvo.ID_COLABORADOR,
        nome: alvo.NOME,
        saldo: saldo,
        concederAte: _fmtBRF_(concederAte)
      });
    }
  });

  elegiveis.sort((a, b) => a.nome.localeCompare(b.nome));
  bloqueados.sort((a, b) => a.nome.localeCompare(b.nome));

  const inicioGestor = _dataF_(FERIAS.FIM_DE_ANO_INICIO_GESTOR);
  const prazoGestor = _dataF_(FERIAS.FIM_DE_ANO_PRAZO_GESTOR);
  const hoje = _hojeFerias_();
  const aindaNaoAbriu = FERIAS.FIM_DE_ANO_PERMITIR_ANTES ? false : (inicioGestor ? hoje < inicioGestor : false);
  const dentroDoPrazo = !aindaNaoAbriu && (prazoGestor ? hoje <= prazoGestor : true);

  return {
    ok: true,
    total: elegiveis.length,
    colaboradores: elegiveis,
    bloqueados: bloqueados,
    inicioGestor: _fmtBRF_(inicioGestor),
    prazoGestor: _fmtBRF_(prazoGestor),
    aindaNaoAbriu: aindaNaoAbriu,
    dentroDoPrazo: dentroDoPrazo
  };
}

/**
 * FERIAS.AGENDADOS_FIM_DE_ANO — devolve quem, na equipe do gestor, já tem uma solicitação de
 * férias de fim de ano ativa (PENDENTE/DEFERIDA), pra alimentar a aba "Agendados" do portal
 * (essas pessoas já saíram da lista de elegíveis — ver o filtro jaSolicitouNestaCampanha em
 * _feriasElegiveisFimDeAnoCalcular_ — e precisam de um lugar pra aparecer).
 */
function feriasAgendadosFimDeAno(user, p) {
  // [PERF] Mesmo cache de 5 min por gestor usado em feriasElegiveisFimDeAno — evita reler
  // periodos/solicitacoes do zero a cada troca de aba.
  const email = _normalizarEmail_(user.EMAIL);
  const cache = CacheService.getScriptCache();
  const chave = 'FIMDEANO_AGENDADOS_V1_' + Utilities.base64EncodeWebSafe(email).replace(/=+$/, '');

  const hit = cache.get(chave);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* segue e recalcula */ }
  }

  const resultado = _feriasAgendadosFimDeAnoCalcular_(user, p);

  try { cache.put(chave, JSON.stringify(resultado), 300); } catch (e) { /* resultado grande demais: segue sem cache */ }

  return resultado;
}

function _feriasAgendadosFimDeAnoCalcular_(user, p) {
  const idsEquipe = _equipeFeriasDoGestor_(user.EMAIL);
  const idsEquipeSet = {};
  idsEquipe.forEach(id => { idsEquipeSet[_idColaboradorFerias_(id)] = true; });

  const sols = _solicitacoes_();
  const agendados = sols.filter(s =>
    !!idsEquipeSet[_idColaboradorFerias_(s.ID_COLABORADOR)] &&
    FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
    String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1
  );

  const colaboradores = agendados.map(s => ({
    idSolicitacao: s.ID_SOLICITACAO,
    nome: s.NOME,
    dias: Number(s.DIAS || 0),
    inicio: _fmtBRF_(_dataF_(s.DATA_INICIO)),
    fim: _fmtBRF_(_dataF_(s.DATA_FIM)),
    status: s.STATUS
  }));

  colaboradores.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  return { ok: true, total: colaboradores.length, colaboradores: colaboradores };
}

/**
 * Calcula a data final da opção pedida. Parte dos 10 dias fixos; se isso deixaria TANTO essa
 * fração QUANTO o saldo restante abaixo de 14 dias (ou seja: nem essa, nem uma futura, fechariam
 * a exigência do art. 134 §1º), puxa o saldo INTEIRO pra essa única solicitação.
 *   Opção 1: estica o INÍCIO pra trás (mantém o fim fixo em 24/12). Se a nova data cair em dia
 *            bloqueado (qui/sex/sáb/dom), a Opção 1 NÃO fica disponível para essa pessoa —
 *            não buscamos outro dia, simplesmente não oferecemos essa opção (só a Opção 2 resta).
 *   Opção 2: estica o FIM pra frente (mantém o início fixo em 28/12) — sem restrição de
 *            dia da semana no fim, então sempre cabe.
 * Retorna { disponivel:false, motivo } quando a opção não pode ser usada por essa pessoa.
 */
function _calcularOpcaoFimDeAno_(periodo, opcaoId, saldo, solicitacoes) {
  const opcao = FERIAS.OPCOES_FIM_DE_ANO.find(o => o.id === opcaoId);
  if (!opcao) throw new Error('Opção inválida.');

  // abono já liberado é descontado — venda de dias não é fração de descanso
  const anteriores = _gozoRealAnterior_(periodo);
  const fracoesExistentes = _fracoesDoPeriodo_(periodo.ID_PERIODO, solicitacoes);
  const jaTem14 = anteriores >= FERIAS.FRACAO_MAIOR_MINIMA ||
    fracoesExistentes.some(f => Number(f.DIAS || 0) >= FERIAS.FRACAO_MAIOR_MINIMA);

  let dias = opcao.dias; // 10, o padrão
  const saldoDepoisBase = saldo - dias;

  // só precisa esticar quando NEM essa fração NEM o resto do saldo, se deixado de fora
  // agora, teriam como virar uma fração válida de 14+ no futuro.
  if (!jaTem14 && dias < FERIAS.FRACAO_MAIOR_MINIMA && saldoDepoisBase > 0 && saldoDepoisBase < FERIAS.FRACAO_MAIOR_MINIMA) {
    dias = saldo; // puxa o saldo inteiro pra essa única solicitação
  }

  let inicio = _dataF_(opcao.inicio);
  let fim = _dataF_(opcao.fim);
  const extra = dias - opcao.dias;

  if (extra > 0) {
    if (opcao.id === 'OPCAO_1') {
      const novoInicio = _addDiasF_(inicio, -extra);

      if (FERIAS.DIAS_INICIO_BLOQUEADOS.indexOf(novoInicio.getDay()) > -1) {
        return {
          id: opcao.id,
          disponivel: false,
          motivoCodigo: 'DIA_INICIO_BLOQUEADO',
          motivo: 'Pra fechar os ' + dias + ' dias exigidos por lei, a Opção 1 precisaria começar ' +
            'num dia não permitido. Use a Opção 2 para esta pessoa.'
        };
      }

      inicio = novoInicio;
    } else {
      fim = _addDiasF_(fim, extra);
    }
  }

  // [FIX] O período pode ter um prazo legal "conceder até" mais apertado do que as datas
  // fixas da campanha de fim de ano (ex.: período aquisitivo vencido cedo). Sem esta trava,
  // a opção aparecia como "disponível" pro gestor e só falhava ao confirmar — descobrimos
  // isso com um caso real (Saulo/Maria Clara, conceder até 28/09/2026, opções em dezembro).
  const concederAte = _dataF_(periodo.CONCEDER_ATE);
  if (concederAte && inicio > concederAte) {
    return {
      id: opcao.id,
      disponivel: false,
      motivoCodigo: 'CONCEDER_ATE_VENCIDO',
      motivo: 'O início ultrapassaria o limite legal "conceder até" (' + _fmtBRF_(concederAte) +
        ') desta pessoa. Agende as férias dela pelo fluxo normal, antes dessa data.'
    };
  }

  return { id: opcao.id, disponivel: true, inicio: inicio, fim: fim, dias: dias };
}

/**
 * FERIAS.AGENDAR_FIM_DE_ANO — o gestor confirma UMA opção pra uma pessoa da equipe.
 * payload: { idPeriodo, opcao: 'OPCAO_1' | 'OPCAO_2' }
 *
 * Trava de prazo: gestor só pode agendar entre FERIAS.FIM_DE_ANO_INICIO_GESTOR e
 * FERIAS.FIM_DE_ANO_PRAZO_GESTOR.
 * Se o período ainda estiver EM_CURSO hoje mas o aquisitivo terminar antes do início do
 * gozo escolhido, a agenda antecipada é permitida (mesma regra geral do sistema: quem trava
 * é a DATA, não o status) — por isso passamos um período com STATUS neutro pra validação.
 */
function feriasAgendarFimDeAno(user, p) {
  const idPeriodo = String(p.idPeriodo || '').trim();
  const opcaoId = String(p.opcao || '').trim();

  if (!idPeriodo) throw new Error('Período não informado.');
  if (!opcaoId) throw new Error('Escolha uma opção de férias de fim de ano.');

  const inicio = _dataF_(FERIAS.FIM_DE_ANO_INICIO_GESTOR);
  if (!FERIAS.FIM_DE_ANO_PERMITIR_ANTES && inicio && _hojeFerias_() < inicio) {
    throw new Error('O agendamento das férias de fim de ano só abre em ' + _fmtBRF_(inicio) + '.');
  }

  const limite = _dataF_(FERIAS.FIM_DE_ANO_PRAZO_GESTOR);
  if (limite && _hojeFerias_() > limite) {
    throw new Error('O prazo para agendar as férias de fim de ano terminou em ' + _fmtBRF_(limite) + '.');
  }

  _invalidarCacheFerias_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const periodos = _periodos_();
    const sols = _solicitacoes_();

    const periodoReal = periodos.find(x => String(x.ID_PERIODO) === idPeriodo);
    if (!periodoReal) throw new Error('Período não encontrado.');

    // Revalida dentro do lock: equipe, matricula na lista, vinculo ativo, aprendiz,
    // saldo, datas e opcao ainda disponivel. Payload antigo ou forjado nao agenda.
    const elegibilidadeAtual = _feriasElegiveisFimDeAnoCalcular_(user, { visao: 'GESTOR' });
    const pessoaElegivel = elegibilidadeAtual.colaboradores.find(x => String(x.idPeriodo) === idPeriodo);
    if (!pessoaElegivel) {
      throw new Error('Esta pessoa não está elegível para as férias de fim de ano neste momento.');
    }
    if (!pessoaElegivel.opcoes.some(x => String(x.id) === opcaoId)) {
      throw new Error('Esta opção de férias de fim de ano não está mais disponível para esta pessoa.');
    }

    const saldo = _saldoFimDeAno_(periodoReal, sols);
    const calculada = _calcularOpcaoFimDeAno_(periodoReal, opcaoId, saldo, sols);

    if (!calculada.disponivel) {
      throw new Error(calculada.motivo || 'Esta opção não está disponível para esta pessoa.');
    }

    const aquisFim = _dataF_(periodoReal.AQUIS_FIM);
    const antecipando = String(periodoReal.STATUS || '').toUpperCase() === 'EM_CURSO' &&
      aquisFim && aquisFim < calculada.inicio;

    // cópia com STATUS neutro só pra passar pela validação quando for agenda antecipada legítima
    const periodoParaValidar = antecipando
      ? Object.assign({}, periodoReal, { STATUS: 'ABERTO' })
      : periodoReal;

    const resultado = _feriasSolicitarComPeriodo_(user, {
      idPeriodo: idPeriodo,
      dias: calculada.dias,
      abono: 0,
      dataInicio: _isoF_(calculada.inicio),
      observacaoInterna: 'FIM_DE_ANO_2026',
      visao: 'GESTOR'
    }, periodoParaValidar);

    // a lista de elegíveis mudou (essa pessoa saiu dela) e a de agendados também (ela entrou) —
    // não espera o cache de 5 min vencer sozinho.
    try {
      const sufixo = Utilities.base64EncodeWebSafe(_normalizarEmail_(user.EMAIL)).replace(/=+$/, '');
      CacheService.getScriptCache().removeAll(['FIMDEANO_V3_' + sufixo, 'FIMDEANO_AGENDADOS_V1_' + sufixo]);
    } catch (e) { /* segue mesmo se não conseguir limpar */ }

    return resultado;

  } finally {
    lock.releaseLock();
  }
}

function feriasSolicitar(user, p) {
  _invalidarCacheFerias_();   // leitura sempre fresca antes de escrever

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const idPeriodo = String(p.idPeriodo || '').trim();
    if (!idPeriodo) throw new Error('Período não informado.');

    const periodos = _periodos_();
    const periodo = periodos.find(x => String(x.ID_PERIODO) === idPeriodo);
    if (!periodo) throw new Error('Período não encontrado.');

    return _feriasSolicitarComPeriodo_(user, p, periodo);

  } finally {
    lock.releaseLock();
  }
}

/**
 * Núcleo de feriasSolicitar(), recebendo o PERÍODO já resolvido (e, se preciso, ajustado
 * por quem chamou — ex.: férias de fim de ano passam um período com STATUS neutro quando
 * o aquisitivo, embora ainda EM_CURSO hoje, já vai ter encerrado até a data de início pedida).
 * Não pega lock nem invalida cache sozinho — quem chama já deve ter feito isso.
 */
function _feriasSolicitarComPeriodo_(user, p, periodo) {
  const idPeriodo = String(periodo.ID_PERIODO);
  const dias = Math.floor(Number(p.dias || 0));
  const abono = Math.floor(Number(p.abono || 0));
  const inicio = dias > 0 ? _dataDeISO_(p.dataInicio) : null;

  const solicitacoes = _solicitacoes_();

  // Escopo: gestor só pede para a própria equipe.
  const restringirAoEscopoGestor = String(user.PERFIL).toUpperCase() === 'GESTOR' ||
    String(p.visao || '').toUpperCase() === 'GESTOR';
  if (restringirAoEscopoGestor) {
    const equipe = _equipeFeriasDoGestor_(user.EMAIL);
    const equipeSet = {};
    equipe.forEach(id => { equipeSet[_idColaboradorFerias_(id)] = true; });
    if (!equipeSet[_idColaboradorFerias_(periodo.ID_COLABORADOR)]) {
      _auditar_('FERIAS_ESCOPO_NEGADO', user.EMAIL, 'FERIAS.SOLICITAR', false,
        'Tentou solicitar fora da equipe.', { idPeriodo: idPeriodo });
      throw new Error('Este colaborador não está na sua equipe.');
    }
  }

  const erros = _validarSolicitacao_(periodo, dias, abono, inicio, solicitacoes);
  if (erros.length) throw new Error(erros.join(' '));

  const fim = dias > 0 ? _addDiasF_(inicio, dias - 1) : null;
  const id = 'SOL-' + _uuid_().slice(0, 8).toUpperCase();
  const custo = _calcularCusto_(periodo.ID_COLABORADOR, dias, abono, inicio || _hojeFerias_(), periodo.ID_PERIODO);

  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);

  const linha = h.map(col => {
    switch (col) {
      case 'ID_SOLICITACAO': return id;
      case 'ID_PERIODO': return idPeriodo;
      case 'ID_COLABORADOR': return periodo.ID_COLABORADOR;
      case 'NOME': return periodo.NOME;
      case 'DIAS': return dias;
      case 'ABONO': return abono;
      case 'DATA_INICIO': return inicio || '';
      case 'DATA_FIM': return fim || '';
      case 'STATUS': return 'PENDENTE';
      case 'SOLICITADO_POR': return _normalizarEmail_(user.EMAIL);
      case 'SOLICITADO_EM': return new Date();
      case 'CUSTO_PREVISTO': return custo.total;
      case 'OBS': return String(p.observacaoInterna || '');
      default: return '';
    }
  });

  sh.appendRow(linha);
  _invalidarCacheFerias_();   // a próxima leitura já enxerga esta linha
  _atualizarSaldoNoPeriodo_(idPeriodo);

  _auditar_('FERIAS_SOLICITADA', user.EMAIL, 'FERIAS.SOLICITAR', true,
    periodo.NOME + ': ' + dias + ' dia(s) de gozo + ' + abono + ' de abono.',
    { id: id, idPeriodo: idPeriodo, inicio: _isoF_(inicio), custo: custo.total });

  _mailSolicitacaoRecebida_(user.EMAIL, periodo.NOME, dias, abono, inicio, fim,
    String(p.observacaoInterna || '').indexOf('FIM_DE_ANO_2026') > -1);
  _mailDPNovoPedido_(user.EMAIL, periodo.NOME, dias, abono, inicio, fim, custo.total,
    (_colaboradorPorId_(periodo.ID_COLABORADOR) || {}).DEPARTAMENTO_ATUAL || '');

  const saldoDepois = _saldoDoPeriodo_(periodo, solicitacoes) - dias - abono;

  return {
    ok: true,
    id: id,
    status: 'PENDENTE',
    dias: dias,
    abono: abono,
    inicio: _isoF_(inicio),
    fim: _isoF_(fim),
    saldoRestante: saldoDepois,
    custoPrevisto: custo.total,
    mensagem: 'Solicitação enviada ao DP.' +
      (saldoDepois > 0 ? ' Saldo restante: ' + saldoDepois + ' dia(s).' : '')
  };
}

function feriasCancelar(user, p) {
  _invalidarCacheFerias_();   // leitura sempre fresca antes de escrever
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitação não informada.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
    const h = _headers_(sh);
    const sols = _sheetToObjects_(sh);

    const s = sols.find(x => String(x.ID_SOLICITACAO) === id);
    if (!s) throw new Error('Solicitação não encontrada.');

    if (String(s.STATUS).toUpperCase() !== 'PENDENTE') {
      throw new Error('Só é possível cancelar solicitação PENDENTE. Status atual: ' + s.STATUS + '.');
    }

    if (String(user.PERFIL).toUpperCase() === 'GESTOR' &&
        _normalizarEmail_(s.SOLICITADO_POR) !== _normalizarEmail_(user.EMAIL)) {
      throw new Error('Você só pode cancelar solicitações feitas por você.');
    }

    _invalidarCacheFerias_();
    _atualizarLinha_(sh, s._rowNumber, h, {
      STATUS: 'CANCELADA',
      DECIDIDO_POR: _normalizarEmail_(user.EMAIL),
      DECIDIDO_EM: new Date(),
      MOTIVO: String(p.motivo || 'Cancelada pelo solicitante.')
    });

    _auditar_('FERIAS_CANCELADA', user.EMAIL, 'FERIAS.CANCELAR', true, s.NOME + ': solicitação cancelada.', { id: id });
    _atualizarSaldoNoPeriodo_(s.ID_PERIODO);

    return { ok: true, mensagem: 'Solicitação cancelada. O saldo voltou a ficar disponível.' };

  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================================ */
/*  AÇÕES DO DP                                                                                  */
/* ============================================================================================ */

function feriasFila(user) {
  const solicitacoes = _solicitacoes_();
  const periodos = _periodos_();
  const hoje = _hojeFerias_();

  const fila = solicitacoes
    .filter(s => String(s.STATUS || '').toUpperCase() === 'PENDENTE')
    .map(s => {
      const p = periodos.find(x => String(x.ID_PERIODO) === String(s.ID_PERIODO)) || {};
      const solicitadoEm = _dataF_(s.SOLICITADO_EM);
      const espera = solicitadoEm ? Math.round((hoje - solicitadoEm) / 86400000) : 0;
      const inicio = _dataF_(s.DATA_INICIO);
      const fimDeAno = String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1;
      const prazoLimite = fimDeAno
        ? _dataF_(FERIAS.FIM_DE_ANO_PRAZO_DP)
        : _prazoDPParaSolicitacao_(solicitadoEm, inicio);

      return {
        id: s.ID_SOLICITACAO,
        nome: s.NOME,
        empresa: (_colaboradorPorId_(s.ID_COLABORADOR) || {}).EMPRESA || p.EMPRESA || '',
        dias: Number(s.DIAS || 0),
        abono: Number(s.ABONO || 0),
        inicio: _isoF_(s.DATA_INICIO),
        fim: _isoF_(s.DATA_FIM),
        mesReferencia: inicio ? _mesRefF_(inicio) : '',
        solicitadoPor: s.SOLICITADO_POR,
        diasEsperando: espera,
        custoPrevisto: Number(s.CUSTO_PREVISTO || 0),
        concederAte: _fmtBRF_(_dataF_(p.CONCEDER_ATE)),
        fimDeAno: fimDeAno,
        atrasado: prazoLimite ? hoje > prazoLimite : espera > Number(_feriasParam_('PRAZO_RESPOSTA_DP_DIAS', 15))
      };
    });

  fila.sort((a, b) => b.diasEsperando - a.diasEsperando);

  return {
    ok: true,
    total: fila.length,
    atrasadas: fila.filter(f => f.atrasado).length,
    custoPendente: fila.reduce((t, f) => t + f.custoPrevisto, 0),
    fila: fila,
    calendario: feriasCalendario(user, {}, { periodos: periodos, solicitacoes: solicitacoes }).meses
  };
}

function feriasDecidir(user, p, novoStatus) {
  _invalidarCacheFerias_();   // leitura sempre fresca antes de escrever
  const id = String(p.idSolicitacao || '').trim();
  const motivo = String(p.motivo || '').trim();

  if (!id) throw new Error('Solicitação não informada.');
  if (novoStatus === 'INDEFERIDA' && !motivo) throw new Error('Informe o motivo do indeferimento.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
    const h = _headers_(sh);
    const sols = _sheetToObjects_(sh);

    const s = sols.find(x => String(x.ID_SOLICITACAO) === id);
    if (!s) throw new Error('Solicitação não encontrada.');

    if (String(s.STATUS).toUpperCase() !== 'PENDENTE') {
      throw new Error('Esta solicitação já foi decidida. Status atual: ' + s.STATUS + '.');
    }

    const patch = {
      STATUS: novoStatus,
      DECIDIDO_POR: _normalizarEmail_(user.EMAIL),
      DECIDIDO_EM: new Date(),
      MOTIVO: motivo
    };

    // Ao deferir, o custo é CONGELADO com o salário vigente naquele momento.
    if (novoStatus === 'DEFERIDA') {
      const custo = _calcularCusto_(s.ID_COLABORADOR, Number(s.DIAS || 0), Number(s.ABONO || 0), _dataF_(s.DATA_INICIO) || _hojeFerias_(), s.ID_PERIODO);
      patch.CUSTO_PREVISTO = custo.total;
      patch.CUSTO_SNAPSHOT_JSON = JSON.stringify(custo);
    }

    _atualizarLinha_(sh, s._rowNumber, h, patch);
    _invalidarCacheFerias_();
    _atualizarSaldoNoPeriodo_(s.ID_PERIODO);

    _auditar_('FERIAS_' + novoStatus, user.EMAIL, 'FERIAS.' + (novoStatus === 'DEFERIDA' ? 'DEFERIR' : 'INDEFERIR'),
      true, s.NOME + ': ' + novoStatus + (motivo ? ', ' + motivo : ''), { id: id });

    const periodoSol = _periodos_().find(x => String(x.ID_PERIODO) === String(s.ID_PERIODO)) || {};
    const colabLive = _colaboradorPorId_(s.ID_COLABORADOR);
    const emailGestor = String((colabLive && colabLive.GESTOR_EMAIL) || periodoSol.GESTOR_EMAIL || s.SOLICITADO_POR || '');
    const ini = _dataF_(s.DATA_INICIO);
    const fim = _dataF_(s.DATA_FIM);

    if (novoStatus === 'DEFERIDA') {
      _mailGestorConfirmada_(emailGestor, s.NOME, Number(s.DIAS || 0), Number(s.ABONO || 0), ini, fim);

      const emailColab = _emailDoColaborador_(s.ID_COLABORADOR);

      if (emailColab && ini) {
        _mailColaborador_(emailColab, s.NOME, Number(s.DIAS || 0), Number(s.ABONO || 0), ini, fim);
      } else {
        _auditar_('FERIAS_SEM_EMAIL_COLABORADOR', user.EMAIL, 'FERIAS.DEFERIR', false,
          s.NOME + ': férias confirmadas, mas o colaborador não tem e-mail cadastrado na MASTER.',
          { id: id });
      }
    } else {
      _mailGestorAjuste_(emailGestor, s.NOME, Number(s.DIAS || 0), ini, fim, motivo,
        String(s.OBS || '').indexOf('FIM_DE_ANO_2026') > -1);
    }

    return {
      ok: true,
      status: novoStatus,
      mensagem: novoStatus === 'DEFERIDA'
        ? 'Férias deferidas. Custo congelado para conciliação.'
        : 'Solicitação indeferida. O saldo voltou a ficar disponível para novo agendamento.'
    };

  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================================ */
/*  PAINEL DO DP, tudo o que a tela do DP precisa, numa chamada                                 */
/* ============================================================================================ */

/**
 * [PERF 2026-09-24] O painel do DP lê inteiras as abas de férias, a MASTER e os afastamentos, e
 * levava de 5 a 30 s a cada abertura do Portal do DP. O resultado é o mesmo para qualquer
 * pessoa do DP, então fica no cache por 10 minutos. A chave leva:
 *   - o selo de Férias: toda gravação feita pelo sistema troca o selo e aposenta o cache na hora;
 *   - o dia: o painel depende de "hoje" (prazos, vencidos);
 *   - os meses do calendário, se vierem no pedido.
 * Edição feita direto na planilha aparece em até 10 minutos. payload.forcar = true ignora o cache.
 */
const FERIAS_PAINEL_DP_CACHE_SEG = 600;

function feriasPainelDP(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();

  if (perfil !== 'DP' && perfil !== 'ADMIN') {
    throw new Error('Esta área é do Departamento Pessoal.');
  }

  const chave = 'PAINELDP_V1_' + Utilities.formatDate(new Date(), DP360.FUSO, 'yyyyMMdd') +
    '_' + String((p && p.meses) || '') + '_' + _seloFerias_();

  if (!(p && p.forcar)) {
    const doCache = _cacheGetZip_(chave);
    if (doCache) return doCache;
  }

  const out = _feriasPainelDPCalcular_(user, p);
  _cachePutZip_(chave, out, FERIAS_PAINEL_DP_CACHE_SEG);
  return out;
}

function _feriasPainelDPCalcular_(user, p) {
  const periodos = _periodos_();
  const sols = _solicitacoes_();
  const afast = _afastamentosPorColaborador_();
  const hoje = _hojeFerias_();
  const prazoDP = Number(_feriasParam_('PRAZO_RESPOSTA_DP_DIAS', 15));

  /* ---- fila de decisão ---- */
  const fila = sols
    .filter(s => String(s.STATUS || '').toUpperCase() === 'PENDENTE')
    .map(s => {
      const per = periodos.find(x => String(x.ID_PERIODO) === String(s.ID_PERIODO)) || {};
      const em = _dataF_(s.SOLICITADO_EM);
      const espera = em ? Math.round((hoje - em) / 86400000) : 0;
      const ini = _dataF_(s.DATA_INICIO);
      const fimDeAno = String(s.OBS || '').toUpperCase().indexOf('FIM_DE_ANO_2026') > -1;
      const prazoLimite = fimDeAno
        ? _dataF_(FERIAS.FIM_DE_ANO_PRAZO_DP)
        : _prazoDPParaSolicitacao_(em, ini);

      return {
        id: s.ID_SOLICITACAO,
        idPeriodo: s.ID_PERIODO,
        nome: s.NOME,
        matricula: (_colaboradorPorId_(s.ID_COLABORADOR) || {}).MATRICULA || per.MATRICULA || '',
        empresa: (_colaboradorPorId_(s.ID_COLABORADOR) || {}).EMPRESA || per.EMPRESA || '',
        departamento: (_colaboradorPorId_(s.ID_COLABORADOR) || {}).DEPARTAMENTO_ATUAL || per.DEPARTAMENTO || '',
        gestor: s.SOLICITADO_POR,
        dias: Number(s.DIAS || 0),
        abono: Number(s.ABONO || 0),
        inicio: _isoF_(s.DATA_INICIO),
        fim: _isoF_(s.DATA_FIM),
        mes: ini ? _mesRefF_(ini) : '',
        solicitadoEm: _isoF_(s.SOLICITADO_EM),
        diasEsperando: espera,
        fimDeAno: fimDeAno,
        atrasado: prazoLimite ? hoje > prazoLimite : espera > prazoDP,
        custo: Number(s.CUSTO_PREVISTO || 0),
        concederAte: _fmtBRF_(per.CONCEDER_ATE)
      };
    })
    .sort((a, b) => b.diasEsperando - a.diasEsperando);

  /* ---- pedidos de venda de dias aguardando o DP ---- */
  const abonos = periodos
    .filter(x => String(x.ABONO_STATUS || '').toUpperCase() === 'SOLICITADO')
    .map(x => {
      const fimAquis = _dataF_(x.AQUIS_FIM);
      const prazo = Number(_feriasParam_('ABONO_PRAZO_ANTES_FIM_AQUIS', FERIAS.ABONO_PRAZO_ANTES_FIM_AQUIS));
      const limite = fimAquis ? _addDiasF_(fimAquis, -prazo) : null;
      const pedidoEm = _dataF_(x.ABONO_PEDIDO_EM);

      return {
        idPeriodo: x.ID_PERIODO,
        nome: x.NOME,
        matricula: (_colaboradorPorId_(x.ID_COLABORADOR) || {}).MATRICULA || x.MATRICULA,
        empresa: x.EMPRESA,
        dias: Number(x.ABONO_DIAS_PEDIDOS || 0),
        periodoAquisitivo: _fmtBRF_(x.AQUIS_INICIO) + ' a ' + _fmtBRF_(fimAquis),
        pedidoEm: _isoF_(pedidoEm),
        pedidoEmBR: _fmtBRF_(pedidoEm),
        solicitadoPor: x.ABONO_SOLICITADO_POR || '',
        prazoLegal: limite ? _fmtBRF_(limite) : '',
        dentroDoPrazo: (limite && pedidoEm) ? (pedidoEm <= limite) : false
      };
    });

  /* ---- calendário ---- */
  const cal = feriasCalendario(user, p, { periodos: periodos, solicitacoes: sols });

  /* ---- alertas ---- */
  const comSaldo = periodos.filter(x => _saldoDoPeriodo_(x, sols) > 0 && _colaboradorEstaAtivo_(x.ID_COLABORADOR) && !_semDireitoAFerias_(_colaboradorPorId_(x.ID_COLABORADOR)));

  const vencidos = comSaldo.filter(x => {
    const lim = _dataF_(x.CONCEDER_ATE);
    return lim && lim < hoje && !_estaAfastadoAgora_(x.ID_COLABORADOR, afast);
  });

  const criticos = comSaldo.filter(x => {
    const lim = _dataF_(x.CONCEDER_ATE);
    if (!lim || lim < hoje) return false;
    return Math.round((lim - hoje) / 86400000) <= 60;
  });

  /* ---- SLA de resposta do DP: conta TODA solicitação, não só a pendente ---- */
  const todasDecidiveis = sols.filter(s => ['PENDENTE', 'DEFERIDA', 'INDEFERIDA'].indexOf(String(s.STATUS).toUpperCase()) > -1);

  let slaViolado = 0;
  let somaDiasResposta = 0, qtdDecididas = 0;

  todasDecidiveis.forEach(s => {
    const solicitadoEm = _dataF_(s.SOLICITADO_EM);
    if (!solicitadoEm) return;

    const st = String(s.STATUS).toUpperCase();
    const fimContagem = (st === 'PENDENTE') ? hoje : _dataF_(s.DECIDIDO_EM);
    if (!fimContagem) return;

    const dias = Math.round((fimContagem - solicitadoEm) / 86400000);
    if (dias > prazoDP) slaViolado++;

    if (st !== 'PENDENTE') { somaDiasResposta += dias; qtdDecididas++; }
  });

  const slaMedioDiasResposta = qtdDecididas ? Math.round((somaDiasResposta / qtdDecididas) * 10) / 10 : null;

  const deferidas = sols.filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA').length;
  const indeferidas = sols.filter(s => String(s.STATUS).toUpperCase() === 'INDEFERIDA').length;
  const taxaIndeferimento = (deferidas + indeferidas) ? Math.round((indeferidas / (deferidas + indeferidas)) * 1000) / 10 : null;

  /* ---- envio ao financeiro: dentro/fora do prazo mínimo, e antecedência média ---- */
  const minimaFinanceiro = Number(_feriasParam_('FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS', FERIAS.FINANCEIRO_ANTECEDENCIA_MINIMA_DIAS));
  const enviadasFinanceiro = sols.filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA' && _dataF_(s.ENVIADO_FINANCEIRO_EM));

  let noPrazoFinanceiro = 0, foraDoPrazoFinanceiro = 0, somaAntecedencia = 0;

  enviadasFinanceiro.forEach(s => {
    const enviadoEm = _dataF_(s.ENVIADO_FINANCEIRO_EM);
    const vencimento = _dataF_(s.VENCIMENTO_PAGAMENTO);
    if (!vencimento) return;

    const antecedencia = Math.round((vencimento - enviadoEm) / 86400000);
    somaAntecedencia += antecedencia;

    if (antecedencia >= minimaFinanceiro) noPrazoFinanceiro++; else foraDoPrazoFinanceiro++;
  });

  const tempoMedioAntecedenciaFinanceiro = enviadasFinanceiro.length
    ? Math.round((somaAntecedencia / enviadasFinanceiro.length) * 10) / 10 : null;

  const deferidasSemEnvioFinanceiro = sols.filter(s =>
    String(s.STATUS).toUpperCase() === 'DEFERIDA' && !_dataF_(s.ENVIADO_FINANCEIRO_EM)).length;

  return {
    ok: true,
    versao: FERIAS.VERSAO,
    prazoDP: prazoDP,

    indicadores: {
      naFila: fila.length,
      atrasadas: fila.filter(f => f.atrasado).length,
      custoNaFila: Math.round(fila.reduce((t, f) => t + f.custo, 0)),
      abonosParaConfirmar: abonos.length,

      colaboradoresComSaldo: comSaldo.length,
      diasEmAberto: comSaldo.reduce((t, x) => t + _saldoDoPeriodo_(x, sols), 0),
      vencidos: vencidos.length,
      criticos: criticos.length,

      periodosPerdidos: periodos.filter(x => String(x.STATUS) === 'PERDIDO').length,
      periodosCongelados: periodos.filter(x => String(x.STATUS) === 'CONGELADO').length,
      semGestor: periodos.filter(x => !((_colaboradorPorId_(x.ID_COLABORADOR) || {}).GESTOR_EMAIL || x.GESTOR_EMAIL) && _saldoDoPeriodo_(x, sols) > 0).length,

      slaViolado: slaViolado,
      slaMedioDiasResposta: slaMedioDiasResposta,
      taxaIndeferimentoPct: taxaIndeferimento,

      financeiroNoPrazo: noPrazoFinanceiro,
      financeiroForaDoPrazo: foraDoPrazoFinanceiro,
      financeiroTempoMedioAntecedencia: tempoMedioAntecedenciaFinanceiro,
      financeiroDeferidasSemEnvio: deferidasSemEnvioFinanceiro
    },

    fila: fila,
    abonos: abonos,
    calendario: cal,

    vencidos: vencidos.slice(0, 30).map(x => ({
      idPeriodo: x.ID_PERIODO,
      nome: x.NOME,
      matricula: (_colaboradorPorId_(x.ID_COLABORADOR) || {}).MATRICULA || x.MATRICULA,
      gestor: (_colaboradorPorId_(x.ID_COLABORADOR) || {}).GESTOR_EMAIL || x.GESTOR_EMAIL || '(sem gestor)',
      saldo: _saldoDoPeriodo_(x, sols),
      concederAte: _fmtBRF_(x.CONCEDER_ATE),
      vencidoHa: Math.round((hoje - _dataF_(x.CONCEDER_ATE)) / 86400000)
    })).sort((a, b) => b.vencidoHa - a.vencidoHa),

    criticos: criticos.slice(0, 30).map(x => ({
      idPeriodo: x.ID_PERIODO,
      nome: x.NOME,
      gestor: (_colaboradorPorId_(x.ID_COLABORADOR) || {}).GESTOR_EMAIL || x.GESTOR_EMAIL || '(sem gestor)',
      saldo: _saldoDoPeriodo_(x, sols),
      concederAte: _fmtBRF_(x.CONCEDER_ATE),
      diasRestantes: Math.round((_dataF_(x.CONCEDER_ATE) - hoje) / 86400000)
    })).sort((a, b) => a.diasRestantes - b.diasRestantes)
  };
}

/* ============================================================================================ */
/*  CALENDÁRIO DE CUSTO, o instrumento de decisão do DP                                         */
/* ============================================================================================ */

/**
 * Define o teto de um mês específico (sobrescreve o teto padrão só para esse mês).
 * payload: { mes: 'yyyy-MM', teto: number }
 * Para voltar ao padrão, chame de novo com teto vazio/0, isso REMOVE o override do mês.
 */
function feriasDefinirTeto(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Apenas o Departamento Pessoal pode definir o teto do mês.');

  const mes = String(p.mes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Informe o mês no formato yyyy-MM (ex.: 2026-08).');

  const teto = Number(p.teto);

  if (!teto || teto <= 0) {
    // remove o override: o mês volta a usar o TETO_MENSAL_PADRAO
    _setFeriasParam_('TETO_' + mes, '');
    _auditar_('FERIAS_TETO_REMOVIDO', user.EMAIL, 'FERIAS.DEFINIR_TETO', true, mes + ': voltou ao padrão.', { mes: mes });
    return { ok: true, mensagem: 'Teto de ' + mes + ' voltou a usar o padrão.' };
  }

  _setFeriasParam_('TETO_' + mes, teto);
  _auditar_('FERIAS_TETO_DEFINIDO', user.EMAIL, 'FERIAS.DEFINIR_TETO', true,
    mes + ': teto definido em R$ ' + teto.toLocaleString('pt-BR'), { mes: mes, teto: teto });

  return { ok: true, mensagem: 'Teto de ' + mes + ' definido em R$ ' + teto.toLocaleString('pt-BR') + '.' };
}

/**
 * "Assistência", pro calendário: departamento que tem "lote" no nome, ou é o Escritório Social.
 * Esses custos ficam somados numa linha própria, separados de planejadas/compulsórias.
 */
function _ehAssistencia_(departamento) {
  const d = String(departamento || '').toUpperCase();
  return d.indexOf('LOTE') > -1 || d.indexOf('ESCRITORIO SOCIAL') > -1 || d.indexOf('ESCRITÓRIO SOCIAL') > -1;
}

/**
 * Exceção temporária pedida pela Karla (2026-08): JOVENS MENSAGEIROS teve um volume
 * atípico de férias caindo junto em AGO/2026 e SET/2026, estourando o teto por causa
 * de um único projeto. Vira linha própria (igual Assistência) só nesses dois meses.
 * Remover (ou ajustar a janela) quando não precisar mais dessa exceção.
 */
function _ehExcecaoJmAgoSet2026_(departamento, mes) {
  const d = String(departamento || '').toUpperCase();
  return d === 'JOVENS MENSAGEIROS' && (mes === '2026-08' || mes === '2026-09');
}

/**
 * Aprendiz (contrato de aprendizagem) não tem direito a gozo de férias — o valor é pago
 * só na rescisão. Usado pra tirar essas pessoas de qualquer tela de agendamento de férias.
 */
function _ehAprendiz_(colaborador) {
  return String((colaborador && colaborador.CARGO) || '').toUpperCase().indexOf('APRENDIZ') > -1;
}

/**
 * PJ (prestador de serviço) não tem período aquisitivo nem direito CLT a férias — só faz
 * sentido aparecer nas telas de férias quando também é gestor/coordenador de alguém (aí a
 * pessoa continua precisando agendar férias da PRÓPRIA equipe). PJ sem cargo de gestão nunca
 * deve aparecer como elegível, nem na campanha de fim de ano nem nas férias normais.
 */
function _ehPjSemGestao_(colaborador) {
  const tipoContrato = String((colaborador && colaborador.TIPO_CONTRATO) || '').toUpperCase();
  const vinculoDescricao = String((colaborador && colaborador.VINCULO_DESCRICAO) || '').toUpperCase();
  if (tipoContrato !== 'PJ' && vinculoDescricao !== 'PJ') return false;

  // O campo CARGO é texto livre e nem sempre está preenchido pra quem já é gestor de verdade
  // (tem gente com PERFIL_SISTEMA='GESTOR' e CARGO vazio) — por isso o perfil do sistema
  // também conta como sinal de que a pessoa gerencia equipe, não só o texto do cargo.
  const cargo = String((colaborador && colaborador.CARGO) || '').toUpperCase();
  const perfilSistema = String((colaborador && colaborador.PERFIL_SISTEMA) || '').toUpperCase();
  const ehGestorOuCoordenador =
    cargo.indexOf('GESTOR') > -1 || cargo.indexOf('COORDENADOR') > -1 || perfilSistema === 'GESTOR';
  return !ehGestorOuCoordenador;
}

/** Reúne os dois motivos que tiram alguém de qualquer tela de agendamento de férias. */
function _semDireitoAFerias_(colaborador) {
  return _ehAprendiz_(colaborador) || _ehPjSemGestao_(colaborador);
}

function feriasCalendario(user, p, dados) {
  const solicitacoes = (dados && dados.solicitacoes) || _solicitacoes_();
  const periodos = (dados && dados.periodos) || _periodos_();

  const tetoPadrao = Number(_feriasParam_('TETO_MENSAL_PADRAO', 40000));
  const janela = Number((p && p.meses) || _feriasParam_('CALENDARIO_MESES', 12));
  const dobrarVencidas = String(_feriasParam_('DOBRAR_FERIAS_VENCIDAS', 'Sim'));

  const hoje = _hojeFerias_();
  const mesAtual = _mesRefF_(hoje);

  // Janela fixa: 12 meses a partir do mês atual. Mês anterior não existe no calendário.
  const meses = {};

  for (let i = 0; i < janela; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1, 12);
    const k = _mesRefF_(d);

    // Teto por mês: a aba PARAMETROS aceita override, ex. chave "TETO_2027-05".
    meses[k] = {
      mes: k,
      teto: Number(_feriasParam_('TETO_' + k, tetoPadrao)),
      deferido: 0, pendente: 0, compulsorio: 0, vencido: 0,
      assistencia: 0, excecaoJm: 0,
      pessoasDeferidas: 0, pessoasPendentes: 0, pessoasCompulsorias: 0, pessoasVencidas: 0,
      pessoasAssistencia: 0, pessoasExcecaoJm: 0
    };
  }

  const chaves = Object.keys(meses).sort();
  const primeiro = chaves[0];
  const ultimo = chaves[chaves.length - 1];

  const foraDaJanela = { antes: 0, depois: 0, custoDepois: 0 };

  // 05/08/2026: Compulsória x Planejada, mesmo já com data marcada — regra da Mariana.
  // 1) Se a solicitação tem CLASSIFICACAO_FERIAS preenchida à mão (coluna nova em
  //    SOLICITACOES, PLANEJADA/COMPULSORIA), essa marcação manual sempre vale — é o
  //    DP decidindo caso a caso (ex: 2ª fração de um período já usado antes,
  //    fracionamento por prazo, etc. — coisas que a fórmula sozinha não enxerga).
  // 2) Sem marcação manual, calcula sozinho comparando o início com o CONCEDER_ATE
  //    do período ligado a essa solicitação:
  //    - início a mais de 2 meses do prazo   -> PLANEJADA   (agendado com folga)
  //    - início dentro dos 2 meses antes     -> COMPULSORIA (em cima da hora)
  //    - início depois do prazo (já vencido) -> COMPULSORIA (atrasou, pior ainda)
  const periodosPorId = {};
  periodos.forEach(p => { periodosPorId[String(p.ID_PERIODO)] = p; });

  function _ehCompulsoriaPorPrazo_(s, inicio) {
    const manual = String(s.CLASSIFICACAO_FERIAS || '').trim().toUpperCase();
    if (manual.indexOf('COMPULS') > -1) return true;
    if (manual.indexOf('PLANEJ') > -1) return false;

    const per = periodosPorId[String(s.ID_PERIODO)];
    const concederAte = per ? _dataF_(per.CONCEDER_ATE) : null;
    if (!concederAte) return false;

    // 06/08/2026: mudou — agendado depois do prazo já vencido também é Compulsória
    // (antes caía como Planejada; a planilha real mostrou que não é assim na prática).
    if (inicio > concederAte) return true;

    const limite2Meses = new Date(concederAte.getFullYear(), concederAte.getMonth() - 2, concederAte.getDate(), 12, 0, 0);
    return inicio >= limite2Meses;
  }

  // 1) Solicitações com data caem no mês do início.
  solicitacoes.forEach(s => {
    const st = String(s.STATUS || '').toUpperCase();
    if (FERIAS.STATUS_ATIVOS.indexOf(st) === -1) return;

    // 05/08/2026: colaborador desligado não pode continuar aparecendo no calendário —
    // a SITUACAO na MASTER às vezes atrasa em relação à rescisão real, mas aqui é onde
    // o dinheiro é somado, então é onde a checagem tem que travar de verdade.
    if (!_colaboradorEstaAtivo_(s.ID_COLABORADOR)) return;

    const inicio = _dataF_(s.DATA_INICIO);
    if (!inicio) return;

    const mes = _mesRefF_(inicio);
    const custo = Number(s.CUSTO_PREVISTO || 0);

    if (mes < primeiro) { foraDaJanela.antes++; return; }
    if (mes > ultimo) { foraDaJanela.depois++; foraDaJanela.custoDepois += custo; return; }

    const b = meses[mes];
    const colabLive = _colaboradorPorId_(s.ID_COLABORADOR);
    const departamento = colabLive && colabLive.DEPARTAMENTO_ATUAL;
    const ehAssist = _ehAssistencia_(departamento);
    const ehExcecaoJm = !ehAssist && _ehExcecaoJmAgoSet2026_(departamento, mes);

    const ehCompulsoriaPorPrazo = _ehCompulsoriaPorPrazo_(s, inicio);

    if (ehAssist) {
      b.assistencia += custo;
      b.pessoasAssistencia++;
    } else if (ehExcecaoJm) {
      b.excecaoJm += custo;
      b.pessoasExcecaoJm++;
    } else if (ehCompulsoriaPorPrazo) {
      b.compulsorio += custo; b.pessoasCompulsorias++;
    } else if (st === 'DEFERIDA') {
      b.deferido += custo; b.pessoasDeferidas++;
    } else {
      b.pendente += custo; b.pessoasPendentes++;
    }
  });

  // 2) Período com saldo e sem solicitação: cai no mês do CONCEDER_ATE.
  //    Se o conceder_até JÁ PASSOU, a compulsória vem para a COMPETÊNCIA ATUAL
  //    e entra como VENCIDA (art. 137, pagamento em dobro).
  //    Períodos PERDIDOS/CONGELADOS têm saldo zero e nem chegam aqui.
  periodos.forEach(per => {
    // 05/08/2026: mesma trava da passada 1 — período de gente desligada não vira
    // compulsória/vencida, mesmo que a SITUACAO na MASTER atrase em relação à rescisão real.
    if (!_colaboradorEstaAtivo_(per.ID_COLABORADOR)) return;

    const saldo = _saldoDoPeriodo_(per, solicitacoes);
    if (saldo <= 0) return;

    const limite = _dataF_(per.CONCEDER_ATE);
    if (!limite) return;

    const venceu = limite < hoje;
    const mes = venceu ? mesAtual : _mesRefF_(limite);

    if (mes > ultimo) { foraDaJanela.depois++; return; }

    const b = meses[mes];
    if (!b) return;

    const custo = _calcularCusto_(per.ID_COLABORADOR, saldo, 0, venceu ? hoje : limite).total;
    const colabLive = _colaboradorPorId_(per.ID_COLABORADOR);
    const departamento = (colabLive && colabLive.DEPARTAMENTO_ATUAL) || per.DEPARTAMENTO;
    const ehAssist = _ehAssistencia_(departamento);
    const ehExcecaoJm = !ehAssist && _ehExcecaoJmAgoSet2026_(departamento, mes);

    if (ehAssist) {
      b.assistencia += venceu ? (_sim_(dobrarVencidas) ? custo * 2 : custo) : custo;
      b.pessoasAssistencia++;
    } else if (ehExcecaoJm) {
      b.excecaoJm += venceu ? (_sim_(dobrarVencidas) ? custo * 2 : custo) : custo;
      b.pessoasExcecaoJm++;
    } else if (venceu) {
      b.vencido += _sim_(dobrarVencidas) ? custo * 2 : custo;
      b.pessoasVencidas++;
    } else {
      b.compulsorio += custo;
      b.pessoasCompulsorias++;
    }
  });

  const lista = chaves.map(k => {
    const m = meses[k];

    m.deferido = Math.round(m.deferido);
    m.pendente = Math.round(m.pendente);
    m.compulsorio = Math.round(m.compulsorio);
    m.vencido = Math.round(m.vencido);
    m.assistencia = Math.round(m.assistencia);
    m.excecaoJm = Math.round(m.excecaoJm);

    // PLANEJADO     = só as DEFERIDAS (já aceitas). Pendentes NÃO contam mais aqui.
    // COMPROMETIDO  = planejado + vencidas + assistência + exceção JM (dinheiro que já tem
    //                 dono, é fixo ou está fora do teto por decisão do DP), continua exposto
    //                 pra quem quiser o total, mas NÃO decide mais o estouro.
    // PREVISAO      = compulsórias: ninguém agendou ainda, mas o prazo obriga (sem assistência).
    // PENDENTE fica de fora do estouro/semáforo: é só informativo até virar deferida.
    m.planejado = m.deferido;
    m.comprometido = m.planejado + m.vencido + m.assistencia + m.excecaoJm;
    m.previsao = m.compulsorio;
    m.total = m.comprometido + m.previsao + m.pendente;

    // O estouro (vermelho/amarelo) considera SÓ férias deferidas vs. teto, vencidas,
    // assistência, compulsórias e pendentes não entram nessa conta (ficam visíveis à parte).
    m.disponivel = m.teto - m.planejado;
    m.percentualComprometido = m.teto ? Math.round((m.planejado / m.teto) * 100) : 0;
    m.percentualTotal = m.teto ? Math.round(((m.planejado + m.previsao) / m.teto) * 100) : 0;

    m.estourouComprometido = m.planejado > m.teto;
    m.estouraComPrevisao = !m.estourouComprometido && (m.planejado + m.previsao) > m.teto;

    m.semaforo = m.estourouComprometido ? 'VERMELHO' : (m.estouraComPrevisao ? 'AMARELO' : 'VERDE');

    return m;
  });

  return {
    ok: true,
    tetoPadrao: tetoPadrao,
    janelaMeses: janela,
    de: primeiro,
    ate: ultimo,
    meses: lista,
    totalComprometido: lista.reduce((t, m) => t + m.comprometido, 0),
    totalPrevisao: lista.reduce((t, m) => t + m.previsao, 0),
    totalPrevisto: lista.reduce((t, m) => t + m.total, 0),
    totalVencidoEmDobro: lista.reduce((t, m) => t + m.vencido, 0),
    mesesEstourando: lista.filter(m => m.estourouComprometido).map(m => m.mes),
    mesesEmRisco: lista.filter(m => !m.estourouComprometido && m.estouraComPrevisao).map(m => m.mes),
    foraDaJanela: foraDaJanela
  };
}

/** Quanto ainda cabe no mês (teto - comprometido). Usado na aprovação. */
function feriasEspacoNoMes(mes) {
  const cal = feriasCalendario({ PERFIL: 'ADMIN' }, {});
  const m = cal.meses.find(x => x.mes === mes);

  if (!m) return { mes: mes, foraDaJanela: true };

  return {
    mes: mes, teto: m.teto, comprometido: m.comprometido,
    disponivel: m.disponivel, semaforo: m.semaforo
  };
}

/* ============================================================================================ */
/*  FOLHA DE FÉRIAS, espelha as fórmulas usadas hoje pelo DP (base da conciliação)              */
/* ============================================================================================ */
/*
 * Extraído da planilha "Previsão Férias 2026" em 13/07/2026:
 *   Bruto        = remuneracao / 30 * dias_gozo
 *   1/3          = bruto / 3
 *   Abono        = remuneracao / 30 * dias_abono        (indenizatório: fora da base de INSS/IRRF)
 *   INSS         = progressivo sobre (bruto + 1/3), teto R$ 988,09
 *   IRRF         = sobre (bruto + 1/3 - INSS), com desconto simplificado
 *   Líquido      = bruto + 1/3 + abono - INSS - IRRF
 *
 * As faixas ficam na aba PARAMETROS. Quando a tabela do governo mudar, o DP altera lá ,
 * não precisa mexer no código.
 */

/* ---- SALÁRIO VIGENTE (HISTÓRICO da MASTER, com vigência) ---- */
/**
 * [PERF] O HISTÓRICO é lido UMA vez por execução e indexado em memória.
 * Reler a aba por colaborador (1.400 linhas x 900 períodos) estourava os 6 minutos.
 */
var _CACHE_HISTORICO_ = null;

function _historicoIndexado_() {
  if (_CACHE_HISTORICO_) return _CACHE_HISTORICO_;

  const sh = _masterSS_().getSheetByName('HISTÓRICO');
  const idx = {};

  if (sh) {
    _sheetToObjects_(sh).forEach(h => {
      const id = String(h.ID_COLABORADOR || '');
      if (!id) return;

      if (!idx[id]) idx[id] = [];

      idx[id].push({
        atributo: String(h.ATRIBUTO || '').toUpperCase(),
        valor: Number(h.VALOR || 0),
        ini: _dataF_(h.VIGENCIA_INICIO),
        fim: _dataF_(h.VIGENCIA_FIM)
      });
    });
  }

  _CACHE_HISTORICO_ = idx;
  return idx;
}

/** Salário que valia NA DATA pedida. É isso que permite conciliar o passado. */
function _salarioVigente_(idColaborador, data) {
  const idx = _historicoIndexado_();
  const linhas = idx[String(idColaborador)] || [];
  const alvo = data ? _dataF_(data) : _hojeFerias_();

  const vigentes = linhas.filter(h => {
    if (h.ini && alvo && h.ini > alvo) return false;
    if (h.fim && alvo && h.fim < alvo) return false;
    return true;
  });

  function valor(attr) {
    const c = vigentes.filter(h => h.atributo === attr);
    if (!c.length) return 0;

    c.sort((a, b) => (b.ini || 0) - (a.ini || 0));
    return c[0].valor;
  }

  const r = {
    base: valor('SALARIO_BASE'),
    noturno: valor('ADICIONAL_NOTURNO'),
    gratificacao: valor('GRATIFICACAO_FUNCAO')
  };

  r.remuneracao = r.base + r.noturno + r.gratificacao;

  return r;
}

var _TABELAS_ = null;

function _tabelas_() {
  if (_TABELAS_) return _TABELAS_;

  function faixas(chave, padrao) {
    const v = _feriasParam_(chave, '');
    if (!v) return padrao;

    // formato: "limite:aliquota:deducao | limite:aliquota:deducao | ..."
    try {
      return String(v).split('|').map(bloco => {
        const p = bloco.trim().split(':');
        return { ate: Number(p[0]), aliq: Number(p[1]), ded: Number(p[2] || 0) };
      });
    } catch (e) {
      return padrao;
    }
  }

  _TABELAS_ = {
    inss: faixas('TABELA_INSS', [
      { ate: 1621.00,  aliq: 0.075, ded: 0 },
      { ate: 2902.84,  aliq: 0.09,  ded: 24.32 },
      { ate: 4354.27,  aliq: 0.12,  ded: 111.40 },
      { ate: Infinity, aliq: 0.14,  ded: 198.49 }
    ]),
    inssTeto: Number(_feriasParam_('INSS_TETO', 988.09)),

    irrf: faixas('TABELA_IRRF', [
      { ate: 2428.80,  aliq: 0,     ded: 0 },
      { ate: 2826.65,  aliq: 0.075, ded: 182.16 },
      { ate: 3751.05,  aliq: 0.15,  ded: 394.16 },
      { ate: 4664.68,  aliq: 0.225, ded: 675.49 },
      { ate: Infinity, aliq: 0.275, ded: 908.73 }
    ]),
    irrfSimplificadoTeto: Number(_feriasParam_('IRRF_SIMPLIFICADO_TETO', 7350)),
    irrfSimplificadoBase: Number(_feriasParam_('IRRF_SIMPLIFICADO_BASE', 978.62)),
    irrfSimplificadoFator: Number(_feriasParam_('IRRF_SIMPLIFICADO_FATOR', 0.133145)),

    abonoIncluiTerco: _sim_(_feriasParam_('ABONO_INCLUI_TERCO', 'Nao'))
  };

  return _TABELAS_;
}

function _r2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function _calcINSS_(base) {
  if (base <= 0) return 0;

  const t = _tabelas_();
  const f = t.inss.find(x => base <= x.ate) || t.inss[t.inss.length - 1];

  return _r2_(Math.min(base * f.aliq - f.ded, t.inssTeto));
}

function _calcIRRF_(baseBruta, inss) {
  const t = _tabelas_();
  const base = baseBruta - inss;

  if (base <= 0) return 0;

  const f = t.irrf.find(x => base <= x.ate) || t.irrf[t.irrf.length - 1];
  const imposto = base * f.aliq - f.ded;

  // Desconto simplificado (Lei 14.848/2024): reduz o imposto das faixas mais baixas.
  const simplificado = baseBruta <= t.irrfSimplificadoTeto
    ? Math.max(0, t.irrfSimplificadoBase - t.irrfSimplificadoFator * baseBruta)
    : 0;

  return _r2_(Math.max(0, imposto - simplificado));
}

/**
 * Folha completa de uma solicitação de férias.
 * É esta função que o DP usa para conferir com o Alterdata.
 */
function _folhaFerias_(idColaborador, dias, abono, data) {
  const sal = _salarioVigente_(idColaborador, data);
  const t = _tabelas_();

  const remun = sal.remuneracao;
  const diaria = remun / 30;

  const bruto = _r2_(diaria * Number(dias || 0));
  const terco = _r2_(bruto / 3);

  const valorAbono = _r2_(diaria * Number(abono || 0));
  const tercoAbono = t.abonoIncluiTerco ? _r2_(valorAbono / 3) : 0;

  const baseINSS = _r2_(bruto + terco);
  const inss = _calcINSS_(baseINSS);
  const irrf = _calcIRRF_(baseINSS, inss);

  const proventos = _r2_(bruto + terco + valorAbono + tercoAbono);
  const descontos = _r2_(inss + irrf);
  const liquido = _r2_(proventos - descontos);

  return {
    // base de cálculo
    remuneracaoBase: _r2_(remun),
    salarioBase: _r2_(sal.base),
    adicionalNoturno: _r2_(sal.noturno),
    gratificacao: _r2_(sal.gratificacao),
    diasGozo: Number(dias || 0),
    diasAbono: Number(abono || 0),

    // proventos
    feriasBruto: bruto,
    tercoConstitucional: terco,
    abono: valorAbono,
    tercoAbono: tercoAbono,
    totalProventos: proventos,

    // descontos (o que o DP360 calcula, consignado e outros ficam só no Alterdata)
    inss: inss,
    irrf: irrf,
    totalDescontos: descontos,
    baseINSS: baseINSS,
    baseIRRF: _r2_(baseINSS - inss),

    liquido: liquido,

    salarioVigenteEm: _isoF_(data),
    calculadoEm: _isoF_(new Date())
  };
}

/**
 * Compatibilidade: o calendário usa o LÍQUIDO, igual à planilha antiga ("Prévia férias").
 * idPeriodo (opcional): quando informado, aplica o dobro do art. 137 CLT se `data` (o início
 * do gozo) for depois do CONCEDER_ATE desse período — a mesma regra que já existia só na
 * PROJEÇÃO do calendário (feriasCalendario), mas nunca era aplicada ao valor realmente
 * gravado em CUSTO_PREVISTO ao solicitar/deferir. Sem idPeriodo, comportamento inalterado
 * (usado assim pelo próprio calendário, que já dobra por fora ao projetar período sem
 * solicitação ainda — não passar idPeriodo aqui evita dobrar duas vezes nesse caso).
 */
function _calcularCusto_(idColaborador, dias, abono, data, idPeriodo) {
  const f = _folhaFerias_(idColaborador, dias, abono, data);
  f.total = f.liquido;

  if (idPeriodo) {
    const periodo = _periodos_().find(p => String(p.ID_PERIODO) === String(idPeriodo));
    const concederAte = periodo && _dataF_(periodo.CONCEDER_ATE);
    const inicio = _dataF_(data);
    if (concederAte && inicio && inicio > concederAte && _sim_(_feriasParam_('DOBRAR_FERIAS_VENCIDAS', 'Sim'))) {
      f.total = _r2_(f.total * 2);
      f.dobradoPorVencimento = true;
    }
  }

  return f;
}

/**
 * FERIAS.PROVISAO, memória de cálculo de um colaborador, para conferir com o Alterdata.
 * payload: { idPeriodo }  ou  { idSolicitacao }
 */
function feriasProvisao(user, p) {
  const periodos = _periodos_();
  const sols = _solicitacoes_();

  let periodo = null;
  let dias = 0, abono = 0, data = null, origem = '';

  if (p.idSolicitacao) {
    const s = sols.find(x => String(x.ID_SOLICITACAO) === String(p.idSolicitacao));
    if (!s) throw new Error('Solicitação não encontrada.');

    periodo = periodos.find(x => String(x.ID_PERIODO) === String(s.ID_PERIODO));
    dias = Number(s.DIAS || 0);
    abono = Number(s.ABONO || 0);
    data = _dataF_(s.DATA_INICIO) || _hojeFerias_();
    origem = 'SOLICITACAO ' + s.ID_SOLICITACAO + ' (' + s.STATUS + ')';

    // Se já foi deferida, mostra o SNAPSHOT congelado, não recalcula.
    if (String(s.STATUS).toUpperCase() === 'DEFERIDA' && s.CUSTO_SNAPSHOT_JSON) {
      try {
        const snap = JSON.parse(s.CUSTO_SNAPSHOT_JSON);
        snap.congelado = true;
        snap.origem = origem;
        snap.nome = s.NOME;
        return { ok: true, provisao: snap };
      } catch (e) { /* recalcula abaixo */ }
    }

  } else {
    periodo = periodos.find(x => String(x.ID_PERIODO) === String(p.idPeriodo));
    if (!periodo) throw new Error('Período não encontrado.');

    dias = _saldoDoPeriodo_(periodo, sols);   // provisão do saldo em aberto
    abono = 0;
    data = _dataF_(periodo.CONCEDER_ATE) || _hojeFerias_();
    origem = 'PROVISÃO do saldo em aberto (' + dias + ' dias)';
  }

  if (!periodo) throw new Error('Período não encontrado.');

  // Escopo: gestor só vê a própria equipe.
  if (String(user.PERFIL).toUpperCase() === 'GESTOR') {
    const equipe = _equipeDoGestor_(user.EMAIL);
    if (equipe.indexOf(String(periodo.ID_COLABORADOR)) === -1) {
      throw new Error('Este colaborador não está na sua equipe.');
    }
  }

  const folha = _folhaFerias_(periodo.ID_COLABORADOR, dias, abono, data);

  // Mesma regra do dobro do art. 137 CLT aplicada em _calcularCusto_ (persistido em
  // CUSTO_PREVISTO) — sem isso, a "memória de cálculo" mostrava ao DP um valor menor do
  // que o que efetivamente seria gravado/pago quando o período já está vencido.
  const concederAte = _dataF_(periodo.CONCEDER_ATE);
  const inicioCalc = _dataF_(data);
  if (concederAte && inicioCalc && inicioCalc > concederAte && _sim_(_feriasParam_('DOBRAR_FERIAS_VENCIDAS', 'Sim'))) {
    folha.liquido = _r2_(folha.liquido * 2);
    folha.dobradoPorVencimento = true;
  }

  folha.nome = periodo.NOME;
  folha.matricula = periodo.MATRICULA;
  folha.empresa = periodo.EMPRESA;
  folha.periodoAquisitivo = _fmtBRF_(periodo.AQUIS_INICIO) + ' a ' + _fmtBRF_(periodo.AQUIS_FIM);
  folha.origem = origem;
  folha.congelado = false;

  return { ok: true, provisao: folha };
}

/* ============================================================================================ */
/*  AFASTAMENTOS x PERÍODOS, marca PERDIDO / CONGELADO (CLT art. 133 IV)                        */
/* ============================================================================================ */

/**
 * Não apaga nada: muda o STATUS e escreve o motivo na ORIGEM.
 * Reversível, o DP pode devolver o período para ABERTO, e fica na auditoria quem fez.
 */
function marcarPeriodosAfastados() {
  _invalidarCacheFerias_();

  const lock = LockService.getScriptLock();
  lock.waitLock(60000);

  try {
    const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
    const h = _headers_(sh);
    const periodos = _sheetToObjects_(sh);
    const afast = _afastamentosPorColaborador_();
    const sols = _solicitacoes_();

    let perdidos = 0, congelados = 0, diasRemovidos = 0;

    periodos.forEach(p => {
      const atual = String(p.STATUS || '').toUpperCase();
      if (FERIAS.STATUS_INATIVOS.indexOf(atual) > -1) return;

      const efeito = _efeitoAfastamentoNoPeriodo_(p, afast);
      if (!efeito) return;

      const temDeferida = sols.some(s =>
        String(s.ID_PERIODO) === String(p.ID_PERIODO) &&
        String(s.STATUS).toUpperCase() === 'DEFERIDA');

      if (temDeferida) {
        _auditar_('FERIAS_AFASTADO_COM_DEFERIDA', '', 'marcarPeriodosAfastados', false,
          p.NOME + ': afastamento atinge período que já tem férias deferidas. Conferir manualmente.',
          { idPeriodo: p.ID_PERIODO });
        return;
      }

      diasRemovidos += _saldoDoPeriodo_(p, sols);

      _atualizarLinha_(sh, p._rowNumber, h, {
        STATUS: efeito.status,
        ORIGEM: String(p.ORIGEM || '') + ' | ' + efeito.status + ' em ' + _isoF_(_hojeFerias_()) + ': ' + efeito.motivo
      });

      if (efeito.status === 'PERDIDO') perdidos++; else congelados++;
    });

    _invalidarCacheFerias_();

    const msg = 'marcarPeriodosAfastados: ' + perdidos + ' perdido(s) · ' + congelados +
      ' congelado(s) · ' + diasRemovidos + ' dia(s) de saldo removidos do cálculo.';

    _auditar_('FERIAS_PERIODOS_AFASTADOS', '', 'marcarPeriodosAfastados', true, msg,
      { perdidos: perdidos, congelados: congelados, dias: diasRemovidos });

    console.log(msg);
    return msg;

  } finally {
    lock.releaseLock();
  }
}

/** Reverte um período marcado (o DP decidiu que o direito era devido). Deixa rastro. */
function reabrirPeriodo(idPeriodo, justificativa) {
  _invalidarCacheFerias_();

  if (!idPeriodo || !justificativa) {
    throw new Error('Use: reabrirPeriodo("PER-XXXX", "justificativa").');
  }

  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);
  const p = _sheetToObjects_(sh).find(x => String(x.ID_PERIODO) === String(idPeriodo));

  if (!p) throw new Error('Período não encontrado: ' + idPeriodo);

  _atualizarLinha_(sh, p._rowNumber, h, {
    STATUS: 'ABERTO',
    ORIGEM: String(p.ORIGEM || '') + ' | REABERTO em ' + _isoF_(_hojeFerias_()) + ': ' + justificativa
  });

  _invalidarCacheFerias_();

  _auditar_('FERIAS_PERIODO_REABERTO', '', 'reabrirPeriodo', true,
    p.NOME + ': período reaberto. ' + justificativa, { idPeriodo: idPeriodo });

  return 'Período ' + idPeriodo + ' reaberto.';
}

function _linhaPeriodo_(h, id, c, ini, fim, status, hoje) {
  const idPer = 'PER-' + _uuid_().slice(0, 8).toUpperCase();

  return h.map(col => {
    switch (col) {
      case 'ID_PERIODO': return idPer;
      case 'ID_COLABORADOR': return id;
      case 'MATRICULA': return c.MATRICULA || '';
      case 'NOME': return c.NOME || '';
      case 'EMPRESA_COD': return c.EMPRESA_COD || '';
      case 'EMPRESA': return c.EMPRESA || '';
      case 'DEPARTAMENTO': return c.DEPARTAMENTO_ATUAL || '';
      case 'GESTOR_EMAIL': return c.GESTOR_EMAIL || '';
      case 'AQUIS_INICIO': return ini;
      case 'AQUIS_FIM': return fim;
      case 'DIAS_DIREITO': return 30;
      case 'FALTAS': return 0;
      case 'DIAS_GOZADOS_ANTERIORES': return 0;
      case 'CONCEDER_ATE': return _addAnosF_(fim, 1);
      case 'STATUS': return status;
      case 'ORIGEM': return 'GERADO_' + _isoF_(hoje);
      default: return '';
    }
  });
}

/** EM_CURSO → ABERTO quando o período aquisitivo se completa. Roda na rotina diária. */
function fecharPeriodosEmCurso() {
  _invalidarCacheFerias_();

  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);
  const hoje = _hojeFerias_();

  let fechados = 0;

  _sheetToObjects_(sh).forEach(p => {
    if (String(p.STATUS || '').toUpperCase() !== 'EM_CURSO') return;

    const fim = _dataF_(p.AQUIS_FIM);
    if (!fim || fim > hoje) return;

    _atualizarLinha_(sh, p._rowNumber, h, { STATUS: 'ABERTO' });
    fechados++;
  });

  _invalidarCacheFerias_();

  const msg = 'fecharPeriodosEmCurso: ' + fechados + ' período(s) completado(s) e liberado(s) para agendamento.';
  if (fechados) _auditar_('FERIAS_PERIODOS_FECHADOS', '', 'fecharPeriodosEmCurso', true, msg, {});

  console.log(msg);
  return msg;
}

/* ============================================================================================ */
/*  E-MAILS, tom acolhedor. O DP não é o vilão: ele acompanha, confere e confirma.              */
/* ============================================================================================ */

function _emailDoColaborador_(idColaborador) {
  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(idColaborador));
  if (!c) return '';

  const inst = String(c.EMAIL_INSTITUCIONAL || '').trim();
  const pes = String(c.EMAIL_PESSOAL || '').trim();

  return (inst.indexOf('@') > -1 ? inst : (pes.indexOf('@') > -1 ? pes : ''));
}

function _emailDoDP_() {
  return String(_feriasParam_('EMAIL_DP', 'ferias@cieds.org.br'));
}

function _guiaUrl_() {
  return String(_feriasParam_('GUIA_FERIAS_URL', ''));
}

function _guiaFimDeAnoUrl_() {
  return String(_feriasParam_('GUIA_FERIAS_FIM_URL', ''));
}

function _portalDPUrl_() {
  return String(_feriasParam_('PORTAL_DP_URL', ''));
}

function _portalGestorUrl_() {
  return String(_feriasParam_('PORTAL_GESTOR_URL', ''));
}

function _moldura_(titulo, corpo, rodapePersonalizado, incluirGuia) {
  const guia = (incluirGuia === false) ? '' : _guiaUrl_();

  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;' +
    'border:1px solid #e6ecee;border-radius:16px;overflow:hidden;background:#fff">' +
    '<div style="background:linear-gradient(135deg,#0E5A6B,#093F4B);padding:22px 26px">' +
      '<div style="color:#fff;font-size:17px;font-weight:700">' + titulo + '</div>' +
      '<div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:3px">Departamento Pessoal · CIEDS</div>' +
    '</div>' +
    '<div style="padding:26px;color:#17252a;font-size:14.5px;line-height:1.65">' + corpo +
      (guia ? '<p style="margin-top:22px"><a href="' + guia + '" style="color:#0E5A6B;font-weight:700">' +
        '📘 Consultar o Guia de Férias</a></p>' : '') +
      '<p style="margin-top:26px;color:#8a9a9e;font-size:11.5px;line-height:1.6">' +
        (rodapePersonalizado || 'Mensagem automática do Portal. Qualquer dúvida, é só responder este e-mail, a gente lê.') +
      '</p>' +
    '</div></div>';
}

function _quadro_(linhas) {
  return '<table style="width:100%;border-collapse:collapse;background:#f5f8f9;border-radius:12px;margin:14px 0">' +
    linhas.map(l =>
      '<tr><td style="padding:10px 16px;color:#6b7c81;font-size:13px">' + l[0] + '</td>' +
      '<td style="padding:10px 16px;font-weight:700;font-size:13.5px;text-align:right">' + l[1] + '</td></tr>'
    ).join('') + '</table>';
}

function _enviar_(para, assunto, html, anexos, cc, semCopiaFerias) {
  if (!para || String(para).indexOf('@') === -1) return false;

  try {
    const opcoes = { to: para, subject: assunto, htmlBody: html, from: 'autodppessoal@cieds.org.br' };
    if (anexos && anexos.length) opcoes.attachments = anexos;

    // Todo e-mail sai como autodppessoal@cieds.org.br — ferias@cieds.org.br sempre entra em
    // cópia, exceto se já for o próprio destinatário (evita to/cc duplicados).
    // [2026-10-16] semCopiaFerias = true: outros módulos (ex.: Rescisão) que usam esta função não
    // copiam ferias@ — e-mails de desligamento estavam chegando na caixa de férias.
    const copias = [cc, semCopiaFerias ? '' : 'ferias@cieds.org.br'].filter(Boolean);
    const ccFinal = copias.filter(e => String(para).toLowerCase().indexOf(String(e).toLowerCase()) === -1).join(',');
    if (ccFinal) opcoes.cc = ccFinal;

    MailApp.sendEmail(opcoes);
    return true;
  } catch (e) {
    console.error('Falha ao enviar e-mail para ' + para + ': ' + e);
    return false;
  }
}

/* ---- 1. Gestor: recebemos o seu pedido ---- */
function _mailSolicitacaoRecebida_(gestorEmail, nome, dias, abono, inicio, fim, ehFimDeAno) {
  // Prazo real do DP responder: fim de ano tem data fixa; nas janelas normais,
  // vem da própria janela (ou hoje + PRAZO_RESPOSTA_DP_DIAS se cair fora de janela).
  const prazoLimite = ehFimDeAno
    ? _dataF_(FERIAS.FIM_DE_ANO_PRAZO_DP)
    : _prazoDPParaSolicitacao_(_hojeFerias_(), inicio);
  const prazoTxt = prazoLimite ? _fmtBRF_(prazoLimite) : '';

  const corpo =
    '<p>Recebemos o pedido de férias. 🌴</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(nome)],
      ['Período', inicio ? (_fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)) : ','],
      ['Dias de descanso', dias + ' dia(s)'],
      ['Dias vendidos', abono ? (abono + ' dia(s)') : ',']
    ]) +
    '<p>Agora vamos <b>conferir a documentação e os prazos</b> e confirmar o agendamento. ' +
    (prazoTxt
      ? 'O DP tem até <b>' + prazoTxt + '</b> para responder, e você recebe um e-mail assim que estiver tudo certo.</p>'
      : 'Você recebe um e-mail assim que estiver tudo certo.</p>') +
    (ehFimDeAno
      ? '<p>Se precisar mudar alguma coisa, é só responder este e-mail que a gente ajusta com você.</p>'
      : '<p>Se precisar mudar alguma coisa antes disso, é só cancelar o pedido no portal e enviar de novo.</p>');

  _enviar_(gestorEmail, 'Recebemos o pedido de férias de ' + nome, _moldura_('Pedido recebido ✅', corpo, '', false));
}

/* ---- 2. DP: chegou pedido novo ---- */
function _mailDPNovoPedido_(gestorEmail, nome, dias, abono, inicio, fim, custo, departamento) {
  const corpo =
    '<p>Um novo pedido de férias entrou na fila.</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(nome)],
      ['Departamento', _escapeHtml_(departamento || ',')],
      ['Pedido por', _escapeHtml_(gestorEmail)],
      ['Período', inicio ? (_fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)) : ','],
      ['Dias', dias + (abono ? ' + ' + abono + ' vendidos' : '')],
      ['Custo previsto', 'R$ ' + Number(custo || 0).toFixed(2)]
    ]);

  _enviar_(_emailDoDP_(), 'Novo pedido de férias, ' + nome, _moldura_('Novo pedido na fila', corpo, '', false));
}

/* ---- 3. Gestor: está confirmado ---- */
function _mailGestorConfirmada_(gestorEmail, nome, dias, abono, inicio, fim) {
  const corpo =
    '<p>Tudo certo! As férias de <b>' + _escapeHtml_(nome) + '</b> estão <b>confirmadas</b>. 🎉</p>' +
    _quadro_([
      ['Período', _fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)],
      ['Dias de descanso', dias + ' dia(s)'],
      ['Dias vendidos', abono ? (abono + ' dia(s)') : ',']
    ]) +
    '<p>A pessoa colaboradora já foi avisada por e-mail, com as orientações sobre pagamento e recibo de férias.</p>' +
    '<p>Bom planejamento de cobertura para o time! 💙</p>';

  _enviar_(gestorEmail, 'Férias confirmadas, ' + nome, _moldura_('Férias confirmadas 🌴', corpo, '', false));
}

/* ---- 4. Gestor: precisamos ajustar ---- */
function _mailGestorAjuste_(gestorEmail, nome, dias, inicio, fim, motivo, ehFimDeAno) {
  // Fim de ano usa o guia próprio; se o link não estiver cadastrado, cai no guia normal.
  const guiaFim = ehFimDeAno ? _guiaFimDeAnoUrl_() : '';
  const guiaUrl = guiaFim || _guiaUrl_();
  const guiaLabel = (ehFimDeAno && guiaFim)
    ? '📘 Consultar o Guia de Férias de Fim de Ano'
    : '📘 Consultar o Guia de Férias';

  const corpo =
    '<p>Sobre o pedido de férias de <b>' + _escapeHtml_(nome) + '</b>: <b>não conseguimos confirmar essas datas</b>, ' +
    'e queremos te ajudar a encontrar outra combinação que funcione.</p>' +
    _quadro_([
      ['Período pedido', inicio ? (_fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)) : ','],
      ['Dias', dias + ' dia(s)']
    ]) +
    '<div style="background:#e7f1f3;border-radius:12px;padding:14px 16px;margin:14px 0">' +
      '<b style="color:#0E5A6B">O que aconteceu:</b><br>' + _escapeHtml_(motivo || '') +
    '</div>' +
    '<p>Os dias <b>voltaram para o saldo</b> e já estão disponíveis no portal. É só escolher novas datas e enviar de novo, ' +
    'e se quiser conversar antes, a gente ajuda a achar a melhor janela.</p>' +
    (guiaUrl ? '<p style="margin-top:22px"><a href="' + guiaUrl + '" style="color:#0E5A6B;font-weight:700">' +
      guiaLabel + '</a></p>' : '');

  // incluirGuia=false: o guia já vai montado no corpo (com o link certo), pra não duplicar.
  _enviar_(gestorEmail, 'Vamos ajustar as férias de ' + nome, _moldura_('Precisamos ajustar as datas', corpo, '', false));
}

/* ---- 5. Colaborador: suas férias estão confirmadas ---- */
function _mailColaborador_(email, nome, dias, abono, inicio, fim) {
  const uteisAntes = Number(_feriasParam_('DIAS_UTEIS_PAGAMENTO_ANTES', 2));
  const reciboAntes = Number(_feriasParam_('DIAS_RECIBO_ANTES', 5));

  const pagamento = _subtrairUteis_(inicio, uteisAntes);
  const recibo = _addDiasF_(inicio, -reciboAntes);
  const volta = _addDiasF_(fim, 1);

  const primeiro = String(nome || '').split(' ')[0];

  const corpo =
    '<p>Olá, ' + _escapeHtml_(primeiro.charAt(0) + primeiro.slice(1).toLowerCase()) + '! 🌴</p>' +
    '<p>Suas <b>férias estão confirmadas</b>. Esse tempo é seu: descansa, desliga um pouco, faz o que te faz bem. ' +
    'A gente cuida do resto por aqui.</p>' +
    _quadro_([
      ['Suas férias', _fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)],
      ['Dias de descanso', dias + ' dia(s)'],
      (abono ? ['Dias vendidos', abono + ' dia(s)'] : ['Você volta em', _fmtBRF_(volta)])
    ]) +
    (abono ? '<p style="font-size:13px;color:#6b7c81">Você volta ao trabalho em <b>' + _fmtBRF_(volta) + '</b>.</p>' : '') +
    '<div style="background:#e9f7ef;border-radius:12px;padding:16px 18px;margin:18px 0">' +
      '<b style="color:#1a8a4b">O que acontece agora</b>' +
      '<ul style="margin:10px 0 0;padding-left:18px;line-height:1.8;font-size:13.5px">' +
        '<li>💰 <b>O valor das férias</b> será depositado até <b>' + _fmtBRF_(pagamento) + '</b>, ' +
          'garantindo o pagamento antes do início do período.</li>' +
        '<li>✍️ <b>O recibo</b> será enviado para assinatura por volta de <b>' + _fmtBRF_(recibo) + '</b>, ' +
          'pela plataforma Autentique. Vale ficar de olho no e-mail para não perder o prazo.</li>' +
      '</ul>' +
    '</div>' +
    '<p>Qualquer dúvida, é só falar com a gente, estamos por aqui.</p>' +
    '<p><b>Bom descanso! 💙</b></p>';

  _enviar_(email, 'Suas férias estão confirmadas 🌴', _moldura_('Suas férias estão confirmadas', corpo,
    'Se algum dado estiver diferente do combinado, responda este e-mail que a gente confere junto.', false));
}

/* ---- 6. Colaborador: suas férias começam em breve (rotina) ---- */
function _mailColaboradorLembrete_(email, nome, inicio, fim) {
  const primeiro = String(nome || '').split(' ')[0];

  const corpo =
    '<p>Olá, ' + _escapeHtml_(primeiro.charAt(0) + primeiro.slice(1).toLowerCase()) + '!</p>' +
    '<p>Passando só para lembrar: suas férias começam em <b>' + _fmtBRF_(inicio) + '</b>. 🌴</p>' +
    _quadro_([
      ['Suas férias', _fmtBRF_(inicio) + ' a ' + _fmtBRF_(fim)],
      ['Você volta em', _fmtBRF_(_addDiasF_(fim, 1))]
    ]) +
    '<p>Se ainda não assinou o recibo de férias, dá uma olhadinha no seu e-mail, ele foi enviado pela Autentique.</p>' +
    '<p>Aproveita bastante! 💙</p>';

  _enviar_(email, 'Suas férias começam em breve 🌴', _moldura_('Está chegando!', corpo, '', false));
}

function _subtrairUteis_(d, n) {
  const x = new Date(d);
  let faltam = Number(n);

  while (faltam > 0) {
    x.setDate(x.getDate() - 1);
    const dow = x.getDay();
    if (dow !== 0 && dow !== 6) faltam--;
  }

  return x;
}

/* ============================================================================================ */
/*  GERAÇÃO DE PERÍODOS, por encadeamento, nunca recalculando da admissão                       */
/* ============================================================================================ */

/**
 * Cria os períodos aquisitivos que faltam.
 * Regra da data-base (o "marco"):
 *   1) último período existente  → marco = fim + 1 dia   (encadeamento: preserva correções do DP)
 *   2) sem período               → marco = data de admissão
 *   3) afastamento que reinicia  → marco = data de retorno   (CLT art. 133 IV e §2º)
 *
 * Não sobrescreve nada. Só acrescenta.
 */
function gerarPeriodos() {
  _invalidarCacheFerias_();   // leitura sempre fresca antes de escrever
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);

  try {
    const hoje = _hojeFerias_();
    const colaboradores = _colaboradores_();
    const periodos = _periodos_();
    const mapaAfast = _afastamentosPorColaborador_();

    const ultimoPorColab = {};
    periodos.forEach(p => {
      const id = String(p.ID_COLABORADOR);
      const fim = _dataF_(p.AQUIS_FIM);
      if (!fim) return;
      if (!ultimoPorColab[id] || fim > ultimoPorColab[id]) ultimoPorColab[id] = fim;
    });

    const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
    const h = _headers_(sh);
    const novos = [];

    let pulados = 0;

    colaboradores.forEach(c => {
      const id = String(c.ID_COLABORADOR);
      const admissao = _dataF_(c.DATA_ADMISSAO);
      if (!admissao) return;

      const info = mapaAfast[id];

      // Afastado agora, com contrato suspenso: o período não corre. Nada a gerar.
      if (info && info.emAberto &&
          (info.reinicia.some(a => a.emAberto) || info.congela.some(a => a.emAberto))) {
        pulados++;
        return;
      }

      // Retorno de afastamento que reinicia: o novo período conta a partir do retorno (art. 133 §2º).
      let retornoReinicia = null;

      if (info) {
        info.reinicia.forEach(a => {
          const ret = _dataF_(a.retorno);
          if (ret && (!retornoReinicia || ret > retornoReinicia)) retornoReinicia = ret;
        });
      }

      let marco;

      if (retornoReinicia && (!ultimoPorColab[id] || retornoReinicia > ultimoPorColab[id])) {
        marco = retornoReinicia;
      } else if (ultimoPorColab[id]) {
        marco = _addDiasF_(ultimoPorColab[id], 1);
      } else {
        marco = admissao;
      }

      // Cria os períodos completos e, no fim, o período EM CURSO.
      let guarda = 0;

      while (guarda++ < 20) {
        const fim = _addDiasF_(_addAnosF_(marco, 1), -1);

        if (fim > hoje) {
          // Período aquisitivo ainda correndo. Entra como EM_CURSO:
          // sem saldo de gozo, mas é aqui que o abono pode ser pedido no prazo.
          const jaTem =
            periodos.some(x => String(x.ID_COLABORADOR) === id &&
                               String(x.STATUS || '').toUpperCase() === 'EM_CURSO') ||
            novos.some(l => String(l[h.indexOf('ID_COLABORADOR')]) === id &&
                            String(l[h.indexOf('STATUS')]) === 'EM_CURSO');

          if (!jaTem) {
            novos.push(_linhaPeriodo_(h, id, c, marco, fim, 'EM_CURSO', hoje));
          }

          break;
        }

        novos.push(_linhaPeriodo_(h, id, c, marco, fim, 'ABERTO', hoje));

        marco = _addDiasF_(fim, 1);
      }
    });

    if (novos.length) {
      sh.getRange(sh.getLastRow() + 1, 1, novos.length, h.length).setValues(novos);
    _invalidarCacheFerias_();
    }

    const msg = 'gerarPeriodos: ' + novos.length + ' período(s) criado(s) · ' +
      pulados + ' colaborador(es) pulado(s) por afastamento em aberto.';

    _auditar_('FERIAS_PERIODOS_GERADOS', '', 'gerarPeriodos', true, msg,
      { criados: novos.length, pulados: pulados });
    console.log(msg);

    return msg;

  } finally {
    lock.releaseLock();
  }
}


/* ============================================================================================ */
/*  HELPERS DE DATA / FERIADO                                                                    */
/* ============================================================================================ */

function _hojeFerias_() {
  const s = Utilities.formatDate(new Date(), DP360.FUSO, 'yyyy/MM/dd');
  return new Date(s + ' 12:00:00');
}

function _dataF_(v) {
  if (!v && v !== 0) return null;

  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // Reconstrói a partir do calendário visto pelo fuso do projeto, sem isso, uma data vinda
    // da planilha como objeto Date (meia-noite em outro fuso) pode virar "o dia anterior" aqui,
    // deslocando período aquisitivo/conceder_até em 1 dia.
    const iso = Utilities.formatDate(v, DP360.FUSO, 'yyyy-MM-dd');
    const mm = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]), 12, 0, 0);
  }

  const s = String(v).trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function _dataDeISO_(iso) {
  const d = _dataF_(iso);
  if (!d) throw new Error('Data inválida: ' + iso);
  return d;
}

function _isoF_(v) {
  const d = _dataF_(v);
  return d ? Utilities.formatDate(d, DP360.FUSO, 'yyyy-MM-dd') : '';
}

function _fmtBRF_(v) {
  const d = _dataF_(v);
  return d ? Utilities.formatDate(d, DP360.FUSO, 'dd/MM/yyyy') : '';
}

/* ============================================================================================ */
/*  JANELAS DE AGENDAMENTO                                                                       */
/* ============================================================================================ */

function _mmddDeData_(d) {
  return Utilities.formatDate(d, DP360.FUSO, 'MM-dd');
}

function _mmddEntre_(mmdd, ini, fim) {
  return mmdd >= ini && mmdd <= fim;
}

/** A janela cujo período de AGENDAMENTO contém a data dada. */
function _janelaDeAgendamentoAtual_(data) {
  const mmdd = _mmddDeData_(data || _hojeFerias_());
  return FERIAS.JANELAS.find(j => _mmddEntre_(mmdd, j.agendInicio, j.agendFim)) || null;
}

/** A janela cujo período de GOZO contém a data de início do pedido. */
function _janelaDoGozo_(dataInicio) {
  const mmdd = _mmddDeData_(dataInicio);
  return FERIAS.JANELAS.find(j => _mmddEntre_(mmdd, j.gozoInicio, j.gozoFim)) || null;
}

/**
 * Data-limite pro DP decidir uma solicitação:
 *   - se foi solicitada DENTRO do período de agendamento de uma janela, e o gozo cai
 *     dentro do período de gozo DESSA MESMA janela, o prazo vira o fim do retorno do DP
 *     daquela janela (mesmo que isso passe de 15 dias).
 *   - senão, os 15 dias corridos padrão a partir da solicitação.
 * Retorna a data-limite (Date), não a quantidade de dias.
 */
function _prazoDPParaSolicitacao_(solicitadoEm, dataInicioGozo) {
  const prazoDP = Number(_feriasParam_('PRAZO_RESPOSTA_DP_DIAS', 15));

  if (solicitadoEm && dataInicioGozo) {
    const janelaAgend = _janelaDeAgendamentoAtual_(solicitadoEm);
    const janelaGozo = _janelaDoGozo_(dataInicioGozo);

    if (janelaAgend && janelaGozo && janelaAgend.id === janelaGozo.id) {
      const ano = solicitadoEm.getFullYear();
      const partes = janelaAgend.retornoDPFim.split('-');
      return new Date(ano, Number(partes[0]) - 1, Number(partes[1]), 23, 59, 59);
    }
  }

  return solicitadoEm ? _addDiasF_(solicitadoEm, prazoDP) : null;
}

/**
 * Envia lembrete a todos os gestores no dia de abertura de cada janela. Roda na rotina diária,
 * dispara só quando hoje bate exatamente com o início do agendamento de alguma janela.
 */
function rotinaLembreteJanelaFerias() {
  const janela = FERIAS.JANELAS.find(j => _mmddDeData_(_hojeFerias_()) === j.agendInicio);
  if (!janela) return 'Nenhuma janela abre hoje.';

  const gestores = {};
  _colaboradores_().forEach(c => {
    const e = _normalizarEmail_(c.GESTOR_EMAIL);
    if (e) gestores[e] = true;
  });

  const excluidos = String(_feriasParam_('LEMBRETE_JANELA_EXCLUIR_EMAILS', ''))
    .split(',')
    .map(e => _normalizarEmail_(e))
    .filter(Boolean);
  excluidos.forEach(e => delete gestores[e]);

  const emails = Object.keys(gestores);
  const partesRetIni = janela.retornoDPInicio.split('-');
  const partesRetFim = janela.retornoDPFim.split('-');
  const anoRef = _hojeFerias_().getFullYear();
  const portalGestor = _portalGestorUrl_();

  const corpo =
    '<p>Abriu hoje o período pra agendar férias da <b>' + janela.nome + '</b>. 🌴</p>' +
    _quadro_([
      ['Período de gozo', _fmtBRF_(new Date(anoRef, Number(janela.gozoInicio.split('-')[0]) - 1, Number(janela.gozoInicio.split('-')[1]))) +
        ' a ' + _fmtBRF_(new Date(anoRef, Number(janela.gozoFim.split('-')[0]) - 1, Number(janela.gozoFim.split('-')[1])))],
      ['Prazo pra agendar', 'até ' + janela.agendFim.split('-').reverse().join('/')],
      ['O DP responde até', partesRetFim[1] + '/' + partesRetFim[0]]
    ]) +
    '<p>Aproveite essa janela para organizar as férias do seu time com calma e escolher o período que ' +
    'melhor funciona para todos. Depois da solicitação, o DP terá até a data indicada acima para confirmar ' +
    'o agendamento, permitindo que todo o processo aconteça com tranquilidade.</p>' +
    (portalGestor ? '<p style="margin-top:18px"><a href="' + portalGestor + '" style="color:#0E5A6B;font-weight:700">🔗 Abrir o Portal</a></p>' : '');

  emails.forEach(e => _enviar_(e, 'Abriu o agendamento de férias, ' + janela.nome, _moldura_('Nova janela de agendamento', corpo, '', false)));

  const msg = 'rotinaLembreteJanelaFerias: ' + janela.nome + ' avisada a ' + emails.length + ' gestor(es).';
  console.log(msg);
  return msg;
}

function criarGatilhoLembreteJanela() {
  ScriptApp.newTrigger('rotinaLembreteJanelaFerias').timeBased().everyDays(1).atHour(7).create();
  return 'Gatilho diário de lembrete de janela criado (07h).';
}

/** Rode uma vez pelo editor (▶️ Executar) pra tirar o Vander do aviso de abertura de janela. */
function configurarExclusaoLembreteJanelaVander() {
  _setFeriasParam_('LEMBRETE_JANELA_EXCLUIR_EMAILS', 'vander.rj@cieds.org.br');
  return 'Parâmetro LEMBRETE_JANELA_EXCLUIR_EMAILS definido: vander.rj@cieds.org.br';
}

/**
 * Alerta o DP sobre férias compulsórias chegando perto do limite legal (30 dias antes do
 * conceder_até), quando ainda NÃO existe nenhuma solicitação (pendente ou deferida) cobrindo
 * aquele período. Roda na rotina diária.
 */
function rotinaAlertaCompulsoriasFerias() {
  const hoje = _hojeFerias_();
  const dias = Number(_feriasParam_('ALERTA_COMPULSORIA_DIAS_ANTES', 60));
  const periodos = _periodos_();
  const sols = _solicitacoes_();

  const alvo = periodos.filter(p => {
    if (!_colaboradorEstaAtivo_(p.ID_COLABORADOR)) return false;
    if (_semDireitoAFerias_(_colaboradorPorId_(p.ID_COLABORADOR))) return false;

    const saldo = _saldoDoPeriodo_(p, sols);
    if (saldo <= 0) return false;

    const lim = _dataF_(p.CONCEDER_ATE);
    if (!lim) return false;

    const faltam = Math.round((lim - hoje) / 86400000);
    if (faltam !== dias) return false; // dispara uma vez só, no dia exato

    // já existe alguma solicitação (pendente ou deferida) tentando cobrir o saldo?
    const jaTemPedido = sols.some(s =>
      String(s.ID_PERIODO) === String(p.ID_PERIODO) &&
      ['PENDENTE', 'DEFERIDA'].indexOf(String(s.STATUS).toUpperCase()) > -1);

    return !jaTemPedido;
  });

  if (!alvo.length) {
    console.log('rotinaAlertaCompulsoriasFerias: nada a alertar hoje.');
    return 'Nada a alertar hoje.';
  }

  const linhas = alvo.map(p => {
    const colabLive = _colaboradorPorId_(p.ID_COLABORADOR);
    const gestor = (colabLive && colabLive.GESTOR_EMAIL) || p.GESTOR_EMAIL || '(sem gestor)';
    return '<p style="margin:0 0 14px"><b>' + _escapeHtml_(p.NOME) + '</b><br>' +
      'Saldo: ' + _saldoDoPeriodo_(p, sols) + ' dias · Conceder até: ' + _fmtBRF_(p.CONCEDER_ATE) + '<br>' +
      'Gestor: ' + _escapeHtml_(gestor) + '</p>';
  }).join('');

  const corpo =
    '<p>As férias abaixo estão a até <b>' + dias + ' dias</b> da data-limite para concessão e ainda não ' +
    'possuem agendamento registrado:</p>' +
    linhas +
    '<p>É importante alinhar o agendamento com os gestores o quanto antes. Caso as férias não sejam ' +
    'programadas em tempo hábil, poderá ser necessário definir o período de forma compulsória para evitar ' +
    'o vencimento do prazo legal e o risco de pagamento em dobro, conforme o art. 137 da CLT.</p>';

  _enviar_('ferias@cieds.org.br', 'Alerta: ' + alvo.length + ' férias sem agendamento perto do prazo',
    _moldura_('⚠️ Férias próximas do prazo legal', corpo, '', false));

  const msg = 'rotinaAlertaCompulsoriasFerias: ' + alvo.length + ' pessoa(s) alertada(s) ao DP.';
  console.log(msg);
  return msg;
}

function criarGatilhoAlertaCompulsorias() {
  ScriptApp.newTrigger('rotinaAlertaCompulsoriasFerias').timeBased().everyDays(1).atHour(7).create();
  return 'Gatilho diário de alerta de compulsórias criado (07h).';
}

function _mesRefF_(v) {
  const d = _dataF_(v);
  return d ? Utilities.formatDate(d, DP360.FUSO, 'yyyy-MM') : '';
}

function _addDiasF_(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + Number(n));
  return x;
}

function _addAnosF_(d, n) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + Number(n));
  return x;
}

function _pascoaF_(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

function _feriadosDoAnoF_(ano) {
  const f = {};
  const add = (iso, nome) => f[iso] = nome;

  add(ano + '-01-01', 'Confraternização Universal');
  add(ano + '-04-21', 'Tiradentes');
  add(ano + '-05-01', 'Dia do Trabalho');
  add(ano + '-09-07', 'Independência');
  add(ano + '-10-12', 'Nossa Senhora Aparecida');
  add(ano + '-11-02', 'Finados');
  add(ano + '-11-15', 'Proclamação da República');
  add(ano + '-11-20', 'Consciência Negra');
  add(ano + '-12-25', 'Natal');

  const pascoa = _pascoaF_(ano);
  add(_isoF_(_addDiasF_(pascoa, -2)), 'Sexta-feira Santa');
  add(_isoF_(_addDiasF_(pascoa, -47)), 'Carnaval');
  add(_isoF_(_addDiasF_(pascoa, 60)), 'Corpus Christi');

  return f;
}

function _feriadosMapF_() {
  const ano = _hojeFerias_().getFullYear();
  const todos = {};

  [ano, ano + 1, ano + 2].forEach(a => {
    const f = _feriadosDoAnoF_(a);
    Object.keys(f).forEach(k => todos[k] = f[k]);
  });

  return todos;
}

function _motivoFeriadoF_(inicio) {
  if (!FERIAS.BLOQUEAR_INICIO_FERIADO) return '';

  const feriados = _feriadosMapF_();
  const iso = _isoF_(inicio);

  if (feriados[iso]) {
    return 'As férias não podem começar em feriado (' + feriados[iso] + ').';
  }

  const n = Number(_feriasParam_('DIAS_VESPERA_FERIADO', FERIAS.DIAS_VESPERA_FERIADO));

  for (let k = 1; k <= n; k++) {
    const prox = _isoF_(_addDiasF_(inicio, k));
    if (feriados[prox]) {
      return 'As férias não podem começar nos ' + n + ' dias que antecedem o feriado de ' +
        feriados[prox] + ' (' + _fmtBRF_(_dataF_(prox)) + ').';
    }
  }

  return '';
}

/* ============================================================================================ */
/*  DIAGNÓSTICO                                                                                  */
/* ============================================================================================ */

function diagnosticarFerias() {
  const t0 = new Date();

  const periodos = _periodos_();
  const sols = _solicitacoes_();
  const hoje = _hojeFerias_();
  const mesAtual = _mesRefF_(hoje);

  const porStatusPeriodo = {};
  periodos.forEach(p => {
    const k = String(p.STATUS || '?').toUpperCase();
    porStatusPeriodo[k] = (porStatusPeriodo[k] || 0) + 1;
  });

  const porStatusSol = {};
  sols.forEach(s => {
    const k = String(s.STATUS || '?').toUpperCase();
    porStatusSol[k] = (porStatusSol[k] || 0) + 1;
  });

  const comSaldo = periodos.filter(p => _saldoDoPeriodo_(p, sols) > 0);
  const saldoTotal = periodos.reduce((t, p) => t + Math.max(0, _saldoDoPeriodo_(p, sols)), 0);

  // VENCIDAS: conceder_até já passou e ainda há saldo → art. 137 (dobro).
  const vencidas = comSaldo.filter(p => {
    const lim = _dataF_(p.CONCEDER_ATE);
    return lim && lim < hoje;
  });

  const semSalario = comSaldo.filter(p => _salarioVigente_(p.ID_COLABORADOR, hoje).remuneracao === 0);

  const afast = _afastamentosPorColaborador_();
  const afastadosComSaldo = periodos.filter(p =>
    _estaAfastadoAgora_(p.ID_COLABORADOR, afast) &&
    ['PERDIDO', 'CONGELADO'].indexOf(String(p.STATUS || '').toUpperCase()) > -1);

  const cal = feriasCalendario({ PERFIL: 'ADMIN' }, {}, { periodos: periodos, solicitacoes: sols });

  const out = {
    versao: FERIAS.VERSAO,
    tempoMs: new Date().getTime() - t0.getTime(),

    periodos: periodos.length,
    periodosPorStatus: porStatusPeriodo,
    periodosComSaldo: comSaldo.length,
    saldoTotalDias: saldoTotal,

    solicitacoes: sols.length,
    solicitacoesPorStatus: porStatusSol,

    alertas: {
      periodosSemGestor: periodos.filter(p => !((_colaboradorPorId_(p.ID_COLABORADOR) || {}).GESTOR_EMAIL || p.GESTOR_EMAIL)).length,
      periodosVENCIDOS_agendaveis: vencidas.length,
      diasVencidos: vencidas.reduce((t, p) => t + _saldoDoPeriodo_(p, sols), 0),
      periodosSuspensosPorAfastamento: afastadosComSaldo.length,
      periodosSemSalarioNoHistorico: semSalario.length
    },

    custo: {
      janela: cal.de + ' a ' + cal.ate,
      tetoMensal: cal.tetoPadrao,
      totalComprometido: cal.totalComprometido,
      totalPrevisao_compulsorias: cal.totalPrevisao,
      vencidasEmDobro: cal.totalVencidoEmDobro,
      mesesJaEstourados: cal.mesesEstourando,
      mesesEmRisco_seNinguemAntecipar: cal.mesesEmRisco
    },

    calendario12Meses: cal.meses.map(m => {
      const luz = m.semaforo === 'VERMELHO' ? '🔴' : (m.semaforo === 'AMARELO' ? '🟡' : '🟢');
      return luz + ' ' + m.mes +
        ' | comprometido R$ ' + m.comprometido.toLocaleString('pt-BR') +
        ' de R$ ' + m.teto.toLocaleString('pt-BR') + ' (' + m.percentualComprometido + '%)' +
        ' | previsão +R$ ' + m.previsao.toLocaleString('pt-BR') +
        ' (' + m.pessoasCompulsorias + ' compulsórias)' +
        (m.pessoasVencidas ? ' | VENCIDAS ' + m.pessoasVencidas : '') +
        ' | espaço livre R$ ' + m.disponivel.toLocaleString('pt-BR');
    })
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Períodos vencidos (conceder_até no passado, com saldo).
 * Separa quem PODE agendar hoje (ação urgente) de quem está afastado (passivo suspenso).
 */
function feriasVencidas() {
  const periodos = _periodos_();
  const sols = _solicitacoes_();
  const afast = _afastamentosPorColaborador_();
  const hoje = _hojeFerias_();

  const linhas = periodos
    .map(p => ({ p: p, saldo: _saldoDoPeriodo_(p, sols), lim: _dataF_(p.CONCEDER_ATE) }))
    .filter(x => x.saldo > 0 && x.lim && x.lim < hoje)
    .map(x => ({
      nome: x.p.NOME,
      matricula: (_colaboradorPorId_(x.p.ID_COLABORADOR) || {}).MATRICULA || x.p.MATRICULA,
      gestor: (_colaboradorPorId_(x.p.ID_COLABORADOR) || {}).GESTOR_EMAIL || x.p.GESTOR_EMAIL || '(sem gestor)',
      periodo: _fmtBRF_(x.p.AQUIS_INICIO) + ' a ' + _fmtBRF_(x.p.AQUIS_FIM),
      concederAte: _fmtBRF_(x.lim),
      vencidoHaDias: Math.round((hoje - x.lim) / 86400000),
      saldo: x.saldo,
      afastado: _estaAfastadoAgora_(x.p.ID_COLABORADOR, afast),
      custoEmDobro: Math.round(_calcularCusto_(x.p.ID_COLABORADOR, x.saldo, 0, hoje).total * 2)
    }))
    .sort((a, b) => b.vencidoHaDias - a.vencidoHaDias);

  const ativos = linhas.filter(x => !x.afastado);
  const afastados = linhas.filter(x => x.afastado);

  const out = {
    RESUMO: {
      vencidosTotal: linhas.length,

      // Ação possível AGORA: agendar imediatamente.
      ativos_ACAO_URGENTE: ativos.length,
      ativos_dias: ativos.reduce((t, x) => t + x.saldo, 0),
      ativos_passivoEmDobro: ativos.reduce((t, x) => t + x.custoEmDobro, 0),

      // Sem ação possível: contrato suspenso. Provisão contábil, não operação.
      afastados_PASSIVO_SUSPENSO: afastados.length,
      afastados_dias: afastados.reduce((t, x) => t + x.saldo, 0),
      afastados_passivoEmDobro: afastados.reduce((t, x) => t + x.custoEmDobro, 0)
    },
    ATIVOS_agendar_ja: ativos,
    AFASTADOS_sem_acao: afastados.slice(0, 15)
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Resumo por departamento do que compõe Planejadas (deferidas+pendentes) de UM mês —
 * versão compacta de feriasDetalheMes pra não truncar no log quando tem muita gente.
 * Sem argumento, olha SET/2026.
 */
function feriasResumoDepartamentoMes(mes) {
  mes = mes || '2026-09';

  const solicitacoes = _solicitacoes_();
  const porDepartamento = {};

  solicitacoes.forEach(s => {
    const st = String(s.STATUS || '').toUpperCase();
    if (FERIAS.STATUS_ATIVOS.indexOf(st) === -1) return;
    if (!_colaboradorEstaAtivo_(s.ID_COLABORADOR)) return;

    const inicio = _dataF_(s.DATA_INICIO);
    if (!inicio || _mesRefF_(inicio) !== mes) return;

    const colabLive = _colaboradorPorId_(s.ID_COLABORADOR);
    const dep = (colabLive && colabLive.DEPARTAMENTO_ATUAL) || '(sem departamento)';
    const custo = Number(s.CUSTO_PREVISTO || 0);

    if (!porDepartamento[dep]) {
      porDepartamento[dep] = {
        pessoas: 0, total: 0, deferidas: 0, pendentes: 0,
        contaComoAssistenciaHoje: _ehAssistencia_(dep)
      };
    }

    porDepartamento[dep].pessoas++;
    porDepartamento[dep].total += custo;
    if (st === 'DEFERIDA') porDepartamento[dep].deferidas++; else porDepartamento[dep].pendentes++;
  });

  const lista = Object.keys(porDepartamento)
    .map(dep => ({
      departamento: dep,
      pessoas: porDepartamento[dep].pessoas,
      deferidas: porDepartamento[dep].deferidas,
      pendentes: porDepartamento[dep].pendentes,
      totalPrevisto: Math.round(porDepartamento[dep].total),
      contaComoAssistenciaHoje: porDepartamento[dep].contaComoAssistenciaHoje
    }))
    .sort((a, b) => b.totalPrevisto - a.totalPrevisto);

  const resultado = {
    mes: mes,
    somaTodosDepartamentos: Math.round(lista.reduce((t, d) => t + d.totalPrevisto, 0)),
    porDepartamento: lista
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/** Calendário completo (todos os meses). Só chame quando precisar do detalhe. */
function feriasCalendarioDetalhado() {
  const cal = feriasCalendario({ PERFIL: 'ADMIN' }, {});
  console.log(JSON.stringify(cal, null, 2));
  return cal;
}

/**
 * Detalhe linha-a-linha de UM mês do calendário: toda solicitação e todo período
 * sem agendamento que caem nesse mês, com nome/valor/categoria — pra conferir
 * o total contra uma conta manual. Sem argumento, olha SET/2026 (rode
 * feriasDetalheMes('2026-XX') pelo console pra outro mês).
 */
function feriasDetalheMes(mes) {
  mes = mes || '2026-09';

  const cal = feriasCalendario({ PERFIL: 'ADMIN' }, {});
  const m = cal.meses.find(x => x.mes === mes);
  if (!m) { console.log('Mês fora da janela do calendário: ' + mes); return null; }

  const solicitacoes = _solicitacoes_();
  const periodos = _periodos_();
  const hoje = _hojeFerias_();

  const linhasSolicitacoes = [];
  solicitacoes.forEach(s => {
    const st = String(s.STATUS || '').toUpperCase();
    if (FERIAS.STATUS_ATIVOS.indexOf(st) === -1) return;
    if (!_colaboradorEstaAtivo_(s.ID_COLABORADOR)) return;

    const inicio = _dataF_(s.DATA_INICIO);
    if (!inicio || _mesRefF_(inicio) !== mes) return;

    const colabLive = _colaboradorPorId_(s.ID_COLABORADOR);
    const ehAssist = _ehAssistencia_(colabLive && colabLive.DEPARTAMENTO_ATUAL);

    linhasSolicitacoes.push({
      nome: s.NOME,
      idColaborador: s.ID_COLABORADOR,
      status: st,
      dataInicio: s.DATA_INICIO,
      dataFim: s.DATA_FIM,
      custoPrevisto: Math.round(Number(s.CUSTO_PREVISTO || 0)),
      departamento: (colabLive && colabLive.DEPARTAMENTO_ATUAL) || '',
      categoria: ehAssist ? 'ASSISTENCIA' : (st === 'DEFERIDA' ? 'PLANEJADA (DEFERIDA)' : 'PENDENTE')
    });
  });

  const linhasPeriodos = [];
  periodos.forEach(per => {
    // 05/08/2026: mesma trava da passada 1 — período de gente desligada não vira
    // compulsória/vencida, mesmo que a SITUACAO na MASTER atrase em relação à rescisão real.
    if (!_colaboradorEstaAtivo_(per.ID_COLABORADOR)) return;

    const saldo = _saldoDoPeriodo_(per, solicitacoes);
    if (saldo <= 0) return;

    const limite = _dataF_(per.CONCEDER_ATE);
    if (!limite) return;

    const venceu = limite < hoje;
    const mesRef = venceu ? _mesRefF_(hoje) : _mesRefF_(limite);
    if (mesRef !== mes) return;

    const colabLive = _colaboradorPorId_(per.ID_COLABORADOR);
    const ehAssist = _ehAssistencia_((colabLive && colabLive.DEPARTAMENTO_ATUAL) || per.DEPARTAMENTO);
    const custo = _calcularCusto_(per.ID_COLABORADOR, saldo, 0, venceu ? hoje : limite).total;

    linhasPeriodos.push({
      nome: per.NOME,
      idColaborador: per.ID_COLABORADOR,
      saldoDias: saldo,
      concederAte: per.CONCEDER_ATE,
      venceu: venceu,
      custoPrevisto: Math.round(custo),
      categoria: ehAssist ? 'ASSISTENCIA' : (venceu ? 'VENCIDA (DOBRO)' : 'COMPULSORIA')
    });
  });

  const resultado = {
    mes: mes,
    resumoSistema: {
      planejado: m.planejado, pendente: m.pendente, compulsorio: m.compulsorio,
      vencido: m.vencido, assistencia: m.assistencia, total: m.total
    },
    solicitacoes: linhasSolicitacoes,
    periodosSemAgendamento: linhasPeriodos
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Detecta solicitações ATIVAS (DEFERIDA/PENDENTE) duplicadas — mesmo colaborador
 * aparecendo mais de uma vez pro mesmo período aquisitivo, ou com as mesmas datas
 * de início/fim. Cada duplicata infla o valor de Planejadas (soma CUSTO_PREVISTO
 * duas vezes pro mesmo evento de férias).
 */
function feriasDetectarSolicitacoesDuplicadas() {
  const sols = _solicitacoes_().filter(s =>
    FERIAS.STATUS_ATIVOS.indexOf(String(s.STATUS || '').toUpperCase()) > -1);

  const porPeriodo = {};
  const porDatas = {};

  sols.forEach(s => {
    const chavePeriodo = s.ID_COLABORADOR + '|' + s.ID_PERIODO;
    (porPeriodo[chavePeriodo] = porPeriodo[chavePeriodo] || []).push(s);

    const chaveDatas = s.ID_COLABORADOR + '|' + _isoF_(s.DATA_INICIO) + '|' + _isoF_(s.DATA_FIM);
    (porDatas[chaveDatas] = porDatas[chaveDatas] || []).push(s);
  });

  function grupos(mapa) {
    return Object.keys(mapa)
      .map(k => mapa[k])
      .filter(g => g.length > 1)
      .map(g => ({
        colaborador: g[0].NOME,
        idColaborador: g[0].ID_COLABORADOR,
        quantidade: g.length,
        custoTotalSomado: Math.round(g.reduce((t, s) => t + Number(s.CUSTO_PREVISTO || 0), 0)),
        solicitacoes: g.map(s => ({
          id: s.ID_SOLICITACAO,
          idPeriodo: s.ID_PERIODO,
          status: s.STATUS,
          dataInicio: s.DATA_INICIO,
          dataFim: s.DATA_FIM,
          custoPrevisto: Math.round(Number(s.CUSTO_PREVISTO || 0))
        }))
      }));
  }

  const resultado = {
    totalSolicitacoesAtivas: sols.length,
    duplicadasPorMesmoPeriodo: grupos(porPeriodo),
    duplicadasPorMesmasDatas: grupos(porDatas)
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/* ============================================================================================ */
/*  ROTINA DIÁRIA                                                                                */
/* ============================================================================================ */

function rotinaDiariaFerias() {
  const r = [];
  r.push(fecharPeriodosEmCurso());
  r.push(marcarPeriodosAfastados());
  r.push(gerarPeriodos());

  const msg = r.join(' | ');
  console.log(msg);
  return msg;
}

function criarGatilhoFerias() {
  ScriptApp.newTrigger('rotinaDiariaFerias').timeBased().everyDays(1).atHour(4).create();
  return 'Gatilho diário de férias criado (04h).';
}

/* ============================================================================================ */
/*  LEMBRETES AUTOMÁTICOS                                                                        */
/* ============================================================================================ */

/**
 * Roda todo dia. Manda:
 *   - lembrete ao colaborador X dias antes do início das férias
 *   - alerta ao gestor quando alguém da equipe está perto do prazo e sem agendamento
 *   - alerta ao DP de pedidos parados além do prazo
 */
function rotinaLembretesFerias() {
  _invalidarCacheFerias_();

  const hoje = _hojeFerias_();
  const sols = _solicitacoes_();
  const periodos = _periodos_();

  const diasAntes = Number(_feriasParam_('LEMBRETE_COLABORADOR_DIAS_ANTES', 7));
  const prazoDP = Number(_feriasParam_('PRAZO_RESPOSTA_DP_DIAS', 15));

  let lembretes = 0;

  // 1) colaborador, férias começando
  sols.forEach(s => {
    if (String(s.STATUS).toUpperCase() !== 'DEFERIDA') return;

    const ini = _dataF_(s.DATA_INICIO);
    if (!ini) return;

    const faltam = Math.round((ini - hoje) / 86400000);
    if (faltam !== diasAntes) return;

    const email = _emailDoColaborador_(s.ID_COLABORADOR);
    if (!email) return;

    _mailColaboradorLembrete_(email, s.NOME, ini, _dataF_(s.DATA_FIM));
    lembretes++;
  });

  // 2) DP, pedidos parados
  const paradas = sols.filter(s => {
    if (String(s.STATUS).toUpperCase() !== 'PENDENTE') return false;
    const em = _dataF_(s.SOLICITADO_EM);
    return em && Math.round((hoje - em) / 86400000) > prazoDP;
  });

  if (paradas.length) {
    const linhas = paradas.map(s =>
      '<li>' + _escapeHtml_(s.NOME) + ', solicitação realizada em ' + _fmtBRF_(s.SOLICITADO_EM) + '</li>').join('');

    _enviar_(_emailDoDP_(), 'Pedidos de férias aguardando há mais de ' + prazoDP + ' dias',
      _moldura_('Pedidos parados na fila',
        '<p>O(s) pedido(s) abaixo já ultrapassou(aram) o prazo previsto para resposta:</p>' +
        '<ul>' + linhas + '</ul>' +
        '<p>Vale revisar o(s) pedido(s) e registrar a devolutiva o quanto antes, para que o gestor e o ' +
        'colaborador possam seguir com a programação das férias sem novos atrasos.</p>', '', false));
  }

  // 3) gestores, equipe com prazo apertado e sem agendamento
  const alerta = Number(_feriasParam_('ALERTA_GESTOR_DIAS_ANTES', 60));
  const porGestor = {};

  periodos.forEach(p => {
    if (FERIAS.STATUS_INATIVOS.indexOf(String(p.STATUS || '').toUpperCase()) > -1) return;
    if (!_colaboradorEstaAtivo_(p.ID_COLABORADOR)) return;
    if (_semDireitoAFerias_(_colaboradorPorId_(p.ID_COLABORADOR))) return;

    const saldo = _saldoDoPeriodo_(p, sols);
    if (saldo <= 0) return;

    const lim = _dataF_(p.CONCEDER_ATE);
    if (!lim) return;

    const faltam = Math.round((lim - hoje) / 86400000);
    if (faltam !== alerta) return;   // dispara uma vez só, no dia exato

    const g = _normalizarEmail_((_colaboradorPorId_(p.ID_COLABORADOR) || {}).GESTOR_EMAIL || p.GESTOR_EMAIL);
    if (!g) return;

    if (!porGestor[g]) porGestor[g] = [];
    porGestor[g].push({ nome: p.NOME, saldo: saldo, prazo: _fmtBRF_(lim) });
  });

  const portalGestorUrl = _portalGestorUrl_();

  Object.keys(porGestor).forEach(g => {
    const paragrafos = porGestor[g].map(x =>
      '<p style="margin:0 0 10px">' + _escapeHtml_(x.nome) + ' ainda tem ' + x.saldo + ' dias de férias ' +
      'para agendar até ' + x.prazo + '.</p>' +
      '<p style="margin:0 0 18px">Vale conversar com ' + (x.nome.split(' ')[0]) + ' e já escolher uma data ' +
      'pelo portal. Assim, dá pra organizar tudo com calma e pensar no melhor período pra ' +
      (x.nome.split(' ')[0]) + ' e pro time.</p>'
    ).join('');

    _enviar_(g, 'Férias da sua equipe: hora de agendar',
      _moldura_('Tem férias chegando no limite',
        paragrafos +
        '<p>Quando o prazo termina, o Departamento Pessoal precisa definir as datas, e aí o time perde ' +
        'a chance de escolher o melhor momento. Vale abrir o portal e combinar com cada um.</p>' +
        (portalGestorUrl ? '<p style="margin-top:18px"><a href="' + portalGestorUrl + '" style="color:#0E5A6B;font-weight:700">🔗 Abrir o Portal</a></p>' : '')),
      null, 'ferias@cieds.org.br');
  });

  const msg = 'rotinaLembretesFerias: ' + lembretes + ' lembrete(s) a colaboradores · ' +
    paradas.length + ' pedido(s) parado(s) · ' + Object.keys(porGestor).length + ' gestor(es) avisado(s).';

  console.log(msg);
  return msg;
}

function criarGatilhoLembretes() {
  ScriptApp.newTrigger('rotinaLembretesFerias').timeBased().everyDays(1).atHour(8).create();
  return 'Gatilho diário de lembretes criado (08h).';
}

/* ============================================================================================ */
/*  AQUECIMENTO DO CACHE                                                                         */
/* ============================================================================================ */

/**
 * Monta o contexto de todos os gestores e deixa no cache.
 * Assim o primeiro gestor que entra de manhã não paga o custo de ler as planilhas.
 * Gatilho sugerido: a cada 30 minutos.
 */
function aquecerCacheFerias() {
  const usuarios = _sheetToObjects_(_configSS_().getSheetByName(DP360.SHEETS.USUARIOS))
    .filter(u => _sim_(u.ATIVO) && _sim_(u.PODE_LOGAR));

  // [PERF 2026-09-24] Deixa pronto também o painel do Portal do DP, que é o mesmo para toda a
  // equipe do DP. Vem antes do laço dos gestores para não ficar de fora se o laço demorar.
  const alguemDoDP = usuarios.find(u => ['DP', 'ADMIN'].indexOf(String(u.PERFIL || '').toUpperCase()) > -1);
  if (alguemDoDP) {
    try { feriasPainelDP(alguemDoDP, {}); } catch (e) { console.error('aquecerCacheFerias: painel do DP falhou: ' + e); }
  }

  let ok = 0;

  usuarios.forEach(u => {
    try {
      feriasContexto(u, { visao: 'GESTOR' });
      try { feriasElegiveisFimDeAno(u, {}); } catch (e2) { /* não pode derrubar o aquecimento */ }
      ok++;
    } catch (e) { /* segue para o próximo */ }
  });

  const msg = 'aquecerCacheFerias: contexto pronto para ' + ok + ' de ' + usuarios.length + ' usuário(s).';
  console.log(msg);
  return msg;
}

function criarGatilhoAquecimento() {
  ScriptApp.newTrigger('aquecerCacheFerias').timeBased().everyMinutes(30).create();
  return 'Gatilho de aquecimento criado (a cada 30 min).';
}

/** Diagnostica por que o guia não aparece no portal. Rode sem argumentos. */
function diagnosticarGuia() {
  const url = _feriasParam_('GUIA_FERIAS_URL', '');
  const sh = _shFerias_(FERIAS.ABAS.PARAMETROS);
  const chaves = _sheetToObjects_(sh).map(r => r.CHAVE);

  const out = {
    valorLido: url || '(vazio)',
    apareceNoPortal: !!url,
    chavesNaAbaParametros: chaves,
    temAChaveCerta: chaves.indexOf('GUIA_FERIAS_URL') > -1
  };

  console.log(JSON.stringify(out, null, 2));

  if (!out.temAChaveCerta) {
    console.log('\n>> A chave GUIA_FERIAS_URL não existe na aba PARAMETROS. Confira o nome exato.');
  } else if (!url) {
    console.log('\n>> A chave existe mas o VALOR está vazio. Cole a URL na coluna VALOR.');
  } else {
    console.log('\n>> Tudo certo na planilha. Se não aparece, reimplante a API (nova versão).');
  }

  return out;
}

/**
 * Mede quanto tempo cada parte leva. Rode sem argumentos e me mande a saída.
 * É isto que diz se a lentidão é rede, cálculo, ou cache que não pega.
 */
function cronometrarFerias() {
  const marcos = [];
  let t = new Date().getTime();
  function marca(nome) {
    const agora = new Date().getTime();
    marcos.push(nome + ': ' + (agora - t) + 'ms');
    t = agora;
  }

  // simula o usuário logado (primeiro ativo que pode logar)
  const user = _sheetToObjects_(_configSS_().getSheetByName(DP360.SHEETS.USUARIOS))
    .find(u => _sim_(u.ATIVO) && _sim_(u.PODE_LOGAR));
  marca('ler usuário');

  if (!user) return 'Nenhum usuário ativo encontrado.';

  _novoSeloFerias_();   // garante cache frio, como no primeiro acesso
  _invalidarCacheFerias_();
  marca('limpar cache');

  const c1 = feriasContexto(user, { visao: 'GESTOR' });
  marca('1º contexto (cache FRIO, lê planilhas)');

  const c2 = feriasContexto(user, { visao: 'GESTOR' });
  marca('2º contexto (cache QUENTE, deveria ser ~0)');

  const out = {
    usuario: user.EMAIL,
    perfil: user.PERFIL,
    colaboradores: c1.colaboradores ? c1.colaboradores.length : 0,
    totalPeriodosNaPlanilha: _periodos_().length,
    etapas: marcos
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/** Mostra os gestores com equipe grande demais, sinal de erro na coluna GESTOR_EMAIL. */
/** Garante a permissão da ação nova (DP definir teto do mês). Rode uma vez. */
function semearPermissaoDefinirTeto() {
  const sh = _configSS_().getSheetByName(DP360.SHEETS.PERMISSOES);
  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh).map(r => String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  const chave = 'DP|FERIAS.DEFINIR_TETO';
  if (existentes.indexOf(chave) > -1) return 'Permissão já existia.';

  const obj = { PERFIL: 'DP', ACAO: 'FERIAS.DEFINIR_TETO', PERMITIDO: 'Sim', ESCOPO: 'GLOBAL', DESCRICAO: 'Editar o teto mensal do calendário de férias.' };
  sh.appendRow(h.map(col => (obj[col] === undefined ? '' : obj[col])));

  if (typeof _limparCachePermissoes_ === 'function') _limparCachePermissoes_();
  return 'Permissão FERIAS.DEFINIR_TETO adicionada para o perfil DP.';
}

/**
 * Correção única: períodos cujo status é ABERTO (ou vazio) mas o fim do aquisitivo ainda
 * não chegou deveriam ser EM_CURSO. Isso acontece com registros importados na planilha
 * inicial (não gerados pelo gerarPeriodos()), que nunca passaram por essa classificação.
 * Nunca mexe em período já PERDIDO/CONGELADO/QUITADO.
 */
function corrigirStatusPeriodosEmCurso() {
  const sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  const h = _headers_(sh);
  const hoje = _hojeFerias_();

  const idxStatus = h.indexOf('STATUS');
  const idxFim = h.indexOf('AQUIS_FIM');
  if (idxStatus === -1 || idxFim === -1) throw new Error('Colunas STATUS/AQUIS_FIM não encontradas.');

  const ultimaLinha = sh.getLastRow();
  const dados = sh.getRange(2, 1, ultimaLinha - 1, h.length).getValues();

  let corrigidos = 0;
  const exemplos = [];

  dados.forEach((linha, i) => {
    const statusAtual = String(linha[idxStatus] || '').toUpperCase().trim();
    if (statusAtual !== 'ABERTO' && statusAtual !== '') return;

    const fim = _dataF_(linha[idxFim]);
    if (!fim || fim <= hoje) return;

    sh.getRange(i + 2, idxStatus + 1).setValue('EM_CURSO');
    corrigidos++;
    if (exemplos.length < 10) exemplos.push({ linha: i + 2, fimAquisitivo: _fmtBRF_(fim) });
  });

  _invalidarCacheFerias_();

  const msg = 'corrigirStatusPeriodosEmCurso: ' + corrigidos + ' período(s) corrigido(s) de ABERTO para EM_CURSO.';
  _auditar_('FERIAS_STATUS_EM_CURSO_CORRIGIDO', '', 'corrigirStatusPeriodosEmCurso', true, msg, { corrigidos: corrigidos });
  console.log(msg);
  console.log(JSON.stringify(exemplos, null, 2));
  return { mensagem: msg, exemplos: exemplos };
}

function diagnosticarEscopo() {
  const col = _colaboradores_();
  const porGestor = {};

  col.forEach(c => {
    const g = _normalizarEmail_(c.GESTOR_EMAIL) || '(vazio)';
    porGestor[g] = (porGestor[g] || 0) + 1;
  });

  const lista = Object.keys(porGestor)
    .map(g => ({ gestor: g, equipe: porGestor[g] }))
    .sort((a, b) => b.equipe - a.equipe);

  const out = {
    totalGestores: lista.length,
    suspeitos_equipeGrande: lista.filter(x => x.equipe > 50),
    top15: lista.slice(0, 15)
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Diagnóstico do item 6: confirma que a leitura de afastamentos agora vem da aba certa
 * (OCORRENCIAS) e testa com um colaborador específico (procure pelo nome ou passe o ID_COLABORADOR).
 */
function diagnosticarAfastamentosNaFerias(nomeOuIdColaborador) {
  const sh = _ssAfastamentos_().getSheetByName('OCORRENCIAS');
  const shAntiga = _ssAfastamentos_().getSheetByName('AFASTAMENTOS');

  const out = {
    abaOcorrenciasExiste: !!sh,
    abaAntigaAfastamentosAindaExiste: !!shAntiga,
    totalOcorrencias: sh ? _sheetToObjects_(sh).length : 0
  };

  if (nomeOuIdColaborador) {
    const c = _colaboradores_().find(x =>
      String(x.ID_COLABORADOR) === String(nomeOuIdColaborador) ||
      String(x.NOME || '').toUpperCase().indexOf(String(nomeOuIdColaborador).toUpperCase()) > -1
    );

    if (!c) {
      out.colaboradorEncontrado = false;
    } else {
      _CACHE_AFAST_ = null; // força reler
      const mapa = _afastamentosPorColaborador_();
      out.colaboradorEncontrado = true;
      out.nome = c.NOME;
      out.idColaborador = c.ID_COLABORADOR;
      out.afastamentos = mapa[String(c.ID_COLABORADOR)] || { reinicia: [], congela: [], emAberto: false };

      const periodos = _periodos_().filter(p => String(p.ID_COLABORADOR) === String(c.ID_COLABORADOR))
        .map(p => ({ id: p.ID_PERIODO, inicio: _fmtBRF_(p.AQUIS_INICIO), fim: _fmtBRF_(p.AQUIS_FIM), status: p.STATUS }));
      out.periodosAtuais = periodos;
    }
  }

  console.log(JSON.stringify(out, null, 2));
  return out;
}
/**
 * [28/09/2026] A importação Jul-Dez e as correções que só valiam para ela foram removidas do
 * código (estão no histórico do git, commit anterior a esta limpeza). Esta aqui continua útil.
 *
 * 31/07/2026: corrigirCustoDosJaImportados() só olha quem tem a marca "Importado da planilha
 * de programação de férias" no MOTIVO — por isso nunca corrigiu as 94 solicitações de uma
 * migração mais antiga e diferente (SOLICITADO_POR = 'MIGRACAO'), que também ficaram sem
 * CUSTO_PREVISTO. Esta aqui pega QUALQUER solicitação ativa (PENDENTE/DEFERIDA) sem custo,
 * independente de quem/quando importou. Mesmo parâmetro de sempre: salário vigente na
 * DATA_INICIO da solicitação (_calcularCusto_ → _folhaFerias_ → _salarioVigente_).
 */
function corrigirCustoPrevistoFaltante() {
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const sols = _sheetToObjects_(sh);

  const colIdxCusto = h.indexOf('CUSTO_PREVISTO');
  const colIdxSnapshot = h.indexOf('CUSTO_SNAPSHOT_JSON');
  if (colIdxCusto === -1) throw new Error('Coluna CUSTO_PREVISTO não encontrada.');

  const alvo = sols.filter(s =>
    ['PENDENTE', 'DEFERIDA'].indexOf(String(s.STATUS || '').toUpperCase()) > -1 &&
    !Number(String(s.CUSTO_PREVISTO || '0').replace(',', '.')));

  const corrigidos = [];
  const falhas = [];

  alvo.forEach(s => {
    let custo;
    try {
      custo = _calcularCusto_(s.ID_COLABORADOR, Number(s.DIAS || 0), Number(s.ABONO || 0), _dataF_(s.DATA_INICIO) || _hojeFerias_());
    } catch (e) {
      falhas.push(s.NOME + ' (' + s.ID_SOLICITACAO + '): ' + e.message);
      return;
    }

    sh.getRange(s._rowNumber, colIdxCusto + 1).setValue(custo.total || 0);
    if (colIdxSnapshot > -1) sh.getRange(s._rowNumber, colIdxSnapshot + 1).setValue(JSON.stringify(custo));

    corrigidos.push(s.NOME + ' (' + s.ID_SOLICITACAO + '): R$ ' + Number(custo.total || 0).toFixed(2));
  });

  _invalidarCacheFerias_();

  const resultado = {
    totalEncontrados: alvo.length,
    totalCorrigidos: corrigidos.length,
    totalFalhas: falhas.length,
    detalhe: corrigidos,
    falhas: falhas
  };
  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function _testeElegiveisFimDeAno() {
  const user = { EMAIL: 'marianazenicola.rj@cieds.org.br', PERFIL: 'GESTOR' };
  const r = feriasElegiveisFimDeAno(user, {});
  console.log(JSON.stringify(r, null, 2));
}