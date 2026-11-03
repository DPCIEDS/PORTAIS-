/*************************************************************************************************
 * MÓDULO BENEFÍCIOS · DP360, arquivo BENEFICIOS.gs
 * -----------------------------------------------------------------------------------------------
 * Cole como NOVO arquivo no projeto DP360_API.
 *
 * O QUE É: controle de compra de benefícios (Pluxee/Sodexo, RioCard, e outros) na admissão e
 * mensalmente. O DP importa o que foi PEDIDO ao fornecedor e, depois, o que o fornecedor
 * efetivamente CONFIRMOU (o relatório de compra), os dois ficam registrados lado a lado, o que
 * permite CONCILIAR (achar quem pediu e não apareceu confirmado, e diferenças de valor).
 *
 * O gestor só CONSULTA (não solicita nada aqui): escolhe o colaborador, filtra o mês ou um
 * período, e vê o valor de benefício comprado, sempre a partir do que foi CONFIRMADO pelo
 * fornecedor (RELATORIO), nunca do que só foi pedido.
 *
 * ⚠️ SOBRE OS FORMATOS DE RELATÓRIO: Pluxee, RioCard (mais-mobi) e outros fornecedores têm
 * layouts de coluna diferentes entre si (às vezes até o nome da coluna de valor muda, ex.:
 * "ALIMENTAÇÃO" em vez de "VALOR"). Este módulo NÃO tenta ler o PDF do fornecedor diretamente ,
 * o DP prepara uma aba simples e padronizada (MATRICULA ou CPF, NOME, VALOR) a partir do
 * relatório, e o PDF original fica só arquivado como comprovante. Ver IMPORTAR_LOTE.
 *
 * PARA PLUGAR NO KERNEL:
 *   1) Codigo.gs → registrar o módulo em _modulosDisponiveis_() (bloco pronto no fim deste arquivo)
 *   2) FERIAS.gs → adicionar o roteamento de BENEFICIOS.* no executar() (bloco pronto no fim)
 *   3) rode UMA vez: beneficiosSetup()
 *   4) adicione BENEFICIOS na coluna MODULOS dos usuários do DP
 *************************************************************************************************/

const BEN = {
  VERSAO: '1.2.0', // [2026-10-21] cálculo corrigido (era o da aba de teste) vira o de verdade; pedido sai do cálculo

  // Mesma planilha "CONTROLE DE PAGAMENTO 2026" usada por Rescisão/ProcessoTrab/Movimentação
  // (constante própria, sem depender de outro arquivo estar carregado).
  CONTROLE_ID: '1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc',
  ABA_LANCAMENTOS: 'BENEFICIOS_LANCAMENTOS',
  ABA_REGRAS: 'BENEFICIOS_REGRAS',
  ABA_DIAS_UTEIS: 'BENEFICIOS_DIAS_UTEIS',

  // Outras planilhas do sistema, usadas SÓ PRA LEITURA pelo motor de cálculo
  // (descontar férias/afastamento/rescisão automaticamente).
  FERIAS_SHEET_ID: '1gX_uwAY4Go4oaqDsPV4qZlN3l2ZFwWqtNuERzQy3WzQ',
  AFAST_SHEET_ID: '1zYYtJG8RyOcrPZiEkDNZtXWr0AZKrkgS3DuaV9zukO0',

  COLUNAS_LANCAMENTOS: [
    'ID_LANCAMENTO', 'COMPETENCIA', 'FORNECEDOR', 'TIPO_BENEFICIO', 'ORIGEM', 'NUMERO_PEDIDO',
    'ID_COLABORADOR', 'MATRICULA', 'CPF', 'NOME', 'VALOR', 'ENCONTRADO',
    'ARQUIVO_LINK', 'IMPORTADO_POR', 'IMPORTADO_EM',
    // ---- calculado (Fatia 2) ----
    'DIAS_UTEIS_MES', 'DESCONTO_FERIAS', 'DESCONTO_AFASTAMENTO', 'DESCONTO_RESCISAO',
    'DESCONTO_MANUAL', 'TOTAL_DIAS', 'TIPO_VALOR', 'ESCALA_12X36',
    'DESCONTO_ADMISSAO' // [2026-10-21] admissão no meio do mês (DESCONTO_MANUAL = faltas digitadas)
  ],

  COLUNAS_REGRAS: [
    'DEPARTAMENTO', 'TIPO_VALOR', 'VALOR', 'NUMERO_CONTRATO', 'COD_SODEXO', 'COD_EMPRESA', 'OBSERVACOES'
  ],

  COLUNAS_DIAS_UTEIS: ['COMPETENCIA', 'UF', 'DIAS_UTEIS'],

  TIPOS_VALOR: ['DIARIO', 'FIXO'],
  FORNECEDORES: ['PLUXEE', 'RIOCARD', 'JAEH', 'OUTRO'],
  ORIGENS: ['PEDIDO', 'RELATORIO', 'CALCULADO']
};

/* ============================================================================================ */
/*  ROTEADOR                                                                                     */
/* ============================================================================================ */

function beneficiosExecutar(acao, p, user) {
  switch (acao) {
    case 'BENEFICIOS.CONTEXTO':      return beneficiosContexto(user, p);
    case 'BENEFICIOS.CONSULTAR':     return beneficiosConsultar(user, p);

    // DP
    case 'BENEFICIOS.IMPORTAR_LOTE': return beneficiosImportarLote(user, p);
    case 'BENEFICIOS.CONCILIAR':     return beneficiosConciliar(user, p);
    case 'BENEFICIOS.LISTAR_LOTES':  return beneficiosListarLotes(user, p);
    case 'BENEFICIOS.LOTE_LINHAS':   return beneficiosLoteLinhas(user, p);

    // Motor de cálculo. [2026-10-21] SIMULAR é a prévia (só leitura) e GERAR_PEDIDO grava o pedido a
    // partir do mesmo cálculo; o antigo CALCULAR (que somava um lote novo a cada clique) saiu.
    case 'BENEFICIOS.IMPORTAR_REGRAS':    return beneficiosImportarRegras(user, p);
    case 'BENEFICIOS.DEFINIR_DIAS_UTEIS': return beneficiosDefinirDiasUteis(user, p);
    case 'BENEFICIOS.LISTAR_REGRAS':      return beneficiosListarRegras(user, p);
    case 'BENEFICIOS.SIMULAR':            return beneficiosSimular(user, p);
    case 'BENEFICIOS.GERAR_PEDIDO':       return beneficiosGerarPedido(user, p);

    default:
      throw new Error('Ação de benefícios desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  INFRA                                                                                        */
/* ============================================================================================ */

var _SS_BEN_ = null;
function _ssBen_() {
  if (!_SS_BEN_) _SS_BEN_ = SpreadsheetApp.openById(BEN.CONTROLE_ID);
  return _SS_BEN_;
}

// [2026-10-21] O Sheets transformava "11/2026" em data (01/11/2026) ao gravar, e as comparações por
// texto da competência falhavam (o pedido não aparecia na conciliação). Agora a coluna COMPETENCIA é
// gravada como texto e, na leitura, data volta a ser "MM/AAAA".
function _benComp_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, _ssBen_().getSpreadsheetTimeZone() || DP360.FUSO, 'MM/yyyy');
  return String(v == null ? '' : v).trim();
}

function _benCompetenciaComoTexto_(sh) {
  try {
    const h = _headers_(sh), ci = h.indexOf('COMPETENCIA');
    if (ci > -1) sh.getRange(1, ci + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  } catch (e) { console.error('_benCompetenciaComoTexto_: ' + e); }
}

function _shBen_() {
  const sh = _ssBen_().getSheetByName(BEN.ABA_LANCAMENTOS);
  if (!sh) throw new Error('Aba não encontrada: ' + BEN.ABA_LANCAMENTOS + '. Rode beneficiosSetup() uma vez.');
  return sh;
}

function garantirAbaBeneficios() {
  const ss = _ssBen_();
  let sh = ss.getSheetByName(BEN.ABA_LANCAMENTOS);

  if (!sh) {
    sh = ss.insertSheet(BEN.ABA_LANCAMENTOS);
    sh.getRange(1, 1, 1, BEN.COLUNAS_LANCAMENTOS.length).setValues([BEN.COLUNAS_LANCAMENTOS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, BEN.COLUNAS_LANCAMENTOS.length).setFontWeight('bold');
    return 'Aba BENEFICIOS_LANCAMENTOS criada.';
  }

  const h = _headers_(sh);
  const faltando = BEN.COLUNAS_LANCAMENTOS.filter(c => h.indexOf(c) === -1);
  if (faltando.length) {
    let col = sh.getLastColumn();
    faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));
    return 'Colunas acrescentadas: ' + faltando.join(', ');
  }
  return 'Aba BENEFICIOS_LANCAMENTOS já está pronta.';
}

function garantirAbaRegras() {
  const ss = _ssBen_();
  let sh = ss.getSheetByName(BEN.ABA_REGRAS);

  if (!sh) {
    sh = ss.insertSheet(BEN.ABA_REGRAS);
    sh.getRange(1, 1, 1, BEN.COLUNAS_REGRAS.length).setValues([BEN.COLUNAS_REGRAS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, BEN.COLUNAS_REGRAS.length).setFontWeight('bold');
    return 'Aba BENEFICIOS_REGRAS criada.';
  }
  return 'Aba BENEFICIOS_REGRAS já está pronta.';
}

function garantirAbaDiasUteis() {
  const ss = _ssBen_();
  let sh = ss.getSheetByName(BEN.ABA_DIAS_UTEIS);

  if (!sh) {
    sh = ss.insertSheet(BEN.ABA_DIAS_UTEIS);
    sh.getRange(1, 1, 1, BEN.COLUNAS_DIAS_UTEIS.length).setValues([BEN.COLUNAS_DIAS_UTEIS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, BEN.COLUNAS_DIAS_UTEIS.length).setFontWeight('bold');
    return 'Aba BENEFICIOS_DIAS_UTEIS criada.';
  }
  return 'Aba BENEFICIOS_DIAS_UTEIS já está pronta.';
}

function _shRegras_() {
  const sh = _ssBen_().getSheetByName(BEN.ABA_REGRAS);
  if (!sh) throw new Error('Aba de regras não encontrada. Rode beneficiosSetup() uma vez.');
  return sh;
}

function _shDiasUteis_() {
  const sh = _ssBen_().getSheetByName(BEN.ABA_DIAS_UTEIS);
  if (!sh) throw new Error('Aba de dias úteis não encontrada. Rode beneficiosSetup() uma vez.');
  return sh;
}

/* ============================================================================================ */
/*  REGRAS, quanto cada departamento recebe (diário ou fixo mensal)                             */
/* ============================================================================================ */

/**
 * Importa a tabela de regras a partir de uma aba preparada pelo DP com as colunas:
 * DEPARTAMENTO, TIPO_VALOR (DIARIO|FIXO), VALOR, NUMERO_CONTRATO, COD_SODEXO, COD_EMPRESA,
 * OBSERVACOES (as 3 últimas são opcionais). SUBSTITUI a tabela de regras inteira, é assim que
 * "atualizar a matriz" deve funcionar (a matriz é sempre a foto mais recente, não um histórico).
 * payload: sheetId
 */
function beneficiosImportarRegras(user, p) {
  if (!p.sheetId) throw new Error('Informe o ID da planilha com as regras preparadas.');

  const shOrigem = SpreadsheetApp.openById(p.sheetId).getSheets()[0];
  const dados = shOrigem.getDataRange().getValues();
  const header = dados[0].map(h => String(h || '').trim().toUpperCase());

  const col = (nomes) => {
    for (let i = 0; i < nomes.length; i++) {
      const idx = header.indexOf(nomes[i]);
      if (idx > -1) return idx;
    }
    return -1;
  };

  const colDepto = col(['DEPARTAMENTO']);
  const colTipo = col(['TIPO_VALOR', 'TIPO VALOR', 'FIXO']);
  const colValor = col(['VALOR', 'VALOR DIÁRIO', 'VALOR DIARIO']);
  const colContrato = col(['NUMERO_CONTRATO', 'Nº CONTRATO', 'N CONTRATO']);
  const colCodSodexo = col(['COD_SODEXO', 'CÓD SODEXO', 'COD SODEXO']);
  const colCodEmpresa = col(['COD_EMPRESA', 'CÓD EMPRESA', 'COD EMPRESA']);
  const colObs = col(['OBSERVACOES', 'OBSERVAÇÕES']);

  if (colDepto === -1) throw new Error('A planilha precisa ter a coluna DEPARTAMENTO.');
  if (colValor === -1) throw new Error('A planilha precisa ter a coluna VALOR (ou "Valor Diário").');
  if (colTipo === -1) throw new Error('A planilha precisa ter a coluna TIPO_VALOR (DIARIO ou FIXO).');

  const linhasNovas = [];
  let semTipo = 0;

  for (let r = 1; r < dados.length; r++) {
    const depto = String(dados[r][colDepto] || '').trim();
    if (!depto) continue;

    let tipo = String(dados[r][colTipo] || '').trim().toUpperCase();
    // aceita a coluna "Fixo" (Sim/Não) do jeito que já é usada hoje, além de DIARIO/FIXO direto
    if (tipo === 'SIM') tipo = 'FIXO';
    if (tipo === 'NÃO' || tipo === 'NAO') tipo = 'DIARIO';
    if (BEN.TIPOS_VALOR.indexOf(tipo) === -1) { tipo = 'DIARIO'; semTipo++; }

    linhasNovas.push({
      DEPARTAMENTO: depto,
      TIPO_VALOR: tipo,
      VALOR: Number(String(dados[r][colValor] || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0,
      NUMERO_CONTRATO: colContrato > -1 ? String(dados[r][colContrato] || '') : '',
      COD_SODEXO: colCodSodexo > -1 ? String(dados[r][colCodSodexo] || '') : '',
      COD_EMPRESA: colCodEmpresa > -1 ? String(dados[r][colCodEmpresa] || '') : '',
      OBSERVACOES: colObs > -1 ? String(dados[r][colObs] || '') : ''
    });
  }

  const sh = _shRegras_();
  const h = _headers_(sh);

  // substitui a tabela inteira (mantendo o cabeçalho)
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha > 1) sh.getRange(2, 1, ultimaLinha - 1, h.length).clearContent();

  if (linhasNovas.length) {
    sh.getRange(2, 1, linhasNovas.length, h.length)
      .setValues(linhasNovas.map(l => h.map(col => (l[col] === undefined ? '' : l[col]))));
  }

  _auditar_('BEN_REGRAS_IMPORTADAS', user.EMAIL, 'BENEFICIOS.IMPORTAR_REGRAS', true,
    linhasNovas.length + ' departamento(s) importado(s)', { semTipoExplicito: semTipo });

  return {
    ok: true,
    totalImportado: linhasNovas.length,
    semTipoExplicito: semTipo,
    mensagem: linhasNovas.length + ' departamento(s) importado(s)' +
      (semTipo ? ', ' + semTipo + ' sem TIPO_VALOR reconhecido, assumido DIARIO (confira).' : '.')
  };
}

function beneficiosListarRegras(user, p) {
  return { ok: true, regras: _sheetToObjects_(_shRegras_()) };
}

/**
 * Define quantos dias úteis tem o mês, por UF, porque feriado estadual/municipal muda a conta
 * (ex.: RJ e SP não têm os mesmos feriados). payload: competencia ('MM/AAAA'), diasUteisPorUF
 * ({ RJ: 19, SP: 20, PADRAO: 19, ... }, "PADRAO" é usado para UF sem entrada específica).
 */
function beneficiosDefinirDiasUteis(user, p) {
  const competencia = String(p.competencia || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) throw new Error('Informe a competência no formato MM/AAAA.');

  const mapa = p.diasUteisPorUF || {};
  const ufs = Object.keys(mapa);
  if (!ufs.length) throw new Error('Informe ao menos um valor de dias úteis (ex.: { "PADRAO": 19 }).');

  _benGravarDiasUteis_(competencia, mapa);

  _auditar_('BEN_DIAS_UTEIS_DEFINIDOS', user.EMAIL, 'BENEFICIOS.DEFINIR_DIAS_UTEIS', true,
    competencia + ': ' + ufs.join(', '), { competencia: competencia });

  return { ok: true, mensagem: 'Dias úteis de ' + competencia + ' definidos para ' + ufs.length + ' UF(s).' };
}

/** Grava os dias úteis da competência por UF, substituindo os que já havia (não duplica). */
function _benGravarDiasUteis_(competencia, mapa) {
  const sh = _shDiasUteis_();
  const h = _headers_(sh);
  _benApagarLinhas_(sh, _sheetToObjects_(sh).filter(o => _benComp_(o.COMPETENCIA) === competencia).map(o => o._rowNumber));
  const novas = Object.keys(mapa).map(uf => {
    const l = { COMPETENCIA: competencia, UF: uf.toUpperCase().trim(), DIAS_UTEIS: Number(mapa[uf]) || 0 };
    return h.map(col => (l[col] === undefined ? '' : l[col]));
  });
  _benCompetenciaComoTexto_(sh);
  if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, h.length).setValues(novas);
}

function _benDiasUteisDaCompetencia_(competencia) {
  const linhas = _sheetToObjects_(_shDiasUteis_()).filter(o => _benComp_(o.COMPETENCIA) === competencia);
  const mapa = {};
  linhas.forEach(l => { mapa[String(l.UF).toUpperCase().trim()] = Number(l.DIAS_UTEIS || 0); });
  return mapa;
}

/**
 * Escala 12x36 (mesmo com informações extras junto, ex.: horários e intervalo) não compra por
 * dia útil, compra por metade dos dias do mês, arredondado pra cima (31 dias → 16, 30 dias → 15).
 */
function _benEhEscala12x36_(colaborador) {
  const h = String(colaborador.HORARIO || '').toUpperCase();
  return h.indexOf('12X36') > -1 || h.indexOf('12 X 36') > -1;
}

function _benDiasBaseEscala12x36_(mesIni, mesFim) {
  const diasNoMes = Math.round((mesFim - mesIni) / 86400000) + 1;
  return Math.ceil(diasNoMes / 2);
}

/* ============================================================================================ */
/*  MOTOR DE CÁLCULO, cruza Férias, Afastamentos e Rescisão automaticamente                     */
/* ============================================================================================ */

/** Início e fim (Date) do mês de uma competência 'MM/AAAA'. */
function _benMesIntervalo_(competencia) {
  const [mm, yyyy] = competencia.split('/').map(Number);
  const inicio = new Date(yyyy, mm - 1, 1, 12, 0, 0);
  const fim = new Date(yyyy, mm, 0, 12, 0, 0); // dia 0 do mês seguinte = último dia deste mês
  return { inicio: inicio, fim: fim };
}

var _CACHE_BEN_FERIAS_ = null;
function _benSolicitacoesFerias_() {
  if (_CACHE_BEN_FERIAS_) return _CACHE_BEN_FERIAS_;
  const sh = SpreadsheetApp.openById(BEN.FERIAS_SHEET_ID).getSheetByName('SOLICITACOES');
  _CACHE_BEN_FERIAS_ = sh ? _sheetToObjects_(sh) : [];
  return _CACHE_BEN_FERIAS_;
}

var _CACHE_BEN_AFAST_ = null;
function _benOcorrenciasAfastamento_() {
  if (_CACHE_BEN_AFAST_) return _CACHE_BEN_AFAST_;
  const sh = SpreadsheetApp.openById(BEN.AFAST_SHEET_ID).getSheetByName('OCORRENCIAS');
  _CACHE_BEN_AFAST_ = sh ? _sheetToObjects_(sh) : [];
  return _CACHE_BEN_AFAST_;
}

var _CACHE_BEN_RESC_ = null;
function _benCasosRescisao_() {
  if (_CACHE_BEN_RESC_) return _CACHE_BEN_RESC_;
  const sh = _ssBen_().getSheetByName('RESCISAO_CASOS');
  _CACHE_BEN_RESC_ = sh ? _sheetToObjects_(sh) : [];
  return _CACHE_BEN_RESC_;
}

function _benInvalidarCachesCalculo_() {
  _CACHE_BEN_FERIAS_ = null;
  _CACHE_BEN_AFAST_ = null;
  _CACHE_BEN_RESC_ = null;
  _CACHE_BEN_INDEX_ = null;
}

/**
 * O motor: calcula o benefício do mês de cada colaborador, com os descontos explicados. Não grava nada.
 * A prévia do Portal (SIMULAR) e o pedido (GERAR_PEDIDO) usam este mesmo cálculo.
 * [2026-10-21] É o cálculo que estava na aba "Benefícios (teste)", aprovado pelo DP:
 *  - quem foi desligado antes da competência (ou admitido depois) fica de fora, com o motivo;
 *  - admissão no meio do mês conta a partir do dia da admissão;
 *  - férias, afastamento e desligamento descontam em DIAS ÚTEIS da UF (12x36: dias da escala);
 *  - férias e afastamento no mesmo dia não descontam duas vezes;
 *  - afastamento sem DATA_RETORNO usa a data prevista (antes contava até o fim do mês, todo mês);
 *  - dias úteis por UF: o que o DP digitou; senão o que ficou gravado para a competência; senão o
 *    calendário (feriados nacionais + estaduais conhecidos);
 *  - regras lidas uma vez só (antes, uma leitura da aba por colaborador).
 * As faltas, digitadas pelo DP por pessoa, entram depois, em _benAplicarFaltas_.
 */
function _benCalculoMes_(competencia, diasUteisPorUF) {
  _benInvalidarCachesCalculo_();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) throw new Error('Informe a competência no formato MM/AAAA.');
  const { inicio: mesIni, fim: mesFim } = _benMesIntervalo_(competencia);
  const digitado = diasUteisPorUF || {};
  const gravado = _benDiasUteisDaCompetencia_(competencia);
  const norm = (s) => String(s || '').trim().toUpperCase();

  const regras = {};
  _sheetToObjects_(_shRegras_()).forEach(r => { regras[norm(r.DEPARTAMENTO)] = r; });

  const porId = (lista) => {
    const m = {};
    lista.forEach(x => { const k = String(x.ID_COLABORADOR || ''); if (k) (m[k] = m[k] || []).push(x); });
    return m;
  };
  const feriasPorId = porId(_benSolicitacoesFerias_().filter(s => norm(s.STATUS) === 'DEFERIDA'));
  const afastPorId = porId(_benOcorrenciasAfastamento_());
  const statusEfetivados = ['DESLIGADO', 'AGUARDANDO_CONCILIACAO', 'VALORES_CONFIRMADOS',
    'ENVIADO_FINANCEIRO', 'AGUARDANDO_ASSINATURA', 'ARQUIVADO'];
  const demissaoPorId = {};
  _benCasosRescisao_().forEach(c => {
    const dt = _dataF_(c.DATA_DEMISSAO);
    if (dt && statusEfetivados.indexOf(String(c.STATUS)) > -1 && !demissaoPorId[c.ID_COLABORADOR]) demissaoPorId[c.ID_COLABORADOR] = dt;
  });
  // [2026-10-26] Demissões lançadas pelo DP na CONTROLE.2026 (mesma planilha), por matrícula: cobre quem ainda não
  // tem DATA_DESLIGAMENTO no cadastro (ex.: admitido pelo Raio-X depois da última sincronização das rescisões).
  const matN = (v) => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  const demissaoControle = {};
  const shCtrl = _ssBen_().getSheetByName(RESC.ABAS.CONTROLE);
  if (shCtrl && shCtrl.getLastRow() >= RESC.CONTROLE_LINHA_INICIAL) {
    shCtrl.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, shCtrl.getLastRow() - RESC.CONTROLE_LINHA_INICIAL + 1, RESC.COL.DEMISSAO).getValues()
      .forEach(r => { const m = matN(r[RESC.COL.MATRICULA - 1]), dt = _dataF_(r[RESC.COL.DEMISSAO - 1]); if (m && dt) demissaoControle[m] = dt; });
  }

  const colabs = _colaboradores_();
  const dias12x36 = _benDiasBaseEscala12x36_(mesIni, mesFim);

  const ufs = {};
  colabs.forEach(c => { if (!_benEhEscala12x36_(c)) { const uf = norm(c.UF) || 'SEM UF'; ufs[uf] = (ufs[uf] || 0) + 1; } });
  const diasUF = {}, resumoUF = [];
  Object.keys(ufs).sort().forEach(uf => {
    const sug = _benUteis_(mesIni, mesFim, uf);
    const dig = digitado[uf] != null && digitado[uf] !== '' ? Number(digitado[uf]) : null;
    const usado = dig != null ? dig : (gravado[uf] != null ? gravado[uf] : sug);
    diasUF[uf] = usado;
    resumoUF.push({ uf: uf, pessoas: ufs[uf], sugestao: sug, gravado: gravado[uf] != null ? gravado[uf] : null, usado: usado,
      feriados: _benFeriadosDoMes_(mesIni, mesFim, uf) });
  });

  const linhas = [], fora = [];
  colabs.forEach(c => {
    const id = String(c.ID_COLABORADOR || '');
    const regra = regras[norm(c.DEPARTAMENTO_ATUAL)] || null;
    const escala = _benEhEscala12x36_(c);
    const uf = norm(c.UF) || 'SEM UF';
    const adm = _dataF_(c.DATA_ADMISSAO);
    const ctrl = demissaoControle[matN(c.MATRICULA)];
    const deslig = _dataF_(c.DATA_DESLIGAMENTO) || demissaoPorId[id] ||
      (ctrl && !(adm && ctrl < adm) ? ctrl : null); // demissão anterior à admissão é de um contrato antigo: ignora
    const sit = norm(c.SITUACAO);
    const desligadoNoCadastro = sit.indexOf('DESLIG') > -1 || sit.indexOf('DEMITID') > -1 || sit.indexOf('INATIVO') > -1;
    const base = { id: id, mat: String(c.MATRICULA || ''), cpf: String(c.CPF || ''), nome: String(c.NOME || '').trim(),
      depto: c.DEPARTAMENTO_ATUAL || '', uf: uf, escala: escala,
      adm: adm ? _benIso_(adm) : '', deslig: deslig ? _benIso_(deslig) : '' };

    let motivo = '';
    if (deslig && deslig < mesIni) motivo = 'Desligado(a) em ' + _benBr_(deslig) + ', antes da competência';
    else if (!deslig && desligadoNoCadastro) motivo = 'Desligado(a) no cadastro, sem data de desligamento';
    else if (adm && adm > mesFim) motivo = 'Admissão em ' + _benBr_(adm) + ', depois da competência';
    else if (!regra) motivo = 'Departamento sem valor na tabela de regras';
    else if (!escala && !(diasUF[uf] > 0)) motivo = 'Sem dias úteis para a UF ' + uf;
    if (motivo) { base.motivo = motivo; fora.push(base); return; }

    const unidade = (dias) => escala ? Math.ceil(dias.length / 2) : dias.filter(dt => _benEhUtil_(dt, uf)).length;
    const diasDoMes = escala ? dias12x36 : diasUF[uf];
    const iniEf = adm && adm > mesIni ? adm : mesIni;
    const fimEf = deslig && deslig <= mesFim ? _benMaisDias_(deslig, -1) : mesFim; // o dia da demissão não é trabalhado
    const descAdm = adm && adm > mesIni ? unidade(_benDias_(mesIni, _benMaisDias_(adm, -1))) : 0;
    const descResc = deslig && deslig >= mesIni && deslig <= mesFim ? unidade(_benDias_(deslig, mesFim)) : 0;

    const diasFer = {}, diasAfa = {};
    (feriasPorId[id] || []).forEach(s => _benMarcar_(diasFer, _dataF_(s.DATA_INICIO), _dataF_(s.DATA_FIM), iniEf, fimEf));
    let afastAberto = false;
    (afastPorId[id] || []).forEach(o => {
      const ini = _dataF_(o.DATA_INICIO);
      if (!ini) return;
      const ret = _dataF_(o.DATA_RETORNO);
      let fim = ret ? _benMaisDias_(ret, -1) : _dataF_(o.DATA_FIM_PREVISTA);
      if (!fim && Number(o.DIAS) > 0) fim = _benMaisDias_(ini, Number(o.DIAS) - 1);
      const inss = norm(o.ENCAMINHA_INSS) === 'SIM' && norm(o.STATUS) !== 'ENCERRADO';
      if (!ret && (inss || !fim)) { fim = mesFim; afastAberto = true; } // em aberto no INSS: até o fim do mês
      _benMarcar_(diasAfa, ini, fim, iniEf, fimEf);
    });
    Object.keys(diasFer).forEach(k => { delete diasAfa[k]; }); // mesmo dia em férias e afastamento: conta uma vez
    const descFer = unidade(Object.keys(diasFer).map(_benDe_));
    const descAfa = unidade(Object.keys(diasAfa).map(_benDe_));

    const total = Math.max(0, diasDoMes - descAdm - descResc - descFer - descAfa);
    const fixo = String(regra.TIPO_VALOR).toUpperCase() === 'FIXO';
    const valorRegra = Number(regra.VALOR) || 0;
    linhas.push(Object.assign(base, {
      tipoValor: fixo ? 'FIXO' : 'DIARIO', valorRegra: valorRegra,
      dias: diasDoMes, descAdm: descAdm, descResc: descResc, descFer: descFer, descAfa: descAfa, afastAberto: afastAberto,
      total: total, valor: _benR2_(fixo ? valorRegra * total / diasDoMes : valorRegra * total)
    }));
  });

  linhas.sort((a, b) => a.nome.localeCompare(b.nome));
  fora.sort((a, b) => a.nome.localeCompare(b.nome));
  return {
    competencia: competencia, dias12x36: dias12x36, ufs: resumoUF, linhas: linhas, fora: fora,
    regras: Object.keys(regras).length, geradoEm: Utilities.formatDate(new Date(), DP360.FUSO, 'dd/MM/yyyy HH:mm')
  };
}

function _benR2_(v) { return Math.round(v * 100) / 100; }

/** Faltas digitadas pelo DP (dias), limitadas aos dias pagos da pessoa. Mesma conta do Portal. */
function _benAplicarFaltas_(l, faltas) {
  const fal = Math.min(l.total, Math.max(0, Number((faltas || {})[l.id] || 0)));
  const total = l.total - fal;
  const valor = _benR2_(l.tipoValor === 'FIXO' ? (l.dias ? l.valorRegra * total / l.dias : 0) : l.valorRegra * total);
  return { faltas: fal, total: total, valor: valor };
}

/**
 * Prévia do mês (só leitura): o Portal mostra a tabela, o DP ajusta dias úteis e faltas e gera o pedido.
 * payload: competencia ('MM/AAAA'), diasUteisPorUF (opcional, { RJ: 19, ... })
 */
function beneficiosSimular(user, p) {
  return Object.assign({ ok: true }, _benCalculoMes_(String(p.competencia || '').trim(), p.diasUteisPorUF));
}

/**
 * Grava o PEDIDO do mês a partir do cálculo (o mesmo da prévia), com as faltas digitadas. Se já existe
 * pedido para a mesma competência + fornecedor + tipo, só grava com substituir=true, e aí SUBSTITUI
 * (apaga o anterior): gerar de novo nunca soma duas vezes. Grava também os dias úteis usados.
 * payload: competencia, fornecedor, tipoBeneficio, diasUteisPorUF (opcional), faltas ({ idColaborador: dias }),
 *   numeroPedido (opcional), substituir (bool)
 */
function beneficiosGerarPedido(user, p) {
  const competencia = String(p.competencia || '').trim();
  const fornecedor = String(p.fornecedor || '').toUpperCase().trim();
  if (BEN.FORNECEDORES.indexOf(fornecedor) === -1) throw new Error('Fornecedor inválido.');
  const tipoBeneficio = String(p.tipoBeneficio || '').trim();
  if (!tipoBeneficio) throw new Error('Informe o tipo de benefício.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const R = _benCalculoMes_(competencia, p.diasUteisPorUF);
    const sh = _shBen_();
    _benGarantirColunasLancamentos_(sh);
    const existentes = _benLinhasDoLote_(sh, competencia, fornecedor, tipoBeneficio, 'PEDIDO');
    if (existentes.length && !p.substituir) {
      return { ok: false, precisaConfirmar: true, existente: _benResumoLinhas_(existentes) };
    }

    const h = _headers_(sh);
    const agora = new Date(), email = _normalizarEmail_(user.EMAIL);
    const novas = [];
    let total = 0;
    R.linhas.forEach(l => {
      const f = _benAplicarFaltas_(l, p.faltas);
      if (!(f.valor > 0)) return;
      total += f.valor;
      const linha = {
        ID_LANCAMENTO: 'BEN-' + _uuid_().slice(0, 8).toUpperCase(), COMPETENCIA: competencia, FORNECEDOR: fornecedor,
        TIPO_BENEFICIO: tipoBeneficio, ORIGEM: 'PEDIDO', NUMERO_PEDIDO: String(p.numeroPedido || ''),
        ID_COLABORADOR: l.id, MATRICULA: l.mat, CPF: l.cpf, NOME: l.nome, VALOR: f.valor, ENCONTRADO: 'Sim',
        ARQUIVO_LINK: '', IMPORTADO_POR: email, IMPORTADO_EM: agora,
        DIAS_UTEIS_MES: l.dias, DESCONTO_ADMISSAO: l.descAdm, DESCONTO_FERIAS: l.descFer, DESCONTO_AFASTAMENTO: l.descAfa,
        DESCONTO_RESCISAO: l.descResc, DESCONTO_MANUAL: f.faltas, TOTAL_DIAS: f.total, TIPO_VALOR: l.tipoValor,
        ESCALA_12X36: l.escala ? 'Sim' : 'Não'
      };
      novas.push(h.map(col => (linha[col] === undefined ? '' : linha[col])));
    });
    if (!novas.length) throw new Error('Ninguém com valor a pedir em ' + competencia + '.');

    _benApagarLinhas_(sh, existentes.map(o => o._rowNumber));
    _benCompetenciaComoTexto_(sh);
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, h.length).setValues(novas);
    const usados = {};
    R.ufs.forEach(u => { usados[u.uf] = u.usado; });
    _benGravarDiasUteis_(competencia, usados);

    total = _benR2_(total);
    _auditar_('BEN_PEDIDO_GERADO', user.EMAIL, 'BENEFICIOS.GERAR_PEDIDO', true,
      fornecedor + ' ' + tipoBeneficio + ' ' + competencia + ': ' + novas.length + ' pessoa(s), R$ ' + total +
      (existentes.length ? ' (substituiu ' + existentes.length + ' linha(s))' : ''),
      { competencia: competencia, pessoas: novas.length, total: total, substituiu: existentes.length });
    return {
      ok: true, pessoas: novas.length, total: total, substituiu: existentes.length,
      mensagem: 'Pedido ' + fornecedor + ' ' + tipoBeneficio + ' ' + competencia + ' gravado: ' + novas.length + ' pessoa(s).' +
        (existentes.length ? ' O pedido anterior (' + existentes.length + ' pessoa(s)) foi substituído.' : '')
    };
  } finally {
    lock.releaseLock();
  }
}

/* ---- lotes: achar, resumir, apagar ---- */

function _benLinhasDoLote_(sh, competencia, fornecedor, tipoBeneficio, origem) {
  const up = (s) => String(s || '').trim().toUpperCase();
  return _sheetToObjects_(sh).filter(l => _benComp_(l.COMPETENCIA) === competencia && up(l.FORNECEDOR) === up(fornecedor) &&
    up(l.TIPO_BENEFICIO) === up(tipoBeneficio) && up(l.ORIGEM) === up(origem));
}

function _benResumoLinhas_(objs) {
  let ultimo = null, por = '';
  objs.forEach(o => { const d = o.IMPORTADO_EM instanceof Date ? o.IMPORTADO_EM : null; if (d && (!ultimo || d > ultimo)) { ultimo = d; por = o.IMPORTADO_POR; } });
  return {
    pessoas: objs.length, total: _benR2_(objs.reduce((t, o) => t + Number(o.VALOR || 0), 0)),
    em: ultimo ? Utilities.formatDate(ultimo, DP360.FUSO, 'dd/MM/yyyy HH:mm') : '', por: String(por || '')
  };
}

/** Apaga as linhas (números da planilha) em blocos contíguos, de baixo para cima. */
function _benApagarLinhas_(sh, linhas) {
  const ord = linhas.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < ord.length) {
    let fim = ord[i], ini = fim;
    while (i + 1 < ord.length && ord[i + 1] === ini - 1) { ini = ord[++i]; }
    sh.deleteRows(ini, fim - ini + 1);
    i++;
  }
}

/** Acrescenta no fim da aba as colunas de BEN.COLUNAS_LANCAMENTOS que faltarem (ex.: DESCONTO_ADMISSAO). */
function _benGarantirColunasLancamentos_(sh) {
  const h = _headers_(sh);
  const faltam = BEN.COLUNAS_LANCAMENTOS.filter(c => h.indexOf(c) === -1);
  if (faltam.length) sh.getRange(1, h.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
}

/** Valor em reais: número da planilha, ou texto como "R$ 1.234,56" / "1234.56". null se não der para ler. */
function _benValor_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v == null ? '' : v).replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Linhas de um lote (pedido, relatório...), para a prévia comparar e o Portal recuperar as faltas gravadas. */
function beneficiosLoteLinhas(user, p) {
  const competencia = String(p.competencia || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) throw new Error('Informe a competência no formato MM/AAAA.');
  const objs = _benLinhasDoLote_(_shBen_(), competencia, String(p.fornecedor || ''), String(p.tipoBeneficio || ''), String(p.origem || 'PEDIDO'));
  return {
    ok: true,
    resumo: _benResumoLinhas_(objs),
    linhas: objs.map(o => ({ id: String(o.ID_COLABORADOR || ''), mat: String(o.MATRICULA || ''), cpf: String(o.CPF || ''),
      nome: String(o.NOME || ''), valor: Number(o.VALOR || 0),
      // [2026-10-26] faltas só de pedido gravado pelo cálculo (é ele que preenche DESCONTO_ADMISSAO). No pedido
      // importado da planilha do DP, DESCONTO_MANUAL são os "dias com desconto" dela (férias, demissão...), não faltas.
      faltas: o.DESCONTO_ADMISSAO !== '' && o.DESCONTO_ADMISSAO != null ? Number(o.DESCONTO_MANUAL || 0) : 0 }))
  };
}

/* ============================================================================================ */
/*  ESCOPO, o gestor só consulta a própria equipe                                               */
/* ============================================================================================ */

function _benColaboradoresVisiveis_(user, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && v === 'GLOBAL';

  if (ehGlobal) return _colaboradores_();

  const equipe = _equipeDoGestor_(user.EMAIL);
  return _colaboradores_().filter(c => equipe.indexOf(String(c.ID_COLABORADOR)) > -1);
}

function _benColaboradorPermitido_(user, idColaborador, visao) {
  const c = _benColaboradoresVisiveis_(user, visao).find(x => String(x.ID_COLABORADOR) === String(idColaborador));
  if (!c) throw new Error('Colaborador não encontrado ou fora da sua equipe.');
  return c;
}

/* ============================================================================================ */
/*  NORMALIZAÇÃO DE CHAVES (matrícula/CPF), melhor esforço, nunca falha silenciosamente         */
/* ============================================================================================ */

function _benNormalizarMatricula_(v) {
  const s = String(v || '').trim().replace(/^0+/, '');
  return s || '';
}

function _benNormalizarCPF_(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

/** Índice matrícula/CPF → colaborador, montado uma vez por execução. */
var _CACHE_BEN_INDEX_ = null;

function _benIndiceColaboradores_() {
  if (_CACHE_BEN_INDEX_) return _CACHE_BEN_INDEX_;

  const porMatricula = {};
  const porCPF = {};

  _colaboradores_().forEach(c => {
    const m = _benNormalizarMatricula_(c.MATRICULA);
    if (m) porMatricula[m] = c;

    const cpf = _benNormalizarCPF_(c.CPF);
    if (cpf) porCPF[cpf] = c;
  });

  _CACHE_BEN_INDEX_ = { porMatricula: porMatricula, porCPF: porCPF };
  return _CACHE_BEN_INDEX_;
}

function _benBuscarColaborador_(matricula, cpf) {
  const idx = _benIndiceColaboradores_();

  const m = _benNormalizarMatricula_(matricula);
  if (m && idx.porMatricula[m]) return idx.porMatricula[m];

  const c = _benNormalizarCPF_(cpf);
  if (c && idx.porCPF[c]) return idx.porCPF[c];

  return null;
}

/* ============================================================================================ */
/*  CONTEXTO (gestor) + CONSULTA                                                                 */
/* ============================================================================================ */

function beneficiosContexto(user, p) {
  const time = _benColaboradoresVisiveis_(user, p && p.visao)
    .map(c => ({
      idColaborador: c.ID_COLABORADOR,
      nome: c.NOME,
      matricula: c.MATRICULA,
      departamento: c.DEPARTAMENTO_ATUAL || ''
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  return {
    ok: true,
    modulo: 'BENEFICIOS',
    versao: BEN.VERSAO,
    equipe: time,
    fornecedores: BEN.FORNECEDORES
  };
}

/** Resumo leve pro painel inicial, este módulo não tem "pendências", só consulta. */
function beneficiosResumo(user, p) {
  return beneficiosResumoDe(beneficiosContexto(user, p));
}

function beneficiosResumoDe(ctx) {
  return {
    modulo: 'BENEFICIOS',
    nome: 'Benefícios',
    icone: '🎁',
    contadores: { equipe: ctx.equipe.length },
    precisaDeVoce: [],
    emAndamento: []
  };
}

/**
 * Consulta o que foi CONFIRMADO pelo fornecedor (nunca o "pedido") para um colaborador,
 * num mês ou num período.
 * payload: idColaborador, competenciaInicio ('MM/AAAA'), competenciaFim ('MM/AAAA', opcional ,
 *   se ausente, considera só o mês de competenciaInicio), visao (opcional, uso interno do Portal)
 */
function beneficiosConsultar(user, p) {
  const c = _benColaboradorPermitido_(user, p.idColaborador, p.visao);

  const ini = String(p.competenciaInicio || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(ini)) throw new Error('Informe a competência no formato MM/AAAA.');
  const fim = String(p.competenciaFim || ini).trim();
  if (!/^\d{2}\/\d{4}$/.test(fim)) throw new Error('Competência final inválida (use MM/AAAA).');

  const chave = (mmYyyy) => { const [mm, yyyy] = mmYyyy.split('/'); return yyyy + mm; };
  const chaveIni = chave(ini);
  const chaveFim = chave(fim);

  const todos = _sheetToObjects_(_shBen_())
    .filter(l => String(l.ORIGEM).toUpperCase() === 'RELATORIO')
    .filter(l => String(l.ID_COLABORADOR) === String(c.ID_COLABORADOR))
    .filter(l => {
      const k = chave(_benComp_(l.COMPETENCIA) || '01/1900');
      return k >= chaveIni && k <= chaveFim;
    });

  const porMes = {};
  todos.forEach(l => {
    const comp = _benComp_(l.COMPETENCIA);
    if (!porMes[comp]) porMes[comp] = { competencia: comp, porTipo: {}, total: 0 };
    const tipo = l.TIPO_BENEFICIO || l.FORNECEDOR || 'Outro';
    porMes[comp].porTipo[tipo] = (porMes[comp].porTipo[tipo] || 0) + Number(l.VALOR || 0);
    porMes[comp].total += Number(l.VALOR || 0);
  });

  const detalhePorMes = Object.keys(porMes).sort().map(k => ({
    competencia: porMes[k].competencia,
    total: Math.round(porMes[k].total * 100) / 100,
    porTipo: Object.keys(porMes[k].porTipo).map(t => ({
      tipo: t, valor: Math.round(porMes[k].porTipo[t] * 100) / 100
    }))
  }));

  return {
    ok: true,
    nome: c.NOME,
    matricula: c.MATRICULA,
    departamento: c.DEPARTAMENTO_ATUAL || '',
    periodo: { de: ini, ate: fim },
    detalhePorMes: detalhePorMes,
    totalPeriodo: Math.round(detalhePorMes.reduce((t, m) => t + m.total, 0) * 100) / 100
  };
}

/* ============================================================================================ */
/*  DP, IMPORTAR LOTE + CONCILIAR                                                               */
/* ============================================================================================ */

/**
 * Importa um lote (pedido OU relatório do fornecedor). Basta MATRICULA (ou CPF), NOME e VALOR, em qualquer ordem.
 * [2026-10-21] Duas origens: `linhas` (o Portal lê o arquivo ou o texto colado e confere antes) ou `sheetId`
 * (uma planilha do Google com essas colunas). Valor que não dá para ler BLOQUEIA a importação (antes virava
 * zero, e "R$ 1.234,56" virava zero também). Se o lote já existe (mesma competência, fornecedor, tipo e origem),
 * só grava com substituir=true, e aí SUBSTITUI: importar de novo nunca soma duas vezes.
 * O PDF original do fornecedor pode ir junto, só para arquivar (o link fica em cada linha).
 *
 * payload: competencia ('MM/AAAA'), fornecedor, tipoBeneficio, origem ('PEDIDO'|'RELATORIO'), numeroPedido (opcional),
 *   linhas ([{ matricula, cpf, nome, valor }]) OU sheetId, substituir (bool),
 *   arquivoBase64/arquivoNome/arquivoTipo (opcional)
 */
function beneficiosImportarLote(user, p) {
  const competencia = String(p.competencia || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) throw new Error('Informe a competência no formato MM/AAAA.');

  const fornecedor = String(p.fornecedor || '').toUpperCase().trim();
  if (BEN.FORNECEDORES.indexOf(fornecedor) === -1) throw new Error('Fornecedor inválido.');

  const origem = String(p.origem || '').toUpperCase().trim();
  if (['PEDIDO', 'RELATORIO'].indexOf(origem) === -1) throw new Error('Origem inválida. Use PEDIDO ou RELATORIO.');

  const tipoBeneficio = String(p.tipoBeneficio || '').trim();
  if (!tipoBeneficio) throw new Error('Informe o tipo de benefício (ex.: Alimentação, Mobilidade).');

  const entrada = Array.isArray(p.linhas) ? _benLinhasDoPayload_(p.linhas) : _benLinhasDaPlanilha_(p.sheetId);
  if (!entrada.length) throw new Error('Nenhuma linha com nome para importar.');
  const ilegiveis = entrada.filter(l => l.valor === null);
  if (ilegiveis.length) {
    throw new Error('Valor que não deu para ler em ' + ilegiveis.length + ' linha(s): ' +
      ilegiveis.slice(0, 5).map(l => 'linha ' + l.n + ' (' + l.nome + ': "' + l.bruto + '")').join(', ') +
      '. Corrija na planilha e importe de novo; o sistema não troca por zero.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = _shBen_();
    _benGarantirColunasLancamentos_(sh);
    const existentes = _benLinhasDoLote_(sh, competencia, fornecedor, tipoBeneficio, origem);
    if (existentes.length && !p.substituir) {
      return { ok: false, precisaConfirmar: true, existente: _benResumoLinhas_(existentes) };
    }

    // arquiva o PDF do fornecedor (opcional), um link só para o lote inteiro
    let arquivoLink = '';
    if (p.arquivoBase64) {
      try {
        const bytes = Utilities.base64Decode(p.arquivoBase64);
        const blob = Utilities.newBlob(bytes, p.arquivoTipo || 'application/pdf',
          p.arquivoNome || ('beneficio_' + fornecedor + '_' + competencia.replace('/', '-') + '.pdf'));
        const raizId = _feriasParam_('AFAST_DRIVE_PASTA_ID', '');
        const arquivo = raizId ? DriveApp.getFolderById(raizId).createFile(blob) : DriveApp.createFile(blob);
        _compartilharSoDominio_(arquivo); // [FIX 2026-09-28] antes: qualquer pessoa com o link
        arquivoLink = arquivo.getUrl();
      } catch (e) {
        console.error('Falha ao arquivar o PDF do lote (seguindo sem arquivo): ' + e);
      }
    }

    const h = _headers_(sh);
    const agora = new Date(), email = _normalizarEmail_(user.EMAIL);
    const linhas = [];
    let encontrados = 0, total = 0;
    const naoEncontrados = [];
    entrada.forEach(l => {
      const colab = _benBuscarColaborador_(l.matricula, l.cpf);
      if (colab) encontrados++; else naoEncontrados.push(l.nome);
      total += l.valor;
      const linha = {
        ID_LANCAMENTO: 'BEN-' + _uuid_().slice(0, 8).toUpperCase(), COMPETENCIA: competencia, FORNECEDOR: fornecedor,
        TIPO_BENEFICIO: tipoBeneficio, ORIGEM: origem, NUMERO_PEDIDO: String(p.numeroPedido || ''),
        ID_COLABORADOR: colab ? colab.ID_COLABORADOR : '', MATRICULA: colab ? colab.MATRICULA : l.matricula,
        CPF: colab ? colab.CPF : l.cpf, NOME: colab ? colab.NOME : l.nome, VALOR: _benR2_(l.valor),
        ENCONTRADO: colab ? 'Sim' : 'Não', ARQUIVO_LINK: arquivoLink, IMPORTADO_POR: email, IMPORTADO_EM: agora
      };
      linhas.push(h.map(col => (linha[col] === undefined ? '' : linha[col])));
    });

    _benApagarLinhas_(sh, existentes.map(o => o._rowNumber));
    _benCompetenciaComoTexto_(sh);
    sh.getRange(sh.getLastRow() + 1, 1, linhas.length, h.length).setValues(linhas);

    _auditar_('BEN_LOTE_IMPORTADO', user.EMAIL, 'BENEFICIOS.IMPORTAR_LOTE', true,
      fornecedor + ' ' + tipoBeneficio + ' ' + origem + ' ' + competencia + ': ' + linhas.length + ' linha(s)' +
      (existentes.length ? ' (substituiu ' + existentes.length + ')' : ''),
      { competencia: competencia, fornecedor: fornecedor, origem: origem, encontrados: encontrados,
        naoEncontrados: naoEncontrados.length, substituiu: existentes.length });

    return {
      ok: true,
      totalImportado: linhas.length,
      total: _benR2_(total),
      encontrados: encontrados,
      naoEncontrados: naoEncontrados.length,
      exemplosNaoEncontrados: naoEncontrados.slice(0, 10),
      substituiu: existentes.length,
      arquivoLink: arquivoLink,
      mensagem: linhas.length + ' linha(s) importada(s)' +
        (naoEncontrados.length ? ', ' + naoEncontrados.length + ' sem colaborador encontrado (confira matrícula/CPF)' : '') +
        (existentes.length ? '. O lote anterior (' + existentes.length + ' linha(s)) foi substituído.' : '.')
    };
  } finally {
    lock.releaseLock();
  }
}

/** Linhas que o Portal mandou (já conferidas na tela). */
function _benLinhasDoPayload_(lista) {
  return lista.map((l, i) => {
    const bruto = l && l.valor;
    return { n: i + 2, matricula: String((l && l.matricula) || '').trim(), cpf: String((l && l.cpf) || '').trim(),
      nome: String((l && l.nome) || '').trim(), valor: _benValor_(bruto), bruto: String(bruto == null ? '' : bruto) };
  }).filter(l => l.nome);
}

/** Linhas de uma planilha do Google (primeira aba) com MATRICULA ou CPF, NOME e VALOR. */
function _benLinhasDaPlanilha_(sheetId) {
  if (!sheetId) throw new Error('Mande as linhas ou o ID da planilha (MATRICULA/CPF, NOME, VALOR).');
  const dados = SpreadsheetApp.openById(sheetId).getSheets()[0].getDataRange().getValues();
  const header = dados[0].map(h => String(h || '').trim().toUpperCase());
  const acharCol = (candidatos) => { for (let i = 0; i < candidatos.length; i++) { const x = header.indexOf(candidatos[i]); if (x > -1) return x; } return -1; };
  const colMatricula = acharCol(['MATRICULA', 'MATRÍCULA']);
  const colCPF = acharCol(['CPF']);
  const colNome = acharCol(['NOME', 'COLABORADOR']);
  const colValor = acharCol(['VALOR', 'VALOR DA CARGA']);
  if (colMatricula === -1 && colCPF === -1) throw new Error('A planilha precisa ter a coluna MATRICULA ou CPF.');
  if (colNome === -1) throw new Error('A planilha precisa ter a coluna NOME.');
  if (colValor === -1) throw new Error('A planilha precisa ter a coluna VALOR.');
  const out = [];
  for (let r = 1; r < dados.length; r++) {
    const nome = String(dados[r][colNome] || '').trim();
    if (!nome) continue;
    out.push({ n: r + 1, matricula: colMatricula > -1 ? String(dados[r][colMatricula] || '').trim() : '',
      cpf: colCPF > -1 ? String(dados[r][colCPF] || '').trim() : '', nome: nome,
      valor: _benValor_(dados[r][colValor]), bruto: String(dados[r][colValor]) });
  }
  return out;
}

/**
 * Compara PEDIDO x RELATORIO de uma competência+fornecedor(+tipo opcional).
 * Não grava nada, é só um relatório de conferência.
 * [2026-10-21] Casa pela matrícula (antes pelo ID ou pelo nome: quem não estava no cadastro numa das pontas
 * aparecia como faltando nas duas) e devolve os totais.
 * payload: competencia, fornecedor, tipoBeneficio (opcional, se ausente, olha todos os tipos)
 */
function beneficiosConciliar(user, p) {
  const competencia = String(p.competencia || '').trim();
  if (!/^\d{2}\/\d{4}$/.test(competencia)) throw new Error('Informe a competência no formato MM/AAAA.');

  const fornecedor = String(p.fornecedor || '').toUpperCase().trim();
  if (BEN.FORNECEDORES.indexOf(fornecedor) === -1) throw new Error('Fornecedor inválido.');

  const tipoBeneficio = String(p.tipoBeneficio || '').trim();
  const up = (s) => String(s || '').trim().toUpperCase();

  const todos = _sheetToObjects_(_shBen_()).filter(l =>
    _benComp_(l.COMPETENCIA) === competencia &&
    up(l.FORNECEDOR) === fornecedor &&
    (!tipoBeneficio || up(l.TIPO_BENEFICIO) === up(tipoBeneficio))
  );

  const pedidos = todos.filter(l => up(l.ORIGEM) === 'PEDIDO');
  const relatorios = todos.filter(l => up(l.ORIGEM) === 'RELATORIO');

  const porChave = (l) => {
    const m = String(l.MATRICULA || '').replace(/\D/g, '').replace(/^0+/, '');
    return m ? 'M:' + m : (l.ID_COLABORADOR ? 'I:' + l.ID_COLABORADOR : 'N:' + up(l.NOME));
  };

  const mapaRelatorio = {};
  relatorios.forEach(l => { mapaRelatorio[porChave(l)] = l; });

  const mapaPedido = {};
  pedidos.forEach(l => { mapaPedido[porChave(l)] = l; });

  const pedidosSemRelatorio = pedidos
    .filter(l => !mapaRelatorio[porChave(l)])
    .map(l => ({ nome: l.NOME, matricula: l.MATRICULA, valorPedido: Number(l.VALOR || 0) }));

  const relatorioSemPedido = relatorios
    .filter(l => !mapaPedido[porChave(l)])
    .map(l => ({ nome: l.NOME, matricula: l.MATRICULA, valorConfirmado: Number(l.VALOR || 0), encontrado: up(l.ENCONTRADO) === 'SIM' }));

  const divergenciasValor = pedidos
    .filter(l => mapaRelatorio[porChave(l)] && Math.abs(Number(l.VALOR || 0) - Number(mapaRelatorio[porChave(l)].VALOR || 0)) > 0.01)
    .map(l => ({
      nome: l.NOME, matricula: l.MATRICULA,
      valorPedido: Number(l.VALOR || 0),
      valorConfirmado: Number(mapaRelatorio[porChave(l)].VALOR || 0)
    }));

  return {
    ok: true,
    competencia: competencia,
    fornecedor: fornecedor,
    tipoBeneficio: tipoBeneficio || '(todos)',
    totalPedidos: pedidos.length,
    totalRelatorio: relatorios.length,
    pedido: _benResumoLinhas_(pedidos),
    relatorio: _benResumoLinhas_(relatorios),
    batem: pedidos.length - pedidosSemRelatorio.length - divergenciasValor.length,
    pedidosSemRelatorio: pedidosSemRelatorio,
    relatorioSemPedido: relatorioSemPedido,
    divergenciasValor: divergenciasValor,
    tudoConferido: (pedidosSemRelatorio.length === 0 && relatorioSemPedido.length === 0 && divergenciasValor.length === 0)
  };
}

/** Lista os lotes já importados (agrupado), para o DP saber o que já entrou no sistema. */
function beneficiosListarLotes(user, p) {
  const todos = _sheetToObjects_(_shBen_());
  const porLote = {};

  todos.forEach(l => {
    const comp = _benComp_(l.COMPETENCIA);
    const chave = [comp, l.FORNECEDOR, l.TIPO_BENEFICIO, l.ORIGEM].join('|');
    if (!porLote[chave]) {
      porLote[chave] = {
        competencia: comp, fornecedor: l.FORNECEDOR, tipoBeneficio: l.TIPO_BENEFICIO,
        origem: l.ORIGEM, total: 0, pessoas: 0, arquivoLink: l.ARQUIVO_LINK || '', _linhas: []
      };
    }
    porLote[chave].total += Number(l.VALOR || 0);
    porLote[chave].pessoas++;
    porLote[chave]._linhas.push(l);
  });

  const lista = Object.keys(porLote).map(k => {
    const x = porLote[k], r = _benResumoLinhas_(x._linhas);
    delete x._linhas;
    x.total = _benR2_(x.total); x.em = r.em; x.por = r.por;
    return x;
  }).sort((a, b) => String(b.competencia).slice(3).localeCompare(String(a.competencia).slice(3)) || String(b.competencia).localeCompare(String(a.competencia)));

  return { ok: true, lotes: lista };
}

// datas aqui são sempre meio-dia no fuso do projeto (_dataF_), então dá para montar a chave direto
function _benIso_(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
function _benBr_(dt) { const i = _benIso_(dt).split('-'); return i[2] + '/' + i[1] + '/' + i[0]; }
function _benDe_(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); }
function _benMaisDias_(dt, n) { const x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12, 0, 0); x.setDate(x.getDate() + n); return x; }
/** Lista de dias (Date) de a até b, inclusive. */
function _benDias_(a, b) { const out = []; for (let x = _benMaisDias_(a, 0); x <= b; x = _benMaisDias_(x, 1)) out.push(x); return out; }
/** Marca em `mapa` (chave aaaa-mm-dd) os dias de [ini,fim] que caem dentro de [lim1,lim2]. */
function _benMarcar_(mapa, ini, fim, lim1, lim2) {
  if (!ini || !fim) return;
  const a = ini > lim1 ? ini : lim1, b = fim < lim2 ? fim : lim2;
  if (b < a) return;
  _benDias_(a, b).forEach(dt => { mapa[_benIso_(dt)] = true; });
}

/** Feriados de um ano: nacionais (inclui Sexta-feira Santa, pela Páscoa) e estaduais conhecidos. */
var _CACHE_BEN_FERIADOS_ = {};
function _benFeriados_(ano, uf) {
  const k = ano + '|' + uf;
  if (_CACHE_BEN_FERIADOS_[k]) return _CACHE_BEN_FERIADOS_[k];
  const f = {};
  const add = (m, d, nome) => { f[ano + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')] = nome; };
  add(1, 1, 'Confraternização Universal'); add(4, 21, 'Tiradentes'); add(5, 1, 'Dia do Trabalho');
  add(9, 7, 'Independência'); add(10, 12, 'Nossa Senhora Aparecida'); add(11, 2, 'Finados');
  add(11, 15, 'Proclamação da República'); add(11, 20, 'Consciência Negra'); add(12, 25, 'Natal');
  // Páscoa (algoritmo de Meeus) → Sexta-feira Santa
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const g = Math.floor((8 * b + 13) / 25), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), kk = c % 4;
  const l = (32 + 2 * e + 2 * i - h - kk) % 7, m = Math.floor((a + 11 * h + 19 * l) / 433);
  const mes = Math.floor((h + l - 7 * m + 90) / 25), dia = (h + l - 7 * m + 33 * mes + 19) % 32;
  const sexta = _benMaisDias_(new Date(ano, mes - 1, dia, 12), -2);
  add(sexta.getMonth() + 1, sexta.getDate(), 'Sexta-feira Santa');
  if (uf === 'RJ') add(4, 23, 'São Jorge (RJ)');
  if (uf === 'SP') add(7, 9, 'Revolução Constitucionalista (SP)');
  _CACHE_BEN_FERIADOS_[k] = f;
  return f;
}
function _benEhUtil_(dt, uf) {
  const w = dt.getDay();
  return w !== 0 && w !== 6 && !_benFeriados_(dt.getFullYear(), uf)[_benIso_(dt)];
}
function _benUteis_(ini, fim, uf) { return _benDias_(ini, fim).filter(dt => _benEhUtil_(dt, uf)).length; }
function _benFeriadosDoMes_(ini, fim, uf) {
  return _benDias_(ini, fim)
    .filter(dt => dt.getDay() !== 0 && dt.getDay() !== 6 && _benFeriados_(dt.getFullYear(), uf)[_benIso_(dt)])
    .map(dt => ({ dia: _benBr_(dt), nome: _benFeriados_(dt.getFullYear(), uf)[_benIso_(dt)] }));
}

/* ============================================================================================ */
/*  SETUP + DIAGNÓSTICO                                                                          */
/* ============================================================================================ */

function beneficiosSetup() {
  const r1 = garantirAbaBeneficios();
  const r2 = semearPermissoesBeneficios();
  const r3 = garantirAbaRegras();
  const r4 = garantirAbaDiasUteis();
  const msg = 'BENEFÍCIOS pronto.\n- ' + r1 + '\n- ' + r2 + '\n- ' + r3 + '\n- ' + r4 +
    '\n\nAplique os 2 patches de kernel (Codigo.gs e FERIAS.gs, no fim deste arquivo), ' +
    'adicione BENEFICIOS na coluna MODULOS dos usuários do DP, e depois:' +
    '\n1) beneficiosImportarRegras({sheetId:"..."}), a matriz de departamentos' +
    '\n2) beneficiosDefinirDiasUteis({competencia:"MM/AAAA", diasUteisPorUF:{PADRAO:19, SP:20}}), todo mês';
  console.log(msg);
  return msg;
}

function semearPermissoesBeneficios() {
  const ss = _configSS_();
  const sh = ss.getSheetByName(DP360.SHEETS.PERMISSOES);
  if (!sh) throw new Error('Aba PERMISSOES não encontrada. Rode setupDP360() primeiro.');

  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh).map(r => String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  const novas = [
    ['GESTOR', 'BENEFICIOS.CONTEXTO', 'Sim', 'PROPRIO', 'Consultar benefícios da própria equipe.'],
    ['GESTOR', 'BENEFICIOS.CONSULTAR', 'Sim', 'PROPRIO', 'Consultar benefícios da própria equipe.'],
    ['DP', 'BENEFICIOS.*', 'Sim', 'GLOBAL', 'Importar, conciliar e consultar benefícios.']
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

function diagnosticarBeneficios() {
  const sh = _ssBen_().getSheetByName(BEN.ABA_LANCAMENTOS);
  const lancamentos = sh ? _sheetToObjects_(sh) : [];

  const shRegras = _ssBen_().getSheetByName(BEN.ABA_REGRAS);
  const regras = shRegras ? _sheetToObjects_(shRegras) : [];

  const shDias = _ssBen_().getSheetByName(BEN.ABA_DIAS_UTEIS);
  const diasUteis = shDias ? _sheetToObjects_(shDias) : [];

  const out = {
    versao: BEN.VERSAO,
    abaExiste: !!sh,
    lancamentosRegistrados: lancamentos.length,
    porFornecedor: {},
    porOrigem: {},
    naoEncontrados: lancamentos.filter(l => String(l.ENCONTRADO).toUpperCase() !== 'SIM').length,
    regrasCadastradas: regras.length,
    regrasPorTipo: {},
    competenciasComDiasUteis: Array.from(new Set(diasUteis.map(d => d.COMPETENCIA)))
  };

  lancamentos.forEach(l => {
    out.porFornecedor[l.FORNECEDOR] = (out.porFornecedor[l.FORNECEDOR] || 0) + 1;
    out.porOrigem[l.ORIGEM] = (out.porOrigem[l.ORIGEM] || 0) + 1;
  });
  regras.forEach(r => { out.regrasPorTipo[r.TIPO_VALOR] = (out.regrasPorTipo[r.TIPO_VALOR] || 0) + 1; });

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ============================================================================================ */
/*  PATCHES PRONTOS PARA COLAR NO KERNEL                                                         */
/* ============================================================================================ */

/*
--- Codigo.gs, dentro de _modulosDisponiveis_() ---

  if (typeof beneficiosResumo === 'function') {
    m.BENEFICIOS = {
      nome: 'Benefícios',
      permissao: 'BENEFICIOS.CONTEXTO',
      resumo: beneficiosResumo,
      resumoDe: beneficiosResumoDe,
      contexto: beneficiosContexto
    };
  }

--- FERIAS.gs, dentro de executar(), logo após o bloco de MOVIMENTACAO.* ---

  if (acao.indexOf('BENEFICIOS.') === 0 && typeof beneficiosExecutar === 'function') {
    return beneficiosExecutar(acao, payload || {}, user);
  }
*/