/*************************************************************************************************
 * DP360_API · Kernel v1.1.0
 * -----------------------------------------------------------------------------------------------
 * Núcleo do DP360: autenticação, usuários, perfis, permissões, token interno, contexto, auditoria.
 * Sem Google Cloud. Sem OAuth externo. Sem API key paga. Sem cobrança.
 *
 * v1.1.2 — a função executar() saiu daqui e virou o ROTEADOR DE MÓDULOS, no arquivo FERIAS.gs.
 *          Se você colar este arquivo e NÃO tiver o FERIAS.gs no projeto, qualquer ação de
 *          módulo vai falhar com "executar is not defined". Os dois andam juntos.
 *
 * MUDANÇAS DA v1.0 → v1.1 (todas por bug encontrado em teste)
 *   [FIX-1] _sheetToObjects_ calculava _rowNumber DEPOIS de filtrar linhas vazias → escrevia na
 *           linha errada (hash de senha de um usuário indo para a credencial de outro).
 *   [FIX-2] doPost aceitava qualquer chamada da internet → agora exige SEGREDO_FRONT.
 *   [FIX-3] sincronizarUsuarios rebaixava perfis definidos à mão (ADMIN virava GESTOR).
 *   [FIX-4] Token agora é stateless: SESSOES vira log append-only e nunca é lida no caminho quente.
 *           Revogação em ScriptProperties. Login/contexto deixam de ser O(n) na aba de sessões.
 *   [FIX-5] Hash de senha com iteração (defesa contra força bruta offline se a planilha vazar).
 *   [FIX-6] Leitura/escrita em lote + LockService nas escritas de credencial.
 *   [FIX-7] Mensagens genéricas no login (não revelam quem é gestor) e throttle de envio de código.
 *
 * IMPLANTAÇÃO
 *   Executar como: Eu    ·    Quem tem acesso: QUALQUER PESSOA (ANYONE_ANONYMOUS)
 *
 * PASSO A PASSO
 *   1) setupDP360()          → cria DP360_CONFIG, semeia perfis, sincroniza usuários
 *   2) verSegredoFront()     → copie o segredo; é ele que os portais vão enviar
 *   3) promoverUsuario('seu.email@cieds.org.br', 'ADMIN')
 *   4) testarDP360Tudo()  e  diagnosticarDP360()
 *************************************************************************************************/

const DP360 = {
  VERSAO: '1.2.3',
  SISTEMA: 'DP360',

  MASTER_ID: '1wn_dxjBZrK9CPw8vjXwgor5ae3zvBiaRJuDWtoqb8fY',
  CONFIG_ID_FIXO: '',

  FUSO: 'America/Sao_Paulo',

  TOKEN_TTL_SEGUNDOS: 10 * 60 * 60,
  CODIGO_TTL_MINUTOS: 15,
  CODIGO_MAX_TENTATIVAS: 5,
  CODIGO_MAX_ENVIOS_HORA: 3,
  MAX_TENTATIVAS_LOGIN: 5,
  BLOQUEIO_LOGIN_MINUTOS: 15,
  TAMANHO_MINIMO_SENHA: 8,

  // Iterações do hash de senha. Cada iteração é um HMAC-SHA256.
  // Medido em produção (12/07/2026): 5.000 → login em ~9s. 1.000 → ~2-3s.
  // Se ainda ficar lento, baixe para 500. Trocar este número invalida as senhas já
  // cadastradas: quem tiver senha precisa refazer o "Primeiro acesso".
  HASH_ITERACOES: 1000,
  HASH_VERSAO: 2,
  HASH_ITERACOES_POR_VERSAO: { 2: 1000 },

  // Retenção dos logs (rotinaLimpeza).
  DIAS_RETENCAO_SESSOES: 30,
  DIAS_RETENCAO_AUDITORIA: 365,

  DOMINIOS_PERMITIDOS: ['cieds.org.br', 'coletivoaprendiz.org.br', 'gmail.com', 'hotmail.com'],

  // Portal do DP é operacional: só time de DP e ADMIN entram. GESTOR/DIRETORIA usam o Portal do Gestor.
  PERFIS_PORTAL_DP: ['DP', 'ADMIN'],

  // Ações que não exigem token (mas exigem SEGREDO_FRONT).
  ACOES_PUBLICAS: ['PING', 'SOLICITAR_CODIGO_CADASTRO', 'CONFIRMAR_CADASTRO_SENHA', 'AUTENTICAR'],

  SHEETS: {
    USUARIOS: 'USUARIOS',
    CREDENCIAIS: 'CREDENCIAIS',
    PERFIS: 'PERFIS',
    PERMISSOES: 'PERMISSOES',
    SESSOES: 'SESSOES',
    AUDITORIA: 'AUDITORIA',
    PARAMETROS: 'PARAMETROS'
  },

  MASTER_SHEETS: {
    COLABORADORES: 'COLABORADORES',
    GESTORES: 'GESTORES'
  },

  // Aceita variações de cabeçalho na MASTER (a aba GESTORES ainda está em construção).
  MASTER_COLS: {
    EMAIL: ['GESTOR_EMAIL', 'EMAIL_GESTOR', 'EMAIL', 'EMAIL_INSTITUCIONAL'],
    NOME: ['GESTOR_NOME', 'NOME_GESTOR', 'NOME', 'GESTAO'],
    PODE_LOGAR: ['PODE_LOGAR', 'ATIVO', 'LOGIN'],
    QTD: ['QTD_SUBORDINADOS', 'QTD', 'SUBORDINADOS']
  },

  PROPS: {
    TOKEN_SECRET: 'DP360_TOKEN_SECRET',
    PASSWORD_PEPPER: 'DP360_PASSWORD_PEPPER',
    CODE_PEPPER: 'DP360_CODE_PEPPER',
    SEGREDO_FRONT: 'DP360_SEGREDO_FRONT',
    CONFIG_ID: 'DP360_CONFIG_ID',
    REVOGADOS: 'DP360_TOKENS_REVOGADOS'
  },

  HEADERS: {
    USUARIOS: [
      'EMAIL', 'NOME', 'CARGO', 'PERFIL', 'ATIVO', 'DOMINIO', 'PODE_LOGAR',
      'ORIGEM', 'QTD_SUBORDINADOS', 'MODULOS', 'CRIADO_EM', 'ATUALIZADO_EM', 'OBSERVACAO'
    ],
    CREDENCIAIS: [
      'EMAIL', 'SALT', 'PASSWORD_HASH', 'HASH_VERSAO', 'STATUS', 'MUST_RESET', 'ULTIMA_TROCA_EM',
      'CODIGO_HASH', 'CODIGO_EXPIRA_EM', 'CODIGO_TENTATIVAS',
      'FALHAS_LOGIN', 'BLOQUEADO_ATE', 'ATUALIZADO_EM'
    ],
    PERFIS: ['PERFIL', 'DESCRICAO', 'ATIVO', 'CRIADO_EM'],
    PERMISSOES: ['PERFIL', 'ACAO', 'PERMITIDO', 'ESCOPO', 'DESCRICAO'],
    SESSOES: ['JTI', 'EMAIL', 'CRIADO_EM', 'EXPIRA_EM', 'STATUS', 'ORIGEM'],
    AUDITORIA: ['DATA_HORA', 'EVENTO', 'EMAIL', 'ACAO', 'OK', 'MENSAGEM', 'DETALHE_JSON', 'VERSAO'],
    PARAMETROS: ['CHAVE', 'VALOR', 'DESCRICAO', 'ATUALIZADO_EM']
  }
};

/* ============================================================================================ */
/*  WEB APP / ENDPOINT                                                                           */
/* ============================================================================================ */

/**
 * [PERF] Mantém o DP360_API "quente" no Google, evitando o atraso de cold start na primeira
 * chamada depois de um tempo sem uso. Roda a cada 10 minutos, não faz nada além de existir.
 * O Portal do DP já tinha esse gatilho pra ele mesmo, mas o DP360_API — que é chamado em
 * TODA ação do Portal (login, cada aba, cada botão) — não tinha nenhum, então toda a
 * lentidão "geral" do Portal também vinha do cold start daqui.
 */
function manterAquecido() {
  return 'ok';
}

// Nome próprio (não "criarGatilhoAquecimento") — esse nome já existe em Ferias.js pra outro
// gatilho (aquecerCacheFerias, cache de Férias, 30 min). Apps Script deixa dois arquivos
// definirem função com o mesmo nome sem avisar, e um sobrescreve o outro — foi o que aconteceu
// quando tentei instalar este daqui a primeira vez.
function _criarGatilhoManterAquecido_() {
  const jaExiste = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'manterAquecido');
  if (jaExiste) return 'Gatilho de aquecimento já existia, não criei outro.';
  ScriptApp.newTrigger('manterAquecido').timeBased().everyMinutes(10).create();
  return 'Gatilho de aquecimento criado (a cada 10 minutos).';
}

function doGet(e) {
  // [TEMP-DIAG] Testa admKitLista real, medindo tempo, pra achar por que Pendentes não carrega —
  // remover assim que confirmado.
  if (e && e.parameter && e.parameter.diagKitProblema === 'e91d47b0a3c852f6d19e067ca38bf104') {
    var t0 = Date.now();
    var out = {};
    try {
      var r = admKitLista({ EMAIL: 'diag@local' }, {});
      out.ok = true;
      out.totalLista = r.lista.length;
      out.pendentes = r.pendentes;
      out.enviados = r.enviados;
      out.assinados = r.assinados;
    } catch (err) {
      out.ok = false;
      out.erro = String(err && err.message ? err.message : err);
      out.stack = err && err.stack;
    }
    out.tempoMs = Date.now() - t0;
    return ContentService.createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Datas de envio de cada cadastro (pra achar por que gente de antes de setembro
  // ainda aparece em Pendentes) — remover assim que confirmado.
  if (e && e.parameter && e.parameter.diagKitDatas === 'f3c9a1b8e2d74c6091a5b3e8d1f2c9a7') {
    var _diagDatasSaida = { ok: true, linhas: [] };
    try {
      var _diagCad = _admCadastros_();
      var _diagTrat = _admTratativaMapa_();
      _diagDatasSaida.linhas = _diagCad.map(function (c) {
        var proto = String(c[ADM_COL.PROTOCOLO] || '');
        var t = _diagTrat[proto] || null;
        return {
          nome: c[ADM_COL.NOME],
          protocolo: proto,
          envioRaw: String(c[ADM_COL.ENVIO]),
          envioIso: _isoF_(c[ADM_COL.ENVIO]),
          dataAdmissaoTratativa: t ? _isoF_(t.DATA_ADMISSAO) : '',
          temKit: t ? !!String(t.KIT_ID_AUTENTIQUE || '').trim() : false
        };
      });
    } catch (errDatas) {
      _diagDatasSaida = { ok: false, erro: String(errDatas), stack: errDatas && errDatas.stack };
    }
    return ContentService.createTextOutput(JSON.stringify(_diagDatasSaida, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Roda admChecklistSincronizarLinks() manualmente (função nova, sem gatilho ainda)
  // — remover assim que confirmado que funciona e decidido como ela vai rodar de verdade.
  if (e && e.parameter && e.parameter.diagChecklistSync === '9c4e7a1f3b6d58e2a0c1f4b7d9e6a3c8') {
    var _diagSyncSaida;
    try {
      _diagSyncSaida = admChecklistSincronizarLinks();
    } catch (errSync) {
      _diagSyncSaida = { ok: false, erro: String(errSync), stack: errSync && errSync.stack };
    }
    return ContentService.createTextOutput(JSON.stringify(_diagSyncSaida, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Relatório pontual da fração de 14 dias — remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diag14 === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(JSON.stringify(_diagnosticoFracao14_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Quem sumiu da lista de fim de ano por nenhuma opção (10 dias) fechar os 14
  // dias corridos exigidos por lei — remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagFimDeAno === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(JSON.stringify(_diagnosticoFimDeAnoNaoResolvido_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Situação de TODA a campanha de fim de ano, pessoa a pessoa — remover assim
  // que tirado o relatório.
  if (e && e.parameter && e.parameter.diagStatusFDA === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(JSON.stringify(_diagnosticoStatusFimDeAno_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Quem é o gestor atual (GESTOR_EMAIL) de alguém, por trecho do nome — remover
  // assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagGestor === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(
      JSON.stringify(_diagnosticoPessoaGestor_(e.parameter.nome || '', e.parameter.emailGestor || ''), null, 2)
    ).setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Cabeçalho + linhas da aba FIM_DE_ANO — remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagAbaFDA === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(JSON.stringify(_diagnosticoAbaFimDeAno_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Traça passo a passo por que uma matrícula aparece/some da elegibilidade de
  // fim de ano pra um gestor — remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagTraca === '11af423d44e113504522916b421c310b') {
    var _diagTracaSaida;
    try {
      _diagTracaSaida = _diagnosticoTracaFimDeAno_(e.parameter.email || '', e.parameter.matricula || '');
    } catch (errTraca) {
      _diagTracaSaida = { ok: false, erro: String(errTraca), stack: errTraca && errTraca.stack };
    }
    return ContentService.createTextOutput(JSON.stringify(_diagTracaSaida, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Linhas de PERIODOS de alguém e pra qual cadastro cada uma resolve — remover
  // assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagPeriodos === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(
      JSON.stringify(_diagnosticoPeriodosPessoa_(e.parameter.nome || ''), null, 2)
    ).setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Equipe que _equipeFeriasDoGestor_ devolve pra um e-mail — remover assim que
  // tirado o relatório.
  if (e && e.parameter && e.parameter.diagEquipe === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(
      JSON.stringify(_diagnosticoEquipeGestor_(e.parameter.email || ''), null, 2)
    ).setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Roda a função REAL de elegíveis de fim de ano pra um e-mail, sem cache —
  // remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagElegivel === '11af423d44e113504522916b421c310b') {
    var _diagElegSaida;
    try {
      _diagElegSaida = _feriasElegiveisFimDeAnoCalcular_({ EMAIL: e.parameter.email || '' }, { visao: 'GESTOR' });
    } catch (errEleg) {
      _diagElegSaida = { ok: false, erro: String(errEleg), stack: errEleg && errEleg.stack };
    }
    return ContentService.createTextOutput(JSON.stringify(_diagElegSaida, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Por que o Kit Admissional não gera pra uma pessoa (nome parcial) — remover
  // assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagKit === '11af423d44e113504522916b421c310b') {
    return ContentService.createTextOutput(JSON.stringify(_diagnosticoKitAdmissional_(e.parameter.nome || ''), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // [TEMP-DIAG] Roda admKitGerar de verdade pra um protocolo (só uso em registro de TESTE) —
  // agora ela só AGENDA o kit (volta na hora); a geração de verdade roda no gatilho avulso
  // _admKitGerarEmSegundoPlano_. Use diagKit logo depois (com um intervalo) pra ver o
  // KIT_STATUS virar "Kit pronto" ou "Erro ao gerar kit". Remover assim que tirado o relatório.
  if (e && e.parameter && e.parameter.diagKitGerar === '11af423d44e113504522916b421c310b') {
    var _diagSaida;
    try {
      _diagSaida = admKitGerar({ EMAIL: 'diagnostico@cieds.org.br' }, { protocolo: e.parameter.protocolo || '', forcar: true });
    } catch (errKit) {
      _diagSaida = { ok: false, erro: String(errKit), stack: errKit && errKit.stack };
    }
    return ContentService.createTextOutput(JSON.stringify(_diagSaida, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Não expõe nada além de um heartbeat.
  return _jsonOutput({ ok: true, sistema: DP360.SISTEMA, versao: DP360.VERSAO, status: 'online' });
}

function doPost(e) {
  const inicio = new Date();
  let req = null;

  try {
    req = _parseRequest_(e);

    // [FIX-2] Portão de entrada: sem o segredo compartilhado, nada acontece.
    _validarSegredoFront_(req.segredo);

    const acao = String(req.acao || '').trim().toUpperCase();
    const payload = req.payload || {};
    const token = req.token || '';
    const origem = String(req.origem || '').slice(0, 60);

    if (!acao) throw new Error('Ação não informada.');

    let resp;

    switch (acao) {
      case 'PING':
        resp = { ok: true, pong: true, versao: DP360.VERSAO, agora: _agoraISO_() };
        break;

      case 'SOLICITAR_CODIGO_CADASTRO':
        resp = solicitarCodigoCadastro(payload.email);
        break;

      case 'CONFIRMAR_CADASTRO_SENHA':
        resp = confirmarCadastroSenha(payload.email, payload.codigo, payload.senha);
        break;

      case 'AUTENTICAR':
        resp = autenticar(payload.email, payload.senha, origem);

        // O portal pede a tela junto: evita uma segunda ida à rede logo após o login.
        if (resp.ok && payload.comCarga) {
          try {
            resp.carga = carga(resp.token, payload.carga || {});
          } catch (e) {
            resp.carga = null;
          }
        }

        // [PERF] Portal de Férias de Fim de Ano: não usa a carga genérica (Férias comum,
        // Afastamentos, Rescisão, Movimentação) — só precisa da lista de elegíveis de fim de
        // ano. Empacotar aqui evita uma segunda ida à rede logo depois do login.
        if (resp.ok && payload.comFimDeAnoElegiveis) {
          try {
            const sessFDA = _validarTokenOuErro_(resp.token);
            const userFDA = _obterUsuario_(sessFDA.email);
            resp.fimDeAnoElegiveis = feriasElegiveisFimDeAno(userFDA, {});
          } catch (e) {
            resp.fimDeAnoElegiveis = null;
          }
        }
        break;

      case 'CONTEXTO':
        resp = contexto(token);
        break;

      case 'VALIDAR_TOKEN':
        resp = validarToken(token);
        break;

      case 'LOGOUT':
        resp = logout(token);
        break;

      case 'CARGA':
        resp = carga(token, payload);
        break;

      default:
        // Roteado para os módulos (FERIAS.*, futuramente RESCISAO.*, ADMISSAO.*).
        // A função executar() vive no arquivo FERIAS.gs.
        resp = executar(token, acao, payload);
        break;
    }

    resp = resp || { ok: true };
    resp.tempoMs = new Date().getTime() - inicio.getTime();
    return _jsonOutput(resp);

  } catch (err) {
    const email = req && req.payload ? req.payload.email : '';
    _auditar_('ERRO_API', email, req ? req.acao : '', false, err.message || String(err), {});

    return _jsonOutput({
      ok: false,
      erro: err.message || String(err),
      versao: DP360.VERSAO,
      tempoMs: new Date().getTime() - inicio.getTime()
    });
  }
}

function _parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Requisição vazia.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('JSON inválido no corpo da requisição.');
  }
}

function _validarSegredoFront_(segredo) {
  const esperado = _segredoFront_();

  if (!segredo || !_constantTimeEqual_(String(segredo), esperado)) {
    _auditar_('ACESSO_NEGADO_SEGREDO', '', 'doPost', false, 'Chamada sem segredo válido.', {});
    throw new Error('Origem não autorizada.');
  }
}

function _jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================================ */
/*  SETUP                                                                                        */
/* ============================================================================================ */

function setupDP360() {
  _garantirSegredos_();

  const ssConfig = _configSS_();
  _garantirEstruturaConfig_(ssConfig);
  _semearPerfisPermissoes_(ssConfig);

  const sync = sincronizarUsuariosAPartirDaMaster();

  _auditar_('SETUP', '', 'setupDP360', true, 'Setup executado.', {
    configId: ssConfig.getId(),
    masterId: DP360.MASTER_ID
  });

  const msg =
    'OK — DP360_CONFIG pronta.\n' +
    'CONFIG_ID: ' + ssConfig.getId() + '\n' +
    'URL: ' + ssConfig.getUrl() + '\n' +
    sync + '\n\n' +
    'SEGREDO_FRONT (guarde nos portais):\n' + _segredoFront_();

  console.log(msg);
  return msg;
}

function _garantirSegredos_() {
  const props = PropertiesService.getScriptProperties();

  [DP360.PROPS.TOKEN_SECRET, DP360.PROPS.PASSWORD_PEPPER, DP360.PROPS.CODE_PEPPER, DP360.PROPS.SEGREDO_FRONT]
    .forEach(chave => {
      if (!props.getProperty(chave)) {
        props.setProperty(chave, _uuid_() + _uuid_() + _uuid_());
      }
    });
}

function _configId_() {
  if (DP360.CONFIG_ID_FIXO) return DP360.CONFIG_ID_FIXO;

  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(DP360.PROPS.CONFIG_ID);

  if (id) return id;

  const ss = SpreadsheetApp.create('DP360_CONFIG');
  id = ss.getId();
  props.setProperty(DP360.PROPS.CONFIG_ID, id);

  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao) {
    try { ss.deleteSheet(padrao); } catch (e) {}
  }

  return id;
}

var _SS_MASTER_ = null;
function _masterSS_() {
  if (!_SS_MASTER_) _SS_MASTER_ = SpreadsheetApp.openById(DP360.MASTER_ID);
  return _SS_MASTER_;
}
function _configSS_() { return SpreadsheetApp.openById(_configId_()); }

function _garantirEstruturaConfig_(ss) {
  Object.keys(DP360.SHEETS).forEach(k => {
    const nome = DP360.SHEETS[k];
    const sh = _getOrCreateSheet_(ss, nome);
    _garantirCabecalho_(sh, DP360.HEADERS[k]);

    if (nome === DP360.SHEETS.CREDENCIAIS) {
      try { sh.hideSheet(); } catch (e) {}
    }
  });
}

function _getOrCreateSheet_(ss, nome) {
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}

function _garantirCabecalho_(sh, headers) {
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  const range = sh.getRange(1, 1, 1, headers.length);
  const atual = range.getValues()[0].map(x => String(x || '').trim());

  const precisa = headers.some((h, i) => atual[i] !== h);
  if (precisa) range.setValues([headers]);

  sh.setFrozenRows(1);
  range.setFontWeight('bold').setBackground('#0E5A6B').setFontColor('#FFFFFF');
}

function _semearPerfisPermissoes_(ss) {
  _invalidarCacheKernel_();
  const perfis = ss.getSheetByName(DP360.SHEETS.PERFIS);
  const permissoes = ss.getSheetByName(DP360.SHEETS.PERMISSOES);
  const agora = new Date();

  const existentes = _sheetToObjects_(perfis).map(r => String(r.PERFIL || '').toUpperCase());

  const perfisDefault = [
    ['GESTOR', 'Gestor de equipe. Acessa somente o próprio escopo.', 'Sim', agora],
    ['DP', 'Equipe de Departamento Pessoal. Módulos operacionais.', 'Sim', agora],
    ['ADMIN', 'Administração do DP360.', 'Sim', agora],
    ['DIRETORIA', 'Consulta executiva e indicadores.', 'Sim', agora]
  ];

  const novos = perfisDefault.filter(r => existentes.indexOf(r[0]) === -1);
  if (novos.length) {
    perfis.getRange(perfis.getLastRow() + 1, 1, novos.length, novos[0].length).setValues(novos);
  }

  const permsExistentes = _sheetToObjects_(permissoes)
    .map(r => [r.PERFIL, r.ACAO].join('|').toUpperCase());

  const permsDefault = [
    ['GESTOR', 'CONTEXTO', 'Sim', 'PROPRIO', 'Carregar contexto do gestor logado.'],
    ['GESTOR', 'FERIAS.CONTEXTO', 'Sim', 'PROPRIO', 'Consultar férias da própria equipe.'],
    ['GESTOR', 'FERIAS.SOLICITAR', 'Sim', 'PROPRIO', 'Solicitar férias da própria equipe.'],
    ['GESTOR', 'FERIAS.CANCELAR', 'Sim', 'PROPRIO', 'Cancelar solicitação pendente da própria equipe.'],
    ['GESTOR', 'FERIAS.ELEGIVEIS_FIM_DE_ANO', 'Sim', 'PROPRIO', 'Ver elegíveis à campanha de férias de fim de ano.'],
    ['GESTOR', 'FERIAS.AGENDADOS_FIM_DE_ANO', 'Sim', 'PROPRIO', 'Ver agendados da campanha de férias de fim de ano.'],
    ['GESTOR', 'FERIAS.AGENDAR_FIM_DE_ANO', 'Sim', 'PROPRIO', 'Agendar férias de fim de ano da própria equipe.'],
    ['GESTOR', 'AFASTAMENTOS.CONTEXTO', 'Sim', 'PROPRIO', 'Consultar afastamentos da própria equipe.'],
    ['GESTOR', 'AFASTAMENTOS.LANCAR', 'Sim', 'PROPRIO', 'Lançar afastamento da própria equipe.'],
    ['DP', 'CONTEXTO', 'Sim', 'GLOBAL', 'Carregar contexto DP.'],
    ['DP', 'FERIAS.*', 'Sim', 'GLOBAL', 'Ações operacionais de férias.'],
    ['DP', 'AFASTAMENTOS.*', 'Sim', 'GLOBAL', 'Ações operacionais de afastamentos.'],
    ['DP', 'RAIOX.*', 'Sim', 'GLOBAL', 'Importação e validação do Raio-X.'],
    ['DP', 'TAREFAS.*', 'Sim', 'GLOBAL', 'Ações operacionais de tarefas.'],
    ['DP', 'ADMISSAO.*', 'Sim', 'GLOBAL', 'Ações operacionais de admissões.'],
    ['ADMIN', '*', 'Sim', 'GLOBAL', 'Acesso administrativo total.'],
    ['DIRETORIA', 'CONTEXTO', 'Sim', 'GLOBAL', 'Carregar contexto diretoria.'],
    ['DIRETORIA', 'INDICADORES.*', 'Sim', 'GLOBAL', 'Leitura de indicadores.']
  ];

  const novasPerms = permsDefault
    .filter(r => permsExistentes.indexOf([r[0], r[1]].join('|').toUpperCase()) === -1);

  if (novasPerms.length) {
    permissoes.getRange(permissoes.getLastRow() + 1, 1, novasPerms.length, novasPerms[0].length)
      .setValues(novasPerms);
  }
  _invalidarCacheKernel_(); // permissões novas valem na hora, sem esperar o cache vencer
}

/* ============================================================================================ */
/*  SINCRONIZAÇÃO COM A DP360_MASTER                                                             */
/* ============================================================================================ */

function _acharCabecalho_(headers, candidatos) {
  const norm = headers.map(h => String(h || '').toUpperCase().trim());

  for (let i = 0; i < candidatos.length; i++) {
    const idx = norm.indexOf(candidatos[i]);
    if (idx > -1) return headers[idx];
  }

  return null;
}

/**
 * Sincroniza USUARIOS/CREDENCIAIS a partir da aba COLABORADORES (fonte única).
 * Quem loga = PERFIL_SISTEMA <> 'SEM_ACESSO'. Perfil e Ativo passam a vir da COLABORADORES.
 */
function sincronizarUsuariosAPartirDaMaster() {
  _invalidarCacheKernel_();
  const ssMaster = _masterSS_();
  const ssConfig = _configSS_();
  _garantirEstruturaConfig_(ssConfig);

  const shColab = ssMaster.getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  if (!shColab) throw new Error('Aba COLABORADORES não encontrada na DP360_MASTER.');

  const colabs = _sheetToObjects_(shColab);
  if (!colabs.length) return 'Aba COLABORADORES vazia. Nada sincronizado.';

  // Conta subordinados por gestor (para QTD_SUBORDINADOS).
  const qtdPorGestor = {};
  colabs.forEach(c => {
    const ge = _normalizarEmail_(c.GESTOR_EMAIL);
    if (ge) qtdPorGestor[ge] = (qtdPorGestor[ge] || 0) + 1;
  });

  // Só quem tem acesso ao sistema.
  const comAcesso = colabs.filter(c => {
    const p = String(c.PERFIL_SISTEMA || '').toUpperCase().trim();
    return p && p !== 'SEM_ACESSO';
  });

  const shUsuarios = ssConfig.getSheetByName(DP360.SHEETS.USUARIOS);
  const shCred = ssConfig.getSheetByName(DP360.SHEETS.CREDENCIAIS);
  const hUsu = _headers_(shUsuarios);
  const hCred = _headers_(shCred);
  const idxUsuarios = _mapRowsByKey_(_sheetToObjects_(shUsuarios), 'EMAIL');
  const idxCred = _mapRowsByKey_(_sheetToObjects_(shCred), 'EMAIL');

  const novosUsuarios = [];
  const novosCred = [];
  const agora = new Date();
  let atualizados = 0, ignorados = 0;

  comAcesso.forEach(c => {
    const email = _normalizarEmail_(c.EMAIL_INSTITUCIONAL);
    if (!email || email.indexOf('@') === -1) { ignorados++; return; }  // sem e-mail institucional não loga

    const dominio = _dominio_(email);
    const dominioOK = DP360.DOMINIOS_PERMITIDOS.indexOf(dominio) > -1;
    const perfil = String(c.PERFIL_SISTEMA || '').toUpperCase().trim();
    const nome = String(c.NOME || '').trim();
    const situacao = String(c.SITUACAO || '').toUpperCase().trim();
    // desligado não loga; [2026-10-21] o Raio-X do Alterdata grava "Demitido", então vale o mesmo teste do resto do sistema
    const ativo = /DESLIGAD|DEMITID|INATIVO/.test(situacao) ? 'Não' : 'Sim';
    const podeLogar = dominioOK && ativo === 'Sim';
    const qtd = qtdPorGestor[email] || 0;
    const obsDom = dominioOK ? '' : 'Domínio não institucional: login bloqueado.';

    if (idxUsuarios[email]) {
      const row = idxUsuarios[email].rowNumber;
      const atual = idxUsuarios[email].obj;
      const linha = hUsu.map(h => {
        switch (h) {
          case 'EMAIL': return email;
          case 'NOME': return nome || atual.NOME || '';
          case 'CARGO': return String(c.CARGO || '').trim() || atual.CARGO || '';
          case 'PERFIL': return perfil || atual.PERFIL || 'SEM_ACESSO';   // COLABORADORES manda
          case 'ATIVO': return ativo;                                     // reflete SITUACAO
          case 'DOMINIO': return dominio;
          case 'PODE_LOGAR': return podeLogar ? 'Sim' : 'Não';
          case 'ORIGEM': return atual.ORIGEM || 'DP360_MASTER.COLABORADORES';
          case 'QTD_SUBORDINADOS': return qtd;
          case 'CRIADO_EM': return atual.CRIADO_EM || agora;
          case 'ATUALIZADO_EM': return agora;
          case 'OBSERVACAO': return obsDom || atual.OBSERVACAO || '';
          default: return atual[h] === undefined ? '' : atual[h];
        }
      });
      shUsuarios.getRange(row, 1, 1, hUsu.length).setValues([linha]);
      atualizados++;
    } else {
      novosUsuarios.push(hUsu.map(h => {
        switch (h) {
          case 'EMAIL': return email;
          case 'NOME': return nome;
          case 'CARGO': return String(c.CARGO || '').trim();
          case 'PERFIL': return perfil || 'SEM_ACESSO';
          case 'ATIVO': return ativo;
          case 'DOMINIO': return dominio;
          case 'PODE_LOGAR': return podeLogar ? 'Sim' : 'Não';
          case 'ORIGEM': return 'DP360_MASTER.COLABORADORES';
          case 'QTD_SUBORDINADOS': return qtd;
          case 'CRIADO_EM': return agora;
          case 'ATUALIZADO_EM': return agora;
          case 'OBSERVACAO': return obsDom;
          default: return '';
        }
      }));
    }

    if (!idxCred[email]) {
      novosCred.push(hCred.map(h => {
        switch (h) {
          case 'EMAIL': return email;
          case 'STATUS': return 'SEM_SENHA';
          case 'MUST_RESET': return 'Sim';
          case 'CODIGO_TENTATIVAS': return 0;
          case 'FALHAS_LOGIN': return 0;
          case 'HASH_VERSAO': return DP360.HASH_VERSAO;
          case 'ATUALIZADO_EM': return agora;
          default: return '';
        }
      }));
    }
  });

  if (novosUsuarios.length) {
    shUsuarios.getRange(shUsuarios.getLastRow() + 1, 1, novosUsuarios.length, hUsu.length).setValues(novosUsuarios);
  }
  if (novosCred.length) {
    shCred.getRange(shCred.getLastRow() + 1, 1, novosCred.length, hCred.length).setValues(novosCred);
  }

  const msg = 'Sincronização (COLABORADORES): ' + novosUsuarios.length + ' novos · ' +
    atualizados + ' atualizados · ' + ignorados + ' ignorados (sem e-mail institucional).';
  _invalidarCacheKernel_();
  _auditar_('SYNC_USUARIOS', '', 'sincronizarUsuariosAPartirDaMaster', true, msg, {});
  return msg;
}


/* ============================================================================================ */
/*  ADMINISTRAÇÃO                                                                                */
/* ============================================================================================ */

function promoverUsuario(email, perfil) {
  _invalidarCacheKernel_();
  email = _normalizarEmail_(email);
  perfil = String(perfil || '').toUpperCase().trim();

  const validos = ['GESTOR', 'DP', 'ADMIN', 'DIRETORIA'];
  if (validos.indexOf(perfil) === -1) {
    throw new Error('Perfil inválido. Use: ' + validos.join(', '));
  }

  const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
  const h = _headers_(sh);
  const row = _rowByEmail_(sh, email);

  if (!row) throw new Error('Usuário não encontrado: ' + email);

  _setByHeader_(sh, row, h, 'PERFIL', perfil);
  _setByHeader_(sh, row, h, 'PODE_LOGAR', 'Sim');
  _setByHeader_(sh, row, h, 'ATIVO', 'Sim');
  _setByHeader_(sh, row, h, 'ATUALIZADO_EM', new Date());

  _invalidarCacheKernel_();
  _auditar_('PERFIL_ALTERADO', email, 'promoverUsuario', true, 'Perfil definido como ' + perfil, {});

  return email + ' agora é ' + perfil + '.';
}

/* ============================================================================================ */
/*  MÓDULOS (CÉLULAS) — cada pessoa do DP cuida de um ou mais módulos                            */
/* ============================================================================================ */

/**
 * Define quais módulos uma pessoa do DP cuida.
 *   definirModulos('ferias.pessoa@cieds.org.br', 'FERIAS')
 *   definirModulos('multi@cieds.org.br', 'FERIAS, ADMISSAO')
 * Passar '' remove todos (a pessoa deixa de ver qualquer módulo do DP).
 *
 * A pessoa continua com perfil DP; o que muda é QUAIS módulos ela enxerga.
 * ADMIN e GESTOR ignoram isto (ADMIN vê tudo; GESTOR tem o filtro de equipe).
 */
function definirModulos(email, modulos) {
  _invalidarCacheKernel_();
  email = _normalizarEmail_(email);

  const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
  const h = _headers_(sh);

  if (h.indexOf('MODULOS') === -1) {
    throw new Error('A coluna MODULOS não existe na aba USUARIOS. Rode migrarColunaModulos() uma vez.');
  }

  const row = _rowByEmail_(sh, email);
  if (!row) throw new Error('Usuário não encontrado: ' + email);

  const norm = String(modulos || '')
    .split(/[,;]/)
    .map(s => _normalizarModulo_(s))
    .filter(Boolean)
    .join(', ');

  _setByHeader_(sh, row, h, 'MODULOS', norm);
  _setByHeader_(sh, row, h, 'ATUALIZADO_EM', new Date());

  _invalidarCacheKernel_();
  _auditar_('MODULOS_DEFINIDOS', email, 'definirModulos', true, 'Módulos: ' + (norm || '(nenhum)'), {});

  return email + ' agora cuida dos módulos: ' + (norm || '(nenhum)');
}

/** Garante que a coluna MODULOS existe na posição prevista, antes de CRIADO_EM. */
function migrarColunaModulos() {
  const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
  const h = _headers_(sh);

  if (h.indexOf('MODULOS') > -1) return 'A coluna MODULOS já existe. Nada a fazer.';

  const idxCriadoEm = h.indexOf('CRIADO_EM');
  const col = idxCriadoEm > -1 ? idxCriadoEm + 1 : sh.getLastColumn() + 1;

  if (idxCriadoEm > -1) {
    sh.insertColumnBefore(col);
  } else {
    sh.insertColumnAfter(sh.getLastColumn());
  }

  sh.getRange(1, col).setValue('MODULOS');
  _invalidarCacheKernel_();

  return 'Coluna MODULOS criada na posição ' + col + '. Agora use definirModulos() para cada pessoa do DP.';
}

/**
 * Corrige a migração antiga que acrescentou MODULOS no fim da aba e depois reescreveu apenas
 * o cabeçalho. O sintoma é uma data em MODULOS, com os valores reais dos módulos em OBSERVACAO.
 *
 * A função é idempotente: só altera linhas em que MODULOS contém uma data e cria uma cópia
 * integral da aba USUARIOS antes da primeira escrita.
 */
function corrigirEstruturaModulosUsuarios() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    _invalidarCacheKernel_();
    const ss = _configSS_();
    const sh = ss.getSheetByName(DP360.SHEETS.USUARIOS);
    if (!sh) throw new Error('Aba USUARIOS não encontrada.');

    const esperados = DP360.HEADERS.USUARIOS.slice();
    const atuais = sh.getRange(1, 1, 1, esperados.length).getValues()[0]
      .map(value => String(value || '').trim());
    const cabecalhoCorreto = esperados.every((header, index) => atuais[index] === header);
    if (!cabecalhoCorreto) {
      throw new Error('Cabeçalho de USUARIOS diferente do esperado. Nenhum dado foi alterado.');
    }

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, corrigidas: 0, mensagem: 'Aba USUARIOS sem dados.' };

    const range = sh.getRange(2, 1, lastRow - 1, esperados.length);
    const linhas = range.getValues();
    const idx = {};
    esperados.forEach((header, index) => { idx[header] = index; });

    let corrigidas = 0;
    const detalhes = [];

    linhas.forEach(linha => {
      const valorModulos = linha[idx.MODULOS];
      const valorCriado = linha[idx.CRIADO_EM];
      const valorAtualizado = linha[idx.ATUALIZADO_EM];

      // Na estrutura quebrada: J=CRIADO_EM antigo, K=ATUALIZADO_EM antigo,
      // L=ATUALIZADO_EM atual e M=MODULOS antigo (ou uma observação real).
      const desalinhada = _usuariosPareceData_(valorModulos) &&
        (_usuariosPareceData_(valorCriado) || _usuariosPareceData_(valorAtualizado));
      if (!desalinhada) return;

      const cauda = linha[idx.OBSERVACAO];
      const lista = _usuariosReconhecerModulos_(cauda);
      const email = _normalizarEmail_(linha[idx.EMAIL]);

      linha[idx.MODULOS] = lista.reconhecida ? lista.valor : '';
      linha[idx.CRIADO_EM] = valorModulos;
      linha[idx.ATUALIZADO_EM] = _usuariosPareceData_(valorAtualizado)
        ? valorAtualizado
        : (_usuariosPareceData_(valorCriado) ? valorCriado : new Date());
      linha[idx.OBSERVACAO] = lista.reconhecida ? '' : cauda;

      corrigidas++;
      detalhes.push(email || ('linha ' + (corrigidas + 1)));
    });

    if (!corrigidas) {
      return { ok: true, corrigidas: 0, mensagem: 'Nenhuma linha desalinhada encontrada.' };
    }

    const fuso = Session.getScriptTimeZone() || DP360.FUSO;
    const sufixo = Utilities.formatDate(new Date(), fuso, 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
    const backupNome = 'USUARIOS_BKP_' + sufixo;
    const backup = sh.copyTo(ss).setName(backupNome);

    range.setValues(linhas);
    sh.getRange(2, idx.MODULOS + 1, lastRow - 1, 1).setNumberFormat('@');
    SpreadsheetApp.flush();
    _invalidarCacheKernel_();

    try {
      _auditar_('USUARIOS_MODULOS_CORRIGIDOS', '', 'corrigirEstruturaModulosUsuarios', true,
        corrigidas + ' linha(s) realinhada(s). Backup: ' + backupNome + '.', { linhas: detalhes });
    } catch (auditError) {
      console.error('Falha ao registrar auditoria da correção: ' + auditError);
    }

    return {
      ok: true,
      corrigidas: corrigidas,
      backup: backupNome,
      backupSheetId: backup.getSheetId(),
      mensagem: corrigidas + ' linha(s) realinhada(s); backup criado antes da escrita.'
    };
  } finally {
    lock.releaseLock();
  }
}

function _usuariosPareceData_(value) {
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === 'number') return isFinite(value) && value > 20000;

  const text = String(value || '').trim();
  if (!text) return false;

  return /^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(text) ||
    /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s|$)/.test(text);
}

function _usuariosReconhecerModulos_(value) {
  const text = String(value || '').trim();
  if (!text) return { reconhecida: true, valor: '' };

  const disponiveis = Object.keys(_modulosDisponiveis_()).concat(['ADMISSAO', 'TAREFAS'], Object.keys(DP360_SECOES_MODULO));
  const modulos = text.split(/[,;]/)
    .map(item => _normalizarModulo_(item))
    .filter(Boolean);
  const reconhecida = modulos.length > 0 && modulos.every(modulo => disponiveis.indexOf(modulo) > -1);

  return {
    reconhecida: reconhecida,
    valor: reconhecida ? modulos.filter((modulo, index) => modulos.indexOf(modulo) === index).join(', ') : ''
  };
}

/** Acrescenta um módulo sem remover os que a pessoa já possui. */
function adicionarModuloUsuario(email, modulo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    _invalidarCacheKernel_();
    email = _normalizarEmail_(email);
    modulo = _normalizarModulo_(modulo);

    if (Object.keys(_modulosDisponiveis_()).indexOf(modulo) === -1 && !DP360_SECOES_MODULO[modulo]) {
      throw new Error('Módulo inválido ou indisponível: ' + modulo);
    }

    const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
    const headers = _headers_(sh);
    const rowNumber = _rowByEmail_(sh, email);
    if (!rowNumber) throw new Error('Usuário não encontrado: ' + email);

    const atual = _rowToObj_(sh, rowNumber, headers);
    const perfil = String(atual.PERFIL || '').trim().toUpperCase();

    if (perfil === 'ADMIN') {
      return { ok: true, alterado: false, email: email, perfil: perfil, modulos: '*', mensagem: 'ADMIN já possui todos os módulos.' };
    }
    if (perfil !== 'DP') {
      throw new Error('Perfil atual é ' + (perfil || '(vazio)') + '; módulos operacionais exigem perfil DP ou ADMIN.');
    }
    if (!_sim_(atual.ATIVO) || !_sim_(atual.PODE_LOGAR)) {
      throw new Error('Usuário inativo ou com login bloqueado. Nenhum acesso foi alterado.');
    }

    const modulos = String(atual.MODULOS || '')
      .split(/[,;]/)
      .map(item => _normalizarModulo_(item))
      .filter(Boolean)
      .filter((item, index, lista) => lista.indexOf(item) === index);
    const alterado = modulos.indexOf(modulo) === -1;
    if (alterado) modulos.push(modulo);

    const valor = modulos.join(', ');
    if (alterado) {
      _atualizarLinha_(sh, rowNumber, headers, { MODULOS: valor, ATUALIZADO_EM: new Date() });
      _invalidarCacheKernel_();
      try {
        _auditar_('MODULO_ADICIONADO', email, 'adicionarModuloUsuario', true,
          'Módulo ' + modulo + ' adicionado sem remover acessos existentes.', { modulos: valor });
      } catch (auditError) {
        console.error('Falha ao registrar auditoria da concessão: ' + auditError);
      }
    }

    return {
      ok: true,
      alterado: alterado,
      email: email,
      perfil: perfil,
      ativo: atual.ATIVO,
      podeLogar: atual.PODE_LOGAR,
      modulos: valor,
      mensagem: alterado ? 'Módulo ' + modulo + ' adicionado.' : 'Módulo ' + modulo + ' já estava concedido.'
    };
  } finally {
    lock.releaseLock();
  }
}

/** Diagnóstico interno e somente leitura do acesso da Thayane; não expõe tokens ou segredos. */
function diagnosticarAcessoThayane() {
  const email = 'thayanepinheiro@cieds.org.br';
  _invalidarCacheKernel_();
  const user = _obterUsuario_(email);
  if (!user) throw new Error('Usuário não encontrado: ' + email);

  const acoes = {
    FERIAS: 'FERIAS.PAINEL_DP',
    AFASTAMENTOS: 'AFASTAMENTOS.FILA',
    RESCISAO: 'RESCISAO.FILA',
    PROCESSOTRAB: 'PROCESSOTRAB.FILA',
    MOVIMENTACAO: 'MOVIMENTACAO.FILA',
    BENEFICIOS: 'BENEFICIOS.LISTAR_REGRAS'
  };
  const acesso = {};
  Object.keys(acoes).forEach(modulo => {
    acesso[modulo] = {
      perfilPermite: _temPermissao_(user.PERFIL, acoes[modulo]),
      acessoFinal: _usuarioPodeAcao_(user, acoes[modulo])
    };
  });

  let painelResumo;
  try {
    const painel = feriasPainelDP(user, {});
    painelResumo = {
      valido: !!(painel && painel.indicadores && Array.isArray(painel.fila) && Array.isArray(painel.abonos)),
      fila: Array.isArray(painel.fila) ? painel.fila.length : null,
      abonos: Array.isArray(painel.abonos) ? painel.abonos.length : null
    };
  } catch (err) {
    painelResumo = { valido: false, erro: err.message || String(err) };
  }

  const out = {
    email: email,
    perfil: String(user.PERFIL || '').toUpperCase(),
    ativo: _sim_(user.ATIVO),
    podeLogar: _sim_(user.PODE_LOGAR),
    modulosGravados: String(user.MODULOS || ''),
    modulosInterpretados: _modulosDoUsuario_(user),
    modulosRegistrados: Object.keys(_modulosDisponiveis_()),
    acesso: acesso,
    painelFerias: painelResumo
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/** Lista as pessoas do DP e os módulos que cada uma cuida. */
function listarEquipeDP() {
  const usuarios = _usuariosTabela_().filter(u => {
    const perfil = String(u.PERFIL || '').toUpperCase();
    return perfil === 'DP' || perfil === 'ADMIN';
  });

  console.log('Equipe do DP:');
  usuarios.forEach(u => {
    const perfil = String(u.PERFIL).toUpperCase();
    const mods = perfil === 'ADMIN' ? 'TODOS (admin)' : (String(u.MODULOS || '').trim() || '(nenhum — precisa atribuir)');
    console.log('  ' + u.EMAIL + ' [' + perfil + ']: ' + mods);
  });

  return usuarios.map(u => ({
    email: u.EMAIL,
    perfil: String(u.PERFIL).toUpperCase(),
    modulos: String(u.MODULOS || '')
  }));
}

/** Cria usuário que não vem da MASTER (equipe do DP, diretoria). */
function cadastrarUsuarioManual(email, nome, perfil) {
  _invalidarCacheKernel_();
  email = _normalizarEmail_(email);
  _validarDominio_(email);

  const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
  const shCred = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
  const h = _headers_(sh);
  const hCred = _headers_(shCred);
  const agora = new Date();

  if (_rowByEmail_(sh, email)) {
    return promoverUsuario(email, perfil);
  }

  sh.appendRow(h.map(x => {
    switch (x) {
      case 'EMAIL': return email;
      case 'NOME': return nome || '';
      case 'PERFIL': return String(perfil || 'DP').toUpperCase();
      case 'ATIVO': return 'Sim';
      case 'DOMINIO': return _dominio_(email);
      case 'PODE_LOGAR': return 'Sim';
      case 'ORIGEM': return 'MANUAL';
      case 'QTD_SUBORDINADOS': return 0;
      case 'CRIADO_EM': return agora;
      case 'ATUALIZADO_EM': return agora;
      default: return '';
    }
  }));

  if (!_rowByEmail_(shCred, email)) {
    shCred.appendRow(hCred.map(x => {
      switch (x) {
        case 'EMAIL': return email;
        case 'STATUS': return 'SEM_SENHA';
        case 'MUST_RESET': return 'Sim';
        case 'CODIGO_TENTATIVAS': return 0;
        case 'FALHAS_LOGIN': return 0;
        case 'HASH_VERSAO': return DP360.HASH_VERSAO;
        case 'ATUALIZADO_EM': return agora;
        default: return '';
      }
    }));
  }

  _invalidarCacheKernel_();
  _auditar_('USUARIO_MANUAL', email, 'cadastrarUsuarioManual', true, 'Usuário criado manualmente.', {});

  return 'Usuário ' + email + ' criado como ' + String(perfil || 'DP').toUpperCase() + '.';
}

function desativarUsuario(email) {
  _invalidarCacheKernel_();
  email = _normalizarEmail_(email);

  const sh = _configSS_().getSheetByName(DP360.SHEETS.USUARIOS);
  const h = _headers_(sh);
  const row = _rowByEmail_(sh, email);

  if (!row) throw new Error('Usuário não encontrado: ' + email);

  _setByHeader_(sh, row, h, 'ATIVO', 'Não');
  _setByHeader_(sh, row, h, 'PODE_LOGAR', 'Não');
  _setByHeader_(sh, row, h, 'ATUALIZADO_EM', new Date());

  _invalidarCacheKernel_();
  _revogarTodasSessoesDoEmail_(email);
  _auditar_('USUARIO_DESATIVADO', email, 'desativarUsuario', true, 'Usuário desativado e sessões revogadas.', {});

  return email + ' desativado.';
}

/* ============================================================================================ */
/*  AUTENTICAÇÃO / CADASTRO DE SENHA                                                             */
/* ============================================================================================ */

function solicitarCodigoCadastro(email) {
  email = _normalizarEmail_(email);
  _validarDominio_(email);

  // Resposta sempre igual: não revela se o e-mail é gestor ou não.
  const respostaNeutra = {
    ok: true,
    mensagem: 'Se este e-mail estiver liberado no DP360, enviamos um código válido por ' +
      DP360.CODIGO_TTL_MINUTOS + ' minutos.'
  };

  const user = _obterUsuario_(email);

  if (!user || !_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) {
    _auditar_('CODIGO_NEGADO', email, 'solicitarCodigoCadastro', false, 'E-mail sem acesso.', {});
    return respostaNeutra;
  }

  // [FIX-7] Throttle: no máximo N envios por hora por e-mail (protege a cota de e-mail).
  if (!_permitirEnvioCodigo_(email)) {
    _auditar_('CODIGO_THROTTLE', email, 'solicitarCodigoCadastro', false, 'Excesso de solicitações.', {});
    return respostaNeutra;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const codigo = _codigo6_();
    const sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
    const h = _headers_(sh);
    const row = _rowByEmail_(sh, email);

    if (!row) return respostaNeutra;

    const patch = {
      CODIGO_HASH: _hashCodigo_(email, codigo),
      CODIGO_EXPIRA_EM: _addMinutos_(new Date(), DP360.CODIGO_TTL_MINUTOS),
      CODIGO_TENTATIVAS: 0,
      ATUALIZADO_EM: new Date()
    };

    _atualizarLinha_(sh, row, h, patch);

    MailApp.sendEmail({
      to: email,
      subject: 'Código de acesso ao Portal · CIEDS',
      htmlBody: _emailCodigoHtml_(user.NOME || email, codigo)
    });

    _auditar_('CODIGO_ENVIADO', email, 'solicitarCodigoCadastro', true, 'Código enviado.', {});

    return respostaNeutra;

  } finally {
    lock.releaseLock();
  }
}

function confirmarCadastroSenha(email, codigo, senha) {
  email = _normalizarEmail_(email);
  _validarDominio_(email);
  _validarSenhaForte_(senha);

  codigo = String(codigo || '').trim();
  if (!/^\d{6}$/.test(codigo)) {
    throw new Error('Código inválido. Informe os 6 números recebidos por e-mail.');
  }

  const user = _obterUsuario_(email);
  if (!user || !_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) {
    throw new Error('Usuário sem permissão de acesso ao DP360.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
    const h = _headers_(sh);
    const row = _rowByEmail_(sh, email);

    if (!row) throw new Error('Credencial não encontrada.');

    const cred = _rowToObj_(sh, row, h);

    if (!cred.CODIGO_HASH || !cred.CODIGO_EXPIRA_EM) {
      throw new Error('Solicite um novo código antes de cadastrar a senha.');
    }

    if (new Date(cred.CODIGO_EXPIRA_EM).getTime() < Date.now()) {
      throw new Error('Código expirado. Solicite um novo código.');
    }

    const tentativas = Number(cred.CODIGO_TENTATIVAS || 0);

    if (tentativas >= DP360.CODIGO_MAX_TENTATIVAS) {
      throw new Error('Muitas tentativas de código. Solicite um novo código.');
    }

    if (!_constantTimeEqual_(String(cred.CODIGO_HASH || ''), _hashCodigo_(email, codigo))) {
      _atualizarLinha_(sh, row, h, { CODIGO_TENTATIVAS: tentativas + 1, ATUALIZADO_EM: new Date() });
      _auditar_('CODIGO_INVALIDO', email, 'confirmarCadastroSenha', false, 'Código incorreto.', { tentativas: tentativas + 1 });
      throw new Error('Código inválido. Confira o e-mail recebido e tente novamente.');
    }

    const salt = _uuid_();

    _atualizarLinha_(sh, row, h, {
      SALT: salt,
      PASSWORD_HASH: _hashSenha_(email, senha, salt),
      HASH_VERSAO: DP360.HASH_VERSAO,
      STATUS: 'ATIVA',
      MUST_RESET: 'Não',
      ULTIMA_TROCA_EM: new Date(),
      CODIGO_HASH: '',
      CODIGO_EXPIRA_EM: '',
      CODIGO_TENTATIVAS: 0,
      FALHAS_LOGIN: 0,
      BLOQUEADO_ATE: '',
      ATUALIZADO_EM: new Date()
    });

    // Trocar de senha derruba as sessões antigas.
    _revogarTodasSessoesDoEmail_(email);

    _auditar_('CADASTRO_SENHA', email, 'confirmarCadastroSenha', true, 'Senha cadastrada/redefinida.', {});

    return { ok: true, mensagem: 'Senha cadastrada com sucesso. Você já pode entrar no DP360.' };

  } finally {
    lock.releaseLock();
  }
}

function autenticar(email, senha, origem) {
  email = _normalizarEmail_(email);
  _validarDominio_(email);

  const generico = 'E-mail ou senha inválidos.';

  const user = _obterUsuario_(email);

  if (!user || !_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) {
    _auditar_('LOGIN_NEGADO', email, 'autenticar', false, 'Usuário inexistente ou sem acesso.', {});
    throw new Error(generico);
  }

  if (origem === 'PORTAL_DP' && DP360.PERFIS_PORTAL_DP.indexOf(String(user.PERFIL || '').toUpperCase()) === -1) {
    _auditar_('LOGIN_NEGADO', email, 'autenticar', false, 'Perfil sem acesso ao Portal do DP.', { perfil: user.PERFIL });
    throw new Error('Este perfil não tem acesso ao Portal do DP.');
  }

  const sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
  const h = _headers_(sh);
  const row = _rowByEmail_(sh, email);

  if (!row) throw new Error(generico);

  const cred = _rowToObj_(sh, row, h);

  if (String(cred.STATUS || '') !== 'ATIVA' || !cred.PASSWORD_HASH || !cred.SALT) {
    throw new Error('Senha ainda não cadastrada. Use "Primeiro acesso / esqueci minha senha".');
  }

  if (cred.BLOQUEADO_ATE && new Date(cred.BLOQUEADO_ATE).getTime() > Date.now()) {
    throw new Error('Acesso temporariamente bloqueado por tentativas inválidas. Tente novamente em alguns minutos.');
  }

  const hashInformado = _hashSenha_(email, senha, cred.SALT, Number(cred.HASH_VERSAO || 1));

  if (!_constantTimeEqual_(String(cred.PASSWORD_HASH || ''), hashInformado)) {
    const falhas = Number(cred.FALHAS_LOGIN || 0) + 1;
    const patch = { FALHAS_LOGIN: falhas, ATUALIZADO_EM: new Date() };

    if (falhas >= DP360.MAX_TENTATIVAS_LOGIN) {
      patch.BLOQUEADO_ATE = _addMinutos_(new Date(), DP360.BLOQUEIO_LOGIN_MINUTOS);
      _atualizarLinha_(sh, row, h, patch);
      _auditar_('LOGIN_BLOQUEADO', email, 'autenticar', false, 'Bloqueado por tentativas inválidas.', { falhas: falhas });
      throw new Error('Muitas tentativas inválidas. O acesso foi bloqueado temporariamente.');
    }

    _atualizarLinha_(sh, row, h, patch);
    _auditar_('LOGIN_FALHA', email, 'autenticar', false, 'Senha inválida.', { falhas: falhas });
    throw new Error(generico);
  }

  // [PERF] Só escreve se havia falha para limpar. Escrita à toa = ida à rede à toa.
  if (Number(cred.FALHAS_LOGIN || 0) > 0 || cred.BLOQUEADO_ATE) {
    _atualizarLinha_(sh, row, h, { FALHAS_LOGIN: 0, BLOQUEADO_ATE: '', ATUALIZADO_EM: new Date() });
  }

  const tokenObj = _emitirToken_(user);
  _registrarSessao_(email, tokenObj, origem);

  _auditar_('LOGIN_OK', email, 'autenticar', true, 'Login realizado.', { perfil: user.PERFIL, origem: origem || '' });

  return {
    ok: true,
    token: tokenObj.token,
    expiraEm: tokenObj.expiraEm,
    usuario: _usuarioPublico_(user),
    mensagem: 'Login realizado com sucesso.'
  };
}

function logout(token) {
  let payload = null;

  try {
    payload = _validarTokenOuErro_(token);
  } catch (e) {
    return { ok: true }; // logout é idempotente
  }

  _revogarJti_(payload.jti, payload.exp);
  _marcarSessaoEncerrada_(payload.jti);
  _auditar_('LOGOUT', payload.email, 'logout', true, 'Sessão encerrada.', {});

  return { ok: true, mensagem: 'Sessão encerrada.' };
}

function validarToken(token) {
  const payload = _validarTokenOuErro_(token);
  return { ok: true, payload: payload, usuario: _usuarioPublico_(_obterUsuario_(payload.email)) };
}

function contexto(token) {
  const payload = _validarTokenOuErro_(token);
  const user = _obterUsuario_(payload.email);

  if (!user) throw new Error('Usuário do token não encontrado.');
  if (!_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) throw new Error('Usuário sem permissão de acesso.');

  return {
    ok: true,
    sistema: DP360.SISTEMA,
    versao: DP360.VERSAO,
    usuario: _usuarioPublico_(user),
    permissoes: _permissoesDoPerfil_(user.PERFIL),
    escopo: _escopoDoUsuario_(user),
    expiraEm: new Date(Number(payload.exp) * 1000),
    agora: _agoraISO_()
  };
}


/* ============================================================================================ */
/*  REGISTRO DE MÓDULOS — o kernel não conhece nenhum módulo por dentro                          */
/* ============================================================================================ */
/*
 * Para plugar um módulo novo (RESCISAO, ADMISSAO...), basta criar o arquivo com duas funções:
 *
 *    rescisaoResumo(user)            → { pendencias, contadores, itens: [...] }   (leve, para o painel)
 *    rescisaoContexto(user, payload) → dados completos da tela                    (pesado, sob demanda)
 *
 * E acrescentar UMA linha em _modulosDisponiveis_(). O kernel e o portal não mudam.
 */

function _modulosDisponiveis_() {
  const m = {};

  if (typeof feriasResumo === 'function') {
    m.FERIAS = {
      nome: 'Férias',
      permissao: 'FERIAS.CONTEXTO',
      resumo: feriasResumo,        // leve, quando o módulo não está aberto
      resumoDe: feriasResumoDe,    // deriva o resumo de um contexto já calculado
      contexto: feriasContexto
    };
  }

  if (typeof afastResumo === 'function') {
    m.AFASTAMENTOS = {
      nome: 'Afastamentos',
      permissao: 'AFASTAMENTOS.CONTEXTO',
      resumo: afastResumo,
      resumoDe: afastResumoDe,
      contexto: afastContexto
    };
  }

  if (typeof rescResumo === 'function') {
    m.RESCISAO = {
      nome: 'Rescisão',
      permissao: 'RESCISAO.CONTEXTO',
      resumo: rescResumo,
      resumoDe: rescResumoDe,
      contexto: rescContexto
    };
  }

  if (typeof procTrabResumo === 'function') {
    m.PROCESSOTRAB = {
      nome: 'Processo Trabalhista',
      permissao: 'PROCESSOTRAB.CONTEXTO',
      resumo: procTrabResumo,
      resumoDe: procTrabResumoDe,
      contexto: procTrabContexto
    };
  }

  if (typeof movResumo === 'function') {
    m.MOVIMENTACAO = {
      nome: 'Movimentações',
      permissao: 'MOVIMENTACAO.CONTEXTO',
      resumo: movResumo,
      resumoDe: movResumoDe,
      contexto: movContexto
    };
  }

  if (typeof beneficiosResumo === 'function') {
    m.BENEFICIOS = {
      nome: 'Benefícios',
      permissao: 'BENEFICIOS.CONTEXTO',
      resumo: beneficiosResumo,
      resumoDe: beneficiosResumoDe,
      contexto: beneficiosContexto
    };
  }

  if (typeof admResumo === 'function') {
    m.ADMISSAO = {
      nome: 'Admissões',
      permissao: 'ADMISSAO.CONTEXTO',
      resumo: admResumo,
      resumoDe: admResumoDe,
      contexto: admContexto
    };
  }

  return m;
}

/**
 * CARGA — a única chamada que o portal faz.
 *
 * payload:
 *   { modulo: 'FERIAS', visao: 'GESTOR'|'GLOBAL' }   → traz o contexto completo DESSE módulo
 *   { }                                              → traz só usuário + permissões + resumos
 *
 * Os resumos são leves: contadores para o painel. O contexto pesado só vem do módulo pedido.
 */
function carga(token, p) {
  p = p || {};

  const sess = _validarTokenOuErro_(token);
  const user = _obterUsuario_(sess.email);

  if (!user) throw new Error('Usuário não encontrado.');
  if (!_sim_(user.ATIVO) || !_sim_(user.PODE_LOGAR)) throw new Error('Usuário sem permissão de acesso.');

  const perfil = String(user.PERFIL || '').toUpperCase();
  const visaoPedida = String(p.visao || 'GESTOR').trim().toUpperCase();
  const podeUsarVisaoGlobal = perfil === 'DP' || perfil === 'ADMIN';

  // A visao global e exclusiva do Portal do DP. No Portal Gestor, inclusive quando
  // a pessoa tambem possui perfil DP/ADMIN, o escopo deve continuar sendo a propria equipe.
  p.visao = (visaoPedida === 'GLOBAL' && podeUsarVisaoGlobal) ? 'GLOBAL' : 'GESTOR';
  const registrados = _modulosDisponiveis_();

  const pedido = String(p.modulo || '').toUpperCase();

  const modulos = {};
  const resumos = {};

  let contextoPedido = null;

  // [PERF] Os resumos dos módulos que NÃO são o pedido nesta requisição (os números de
  // badge do menu lateral) não precisam ser recalculados a cada navegação — eles não mudam
  // de um clique pro outro. Ficam em cache por 90s, por usuário. O módulo realmente aberto
  // sempre é calculado fresco (seu contexto já precisa ser buscado de qualquer forma).
  const cache = CacheService.getScriptCache();
  // O resumo de uma visao nunca pode reaparecer na outra. Antes, GLOBAL e GESTOR
  // compartilhavam a mesma chave por 90s e os totais da organizacao vazavam para a equipe.
  const chaveCache = 'RESUMOS_V2_' +
    Utilities.base64EncodeWebSafe(_normalizarEmail_(user.EMAIL)).replace(/=+$/, '') +
    '_' + p.visao;
  let resumosEmCache = null;
  try {
    const bruto = cache.get(chaveCache);
    if (bruto) resumosEmCache = JSON.parse(bruto);
  } catch (e) { resumosEmCache = null; }

  Object.keys(registrados).forEach(id => {
    const m = registrados[id];
    const liberado = _usuarioPodeAcao_(user, m.permissao);

    modulos[id] = { id: id, nome: m.nome, liberado: liberado };

    if (!liberado) return;

    try {
      // [PERF] Se é o módulo aberto, calcula o contexto UMA vez e deriva o resumo dele.
      // Antes, o contexto era calculado duas vezes (uma no resumo, outra no contexto).
      if (id === pedido && typeof m.resumoDe === 'function') {
        contextoPedido = m.contexto(user, p);
        resumos[id] = m.resumoDe(contextoPedido);
      } else if (resumosEmCache && resumosEmCache[id] && !resumosEmCache[id].erro) {
        resumos[id] = resumosEmCache[id]; // reaproveita, não é o módulo sendo aberto agora
      } else {
        resumos[id] = m.resumo(user, p);
      }
    } catch (e) {
      resumos[id] = { erro: e.message };
      console.error('Resumo de ' + id + ' falhou: ' + e);
    }
  });

  try {
    cache.put(chaveCache, JSON.stringify(resumos), 90);
  } catch (e) {
    console.error('Não deu pra cachear os resumos (seguindo sem cache): ' + e);
  }

  const out = {
    ok: true,
    sistema: DP360.SISTEMA,
    versao: DP360.VERSAO,
    usuario: _usuarioPublico_(user),
    permissoes: _permissoesDoPerfil_(perfil),
    escopo: _escopoDoUsuario_(user),
    modulos: modulos,
    resumos: resumos,
    agora: _agoraISO_()
  };

  if (pedido) {
    const m = registrados[pedido];

    if (!m) throw new Error('Módulo desconhecido: ' + pedido);
    if (!_usuarioPodeAcao_(user, m.permissao)) throw new Error('Sem permissão para o módulo ' + pedido + '.');

    out.contexto = contextoPedido || m.contexto(user, p);
    out.moduloCarregado = pedido;
  }

  return out;
}

/* ============================================================================================ */
/*  TOKEN / SESSÃO — stateless, com revogação em ScriptProperties  [FIX-4]                       */
/* ============================================================================================ */

function _emitirToken_(user) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + DP360.TOKEN_TTL_SEGUNDOS;
  const jti = _uuid_();

  const header = { alg: 'HS256', typ: 'DP360' };

  const payload = {
    iss: 'DP360_API',
    aud: 'DP360_PORTAIS',
    email: _normalizarEmail_(user.EMAIL),
    perfil: String(user.PERFIL || 'GESTOR').toUpperCase(),
    iat: now,
    exp: exp,
    jti: jti,
    v: DP360.VERSAO
  };

  const h64 = _base64Url_(JSON.stringify(header));
  const p64 = _base64Url_(JSON.stringify(payload));
  const assinatura = _hmacSha256Base64Url_(h64 + '.' + p64, _tokenSecret_());

  return {
    token: h64 + '.' + p64 + '.' + assinatura,
    jti: jti,
    payload: payload,
    criadoEm: new Date(now * 1000),
    expiraEm: new Date(exp * 1000)
  };
}

function _validarTokenOuErro_(token) {
  token = String(token || '').trim();
  if (!token) throw new Error('Token não informado.');

  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('Token inválido.');

  const esperada = _hmacSha256Base64Url_(partes[0] + '.' + partes[1], _tokenSecret_());
  if (!_constantTimeEqual_(esperada, partes[2])) throw new Error('Token inválido ou adulterado.');

  let payload;
  try {
    payload = JSON.parse(_base64UrlDecodeToString_(partes[1]));
  } catch (err) {
    throw new Error('Payload do token inválido.');
  }

  const agora = Math.floor(Date.now() / 1000);

  if (!payload.exp || Number(payload.exp) < agora) throw new Error('Sessão expirada. Faça login novamente.');
  if (!payload.email || !payload.jti) throw new Error('Token sem identificação válida.');
  if (_jtiRevogado_(payload.jti)) throw new Error('Sessão encerrada. Faça login novamente.');

  return payload;
}

function _revogados_() {
  const raw = PropertiesService.getScriptProperties().getProperty(DP360.PROPS.REVOGADOS);

  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function _jtiRevogado_(jti) {
  return Object.prototype.hasOwnProperty.call(_revogados_(), String(jti));
}

function _revogarJti_(jti, exp) {
  const props = PropertiesService.getScriptProperties();
  const mapa = _revogados_();
  const agora = Math.floor(Date.now() / 1000);

  // Poda: token expirado não precisa mais ficar na lista de revogados.
  Object.keys(mapa).forEach(k => {
    if (Number(mapa[k]) < agora) delete mapa[k];
  });

  mapa[String(jti)] = Number(exp) || (agora + DP360.TOKEN_TTL_SEGUNDOS);

  props.setProperty(DP360.PROPS.REVOGADOS, JSON.stringify(mapa));
}

function _revogarTodasSessoesDoEmail_(email) {
  email = _normalizarEmail_(email);

  const sh = _configSS_().getSheetByName(DP360.SHEETS.SESSOES);
  const h = _headers_(sh);
  const sessoes = _sheetToObjects_(sh);
  const agora = Date.now();

  sessoes.forEach(s => {
    if (_normalizarEmail_(s.EMAIL) !== email) return;
    if (String(s.STATUS || '') !== 'ATIVA') return;
    if (s.EXPIRA_EM && new Date(s.EXPIRA_EM).getTime() < agora) return;

    _revogarJti_(s.JTI, Math.floor(new Date(s.EXPIRA_EM).getTime() / 1000));
    _setByHeader_(sh, s._rowNumber, h, 'STATUS', 'REVOGADA');
  });
}

function _marcarSessaoEncerrada_(jti) {
  const sh = _configSS_().getSheetByName(DP360.SHEETS.SESSOES);
  const h = _headers_(sh);
  const sessoes = _sheetToObjects_(sh);

  const s = sessoes.find(x => String(x.JTI) === String(jti));
  if (s) _setByHeader_(sh, s._rowNumber, h, 'STATUS', 'ENCERRADA');
}

/** A aba SESSOES é LOG. Nunca é lida para validar token (isso é O(1) via HMAC + revogados). */
function _registrarSessao_(email, tokenObj, origem) {
  const sh = _configSS_().getSheetByName(DP360.SHEETS.SESSOES);

  sh.appendRow([
    tokenObj.jti,
    email,
    tokenObj.criadoEm,
    tokenObj.expiraEm,
    'ATIVA',
    origem || ''
  ]);
}

/* ============================================================================================ */
/*  PERMISSÕES / CONTEXTO                                                                        */
/* ============================================================================================ */

function _permissoesDoPerfil_(perfil) {
  perfil = String(perfil || '').toUpperCase();

  return _permissoesTabela_()
    .filter(r => String(r.PERFIL || '').toUpperCase() === perfil && _sim_(r.PERMITIDO))
    .map(r => ({ acao: r.ACAO, escopo: r.ESCOPO, descricao: r.DESCRICAO }));
}

function _temPermissao_(perfil, acao) {
  perfil = String(perfil || '').toUpperCase();
  acao = String(acao || '').toUpperCase();

  if (!acao) return false;

  const perms = _permissoesDoPerfil_(perfil).map(p => String(p.acao || '').toUpperCase());

  if (perms.indexOf('*') > -1) return true;
  if (perms.indexOf(acao) > -1) return true;

  return perms.some(p => p.endsWith('.*') && acao.indexOf(p.replace('.*', '.')) === 0);
}

/**
 * Os módulos (células) que uma pessoa cuida.
 *   ADMIN                       → ['*']  (todos)
 *   DP com MODULOS = "FERIAS,ADMISSAO" → ['FERIAS','ADMISSAO']
 *   DP com MODULOS vazio        → []  (nenhum — precisa ser atribuído)
 *   GESTOR                      → ['*'] no seu escopo (o filtro de equipe cuida do resto)
 */
function _modulosDoUsuario_(user) {
  const perfil = String(user.PERFIL || '').toUpperCase();

  if (perfil === 'ADMIN') return ['*'];
  if (perfil === 'GESTOR' || perfil === 'DIRETORIA') return ['*'];

  // DP: lê a coluna MODULOS. Sem ela preenchida, não vê módulo nenhum.
  const bruto = String(user.MODULOS || '').trim();
  if (!bruto) return [];

  return bruto.split(/[,;]/).map(s => _normalizarModulo_(s)).filter(Boolean);
}

/**
 * Acessos PARCIAIS a um módulo. Em MODULOS, um item "MODULO.SECAO" libera só as ações daquela
 * seção, sem o resto do módulo. Ex.: "RESCISAO.HOMOLOGACAO" dá a aba Homologação da Rescisão
 * (lista, documentos, Autentique, baixar/arquivar), mas não a fila, agendamento, conciliação,
 * nova rescisão nem rescisão complementar. Quem tem o módulo inteiro ("RESCISAO") segue com tudo.
 */
const DP360_SECOES_MODULO = {
  'RESCISAO.HOMOLOGACAO': [
    'RESCISAO.HOMOLOGACAO_LISTA',
    'RESCISAO.VER_DOCUMENTOS_HOMOLOGACAO',
    'RESCISAO.ENVIAR_HOMOLOGACAO_AUTENTIQUE',
    'RESCISAO.ENVIAR_TODAS_HOMOLOGACOES_AUTENTIQUE',
    'RESCISAO.BAIXAR_TODAS_HOMOLOGACOES_AUTENTIQUE',
    'RESCISAO.CANCELAR_HOMOLOGACAO_AUTENTIQUE',
    'RESCISAO.VERIFICAR_ASSINATURA_HOMOLOGACAO',
    'RESCISAO.VERIFICAR_TODAS_ASSINATURAS_HOMOLOGACAO',
    'RESCISAO.BAIXAR_ARQUIVAR_HOMOLOGACAO'
  ]
};

function _normalizarModulo_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase();
}

/**
 * Decisão final de acesso: cruza o PERFIL (o que o cargo permite) com os MÓDULOS
 * que a pessoa cuida. É isto que os módulos e o kernel devem usar.
 *
 * Ex.: uma DP com MODULOS="FERIAS" tem perfil DP (que permite tudo de DP),
 *      mas só enxerga FERIAS.* — as ações de AFASTAMENTOS.* são negadas para ela.
 */
function _usuarioPodeAcao_(user, acao) {
  acao = String(acao || '').toUpperCase();

  // 1) o perfil precisa permitir
  if (!_temPermissao_(user.PERFIL, acao)) return false;

  // 2) e o módulo da ação precisa estar entre os que a pessoa cuida
  const mods = _modulosDoUsuario_(user);
  if (mods.indexOf('*') > -1) return true;

  // ações globais (sem módulo, ex.: CONTEXTO, CARGA) passam se o perfil permite
  const modAlvo = acao.indexOf('.') > -1 ? acao.split('.')[0] : '';
  if (!modAlvo) return true;

  if (mods.indexOf(modAlvo) > -1) return true;

  // acesso parcial (ex.: "RESCISAO.HOMOLOGACAO"): só as ações daquela seção
  return mods.some(m => (DP360_SECOES_MODULO[m] || []).indexOf(acao) > -1);
}

function _escopoDoUsuario_(user) {
  const perfil = String(user.PERFIL || '').toUpperCase();

  if (perfil === 'GESTOR') {
    return {
      tipo: 'GESTOR',
      gestorEmail: _normalizarEmail_(user.EMAIL),
      qtdSubordinados: Number(user.QTD_SUBORDINADOS || 0)
    };
  }

  return { tipo: 'GLOBAL', perfil: perfil };
}

/**
 * [PERF] Estas abas eram relidas a cada chamada de _temPermissao_ / _obterUsuario_.
 * Numa única requisição isso dava 5-8 leituras de planilha. Agora é 1 de cada.
 */
var _C_USUARIOS_ = null;
var _C_PERMISSOES_ = null;
var _C_SS_CONFIG_ = null;

function _configSSMemo_() {
  if (!_C_SS_CONFIG_) _C_SS_CONFIG_ = _configSS_();
  return _C_SS_CONFIG_;
}

/**
 * [PERF 2026-09-24] Além do memo por execução, usuários e permissões ficam 5 min no
 * CacheService. Antes, TODA requisição de qualquer portal abria a DP360_CONFIG e relia as duas
 * abas, mesmo sem nada ter mudado. As funções deste projeto que gravam nessas abas chamam
 * _invalidarCacheKernel_(), que limpa o cache na hora. Edição feita direto na planilha passa a
 * valer em até 5 minutos (ou na hora, rodando limparCacheUsuarios() no editor).
 * Ninguém usa _rowNumber destes objetos para gravar: as gravações acham a linha pelo e-mail.
 */
const KERNEL_CACHE_SEG = 300;
const KERNEL_CACHE_USUARIOS = 'KERNEL_USUARIOS_V1';
const KERNEL_CACHE_PERMISSOES = 'KERNEL_PERMISSOES_V1';

function _usuariosTabela_() {
  if (!_C_USUARIOS_) {
    _C_USUARIOS_ = _cacheGetZip_(KERNEL_CACHE_USUARIOS);
    if (!Array.isArray(_C_USUARIOS_)) {
      _C_USUARIOS_ = _sheetToObjects_(_configSSMemo_().getSheetByName(DP360.SHEETS.USUARIOS));
      _cachePutZip_(KERNEL_CACHE_USUARIOS, _C_USUARIOS_, KERNEL_CACHE_SEG);
    }
  }
  return _C_USUARIOS_;
}

function _permissoesTabela_() {
  if (!_C_PERMISSOES_) {
    _C_PERMISSOES_ = _cacheGetZip_(KERNEL_CACHE_PERMISSOES);
    if (!Array.isArray(_C_PERMISSOES_)) {
      _C_PERMISSOES_ = _sheetToObjects_(_configSSMemo_().getSheetByName(DP360.SHEETS.PERMISSOES));
      _cachePutZip_(KERNEL_CACHE_PERMISSOES, _C_PERMISSOES_, KERNEL_CACHE_SEG);
    }
  }
  return _C_PERMISSOES_;
}

function _invalidarCacheKernel_() {
  _C_USUARIOS_ = null;
  _C_PERMISSOES_ = null;
  _C_SS_CONFIG_ = null;
  _cacheRemoverZip_(KERNEL_CACHE_USUARIOS);
  _cacheRemoverZip_(KERNEL_CACHE_PERMISSOES);
}

/** Para rodar no editor depois de mexer direto nas abas USUARIOS ou PERMISSOES. */
function limparCacheUsuarios() {
  _invalidarCacheKernel_();
  return 'Cache de usuários e permissões limpo. A próxima requisição relê a planilha.';
}

/* ---- cache comprimido (CacheService) ---- */

/**
 * [PERF 2026-09-24] Guarda respostas grandes no CacheService, que aceita só 100 KB por chave.
 * O JSON vai só com ASCII (acentos viram \uXXXX, então o charset não importa), é compactado
 * com gzip e dividido em pedaços de 90 KB. Cache é otimização: qualquer falha aqui só faz a
 * requisição seguir lendo a planilha, nunca quebra nada.
 */
function _jsonAscii_(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g,
    c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
}

function _cachePutZip_(chave, obj, segundos) {
  try {
    const zip = Utilities.gzip(Utilities.newBlob(_jsonAscii_(obj), 'application/json', 'c.json'));
    const txt = Utilities.base64Encode(zip.getBytes());
    const TAM = 90000;
    const partes = Math.ceil(txt.length / TAM);
    if (partes > 50) return false; // > 4,5 MB compactado: grande demais, segue sem cache

    const mapa = {};
    for (let i = 0; i < partes; i++) mapa[chave + '_' + i] = txt.substr(i * TAM, TAM);
    mapa[chave + '_n'] = String(partes);
    CacheService.getScriptCache().putAll(mapa, segundos);
    return true;
  } catch (e) {
    console.error('Cache comprimido falhou (' + chave + '), seguindo sem cache: ' + e);
    return false;
  }
}

function _cacheGetZip_(chave) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(chave + '_n') || 0);
    if (!n) return null;

    const chaves = [];
    for (let i = 0; i < n; i++) chaves.push(chave + '_' + i);
    const partes = cache.getAll(chaves);

    let txt = '';
    for (let i = 0; i < n; i++) {
      const parte = partes[chave + '_' + i];
      if (!parte) return null; // um pedaço expirou: descarta tudo
      txt += parte;
    }

    const zip = Utilities.newBlob(Utilities.base64Decode(txt), 'application/x-gzip', 'c.json.gz');
    return JSON.parse(Utilities.ungzip(zip).getDataAsString());
  } catch (e) {
    return null;
  }
}

function _cacheRemoverZip_(chave) {
  try { CacheService.getScriptCache().remove(chave + '_n'); } catch (e) { /* segue */ }
}

function _obterUsuario_(email) {
  email = _normalizarEmail_(email);
  return _usuariosTabela_().find(r => _normalizarEmail_(r.EMAIL) === email) || null;
}

function _usuarioPublico_(user) {
  if (!user) return null;

  return {
    email: _normalizarEmail_(user.EMAIL),
    nome: user.NOME || '',
    cargo: user.CARGO || '',
    perfil: String(user.PERFIL || '').toUpperCase(),
    ativo: _sim_(user.ATIVO),
    dominio: user.DOMINIO || _dominio_(user.EMAIL),
    podeLogar: _sim_(user.PODE_LOGAR),
    qtdSubordinados: Number(user.QTD_SUBORDINADOS || 0),
    // Módulos que a pessoa cuida (ADMIN = ['*']). O Portal do DP usa isto para não pedir
    // dados de módulos que a pessoa não tem (cada pedido negado custa uma ida à API).
    modulos: _modulosDoUsuario_(user)
  };
}

/* ============================================================================================ */
/*  AUDITORIA E LIMPEZA                                                                          */
/* ============================================================================================ */

function _auditar_(evento, email, acao, ok, mensagem, detalhe) {
  try {
    _configSS_().getSheetByName(DP360.SHEETS.AUDITORIA).appendRow([
      new Date(),
      evento || '',
      _normalizarEmail_(email || ''),
      acao || '',
      ok ? 'Sim' : 'Não',
      mensagem || '',
      JSON.stringify(detalhe || {}),
      DP360.VERSAO
    ]);
  } catch (err) {
    console.error('Falha ao registrar auditoria: ' + err);
  }
}

/** Gatilho diário sugerido. Evita que SESSOES/AUDITORIA cresçam sem limite. */
function rotinaLimpeza() {
  const ss = _configSS_();
  const agora = Date.now();

  const limpar = (nome, dias) => {
    const sh = ss.getSheetByName(nome);
    const dados = _sheetToObjects_(sh);
    const corte = agora - dias * 24 * 60 * 60 * 1000;
    const campoData = nome === DP360.SHEETS.SESSOES ? 'EXPIRA_EM' : 'DATA_HORA';

    const linhasVelhas = dados
      .filter(r => r[campoData] && new Date(r[campoData]).getTime() < corte)
      .map(r => r._rowNumber)
      .sort((a, b) => b - a);

    linhasVelhas.forEach(row => sh.deleteRow(row));

    return nome + ': ' + linhasVelhas.length + ' linha(s) removida(s).';
  };

  const r = [
    limpar(DP360.SHEETS.SESSOES, DP360.DIAS_RETENCAO_SESSOES),
    limpar(DP360.SHEETS.AUDITORIA, DP360.DIAS_RETENCAO_AUDITORIA)
  ].join(' · ');

  console.log(r);
  return r;
}

function criarGatilhoLimpeza() {
  ScriptApp.newTrigger('rotinaLimpeza').timeBased().everyDays(1).atHour(3).create();
  return 'Gatilho diário de limpeza criado (03h).';
}

/* ============================================================================================ */
/*  UTILITÁRIOS ADMINISTRATIVOS                                                                  */
/* ============================================================================================ */

/** Derruba todas as sessões abertas de um usuário. A senha continua válida. */
function encerrarSessoesDoUsuario(email) {
  email = _normalizarEmail_(email);
  if (!email) throw new Error('Informe o e-mail: encerrarSessoesDoUsuario("nome@cieds.org.br")');

  _revogarTodasSessoesDoEmail_(email);
  _auditar_('SESSOES_ENCERRADAS', email, 'encerrarSessoesDoUsuario', true, 'Sessões revogadas manualmente.', {});

  return 'Sessões de ' + email + ' encerradas.';
}

/** Remove a aba "Página1" que o Sheets cria junto com a DP360_CONFIG. */
function limparAbaPadrao() {
  const ss = _configSS_();
  const p = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');

  if (!p) return 'Nada a remover.';

  ss.deleteSheet(p);
  return 'Aba padrão removida da DP360_CONFIG.';
}

/** Força o usuário a cadastrar senha de novo (não apaga o usuário). */
function resetarSenha(email) {
  email = _normalizarEmail_(email);

  const sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
  const h = _headers_(sh);
  const row = _rowByEmail_(sh, email);

  if (!row) throw new Error('Credencial não encontrada: ' + email);

  _atualizarLinha_(sh, row, h, {
    SALT: '', PASSWORD_HASH: '', STATUS: 'SEM_SENHA', MUST_RESET: 'Sim',
    CODIGO_HASH: '', CODIGO_EXPIRA_EM: '', CODIGO_TENTATIVAS: 0,
    FALHAS_LOGIN: 0, BLOQUEADO_ATE: '', ATUALIZADO_EM: new Date()
  });

  _revogarTodasSessoesDoEmail_(email);
  _auditar_('SENHA_RESETADA', email, 'resetarSenha', true, 'Senha resetada pelo admin.', {});

  return email + ' precisa refazer o "Primeiro acesso".';
}

/* ============================================================================================ */
/*  DIAGNÓSTICO                                                                                  */
/* ============================================================================================ */

function diagnosticarDP360() {
  const master = _masterSS_();
  const config = _configSS_();

  const out = {
    versao: DP360.VERSAO,
    masterId: master.getId(),
    masterAbas: master.getSheets().map(s => s.getName()),
    configId: config.getId(),
    configAbas: config.getSheets().map(s => s.getName()),
    usuarios: Math.max(config.getSheetByName(DP360.SHEETS.USUARIOS).getLastRow() - 1, 0),
    comSenha: _sheetToObjects_(config.getSheetByName(DP360.SHEETS.CREDENCIAIS))
      .filter(c => String(c.STATUS) === 'ATIVA').length,
    sessoes: Math.max(config.getSheetByName(DP360.SHEETS.SESSOES).getLastRow() - 1, 0),
    auditoria: Math.max(config.getSheetByName(DP360.SHEETS.AUDITORIA).getLastRow() - 1, 0),
    tokensRevogados: Object.keys(_revogados_()).length
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/** Imprime os cabeçalhos reais das abas da MASTER — use para conferir o mapeamento. */
function diagnosticarMaster() {
  const master = _masterSS_();

  const out = master.getSheets().map(sh => {
    const cols = sh.getLastColumn();
    const headers = cols ? sh.getRange(1, 1, 1, cols).getValues()[0] : [];

    return {
      aba: sh.getName(),
      linhas: Math.max(sh.getLastRow() - 1, 0),
      cabecalhos: headers.map(h => String(h || '').trim()).filter(Boolean)
    };
  });

  console.log(JSON.stringify(out, null, 2));
  return out;
}

function verSegredoFront() {
  _garantirSegredos_();
  const s = PropertiesService.getScriptProperties().getProperty(DP360.PROPS.SEGREDO_FRONT);
  console.log('SEGREDO_FRONT:\n' + s);
  return s;
}

function regerarSegredoFront() {
  const novo = _uuid_() + _uuid_() + _uuid_();
  PropertiesService.getScriptProperties().setProperty(DP360.PROPS.SEGREDO_FRONT, novo);
  _auditar_('SEGREDO_REGERADO', '', 'regerarSegredoFront', true, 'Segredo do front regerado.', {});
  console.log('Novo SEGREDO_FRONT:\n' + novo);
  return novo;
}

/* ============================================================================================ */
/*  HELPERS DE PLANILHA                                                                          */
/* ============================================================================================ */

/**
 * [FIX-1] O número da linha é capturado ANTES do filtro de linhas vazias.
 * A versão antiga calculava idx+2 depois de filtrar, então qualquer linha em branco
 * no meio da aba deslocava todas as escritas para a linha errada.
 */
function _sheetToObjects_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];

  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const headers = values[0].map(h => String(h || '').trim());

  return values
    .slice(1)
    .map((r, idx) => ({ linha: r, rowNumber: idx + 2 }))
    .filter(x => x.linha.some(c => c !== '' && c !== null && c !== undefined))
    .map(x => {
      const obj = { _rowNumber: x.rowNumber };
      headers.forEach((h, i) => { if (h) obj[h] = x.linha[i]; });
      return obj;
    });
}

function _headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || '').trim());
}

function _rowToObj_(sh, row, headers) {
  const vals = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => obj[h] = vals[i]);
  return obj;
}

function _setByHeader_(sh, row, headers, header, value) {
  const idx = headers.indexOf(header);
  if (idx === -1) throw new Error('Cabeçalho não encontrado: ' + header + ' na aba ' + sh.getName());
  sh.getRange(row, idx + 1).setValue(value);
}

/** [FIX-6] Escreve vários campos da linha num único setValues (1 round-trip em vez de N). */
function _atualizarLinha_(sh, row, headers, patch) {
  const vals = sh.getRange(row, 1, 1, headers.length).getValues()[0];

  headers.forEach((h, i) => {
    if (Object.prototype.hasOwnProperty.call(patch, h)) vals[i] = patch[h];
  });

  sh.getRange(row, 1, 1, headers.length).setValues([vals]);
}

function _rowByEmail_(sh, email) {
  email = _normalizarEmail_(email);
  const found = _sheetToObjects_(sh).find(r => _normalizarEmail_(r.EMAIL) === email);
  return found ? found._rowNumber : null;
}

function _mapRowsByKey_(objects, key) {
  const out = {};

  objects.forEach(o => {
    const k = key === 'EMAIL' ? _normalizarEmail_(o[key]) : String(o[key] || '').trim();
    if (k) out[k] = { obj: o, rowNumber: o._rowNumber };
  });

  return out;
}

/* ============================================================================================ */
/*  HELPERS GERAIS                                                                               */
/* ============================================================================================ */

function _normalizarEmail_(email) {
  return String(email || '').toLowerCase().trim();
}

function _dominio_(email) {
  email = _normalizarEmail_(email);
  return email.indexOf('@') > -1 ? email.split('@').pop() : '';
}

function _dominioPermitido_(email) {
  return DP360.DOMINIOS_PERMITIDOS.indexOf(_dominio_(email)) > -1;
}

function _validarDominio_(email) {
  if (!email || email.indexOf('@') === -1) throw new Error('Informe um e-mail válido.');
  if (!_dominioPermitido_(email)) {
    throw new Error('Domínio não permitido para acesso ao DP360: ' + _dominio_(email));
  }
}

function _sim_(v) {
  return ['sim', 's', 'yes', 'true', '1'].indexOf(String(v).toLowerCase().trim()) > -1;
}

function _uuid_() { return Utilities.getUuid(); }

function _agoraISO_() {
  return Utilities.formatDate(new Date(), DP360.FUSO, "yyyy-MM-dd'T'HH:mm:ss");
}

function _addMinutos_(d, minutos) {
  return new Date(d.getTime() + minutos * 60 * 1000);
}

function _codigo6_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function _permitirEnvioCodigo_(email) {
  const cache = CacheService.getScriptCache();
  const chave = 'CODIGO_' + Utilities.base64EncodeWebSafe(email);
  const atual = Number(cache.get(chave) || 0);

  if (atual >= DP360.CODIGO_MAX_ENVIOS_HORA) return false;

  cache.put(chave, String(atual + 1), 3600);
  return true;
}

/* ---- criptografia ---- */

function _tokenSecret_() {
  _garantirSegredos_();
  return PropertiesService.getScriptProperties().getProperty(DP360.PROPS.TOKEN_SECRET);
}

function _passwordPepper_() {
  _garantirSegredos_();
  return PropertiesService.getScriptProperties().getProperty(DP360.PROPS.PASSWORD_PEPPER);
}

function _codePepper_() {
  _garantirSegredos_();
  return PropertiesService.getScriptProperties().getProperty(DP360.PROPS.CODE_PEPPER);
}

function _segredoFront_() {
  _garantirSegredos_();
  return PropertiesService.getScriptProperties().getProperty(DP360.PROPS.SEGREDO_FRONT);
}

/**
 * [FIX-5] Hash iterado. versao 1 = HMAC simples (legado), versao 2 = iterado.
 * A iteração encarece a força bruta offline caso a planilha vaze.
 */
function _hashSenha_(email, senha, salt, versao) {
  versao = Number(versao || DP360.HASH_VERSAO);

  const base = _normalizarEmail_(email) + '|' + String(salt || '') + '|' + String(senha || '');
  const pepper = _passwordPepper_();

  if (versao < 2) return _hmacSha256Hex_(base, pepper);

  var iteracoes = DP360.HASH_ITERACOES_POR_VERSAO[versao] || DP360.HASH_ITERACOES;

  let h = _hmacSha256Hex_(base, pepper);

  for (let i = 1; i < iteracoes; i++) {
    h = _hmacSha256Hex_(h + '|' + i, pepper);
  }

  return h;
}

function _hashCodigo_(email, codigo) {
  return _hmacSha256Hex_(_normalizarEmail_(email) + '|' + String(codigo || ''), _codePepper_());
}

function _hmacSha256Hex_(data, key) {
  const sig = Utilities.computeHmacSha256Signature(String(data), String(key));

  return sig.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function _hmacSha256Base64Url_(data, key) {
  return _bytesToBase64Url_(Utilities.computeHmacSha256Signature(String(data), String(key)));
}

function _base64Url_(str) {
  return Utilities.base64EncodeWebSafe(String(str), Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function _bytesToBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function _base64UrlDecodeToString_(b64url) {
  let s = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString('UTF-8');
}

function _constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');

  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}

function _senhaEhForte_(senha) {
  senha = String(senha || '');

  if (senha.length < DP360.TAMANHO_MINIMO_SENHA) return false;
  if (!/[A-ZÁÀÂÃÉÈÊÍÓÔÕÚÇ]/.test(senha)) return false;
  if (!/[a-záàâãéèêíóôõúç]/.test(senha)) return false;
  if (!/[0-9]/.test(senha)) return false;

  return true;
}

function _validarSenhaForte_(senha) {
  if (!_senhaEhForte_(senha)) {
    throw new Error(
      'A senha precisa ter pelo menos ' + DP360.TAMANHO_MINIMO_SENHA +
      ' caracteres, com letra maiúscula, minúscula e número.'
    );
  }
}

function _emailCodigoHtml_(nome, codigo) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e9eb;border-radius:16px;overflow:hidden">'
    + '<div style="background:#0E5A6B;color:#fff;padding:20px 24px"><b>CIEDS · Departamento Pessoal — Código de acesso</b></div>'
    + '<div style="padding:24px;color:#1c2b30">'
    + '<p>Olá, ' + _escapeHtml_(nome || '') + '.</p>'
    + '<p>Use o código abaixo para cadastrar ou redefinir sua senha no Portal:</p>'
    + '<div style="font-size:28px;font-weight:bold;letter-spacing:6px;background:#E7F1F3;color:#0E5A6B;border-radius:12px;padding:16px;text-align:center">' + codigo + '</div>'
    + '<p style="color:#6b7c81;font-size:13px">Código válido por ' + DP360.CODIGO_TTL_MINUTOS + ' minutos. Se você não solicitou este acesso, ignore esta mensagem.</p>'
    + '</div></div>';
}

function _escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============================================================================================ */
/*  TESTES                                                                                       */
/* ============================================================================================ */

function testarDP360Tudo() {
  const r = [];

  function ok(nome, cond) {
    if (!cond) throw new Error('FALHOU: ' + nome);
    r.push(nome);
  }

  setupDP360();

  const email = 'teste.dp360@cieds.org.br';
  const salt = 'SALT-TESTE';

  ok('hash determinístico', _hashSenha_(email, 'Teste@12345', salt) === _hashSenha_(email, 'Teste@12345', salt));
  ok('hash muda com senha diferente', _hashSenha_(email, 'Teste@12345', salt) !== _hashSenha_(email, 'Outra@12345', salt));
  ok('hash muda com salt diferente', _hashSenha_(email, 'Teste@12345', 'A') !== _hashSenha_(email, 'Teste@12345', 'B'));
  ok('normalização de e-mail', _normalizarEmail_('  TESTE.DP360@CIEDS.ORG.BR ') === email);
  ok('domínio permitido', _dominioPermitido_(email));
  ok('domínio negado', !_dominioPermitido_('a@exemplo.com'));
  ok('senha forte aceita', _senhaEhForte_('Teste@12345'));
  ok('senha fraca rejeitada', !_senhaEhForte_('123'));

  const fake = { EMAIL: email, NOME: 'Teste João', PERFIL: 'GESTOR', ATIVO: 'Sim', PODE_LOGAR: 'Sim', QTD_SUBORDINADOS: 3 };
  const tk = _emitirToken_(fake);

  ok('token com 3 partes', tk.token.split('.').length === 3);

  const val = _validarTokenOuErro_(tk.token);
  ok('token valida e-mail', val.email === email);
  ok('token valida perfil', val.perfil === 'GESTOR');

  const partes = tk.token.split('.');
  let adulteradoFalhou = false;
  try { _validarTokenOuErro_(partes[0] + '.' + partes[1] + '.' + 'x'.repeat(partes[2].length)); }
  catch (e) { adulteradoFalhou = true; }
  ok('token adulterado rejeitado', adulteradoFalhou);

  _revogarJti_(tk.jti, tk.payload.exp);
  let revogadoFalhou = false;
  try { _validarTokenOuErro_(tk.token); } catch (e) { revogadoFalhou = true; }
  ok('token revogado rejeitado', revogadoFalhou);

  const ss = _configSS_();
  Object.keys(DP360.SHEETS).forEach(k => ok('aba existe: ' + DP360.SHEETS[k], !!ss.getSheetByName(DP360.SHEETS[k])));

  ok('permissão wildcard ADMIN', _temPermissao_('ADMIN', 'QUALQUER.COISA'));
  ok('permissão GESTOR contexto', _temPermissao_('GESTOR', 'CONTEXTO'));
  ok('permissão GESTOR férias', _temPermissao_('GESTOR', 'FERIAS.SOLICITAR'));
  ok('GESTOR sem permissão admin', !_temPermissao_('GESTOR', 'ADMIN.APAGAR'));
  ok('DP com wildcard de módulo', _temPermissao_('DP', 'FERIAS.APROVAR'));

  let semSegredo = false;
  try { _validarSegredoFront_('errado'); } catch (e) { semSegredo = true; }
  ok('doPost rejeita segredo inválido', semSegredo);

  _auditar_('TESTE_OK', email, 'testarDP360Tudo', true, 'Testes executados.', { total: r.length });

  const msg = 'OK — ' + r.length + ' validações passaram. DP360_API v' + DP360.VERSAO;
  console.log(msg);
  return msg;
}

/** Desbloqueia uma conta travada por tentativas e zera o contador. */
function desbloquearLogin(email) {
  email = _normalizarEmail_(email);
  var sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
  var h = _headers_(sh);
  var row = _rowByEmail_(sh, email);
  if (!row) throw new Error('Credencial nao encontrada para ' + email);
  _atualizarLinha_(sh, row, h, { FALHAS_LOGIN: 0, BLOQUEADO_ATE: '', ATUALIZADO_EM: new Date() });
  _auditar_('LOGIN_DESBLOQUEADO', email, 'desbloquearLogin', true, 'Desbloqueio manual.', {});
  return email + ' desbloqueado(a). Tente entrar de novo.';
}

/** Confere se uma senha bate, mostrando a versao do hash gravado. */
function testarSenha(email, senha) {
  email = _normalizarEmail_(email);
  var sh = _configSS_().getSheetByName(DP360.SHEETS.CREDENCIAIS);
  var cred = _rowToObj_(sh, _rowByEmail_(sh, email), _headers_(sh));
  var versaoGravada = Number(cred.HASH_VERSAO || 1);
  var hashCalc = _hashSenha_(email, senha, cred.SALT, versaoGravada);
  var bate = _constantTimeEqual_(String(cred.PASSWORD_HASH || ''), hashCalc);
  console.log('versao do hash gravado: ' + versaoGravada);
  console.log('iteracoes dessa versao: ' + (DP360.HASH_ITERACOES_POR_VERSAO[versaoGravada] || DP360.HASH_ITERACOES));
  console.log('a senha bate? ' + (bate ? 'SIM' : 'NAO'));
  return bate;
}

/**
 * Normaliza matrícula pra comparação (tira zeros à esquerda). Usada em vários módulos
 * (RAIO-X, diagnósticos, etc.) — mantida aqui no Codigo.gs pra não se perder de novo em
 * futuras recuperações do arquivo.
 */
function _normalizarMatricula_(v) {
  if (v === null || v === undefined) return '';

  let s = String(v)
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .trim()
    .replace(/^'+/, '')
    .trim();

  if (!s) return '';

  // Planilhas/importacoes podem entregar um inteiro em notacao cientifica.
  const cientifica = s.replace(/\s+/g, '').replace(',', '.');
  if (/^[+\-]?\d+(?:\.\d+)?e[+\-]?\d+$/i.test(cientifica)) {
    const numero = Number(cientifica);
    if (Number.isFinite(numero) && Number.isSafeInteger(numero)) s = String(numero);
  }

  // Excel/Sheets frequentemente materializam matriculas inteiras como "12345.0".
  s = s.replace(/[.,]0+$/, '');

  if (/^[+\-]?\d[\d\s.,\-\/]*$/.test(s)) {
    // Para matriculas numericas, pontos, virgulas, hifens e espacos sao apenas formatacao.
    s = s.replace(/\D/g, '').replace(/^0+/, '');
  } else {
    // Identificadores alfanumericos sao preservados; so uniformizamos caixa e espacos.
    s = s.replace(/\s+/g, '').toUpperCase();
  }

  return s || '';
}

