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
    { id: 'movimentacao', nome: 'Movimentações', icone: '🔀', ativo: true, permissao: 'MOVIMENTACAO.CONTEXTO' },
    { id: 'admissao',   nome: 'Admissão',   icone: '🤝', ativo: false, permissao: 'ADMISSAO.CONTEXTO' }
  ],

  PRAZO_DP_DIAS: 15
};

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
  const url = props.getProperty('API_URL');
  const segredo = props.getProperty('API_SEGREDO');

  if (!url || !segredo) {
    throw new Error('Portal não configurado. Rode configurarPortal(url, segredo) no editor.');
  }

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      acao: acao,
      segredo: segredo,
      token: token || '',
      origem: PORTAL.ORIGEM,
      payload: payload || {}
    }),
    muteHttpExceptions: true,
    followRedirects: true
  });

  let json;

  try {
    json = JSON.parse(resp.getContentText());
  } catch (e) {
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
 * [PERF] Login + lista de elegíveis de fim de ano numa tacada só.
 * Esse portal só usa o token e a lista de elegíveis — nunca usou a "carga" genérica (Férias
 * comum, Afastamentos, Rescisão, Movimentação) que antes era pedida aqui à toa. Trocado pra
 * pedir só o que é realmente usado, evitando uma ida à rede a mais logo após o login.
 */
function srvLogin(email, senha) {
  const login = _api_('AUTENTICAR', {
    email: email,
    senha: senha,
    comFimDeAnoElegiveis: true
  });

  return {
    ok: true,
    token: login.token,
    elegiveis: login.fimDeAnoElegiveis || null
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
  // Passa o visao pedido pelo front. Continua seguro: o backend (CARGA/FERIAS.CONTEXTO)
  // já ignora "GLOBAL" sozinho pra quem não é DP/ADMIN, então um gestor comum nunca
  // consegue enxergar além da própria equipe, mesmo que o front tente mandar GLOBAL.
  return _montarDados_(_api_('CARGA', {
    modulo: modulo || '', visao: visao || 'GESTOR', departamento: departamento || ''
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
  return _api_('FERIAS.SOLICITAR', dados, token);
}

function srvCancelarFerias(token, idSolicitacao) {
  return _api_('FERIAS.CANCELAR', { idSolicitacao: idSolicitacao }, token);
}

/** Lista quem, na equipe do gestor, tem saldo pra tirar férias de fim de ano. */
function srvElegiveisFimDeAno(token) {
  return _api_('FERIAS.ELEGIVEIS_FIM_DE_ANO', {}, token);
}

/** Lista quem, na equipe do gestor, já tem férias de fim de ano agendadas. */
function srvAgendadosFimDeAno(token) {
  return _api_('FERIAS.AGENDADOS_FIM_DE_ANO', {}, token);
}

/** Confirma 1 ou 2 opções de férias de fim de ano pra uma pessoa da equipe. */
function srvAgendarFimDeAno(token, idPeriodo, opcao) {
  return _api_('FERIAS.AGENDAR_FIM_DE_ANO', { idPeriodo: idPeriodo, opcao: opcao }, token);
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

/* Configuração da conexão com a API (sua URL e segredo). Rode conectar() uma vez. */
/* Configuração da conexão com a API (sua URL e segredo). Rode conectar() uma vez. */
function conectar() {
  throw new Error('Rode configurarPortal(url, segredo) diretamente no editor, com os valores reais; não deixe isso em execução automática.');
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

function _configurarAgora() {
  return configurarPortal(
    'https://script.google.com/macros/s/AKfycbxoTVBAJAtWbghAn8-6ocI1PkZHgr8mLT0urgeK6x7pkV6xYY-xsRqykCPjeYYm5MCUoQ/exec',
    'ca2250b8-eaff-47cd-8a81-93aa7b6985f7bfc0342a-d243-4bac-b6da-6193cdb05ab77ebc23e2-fb7a-4d18-837b-6574b7572f16'
  );
}