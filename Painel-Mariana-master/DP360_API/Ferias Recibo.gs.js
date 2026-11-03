/*************************************************************************************************
 * DP360_API · FERIAS_RECIBOS.gs — Recibo de férias no Autentique (v1.1.0)
 * -----------------------------------------------------------------------------------------------
 * Cole como NOVO arquivo no projeto DP360_API, ao lado de API_Ferias.gs e API_RESCISAO.gs.
 *
 * O QUE FAZ (tudo disparado pelo Portal do DP):
 *   1) ENVIAR   — sobe o PDF do recibo (Alterdata, salvo na pasta do Drive) para assinatura.
 *                 Dois signatários, nesta ordem: DP e colaborador (com CPF quando houver).
 *   2) VERIFICAR— consulta o Autentique e diz se TODOS assinaram.
 *   3) BAIXAR   — quando assinado, baixa o PDF assinado e salva na pasta de ASSINADOS no Drive.
 *   + versões em LOTE do envio e do download.
 *
 * REAPROVEITA o cliente Autentique que já roda na Rescisão (mesmo projeto, escopo global):
 *   _autentiqueCriarDocumento_(nomeDoc, blob, signatarios)   e   _autentiqueToken_()
 * A verificação/consulta do documento é feita aqui direto na API GraphQL (self-contained).
 *
 * MODELO DE DADOS: aba SOLICITACOES (as férias DEFERIDAS geram recibo).
 * Controle em 6 colunas novas ao FIM da aba (criadas por garantirColunasReciboFerias):
 *   ID_AUTENTIQUE · STATUS_AUTENTIQUE · AUTENTIQUE_ENVIADO_EM · RECIBO_LINK
 *   RECIBO_ASSINADO_LINK · RECIBO_ASSINADO_EM
 *
 * SETUP (uma vez, na API):
 *   1) feriasSetupRecibos()                                → cria colunas + libera permissões DP
 *   2) configurarPastaRecibosFerias('ID_PASTA_ORIGEM')     → pasta 1_OMgm... dos PDFs do Alterdata
 *   3) configurarPastaRecibosAssinados('ID_PASTA_ASSINADOS')
 *   4) (Rescisão já fez) configurarAutentiqueToken(...) + testarAutentique()
 *   5) feriasDiagnosticarRecibos()                         → confere o casamento nome↔PDF
 *   6) Adicione as 6 linhas no switch de _feriasExecutar_  (bloco comentado no fim do arquivo)
 *************************************************************************************************/

const FERIAS_RECIBO = {
  VERSAO: '1.1.0',

  PARAM_PASTA_ID:           'RECIBO_FERIAS_PASTA_ID',            // origem: PDFs do Alterdata
  PARAM_PASTA_ASSINADOS_ID: 'RECIBO_FERIAS_PASTA_ASSINADOS_ID',  // destino: assinados
  PARAM_DP_EMAIL:           'RECIBO_AUTENTIQUE_DP_EMAIL',        // 1o signatario (DP)
  DP_EMAIL_PADRAO:          'dp@cieds.org.br',

  COL: {
    ID_AUTENTIQUE:      'ID_AUTENTIQUE',
    STATUS_AUTENTIQUE:  'STATUS_AUTENTIQUE',
    ENVIADO_EM:         'AUTENTIQUE_ENVIADO_EM',
    RECIBO_LINK:        'RECIBO_LINK',
    ASSINADO_LINK:      'RECIBO_ASSINADO_LINK',
    ASSINADO_EM:        'RECIBO_ASSINADO_EM'
  },

  STATUS_ENVIADO:  'Enviado',
  STATUS_ASSINADO: 'Assinado',

  // Trava de tempo dos lacos em lote - o Apps Script mata a execucao em 6 min. Paramos antes e o
  // DP roda de novo para continuar. Mantem o portal respondendo em vez de "estourar".
  LOTE_LIMITE_MS: 4.5 * 60 * 1000
};

/* ============================================================================================ */
/*  CONFIG                                                                                       */
/* ============================================================================================ */

function configurarPastaRecibosFerias(id) {
  if (!id) throw new Error('Informe o ID da pasta de ORIGEM: configurarPastaRecibosFerias("ID").');
  _setFeriasParam_(FERIAS_RECIBO.PARAM_PASTA_ID, String(id).trim());
  return 'Pasta de recibos (origem) configurada.';
}

function configurarPastaRecibosAssinados(id) {
  if (!id) throw new Error('Informe o ID da pasta de ASSINADOS: configurarPastaRecibosAssinados("ID").');
  _setFeriasParam_(FERIAS_RECIBO.PARAM_PASTA_ASSINADOS_ID, String(id).trim());
  return 'Pasta de recibos assinados configurada.';
}

function _reciboPastaId_() {
  const id = _feriasParam_(FERIAS_RECIBO.PARAM_PASTA_ID, '');
  if (!id) throw new Error('Pasta de origem nao configurada. Rode configurarPastaRecibosFerias("ID").');
  return id;
}

function _reciboPastaAssinadosId_() {
  const id = _feriasParam_(FERIAS_RECIBO.PARAM_PASTA_ASSINADOS_ID, '');
  if (!id) throw new Error('Pasta de assinados nao configurada. Rode configurarPastaRecibosAssinados("ID").');
  return id;
}

function _reciboDpEmail_() {
  return String(_feriasParam_(FERIAS_RECIBO.PARAM_DP_EMAIL, FERIAS_RECIBO.DP_EMAIL_PADRAO)).trim();
}

function _reciboEndpoint_() {
  return (typeof RESC !== 'undefined' && RESC.AUTENTIQUE_ENDPOINT)
    ? RESC.AUTENTIQUE_ENDPOINT
    : 'https://api.autentique.com.br/v2/graphql';
}

/* ============================================================================================ */
/*  SETUP - colunas de controle + permissoes (idempotente)                                      */
/* ============================================================================================ */

function feriasSetupRecibos() {
  const cols = garantirColunasReciboFerias();
  const perm = _semearPermissoesRecibos_();
  return 'Setup recibos OK.\n  colunas: ' + cols + '\n  permissoes: ' + perm +
    '\n\nFalta: configurarPastaRecibosFerias("ID") . configurarPastaRecibosAssinados("ID") . 6 linhas no switch.';
}

/** Cria as 6 colunas de controle ao FIM da aba SOLICITACOES, se ainda nao existirem. */
function garantirColunasReciboFerias() {
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const alvo = [
    FERIAS_RECIBO.COL.ID_AUTENTIQUE,
    FERIAS_RECIBO.COL.STATUS_AUTENTIQUE,
    FERIAS_RECIBO.COL.ENVIADO_EM,
    FERIAS_RECIBO.COL.RECIBO_LINK,
    FERIAS_RECIBO.COL.ASSINADO_LINK,
    FERIAS_RECIBO.COL.ASSINADO_EM
  ];
  const faltam = alvo.filter(c => h.indexOf(c) === -1);
  if (!faltam.length) return 'ja existiam.';

  sh.getRange(1, h.length + 1, 1, faltam.length).setValues([faltam]);
  return 'criadas ' + faltam.join(', ') + '.';
}

/** Libera as acoes novas para quem ja enxerga o modulo de Ferias: DP e GESTOR (ADMIN ja passa por curinga). */
function _semearPermissoesRecibos_() {
  const sh = _configSS_().getSheetByName(DP360.SHEETS.PERMISSOES);
  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh)
    .map(r => String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  const acoes = [
    { ACAO: 'FERIAS.RECIBOS',              DESC: 'Ver a lista de recibos de ferias.' },
    { ACAO: 'FERIAS.ENVIAR_RECIBO',        DESC: 'Enviar um recibo de ferias ao Autentique.' },
    { ACAO: 'FERIAS.ENVIAR_RECIBOS_LOTE',  DESC: 'Enviar em lote os recibos pendentes.' },
    { ACAO: 'FERIAS.VERIFICAR_RECIBO',     DESC: 'Verificar se o recibo foi assinado.' },
    { ACAO: 'FERIAS.BAIXAR_RECIBO',        DESC: 'Baixar o recibo assinado para o Drive.' },
    { ACAO: 'FERIAS.BAIXAR_RECIBOS_LOTE',  DESC: 'Baixar em lote os recibos assinados.' },
    { ACAO: 'FERIAS.VER_RECIBO',              DESC: 'Ver o PDF do recibo encontrado, antes de enviar.' },
    { ACAO: 'FERIAS.CANCELAR_RECIBO',         DESC: 'Cancelar o envio de um recibo ao Autentique.' },
    { ACAO: 'FERIAS.VERIFICAR_RECIBOS_LOTE',  DESC: 'Verificar em lote a assinatura dos recibos enviados.' }
  ];
  const perfis = ['DP', 'GESTOR'];

  let add = 0;
  perfis.forEach(perfil => {
    acoes.forEach(n => {
      if (existentes.indexOf(perfil + '|' + n.ACAO.toUpperCase()) > -1) return;
      const obj = { PERFIL: perfil, ACAO: n.ACAO, PERMITIDO: 'Sim', ESCOPO: 'GLOBAL', DESCRICAO: n.DESC };
      sh.appendRow(h.map(col => (obj[col] === undefined ? '' : obj[col])));
      add++;
    });
  });

  if (add && typeof _limparCachePermissoes_ === 'function') _limparCachePermissoes_();
  return add ? (add + ' adicionada(s) para DP/GESTOR.') : 'ja existiam.';
}

/* ============================================================================================ */
/*  PASTA DE PDFs - leitura + normalizacao + extracao de datas do nome                          */
/* ============================================================================================ */

var _CACHE_RECIBO_ARQS_ = null;

// 06/08/2026: [PERF] Varrer a pasta do Drive inteira (pasta.getFiles(), item por item) é o
// gargalo clássico do Apps Script — cada it.next() custa uma ida à rede, e a pasta só cresce
// (recibo de todo mundo, todo mês, nunca é removida daqui). Antes isso rodava DE NOVO em toda
// carga da aba Recibos, porque _CACHE_RECIBO_ARQS_ é só uma var de execução (não sobrevive
// entre requisições). Agora usa CacheService (6 min, em pedaços por causa do limite de 100KB
// por chave) — a lista de arquivos raramente muda de uma carga pra outra.
// [PERF] Era 360s (6 min) — a pasta de origem tem muitos PDFs e a varredura via DriveApp é lenta,
// então quase todo acesso à aba Recibos pagava o preço de reler a pasta inteira. 30 min ainda é
// seguro (o botão "Atualizar" força uma releitura na hora, veja o parâmetro `forcar` em
// feriasRecibosLista) e derruba drasticamente quantas vezes isso acontece.
const RECIBO_CACHE_TTL_SEGUNDOS = 1800;
const RECIBO_CACHE_CHUNK = 200;

/** Le os PDFs da pasta de ORIGEM (cache de execução -> CacheService -> Drive, nessa ordem). */
function _reciboArquivos_() {
  if (_CACHE_RECIBO_ARQS_) return _CACHE_RECIBO_ARQS_;

  const doCache = _reciboArquivosDoCache_();
  if (doCache) {
    _CACHE_RECIBO_ARQS_ = doCache;
    return doCache;
  }

  const pasta = DriveApp.getFolderById(_reciboPastaId_());
  const arqs = [];
  const it = pasta.getFiles();

  while (it.hasNext()) {
    const f = it.next();
    const nome = f.getName();
    const ehPdf = /\.pdf$/i.test(nome) || f.getMimeType() === MimeType.PDF;
    if (!ehPdf) continue;

    arqs.push({
      id: f.getId(),
      nome: nome,
      norm: _reciboNorm_(nome),
      datas: _reciboDatas_(nome),   // Set de 'yyyy-mm-dd'
      file: f
    });
  }

  _CACHE_RECIBO_ARQS_ = arqs;
  _reciboArquivosGravarCache_(arqs);
  return arqs;
}

/** Reconstroi a partir do CacheService (sem os File do Drive — esses são pegos sob demanda). */
function _reciboArquivosDoCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('RECIBO_ARQS_META');
    if (!meta) return null;

    const totalPedacos = JSON.parse(meta).partes;
    const chaves = [];
    for (let i = 0; i < totalPedacos; i++) chaves.push('RECIBO_ARQS_' + i);

    const pedacos = cache.getAll(chaves);
    let brutos = [];
    for (let i = 0; i < totalPedacos; i++) {
      const p = pedacos['RECIBO_ARQS_' + i];
      if (!p) return null; // algum pedaco expirou/sumiu, refaz tudo do Drive
      brutos = brutos.concat(JSON.parse(p));
    }

    return brutos.map(a => ({
      id: a.id,
      nome: a.nome,
      norm: _reciboNorm_(a.nome),
      datas: new Set(a.datas),
      file: null // só busca o File de verdade se alguem for ENVIAR (nao pra listar)
    }));
  } catch (e) {
    return null; // cache com problema nao pode travar a listagem
  }
}

/** Grava em pedaços de RECIBO_CACHE_CHUNK, sem o File (não serializa) e sem o "norm" (recalculado). */
function _reciboArquivosGravarCache_(arqs) {
  try {
    const leve = arqs.map(a => ({ id: a.id, nome: a.nome, datas: Array.from(a.datas) }));
    const partes = [];
    for (let i = 0; i < leve.length; i += RECIBO_CACHE_CHUNK) {
      partes.push(JSON.stringify(leve.slice(i, i + RECIBO_CACHE_CHUNK)));
    }

    const cache = CacheService.getScriptCache();
    const valores = { RECIBO_ARQS_META: JSON.stringify({ partes: partes.length }) };
    partes.forEach((p, i) => { valores['RECIBO_ARQS_' + i] = p; });
    cache.putAll(valores, RECIBO_CACHE_TTL_SEGUNDOS);
  } catch (e) {
    // se nao coube ou deu erro no cache, sem problema — só volta a varrer o Drive na proxima
  }
}

/** Garante o File de verdade (o cache do CacheService não guarda isso, só id/nome/datas). */
function _reciboArquivoFile_(arquivo) {
  if (!arquivo.file) arquivo.file = DriveApp.getFileById(arquivo.id);
  return arquivo.file;
}

/** Chame depois de subir/renomear/mover um recibo na pasta, pra próxima listagem já ver certo. */
function _invalidarCacheRecibos_() {
  _CACHE_RECIBO_ARQS_ = null;
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('RECIBO_ARQS_META');
    if (meta) {
      const totalPedacos = JSON.parse(meta).partes;
      const chaves = ['RECIBO_ARQS_META'];
      for (let i = 0; i < totalPedacos; i++) chaves.push('RECIBO_ARQS_' + i);
      cache.removeAll(chaves);
    }
  } catch (e) { /* nao trava por causa disso */ }
}

/** minusculas, sem acento, so letras/numeros separados por espaco. */
function _reciboNorm_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Extrai TODAS as datas do nome do arquivo -> Set de 'yyyy-mm-dd'. Tolera formatos. */
function _reciboDatas_(nome) {
  const out = {};
  const s = String(nome || '');
  let m;

  const dmy = /(\d{2})[\/\-\.\s](\d{2})[\/\-\.\s](\d{4})/g;       // dd/mm/yyyy dd-mm-yyyy dd.mm.yyyy
  while ((m = dmy.exec(s))) out[m[3] + '-' + m[2] + '-' + m[1]] = 1;

  const ymd = /(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})/g;           // yyyy-mm-dd
  while ((m = ymd.exec(s))) out[m[1] + '-' + m[2] + '-' + m[3]] = 1;

  const colado = /(?:^|[^\d])(\d{2})(\d{2})(\d{4})(?:[^\d]|$)/g;  // ddmmyyyy colado
  while ((m = colado.exec(s))) out[m[3] + '-' + m[2] + '-' + m[1]] = 1;

  return new Set(Object.keys(out));
}

/**
 * Acha o PDF de UMA solicitacao (partimos da linha, que ja tem nome+datas certos).
 * Validacao em 2 niveis:
 *   1) nome + data de INICIO + data de FIM no nome do arquivo -> match forte (preferido).
 *   2) se nenhum arquivo tiver as duas datas, cai para o criterio antigo (nome unico, ou
 *      nome + so a data de inicio) para nao quebrar recibos ja nomeados sem a data de fim.
 *   0 candidatos por nome -> NAO_ACHOU . varios sem desempate possivel -> AMBIGUO.
 */
function _reciboAcharArquivo_(sol, arquivos) {
  const tokens = _reciboNorm_(sol.NOME).split(' ').filter(t => t.length >= 3);
  if (!tokens.length) return { status: 'ERRO', motivo: 'Solicitacao sem nome utilizavel.' };

  const porNome = arquivos.filter(a => tokens.every(t => a.norm.indexOf(t) > -1));
  if (porNome.length === 0) return { status: 'NAO_ACHOU' };

  const ini = _isoF_(sol.DATA_INICIO);
  const fim = _isoF_(sol.DATA_FIM);

  const comAmbasDatas = porNome.filter(a => a.datas.has(ini) && a.datas.has(fim));
  if (comAmbasDatas.length === 1) return { status: 'OK', arquivo: comAmbasDatas[0] };
  if (comAmbasDatas.length > 1)  return { status: 'AMBIGUO', qtd: comAmbasDatas.length };

  if (porNome.length === 1) return { status: 'OK', arquivo: porNome[0] };

  const comInicio = porNome.filter(a => a.datas.has(ini));
  if (comInicio.length === 1) return { status: 'OK', arquivo: comInicio[0] };

  return { status: 'AMBIGUO', qtd: porNome.length };
}

/* ============================================================================================ */
/*  SIGNATARIOS - DP primeiro, depois o colaborador (com CPF quando houver)                      */
/* ============================================================================================ */

function _reciboSignatarios_(sol) {
  const emailColab = _emailDoColaborador_(sol.ID_COLABORADOR);
  if (!emailColab || emailColab.indexOf('@') === -1) {
    return { erro: 'Colaborador sem e-mail valido cadastrado na MASTER.' };
  }

  const colab = _colaboradorPorId_(sol.ID_COLABORADOR) || {};
  const cpf = String(colab.CPF || '').replace(/\D/g, '');

  const doColab = { email: emailColab, action: 'SIGN' };
  if (cpf) doColab.configs = { cpf: cpf };   // forca validacao de CPF na assinatura

  return {
    signatarios: [
      { email: _reciboDpEmail_(), action: 'SIGN' },  // 1o: DP
      doColab                                        // 2o: colaborador
    ],
    emailColab: emailColab
  };
}

/* ============================================================================================ */
/*  AUTENTIQUE - consulta do documento (verificacao de assinatura + URL do assinado)            */
/* ============================================================================================ */

function _reciboConsultarDocumento_(docId) {
  const token = _autentiqueToken_();
  const query =
    'query Doc($id: UUID!) {' +
    '  document(id: $id) {' +
    '    id name' +
    '    signatures { name email signed { created_at } rejected { created_at } }' +
    '    files { signed }' +
    '  }' +
    '}';

  const resp = UrlFetchApp.fetch(_reciboEndpoint_(), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query, variables: { id: docId } }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  if (json.errors) throw new Error('Autentique recusou a consulta: ' + JSON.stringify(json.errors));

  const doc = json.data && json.data.document;
  if (!doc) throw new Error('Documento nao encontrado no Autentique (ID ' + docId + ').');

  const sigs = doc.signatures || [];
  const total = sigs.length;
  const assinados = sigs.filter(s => s.signed).length;
  const rejeitado = sigs.some(s => s.rejected);
  const urlAssinado = (doc.files && doc.files.signed) ? doc.files.signed : '';
  // [FIX 2026-09-23] O "|| !!urlAssinado" tratava qualquer documento com um arquivo "signed"
  // do Autentique como assinado por TODOS os signatarios, mesmo faltando gente assinar —
  // o Autentique as vezes preenche files.signed antes de completar todas as assinaturas.
  // Reportado: pessoas marcadas "Assinado" no Kit Admissional com signatario pendente de
  // verdade no Autentique, na maioria dos casos vistos. Fonte da verdade agora e só a
  // contagem individual de assinaturas.
  const assinadoTudo = total > 0 && assinados === total;

  return {
    nome: doc.name, total: total, assinados: assinados,
    rejeitado: rejeitado, urlAssinado: urlAssinado, assinado: assinadoTudo
  };
}

/* ============================================================================================ */
/*  NUCLEO DE ENVIO - usado pelo botao por item E pelo lote                                      */
/* ============================================================================================ */

function _reciboEnviarNucleo_(sol, arquivos, user) {
  if (String(sol[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim()) {
    return { resultado: 'PULADO', nome: sol.NOME, motivo: 'Ja enviado antes.' };
  }

  const achou = _reciboAcharArquivo_(sol, arquivos);
  if (achou.status === 'NAO_ACHOU') return { resultado: 'ERRO', nome: sol.NOME, motivo: 'Recibo nao encontrado na pasta.' };
  if (achou.status === 'AMBIGUO')   return { resultado: 'ERRO', nome: sol.NOME, motivo: 'Varios PDFs combinam (' + achou.qtd + '). Renomeie incluindo as datas.' };
  if (achou.status === 'ERRO')      return { resultado: 'ERRO', nome: sol.NOME, motivo: achou.motivo };

  const sig = _reciboSignatarios_(sol);
  if (sig.erro) return { resultado: 'ERRO', nome: sol.NOME, motivo: sig.erro };

  if (typeof _autentiqueCriarDocumento_ !== 'function') {
    throw new Error('Cliente do Autentique nao encontrado. Confirme que o arquivo da Rescisao esta no mesmo projeto da API.');
  }
  const arquivoFile = _reciboArquivoFile_(achou.arquivo);
  const blob = arquivoFile.getBlob();
  const nomeDoc = 'RECIBO DE FÉRIAS - ' + sol.NOME;
  const doc = _autentiqueCriarDocumento_(nomeDoc, blob, sig.signatarios);

  _reciboGravar_(sol.ID_SOLICITACAO, {
    [FERIAS_RECIBO.COL.ID_AUTENTIQUE]:     doc.id,
    [FERIAS_RECIBO.COL.STATUS_AUTENTIQUE]: FERIAS_RECIBO.STATUS_ENVIADO,
    [FERIAS_RECIBO.COL.ENVIADO_EM]:        new Date(),
    [FERIAS_RECIBO.COL.RECIBO_LINK]:       arquivoFile.getUrl()
  });

  _auditar_('FERIAS_RECIBO_ENVIADO', user.EMAIL, 'FERIAS.ENVIAR_RECIBO', true,
    sol.NOME + ' -> doc ' + doc.id, { idSolicitacao: sol.ID_SOLICITACAO });

  return { resultado: 'ENVIADO', nome: sol.NOME, docId: doc.id };
}

/** Escreve um patch na linha da solicitacao (lock + releitura fresca). */
function _reciboGravar_(idSolicitacao, patch) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
    const h = _headers_(sh);
    const s = _sheetToObjects_(sh).find(x => String(x.ID_SOLICITACAO) === String(idSolicitacao));
    if (!s) throw new Error('Solicitacao nao encontrada ao gravar.');
    _atualizarLinha_(sh, s._rowNumber, h, patch);
    _invalidarCacheFerias_();
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================================ */
/*  NUCLEO DE DOWNLOAD - baixa o assinado e salva na pasta de ASSINADOS                          */
/* ============================================================================================ */

function _reciboBaixarNucleo_(sol, user) {
  const docId = String(sol[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim();
  if (!docId) return { resultado: 'ERRO', nome: sol.NOME, motivo: 'Ainda nao enviado ao Autentique.' };

  if (String(sol[FERIAS_RECIBO.COL.ASSINADO_LINK] || '').trim()) {
    return { resultado: 'PULADO', nome: sol.NOME, motivo: 'Assinado ja baixado.' };
  }

  const info = _reciboConsultarDocumento_(docId);
  if (info.rejeitado) return { resultado: 'ERRO', nome: sol.NOME, motivo: 'Documento rejeitado por um signatario.' };
  if (!info.assinado) return { resultado: 'PENDENTE', nome: sol.NOME, motivo: 'Ainda nao assinado (' + info.assinados + '/' + info.total + ').' };
  if (!info.urlAssinado) return { resultado: 'PENDENTE', nome: sol.NOME, motivo: 'Autentique ainda nao gerou o PDF assinado.' };

  // [FIX 2026-09-28] download com token + conferência de PDF (antes salvava qualquer resposta,
  // inclusive página de erro em HTML, e marcava o recibo como assinado e arquivado).
  let blob;
  try {
    blob = _autentiqueBaixarPdfAssinado_(info.urlAssinado, 'RECIBO DE FÉRIAS - ' + sol.NOME + '.pdf');
  } catch (e) {
    return { resultado: 'ERRO', nome: sol.NOME, motivo: e.message };
  }

  const pasta = DriveApp.getFolderById(_reciboPastaAssinadosId_());
  const arquivo = pasta.createFile(blob);
  _compartilharSoDominio_(arquivo);
  const link = arquivo.getUrl();

  _reciboGravar_(sol.ID_SOLICITACAO, {
    [FERIAS_RECIBO.COL.STATUS_AUTENTIQUE]: FERIAS_RECIBO.STATUS_ASSINADO,
    [FERIAS_RECIBO.COL.ASSINADO_LINK]:     link,
    [FERIAS_RECIBO.COL.ASSINADO_EM]:       new Date()
  });

  _auditar_('FERIAS_RECIBO_BAIXADO', user.EMAIL, 'FERIAS.BAIXAR_RECIBO', true,
    sol.NOME + ' -> assinado arquivado', { idSolicitacao: sol.ID_SOLICITACAO });

  return { resultado: 'BAIXADO', nome: sol.NOME, link: link };
}

/* ============================================================================================ */
/*  ACOES - chamadas pelo portal                                                                 */
/* ============================================================================================ */

/** FERIAS.RECIBOS - lista as ferias deferidas + status do recibo. Leve: nenhuma chamada externa.
 *  payload: { forcar } — quando true (botão "Atualizar" do portal), ignora o cache da pasta do
 *  Drive e varre de novo, pra pegar PDF recém-adicionado sem esperar o TTL. */
function feriasRecibosLista(user, p) {
  garantirColunasReciboFerias();
  if (p && p.forcar) _invalidarCacheRecibos_();
  const arquivos = _reciboArquivos_();

  const lista = _solicitacoes_()
    .filter(s => String(s.STATUS || '').toUpperCase() === 'DEFERIDA')
    .map(s => {
      const idAut = String(s[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim();
      const assinadoLink = String(s[FERIAS_RECIBO.COL.ASSINADO_LINK] || '').trim();
      const status = String(s[FERIAS_RECIBO.COL.STATUS_AUTENTIQUE] || '');
      const email = _emailDoColaborador_(s.ID_COLABORADOR);
      const enviado = !!idAut;
      const achou = enviado ? null : _reciboAcharArquivo_(s, arquivos);
      return {
        id: s.ID_SOLICITACAO,
        nome: s.NOME,
        inicio: _isoF_(s.DATA_INICIO),
        fim: _isoF_(s.DATA_FIM),
        dias: Number(s.DIAS || 0),
        enviado: enviado,
        assinado: /assinad/i.test(status) || !!assinadoLink,
        baixado: !!assinadoLink,
        statusAutentique: status,
        reciboLink: String(s[FERIAS_RECIBO.COL.RECIBO_LINK] || ''),
        assinadoLink: assinadoLink,
        temEmail: !!(email && email.indexOf('@') > -1),
        temRecibo: enviado ? true : !!(achou && achou.status === 'OK')
      };
    })
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  return {
    ok: true,
    lista: lista,
    pendentes: lista.filter(x => !x.enviado).length,
    enviados: lista.filter(x => x.enviado).length,
    aBaixar: lista.filter(x => x.enviado && !x.baixado).length
  };
}

/** FERIAS.ENVIAR_RECIBO - um recibo. payload: { idSolicitacao } */
function feriasReciboEnviarUm(user, p) {
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitacao nao informada.');

  _invalidarCacheFerias_();
  const sol = _solicitacoes_().find(x => String(x.ID_SOLICITACAO) === id);
  if (!sol) throw new Error('Solicitacao nao encontrada.');
  if (String(sol.STATUS || '').toUpperCase() !== 'DEFERIDA') {
    throw new Error('So e possivel enviar recibo de ferias ja deferidas.');
  }

  const r = _reciboEnviarNucleo_(sol, _reciboArquivos_(), user);
  if (r.resultado === 'ENVIADO') return { ok: true, docId: r.docId, mensagem: 'Recibo de ' + String(r.nome).split(' ')[0] + ' enviado ao Autentique.' };
  if (r.resultado === 'PULADO')  return { ok: true, pulado: true, mensagem: 'Este recibo ja tinha sido enviado.' };
  throw new Error(r.motivo || 'Nao foi possivel enviar o recibo.');
}

/** FERIAS.ENVIAR_RECIBOS_LOTE - todos os deferidos sem ID. Para antes dos 6 min e reporta o resumo. */
function feriasReciboEnviarLote(user, p) {
  _invalidarCacheFerias_();
  const arquivos = _reciboArquivos_();

  const fila = _solicitacoes_().filter(s =>
    String(s.STATUS || '').toUpperCase() === 'DEFERIDA' &&
    !String(s[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim()
  );

  const t0 = Date.now();
  let enviados = 0, pulados = 0, erros = 0, naoProcessados = 0;
  const detalhes = [];

  for (let i = 0; i < fila.length; i++) {
    if (Date.now() - t0 > FERIAS_RECIBO.LOTE_LIMITE_MS) { naoProcessados = fila.length - i; break; }
    const sol = fila[i];
    try {
      const r = _reciboEnviarNucleo_(sol, arquivos, user);
      if (r.resultado === 'ENVIADO') { enviados++; detalhes.push('OK ' + r.nome); }
      else if (r.resultado === 'PULADO') { pulados++; }
      else { erros++; detalhes.push('ERRO ' + r.nome + ': ' + r.motivo); }
    } catch (e) { erros++; detalhes.push('ERRO ' + sol.NOME + ': ' + e.message); }
  }

  _auditar_('FERIAS_RECIBO_LOTE', user.EMAIL, 'FERIAS.ENVIAR_RECIBOS_LOTE', true,
    'enviados ' + enviados + ' . erros ' + erros + (naoProcessados ? ' . restaram ' + naoProcessados : ''), {});

  let mensagem = enviados + ' enviado(s), ' + erros + ' com erro.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' - clique de novo para continuar.';
  return { ok: true, enviados: enviados, pulados: pulados, erros: erros, naoProcessados: naoProcessados, detalhes: detalhes, mensagem: mensagem };
}

/** FERIAS.VERIFICAR_RECIBO - consulta o Autentique. payload: { idSolicitacao } */
function feriasReciboVerificar(user, p) {
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitacao nao informada.');

  const sol = _solicitacoes_().find(x => String(x.ID_SOLICITACAO) === id);
  if (!sol) throw new Error('Solicitacao nao encontrada.');

  const docId = String(sol[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim();
  if (!docId) throw new Error('Este recibo ainda nao foi enviado ao Autentique.');

  const info = _reciboConsultarDocumento_(docId);

  // Se ja esta tudo assinado, deixa o status refletido na planilha (habilita o "Baixar").
  if (info.assinado && !/assinad/i.test(String(sol[FERIAS_RECIBO.COL.STATUS_AUTENTIQUE] || ''))) {
    _reciboGravar_(id, { [FERIAS_RECIBO.COL.STATUS_AUTENTIQUE]: FERIAS_RECIBO.STATUS_ASSINADO });
  }

  const mensagem = info.rejeitado
    ? 'Um signatario rejeitou o documento.'
    : (info.assinado
        ? 'Assinado por todos (' + info.assinados + '/' + info.total + '). Ja pode baixar.'
        : 'Ainda nao assinado (' + info.assinados + '/' + info.total + ').');

  return { ok: true, assinado: info.assinado, rejeitado: info.rejeitado, assinados: info.assinados, total: info.total, mensagem: mensagem };
}

/** FERIAS.BAIXAR_RECIBO - baixa o assinado para a pasta de assinados. payload: { idSolicitacao } */
function feriasReciboBaixar(user, p) {
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitacao nao informada.');

  _invalidarCacheFerias_();
  const sol = _solicitacoes_().find(x => String(x.ID_SOLICITACAO) === id);
  if (!sol) throw new Error('Solicitacao nao encontrada.');

  const r = _reciboBaixarNucleo_(sol, user);
  if (r.resultado === 'BAIXADO')  return { ok: true, link: r.link, mensagem: 'Recibo assinado de ' + String(r.nome).split(' ')[0] + ' salvo na pasta de assinados.' };
  if (r.resultado === 'PULADO')   return { ok: true, pulado: true, mensagem: 'O assinado deste recibo ja tinha sido baixado.' };
  if (r.resultado === 'PENDENTE') throw new Error(r.motivo);
  throw new Error(r.motivo || 'Nao foi possivel baixar o assinado.');
}

/** FERIAS.BAIXAR_RECIBOS_LOTE - baixa todos os assinados ainda nao arquivados. */
function feriasReciboBaixarLote(user, p) {
  _invalidarCacheFerias_();

  const fila = _solicitacoes_().filter(s =>
    String(s.STATUS || '').toUpperCase() === 'DEFERIDA' &&
    String(s[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim() &&
    !String(s[FERIAS_RECIBO.COL.ASSINADO_LINK] || '').trim()
  );

  const t0 = Date.now();
  let baixados = 0, pendentes = 0, erros = 0, naoProcessados = 0;
  let baixouAgora = false;
  const detalhes = [];

  for (let i = 0; i < fila.length; i++) {
    if (Date.now() - t0 > FERIAS_RECIBO.LOTE_LIMITE_MS) { naoProcessados = fila.length - i; break; }
    const sol = fila[i];
    // [FIX 2026-09-28] pausa depois de cada download: o Autentique devolve 425 em downloads seguidos.
    if (baixouAgora) Utilities.sleep(700);
    baixouAgora = false;
    try {
      const r = _reciboBaixarNucleo_(sol, user);
      baixouAgora = r.resultado === 'BAIXADO' || r.resultado === 'ERRO';
      if (r.resultado === 'BAIXADO') { baixados++; detalhes.push('OK ' + r.nome); }
      else if (r.resultado === 'PENDENTE') { pendentes++; }
      else if (r.resultado === 'ERRO') { erros++; detalhes.push('ERRO ' + r.nome + ': ' + r.motivo); }
    } catch (e) { erros++; detalhes.push('ERRO ' + sol.NOME + ': ' + e.message); }
  }

  _auditar_('FERIAS_RECIBO_BAIXAR_LOTE', user.EMAIL, 'FERIAS.BAIXAR_RECIBOS_LOTE', true,
    'baixados ' + baixados + ' . pendentes ' + pendentes + ' . erros ' + erros, {});

  let mensagem = baixados + ' assinado(s) baixado(s), ' + pendentes + ' ainda sem assinar.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' - clique de novo.';
  return { ok: true, baixados: baixados, pendentes: pendentes, erros: erros, naoProcessados: naoProcessados, detalhes: detalhes, mensagem: mensagem };
}

/** FERIAS.VER_RECIBO - so leitura, mesma busca usada antes de enviar, mas sem enviar nada.
 *  Espelha rescVerDocumentosHomologacaoPorMatricula (Rescisao_Homologacao.js). payload: { idSolicitacao } */
function feriasReciboVerDocumento(user, p) {
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitacao nao informada.');

  const sol = _solicitacoes_().find(x => String(x.ID_SOLICITACAO) === id);
  if (!sol) throw new Error('Solicitacao nao encontrada.');

  const achou = _reciboAcharArquivo_(sol, _reciboArquivos_());
  if (achou.status === 'NAO_ACHOU') throw new Error('Nao encontrei o recibo na pasta.');
  if (achou.status === 'AMBIGUO')   throw new Error('Varios PDFs combinam (' + achou.qtd + '). Renomeie incluindo as datas.');
  if (achou.status === 'ERRO')      throw new Error(achou.motivo);

  const arquivoFile = _reciboArquivoFile_(achou.arquivo);
  return { ok: true, reciboUrl: arquivoFile.getUrl(), reciboNome: arquivoFile.getName() };
}

/** FERIAS.CANCELAR_RECIBO - apaga o documento no Autentique (ninguem mais consegue assinar) e
 *  limpa os campos de envio, voltando o recibo para "Prontos para Envio". So permite cancelar
 *  enquanto ainda pendente de assinatura - depois de assinado/baixado, cancelar destruiria o
 *  documento ja executado. Espelha rescCancelarHomologacaoAutentiquePorMatricula.
 *  payload: { idSolicitacao } */
function feriasReciboCancelarPorId(user, p) {
  const id = String(p.idSolicitacao || '').trim();
  if (!id) throw new Error('Solicitacao nao informada.');

  _invalidarCacheFerias_();
  const sol = _solicitacoes_().find(x => String(x.ID_SOLICITACAO) === id);
  if (!sol) throw new Error('Solicitacao nao encontrada.');

  const docId = String(sol[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim();
  if (!docId) throw new Error('Este recibo ainda nao foi enviado ao Autentique.');

  const assinadoLink = String(sol[FERIAS_RECIBO.COL.ASSINADO_LINK] || '').trim();
  if (assinadoLink) throw new Error('Este recibo ja foi baixado e arquivado, nao e possivel cancelar.');

  const info = _reciboConsultarDocumento_(docId);
  if (info.assinado) throw new Error('Este recibo ja foi assinado por todo mundo. Baixe e arquive em vez de cancelar, para nao perder o documento assinado.');

  _autentiqueApagarDocumento_(docId);

  _reciboGravar_(id, {
    [FERIAS_RECIBO.COL.ID_AUTENTIQUE]:     '',
    [FERIAS_RECIBO.COL.STATUS_AUTENTIQUE]: '',
    [FERIAS_RECIBO.COL.ENVIADO_EM]:        ''
  });

  _auditar_('FERIAS_RECIBO_CANCELADO', user.EMAIL, 'FERIAS.CANCELAR_RECIBO', true,
    sol.NOME + ' -> doc ' + docId + ' apagado no Autentique', { idSolicitacao: id });

  return { ok: true, mensagem: 'Envio do recibo de ' + String(sol.NOME).split(' ')[0] + ' cancelado. O documento foi apagado no Autentique e nao pode mais ser assinado.' };
}

/** FERIAS.VERIFICAR_RECIBOS_LOTE - checa em tempo real, de uma vez so, todos os recibos ja
 *  enviados e ainda nao baixados (botao "Atualizar" da aba "Enviados"). Espelha
 *  rescVerificarTodasAssinaturasHomologacao. */
function feriasRecibosVerificarTodos(user) {
  const pendentes = _solicitacoes_()
    .filter(s => String(s.STATUS || '').toUpperCase() === 'DEFERIDA')
    .filter(s => String(s[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim())
    .filter(s => !String(s[FERIAS_RECIBO.COL.ASSINADO_LINK] || '').trim())
    .map(s => ({ idSolicitacao: s.ID_SOLICITACAO, idAutentique: String(s[FERIAS_RECIBO.COL.ID_AUTENTIQUE]).trim() }));

  return { ok: true, verificados: _reciboVerificarLote_(pendentes) };
}

/**
 * Consulta em paralelo (UrlFetchApp.fetchAll) se cada recibo de uma lista foi assinado por todo
 * mundo. Mesma arquitetura de _autentiqueVerificarLote_ (Rescisao_Homologacao.js), mas prefixo de
 * cache proprio (ASSDOC_RECIBO_) e gravacao via _reciboGravar_ (SOLICITACOES, nao CONTROLE.2026).
 * payload interno: [{ idSolicitacao, idAutentique }].
 */
function _reciboVerificarLote_(pares) {
  if (!pares.length) return [];

  const cache = CacheService.getScriptCache();
  const chaves = pares.map(p => 'ASSDOC_RECIBO_' + p.idAutentique);
  const cacheados = cache.getAll(chaves);

  const resultado = [];
  const faltando = [];
  pares.forEach((p, i) => {
    const val = cacheados[chaves[i]];
    if (val) resultado.push(Object.assign({ idSolicitacao: p.idSolicitacao }, JSON.parse(val)));
    else faltando.push(p);
  });

  if (faltando.length) {
    const token = _autentiqueToken_();
    const query = 'query($id: UUID!){ document(id: $id){ id name signatures{ email action{ name } signed{ created_at } } } }';
    const paraCache = {};

    const TAMANHO_LOTE = 10;
    for (let inicio = 0; inicio < faltando.length; inicio += TAMANHO_LOTE) {
      const lote = faltando.slice(inicio, inicio + TAMANHO_LOTE);
      if (inicio > 0) Utilities.sleep(1000);

      const requisicoes = lote.map(p => ({
        url: _reciboEndpoint_(),
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ query: query, variables: { id: p.idAutentique } }),
        muteHttpExceptions: true
      }));

      const respostas = UrlFetchApp.fetchAll(requisicoes);

      lote.forEach((p, i) => {
        let item;
        try {
          const json = JSON.parse(respostas[i].getContentText());
          if (json.errors) {
            item = { ok: false, erro: JSON.stringify(json.errors) };
          } else {
            const doc = json.data && json.data.document;
            if (!doc) {
              item = { ok: false, erro: 'Documento nao encontrado no Autentique.' };
            } else {
              const assinaturas = doc.signatures || [];
              const totalAssinantes = assinaturas.length;
              const totalAssinados = assinaturas.filter(s => s.signed && s.signed.created_at).length;
              item = {
                ok: true,
                assinado: totalAssinantes > 0 && totalAssinados === totalAssinantes,
                totalAssinantes: totalAssinantes, totalAssinados: totalAssinados
              };
            }
          }
        } catch (e) {
          item = { ok: false, erro: e.message };
        }

        resultado.push(Object.assign({ idSolicitacao: p.idSolicitacao }, item));
        if (item.ok) {
          paraCache['ASSDOC_RECIBO_' + p.idAutentique] = JSON.stringify(item);
          if (item.assinado) {
            try { _reciboGravar_(p.idSolicitacao, { [FERIAS_RECIBO.COL.STATUS_AUTENTIQUE]: FERIAS_RECIBO.STATUS_ASSINADO }); } catch (e) { /* nao trava a verificacao por isso */ }
          }
        }
      });
    }

    Object.keys(paraCache).forEach(chave => {
      const assinado = JSON.parse(paraCache[chave]).assinado;
      cache.put(chave, paraCache[chave], assinado ? 21600 : 120);
    });
  }

  return resultado;
}

/* ============================================================================================ */
/*  DIAGNOSTICO - rode UMA vez e confira o casamento nome<->PDF antes de enviar qualquer coisa   */
/* ============================================================================================ */

function feriasDiagnosticarRecibos() {
  const arquivos = _reciboArquivos_();
  const deferidas = _solicitacoes_().filter(s => String(s.STATUS || '').toUpperCase() === 'DEFERIDA');

  const out = {
    totalPdfsNaPasta: arquivos.length,
    totalDeferidas: deferidas.length,
    casos: [],
    arquivosNaPasta: arquivos.map(a => a.nome)
  };

  deferidas.forEach(sol => {
    const idAut = String(sol[FERIAS_RECIBO.COL.ID_AUTENTIQUE] || '').trim();
    const achou = idAut ? { status: 'JA_ENVIADO' } : _reciboAcharArquivo_(sol, arquivos);
    out.casos.push({
      nome: sol.NOME,
      inicio: _isoF_(sol.DATA_INICIO),
      fim: _isoF_(sol.DATA_FIM),
      resultado: achou.status,
      arquivo: (achou.arquivo ? achou.arquivo.nome : '')
    });
  });

  console.log(JSON.stringify(out, null, 2));
  return out;
}




/* ============================================================================================ */
/*  As linhas do switch de _feriasExecutar_ (em Ferias.js) ja estao coladas, ao lado das outras  */
/*  case 'FERIAS.*' — nada a fazer aqui alem de reler se esquecer o nome de alguma funcao:       */
/* ============================================================================================ */
/*
    case 'FERIAS.RECIBOS':             return feriasRecibosLista(user);
    case 'FERIAS.ENVIAR_RECIBO':       return feriasReciboEnviarUm(user, p);
    case 'FERIAS.ENVIAR_RECIBOS_LOTE': return feriasReciboEnviarLote(user, p);
    case 'FERIAS.VERIFICAR_RECIBO':    return feriasReciboVerificar(user, p);
    case 'FERIAS.BAIXAR_RECIBO':       return feriasReciboBaixar(user, p);
    case 'FERIAS.BAIXAR_RECIBOS_LOTE': return feriasReciboBaixarLote(user, p);
    case 'FERIAS.VER_RECIBO':              return feriasReciboVerDocumento(user, p);
    case 'FERIAS.CANCELAR_RECIBO':         return feriasReciboCancelarPorId(user, p);
    case 'FERIAS.VERIFICAR_RECIBOS_LOTE':  return feriasRecibosVerificarTodos(user);
*/

/* ============================================================================================ */
/*  DIAGNÓSTICO — roda direto no editor (Executar), sem side effects destrutivos. Confere se as   */
/*  pastas do Drive e a planilha CONTROLE.2026 configuradas ainda existem/estão acessíveis pra    */
/*  conta que executa o script, e testa 1 verificação real de assinatura em "Homologações         */
/*  Enviadas" pra ver o erro de verdade, se houver.                                               */
/* ============================================================================================ */
function diagnosticarAutentiqueEDrive() {
  const linhas = [];

  function checarPasta(rotulo, id) {
    if (!id) { linhas.push(rotulo + ': (não configurado)'); return; }
    try {
      const f = DriveApp.getFolderById(id);
      linhas.push(rotulo + ': OK -> "' + f.getName() + '" (' + id + ')');
    } catch (e) {
      linhas.push(rotulo + ': ERRO -> ' + e.message + ' (id ' + id + ')');
    }
  }

  function checarPlanilha(rotulo, id) {
    try {
      const ss = SpreadsheetApp.openById(id);
      linhas.push(rotulo + ': OK -> "' + ss.getName() + '" (' + id + ')');
    } catch (e) {
      linhas.push(rotulo + ': ERRO -> ' + e.message + ' (id ' + id + ')');
    }
  }

  // ---- Recibos de férias ----
  checarPlanilha('Recibos — planilha FÉRIAS (SOLICITACOES)', FERIAS.SHEET_ID);
  checarPlanilha('Recibos — planilha MASTER (colaboradores)', DP360.MASTER_ID);
  try { checarPasta('Recibos — pasta ORIGEM', _reciboPastaId_()); }
  catch (e) { linhas.push('Recibos — pasta ORIGEM: ' + e.message); }
  try { checarPasta('Recibos — pasta ASSINADOS', _reciboPastaAssinadosId_()); }
  catch (e) { linhas.push('Recibos — pasta ASSINADOS: ' + e.message); }

  // ---- Teste real de feriasRecibosLista (é a função que a aba Recibos > Pendentes chama) ----
  try {
    const r = feriasRecibosLista({ EMAIL: 'diagnostico@cieds.org.br' }, {});
    linhas.push('Teste real de feriasRecibosLista: OK -> ' + r.lista.length + ' solicitação(ões), ' +
      r.pendentes + ' pendente(s).');
  } catch (e) {
    linhas.push('Teste real de feriasRecibosLista: ERRO -> ' + e.message + '\n' + (e.stack || ''));
  }

  // ---- Homologação de rescisão ----
  checarPlanilha('Rescisão — CONTROLE.2026', RESC.CONTROLE_ID);
  checarPasta('Homologação — pasta ORIGEM (TRCT/Seguro)', RESC_HOMOLOG.PASTA_ORIGEM_ID);
  checarPasta('Homologação — pasta ASSINADOS', RESC_HOMOLOG.PASTA_ASSINADOS_ID);

  // ---- Teste real de 1 verificação em "Homologações Enviadas" ----
  try {
    const sh = _shControle_();
    const ultimaLinha = sh.getLastRow();
    const pares = [];
    if (ultimaLinha >= RESC.CONTROLE_LINHA_INICIAL) {
      const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
      const dados = sh.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.STATUS_AUTENTIQUE).getValues();
      dados.forEach((row, i) => {
        const matricula = row[RESC.COL.MATRICULA - 1];
        const idAutentique = String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim();
        const linkAssinado = String(row[RESC.COL.LINK_DRIVE_ASSINATURA - 1] || '').trim();
        if (matricula && idAutentique && !linkAssinado) {
          pares.push({ matricula: String(matricula), idAutentique: idAutentique, linha: RESC.CONTROLE_LINHA_INICIAL + i });
        }
      });
    }
    linhas.push('Homologações em "Enviadas" (pendentes de verificação): ' + pares.length);

    if (pares.length) {
      const primeiro = pares.slice(0, 1);
      try {
        const resultado = _autentiqueVerificarLote_(sh, primeiro);
        linhas.push('Teste real (matrícula ' + primeiro[0].matricula + '): ' + JSON.stringify(resultado));
      } catch (e) {
        linhas.push('Teste real (matrícula ' + primeiro[0].matricula + '): ERRO -> ' + e.message);
      }
    }
  } catch (e) {
    linhas.push('Leitura da CONTROLE.2026: ERRO -> ' + e.message);
  }

  const relatorio = linhas.join('\n');
  console.log(relatorio);
  return relatorio;
}
