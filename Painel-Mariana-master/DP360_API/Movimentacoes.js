/*************************************************************************************************
 * MÓDULO MOVIMENTAÇÕES · DP360, arquivo MOVIMENTACOES.gs
 * -----------------------------------------------------------------------------------------------
 * Cole como NOVO arquivo no projeto DP360_API (ao lado de Codigo.gs, FERIAS.gs, AFASTAMENTOS.gs,
 * RESCISAO.gs, PROCESSOTRAB.gs).
 *
 * O QUE É: o gestor solicita mudanças no contrato de alguém da equipe, transferência de
 * departamento, alteração de turno, de carga horária, de salário, de cargo, ou pagamento de um
 * adicional (gratificação, ajuda de transporte etc., campo livre).
 *
 * FLUXO (duas aprovações, em sequência):
 *   1) Gestor solicita (Portal do Gestor) → informa a COMPETÊNCIA DE INÍCIO da mudança.
 *   2) E-mail vai para o RH com 3 links assinados: Aprovar / Reprovar / Aprovar com alterações.
 *      O RH NÃO tem login em nada, decide clicando o link, que abre o mini-app independente
 *      MOVIMENTACAO_DECISAO_WEB (projeto separado, sem autenticação, token assinado por caso).
 *        • Reprovado pelo RH → FIM. E-mail pro gestor com o motivo (obrigatório).
 *        • Aprovado (puro ou com alterações) → segue para a fila do DP. NENHUM e-mail de
 *          "aprovado" vai pro gestor ainda, só quando o DP decidir de vez.
 *   3) DP decide no Portal do DP (lançamento na folha):
 *        • Aprova → e-mail pro gestor: aprovado + em qual folha/competência vai refletir
 *          (e, se o RH tiver feito ajustes, o gestor vê o que mudou).
 *        • Reprova → e-mail pro gestor com o motivo trabalhista (obrigatório).
 *
 * TRAVAS E ALERTAS:
 *   • ALTERACAO_SALARIO → compara o valor pedido com o que já é praticado no MESMO departamento
 *     para o MESMO cargo (melhor esforço, ver _movSalarioPraticado_). Se divergir, BLOQUEIA a
 *     solicitação a menos que o gestor confirme explicitamente a divergência com justificativa.
 *   • ALTERACAO_CARGO → se não existir mais ninguém com esse cargo no departamento, avisa
 *     (ALERTA, nunca bloqueia, só para conferir que não foi engano).
 *   • ALTERACAO_TURNO → se o novo turno for NOTURNO, gera automaticamente uma movimentação
 *     COMPANION de ADICIONAL_PAGAMENTO ("Adicional noturno", incluir). Se for DIURNO, gera a
 *     companion de retirada do adicional noturno. As duas seguem o mesmo fluxo RH → DP.
 *
 * ⚠️ SOBRE O CAMPO DE SALÁRIO/CARGO NA BASE: eu não tenho certeza absoluta de qual coluna da sua
 * base de colaboradores guarda o salário e o cargo atual (nunca vi essa coluna confirmada). O
 * código tenta vários nomes comuns (ver _movSalarioPraticado_ e _movCargoDoColaborador_); se
 * nenhum bater, ele NÃO bloqueia, marca como "não verificado" para o RH/DP conferir manualmente.
 * Rode diagnosticarCamposColaborador() e me diga os nomes reais das colunas para eu travar certo.
 *
 * PARA PLUGAR NO KERNEL:
 *   1) Codigo.gs → registrar o módulo em _modulosDisponiveis_() (bloco pronto no fim deste arquivo)
 *   2) FERIAS.gs → adicionar o roteamento de MOVIMENTACAO.* no executar() (bloco pronto no fim)
 *   3) rode UMA vez: movSetup()
 *   4) configurarSegredoDecisaoMovimentacao("UMA-STRING-ALEATORIA-BEM-LONGA")
 *      → copie o MESMO valor para o Script Properties do projeto MOVIMENTACAO_DECISAO_WEB
 *   5) publique o MOVIMENTACAO_DECISAO_WEB (arquivo separado que te entrego a seguir) e cole a
 *      URL /exec em MOV.DECISAO_WEB_URL, no topo deste arquivo.
 *   6) adicione MOVIMENTACAO na coluna MODULOS dos usuários do DP.
 *************************************************************************************************/

const MOV = {
  VERSAO: '1.0.0',

  // Mesma planilha "CONTROLE DE PAGAMENTO 2026" usada pela Rescisão (constante própria, sem
  // depender do RESCISAO.gs estar carregado, módulos independentes).
  CONTROLE_ID: '1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc',
  ABA: 'MOVIMENTACOES_CASOS',

  // URL do mini-app MOVIMENTACAO_DECISAO_WEB (preencha depois de publicá-lo).
  DECISAO_WEB_URL: 'https://script.google.com/macros/s/AKfycbwJ7QNsMwYxkh64zj8KplJT1ug_FbqWuuorkSkjb2xzqNBXeBjmCmuQRk7FYhjuyDOe/exec',

  // URL do mini-app "Guia da Movimentação" (mesmo padrão do RESC.GUIA_URL: constante fixa no
  // código, não lida da aba PARAMETROS).
  GUIA_URL: 'https://script.google.com/macros/s/AKfycbyRbk3elff6G11Y7K6ao_MGcJnvtp2p8nINzz5OalpIEDo90qNcIHeLZtE04eSEjwd7/exec',

  // Segredo usado para assinar os links de decisão do RH. Configure com
  // configurarSegredoDecisaoMovimentacao() e copie o MESMO valor no outro projeto.
  SEGREDO_PARAM: 'MOV_DECISAO_SEGREDO',
  TOKEN_DIAS_VALIDADE: 10,

  // E-mail do RH (diferente do e-mail do DP!), é pra quem vai o link de decisão.
  EMAIL_RH_PARAM: 'MOV_EMAIL_RH',

  COLUNAS: [
    'ID_MOVIMENTACAO', 'ID_COLABORADOR', 'MATRICULA', 'NOME', 'DEPARTAMENTO_ATUAL', 'CARGO_ATUAL',
    'GESTOR_EMAIL',
    'TIPO_COD', 'TIPO', 'COMPETENCIA_INICIO',
    'DEPARTAMENTO_NOVO', 'TURNO_NOVO', 'CARGA_HORARIA_NOVA', 'CARGO_NOVO', 'SALARIO_NOVO',
    'DESCRICAO_ADICIONAL', 'VALOR_ADICIONAL', 'ACAO_ADICIONAL',
    'JUSTIFICATIVA', 'MOVIMENTACAO_GERADA_DE',
    'SALARIO_PRATICADO_REF', 'SALARIO_DIVERGENTE', 'SALARIO_VERIFICACAO',
    'OVERRIDE_SALARIO', 'OVERRIDE_JUSTIFICATIVA',
    'ALERTA_CARGO_INEDITO',
    'STATUS',
    'RH_DECISAO', 'RH_DECIDIDO_EM', 'RH_MOTIVO', 'RH_AJUSTES_JSON', 'RH_OBSERVACAO',
    'DP_DECISAO', 'DP_DECIDIDO_POR', 'DP_DECIDIDO_EM', 'DP_MOTIVO', 'DP_FOLHA_COMPETENCIA',
    'SOLICITADO_POR', 'SOLICITADO_EM', 'ATUALIZADO_POR', 'ATUALIZADO_EM', 'HISTORICO_JSON'
  ],

  STATUS: {
    SOLICITADA: 'SOLICITADA',
    RH_REPROVADA: 'RH_REPROVADA',
    AGUARDANDO_DP: 'AGUARDANDO_DP',
    DP_APROVADA: 'DP_APROVADA',
    DP_REPROVADA: 'DP_REPROVADA',
    CANCELADA: 'CANCELADA'
  },

  TIPOS: [
    { cod: 'TRANSFERENCIA_DEPARTAMENTO', nome: 'Transferência de departamento' },
    { cod: 'ALTERACAO_TURNO', nome: 'Alteração de turno' },
    { cod: 'ALTERACAO_CARGA_HORARIA', nome: 'Alteração de carga horária' },
    { cod: 'ALTERACAO_SALARIO', nome: 'Alteração de salário' },
    { cod: 'ALTERACAO_CARGO', nome: 'Alteração de cargo' },
    { cod: 'ADICIONAL_PAGAMENTO', nome: 'Pagamento de adicional (gratificação, ajuda de transporte etc.)' },
    { cod: 'OUTRO', nome: 'Outro' }
  ]
};

/* ============================================================================================ */
/*  ROTEADOR                                                                                     */
/* ============================================================================================ */

function movExecutar(acao, p, user) {
  switch (acao) {
    case 'MOVIMENTACAO.TIPOS':     return { ok: true, tipos: MOV.TIPOS };
    case 'MOVIMENTACAO.CONTEXTO':  return movContexto(user, p);
    case 'MOVIMENTACAO.RESUMO':    return movResumo(user, p);
    case 'MOVIMENTACAO.SOLICITAR': return movSolicitar(user, p);
    case 'MOVIMENTACAO.CANCELAR':  return movCancelar(user, p);

    // DP
    case 'MOVIMENTACAO.FILA':        return movFila(user, p);
    case 'MOVIMENTACAO.DECIDIR_DP':  return movDecidirDP(user, p);

    default:
      throw new Error('Ação de movimentação desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  INFRA                                                                                        */
/* ============================================================================================ */

var _SS_MOV_ = null;
function _ssMov_() {
  if (!_SS_MOV_) _SS_MOV_ = SpreadsheetApp.openById(MOV.CONTROLE_ID);
  return _SS_MOV_;
}

function _shMov_() {
  const sh = _ssMov_().getSheetByName(MOV.ABA);
  if (!sh) throw new Error('Aba não encontrada: ' + MOV.ABA + '. Rode movSetup() uma vez.');
  return sh;
}

function garantirAbaMovimentacoes() {
  const ss = _ssMov_();
  let sh = ss.getSheetByName(MOV.ABA);

  if (!sh) {
    sh = ss.insertSheet(MOV.ABA);
    sh.getRange(1, 1, 1, MOV.COLUNAS.length).setValues([MOV.COLUNAS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, MOV.COLUNAS.length).setFontWeight('bold');
    return 'Aba MOVIMENTACOES_CASOS criada.';
  }

  const h = _headers_(sh);
  const faltando = MOV.COLUNAS.filter(c => h.indexOf(c) === -1);
  if (faltando.length) {
    let col = sh.getLastColumn();
    faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));
    return 'Colunas acrescentadas: ' + faltando.join(', ');
  }
  return 'Aba MOVIMENTACOES_CASOS já está pronta.';
}

function _movPorId_(id) {
  return _sheetToObjects_(_shMov_()).find(x => String(x.ID_MOVIMENTACAO) === String(id)) || null;
}

function _movTipo_(cod) {
  return MOV.TIPOS.find(t => t.cod === String(cod || '').toUpperCase().trim()) || null;
}

/* ============================================================================================ */
/*  ESCOPO, o gestor só vê e solicita para a própria equipe                                     */
/* ============================================================================================ */

function _movColaborador_(user, idColaborador, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && v === 'GLOBAL';

  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(idColaborador));
  if (!c) throw new Error('Colaborador não encontrado.');

  if (!ehGlobal) {
    const equipe = _equipeDoGestor_(user.EMAIL);
    if (equipe.indexOf(String(idColaborador)) === -1) {
      throw new Error('Este colaborador não está na sua equipe.');
    }
  }
  return c;
}

function _movCasosVisiveis_(user, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && v === 'GLOBAL';

  const todos = _sheetToObjects_(_shMov_());
  if (ehGlobal) return todos;

  const equipe = _equipeDoGestor_(user.EMAIL);
  return todos.filter(c => equipe.indexOf(String(c.ID_COLABORADOR)) > -1);
}

/* ============================================================================================ */
/*  MELHOR ESFORÇO: salário praticado e cargo do colaborador (nomes de coluna incertos)          */
/* ============================================================================================ */

// Ajuste esta lista se diagnosticarCamposColaborador() mostrar outro nome de coluna.
const MOV_COLUNAS_CARGO_CANDIDATAS = ['CARGO', 'FUNCAO', 'FUNÇÃO', 'CARGO_ATUAL'];
const MOV_COLUNAS_SALARIO_CANDIDATAS = ['SALARIO', 'SALÁRIO', 'SALARIO_BASE', 'SALARIO_ATUAL', 'VALOR_SALARIO'];

function _movValorPorCandidatos_(obj, candidatos) {
  for (let i = 0; i < candidatos.length; i++) {
    if (obj[candidatos[i]] !== undefined && obj[candidatos[i]] !== '') return obj[candidatos[i]];
  }
  return '';
}

function _movCargoDoColaborador_(c) {
  return String(_movValorPorCandidatos_(c, MOV_COLUNAS_CARGO_CANDIDATAS) || '').trim();
}

function _movNumero_(v) {
  const s = String(v || '').replace(/[^\d,.-]/g, '');
  const n = Number(s.indexOf(',') > -1 ? s.replace(/\./g, '').replace(',', '.') : s);
  return isNaN(n) ? null : n;
}

/**
 * Melhor esforço: procura o salário já praticado no MESMO departamento para o MESMO cargo,
 * olhando os colegas atualmente na base. Se não achar nenhuma coluna de salário reconhecida,
 * devolve verificado:false (nunca bloqueia por falta de dado, só avisa que não deu pra conferir).
 */
function _movSalarioPraticado_(departamento, cargo) {
  const pessoas = _colaboradores_().filter(c =>
    String(c.DEPARTAMENTO_ATUAL || '').toUpperCase().trim() === String(departamento || '').toUpperCase().trim() &&
    _movCargoDoColaborador_(c).toUpperCase() === String(cargo || '').toUpperCase().trim()
  );

  const valores = pessoas
    .map(c => _movNumero_(_movValorPorCandidatos_(c, MOV_COLUNAS_SALARIO_CANDIDATAS)))
    .filter(v => v !== null && v > 0);

  if (!valores.length) return { verificado: false, valor: null, amostra: 0 };

  // usa o valor mais frequente (moda), mais robusto que média se houver 1 exceção isolada
  const contagem = {};
  valores.forEach(v => { contagem[v] = (contagem[v] || 0) + 1; });
  const maisFrequente = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a])[0];

  return { verificado: true, valor: Number(maisFrequente), amostra: valores.length };
}

function _movCargoExisteNoDepartamento_(departamento, cargo, idColaboradorExcluir) {
  return _colaboradores_().some(c =>
    String(c.ID_COLABORADOR) !== String(idColaboradorExcluir) &&
    String(c.DEPARTAMENTO_ATUAL || '').toUpperCase().trim() === String(departamento || '').toUpperCase().trim() &&
    _movCargoDoColaborador_(c).toUpperCase() === String(cargo || '').toUpperCase().trim()
  );
}

/** Diagnóstico: mostra os campos reais de UM colaborador para conferir os nomes das colunas. */
function diagnosticarCamposColaborador() {
  const c = _colaboradores_()[0];
  if (!c) { console.log('Base de colaboradores vazia.'); return; }
  console.log(JSON.stringify(Object.keys(c), null, 2));
  return Object.keys(c);
}

/* ============================================================================================ */
/*  CONTEXTO / RESUMO (gestor)                                                                   */
/* ============================================================================================ */

function movContexto(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const visao = String((p && p.visao) || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && visao === 'GLOBAL';
  const equipe = ehGlobal ? null : _equipeDoGestor_(user.EMAIL);

  const time = _colaboradores_()
    .filter(c => ehGlobal || equipe.indexOf(String(c.ID_COLABORADOR)) > -1)
    .map(c => ({
      idColaborador: c.ID_COLABORADOR,
      nome: c.NOME,
      matricula: c.MATRICULA,
      departamento: c.DEPARTAMENTO_ATUAL || '',
      cargo: _movCargoDoColaborador_(c)
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  const casos = _movCasosVisiveis_(user, visao).map(_movResumo_)
    .sort((a, b) => String(b.solicitadoEm).localeCompare(String(a.solicitadoEm)));

  return {
    ok: true,
    modulo: 'MOVIMENTACAO',
    versao: MOV.VERSAO,
    guiaUrl: MOV.GUIA_URL || '',
    equipe: time,
    casos: casos,
    tipos: MOV.TIPOS
  };
}

function _movResumo_(c) {
  let ajustes = [];
  try { ajustes = JSON.parse(c.RH_AJUSTES_JSON || '[]'); } catch (e) { ajustes = []; }

  return {
    id: c.ID_MOVIMENTACAO,
    idColaborador: c.ID_COLABORADOR,
    nome: c.NOME,
    departamento: c.DEPARTAMENTO_ATUAL,
    cargo: c.CARGO_ATUAL,
    tipoCod: c.TIPO_COD,
    tipo: c.TIPO,
    competenciaInicio: c.COMPETENCIA_INICIO,
    detalhe: {
      departamentoNovo: c.DEPARTAMENTO_NOVO || '',
      turnoNovo: c.TURNO_NOVO || '',
      cargaHorariaNova: c.CARGA_HORARIA_NOVA || '',
      cargoNovo: c.CARGO_NOVO || '',
      salarioNovo: c.SALARIO_NOVO || '',
      descricaoAdicional: c.DESCRICAO_ADICIONAL || '',
      valorAdicional: c.VALOR_ADICIONAL || '',
      acaoAdicional: c.ACAO_ADICIONAL || ''
    },
    justificativa: c.JUSTIFICATIVA || '',
    geradaDe: c.MOVIMENTACAO_GERADA_DE || '',
    alertaCargoInedito: _sim_(c.ALERTA_CARGO_INEDITO),
    salarioDivergente: _sim_(c.SALARIO_DIVERGENTE),
    salarioVerificacao: c.SALARIO_VERIFICACAO || '',
    status: c.STATUS,
    rhDecisao: c.RH_DECISAO || '',
    rhMotivo: c.RH_MOTIVO || '',
    rhAjustes: ajustes,
    dpDecisao: c.DP_DECISAO || '',
    dpMotivo: c.DP_MOTIVO || '',
    dpFolhaCompetencia: c.DP_FOLHA_COMPETENCIA || '',
    solicitadoPor: c.SOLICITADO_POR,
    solicitadoEm: _isoF_(c.SOLICITADO_EM),
    gestorEmail: c.GESTOR_EMAIL
  };
}

function movResumo(user, p) { return movResumoDe(movContexto(user, p)); }

function movResumoDe(ctx) {
  const abertos = ctx.casos.filter(c =>
    [MOV.STATUS.CANCELADA, MOV.STATUS.RH_REPROVADA, MOV.STATUS.DP_APROVADA, MOV.STATUS.DP_REPROVADA].indexOf(c.status) === -1);

  return {
    modulo: 'MOVIMENTACAO',
    nome: 'Movimentações',
    icone: '🔀',
    contadores: {
      equipe: ctx.equipe.length,
      emAndamento: abertos.length,
      concluidas: ctx.casos.filter(c => c.status === MOV.STATUS.DP_APROVADA).length
    },
    emAndamento: abertos.slice(0, 8).map(c => ({ nome: c.nome, tipo: c.tipo, status: c.status }))
  };
}

/* ============================================================================================ */
/*  SOLICITAR                                                                                    */
/* ============================================================================================ */

/**
 * payload comum: idColaborador, tipoCod, competenciaInicio ('MM/AAAA'), justificativa
 * campos por tipo:
 *   TRANSFERENCIA_DEPARTAMENTO → departamentoNovo
 *   ALTERACAO_TURNO            → turnoNovo ('DIURNO'|'NOTURNO')
 *   ALTERACAO_CARGA_HORARIA    → cargaHorariaNova
 *   ALTERACAO_CARGO            → cargoNovo
 *   ALTERACAO_SALARIO          → salarioNovo, confirmarDivergenciaSalarial?, justificativaDivergencia?
 *   ADICIONAL_PAGAMENTO/OUTRO  → descricaoAdicional, valorAdicional?
 */
function movSolicitar(user, p) {
  const c = _movColaborador_(user, p.idColaborador, p.visao);
  const tipo = _movTipo_(p.tipoCod);
  if (!tipo) throw new Error('Tipo de movimentação inválido.');

  const competencia = String(p.competenciaInicio || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) {
    throw new Error('Informe a competência de início no formato MM/AAAA (ex.: 08/2026).');
  }

  if (!String(p.justificativa || '').trim()) throw new Error('Informe a justificativa da solicitação.');

  const departamentoAtual = c.DEPARTAMENTO_ATUAL || '';
  const cargoAtual = _movCargoDoColaborador_(c);

  const dados = {
    departamentoNovo: '', turnoNovo: '', cargaHorariaNova: '', cargoNovo: '', salarioNovo: '',
    descricaoAdicional: '', valorAdicional: '', acaoAdicional: '',
    salarioPraticadoRef: '', salarioDivergente: false, salarioVerificacao: '',
    overrideSalario: false, overrideJustificativa: '',
    alertaCargoInedito: false
  };

  switch (tipo.cod) {
    case 'TRANSFERENCIA_DEPARTAMENTO':
      dados.departamentoNovo = String(p.departamentoNovo || '').trim();
      if (!dados.departamentoNovo) throw new Error('Informe o departamento de destino.');
      break;

    case 'ALTERACAO_TURNO':
      dados.turnoNovo = String(p.turnoNovo || '').toUpperCase().trim();
      if (['DIURNO', 'NOTURNO'].indexOf(dados.turnoNovo) === -1) throw new Error('Informe o turno novo: DIURNO ou NOTURNO.');
      break;

    case 'ALTERACAO_CARGA_HORARIA':
      dados.cargaHorariaNova = String(p.cargaHorariaNova || '').trim();
      if (!dados.cargaHorariaNova) throw new Error('Informe a nova carga horária.');
      break;

    case 'ALTERACAO_CARGO':
      dados.cargoNovo = String(p.cargoNovo || '').trim();
      if (!dados.cargoNovo) throw new Error('Informe o cargo novo.');
      dados.alertaCargoInedito = !_movCargoExisteNoDepartamento_(departamentoAtual, dados.cargoNovo, c.ID_COLABORADOR);
      break;

    case 'ALTERACAO_SALARIO': {
      const novo = _movNumero_(p.salarioNovo);
      if (novo === null || novo <= 0) throw new Error('Informe o novo salário (maior que zero).');
      dados.salarioNovo = novo;

      const ref = _movSalarioPraticado_(departamentoAtual, cargoAtual);
      if (!ref.verificado) {
        dados.salarioVerificacao = 'NAO_VERIFICADO';
      } else {
        dados.salarioPraticadoRef = ref.valor;
        const divergiu = Math.abs(ref.valor - novo) > 0.01;
        dados.salarioDivergente = divergiu;

        if (divergiu) {
          const confirmou = _sim_(p.confirmarDivergenciaSalarial) || p.confirmarDivergenciaSalarial === true;
          if (!confirmou) {
            throw new Error('O valor informado (R$' + novo.toFixed(2) + ') diverge do praticado para ' +
              cargoAtual + ' em ' + departamentoAtual + ' (R$' + ref.valor.toFixed(2) + '). ' +
              'Se for intencional, confirme a divergência explicitamente com uma justificativa.');
          }
          if (!String(p.justificativaDivergencia || '').trim()) {
            throw new Error('Confirmando a divergência salarial, informe a justificativa.');
          }
          dados.overrideSalario = true;
          dados.overrideJustificativa = String(p.justificativaDivergencia).trim();
        }
      }
      break;
    }

    case 'ADICIONAL_PAGAMENTO':
    case 'OUTRO':
      dados.descricaoAdicional = String(p.descricaoAdicional || '').trim();
      if (!dados.descricaoAdicional) throw new Error('Descreva o que está sendo solicitado.');
      dados.valorAdicional = p.valorAdicional ? _movNumero_(p.valorAdicional) : '';
      break;
  }

  const idPrincipal = _movCriarCaso_(user, c, tipo, competencia, dados, String(p.justificativa).trim(), '');

  const idsGerados = [idPrincipal];

  // companion automática de adicional noturno
  if (tipo.cod === 'ALTERACAO_TURNO') {
    const tipoAdicional = _movTipo_('ADICIONAL_PAGAMENTO');
    const incluir = (dados.turnoNovo === 'NOTURNO');
    const dadosCompanion = {
      departamentoNovo: '', turnoNovo: '', cargaHorariaNova: '', cargoNovo: '', salarioNovo: '',
      descricaoAdicional: 'Adicional noturno',
      valorAdicional: '',
      acaoAdicional: incluir ? 'INCLUIR' : 'RETIRAR',
      salarioPraticadoRef: '', salarioDivergente: false, salarioVerificacao: '',
      overrideSalario: false, overrideJustificativa: '',
      alertaCargoInedito: false
    };
    const justificativaCompanion = 'Gerada automaticamente pela alteração de turno para ' + dados.turnoNovo +
      ' (ver movimentação ' + idPrincipal + ').';

    const idCompanion = _movCriarCaso_(user, c, tipoAdicional, competencia, dadosCompanion, justificativaCompanion, idPrincipal);
    idsGerados.push(idCompanion);
  }

  const casosParaEmail = idsGerados.map(id => _movPorId_(id));
  _notificarRHNovaMovimentacao_(casosParaEmail);

  return {
    ok: true,
    id: idPrincipal,
    idsGerados: idsGerados,
    alertaCargoInedito: dados.alertaCargoInedito,
    salarioDivergente: dados.salarioDivergente,
    mensagem: 'Solicitação enviada ao RH.' +
      (idsGerados.length > 1 ? ' Uma movimentação de adicional noturno foi gerada automaticamente junto.' : '') +
      (dados.alertaCargoInedito ? ' Atenção: não há mais ninguém com esse cargo no departamento, confira se não é engano.' : '')
  };
}

function _movCriarCaso_(user, c, tipo, competencia, dados, justificativa, geradaDe) {
  const id = 'MOV-' + _uuid_().slice(0, 8).toUpperCase();

  const linha = {
    ID_MOVIMENTACAO: id,
    ID_COLABORADOR: c.ID_COLABORADOR,
    MATRICULA: c.MATRICULA || '',
    NOME: c.NOME || '',
    DEPARTAMENTO_ATUAL: c.DEPARTAMENTO_ATUAL || '',
    CARGO_ATUAL: _movCargoDoColaborador_(c),
    GESTOR_EMAIL: _normalizarEmail_(c.GESTOR_EMAIL),
    TIPO_COD: tipo.cod,
    TIPO: tipo.nome,
    COMPETENCIA_INICIO: competencia,
    DEPARTAMENTO_NOVO: dados.departamentoNovo,
    TURNO_NOVO: dados.turnoNovo,
    CARGA_HORARIA_NOVA: dados.cargaHorariaNova,
    CARGO_NOVO: dados.cargoNovo,
    SALARIO_NOVO: dados.salarioNovo,
    DESCRICAO_ADICIONAL: dados.descricaoAdicional,
    VALOR_ADICIONAL: dados.valorAdicional,
    ACAO_ADICIONAL: dados.acaoAdicional,
    JUSTIFICATIVA: justificativa,
    MOVIMENTACAO_GERADA_DE: geradaDe || '',
    SALARIO_PRATICADO_REF: dados.salarioPraticadoRef,
    SALARIO_DIVERGENTE: dados.salarioDivergente ? 'Sim' : 'Não',
    SALARIO_VERIFICACAO: dados.salarioVerificacao,
    OVERRIDE_SALARIO: dados.overrideSalario ? 'Sim' : 'Não',
    OVERRIDE_JUSTIFICATIVA: dados.overrideJustificativa,
    ALERTA_CARGO_INEDITO: dados.alertaCargoInedito ? 'Sim' : 'Não',
    STATUS: MOV.STATUS.SOLICITADA,
    RH_DECISAO: '', RH_DECIDIDO_EM: '', RH_MOTIVO: '', RH_AJUSTES_JSON: '', RH_OBSERVACAO: '',
    DP_DECISAO: '', DP_DECIDIDO_POR: '', DP_DECIDIDO_EM: '', DP_MOTIVO: '', DP_FOLHA_COMPETENCIA: '',
    SOLICITADO_POR: _normalizarEmail_(user.EMAIL),
    SOLICITADO_EM: new Date(),
    ATUALIZADO_POR: _normalizarEmail_(user.EMAIL),
    ATUALIZADO_EM: new Date(),
    HISTORICO_JSON: JSON.stringify([{ em: _agoraISO_(), por: _normalizarEmail_(user.EMAIL), evento: 'SOLICITADA', de: '', para: MOV.STATUS.SOLICITADA }])
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = _shMov_();
    const h = _headers_(sh);
    sh.appendRow(h.map(col => (linha[col] === undefined ? '' : linha[col])));
  } finally {
    lock.releaseLock();
  }

  _auditar_('MOV_SOLICITADA', user.EMAIL, 'MOVIMENTACAO.SOLICITAR', true,
    c.NOME + ': ' + tipo.nome, { id: id, geradaDe: geradaDe || null });

  return id;
}

function movCancelar(user, p) {
  const caso = _movPorId_(p.id);
  if (!caso) throw new Error('Movimentação não encontrada.');

  const perfil = String(user.PERFIL).toUpperCase();
  const ehDono = _normalizarEmail_(caso.SOLICITADO_POR) === _normalizarEmail_(user.EMAIL);
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');

  if (!ehDono && !podeGlobal) throw new Error('Você só pode cancelar as solicitações que abriu.');
  if (caso.STATUS !== MOV.STATUS.SOLICITADA) throw new Error('Só é possível cancelar enquanto aguarda o RH.');

  _movPatch_(p.id, { STATUS: MOV.STATUS.CANCELADA }, user, 'CANCELADA');
  return { ok: true, mensagem: 'Solicitação cancelada.' };
}

function _movPatch_(id, patch, user, evento) {
  const sh = _shMov_();
  const h = _headers_(sh);
  const caso = _movPorId_(id);
  if (!caso) throw new Error('Movimentação não encontrada: ' + id);

  let hist = [];
  try { hist = JSON.parse(caso.HISTORICO_JSON || '[]'); } catch (e) { hist = []; }
  hist.push({ em: _agoraISO_(), por: _normalizarEmail_(user.EMAIL), evento: evento, de: caso.STATUS, para: patch.STATUS || caso.STATUS });

  patch.HISTORICO_JSON = JSON.stringify(hist);
  patch.ATUALIZADO_POR = _normalizarEmail_(user.EMAIL);
  patch.ATUALIZADO_EM = new Date();

  _atualizarLinha_(sh, caso._rowNumber, h, patch);
  _auditar_('MOV_' + evento, user.EMAIL, 'MOVIMENTACAO', true, caso.NOME + ': ' + evento, { id: id });

  return Object.assign({}, caso, patch);
}

/* ============================================================================================ */
/*  DP, FILA E DECISÃO FINAL                                                                    */
/* ============================================================================================ */

function movFila(user, p) {
  const casos = _movCasosVisiveis_(user).map(_movResumo_);
  const grupo = (arr) => arr.sort((a, b) => String(a.solicitadoEm).localeCompare(String(b.solicitadoEm)));

  return {
    ok: true,
    modulo: 'MOVIMENTACAO',
    aguardandoDP: grupo(casos.filter(c => c.status === MOV.STATUS.AGUARDANDO_DP)),
    decididas: grupo(casos.filter(c => [MOV.STATUS.DP_APROVADA, MOV.STATUS.DP_REPROVADA].indexOf(c.status) > -1)).slice(0, 40),
    reprovadasPeloRH: grupo(casos.filter(c => c.status === MOV.STATUS.RH_REPROVADA)).slice(0, 20)
  };
}

/**
 * Decisão final do DP (lançamento na folha). payload:
 *   id, decisao ('APROVADA'|'REPROVADA'), motivo (obrigatório se REPROVADA),
 *   folhaCompetencia (obrigatório se APROVADA, ex.: '08/2026')
 */
function movDecidirDP(user, p) {
  const caso = _movPorId_(p.id);
  if (!caso) throw new Error('Movimentação não encontrada.');
  if (caso.STATUS !== MOV.STATUS.AGUARDANDO_DP) {
    throw new Error('Esta movimentação não está aguardando decisão do DP (status atual: ' + caso.STATUS + ').');
  }

  const decisao = String(p.decisao || '').toUpperCase();
  if (['APROVADA', 'REPROVADA'].indexOf(decisao) === -1) throw new Error('Decisão inválida. Use APROVADA ou REPROVADA.');

  if (decisao === 'REPROVADA' && !String(p.motivo || '').trim()) {
    throw new Error('Informe o motivo trabalhista da reprovação.');
  }
  if (decisao === 'APROVADA' && !String(p.folhaCompetencia || '').trim()) {
    throw new Error('Informe em qual folha/competência a alteração vai refletir.');
  }

  const novoStatus = (decisao === 'APROVADA') ? MOV.STATUS.DP_APROVADA : MOV.STATUS.DP_REPROVADA;

  _movPatch_(p.id, {
    STATUS: novoStatus,
    DP_DECISAO: decisao,
    DP_DECIDIDO_POR: _normalizarEmail_(user.EMAIL),
    DP_DECIDIDO_EM: new Date(),
    DP_MOTIVO: String(p.motivo || ''),
    DP_FOLHA_COMPETENCIA: String(p.folhaCompetencia || '')
  }, user, 'DP_' + decisao);

  _notificarGestorDecisaoFinal_(_movPorId_(p.id));

  return { ok: true, mensagem: decisao === 'APROVADA' ? 'Aprovado e gestor notificado.' : 'Reprovado e gestor notificado.' };
}

/* ============================================================================================ */
/*  E-MAILS (reusa _moldura_/_quadro_/_enviar_ do FERIAS.gs; e-mail do RH vem de _movEmailRH_)   */
/* ============================================================================================ */

function _movDetalheTexto_(c) {
  const linhas = [];
  switch (c.TIPO_COD) {
    case 'TRANSFERENCIA_DEPARTAMENTO': linhas.push(['Departamento novo', c.DEPARTAMENTO_NOVO]); break;
    case 'ALTERACAO_TURNO': linhas.push(['Turno novo', c.TURNO_NOVO]); break;
    case 'ALTERACAO_CARGA_HORARIA': linhas.push(['Carga horária nova', c.CARGA_HORARIA_NOVA]); break;
    case 'ALTERACAO_CARGO': linhas.push(['Cargo novo', c.CARGO_NOVO]); break;
    case 'ALTERACAO_SALARIO':
      linhas.push(['Salário novo', 'R$' + Number(c.SALARIO_NOVO || 0).toFixed(2)]);
      if (_sim_(c.SALARIO_DIVERGENTE)) linhas.push(['⚠️ Divergência confirmada', c.OVERRIDE_JUSTIFICATIVA]);
      break;
    case 'ADICIONAL_PAGAMENTO':
    case 'OUTRO':
      linhas.push(['Descrição', c.DESCRICAO_ADICIONAL]);
      if (c.VALOR_ADICIONAL) linhas.push(['Valor', 'R$' + Number(c.VALOR_ADICIONAL).toFixed(2)]);
      if (c.ACAO_ADICIONAL) linhas.push(['Ação', c.ACAO_ADICIONAL === 'INCLUIR' ? 'Incluir' : 'Retirar']);
      break;
  }
  return linhas;
}

function _notificarRHNovaMovimentacao_(casos) {
  const emailRH = _movEmailRH_();

  const blocos = casos.map(c => {
    const detalhe = _movDetalheTexto_(c);
    const linkAprovar = _movLinkDecisao_(c.ID_MOVIMENTACAO, 'APROVAR');
    const linkReprovar = _movLinkDecisao_(c.ID_MOVIMENTACAO, 'REPROVAR');
    const linkAlteracao = _movLinkDecisao_(c.ID_MOVIMENTACAO, 'APROVAR_ALTERACAO');

    return '<div style="border:1px solid #e6ecee;border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<p style="margin:0 0 8px"><b>' + _escapeHtml_(c.NOME) + '</b>, ' + _escapeHtml_(c.TIPO) + '</p>' +
      _quadro_([
        ['Departamento atual', c.DEPARTAMENTO_ATUAL || ','],
        ['Cargo atual', c.CARGO_ATUAL || ','],
        ['Competência de início', c.COMPETENCIA_INICIO]
      ].concat(detalhe)) +
      '<p style="font-size:13px;margin:10px 0 14px">' + _escapeHtml_(c.JUSTIFICATIVA || '') + '</p>' +
      (c.MOVIMENTACAO_GERADA_DE ? '<p style="font-size:12px;color:#8a5b00">Gerada automaticamente a partir de ' + c.MOVIMENTACAO_GERADA_DE + '.</p>' : '') +
      '<div style="margin-top:10px">' +
        '<a href="' + linkAprovar + '" style="background:#1a8a4b;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;margin-right:8px">Aprovar</a>' +
        '<a href="' + linkAlteracao + '" style="background:#c47f00;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;margin-right:8px">Aprovar com alterações</a>' +
        '<a href="' + linkReprovar + '" style="background:#c0392b;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700">Reprovar</a>' +
      '</div>' +
    '</div>';
  }).join('');

  const corpo = '<p>Chegaram novas solicitações de movimentação para análise do RH:</p>' + blocos +
    '<p style="font-size:12px;color:#6b7c81">Os links acima são pessoais e válidos por ' + MOV.TOKEN_DIAS_VALIDADE + ' dias.</p>';

  _enviar_(emailRH, 'Movimentação(ões) para aprovação do RH, ' + casos[0].NOME,
    _moldura_('Nova movimentação para o RH', corpo, 'Departamento Pessoal · CIEDS.'), null, null, true); // sem cópia para ferias@
}

function _notificarGestorDecisaoFinal_(c) {
  const gestor = _normalizarEmail_(c.GESTOR_EMAIL);
  const aprovado = (c.DP_DECISAO === 'APROVADA');

  let ajustes = [];
  try { ajustes = JSON.parse(c.RH_AJUSTES_JSON || '[]'); } catch (e) { ajustes = []; }

  let corpo;
  if (aprovado) {
    corpo = '<p>A movimentação de <b>' + _escapeHtml_(c.NOME) + '</b> (' + _escapeHtml_(c.TIPO) + ') foi <b>aprovada</b>.</p>' +
      _quadro_([
        ['Competência de início', c.COMPETENCIA_INICIO],
        ['Vai refletir na folha', c.DP_FOLHA_COMPETENCIA]
      ]) +
      (ajustes.length
        ? '<div style="background:#fdf4e3;color:#8a5b00;border-radius:10px;padding:12px 14px;margin-top:12px;font-size:13px">' +
          '<b>O RH fez alguns ajustes antes de aprovar:</b><br>' +
          ajustes.map(a => '• ' + _escapeHtml_(a)).join('<br>') + '</div>'
        : '');
  } else {
    corpo = '<p>A movimentação de <b>' + _escapeHtml_(c.NOME) + '</b> (' + _escapeHtml_(c.TIPO) + ') <b>não foi aprovada</b>.</p>' +
      _quadro_([['Motivo', c.DP_MOTIVO || ',']]);
  }

  _enviar_(gestor, (aprovado ? 'Movimentação aprovada, ' : 'Movimentação não aprovada, ') + c.NOME,
    _moldura_(aprovado ? 'Movimentação aprovada' : 'Movimentação não aprovada', corpo, 'Departamento Pessoal · CIEDS.'), null, null, true); // sem cópia para ferias@
}

/* ============================================================================================ */
/*  ASSINATURA DOS LINKS DE DECISÃO (usados pelo mini-app MOVIMENTACAO_DECISAO_WEB)              */
/* ============================================================================================ */

function _movSegredo_() {
  const s = _feriasParam_(MOV.SEGREDO_PARAM, '');
  if (!s) throw new Error('Segredo de assinatura não configurado. Rode configurarSegredoDecisaoMovimentacao().');
  return s;
}

function _movEmailRH_() {
  const e = _feriasParam_(MOV.EMAIL_RH_PARAM, '');
  if (!e) throw new Error('E-mail do RH não configurado. Rode configurarEmailRH("email@cieds.org.br").');
  return e;
}

function configurarEmailRH(email) {
  if (!email || String(email).indexOf('@') === -1) throw new Error('Informe um e-mail válido.');
  _setFeriasParam_(MOV.EMAIL_RH_PARAM, String(email).trim().toLowerCase());
  return 'E-mail do RH configurado: ' + email;
}

function configurarSegredoDecisaoMovimentacao(segredo) {
  if (!segredo || String(segredo).length < 12) throw new Error('Informe um segredo longo (pelo menos 12 caracteres).');
  _setFeriasParam_(MOV.SEGREDO_PARAM, String(segredo));
  return 'Segredo configurado. Copie o MESMO valor (' + segredo + ') no Script Properties do ' +
    'projeto MOVIMENTACAO_DECISAO_WEB, na chave MOV_DECISAO_SEGREDO.';
}

function _movTokenDecisao_(idMovimentacao, diasValidade) {
  const expira = Date.now() + (diasValidade || MOV.TOKEN_DIAS_VALIDADE) * 24 * 60 * 60 * 1000;
  const base = idMovimentacao + '|' + expira;
  const assinatura = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(base, _movSegredo_())
  );
  return Utilities.base64EncodeWebSafe(base) + '.' + assinatura;
}

function _movLinkDecisao_(idMovimentacao, acao) {
  if (!MOV.DECISAO_WEB_URL) return '#';
  const tk = _movTokenDecisao_(idMovimentacao, MOV.TOKEN_DIAS_VALIDADE);
  return MOV.DECISAO_WEB_URL + '?id=' + encodeURIComponent(idMovimentacao) +
    '&acao=' + encodeURIComponent(acao) + '&tk=' + encodeURIComponent(tk);
}

/* ============================================================================================ */
/*  SETUP + DIAGNÓSTICO (rode pelo ▶)                                                            */
/* ============================================================================================ */

function movSetup() {
  const r1 = garantirAbaMovimentacoes();
  const r2 = semearPermissoesMovimentacao();
  const msg = 'MOVIMENTAÇÕES pronto.\n- ' + r1 + '\n- ' + r2 +
    '\n\nAgora:' +
    '\n1) configurarEmailRH("email-do-rh@cieds.org.br")' +
    '\n2) configurarSegredoDecisaoMovimentacao("uma-string-bem-longa-e-aleatoria")' +
    '\n3) publique o mini-app MOVIMENTACAO_DECISAO_WEB e cole a URL /exec em MOV.DECISAO_WEB_URL' +
    '\n4) rode diagnosticarCamposColaborador() e me avise se CARGO/SALARIO não baterem' +
    '\n5) aplique os 2 patches de kernel (Codigo.gs e FERIAS.gs, no fim deste arquivo)' +
    '\n6) adicione MOVIMENTACAO na coluna MODULOS dos usuários do DP';
  console.log(msg);
  return msg;
}

function semearPermissoesMovimentacao() {
  const ss = _configSS_();
  const sh = ss.getSheetByName(DP360.SHEETS.PERMISSOES);
  if (!sh) throw new Error('Aba PERMISSOES não encontrada. Rode setupDP360() primeiro.');

  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh).map(r => String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  const novas = [
    ['GESTOR', 'MOVIMENTACAO.CONTEXTO', 'Sim', 'PROPRIO', 'Consultar movimentações da própria equipe.'],
    ['GESTOR', 'MOVIMENTACAO.SOLICITAR', 'Sim', 'PROPRIO', 'Solicitar movimentação da própria equipe.'],
    ['GESTOR', 'MOVIMENTACAO.CANCELAR', 'Sim', 'PROPRIO', 'Cancelar a própria solicitação pendente.'],
    ['GESTOR', 'MOVIMENTACAO.TIPOS', 'Sim', 'PROPRIO', 'Ver os tipos de movimentação.'],
    ['DP', 'MOVIMENTACAO.*', 'Sim', 'GLOBAL', 'Ações operacionais de movimentações.']
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
  return add ? (add + ' permissão(ões) adicionada(s).') : 'Permissões já estavam presentes.';
}

function diagnosticarMovimentacoes() {
  const sh = _ssMov_().getSheetByName(MOV.ABA);
  const casos = sh ? _sheetToObjects_(sh) : [];

  const out = {
    versao: MOV.VERSAO,
    abaExiste: !!sh,
    casosRegistrados: casos.length,
    segredoConfigurado: !!_feriasParam_(MOV.SEGREDO_PARAM, ''),
    emailRHConfigurado: !!_feriasParam_(MOV.EMAIL_RH_PARAM, ''),
    decisaoWebUrlConfigurada: !!MOV.DECISAO_WEB_URL,
    guiaUrlConfigurada: !!MOV.GUIA_URL,
    porStatus: {}
  };
  casos.forEach(c => { out.porStatus[c.STATUS] = (out.porStatus[c.STATUS] || 0) + 1; });

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ============================================================================================ */
/*  PATCHES PRONTOS PARA COLAR NO KERNEL                                                         */
/* ============================================================================================ */

/*
--- Codigo.gs, dentro de _modulosDisponiveis_() ---

  if (typeof movResumo === 'function') {
    m.MOVIMENTACAO = {
      nome: 'Movimentações',
      permissao: 'MOVIMENTACAO.CONTEXTO',
      resumo: movResumo,
      resumoDe: movResumoDe,
      contexto: movContexto
    };
  }

--- FERIAS.gs, dentro de executar(), logo após o bloco de PROCESSOTRAB.* ---

  if (acao.indexOf('MOVIMENTACAO.') === 0 && typeof movExecutar === 'function') {
    return movExecutar(acao, payload || {}, user);
  }
*/