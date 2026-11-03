/**
 * Corrige em lote todas as duplicatas geradas pela importação histórica que rodou 2 vezes.
 * Para cada par de solicitações DEFERIDA com as mesmas datas, presas a períodos diferentes:
 * mantém a que está presa ao período cujo AQUIS_FIM já tinha passado quando as férias
 * começaram (a correta, legalmente válida), e anula a outra (o aquisitivo ainda não tinha
 * terminado na data do gozo — foi um engano da importação em duplicidade).
 * Rode diagnosticarDuplicatasImportacao() primeiro pra conferir, se quiser, antes desta.
 */
function corrigirTodasDuplicatasImportacao() {
  const nomes = [
    "ALINE AMARAL PAGLIASSE","BIANCA CARVALHO DA SILVA","BRAYNER RODRIGUES OLIVEIRA",
    "CARLOS AUGUSTO DO NASCIMENTO JUNIOR","CARLOS VINICIUS DE SOUZA BARROS","CASSIO VIEIRA DO NASCIMENTO",
    "EDIO DE PAULA RIBEIRO NETO","FABIO SILVA DOS ANJOS","GABRIEL DA SILVA",
    "GABRIEL DE OLIVEIRA CONTINI PEREIRA","GEOVANA MATHIAS SILVA DE PAULA","GISELE LESSA BERNIZ BELMONT",
    "JANAINA LINS DA SILVA","JASMIM ALVES ALMEIDA","LUIS GUSTAVO DE ALMEIDA DVORANINOVIER",
    "MARCELO BARROS MENESES","MARCIA CRISTINA DE OLIVEIRA",
    "MARIA CLARA DOS SANTOS DA SILVA","MAYSA MORAES RODRIGUES","MONICA DOS SANTOS SILVA DE ASSIS",
    "PAULO CESAR SOARES","PEDRO HENRIQUE ARRUDA LINS SOBREIRA","RAFAELA CARDOSO SEABRA",
    "RICARDO RUIZ CRUZ","SAMIRA MARIA DE CARVALHO LEITE","SAMUEL DA SILVA SANTOS",
    "SELMA AGUIAR DA CAMARA","SERGIO ANTONIO DOS SANTOS PEREIRA","SIMONI SANTOS DE SOUSA",
    "VANDER CARVALHO DE CASTRO","VICTORIA MACHADO DOS SANTOS","YASMIN GOMES NASCIMENTO"
    // MARCELO LIMA GONCALVES fica de fora — já foi corrigido manualmente antes
  ];

  const colaboradores = _colaboradores_();
  const periodos = _periodos_();
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const sols = _sheetToObjects_(sh);

  const corrigidos = [];
  const semCertezaQual = []; // casos que precisam de olho humano

  nomes.forEach(nome => {
    const colab = colaboradores.find(c => String(c.NOME || '').toUpperCase().trim() === nome);
    if (!colab) return;

    const solsDele = sols.filter(s =>
      String(s.ID_COLABORADOR) === String(colab.ID_COLABORADOR) &&
      String(s.STATUS).toUpperCase() === 'DEFERIDA');

    const porData = {};
    solsDele.forEach(s => {
      const chave = _isoF_(s.DATA_INICIO) + '_' + _isoF_(s.DATA_FIM);
      if (!porData[chave]) porData[chave] = [];
      porData[chave].push(s);
    });

    Object.keys(porData).forEach(chave => {
      const grupo = porData[chave];
      const idsPeriodo = [...new Set(grupo.map(s => String(s.ID_PERIODO)))];
      if (grupo.length < 2 || idsPeriodo.length < 2) return; // não é duplicata

      const inicioFerias = _dataF_(grupo[0].DATA_INICIO);

      // pra cada solicitação do grupo, acha o período dela e verifica se o aquisitivo
      // já tinha terminado antes do início das férias (== válido)
      const avaliadas = grupo.map(s => {
        const per = periodos.find(p => String(p.ID_PERIODO) === String(s.ID_PERIODO));
        const aquisFim = per ? _dataF_(per.AQUIS_FIM) : null;
        const valido = aquisFim && aquisFim < inicioFerias;
        return { sol: s, aquisFim: aquisFim, valido: valido };
      });

      const validas = avaliadas.filter(a => a.valido);

      if (validas.length === 1) {
        // caso normal: exatamente uma é válida — mantém ela, anula as outras
        avaliadas.forEach(a => {
          if (a.sol.ID_SOLICITACAO === validas[0].sol.ID_SOLICITACAO) return;
          _atualizarLinha_(sh, a.sol._rowNumber, h, {
            STATUS: 'CANCELADA',
            DECIDIDO_POR: 'correcao-manual@sistema',
            DECIDIDO_EM: new Date(),
            MOTIVO: 'Registro duplicado da importação histórica (rodou 2x) — mantida ' + validas[0].sol.ID_SOLICITACAO + '.'
          });
        });
        corrigidos.push({
          nome: nome, datas: chave,
          mantida: validas[0].sol.ID_SOLICITACAO,
          anuladas: avaliadas.filter(a => a.sol.ID_SOLICITACAO !== validas[0].sol.ID_SOLICITACAO).map(a => a.sol.ID_SOLICITACAO)
        });
      } else {
        // 0 válidas ou mais de 1 válida — ambíguo, não mexe sozinho
        semCertezaQual.push({ nome: nome, datas: chave, opcoes: avaliadas.map(a => ({ id: a.sol.ID_SOLICITACAO, idPeriodo: a.sol.ID_PERIODO, aquisFim: a.aquisFim ? _fmtBRF_(a.aquisFim) : null, valido: a.valido })) });
      }
    });
  });

  _invalidarCacheFerias_();

  const resultado = {
    corrigidosAutomaticamente: corrigidos.length,
    detalheCorrigidos: corrigidos,
    precisamDeOlhoHumano: semCertezaQual
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}