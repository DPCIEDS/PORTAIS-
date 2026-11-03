/*************************************************************************************************
 * CADASTRO — porta única de leitura do cadastro de colaboradores
 * -----------------------------------------------------------------------------------------------
 * Este arquivo é a casa nova do leitor de cadastro, que hoje mora dentro do Ferias.gs
 * (_colaboradores_). O objetivo é que TODO módulo (Férias, Afastamento, Rescisão, Movimentação)
 * pergunte "quem é o funcionário X?" para um único lugar, garantindo que todos vejam a mesma
 * informação — e, no passo (b), a informação MAIS ATUAL (Opção B).
 *
 * ONDE ESTAMOS — PASSO (a): MUDANÇA DE CASA, sem mudar comportamento.
 *   Cadastro.todos()  lê o MASTER (COLABORADORES), a projeção do RAIO-X, exatamente como o
 *   _colaboradores_ fazia — mesma forma de objeto, mesmo cache por execução. Nada mais.
 *   O _colaboradores_ do Ferias.gs passa a ser um atalho fino que chama Cadastro.todos(),
 *   então os 18 pontos que já chamam _colaboradores_() continuam funcionando sem tocar em nada.
 *
 * PRÓXIMOS PASSOS (não estão neste arquivo ainda):
 *   (b) Opção B — sobrepor, por cima do MASTER, o estado já confirmado no nosso sistema que o
 *       RAIO-X ainda não refletiu: departamento/cargo/salário de movimentações DP_APROVADA
 *       (dissolve por valor igual) e desligamento do RESCISAO_CASOS (dissolve quando o RAIO-X
 *       traz a coluna Demissão). Isso entra AQUI DENTRO, sem mudar quem chama.
 *   (c) migrar os módulos, um a um, de _colaboradores_() para Cadastro.todos()/obter(), e por
 *       fim aposentar o atalho no Ferias.gs.
 *
 * DEPENDÊNCIAS (todas já existem no projeto, no kernel):
 *   _masterSS_()  ·  _sheetToObjects_()  ·  DP360.MASTER_SHEETS.COLABORADORES
 *************************************************************************************************/

var Cadastro = (function () {

  // Cache por execução (não entre requisições). Igual ao antigo _CACHE_MASTER_: evita reler as
  // ~1.293 linhas da MASTER a cada chamada dentro da MESMA execução. É zerado por
  // Cadastro.limparCache(), que o _invalidarCacheFerias_() passa a chamar após qualquer escrita.
  var _cache = null;

  /** Lista completa de colaboradores do MASTER (projeção do RAIO-X). Mesma forma de objeto que o
   *  _colaboradores_ sempre devolveu. */
  function todos() {
    if (_cache) return _cache;
    _cache = _sheetToObjects_(_masterSS_().getSheetByName(DP360.MASTER_SHEETS.COLABORADORES));
    return _cache;
  }

  /** Um colaborador por ID_COLABORADOR, ou null. Conveniência para a migração do passo (c)
   *  (hoje os módulos fazem _colaboradores_().find(...) na mão). */
  function obter(id) {
    if (id == null) return null;
    id = String(id);
    var lista = todos();
    for (var i = 0; i < lista.length; i++) {
      if (String(lista[i].ID_COLABORADOR) === id) return lista[i];
    }
    return null;
  }

  /** Zera o cache por execução. Chamado após qualquer escrita (via _invalidarCacheFerias_). */
  function limparCache() {
    _cache = null;
  }

  return {
    todos: todos,
    obter: obter,
    limparCache: limparCache
  };

})();