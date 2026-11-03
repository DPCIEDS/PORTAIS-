/*************************************************************************************************
 * DP360_API · Rescisao_Homologacao.gs — Homologação da rescisão no Autentique (v1.0.0)
 * -----------------------------------------------------------------------------------------------
 * Acrescenta ao módulo de Rescisão (RESCISAO.js) a busca AUTOMÁTICA do TRCT (+ Seguro Desemprego,
 * quando houver) na pasta do Drive organizada por mês, em vez de depender do upload manual usado
 * pelo "Anexar rescisão" (esse fluxo antigo continua existindo, intacto, como alternativa/backup).
 *
 * ESTRUTURA ESPERADA NA PASTA DE ORIGEM (RESC_HOMOLOG.PASTA_ORIGEM_ID):
 *   <pasta raiz>
 *     └─ 6 JUNHO / 7 JULHO / 8 AGOSTO / ... (uma subpasta por mês da demissão)
 *          └─ <NOME DA PESSOA>            (uma subpasta por colaborador)
 *               ├─ TRCT - NOME DA PESSOA.pdf              (obrigatório)
 *               └─ SEGURO DESEMPREGO - NOME DA PESSOA.pdf (opcional)
 *
 * QUANDO OS DOIS EXISTEM: são MESCLADOS em um único PDF antes de ir para o Autentique, com o nome
 * "HOMOLOGAÇÃO - NOME DA PESSOA.pdf". A mesclagem é feita na unha (sem serviço externo, por serem
 * documentos sensíveis) e só é aceita se a validação de página bater — senão, erro claro pedindo
 * para mesclar manualmente e usar o fluxo antigo (Anexar rescisão + Enviar ao Autentique).
 *
 * SIGNATÁRIOS: DP (email em RESC_HOMOLOG.DP_EMAIL_PARAM) + colaborador, igual ao recibo de férias.
 *
 * PASTA DE DESTINO (assinados): RESC_HOMOLOG.PASTA_ASSINADOS_ID — substitui, só para este fluxo, o
 * destino antigo (pasta pessoal do colaborador em AFAST_DRIVE_PASTA_ID usado por rescBaixarArquivar).
 *************************************************************************************************/

const RESC_HOMOLOG = {
  PASTA_ORIGEM_ID:     '15ZPHaBl3wRS-cuCCTFsBmTIFGs_Ax3Zh',
  PASTA_ASSINADOS_ID:  '12m2isP0WjgmB54ReADlshSM10BVeRXuq',

  DP_EMAIL_PARAM:  'RESC_HOMOLOG_DP_EMAIL',
  DP_EMAIL_PADRAO: 'dp@cieds.org.br',

  MESES: ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO',
          'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'],

  // Trava de tempo do envio em lote — o Apps Script mata a execução em 6 min (cada envio faz
  // busca no Drive + possível mesclagem de PDF + upload multipart pro Autentique, então com
  // muita gente pendente não cabe tudo numa execução só). Mesmo padrão do FERIAS_RECIBO.
  // LOTE_LIMITE_MS. Paramos antes do limite e reportamos quanto faltou, em vez de deixar o
  // Apps Script matar a execução no meio (era isso que fazia o botão "parecer" enviar só
  // ~10 de cada vez, sem nunca dizer quantos realmente faltavam).
  LOTE_LIMITE_MS: 4.5 * 60 * 1000,

  // [FIX 2026-09-28] O Portal chama a API por UrlFetchApp, que desiste depois de ~60 s (limite
  // fixo do Google). "Baixar e arquivar todas" e "Atualizar" (Enviadas) consultavam ~260
  // documentos no Autentique e baixavam um a um numa chamada só: passavam de 60 s, o Portal
  // mostrava erro e a API seguia sozinha até ser cortada (em 28/09 só 7 foram arquivadas).
  // Agora cada chamada trabalha no máximo este tempo e devolve "restantes"; o Portal repete.
  RODADA_VERIFICAR_MS: 20 * 1000,  // consulta ao Autentique dentro de uma chamada
  RODADA_TOTAL_MS: 32 * 1000,      // não começa um download novo depois disto (cada um leva ~9 s)
  RODADA_ESPERAS_MS: [3000],       // no lote, só 1 espera curta se o Autentique pedir calma (425/429)

  // Handlers dos gatilhos do antigo envio automático (diário às 20h e continuação). O envio
  // automático foi DESLIGADO em 25/09/2026: os nomes ficam aqui só para apagar gatilhos que
  // ainda existam (ver _rescExecutarEnvioAutomatico_ e desligarEnvioAutomaticoHomologacoes).
  GATILHO_DIARIO: 'rescEnviarTodasHomologacoesAutentiqueAutomatico_',
  GATILHO_CONTINUACAO: 'rescContinuarEnvioHomologacoesAutomatico_'
};

function _rescHomologDpEmail_() {
  return String(_rescParam_(RESC_HOMOLOG.DP_EMAIL_PARAM, RESC_HOMOLOG.DP_EMAIL_PADRAO)).trim();
}

/* ============================================================================================ */
/*  BUSCA NA PASTA (mês → pessoa → TRCT / Seguro Desemprego)                                    */
/* ============================================================================================ */

/**
 * [PERF/CONFIABILIDADE] Antes disto, a varredura (raiz → pasta do mês → pasta da pessoa →
 * arquivos) era refeita do ZERO a cada chamada de RESCISAO.HOMOLOGACAO_LISTA — e o Portal do DP
 * repete essa chamada sozinho a cada 60s (poll da aba Homologação). Com dezenas de pessoas
 * pendentes, isso virava centenas de idas ao Drive por minuto, esbarrando na cota de
 * DriveApp e fazendo `getFolders()`/`getFiles()` falhar de vez em quando — daí a lista
 * "piscar" (gente sumindo e voltando a cada ciclo). Agora cada nível é cacheado no
 * CacheService (sobrevive entre chamadas, TTL abaixo), e só reabre o Drive quando o cache
 * expira. Mesma técnica já usada em _reciboArquivos_ (Ferias Recibo.gs.js).
 */
var _CACHE_HOMOLOG_RAIZ_ = null;
var _CACHE_HOMOLOG_MES_PESSOAS_ = {};
var _CACHE_HOMOLOG_DOCS_ = {}; // pastaPessoaId -> [{ id, nome }] (memória desta execução)

const HOMOLOG_CACHE_TTL_RAIZ_SEG = 21600;   // 6h (máximo do CacheService) — pasta de meses quase não muda
const HOMOLOG_CACHE_TTL_PESSOAS_SEG = 1800; // 30min — pastas de pessoas novas aparecem aqui
const HOMOLOG_CACHE_TTL_DOCS_SEG = 1800;    // 30min — arquivos (TRCT/Seguro) dentro da pasta da pessoa

function _rescMesesRaiz_() {
  if (_CACHE_HOMOLOG_RAIZ_) return _CACHE_HOMOLOG_RAIZ_;

  try {
    const doCache = CacheService.getScriptCache().get('HOMOLOG_RAIZ_MESES');
    if (doCache) { _CACHE_HOMOLOG_RAIZ_ = JSON.parse(doCache); return _CACHE_HOMOLOG_RAIZ_; }
  } catch (e) { /* cache com problema não pode travar a busca — segue pro Drive */ }

  const raiz = DriveApp.getFolderById(RESC_HOMOLOG.PASTA_ORIGEM_ID);
  const it = raiz.getFolders();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), tokens: _reciboNorm_(f.getName()).split(' ').filter(Boolean) });
  }
  _CACHE_HOMOLOG_RAIZ_ = out;
  try { CacheService.getScriptCache().put('HOMOLOG_RAIZ_MESES', JSON.stringify(out), HOMOLOG_CACHE_TTL_RAIZ_SEG); } catch (e) {}
  return out;
}

/** Devolve o ID da pasta do mês (não mais o Folder — fica leve pra cachear). */
function _rescAcharPastaMes_(dataDemissao) {
  const d = (dataDemissao instanceof Date) ? dataDemissao : new Date(dataDemissao);
  if (isNaN(d.getTime())) throw new Error('Data de demissão inválida para localizar a pasta do mês.');

  const numero = String(d.getMonth() + 1);
  const nomeMes = _reciboNorm_(RESC_HOMOLOG.MESES[d.getMonth()]);

  const achado = _rescMesesRaiz_().find(m =>
    m.tokens.indexOf(numero) > -1 && m.tokens.join(' ').indexOf(nomeMes) > -1);
  return achado ? achado.id : null;
}

function _rescPessoasDoMes_(pastaMesId) {
  if (_CACHE_HOMOLOG_MES_PESSOAS_[pastaMesId]) return _CACHE_HOMOLOG_MES_PESSOAS_[pastaMesId];

  const chave = 'HOMOLOG_PESSOAS_' + pastaMesId;
  try {
    const doCache = CacheService.getScriptCache().get(chave);
    if (doCache) {
      const out = JSON.parse(doCache);
      _CACHE_HOMOLOG_MES_PESSOAS_[pastaMesId] = out;
      return out;
    }
  } catch (e) { /* segue pro Drive */ }

  const pastaMes = DriveApp.getFolderById(pastaMesId);
  const it = pastaMes.getFolders();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), norm: _reciboNorm_(f.getName()) });
  }
  _CACHE_HOMOLOG_MES_PESSOAS_[pastaMesId] = out;
  try { CacheService.getScriptCache().put(chave, JSON.stringify(out), HOMOLOG_CACHE_TTL_PESSOAS_SEG); } catch (e) {}
  return out;
}

/* ============================================================================================ */
/*  [PERF 2026-09-23] BUSCA EM LOTE                                                              */
/*  Antes, a lista abria o Drive pasta por pasta (DriveApp): com ~140 pessoas pendentes, quando  */
/*  o cache de 30 min vencia (todas juntas), um carregamento fazia centenas de idas ao Drive e    */
/*  levava minutos. Agora a lista pré-carrega tudo de uma vez: CacheService.getAll para o que já  */
/*  está em cache e a API REST do Drive (várias pastas por consulta, consultas em paralelo) para  */
/*  o resto. Medido nas pastas reais: 336 pastas de pessoas + 1.198 arquivos em ~3 s.             */
/*  Se a REST falhar, nada muda: o laço da lista cai no caminho antigo, pessoa por pessoa.        */
/* ============================================================================================ */

/**
 * Filhos diretos de várias pastas de uma vez. tipo 'PASTAS' traz só subpastas; 'ARQUIVOS' traz
 * só arquivos. Devolve { pastaId: [{ id, nome, mime }] }, ou null se alguma consulta falhar.
 */
function _driveFilhosEmLote_(pastaIds, tipo) {
  const out = {};
  pastaIds.forEach(id => { out[id] = []; });
  if (!pastaIds.length) return out;

  const filtroTipo = tipo === 'PASTAS'
    ? "mimeType = 'application/vnd.google-apps.folder'"
    : "mimeType != 'application/vnd.google-apps.folder'";
  const token = ScriptApp.getOAuthToken();
  const POR_CONSULTA = 40; // pastas por consulta (mantém a URL curta)

  let consultas = [];
  for (let i = 0; i < pastaIds.length; i += POR_CONSULTA) {
    const ids = pastaIds.slice(i, i + POR_CONSULTA);
    consultas.push({
      q: '(' + ids.map(id => "'" + id + "' in parents").join(' or ') + ') and trashed = false and ' + filtroTipo,
      pageToken: ''
    });
  }

  let voltas = 0;
  while (consultas.length) {
    if (++voltas > 30) return null; // proteção contra laço infinito de paginação
    const respostas = UrlFetchApp.fetchAll(consultas.map(c => ({
      url: 'https://www.googleapis.com/drive/v3/files?' + [
        'q=' + encodeURIComponent(c.q),
        'fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,parents)'),
        'pageSize=1000', 'supportsAllDrives=true', 'includeItemsFromAllDrives=true',
        c.pageToken ? 'pageToken=' + encodeURIComponent(c.pageToken) : ''
      ].filter(Boolean).join('&'),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    })));

    const proximas = [];
    for (let k = 0; k < respostas.length; k++) {
      if (respostas[k].getResponseCode() !== 200) {
        console.error('Drive em lote falhou (HTTP ' + respostas[k].getResponseCode() + '): ' +
          respostas[k].getContentText().slice(0, 300));
        return null;
      }
      const json = JSON.parse(respostas[k].getContentText());
      (json.files || []).forEach(f => {
        (f.parents || []).forEach(p => {
          if (out[p]) out[p].push({ id: f.id, nome: f.name, mime: f.mimeType });
        });
      });
      if (json.nextPageToken) proximas.push({ q: consultas[k].q, pageToken: json.nextPageToken });
    }
    consultas = proximas;
  }
  return out;
}

/** Pastas de pessoas de vários meses: memória, depois CacheService (getAll), depois Drive em lote. */
function _rescPrefetchPessoasDosMeses_(mesIds) {
  const faltam = mesIds.filter(id => !_CACHE_HOMOLOG_MES_PESSOAS_[id]);
  if (!faltam.length) return;

  const cache = CacheService.getScriptCache();
  let doCache = {};
  try { doCache = cache.getAll(faltam.map(id => 'HOMOLOG_PESSOAS_' + id)) || {}; } catch (e) {}

  const semCache = [];
  faltam.forEach(id => {
    const v = doCache['HOMOLOG_PESSOAS_' + id];
    if (v) {
      try { _CACHE_HOMOLOG_MES_PESSOAS_[id] = JSON.parse(v); return; } catch (e) {}
    }
    semCache.push(id);
  });
  if (!semCache.length) return;

  const filhos = _driveFilhosEmLote_(semCache, 'PASTAS');
  if (!filhos) return; // _rescPessoasDoMes_ busca uma a uma, como antes

  const paraCache = {};
  semCache.forEach(id => {
    const lista = filhos[id].map(f => ({ id: f.id, norm: _reciboNorm_(f.nome) }));
    _CACHE_HOMOLOG_MES_PESSOAS_[id] = lista;
    paraCache['HOMOLOG_PESSOAS_' + id] = JSON.stringify(lista);
  });
  try { cache.putAll(paraCache, HOMOLOG_CACHE_TTL_PESSOAS_SEG); } catch (e) {}
}

/** PDFs de várias pastas de pessoas: memória, depois CacheService (getAll), depois Drive em lote.
 *  ignorarCache=true (botão "Atualizar") relê do Drive, para PDF novo aparecer na hora. */
function _rescPrefetchDocs_(pessoaIds, ignorarCache) {
  const faltam = pessoaIds.filter(id => !_CACHE_HOMOLOG_DOCS_[id]);
  if (!faltam.length) return;

  const cache = CacheService.getScriptCache();
  let doCache = {};
  if (!ignorarCache) {
    try { doCache = cache.getAll(faltam.map(id => 'HOMOLOG_DOCS_' + id)) || {}; } catch (e) {}
  }

  const semCache = [];
  faltam.forEach(id => {
    const v = doCache['HOMOLOG_DOCS_' + id];
    if (v) {
      try { _CACHE_HOMOLOG_DOCS_[id] = JSON.parse(v); return; } catch (e) {}
    }
    semCache.push(id);
  });
  if (!semCache.length) return;

  const filhos = _driveFilhosEmLote_(semCache, 'ARQUIVOS');
  if (!filhos) return; // _rescAcharDocumentosHomologacao_ busca uma a uma, como antes

  const paraCache = {};
  semCache.forEach(id => {
    // mesmo critério de antes: termina em .pdf OU é do tipo PDF
    const lista = filhos[id]
      .filter(f => /\.pdf$/i.test(f.nome) || f.mime === 'application/pdf')
      .map(f => ({ id: f.id, nome: f.nome }));
    _CACHE_HOMOLOG_DOCS_[id] = lista;
    paraCache['HOMOLOG_DOCS_' + id] = JSON.stringify(lista);
  });
  try { cache.putAll(paraCache, HOMOLOG_CACHE_TTL_DOCS_SEG); } catch (e) {}
}

/** Pré-carrega em lote tudo o que o laço de rescHomologacaoLista vai consultar no Drive. */
function _rescPrefetchHomologacao_(dados, forcar) {
  const alvos = [];
  dados.forEach(row => {
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!row[RESC.COL.MATRICULA - 1] || !nome || !demissao) return;
    if (String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim()) return; // já enviado: não busca no Drive
    let mesId = null;
    try { mesId = _rescAcharPastaMes_(demissao); } catch (e) { return; }
    if (mesId) alvos.push({ mesId: mesId, nome: nome });
  });

  const meses = alvos.map(a => a.mesId).filter((v, i, l) => l.indexOf(v) === i);
  _rescPrefetchPessoasDosMeses_(meses);

  const pessoas = [];
  alvos.forEach(a => {
    if (!_CACHE_HOMOLOG_MES_PESSOAS_[a.mesId]) return; // mês não carregou: o laço busca como antes
    const p = _rescAcharPastaPessoa_(a.mesId, a.nome);
    if (p && !p.ambiguo && pessoas.indexOf(p) === -1) pessoas.push(p);
  });
  _rescPrefetchDocs_(pessoas, !!forcar);
}

/** Zera os 3 níveis de cache — chamar depois de adicionar pasta/PDF novo no Drive, ou pelo
 *  botão "Atualizar" da aba Homologação (payload.forcar), pra não esperar o TTL. */
function _invalidarCacheHomologacaoDocs_() {
  _CACHE_HOMOLOG_RAIZ_ = null;
  _CACHE_HOMOLOG_MES_PESSOAS_ = {};
  _CACHE_HOMOLOG_DOCS_ = {};
  try {
    const cache = CacheService.getScriptCache();
    const raiz = cache.get('HOMOLOG_RAIZ_MESES');
    const chaves = ['HOMOLOG_RAIZ_MESES'];
    if (raiz) {
      JSON.parse(raiz).forEach(m => {
        chaves.push('HOMOLOG_PESSOAS_' + m.id);
      });
    }
    cache.removeAll(chaves);
    // Os caches de documentos (HOMOLOG_DOCS_<idPessoa>) não têm como ser enumerados sem
    // reabrir o Drive — expiram sozinhos em até 30min, o que já resolve a maioria dos casos.
  } catch (e) { /* não trava por causa disso */ }
}

// Conectores que aparecem/somem de forma inconsistente entre a planilha e a pasta do Drive
// (ex.: "JOAO DA SILVA" na CONTROLE.2026 vs pasta "JOAO SILVA") — ignorados na comparação.
var _RESC_CONECTORES_NOME_ = ['de', 'da', 'do', 'das', 'dos', 'e'];

/** Normaliza um nome pra comparação EXATA (mesmo conjunto de palavras "significativas", sem
 *  conectores, ordem não importa). */
function _rescNomeChave_(nome) {
  return _reciboNorm_(nome).split(' ').filter(Boolean)
    .filter(t => _RESC_CONECTORES_NOME_.indexOf(t) === -1)
    .sort().join(' ');
}

/**
 * [SEGURANÇA] Exige que o conjunto de palavras da pasta seja EXATAMENTE igual ao nome da linha
 * da CONTROLE.2026 — não basta "conter" as palavras (isso deixava "JOAO SILVA" casar com uma
 * pasta "JOAO PEDRO SILVA" de outra pessoa). Se não bater exato, cai em NAO_ACHOU em vez de
 * arriscar pegar a pasta errada. Devolve o ID da pasta (não mais o Folder — fica leve pra cachear).
 */
function _rescAcharPastaPessoa_(pastaMesId, nome) {
  const chaveAlvo = _rescNomeChave_(nome);
  if (!chaveAlvo) return null;

  const candidatas = _rescPessoasDoMes_(pastaMesId).filter(p => _rescNomeChave_(p.norm) === chaveAlvo);
  if (candidatas.length === 0) return null;
  if (candidatas.length > 1) return { ambiguo: true, qtd: candidatas.length };
  return candidatas[0].id;
}

/** Um "arquivo leve" (id + nome, sem abrir o Drive) com os mesmos métodos que o resto do
 *  código já espera de um File de verdade (getUrl/getName/getBlob) — só busca o Blob de
 *  verdade (getFileById) na hora que alguém realmente precisa baixar o conteúdo. */
function _rescArquivoLeve_(id, nome) {
  return {
    getId: function () { return id; },
    getName: function () { return nome; },
    getUrl: function () { return 'https://drive.google.com/file/d/' + id + '/view'; },
    getBlob: function () { return DriveApp.getFileById(id).getBlob(); }
  };
}

/**
 * [SEGURANÇA] Também confere se o NOME dentro do arquivo (tirando os rótulos "TRCT"/"SEGURO
 * DESEMPREGO") bate exatamente com o nome da linha — protege contra um arquivo de outra pessoa
 * ter ficado, por engano, dentro da pasta certa.
 */
function _rescAcharDocumentosHomologacao_(pastaPessoaId, nome) {
  const chaveAlvo = _rescNomeChave_(nome);

  const chaveCache = 'HOMOLOG_DOCS_' + pastaPessoaId;
  let arquivos = _CACHE_HOMOLOG_DOCS_[pastaPessoaId] || null; // pré-carregado em lote
  if (!arquivos) {
    try {
      const doCache = CacheService.getScriptCache().get(chaveCache);
      if (doCache) arquivos = JSON.parse(doCache);
    } catch (e) { /* segue pro Drive */ }
  }

  if (!arquivos) {
    const pastaPessoa = DriveApp.getFolderById(pastaPessoaId);
    const it = pastaPessoa.getFiles();
    arquivos = [];
    while (it.hasNext()) {
      const f = it.next();
      const ehPdf = /\.pdf$/i.test(f.getName()) || f.getMimeType() === MimeType.PDF;
      if (ehPdf) arquivos.push({ id: f.getId(), nome: f.getName() });
    }
    try { CacheService.getScriptCache().put(chaveCache, JSON.stringify(arquivos), HOMOLOG_CACHE_TTL_DOCS_SEG); } catch (e) {}
  }

  let trct = null, seguro = null;

  arquivos.forEach(a => {
    // [FIX] Tira a extensão antes de normalizar — senão "pdf" vira uma palavra extra no nome
    // e a comparação exata com o nome da planilha nunca bate (o TRCT nunca era encontrado).
    const semExtensao = a.nome.replace(/\.pdf$/i, '');
    const norm = _reciboNorm_(semExtensao);
    const ehTrct = norm.indexOf('trct') > -1;
    const ehSeguro = norm.indexOf('seguro desemprego') > -1;
    if (!ehTrct && !ehSeguro) return;

    const semRotulo = norm.replace(/\btrct\b/g, '').replace(/\bseguro\s+desemprego\b/g, '');
    if (_rescNomeChave_(semRotulo) !== chaveAlvo) return; // nome no arquivo nao bate exato - ignora

    if (!trct && ehTrct) trct = _rescArquivoLeve_(a.id, a.nome);
    else if (!seguro && ehSeguro) seguro = _rescArquivoLeve_(a.id, a.nome);
  });

  return { trct: trct, seguro: seguro };
}

/**
 * Resultado: { status: 'OK', trct, seguro? } ou
 *            { status: 'SEM_DATA_DEMISSAO' | 'SEM_PASTA_MES' | 'NAO_ACHOU' | 'SEM_TRCT' | 'ERRO' }
 *            { status: 'AMBIGUO', qtd }
 *
 * [FIX] Todo o corpo agora está dentro do try/catch — antes só a busca da pasta do mês estava
 * protegida, então um erro passageiro do Drive (cota, timeout) ao listar a pasta da pessoa ou
 * os arquivos dela escapava sem tratamento e derrubava rescHomologacaoLista() por INTEIRO (a
 * lista sumia pra todo mundo, não só pra quem deu erro) — bate com o "aparece e some" relatado.
 */
function _rescAcharHomologacao_(caso) {
  if (!caso.DATA_DEMISSAO) return { status: 'SEM_DATA_DEMISSAO' };

  try {
    const pastaMesId = _rescAcharPastaMes_(caso.DATA_DEMISSAO);
    if (!pastaMesId) return { status: 'SEM_PASTA_MES' };

    const pastaPessoa = _rescAcharPastaPessoa_(pastaMesId, caso.NOME);
    if (!pastaPessoa) return { status: 'NAO_ACHOU' };
    if (pastaPessoa.ambiguo) return { status: 'AMBIGUO', qtd: pastaPessoa.qtd };

    const docs = _rescAcharDocumentosHomologacao_(pastaPessoa, caso.NOME);
    if (!docs.trct) return { status: 'SEM_TRCT' };

    return { status: 'OK', trct: docs.trct, seguro: docs.seguro };
  } catch (e) {
    return { status: 'ERRO', motivo: e.message };
  }
}

/* ============================================================================================ */
/*  MESCLAGEM DE PDF (na unha, sem serviço externo — documentos sensíveis)                       */
/*  Suporta PDFs classicos (tabela xref em texto, não criptografados). Se o PDF usar xref em      */
/*  stream (comum em geradores modernos) ou estiver criptografado, lança erro claro em vez de      */
/*  arriscar um documento corrompido.                                                              */
/* ============================================================================================ */

function _bytesToBinaryString_(bytes) {
  const CH = 8192;
  let out = '';
  for (let i = 0; i < bytes.length; i += CH) {
    const parte = bytes.slice(i, i + CH).map(b => (b < 0 ? b + 256 : b));
    out += String.fromCharCode.apply(null, parte);
  }
  return out;
}

function _binaryStringToBytes_(str) {
  const bytes = new Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    bytes[i] = c > 127 ? c - 256 : c;
  }
  return bytes;
}

function _pdfObjetos_(bin) {
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const marcas = [];
  let m;
  while ((m = re.exec(bin))) marcas.push({ num: Number(m[1]), gen: Number(m[2]), inicio: m.index });
  if (!marcas.length) throw new Error('Nenhum objeto PDF encontrado (formato não suportado).');

  const xrefPos = bin.search(/\r?\nxref\b/);
  for (let i = 0; i < marcas.length; i++) {
    marcas[i].fim = (i + 1 < marcas.length) ? marcas[i + 1].inicio : (xrefPos > -1 ? xrefPos : bin.length);
    marcas[i].bytes = bin.slice(marcas[i].inicio, marcas[i].fim);
  }

  const porNumero = {};
  marcas.forEach(o => { porNumero[o.num] = o; });
  return { marcas: marcas, porNumero: porNumero };
}

function _pdfRootObjNum_(bin, objetos) {
  const trailerIdx = bin.lastIndexOf('trailer');
  if (trailerIdx === -1) {
    const cat = objetos.marcas.find(o => /\/Type\s*\/Catalog\b/.test(o.bytes));
    if (cat) return cat.num;
    throw new Error('PDF sem trailer nem Catalog (formato não suportado).');
  }
  const trecho = bin.slice(trailerIdx, trailerIdx + 2000);
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(trecho)) {
    throw new Error('PDF protegido/criptografado — mesclagem automática não suportada.');
  }
  const m = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trecho);
  if (!m) throw new Error('Não encontrei /Root no trailer do PDF.');
  return Number(m[1]);
}

function _pdfPaginasRef_(objetos, rootNum) {
  const cat = objetos.porNumero[rootNum];
  if (!cat) throw new Error('Objeto Catalog (' + rootNum + ') não encontrado no PDF.');
  const m = /\/Pages\s+(\d+)\s+(\d+)\s+R/.exec(cat.bytes);
  if (!m) throw new Error('Catalog sem /Pages (formato não suportado).');
  return Number(m[1]);
}

function _pdfContarPaginas_(objetos, pagesNum) {
  const obj = objetos.porNumero[pagesNum];
  const m = /\/Count\s+(\d+)/.exec(obj.bytes);
  return m ? Number(m[1]) : 1;
}

/** Separa "N G obj <<dict>> stream ... endstream endobj" em dict (texto, seguro pra regex) e
 *  stream (bytes crus, NUNCA tocados, pra nao arriscar corromper conteudo binario comprimido). */
function _pdfSepararStream_(objBytes) {
  const si = objBytes.indexOf('stream');
  if (si === -1) return { dict: objBytes, temStream: false };

  const dictPart = objBytes.slice(0, si);
  const mLen = /\/Length\s+(\d+)/.exec(dictPart);
  if (!mLen) return { dict: objBytes, temStream: false }; // /Length indireto (raro): nao arrisca separar

  let bodyStart = si + 'stream'.length;
  if (objBytes.substr(bodyStart, 2) === '\r\n') bodyStart += 2;
  else if (objBytes.charAt(bodyStart) === '\n') bodyStart += 1;

  const length = Number(mLen[1]);
  const streamBody = objBytes.substr(bodyStart, length);
  const resto = objBytes.slice(bodyStart + length);

  return {
    dict: dictPart,
    streamPrefix: objBytes.slice(si, bodyStart),
    streamBody: streamBody,
    streamSuffix: resto,
    temStream: true
  };
}

function _pdfRenumerarDict_(dictBin, offset) {
  return dictBin.replace(/(\d+)(\s+)(\d+)(\s+)R\b/g,
    (full, num, ws1, gen, ws2) => (Number(num) + offset) + ws1 + gen + ws2 + 'R');
}

function _pdfRenumerarHeader_(bytesObj, offset) {
  return bytesObj.replace(/^(\d+)(\s+)(\d+)(\s+)obj\b/,
    (full, num, ws1, gen, ws2) => (Number(num) + offset) + ws1 + gen + ws2 + 'obj');
}

function _pdfAjustarParent_(bytesObj, novoParentNum) {
  if (/\/Parent\s+\d+\s+\d+\s+R/.test(bytesObj)) {
    return bytesObj.replace(/\/Parent\s+\d+\s+\d+\s+R/, '/Parent ' + novoParentNum + ' 0 R');
  }
  return bytesObj.replace('<<', '<< /Parent ' + novoParentNum + ' 0 R');
}

function _pad10_(n) {
  let s = String(Math.floor(n));
  while (s.length < 10) s = '0' + s;
  return s;
}

/** Mescla 2 PDFs (blobs) em 1 só, concatenando as árvores de página (sem reescrever cada
 *  página individualmente — só ajusta o /Parent das 2 raízes de Pages para um Pages novo). */
function _pdfMesclar_(blobA, blobB) {
  const binA = _bytesToBinaryString_(blobA.getBytes());
  const binB = _bytesToBinaryString_(blobB.getBytes());

  const objsA = _pdfObjetos_(binA);
  const objsB = _pdfObjetos_(binB);

  const rootA = _pdfRootObjNum_(binA, objsA);
  const rootB = _pdfRootObjNum_(binB, objsB);

  const pagesA = _pdfPaginasRef_(objsA, rootA);
  const pagesB = _pdfPaginasRef_(objsB, rootB);

  const maxNumA = Math.max.apply(null, objsA.marcas.map(o => o.num));
  const maxNumB = Math.max.apply(null, objsB.marcas.map(o => o.num));
  const offset = maxNumA + 1000; // margem de seguranca contra colisao de numeracao

  const objsBRenumerados = {};
  objsB.marcas.forEach(o => {
    const partes = _pdfSepararStream_(o.bytes);
    const dictRenum = _pdfRenumerarHeader_(_pdfRenumerarDict_(partes.dict, offset), offset);
    const novoNum = o.num + offset;
    objsBRenumerados[novoNum] = partes.temStream
      ? (dictRenum + partes.streamPrefix + partes.streamBody + partes.streamSuffix)
      : dictRenum;
  });

  const pagesBNovo = pagesB + offset;
  const novoPagesNum = offset + maxNumB + 1;
  const novoCatalogNum = novoPagesNum + 1;

  const totalPaginas = _pdfContarPaginas_(objsA, pagesA) + _pdfContarPaginas_(objsB, pagesB);

  const pagesAAjustado = _pdfAjustarParent_(objsA.porNumero[pagesA].bytes, novoPagesNum);
  const pagesBAjustado = _pdfAjustarParent_(objsBRenumerados[pagesBNovo], novoPagesNum);

  const novoPagesObj = novoPagesNum + ' 0 obj\n<< /Type /Pages /Kids [' + pagesA + ' 0 R ' +
    pagesBNovo + ' 0 R] /Count ' + totalPaginas + ' >>\nendobj\n';
  const novoCatalogObj = novoCatalogNum + ' 0 obj\n<< /Type /Catalog /Pages ' + novoPagesNum + ' 0 R >>\nendobj\n';

  const partesFinais = [];
  const offsets = {};
  let cursor = 0;
  function add(texto) { partesFinais.push(texto); cursor += texto.length; }

  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  objsA.marcas.forEach(o => {
    offsets[o.num] = cursor;
    add((o.num === pagesA ? pagesAAjustado : o.bytes) + '\n');
  });

  Object.keys(objsBRenumerados).forEach(numStr => {
    const num = Number(numStr);
    offsets[num] = cursor;
    add((num === pagesBNovo ? pagesBAjustado : objsBRenumerados[numStr]) + '\n');
  });

  offsets[novoPagesNum] = cursor; add(novoPagesObj);
  offsets[novoCatalogNum] = cursor; add(novoCatalogObj);

  const xrefOffset = cursor;
  const maxNum = novoCatalogNum;
  let xref = 'xref\n0 ' + (maxNum + 1) + '\n0000000000 65535 f \n';
  for (let n = 1; n <= maxNum; n++) {
    xref += (offsets[n] !== undefined ? _pad10_(offsets[n]) + ' 00000 n \n' : '0000000000 00000 f \n');
  }
  add(xref);
  add('trailer\n<< /Size ' + (maxNum + 1) + ' /Root ' + novoCatalogNum + ' 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF');

  const finalBin = partesFinais.join('');
  _pdfValidarMerge_(finalBin, totalPaginas);

  return Utilities.newBlob(_binaryStringToBytes_(finalBin), 'application/pdf', 'merged.pdf');
}

/** Reabre o PDF resultante e confere se o numero de paginas bate com o esperado ANTES de aceitar
 *  a mesclagem — nunca manda um documento potencialmente corrompido para assinatura. */
function _pdfValidarMerge_(finalBin, paginasEsperadas) {
  if (finalBin.slice(0, 4) !== '%PDF') throw new Error('resultado não começa com %PDF.');
  const objs = _pdfObjetos_(finalBin);
  const root = _pdfRootObjNum_(finalBin, objs);
  const pagesRef = _pdfPaginasRef_(objs, root);
  const count = _pdfContarPaginas_(objs, pagesRef);
  if (count !== paginasEsperadas) {
    throw new Error('esperava ' + paginasEsperadas + ' página(s) no resultado, ficaram ' + count + '.');
  }
}

/* ============================================================================================ */
/*  AÇÕES - chamadas pelo portal                                                                 */
/* ============================================================================================ */

/** Acha o colaborador na MASTER pela matrícula (ignora zeros à esquerda). */
function _colaboradorPorMatricula_(matricula) {
  const alvo = _benNormalizarMatricula_(matricula);
  if (!alvo) return null;
  return _colaboradores_().find(c => _benNormalizarMatricula_(c.MATRICULA) === alvo) || null;
}

/** VER_DOCUMENTOS_HOMOLOGACAO — só leitura, mesma busca usada antes de enviar, mas sem enviar
 *  nada. Devolve o(s) link(s) do(s) documento(s) encontrado(s) na pasta (TRCT + Seguro
 *  Desemprego, quando houver os dois). payload: { matricula } */
function rescVerDocumentosHomologacaoPorMatricula(user, p) {
  const matricula = String(p.matricula || '').trim();
  if (!matricula) throw new Error('Matrícula não informada.');

  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, matricula);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const nome = sh.getRange(row, RESC.COL.NOME).getValue();
  const demissao = sh.getRange(row, RESC.COL.DEMISSAO).getValue();
  if (!demissao) throw new Error('Sem data de demissão registrada para esta matrícula.');

  const achou = _rescAcharHomologacao_({ NOME: nome, DATA_DEMISSAO: demissao });
  if (achou.status === 'SEM_PASTA_MES') throw new Error('Não encontrei a pasta do mês da demissão na pasta de rescisões.');
  if (achou.status === 'NAO_ACHOU')     throw new Error('Não encontrei a pasta desta pessoa na pasta do mês.');
  if (achou.status === 'AMBIGUO')       throw new Error('Mais de uma pasta bate com esse nome (' + achou.qtd + '). Renomeie para desambiguar.');
  if (achou.status === 'SEM_TRCT')      throw new Error('Não encontrei o TRCT na pasta desta pessoa.');
  if (achou.status === 'ERRO')          throw new Error(achou.motivo);

  const out = { ok: true, trctUrl: achou.trct.getUrl(), trctNome: achou.trct.getName() };
  if (achou.seguro) {
    out.seguroUrl = achou.seguro.getUrl();
    out.seguroNome = achou.seguro.getName();
  }
  return out;
}

/** VERIFICAR_ASSINATURA_HOMOLOGACAO — consulta em tempo real no Autentique (não depende da
 *  coluna STATUS AUTENTIQUE / AH, que é escrita por uma automação separada e pode estar
 *  atrasada ou nem saber desse documento). payload: { matricula } */
function rescVerificarAssinaturaHomologacaoPorMatricula(user, p) {
  const matricula = String(p.matricula || '').trim();
  if (!matricula) throw new Error('Matrícula não informada.');

  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, matricula);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const idAut = String(sh.getRange(row, RESC.COL.ID_AUTENTIQUE).getValue() || '').trim();
  if (!idAut) throw new Error('Esta homologação ainda não foi enviada ao Autentique.');

  const info = _autentiqueDocumentoAssinado_(idAut);

  // Grava na planilha (não só devolve pra tela) — assim qualquer pessoa que abrir o Portal já
  // vê o status atualizado, sem precisar clicar em Verificar ela mesma.
  try { _gravarStatusAutentiqueAoVivo_(sh, _colunasStatusAutentiqueAoVivo_(sh), row, info); } catch (e) { /* não trava a verificação por isso */ }

  return {
    ok: true,
    assinado: info.assinado,
    totalAssinantes: info.totalAssinantes,
    totalAssinados: info.totalAssinados,
    mensagem: info.assinado
      ? 'Já está assinado por todo mundo. Use "Baixar e arquivar" para concluir.'
      : 'Ainda faltam assinaturas (' + info.totalAssinados + ' de ' + info.totalAssinantes + ' assinaram até agora).'
  };
}

/** VERIFICAR_TODAS_ASSINATURAS_HOMOLOGACAO — checa em tempo real, de uma vez só, todas as
 *  homologações já enviadas e ainda não arquivadas (botão "Atualizar" da lista). */
function rescVerificarTodasAssinaturasHomologacao(user) {
  const prazo = Date.now() + RESC_HOMOLOG.RODADA_TOTAL_MS;
  const sh = _shControle_();
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha < RESC.CONTROLE_LINHA_INICIAL) return { ok: true, verificados: [] };

  const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
  const dados = sh.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.STATUS_AUTENTIQUE).getValues();

  // Mesmo critério de elegibilidade da RESCISAO.HOMOLOGACAO_LISTA (nome + demissão preenchidos).
  const pendentes = [];
  dados.forEach((row, i) => {
    const matricula = row[RESC.COL.MATRICULA - 1];
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!matricula || !nome || !demissao) return;

    const idAutentique = String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim();
    const linkAssinado = String(row[RESC.COL.LINK_DRIVE_ASSINATURA - 1] || '').trim();
    if (idAutentique && !linkAssinado) {
      pendentes.push({ matricula: String(matricula), idAutentique: idAutentique, linha: RESC.CONTROLE_LINHA_INICIAL + i });
    }
  });

  // [FIX 2026-09-28] Em rodadas: o que não coube no prazo volta em "restantes" e o Portal chama
  // de novo (o que já foi consultado fica no cache e não é consultado outra vez).
  const verificados = _autentiqueVerificarLote_(sh, pendentes, prazo);
  return { ok: true, verificados: verificados, restantes: pendentes.length - verificados.length,
    consultadosAgora: verificados.consultadosAgora || 0 };
}

/**
 * Consulta em paralelo (UrlFetchApp.fetchAll) se cada documento de uma lista foi assinado por
 * todo mundo — usado tanto pela lista principal (pra nunca mostrar "Assinado" errado) quanto
 * pelo botão "Atualizar". payload: [{ matricula, idAutentique }].
 *
 * Usa CacheService pra não bater no limite de "premium urlfetch" do Apps Script quando a
 * pessoa navega/recarrega várias vezes seguidas — a lista roda essa checagem a cada carregada.
 * "Assinado por todo mundo" é um estado estável (não desfaz sozinho), então guarda mais tempo;
 * "ainda pendente" guarda pouco, só pra segurar rajadas de cliques, sem ficar desatualizado.
 */
function _autentiqueVerificarLote_(sh, pares, prazo) {
  if (!pares.length) return [];

  const cache = CacheService.getScriptCache();
  const chaves = pares.map(p => 'ASSDOC_' + p.idAutentique);
  const cacheados = cache.getAll(chaves);

  const resultado = [];
  const faltando = [];
  pares.forEach((p, i) => {
    const val = cacheados[chaves[i]];
    if (val) resultado.push(Object.assign({ matricula: p.matricula }, JSON.parse(val)));
    else faltando.push(p);
  });

  if (faltando.length) {
    const token = _autentiqueToken_();
    const query = 'query($id: UUID!){ document(id: $id){ id name signatures{ email action{ name } signed{ created_at } } } }';
    const paraCache = {};
    const paraGravar = []; // [PERF] junta tudo e grava em lote no final, ver _gravarStatusAutentiqueAoVivoLote_
    const colunasStatus = _colunasStatusAutentiqueAoVivo_(sh);

    // Manda em lotes pequenos, com uma pausa entre eles — mandar tudo de uma vez (fetchAll com
    // muitos itens) estoura o limite de rajada do Apps Script ("premium urlfetch"), mesmo com
    // cache (o cache só ajuda em recargas seguintes, não na primeira vez com muita gente pendente).
    const TAMANHO_LOTE = 10;
    let consultados = 0;
    for (let inicio = 0; inicio < faltando.length; inicio += TAMANHO_LOTE) {
      // [FIX 2026-09-28] prazo opcional: sempre consulta ao menos um lote (para avançar) e para
      // de abrir lotes novos depois do prazo. Quem ficou de fora não entra no resultado.
      if (prazo && inicio > 0 && Date.now() > prazo) break;
      const lote = faltando.slice(inicio, inicio + TAMANHO_LOTE);
      if (inicio > 0) Utilities.sleep(1000);
      consultados += lote.length;

      const requisicoes = lote.map(p => ({
        url: RESC.AUTENTIQUE_ENDPOINT,
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
              item = { ok: false, erro: 'Documento não encontrado no Autentique.' };
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

        resultado.push(Object.assign({ matricula: p.matricula }, item));
        if (item.ok) {
          paraCache['ASSDOC_' + p.idAutentique] = JSON.stringify(item);
          // Grava na planilha (STATUS AUTENTIQUE / ÚLTIMA VERIFICAÇÃO) só quando buscou fresco
          // no Autentique — assim fica visível pra qualquer pessoa que abrir o Portal, não só
          // na tela de quem clicou. Resultado vindo do cache não regrava (já foi gravado antes).
          paraGravar.push({ linha: p.linha, info: item });
        }
      });
    }

    // [FIX 2026-09-28] Nas rodadas (com prazo), "ainda não assinado" fica 10 min no cache (antes
    // 2 min): o que já foi consultado não volta a ser consultado antes de a varredura terminar.
    // Sem prazo (Recibos de Férias), continua 2 min.
    Object.keys(paraCache).forEach(chave => {
      const assinado = JSON.parse(paraCache[chave]).assinado;
      cache.put(chave, paraCache[chave], assinado ? 21600 : (prazo ? 600 : 120));
    });
    resultado.consultadosAgora = consultados;

    if (paraGravar.length) {
      try { _gravarStatusAutentiqueAoVivoLote_(sh, colunasStatus, paraGravar); } catch (e) { /* não trava a verificação por isso */ }
    }
  }

  return resultado;
}

/**
 * HOMOLOGACAO_LISTA — lê direto a CONTROLE.2026 (não depende de caso aberto no Portal; a maioria
 * das rescisões só existe nessa planilha mesmo, lançadas fora do fluxo de Solicitar/Desligar).
 * Uma linha = uma matrícula com DATA DE DEMISSAO preenchida.
 */
// Tipos de demissão (coluna "TIPO DE DEMISSÃO", achada pelo NOME do cabeçalho, não por índice
// fixo) em que o Seguro Desemprego é obrigatório na pasta, além do TRCT. Nos demais tipos da
// lista suspensa, só o TRCT é obrigatório.
const RESC_HOMOLOG_TIPOS_EXIGEM_SEGURO = [
  'ANTECIPAÇÃO DE TÉRMINO - PELO EMPREGADOR',
  'AVISO INDENIZADO',
  'AVISO PRÉVIO TRABALHADO'
];

function _rescSeguroObrigatorio_(tipoDemissao) {
  return RESC_HOMOLOG_TIPOS_EXIGEM_SEGURO.indexOf(String(tipoDemissao || '').trim().toUpperCase()) > -1;
}

function rescHomologacaoLista(user, p) {
  if (p && p.forcar) _invalidarCacheHomologacaoDocs_();

  const sh = _shControle_();
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha < RESC.CONTROLE_LINHA_INICIAL) return { ok: true, lista: [], pendentes: 0, aBaixar: 0 };

  const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
  const dados = sh.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.STATUS_AUTENTIQUE).getValues();
  const colTipoDemissao = _colunaPorNomeExato_(sh, 2, 'TIPO DE DEMISSÃO');

  // [PERF] Busca no Drive em lote, antes do laço (ver _rescPrefetchHomologacao_).
  try { _rescPrefetchHomologacao_(dados, p && p.forcar); }
  catch (e) { console.error('Pré-carga da homologação falhou, seguindo pessoa a pessoa: ' + e); }

  const lista = [];
  dados.forEach(row => {
    const matricula = row[RESC.COL.MATRICULA - 1];
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!matricula || !nome || !demissao) return; // sem desligamento registrado, nao e rescisao

    const idAutentique = String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim();
    const statusAutentique = String(row[RESC.COL.STATUS_AUTENTIQUE - 1] || '');
    const linkAssinado = String(row[RESC.COL.LINK_DRIVE_ASSINATURA - 1] || '').trim();
    const enviado = !!idAutentique;
    // Lê o status já GRAVADO na planilha (por "Verificar"/"Atualizar" de qualquer pessoa) — não
    // faz checagem ao vivo aqui (seria lenta e cara em toda navegação). Como agora é este
    // módulo que mantém essa coluna atualizada a cada verificação, ela é confiável.
    const assinado = RESC.MARCADORES_ASSINADO.some(m => statusAutentique.toUpperCase().indexOf(m) > -1);

    let temHomologacao, documentacaoCompleta = null, faltando = [], documentosPresentes = [];
    if (enviado) {
      temHomologacao = true;
    } else {
      const achou = _rescAcharHomologacao_({ NOME: nome, DATA_DEMISSAO: demissao });
      temHomologacao = achou.status === 'OK';
      if (temHomologacao) {
        const seguroObrigatorio = _rescSeguroObrigatorio_(row[colTipoDemissao - 1]);
        const temSeguro = !!achou.seguro;
        documentacaoCompleta = !seguroObrigatorio || temSeguro; // TRCT já garantido pelo status OK
        if (seguroObrigatorio && !temSeguro) faltando.push('Seguro Desemprego');
        documentosPresentes.push('TRCT');
        if (temSeguro) documentosPresentes.push('Seguro Desemprego');
      }
    }

    lista.push({
      matricula: String(matricula),
      nome: nome,
      demissao: _isoF_(demissao),
      enviado: enviado,
      assinado: assinado,
      baixado: !!linkAssinado,
      assinadoLink: linkAssinado,
      statusAutentique: statusAutentique,
      temHomologacao: temHomologacao,
      documentacaoCompleta: documentacaoCompleta,
      faltando: faltando,
      documentosPresentes: documentosPresentes,
      tipo: String(row[colTipoDemissao - 1] || '').trim() // [2026-10-14] filtro "Tipo" da Homologação no portal
    });
  });

  lista.sort((a, b) => String(b.demissao).localeCompare(String(a.demissao)));

  return {
    ok: true,
    lista: lista,
    pendentes: lista.filter(x => !x.enviado).length,
    aBaixar: lista.filter(x => x.enviado && !x.baixado).length
  };
}

/** ENVIAR_HOMOLOGACAO_AUTENTIQUE. payload: { matricula } */
function rescEnviarHomologacaoAutentiquePorMatricula(user, p) {
  const matricula = String(p.matricula || '').trim();
  if (!matricula) throw new Error('Matrícula não informada.');

  return _rescEnviarHomologacaoInterna_(matricula, user.EMAIL);
}

/** Faz o envio de verdade — usada tanto pelo envio individual quanto pelo envio em lote. */
function _rescEnviarHomologacaoInterna_(matricula, emailUsuario) {
  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, matricula);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const nome = sh.getRange(row, RESC.COL.NOME).getValue();
  const demissao = sh.getRange(row, RESC.COL.DEMISSAO).getValue();
  const idAutExistente = String(sh.getRange(row, RESC.COL.ID_AUTENTIQUE).getValue() || '').trim();
  if (idAutExistente) throw new Error('Esta homologação já foi enviada ao Autentique.');
  if (!demissao) throw new Error('Sem data de demissão registrada para esta matrícula.');

  const achou = _rescAcharHomologacao_({ NOME: nome, DATA_DEMISSAO: demissao });
  if (achou.status === 'SEM_PASTA_MES') throw new Error('Não encontrei a pasta do mês da demissão na pasta de rescisões.');
  if (achou.status === 'NAO_ACHOU')     throw new Error('Não encontrei a pasta desta pessoa na pasta do mês.');
  if (achou.status === 'AMBIGUO')       throw new Error('Mais de uma pasta bate com esse nome (' + achou.qtd + '). Renomeie para desambiguar.');
  if (achou.status === 'SEM_TRCT')      throw new Error('Não encontrei o TRCT na pasta desta pessoa.');
  if (achou.status === 'ERRO')          throw new Error(achou.motivo);

  const colTipoDemissao = _colunaPorNomeExato_(sh, 2, 'TIPO DE DEMISSÃO');
  const tipoDemissao = sh.getRange(row, colTipoDemissao).getValue();
  if (_rescSeguroObrigatorio_(tipoDemissao) && !achou.seguro) {
    throw new Error('O tipo de demissão desta pessoa ("' + tipoDemissao + '") exige o Seguro Desemprego na pasta, e ele não foi encontrado. Adicione o documento antes de enviar.');
  }

  // [FIX] Antes só buscava o e-mail na MASTER — falhava pra quem já saiu de lá (ex.: removido
  // após o desligamento) mesmo quando a própria CONTROLE.2026 já tinha um e-mail válido gravado
  // (coluna EMAIL, D). Agora tenta a CONTROLE.2026 primeiro, MASTER só como reforço — e só o
  // EMAIL_PESSOAL: nessa etapa a pessoa já foi desligada, o institucional já pode estar
  // desativado e ela não teria mais como acessá-lo pra assinar.
  const emailControle = String(sh.getRange(row, RESC.COL.EMAIL).getValue() || '').trim();
  let email = emailControle.indexOf('@') > -1 ? emailControle : '';
  if (!email) {
    const colab = _colaboradorPorMatricula_(matricula);
    email = colab ? String(colab.EMAIL_PESSOAL || '').trim() : '';
  }
  if (!email || email.indexOf('@') === -1) throw new Error('Colaborador sem e-mail cadastrado (nem na CONTROLE.2026 nem o e-mail pessoal na MASTER), não é possível enviar para assinatura.');

  let blobFinal;
  if (achou.seguro) {
    try {
      blobFinal = _pdfMesclar_(achou.trct.getBlob(), achou.seguro.getBlob());
    } catch (e) {
      throw new Error('Não consegui mesclar TRCT + Seguro Desemprego automaticamente (' + e.message + '). Mescle manualmente antes de enviar.');
    }
  } else {
    blobFinal = achou.trct.getBlob();
  }
  blobFinal = blobFinal.setName('HOMOLOGAÇÃO - ' + nome + '.pdf');

  const signatarios = [
    { email: _rescHomologDpEmail_(), action: 'SIGN' },
    { email: email, action: 'SIGN' }
  ];

  const doc = _autentiqueCriarDocumento_('HOMOLOGAÇÃO - ' + nome, blobFinal, signatarios);

  _controleUpsert_({ MATRICULA: matricula }, { [RESC.COL.ID_AUTENTIQUE]: doc.id });

  _auditar_('RESCISAO_HOMOLOGACAO_ENVIADA', emailUsuario, 'RESCISAO.ENVIAR_HOMOLOGACAO_AUTENTIQUE', true,
    nome + ' (matricula ' + matricula + ') -> doc ' + doc.id, { matricula: matricula });

  return {
    ok: true, docId: doc.id, nome: String(nome),
    mensagem: 'Homologação de ' + String(nome).split(' ')[0] + ' enviada ao Autentique (DP + colaborador).' +
      (achou.seguro ? ' TRCT + Seguro Desemprego mesclados em 1 documento.' : '')
  };
}

/** Monta a lista de matrículas elegíveis pra envio em lote: ainda não enviadas, com TRCT (e
 *  Seguro Desemprego quando o tipo de demissão exige) já na pasta. Usada pelo botão
 *  "Enviar todas". */
function _rescCandidatosHomologacaoParaEnvio_(sh) {
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha < RESC.CONTROLE_LINHA_INICIAL) return [];

  const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
  const dados = sh.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.STATUS_AUTENTIQUE).getValues();
  const colTipoDemissao = _colunaPorNomeExato_(sh, 2, 'TIPO DE DEMISSÃO');

  const candidatos = [];
  dados.forEach(row => {
    const matricula = row[RESC.COL.MATRICULA - 1];
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!matricula || !nome || !demissao) return;

    const idAutentique = String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim();
    if (idAutentique) return; // já enviado

    const achou = _rescAcharHomologacao_({ NOME: nome, DATA_DEMISSAO: demissao });
    if (achou.status !== 'OK') return; // sem TRCT, nem candidato

    const seguroObrigatorio = _rescSeguroObrigatorio_(row[colTipoDemissao - 1]);
    if (seguroObrigatorio && !achou.seguro) return; // documentação incompleta, pula

    candidatos.push(String(matricula));
  });

  return candidatos;
}

/** Envia uma lista de matrículas, respeitando o limite de tempo do lote (RESC_HOMOLOG.
 *  LOTE_LIMITE_MS) — pára antes do Apps Script matar a execução em 6 min e reporta quem ficou
 *  de fora, em vez de deixar a execução morrer no meio sem nunca responder. Compartilhada pelo
 *  envio manual e pelo automático. */
function _rescEnviarLoteHomologacoes_(candidatos, emailAtor) {
  const t0 = Date.now();
  const enviados = [];
  const erros = [];
  let naoProcessados = 0;

  for (let i = 0; i < candidatos.length; i++) {
    if (Date.now() - t0 > RESC_HOMOLOG.LOTE_LIMITE_MS) { naoProcessados = candidatos.length - i; break; }
    const matricula = candidatos[i];
    try {
      const r = _rescEnviarHomologacaoInterna_(matricula, emailAtor);
      enviados.push({ matricula: matricula, nome: r.nome, docId: r.docId });
    } catch (e) {
      erros.push({ matricula: matricula, erro: e.message });
    }
  }

  return { enviados: enviados, erros: erros, naoProcessados: naoProcessados };
}

/** ENVIAR_TODAS_HOMOLOGACOES_AUTENTIQUE — botão "Enviar todas". Envia o quanto couber dentro do
 *  limite de tempo do lote; se sobrar gente, avisa quantos faltaram — clicar de nono continua
 *  de onde parou (mesmo padrão do "Enviar todos" de recibos de férias). */
function rescEnviarTodasHomologacoesAutentique(user) {
  const sh = _shControle_();
  const candidatos = _rescCandidatosHomologacaoParaEnvio_(sh);
  const r = _rescEnviarLoteHomologacoes_(candidatos, user.EMAIL);

  let mensagem = r.enviados.length + ' enviada(s), ' + r.erros.length + ' com erro.';
  if (r.naoProcessados) mensagem += ' Restaram ' + r.naoProcessados + ' — clique em "Enviar todas" de novo para continuar.';

  return { ok: true, total: candidatos.length, enviados: r.enviados, erros: r.erros, naoProcessados: r.naoProcessados, mensagem: mensagem };
}

/** [DESLIGADO 25/09/2026] Não existe mais envio automático de homologações: elas só vão ao
 *  Autentique quando alguém do DP clica em "Enviar" ou "Enviar todas" no portal. Se um gatilho
 *  antigo (diário das 20h ou de continuação) ainda disparar, esta função apaga os gatilhos da
 *  conta dona dele, registra na auditoria e sai SEM enviar nada. */
function _rescExecutarEnvioAutomatico_() {
  _limparGatilhosPorHandler_(RESC_HOMOLOG.GATILHO_DIARIO);
  _limparGatilhosPorHandler_(RESC_HOMOLOG.GATILHO_CONTINUACAO);
  _auditar_('RESCISAO_HOMOLOGACAO_ENVIO_AUTOMATICO', RESC_HOMOLOG.DP_EMAIL_PADRAO,
    'RESCISAO.ENVIAR_TODAS_HOMOLOGACOES_AUTENTIQUE_AUTO', true,
    'Envio automático desligado: gatilho apagado, nada foi enviado.', {});
}

/** Handlers dos gatilhos antigos. Continuam existindo só para um gatilho que ainda dispare
 *  cair na função acima e se apagar, em vez de dar erro de "função não encontrada". */
function rescEnviarTodasHomologacoesAutentiqueAutomatico_() { _rescExecutarEnvioAutomatico_(); }
function rescContinuarEnvioHomologacoesAutomatico_() { _rescExecutarEnvioAutomatico_(); }

function _limparGatilhosPorHandler_(nomeHandler) {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === nomeHandler) ScriptApp.deleteTrigger(t);
  });
}

/** Rode no editor para apagar agora os gatilhos do antigo envio automático. Só enxerga os
 *  gatilhos da conta que está rodando; os de outra conta se apagam sozinhos no próximo disparo. */
function desligarEnvioAutomaticoHomologacoes() {
  _limparGatilhosPorHandler_(RESC_HOMOLOG.GATILHO_DIARIO);
  _limparGatilhosPorHandler_(RESC_HOMOLOG.GATILHO_CONTINUACAO);
  return 'Envio automático de homologações desligado nesta conta.';
}

/** CANCELAR_HOMOLOGACAO_AUTENTIQUE — apaga o documento no Autentique (ninguém mais consegue
 *  assinar) e limpa o ID_AUTENTIQUE, voltando o caso para "Prontos para Envio". Só permite
 *  cancelar enquanto ainda está pendente de assinatura — depois de assinado, apagar destruiria
 *  o documento já executado, então nesse caso é preciso baixar e arquivar em vez de cancelar.
 *  payload: { matricula } */
function rescCancelarHomologacaoAutentiquePorMatricula(user, p) {
  const matricula = String(p.matricula || '').trim();
  if (!matricula) throw new Error('Matrícula não informada.');

  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, matricula);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const nome = sh.getRange(row, RESC.COL.NOME).getValue();
  const idAut = String(sh.getRange(row, RESC.COL.ID_AUTENTIQUE).getValue() || '').trim();
  if (!idAut) throw new Error('Esta homologação ainda não foi enviada ao Autentique.');

  const linkAssinado = String(sh.getRange(row, RESC.COL.LINK_DRIVE_ASSINATURA).getValue() || '').trim();
  if (linkAssinado) throw new Error('Esta homologação já foi baixada e arquivada, não é possível cancelar.');

  // Checagem em tempo real no Autentique (não na coluna da automação externa, que pode estar
  // atrasada) — nunca apagar um documento que já foi assinado por todo mundo.
  const info = _autentiqueDocumentoAssinado_(idAut);
  if (info.assinado) throw new Error('Esta homologação já foi assinada por todo mundo. Baixe e arquive em vez de cancelar, para não perder o documento assinado.');

  _autentiqueApagarDocumento_(idAut);

  _controleUpsert_({ MATRICULA: matricula }, { [RESC.COL.ID_AUTENTIQUE]: '' });

  _auditar_('RESCISAO_HOMOLOGACAO_CANCELADA', user.EMAIL, 'RESCISAO.CANCELAR_HOMOLOGACAO_AUTENTIQUE', true,
    nome + ' (matricula ' + matricula + ') -> doc ' + idAut + ' apagado no Autentique', { matricula: matricula, docId: idAut });

  return { ok: true, mensagem: 'Envio de ' + String(nome).split(' ')[0] + ' cancelado. O documento foi apagado no Autentique e não pode mais ser assinado.' };
}

/** BAIXAR_ARQUIVAR_HOMOLOGACAO. payload: { matricula } — salva na pasta de assinados (RESC_HOMOLOG). */
function rescBaixarArquivarHomologacaoPorMatricula(user, p) {
  const matricula = String(p.matricula || '').trim();
  if (!matricula) throw new Error('Matrícula não informada.');

  return _rescBaixarArquivarHomologacaoInterna_(matricula, user.EMAIL);
}

/** Faz o download+arquivamento de verdade — usada tanto pelo individual quanto pelo em lote. */
function _rescBaixarArquivarHomologacaoInterna_(matricula, emailUsuario, opcoes) {
  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, matricula);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const nome = sh.getRange(row, RESC.COL.NOME).getValue();
  const idAut = String(sh.getRange(row, RESC.COL.ID_AUTENTIQUE).getValue() || '').trim();
  if (!idAut) throw new Error('Esta homologação ainda não foi enviada ao Autentique.');

  const info = _autentiqueDocumentoAssinado_(idAut);
  if (!info.assinado) throw new Error('Ainda faltam assinaturas (' + info.totalAssinados + ' de ' + info.totalAssinantes + '). Aguarde todo mundo assinar.');

  // [FIX 2026-09-28] download com token + conferência de PDF (antes salvava qualquer resposta,
  // inclusive página de erro em HTML, e marcava a homologação como arquivada).
  const blob = _autentiqueBaixarPdfAssinado_(info.urlAssinado, 'HOMOLOGAÇÃO - ' + nome + '.pdf',
    opcoes && opcoes.esperasMs);

  const pasta = DriveApp.getFolderById(RESC_HOMOLOG.PASTA_ASSINADOS_ID);
  const arquivo = pasta.createFile(blob);
  _compartilharSoDominio_(arquivo);
  const linkArquivado = arquivo.getUrl();

  _controleUpsert_({ MATRICULA: matricula }, { [RESC.COL.LINK_DRIVE_ASSINATURA]: linkArquivado });

  _auditar_('RESCISAO_HOMOLOGACAO_ARQUIVADA', emailUsuario, 'RESCISAO.BAIXAR_ARQUIVAR_HOMOLOGACAO', true,
    nome + ' (matricula ' + matricula + ')', { matricula: matricula });

  return { ok: true, nome: String(nome), link: linkArquivado, mensagem: 'Homologação assinada de ' + String(nome).split(' ')[0] + ' baixada e arquivada.' };
}

/** BAIXAR_TODAS_HOMOLOGACOES_AUTENTIQUE — baixa e arquiva de uma vez só todo mundo de
 *  "Homologações Enviadas" que já está assinado por todo mundo no Autentique. Quem ainda não
 *  assinou é pulado (não trava o lote inteiro). */
function rescBaixarTodasHomologacoesAutentique(user) {
  const t0 = Date.now();
  const sh = _shControle_();
  const ultimaLinha = sh.getLastRow();
  if (ultimaLinha < RESC.CONTROLE_LINHA_INICIAL) return { ok: true, total: 0, baixados: [], erros: [] };

  const nLinhas = ultimaLinha - RESC.CONTROLE_LINHA_INICIAL + 1;
  const dados = sh.getRange(RESC.CONTROLE_LINHA_INICIAL, 1, nLinhas, RESC.COL.STATUS_AUTENTIQUE).getValues();

  const candidatos = [];
  dados.forEach(row => {
    const matricula = row[RESC.COL.MATRICULA - 1];
    const nome = row[RESC.COL.NOME - 1];
    const demissao = row[RESC.COL.DEMISSAO - 1];
    if (!matricula || !nome || !demissao) return;

    const idAutentique = String(row[RESC.COL.ID_AUTENTIQUE - 1] || '').trim();
    const linkAssinado = String(row[RESC.COL.LINK_DRIVE_ASSINATURA - 1] || '').trim();
    if (idAutentique && !linkAssinado) candidatos.push({ matricula: String(matricula), idAutentique: idAutentique });
  });

  if (!candidatos.length) return { ok: true, total: 0, baixados: [], erros: [] };

  // Confere em paralelo quem já está assinado por todo mundo antes de tentar baixar — evita
  // tentar (e falhar) um por um sequencialmente só pra descobrir que ainda está pendente.
  // [FIX 2026-09-28] Em rodadas curtas (ver RESC_HOMOLOG.RODADA_*): a consulta para no prazo e
  // os downloads param antes de a chamada chegar perto dos 60 s do Portal. O que sobrar volta
  // em "restantes" e o Portal chama de novo; o que já foi arquivado sai da lista de candidatos.
  const verificados = _autentiqueVerificarLote_(sh, candidatos, t0 + RESC_HOMOLOG.RODADA_VERIFICAR_MS);
  const naoVerificados = candidatos.length - verificados.length;
  const prontosParaBaixar = verificados.filter(v => v.ok && v.assinado).map(v => v.matricula);

  const baixados = [];
  const erros = [];
  let restamBaixar = 0;
  for (let i = 0; i < prontosParaBaixar.length; i++) {
    if (Date.now() - t0 > RESC_HOMOLOG.RODADA_TOTAL_MS) { restamBaixar = prontosParaBaixar.length - i; break; }
    const matricula = prontosParaBaixar[i];
    // [FIX 2026-09-28] pausa entre downloads: o Autentique devolve 425 em sequência rápida.
    if (i > 0) Utilities.sleep(700);
    try {
      const r = _rescBaixarArquivarHomologacaoInterna_(matricula, user.EMAIL, { esperasMs: RESC_HOMOLOG.RODADA_ESPERAS_MS });
      baixados.push({ matricula: matricula, nome: r.nome, link: r.link });
    } catch (e) {
      // Autentique pedindo calma (425/429): não é erro do documento, fica para a próxima rodada.
      if (e && e.limiteAutentique) { restamBaixar = prontosParaBaixar.length - i; break; }
      erros.push({ matricula: matricula, erro: e.message });
    }
  }

  return { ok: true, total: prontosParaBaixar.length, baixados: baixados, erros: erros,
    restantes: naoVerificados + restamBaixar, naoVerificados: naoVerificados, restamBaixar: restamBaixar,
    consultadosAgora: verificados.consultadosAgora || 0 };
}
