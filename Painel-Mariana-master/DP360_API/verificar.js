/**
 * Encontra períodos duplicados na aba PERIODOS: mesma pessoa (ID_COLABORADOR) com o MESMO
 * período aquisitivo (mesmo AQUIS_INICIO). Não apaga nada — só diagnostica, e mostra quantas
 * solicitações cada linha duplicada tem vinculada (importante pra decidir qual manter).
 */
function diagnosticarPeriodosDuplicados() {
  const periodos = _periodos_();
  const sols = _solicitacoes_();

  const grupos = {};
  periodos.forEach(p => {
    const chave = String(p.ID_COLABORADOR) + '_' + _isoF_(p.AQUIS_INICIO);
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(p);
  });

  const duplicados = [];

  Object.keys(grupos).forEach(chave => {
    const grupo = grupos[chave];
    if (grupo.length < 2) return;

    const linhas = grupo.map(p => {
      const solsDoPeriodo = sols.filter(s => String(s.ID_PERIODO) === String(p.ID_PERIODO));
      return {
        idPeriodo: p.ID_PERIODO,
        linha: p._rowNumber,
        status: p.STATUS,
        aquisInicio: _fmtBRF_(p.AQUIS_INICIO),
        aquisFim: _fmtBRF_(p.AQUIS_FIM),
        diasDireito: p.DIAS_DIREITO,
        diasGozadosAnteriores: p.DIAS_GOZADOS_ANTERIORES,
        qtdSolicitacoesVinculadas: solsDoPeriodo.length,
        idsSolicitacoes: solsDoPeriodo.map(s => s.ID_SOLICITACAO)
      };
    });

    duplicados.push({
      nome: grupo[0].NOME,
      idColaborador: grupo[0].ID_COLABORADOR,
      quantidade: grupo.length,
      periodos: linhas
    });
  });

  duplicados.sort((a, b) => a.nome.localeCompare(b.nome));

  const resultado = {
    totalPeriodos: periodos.length,
    totalPessoasComDuplicata: duplicados.length,
    duplicados: duplicados
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}