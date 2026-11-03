/*************************************************************************************************
 * PORTAL DO GESTOR · CIEDS — Codigo.gs
 * -----------------------------------------------------------------------------------------------
 * Projeto Apps Script separado. Não acessa planilha nenhuma: tudo passa pela API interna.
 *
 * CONFIGURAÇÃO (uma vez):
 *   1) Cole os 4 arquivos: Codigo.gs · Index.html · Estilos.html · Script.html
 *   2) Rode configurarPortal('URL_EXEC_DA_API', 'SEGREDO')
 *   3) Implantar > App da Web > Executar como: EU · Acesso: QUALQUER PESSOA
 *
 * O segredo nunca chega ao navegador do gestor.
 *************************************************************************************************/

const PORTAL = {
  ORIGEM: 'PORTAL_GESTOR',

  MARCA: {
    nome: 'CIEDS',
    logo: 'https://www.cieds.org.br/storage/settings/November2023/EpbAW45QebvsTGIqQIoi.svg'
  },

  // O menu lateral se monta a partir daqui, cruzado com as permissões do usuário.
  MODULOS: [
    { id: 'painel',     nome: 'Meu painel', icone: '🏠', ativo: true,  permissao: null },
    { id: 'ferias',     nome: 'Férias',     icone: '🌴', ativo: true,  permissao: 'FERIAS.CONTEXTO' },
    { id: 'afastamentos', nome: 'Afastamentos', icone: '🩺', ativo: true, permissao: 'AFASTAMENTOS.CONTEXTO' },
    { id: 'rescisao',   nome: 'Rescisão',   icone: '📄', ativo: true,  permissao: 'RESCISAO.CONTEXTO' },
    { id: 'movimentacao', nome: 'Movimentações', icone: '🔀', ativo: true, permissao: 'MOVIMENTACAO.CONTEXTO' }
  ],

  PRAZO_DP_DIAS: 15
};

// Implantação versionada e pública do DP360_API. A URL configurada continua em
// ScriptProperties; esta constante serve apenas para recuperar portais que ficaram apontando
// para uma implantação removida ou uma URL incompleta.
const API_URL_PRODUCAO = 'https://script.google.com/macros/s/AKfycbxoTVBAJAtWbghAn8-6ocI1PkZHgr8mLT0urgeK6x7pkV6xYY-xsRqykCPjeYYm5MCUoQ/exec';

function configurarPortal(url, segredo) {
  if (!url || !segredo) {
    throw new Error('Use: configurarPortal("https://script.google.com/.../exec", "segredo")');
  }

  PropertiesService.getScriptProperties().setProperties({
    API_URL: String(url).trim(),
    API_SEGREDO: String(segredo).trim()
  });

  return 'Portal configurado. Rode testarConexao().';
}

function testarConexao() {
  const r = _api_('PING', {});
  console.log(JSON.stringify(r, null, 2));
  return 'Conexão OK — API v' + r.versao;
}

/** Corrige somente a URL da API, preservando o segredo já configurado no portal. */
function corrigirUrlApiProducao() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_SEGREDO')) {
    throw new Error('API_SEGREDO não configurado. Rode configurarPortal(url, segredo).');
  }
  props.setProperty('API_URL', API_URL_PRODUCAO);
  return testarConexao();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Portal do Gestor · CIEDS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/* ============================================================================================ */
/*  PONTE COM A API                                                                              */
/* ============================================================================================ */

function _api_(acao, payload, token) {
  const props = PropertiesService.getScriptProperties();
  let url = String(props.getProperty('API_URL') || '').trim();
  const segredo = props.getProperty('API_SEGREDO');

  if (!segredo) {
    throw new Error('Portal não configurado. Rode configurarPortal(url, segredo) no editor.');
  }

  if (!url) url = API_URL_PRODUCAO;

  const corpo = JSON.stringify({
    acao: acao,
    segredo: segredo,
    token: token || '',
    origem: PORTAL.ORIGEM,
    payload: payload || {}
  });

  function buscar(destino) {
    return UrlFetchApp.fetch(destino, {
      method: 'post',
      contentType: 'application/json',
      payload: corpo,
      muteHttpExceptions: true,
      followRedirects: true
    });
  }

  function lerJson(resposta) {
    try { return JSON.parse(resposta.getContentText()); }
    catch (e) { return null; }
  }

  let resp = buscar(url);
  let json = lerJson(resp);

  // Uma implantação removida devolve HTML/404, não JSON. Tenta a implantação pública atual
  // uma vez e, se ela responder como API, conserta ScriptProperties para as próximas chamadas.
  if (!json && [404, 410].indexOf(resp.getResponseCode()) > -1 && url !== API_URL_PRODUCAO) {
    const respAtual = buscar(API_URL_PRODUCAO);
    const jsonAtual = lerJson(respAtual);
    if (jsonAtual && Object.prototype.hasOwnProperty.call(jsonAtual, 'ok')) {
      props.setProperty('API_URL', API_URL_PRODUCAO);
      url = API_URL_PRODUCAO;
      resp = respAtual;
      json = jsonAtual;
    }
  }

  if (!json) {
    throw new Error('O sistema não respondeu corretamente (HTTP ' + resp.getResponseCode() + '). ' +
      'Confira a implantação da API: acesso "Qualquer pessoa" e URL terminando em /exec.');
  }

  if (!json.ok) throw new Error(json.erro || 'Falha na comunicação com o sistema.');

  return json;
}

/* ---- login ---- */

function srvSolicitarCodigo(email) {
  return _api_('SOLICITAR_CODIGO_CADASTRO', { email: email });
}

function srvDefinirSenha(email, codigo, senha) {
  return _api_('CONFIRMAR_CADASTRO_SENHA', { email: email, codigo: codigo, senha: senha });
}

/**
 * [PERF] Login + carga numa tacada só.
 * Antes: AUTENTICAR → CONTEXTO → FERIAS.CONTEXTO = 3 idas à rede (~3-4s).
 * Agora: AUTENTICAR → FERIAS.CARGA = 2. E o token já volta com a tela pronta.
 */
/**
 * [PERF] Login em UMA ida à rede.
 * A API devolve o token E a tela montada na mesma resposta (payload.comCarga).
 */
function srvLogin(email, senha) {
  const login = _api_('AUTENTICAR', {
    email: email,
    senha: senha,
    comCarga: true,
    carga: { visao: 'GESTOR' }
  });

  return {
    ok: true,
    token: login.token,
    dados: login.carga ? _montarDados_(login.carga) : null
  };
}

function srvLogout(token) {
  try { return _api_('LOGOUT', {}, token); } catch (e) { return { ok: true }; }
}

/* ---- carga da tela ---- */

/**
 * UMA chamada ao sistema: CARGA.
 *
 *   modulo = ''        → painel: usuário, permissões e RESUMO de cada módulo (leve)
 *   modulo = 'FERIAS'  → o painel + o contexto completo de férias (só quando o gestor abre a aba)
 *
 * Quando Rescisão entrar, nada muda aqui: o resumo dela aparece sozinho em `resumos`.
 */
function srvCarregar(token, modulo, visao, departamento) {
  // Este é o Portal do Gestor: mesmo quando a pessoa também possui perfil DP/ADMIN,
  // todos os resumos e contextos daqui permanecem limitados à equipe vinculada a ela.
  // A visão global continua existindo exclusivamente nos portais operacionais do DP.
  return _montarDados_(_api_('CARGA', {
    modulo: modulo || '', visao: 'GESTOR', departamento: departamento || ''
  }, token));
}

function _montarDados_(r) {
  const acoes = (r.permissoes || []).map(p => String(p.acao || '').toUpperCase());

  function pode(acao) {
    if (!acao) return true;
    if (acoes.indexOf('*') > -1) return true;
    if (acoes.indexOf(acao) > -1) return true;
    return acoes.some(a => a.endsWith('.*') && acao.indexOf(a.replace('.*', '.')) === 0);
  }

  const modulos = PORTAL.MODULOS.map(m => ({
    id: m.id, nome: m.nome, icone: m.icone, ativo: m.ativo,
    liberado: m.ativo && pode(m.permissao)
  }));

  return {
    usuario: r.usuario,
    marca: PORTAL.MARCA,
    prazoDP: PORTAL.PRAZO_DP_DIAS,
    modulos: modulos,
    resumos: r.resumos || {},
    contexto: r.contexto || null,
    moduloCarregado: r.moduloCarregado || ''
  };
}

/* ---- ações ---- */

function srvSolicitarFerias(token, dados) {
  dados = dados || {};
  dados.visao = 'GESTOR';
  return _api_('FERIAS.SOLICITAR', dados, token);
}

function srvCancelarFerias(token, idSolicitacao) {
  return _api_('FERIAS.CANCELAR', {
    idSolicitacao: idSolicitacao,
    visao: 'GESTOR'
  }, token);
}

/** Lista quem, na equipe do gestor, tem saldo pra tirar férias de fim de ano. */
function srvElegiveisFimDeAno(token) {
  return _api_('FERIAS.ELEGIVEIS_FIM_DE_ANO', { visao: 'GESTOR' }, token);
}

/** Lista quem, na equipe do gestor, já tem férias de fim de ano solicitadas (aguardando o DP). */
function srvAgendadosFimDeAno(token) {
  return _api_('FERIAS.AGENDADOS_FIM_DE_ANO', { visao: 'GESTOR' }, token);
}

/** Confirma 1 ou 2 opções de férias de fim de ano pra uma pessoa da equipe. */
function srvAgendarFimDeAno(token, idPeriodo, opcao) {
  return _api_('FERIAS.AGENDAR_FIM_DE_ANO', {
    idPeriodo: idPeriodo,
    opcao: opcao,
    visao: 'GESTOR'
  }, token);
}

/* ---- AFASTAMENTOS ---- */

function srvAfastContexto(token) {
  // O Portal do Gestor sempre trabalha no escopo da equipe, mesmo para ADMIN/DP.
  return _api_('AFASTAMENTOS.CONTEXTO', { visao: 'GESTOR' }, token);
}

/** Lança o afastamento com o atestado anexado (arquivo em base64). */
function srvAfastLancar(token, dados) {
  dados = dados || {};
  dados.visao = 'GESTOR';   // escopo de equipe é obrigatório aqui
  return _api_('AFASTAMENTOS.LANCAR', dados, token);
}

/* ---- RESCISÃO ---- */

function srvRescContexto(token) {
  // O Portal do Gestor sempre trabalha no escopo da equipe.
  return _api_('RESCISAO.CONTEXTO', { visao: 'GESTOR' }, token);
}

function srvRescSolicitar(token, dados) {
  dados = dados || {};
  dados.visao = 'GESTOR';   // escopo de equipe é obrigatório aqui
  return _api_('RESCISAO.SOLICITAR', dados, token);
}

function srvRescModelosCarta(token) {
  return _api_('RESCISAO.MODELOS_CARTA', {}, token);
}

function srvRescCancelar(token, id, motivo) {
  return _api_('RESCISAO.CANCELAR', { id: id, motivo: motivo || '' }, token);
}

/* ---- MOVIMENTAÇÕES ---- */

function srvMovContexto(token) {
  // Força a visão de equipe, mesmo que quem esteja logado tenha perfil DP/ADMIN
  // (testando o Portal do Gestor) — sem isso, esse perfil enxergaria todo mundo.
  return _api_('MOVIMENTACAO.CONTEXTO', { visao: 'GESTOR' }, token);
}

function srvMovSolicitar(token, dados) {
  dados = dados || {};
  dados.visao = 'GESTOR';   // idem — nunca deixa solicitar fora da própria equipe
  return _api_('MOVIMENTACAO.SOLICITAR', dados, token);
}

function srvMovCancelar(token, id) {
  return _api_('MOVIMENTACAO.CANCELAR', { id: id }, token);
}

/* Configuração da conexão com a API (sua URL e segredo).
 * NÃO deixe URL/segredo escritos aqui — isso vai para o controle de versão.
 * Rode configurarPortal('URL_EXEC_DA_API', 'SEGREDO') direto no editor, uma vez,
 * com os valores reais (peça o segredo atual rodando verSegredoFront() na API). */
function conectar() {
  throw new Error('Rode configurarPortal(url, segredo) diretamente no editor, com os valores reais.');
}

/**
 * [PERF] Mantém este projeto (Portal do Gestor) "quente" no Google, evitando o atraso de
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
