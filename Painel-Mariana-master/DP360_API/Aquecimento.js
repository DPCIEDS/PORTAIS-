/** Lista todos os gatilhos do projeto, agrupados por função, mostrando se tem duplicata. */
function listarGatilhosComDuplicatas() {
  const gatilhos = ScriptApp.getProjectTriggers();
  const porFuncao = {};

  gatilhos.forEach(t => {
    const fn = t.getHandlerFunction();
    if (!porFuncao[fn]) porFuncao[fn] = 0;
    porFuncao[fn]++;
  });

  const resultado = Object.keys(porFuncao).map(fn => ({
    funcao: fn,
    quantidade: porFuncao[fn],
    duplicado: porFuncao[fn] > 1
  }));

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/** Remove gatilhos duplicados de uma função específica, mantendo só 1. */
function removerGatilhosDuplicados(nomeFuncao) {
  const gatilhos = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === nomeFuncao);

  if (gatilhos.length <= 1) {
    return 'Não há duplicata pra ' + nomeFuncao + ' (encontrado(s): ' + gatilhos.length + ').';
  }

  // mantém o primeiro, remove o resto
  for (let i = 1; i < gatilhos.length; i++) {
    ScriptApp.deleteTrigger(gatilhos[i]);
  }

  return 'Removida(s) ' + (gatilhos.length - 1) + ' duplicata(s) de ' + nomeFuncao + '. Mantido 1.';
}
function rodarRemoverDuplicataLembretes() {
  return removerGatilhosDuplicados("rotinaLembretesFerias");
}