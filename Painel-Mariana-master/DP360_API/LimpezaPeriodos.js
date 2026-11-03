/**
 * VINCULO ID_COLABORADOR / ID_PERIODO NA ABA PERIODOS
 * ---------------------------------------------------------------------------
 * PERIODOS so tem MATRICULA - nao tem ID_COLABORADOR nem ID_PERIODO. O codigo
 * (antigo e novo) espera esses dois campos prontos em cada linha. Este script
 * preenche os dois, gravando na planilha (nao recalcula na hora, pra nao gerar
 * um ID diferente a cada execucao).
 *
 * ID_COLABORADOR: cruza MATRICULA (normalizada, tira zero a esquerda) com a
 * aba COLABORADORES da DP360_MASTER.
 *
 * ID_PERIODO: tenta RECUPERAR o ID que ja existe numa solicitacao antiga dessa
 * pessoa cuja DATA_INICIO cai dentro da janela deste periodo (AQUIS_INICIO ate
 * CONCEDER_ATE) - isso preserva o vinculo de pedidos ja feitos. Se nao achar
 * nenhuma solicitacao correspondente, gera um ID novo (mesmo padrao ja usado
 * em outro lugar do codigo: 'PER-' + uuid).
 *
 * RODE DEPOIS de limparDuplicatasPeriodos() (LimpezaPeriodos.js) - com a aba
 * ja sem duplicata, o vinculo fica mais rapido e sem ambiguidade.
 *
 * COMO USAR:
 *   1) diagnosticarVinculoPeriodos() - so mostra o que faria, nao grava nada.
 *   2) Confere os numeros no log (principalmente "colaborador nao encontrado").
 *   3) vincularPeriodosComColaboradores() - faz backup e grava de verdade.
 * ---------------------------------------------------------------------------
 */

function _colaboradorPorMatriculaFerias_() {
  var mapa = {};
  _colaboradores_().forEach(function (c) {
    var m = _normalizarMatricula_(c.MATRICULA);
    if (m && !mapa[m]) mapa[m] = c;
  });
  return mapa;
}

/** Para cada ID_COLABORADOR, lista {idPeriodo, dataInicio} vindos de SOLICITACOES existentes. */
function _idsPeriodoRecuperaveisPorColaborador_() {
  var porColaborador = {};
  _solicitacoes_().forEach(function (s) {
    var idPeriodo = String(s.ID_PERIODO || '').trim();
    var idColaborador = String(s.ID_COLABORADOR || '').trim();
    var dataInicio = s.DATA_INICIO;
    if (!idPeriodo || !idColaborador || !(dataInicio instanceof Date)) return;
    if (!porColaborador[idColaborador]) porColaborador[idColaborador] = [];
    porColaborador[idColaborador].push({ idPeriodo: idPeriodo, dataInicio: dataInicio });
  });
  return porColaborador;
}

function _prepararVinculoPeriodos_() {
  var sh = _shFerias_(FERIAS.ABAS.PERIODOS);
  var headers = _headers_(sh);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  var idxMatricula = headers.indexOf('MATRICULA');
  var idxAquisInicio = headers.indexOf('AQUIS_INICIO');
  var idxAquisFim = headers.indexOf('AQUIS_FIM');
  var idxConcederAte = headers.indexOf('CONCEDER_ATE');

  var mapaColab = _colaboradorPorMatriculaFerias_();
  var idsPorColaborador = _idsPeriodoRecuperaveisPorColaborador_();

  var idColaboradorPorLinha = new Array(values.length).fill('');
  var idPeriodoPorLinha = new Array(values.length).fill('');

  var resumo = {
    totalLinhas: values.length,
    vaziasOuSemMatricula: 0,
    colaboradorNaoEncontrado: 0,
    colaboradorNaoEncontradoExemplos: [],
    idPeriodoRecuperado: 0,
    idPeriodoNovo: 0,
    vinculadas: 0
  };

  values.forEach(function (row, i) {
    var vazia = row.every(function (v) { return v === '' || v === null; });
    if (vazia) return;

    var matricula = _normalizarMatricula_(row[idxMatricula]);
    if (!matricula) { resumo.vaziasOuSemMatricula++; return; }

    var colab = mapaColab[matricula];
    if (!colab) {
      resumo.colaboradorNaoEncontrado++;
      if (resumo.colaboradorNaoEncontradoExemplos.length < 15) {
        resumo.colaboradorNaoEncontradoExemplos.push({ linha: i + 2, matricula: row[idxMatricula] });
      }
      return;
    }

    var idColaborador = String(colab.ID_COLABORADOR);
    var aquisInicio = row[idxAquisInicio];
    var limite = row[idxConcederAte] || row[idxAquisFim];

    var candidatos = idsPorColaborador[idColaborador] || [];
    var melhorCandidato = null;
    candidatos.forEach(function (c) {
      if (!(aquisInicio instanceof Date)) return;
      if (c.dataInicio.getTime() < aquisInicio.getTime()) return;
      if (limite instanceof Date && c.dataInicio.getTime() > limite.getTime()) return;
      if (!melhorCandidato || c.dataInicio.getTime() < melhorCandidato.dataInicio.getTime()) {
        melhorCandidato = c;
      }
    });

    var idPeriodo;
    if (melhorCandidato) {
      idPeriodo = melhorCandidato.idPeriodo;
      resumo.idPeriodoRecuperado++;
    } else {
      idPeriodo = 'PER-' + _uuid_().slice(0, 8).toUpperCase();
      resumo.idPeriodoNovo++;
    }

    idColaboradorPorLinha[i] = idColaborador;
    idPeriodoPorLinha[i] = idPeriodo;
    resumo.vinculadas++;
  });

  return {
    sh: sh,
    headers: headers,
    totalDataRows: values.length,
    idColaboradorPorLinha: idColaboradorPorLinha,
    idPeriodoPorLinha: idPeriodoPorLinha,
    resumo: resumo
  };
}

/** MODO SEGURO: so mostra o que faria. Nao grava nada na planilha. */
function diagnosticarVinculoPeriodos() {
  var r = _prepararVinculoPeriodos_();
  var s = r.resumo;

  console.log('Total de linhas de dados: ' + s.totalLinhas);
  console.log('Vazias ou sem matricula: ' + s.vaziasOuSemMatricula);
  console.log('Colaborador NAO encontrado na MASTER: ' + s.colaboradorNaoEncontrado);
  console.log('Linhas que SERIAM vinculadas: ' + s.vinculadas);
  console.log('  - ID_PERIODO recuperado de solicitacao existente: ' + s.idPeriodoRecuperado);
  console.log('  - ID_PERIODO novo gerado: ' + s.idPeriodoNovo);

  if (s.colaboradorNaoEncontradoExemplos.length) {
    console.log('Exemplos sem colaborador correspondente na MASTER:');
    s.colaboradorNaoEncontradoExemplos.forEach(function (e) {
      console.log('  linha ' + e.linha + ': matricula="' + e.matricula + '"');
    });
  }

  return s;
}

/** GRAVA DE VERDADE. Faz backup da aba inteira antes de escrever as colunas novas. */
function vincularPeriodosComColaboradores() {
  var r = _prepararVinculoPeriodos_();
  var s = r.resumo;

  if (s.colaboradorNaoEncontrado > 0) {
    console.log('AVISO: ' + s.colaboradorNaoEncontrado + ' linha(s) sem colaborador correspondente na ' +
      'MASTER - ficarao SEM ID_COLABORADOR/ID_PERIODO (nao aparecem pro gestor ate a matricula ser ' +
      'corrigida). Rode diagnosticarVinculoPeriodos() para ver quais.');
  }

  var ss = _ssFerias_();
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  var backup = r.sh.copyTo(ss);
  backup.setName('PERIODOS_BACKUP_PREVINCULO_' + agora);

  var headers = r.headers;
  var faltando = ['ID_COLABORADOR', 'ID_PERIODO'].filter(function (c) { return headers.indexOf(c) === -1; });

  if (faltando.length) {
    var col = r.sh.getLastColumn();
    if (r.sh.getMaxColumns() < col + faltando.length) {
      r.sh.insertColumnsAfter(r.sh.getMaxColumns(), col + faltando.length - r.sh.getMaxColumns());
    }
    faltando.forEach(function (nome, i) { r.sh.getRange(1, col + 1 + i).setValue(nome); });
    headers = _headers_(r.sh);
  }

  var idxIdColaborador = headers.indexOf('ID_COLABORADOR');
  var idxIdPeriodo = headers.indexOf('ID_PERIODO');

  if (r.totalDataRows > 0) {
    r.sh.getRange(2, idxIdColaborador + 1, r.totalDataRows, 1)
      .setValues(r.idColaboradorPorLinha.map(function (v) { return [v]; }));
    r.sh.getRange(2, idxIdPeriodo + 1, r.totalDataRows, 1)
      .setValues(r.idPeriodoPorLinha.map(function (v) { return [v]; }));
  }

  _invalidarCacheFerias_();

  var msg = 'Vinculo concluido. Backup: ' + backup.getName() +
    ' | linhas vinculadas: ' + s.vinculadas +
    ' | ID_PERIODO recuperado: ' + s.idPeriodoRecuperado +
    ' | ID_PERIODO novo: ' + s.idPeriodoNovo +
    ' | sem colaborador na MASTER: ' + s.colaboradorNaoEncontrado;
  console.log(msg);

  return { ok: true, backup: backup.getName(), resumo: s };
}
