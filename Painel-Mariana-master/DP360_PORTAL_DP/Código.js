/*************************************************************************************************
 * PORTAL DO DP · CIEDS — Codigo.gs
 * -----------------------------------------------------------------------------------------------
 * Projeto Apps Script separado do Portal do Gestor e da API.
 * Não acessa planilha nenhuma: tudo passa pela API interna.
 *
 * CONFIGURAÇÃO (uma vez):
 *   1) Cole os 4 arquivos: Codigo.gs · Index.html · Estilos.html · Script.html
 *   2) Rode configurarPortal('URL_EXEC_DA_API', 'SEGREDO')
 *   3) Implantar > App da Web > Executar como: EU · Acesso: QUALQUER PESSOA
 *
 * Só perfis DP e ADMIN entram aqui. A API recusa o resto.
 *************************************************************************************************/

const PORTAL = {
  ORIGEM: 'PORTAL_DP',
  MARCA: {
    nome: 'CIEDS',
    logo: 'https://www.cieds.org.br/storage/settings/November2023/EpbAW45QebvsTGIqQIoi.svg'
  }
};

function definirConexaoPortal(urlDaApi, segredoDaApi) {
  if (!urlDaApi || !segredoDaApi) {
    throw new Error('Use: definirConexaoPortal("https://.../exec", "segredo")');
  }

  const dados = {
    API_URL: String(urlDaApi).trim(),
    API_SEGREDO: String(segredoDaApi).trim()
  };

  PropertiesService.getScriptProperties().setProperties(dados, true);

  return {
    ok: true,
    mensagem: 'Conexão do portal salva com sucesso.',
    apiUrl: dados.API_URL,
    segredo: 'CONFIGURADO'
  };
}

function configurarPortal(url, segredo) {
  return definirConexaoPortal(url, segredo);
}

function testarConexaoPortal() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const endpoint = props.API_URL;
  const chave = props.API_SEGREDO;

  if (!endpoint || !chave) {
    throw new Error('Portal ainda não configurado. Rode definirConexaoPortal(...) primeiro.');
  }

  try {
    const resposta = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        acao: 'PING',
        segredo: chave,
        payload: {}
      }),
      muteHttpExceptions: true,
      followRedirects: true
    });

    const status = resposta.getResponseCode();
    const texto = resposta.getContentText();
    const dados = JSON.parse(texto || '{}');

    if (status >= 200 && status < 300) {
      return {
        ok: true,
        status,
        resposta: dados
      };
    }

    return {
      ok: false,
      status,
      resposta: dados
    };
  } catch (e) {
    return {
      ok: false,
      erro: e.message
    };
  }
}

/** DIAGNÓSTICO — mostra exatamente qual URL/deployment do DP360_API este Portal está chamando,
 *  pra conferir se bate com o deployment que recebe os pushes mais recentes (@HEAD vs. uma
 *  versão antiga presa num deployment específico). */
function mostrarUrlApi() {
  const url = PropertiesService.getScriptProperties().getProperty('API_URL') || '(não configurado)';
  console.log(url);
  return url;
}

function testarConexao() {
  const r = _api_('PING', {});
  console.log(JSON.stringify(r, null, 2));
  return 'Conexão OK — API v' + r.versao;
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Portal do DP · Férias · CIEDS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/**
 * [PERF] Mantém este projeto (Portal do DP) "quente" no Google, evitando o atraso de
 * cold start na primeira visita depois de um tempo sem uso. Roda a cada 10 minutos, não
 * faz nada além de existir.
 */
function manterAquecido() {
  return 'ok';
}

function criarGatilhoAquecimento() {
  ScriptApp.newTrigger('manterAquecido').timeBased().everyMinutes(10).create();
  return 'Gatilho de aquecimento criado (a cada 10 minutos).';
}

// [FIX 2026-09-28] Ações que só LEEM dados. Só estas são repetidas quando o Google devolve uma
// falha passageira entre o Portal e a API (HTTP 404 na troca de versão, 429 por excesso de
// chamadas, 5xx, ou erro de rede do UrlFetchApp). Ações que gravam (enviar, cancelar, registrar,
// verificar, baixar...) NUNCA são repetidas: a primeira tentativa pode ter sido executada, e
// repetir poderia duplicar um envio ao Autentique, por exemplo.
const API_ACOES_LEITURA = [
  'PING', 'CONTEXTO',
  'FERIAS.PAINEL_DP', 'FERIAS.AGENDADAS', 'FERIAS.PROVISAO', 'FERIAS.RECIBOS', 'FERIAS.VER_RECIBO',
  'FERIAS.BUSCAR_COLABORADOR', 'FERIAS.ABONO_EM_CURSO_GLOBAL',
  'AFASTAMENTOS.FILA', 'MOVIMENTACAO.FILA', 'PROCESSOTRAB.FILA', 'PROCESSOTRAB.INDICADORES',
  'BENEFICIOS.LISTAR_LOTES', 'BENEFICIOS.LISTAR_REGRAS', 'BENEFICIOS.SIMULAR', 'BENEFICIOS.CONCILIAR', 'BENEFICIOS.LOTE_LINHAS',
  'RESCISAO.FILA', 'RESCISAO.CONTEXTO', 'RESCISAO.HOMOLOGACAO_LISTA', 'RESCISAO.VER_DOCUMENTOS_HOMOLOGACAO',
  'RESCISAO.COMPLEMENTAR_INDICADORES', 'RESCISAO.COMPLEMENTAR_LISTAR', 'RESCISAO.COMPLEMENTAR_MOTIVOS',
  'ADMISSAO.CONTEXTO', 'ADMISSAO.FICHA', 'ADMISSAO.KIT_LISTA', 'ADMISSAO.KIT_VER'
];
const API_STATUS_PASSAGEIRO = [404, 408, 429, 500, 502, 503, 504];
const API_TENTATIVAS_LEITURA = 3;

function _api_(acao, payload, token) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('API_URL');
  const segredo = props.getProperty('API_SEGREDO');

  if (!url || !segredo) throw new Error('Portal não configurado. Rode configurarPortal(url, segredo).');

  const podeRepetir = API_ACOES_LEITURA.indexOf(acao) > -1;
  const tentativas = podeRepetir ? API_TENTATIVAS_LEITURA : 1;
  let resp = null;
  let status = 0;
  let texto = '';
  let feitas = 0;

  for (let t = 1; t <= tentativas; t++) {
    feitas = t;
    try {
      resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          acao: acao, segredo: segredo, token: token || '',
          origem: PORTAL.ORIGEM, payload: payload || {}
        }),
        muteHttpExceptions: true,
        followRedirects: true
      });
    } catch (e) {
      // erro de rede do próprio UrlFetchApp (tempo esgotado, endereço indisponível etc.)
      if (t < tentativas) { Utilities.sleep(1000 * t); continue; }
      throw new Error('Não consegui falar com a API (' + e.message + '). Tente de novo em instantes.');
    }
    status = resp.getResponseCode();
    texto = resp.getContentText();
    if (API_STATUS_PASSAGEIRO.indexOf(status) > -1 && t < tentativas) { Utilities.sleep(1000 * t); continue; }
    break;
  }

  if (status >= 400) {
    throw new Error('Falha na comunicação com a API (HTTP ' + status + ')' +
      (feitas > 1 ? ', mesmo depois de ' + feitas + ' tentativas' : '') +
      (API_STATUS_PASSAGEIRO.indexOf(status) > -1
        ? '. Pode ser instabilidade passageira do Google: tente de novo em instantes.'
        : '. Verifique a URL do Web App publicado e o segredo do portal.'));
  }

  let json;
  try {
    json = JSON.parse(texto);
  } catch (e) {
    const preview = String(texto || '').slice(0, 220).replace(/\s+/g, ' ');
    throw new Error(
      'O sistema não respondeu corretamente (HTTP ' + status + '). Provavelmente a URL do Web App da API está errada ou está apontando para o Portal/HTML em vez da API JSON. ' +
      'Verifique o valor de API_URL no Script Properties. Resposta recebida: ' + preview
    );
  }

  if (!json || !json.ok) throw new Error((json && json.erro) || 'Falha na comunicação com o sistema.');

  return json;
}

/* ---- login ---- */

function srvSolicitarCodigo(email) { return _api_('SOLICITAR_CODIGO_CADASTRO', { email: email }); }
function srvDefinirSenha(email, codigo, senha) { return _api_('CONFIRMAR_CADASTRO_SENHA', { email: email, codigo: codigo, senha: senha }); }

function srvLogin(email, senha, semPainel) {
  const login = _api_('AUTENTICAR', { email: email, senha: senha });

  // Carrega o painel de férias só se a pessoa cuidar desse módulo.
  // Quem não cuida de férias entra mesmo assim (verá os módulos dela).
  let painel = null;
  let semFerias = false;

  // A API informa os módulos da pessoa. Quem não cuida de Férias não precisa do painel de
  // Férias: pular esse pedido poupa uma ida inteira à API no login (5 a 30 s medidos).
  const mods = login.usuario && Array.isArray(login.usuario.modulos) ? login.usuario.modulos : null;
  const cuidaDeFerias = !mods || mods.indexOf('*') > -1 || mods.indexOf('FERIAS') > -1;

  // [PERF 2026-09-24] O navegador novo pede o painel de Férias depois, EM PARALELO com os
  // outros módulos. Antes, o painel vinha aqui, e só depois dele os módulos eram pedidos.
  if (semPainel) {
    return { ok: true, token: login.token, usuario: login.usuario, painel: null, semFerias: !cuidaDeFerias };
  }

  if (!cuidaDeFerias) {
    semFerias = true;
  } else {
    try {
      painel = srvPainel(login.token);
    } catch (e) {
      // "sem permissão" não é erro de login — é só que essa pessoa não cuida de férias
      if (/permiss/i.test(e.message)) {
        semFerias = true;
      } else {
        throw new Error(e.message);
      }
    }
  }

  return {
    ok: true,
    token: login.token,
    usuario: login.usuario,
    painel: painel,
    semFerias: semFerias
  };
}

function srvLogout(token) {
  try { return _api_('LOGOUT', {}, token); } catch (e) { return { ok: true }; }
}

// Usado para repopular o "Olá, nome" do cabeçalho quando a sessão é restaurada
// pelo token salvo (sem passar de novo pela tela de login).
function srvContexto(token) {
  return _api_('CONTEXTO', {}, token);
}

/* ---- painel ---- */

function srvPainel(token) {
  const painel = _api_('FERIAS.PAINEL_DP', {}, token);
  painel.marca = PORTAL.MARCA;
  return painel;
}

function srvDefinirTeto(token, mes, teto) {
  return _api_('FERIAS.DEFINIR_TETO', { mes: mes, teto: teto }, token);
}

function srvAgendadas(token, competencia) {
  return _api_('FERIAS.AGENDADAS', { competencia: competencia || '' }, token);
}

function srvEnviarFinanceiroLote(token, dados) {
  return _api_('FERIAS.ENVIAR_FINANCEIRO_LOTE', dados, token);
}

// [2026-10-29] Agendadas: envio ao financeiro por departamento (WEB, valor, banco, BI Férias do Alterdata)
function srvFerFinSalvar(token, dados) { return _api_('FERIAS.FINANCEIRO_SALVAR', dados, token); }
function srvFerFinEnviarDepto(token, dados) { return _api_('FERIAS.FINANCEIRO_ENVIAR_DEPTO', dados, token); }
// [2026-11-03] arquivo bancário (remessa CNAB 240) preenche valor, banco, agência e conta do departamento
function srvFerFinLerArquivo(token, dados) { return _api_('FERIAS.FINANCEIRO_LER_ARQUIVO', dados, token); }
function processarBIFeriasDataUri(dataUri, nomeArquivo, token) {
  const arquivo = _raioxArquivoTemporario_(dataUri, nomeArquivo); // mesma conversão do Raio-X (.xls/.xlsx abre pelo ID)
  try {
    return _api_('FERIAS.FINANCEIRO_IMPORTAR_BI', { sheetId: arquivo.getId() }, token);
  } finally {
    _raioxApagarTemporario_(arquivo);
  }
}

/* ---- decisões ---- */

function srvDeferir(token, id) {
  return _api_('FERIAS.DEFERIR', { idSolicitacao: id }, token);
}

function srvIndeferir(token, id, motivo) {
  return _api_('FERIAS.INDEFERIR', { idSolicitacao: id, motivo: motivo }, token);
}

function srvEstornarDeferida(token, id, motivo) {
  return _api_('FERIAS.CANCELAR', { idSolicitacao: id, motivo: motivo }, token);
}

function srvProvisao(token, dados) {
  return _api_('FERIAS.PROVISAO', dados, token);
}

function srvAutorizarAbono(token, idPeriodo, pedidoEm, excecao, justificativa) {
  return _api_('FERIAS.AUTORIZAR_ABONO', {
    idPeriodo: idPeriodo, pedidoEm: pedidoEm,
    excecao: !!excecao, justificativa: justificativa || ''
  }, token);
}

function srvRevogarAbono(token, idPeriodo, justificativa) {
  return _api_('FERIAS.REVOGAR_ABONO', { idPeriodo: idPeriodo, justificativa: justificativa }, token);
}

/** Contexto global de Férias, todos os colaboradores da empresa (pra busca no "novo pedido"). */
function srvFeriasContextoGlobal(token) {
  return _api_('FERIAS.ABONO_EM_CURSO_GLOBAL', {}, token);
}

/** O DP registra o pedido de venda de dias de qualquer colaborador da empresa. */
function srvSolicitarAbonoDP(token, idPeriodo, dias) {
  return _api_('FERIAS.SOLICITAR_ABONO', { idPeriodo: idPeriodo, dias: dias }, token);
}

/** TESTE: busca global de colaboradores (caixa de busca do cabeçalho). */
function srvBuscarColaborador(token, termo) {
  return _api_('FERIAS.BUSCAR_COLABORADOR', { termo: termo }, token);
}

/* ---- AFASTAMENTOS (Fatia 2) ---- */

function srvAfastFila(token) { return _api_('AFASTAMENTOS.FILA', {}, token); }

function srvAfastAgendamentoPericia(token, dados) {
  return _api_('AFASTAMENTOS.REGISTRAR_AGENDAMENTO_PERICIA', dados, token);
}

function srvAfastRegistrarDecisao(token, dados) {
  return _api_('AFASTAMENTOS.REGISTRAR_DECISAO', dados, token);
}

function srvAfastProrrogar(token, dados) {
  return _api_('AFASTAMENTOS.PRORROGAR', dados, token);
}

function srvAfastExameOcupacional(token, dados) {
  return _api_('AFASTAMENTOS.EXAME_OCUPACIONAL', dados, token);
}

function srvAfastRetornar(token, dados) {
  return _api_('AFASTAMENTOS.RETORNAR', dados, token);
}

/* ---- RESCISÃO ---- */

function srvRescFila(token) { return _api_('RESCISAO.FILA', {}, token); }

function srvRescAgendar(token, dados) { return _api_('RESCISAO.AGENDAR', dados, token); }

function srvRescRegistrarDireto(token, dados) { return _api_('RESCISAO.REGISTRAR_DIRETO', dados, token); }

function srvRescComparecimento(token, dados) { return _api_('RESCISAO.COMPARECIMENTO', dados, token); }

function srvRescExame(token, dados) { return _api_('RESCISAO.EXAME', dados, token); }

function srvRescExameDispensar(token, dados) { return _api_('RESCISAO.EXAME_DISPENSAR', dados, token); }

function srvRescDesligar(token, dados) { return _api_('RESCISAO.DESLIGAR', dados, token); }

function srvRescAnexarRescisao(token, dados) { return _api_('RESCISAO.ANEXAR_RESCISAO', dados, token); }

function srvRescConfirmarValores(token, dados) { return _api_('RESCISAO.CONFIRMAR_VALORES', dados, token); }

function srvRescEnviarFinanceiro(token, id) { return _api_('RESCISAO.ENVIAR_FINANCEIRO', { id: id }, token); }

function srvRescEnviarAutentique(token, id) { return _api_('RESCISAO.ENVIAR_AUTENTIQUE', { id: id }, token); }

function srvRescCancelarAutentique(token, id) { return _api_('RESCISAO.CANCELAR_AUTENTIQUE', { id: id }, token); }

function srvRescVerificarAssinatura(token, id) { return _api_('RESCISAO.VERIFICAR_ASSINATURA', { id: id }, token); }

function srvRescCancelar(token, id, motivo) { return _api_('RESCISAO.CANCELAR', { id: id, motivo: motivo || '' }, token); }

function srvRescBaixarArquivar(token, id) { return _api_('RESCISAO.BAIXAR_ARQUIVAR', { id: id }, token); }

function srvRescHomologacaoLista(token, forcar) { return _api_('RESCISAO.HOMOLOGACAO_LISTA', { forcar: !!forcar }, token); }
function srvRescVerDocumentosHomologacao(token, matricula) { return _api_('RESCISAO.VER_DOCUMENTOS_HOMOLOGACAO', { matricula: matricula }, token); }
function srvRescEnviarHomologacao(token, matricula) { return _api_('RESCISAO.ENVIAR_HOMOLOGACAO_AUTENTIQUE', { matricula: matricula }, token); }
function srvRescEnviarTodasHomologacoes(token) { return _api_('RESCISAO.ENVIAR_TODAS_HOMOLOGACOES_AUTENTIQUE', {}, token); }
function srvRescBaixarTodasHomologacoes(token) { return _api_('RESCISAO.BAIXAR_TODAS_HOMOLOGACOES_AUTENTIQUE', {}, token); }
function srvRescCancelarHomologacao(token, matricula) { return _api_('RESCISAO.CANCELAR_HOMOLOGACAO_AUTENTIQUE', { matricula: matricula }, token); }
function srvRescVerificarTodasAssinaturasHomologacao(token) { return _api_('RESCISAO.VERIFICAR_TODAS_ASSINATURAS_HOMOLOGACAO', {}, token); }
function srvRescVerificarAssinaturaHomologacao(token, matricula) { return _api_('RESCISAO.VERIFICAR_ASSINATURA_HOMOLOGACAO', { matricula: matricula }, token); }
function srvRescBaixarArquivarHomologacao(token, matricula) { return _api_('RESCISAO.BAIXAR_ARQUIVAR_HOMOLOGACAO', { matricula: matricula }, token); }

function srvRescComplementarMotivos(token) { return _api_('RESCISAO.COMPLEMENTAR_MOTIVOS', {}, token); }

function srvRescComplementarRegistrar(token, dados) { return _api_('RESCISAO.COMPLEMENTAR_REGISTRAR', dados, token); }

function srvRescComplementarListar(token, filtros) { return _api_('RESCISAO.COMPLEMENTAR_LISTAR', filtros || {}, token); }

function srvRescComplementarIndicadores(token) { return _api_('RESCISAO.COMPLEMENTAR_INDICADORES', {}, token); }

function srvRescContextoGlobal(token) {
  // Visão global: o DP pode incluir rescisão pra QUALQUER colaborador, não só sua própria equipe.
  return _api_('RESCISAO.CONTEXTO', { visao: 'GLOBAL' }, token);
}

function srvRescSolicitarDP(token, dados) {
  dados = dados || {};
  dados.visao = 'GLOBAL';
  return _api_('RESCISAO.SOLICITAR', dados, token);
}

/* ---- PROCESSOS TRABALHISTAS ---- */

function srvProcTrabFila(token) { return _api_('PROCESSOTRAB.FILA', {}, token); }

function srvProcTrabRegistrar(token, dados) { return _api_('PROCESSOTRAB.REGISTRAR', dados, token); }

function srvProcTrabPagamentoFgts(token, dados) { return _api_('PROCESSOTRAB.REGISTRAR_PAGAMENTO_FGTS', dados, token); }

function srvProcTrabPagamentoInss(token, dados) { return _api_('PROCESSOTRAB.REGISTRAR_PAGAMENTO_INSS', dados, token); }

function srvProcTrabCancelar(token, id, motivo) { return _api_('PROCESSOTRAB.CANCELAR', { id: id, motivo: motivo || '' }, token); }

function srvProcTrabIndicadores(token) { return _api_('PROCESSOTRAB.INDICADORES', {}, token); }

/* ---- MOVIMENTAÇÕES ---- */

function srvMovFila(token) { return _api_('MOVIMENTACAO.FILA', {}, token); }

function srvMovDecidirDP(token, dados) { return _api_('MOVIMENTACAO.DECIDIR_DP', dados, token); }

/* ---- BENEFÍCIOS ---- */

function srvBenListarRegras(token) { return _api_('BENEFICIOS.LISTAR_REGRAS', {}, token); }

function srvBenImportarRegras(token, sheetId) { return _api_('BENEFICIOS.IMPORTAR_REGRAS', { sheetId: sheetId }, token); }

function srvBenListarLotes(token) { return _api_('BENEFICIOS.LISTAR_LOTES', {}, token); }

function srvBenImportarLote(token, dados) { return _api_('BENEFICIOS.IMPORTAR_LOTE', dados, token); }

function srvRaioXPreview(token, sheetId) { return _api_('RAIOX.PREVIEW', { sheetId: sheetId }, token); }
function srvRaioXImportar(token, sheetId) { return _api_('RAIOX.IMPORTAR', { sheetId: sheetId }, token); }

function srvBenConciliar(token, dados) { return _api_('BENEFICIOS.CONCILIAR', dados, token); }

// [2026-10-21] Prévia do cálculo do mês (só leitura) e o pedido gravado a partir dele; o antigo CALCULAR saiu.
function srvBenSimular(token, dados) { return _api_('BENEFICIOS.SIMULAR', dados, token); }

function srvBenGerarPedido(token, dados) { return _api_('BENEFICIOS.GERAR_PEDIDO', dados, token); }

function srvBenLoteLinhas(token, dados) { return _api_('BENEFICIOS.LOTE_LINHAS', dados, token); }

/* ---- ADMISSÕES ---- */

function srvAdmContexto(token) { return _api_('ADMISSAO.CONTEXTO', {}, token); }

function srvAdmFicha(token, protocolo) { return _api_('ADMISSAO.FICHA', { protocolo: protocolo }, token); }

function srvAdmSalvarTratativa(token, protocolo, campos) {
  return _api_('ADMISSAO.SALVAR_TRATATIVA', { protocolo: protocolo, campos: campos || {} }, token);
}

function srvAdmRiocardGerar(token, protocolo) {
  return _api_('ADMISSAO.RIOCARD_GERAR', { protocolo: protocolo }, token);
}

function srvAdmRiocardGerarLote(token, protocolos) {
  return _api_('ADMISSAO.RIOCARD_GERAR_LOTE', { protocolos: protocolos || [] }, token);
}

function srvAdmRiocardMarcarConcluido(token, protocolo) {
  return _api_('ADMISSAO.RIOCARD_MARCAR_CONCLUIDO', { protocolo: protocolo }, token);
}

/* ---- ADMISSÕES · KIT ADMISSIONAL (Autentique) ---- */

function srvAdmKitGerar(token, protocolo, forcar) {
  return _api_('ADMISSAO.KIT_GERAR', { protocolo: protocolo, forcar: !!forcar }, token);
}

function srvAdmKitLista(token) { return _api_('ADMISSAO.KIT_LISTA', {}, token); }

function srvAdmKitVer(token, protocolo) { return _api_('ADMISSAO.KIT_VER', { protocolo: protocolo }, token); }

function srvAdmKitEnviar(token, protocolo) { return _api_('ADMISSAO.KIT_ENVIAR', { protocolo: protocolo }, token); }

function srvAdmKitEnviarLote(token, protocolos) {
  return _api_('ADMISSAO.KIT_ENVIAR_LOTE', { protocolos: protocolos || [] }, token);
}

function srvAdmKitVerificar(token, protocolo) { return _api_('ADMISSAO.KIT_VERIFICAR', { protocolo: protocolo }, token); }

function srvAdmKitVerificarLote(token) { return _api_('ADMISSAO.KIT_VERIFICAR_LOTE', {}, token); }

function srvAdmKitBaixar(token, protocolo) { return _api_('ADMISSAO.KIT_BAIXAR', { protocolo: protocolo }, token); }

function srvAdmKitBaixarLote(token) { return _api_('ADMISSAO.KIT_BAIXAR_LOTE', {}, token); }

function srvAdmKitCancelar(token, protocolo) { return _api_('ADMISSAO.KIT_CANCELAR', { protocolo: protocolo }, token); }

/**
 * [2026-10-14] Raio-X anexado (arquivo do computador). Sobe um arquivo temporário no Drive e
 * deixa a API validar/importar pelo ID, com a MESMA regra do Raio-X colado por link (antes a
 * validação do arquivo era feita aqui, contava matrícula pela 1ª coluna — no relatório do
 * Alterdata é "Empresa" — e só olhava 3 colunas). .xlsx abre direto pelo ID; .csv não abre
 * (testado), então vira uma planilha do Google antes. O temporário vai para a lixeira no fim.
 */
function _raioxArquivoTemporario_(dataUri, nomeArquivo) {
  if (!dataUri || !nomeArquivo) throw new Error('Escolha o arquivo do Raio-X.');
  const match = String(dataUri).match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('Arquivo em formato inválido.');
  const bytes = Utilities.base64Decode(match[2]);

  if (/\.csv$/i.test(nomeArquivo)) {
    let texto = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    if (texto.indexOf('\uFFFD') > -1) texto = Utilities.newBlob(bytes).getDataAsString('ISO-8859-1'); // CSV do Excel/Alterdata
    const primeira = texto.split(/\r?\n/)[0] || '';
    const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
    const linhas = Utilities.parseCsv(texto.replace(/^\uFEFF/, ''), sep).filter(l => l.some(c => String(c).trim() !== ''));
    if (!linhas.length) throw new Error('O arquivo CSV está vazio.');
    const largura = Math.max.apply(null, linhas.map(l => l.length));
    const grade = linhas.map(l => l.concat(new Array(largura - l.length).fill('')));
    const ss = SpreadsheetApp.create('TEMP Raio-X ' + nomeArquivo);
    ss.getSheets()[0].getRange(1, 1, grade.length, largura).setNumberFormat('@').setValues(grade);
    SpreadsheetApp.flush();
    return DriveApp.getFileById(ss.getId());
  }

  const blob = Utilities.newBlob(bytes, match[1], nomeArquivo);
  try {
    return DriveApp.createFile(blob);
  } catch (err) {
    throw new Error('O portal está sem a permissão de Drive para importar planilhas. Adicione o escopo https://www.googleapis.com/auth/drive no appsscript.json e publique novamente o projeto.');
  }
}

function _raioxApagarTemporario_(arquivo) {
  try { if (arquivo) arquivo.setTrashed(true); }
  catch (err) { Logger.log('Falha ao apagar o arquivo temporário do Raio-X: ' + err.message); }
}

function previewArquivoRaioXDataUri(dataUri, nomeArquivo, token) {
  const arquivo = _raioxArquivoTemporario_(dataUri, nomeArquivo);
  try {
    return _api_('RAIOX.PREVIEW', { sheetId: arquivo.getId() }, token);
  } finally {
    _raioxApagarTemporario_(arquivo);
  }
}

function processarArquivoRaioxDataUri(dataUri, nomeArquivo, token) {
  const arquivo = _raioxArquivoTemporario_(dataUri, nomeArquivo);
  try {
    return _api_('RAIOX.IMPORTAR', { sheetId: arquivo.getId(), nomeArquivo: nomeArquivo }, token);
  } finally {
    _raioxApagarTemporario_(arquivo);
  }
}

/* ---- RECIBOS DE FERIAS (Autentique) ---- */
function srvFeriasRecibos(token, forcar)                { return _api_('FERIAS.RECIBOS', { forcar: !!forcar }, token); }
function srvFeriasEnviarRecibo(token, idSolicitacao)    { return _api_('FERIAS.ENVIAR_RECIBO', { idSolicitacao: idSolicitacao }, token); }
function srvFeriasEnviarRecibosLote(token)              { return _api_('FERIAS.ENVIAR_RECIBOS_LOTE', {}, token); }
function srvFeriasVerificarRecibo(token, idSolicitacao) { return _api_('FERIAS.VERIFICAR_RECIBO', { idSolicitacao: idSolicitacao }, token); }
function srvFeriasBaixarRecibo(token, idSolicitacao)    { return _api_('FERIAS.BAIXAR_RECIBO', { idSolicitacao: idSolicitacao }, token); }
function srvFeriasBaixarRecibosLote(token)              { return _api_('FERIAS.BAIXAR_RECIBOS_LOTE', {}, token); }
function srvFeriasVerRecibo(token, idSolicitacao)       { return _api_('FERIAS.VER_RECIBO', { idSolicitacao: idSolicitacao }, token); }
function srvFeriasCancelarRecibo(token, idSolicitacao)  { return _api_('FERIAS.CANCELAR_RECIBO', { idSolicitacao: idSolicitacao }, token); }
function srvFeriasVerificarRecibosLote(token)           { return _api_('FERIAS.VERIFICAR_RECIBOS_LOTE', {}, token); }

/* Configuração da conexão com a API (mesma API do Portal do Gestor).
 * NÃO deixe URL/segredo escritos aqui — isso vai para o controle de versão.
 * Rode configurarPortal('URL_EXEC_DA_API', 'SEGREDO') direto no editor, uma vez,
 * com os valores reais (peça o segredo atual rodando verSegredoFront() na API). */
function conectar() {
  throw new Error('Rode configurarPortal(url, segredo) diretamente no editor, com os valores reais.');
}

