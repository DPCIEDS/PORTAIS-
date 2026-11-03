/*************************************************************************************************
 * FÉRIAS · ENVIO AO FINANCEIRO POR DEPARTAMENTO · [2026-10-29] pedido da Taynara
 * -----------------------------------------------------------------------------------------------
 * Na aba Agendadas do Portal DP, com o mês de início escolhido, cada departamento tem:
 *  - em cada pessoa: o número WEB (ex.: WEB:1011/2026), o valor líquido das férias e banco/agência/conta;
 *  - o arquivo bancário (anexo) e UM botão "Enviar ao financeiro".
 * O envio manda um e-mail ao financeiro (parâmetro EMAIL_FINANCEIRO) com os dados de todos e, em anexo,
 * o arquivo bancário e o recibo de cada pessoa (pasta FÉRIAS do Drive, achado pelo nome e pela data de
 * início), e preenche a planilha "Controle Web" (abas "Férias" e "Controle Web"). Se faltar recibo, WEB,
 * valor ou banco de alguém, o envio do departamento fica bloqueado e a tela mostra o quê.
 * Banco, agência, conta e identidade ficam no cadastro (MASTER). Vêm do BI Férias do Alterdata (importado
 * pela própria aba), do Raio-X, ou digitados na linha da pessoa.
 *
 * Data de pagamento: férias que começam na segunda ou terça são pagas na quinta da semana anterior; na
 * quarta, na segunda da mesma semana. Quinta, sexta e fim de semana não podem ser início de férias. Se o dia
 * cair em feriado, antecipa para o dia útil anterior.
 *
 * [2026-11-03] Arquivo bancário (remessa CNAB 240 do banco, ex.: FELOTVI.TXT do Santander, um por
 * departamento): ao ser anexado, o Portal manda o arquivo para FERIAS.FINANCEIRO_LER_ARQUIVO, que acha cada
 * pessoa pelo CPF e preenche valor, banco, agência e conta. No envio, quem não está no arquivo, ou está com
 * valor ou conta diferente dele, bloqueia o departamento. O e-mail mostra o resumo do arquivo.
 *************************************************************************************************/

const FERFIN = {
  PASTA_RECIBOS_PADRAO: '1_OMgm_P2XPszuWiwaumgJSqx4EeIMLEB',               // pasta "FÉRIAS" (autodppessoal)
  PLANILHA_CONTROLE_PADRAO: '10iPBOIbS6stmIISD2kuo6u_l3zGVpDeLvgTJRLb5nuk', // "Controle Web" (da Mariana)
  ABA_FERIAS: 'Férias',
  ABA_WEB: 'Controle Web',
  COLUNAS_MASTER: ['IDENTIDADE', 'BANCO', 'AGENCIA', 'CONTA'],
  CACHE_RECIBOS: 'FERFIN_RECIBOS_V1'
};

/* ============================================================================================ */
/*  UTILIDADES                                                                                   */
/* ============================================================================================ */

function _ferfinNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** "1011/2026", "web 1011/2026" ou "WEB: 1011/2026" → "WEB:1011/2026". '' se vazio; erro se não der para ler. */
function _ferfinWeb_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  const m = s.match(/^(?:WEB:?)?(\d+)\/(\d{4})$/);
  if (!m) throw new Error('Número WEB inválido: "' + v + '". Use o formato WEB:1011/2026.');
  return 'WEB:' + Number(m[1]) + '/' + m[2];
}

/** Valor em reais: número, ou texto como "R$ 1.234,56" / "1234.56". null se vazio ou ilegível. */
function _ferfinValor_(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v == null ? '' : v).replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function _ferfinMoeda_(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Data de pagamento das férias que começam em `inicio`. { data, erro }. */
function _ferfinDataPagamento_(inicio) {
  const ini = _dataF_(inicio);
  if (!ini) return { data: null, erro: 'sem data de início' };
  const recuo = { 1: 4, 2: 5, 3: 2 }[ini.getDay()]; // seg → quinta anterior; ter → quinta anterior; qua → segunda
  if (!recuo) {
    const dia = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][ini.getDay()];
    return { data: null, erro: 'férias começando na ' + dia + ' (só podem começar de segunda a quarta): confira a data' };
  }
  const feriados = _feriadosMapF_();
  let d = _addDiasF_(ini, -recuo);
  while (feriados[_isoF_(d)] || d.getDay() === 0 || d.getDay() === 6) d = _addDiasF_(d, -1);
  return { data: d, erro: '' };
}

/* ---- recibos na pasta FÉRIAS: "RECIBO DE FERIAS - NOME - dd-mm-aaaa - dd-mm-aaaa.pdf" ---- */

function _ferfinChaveRecibo_(nome, inicio) {
  const d = _dataF_(inicio);
  return _ferfinNorm_(nome) + '|' + (d ? Utilities.formatDate(d, DP360.FUSO, 'dd-MM-yyyy') : '');
}

/** Índice dos recibos da pasta (chave nome|início → { id, nome, url }). Fica 5 min no cache. */
function _ferfinIndiceRecibos_(forcar) {
  const cache = CacheService.getScriptCache();
  if (!forcar) {
    const c = cache.get(FERFIN.CACHE_RECIBOS);
    if (c) { try { return JSON.parse(c); } catch (e) { /* refaz */ } }
  }
  const idx = {};
  const pasta = _feriasParam_('FERIAS_RECIBOS_PASTA_ID', FERFIN.PASTA_RECIBOS_PADRAO);
  const guarda = (id, nome) => {
    const m = _ferfinNorm_(nome).match(/^RECIBO DE FERIAS - (.+?) - (\d{2}-\d{2}-\d{4}) - \d{2}-\d{2}-\d{4}/);
    if (m) idx[m[1] + '|' + m[2]] = { id: id, nome: nome, url: 'https://drive.google.com/file/d/' + id + '/view' };
  };
  try {
    // uma chamada ao Drive para a pasta inteira (o DriveApp faz uma por arquivo e levava ~10 s)
    let pagina = '';
    do {
      const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("'" + pasta + "' in parents and trashed=false") +
        '&fields=nextPageToken,files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' + (pagina ? '&pageToken=' + pagina : ''),
        { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) throw new Error('Drive ' + r.getResponseCode());
      const j = JSON.parse(r.getContentText());
      (j.files || []).forEach(f => guarda(f.id, f.name));
      pagina = j.nextPageToken || '';
    } while (pagina);
  } catch (e) {
    console.error('_ferfinIndiceRecibos_: lista rápida falhou (' + e + '), indo pelo DriveApp');
    const it = DriveApp.getFolderById(pasta).getFiles();
    while (it.hasNext()) { const f = it.next(); guarda(f.getId(), f.getName()); }
  }
  try { cache.put(FERFIN.CACHE_RECIBOS, JSON.stringify(idx), 300); } catch (e) { /* índice grande demais para o cache: segue sem */ }
  return idx;
}

/* ---- arquivo bancário: remessa CNAB 240 (padrão FEBRABAN: Santander, Itaú, Bradesco, BB, Caixa...) ----
 * Segmento A: banco, agência e conta do favorecido, nome (cortado em 30 letras), data e valor do pagamento.
 * Segmento B, logo depois do A: CPF do favorecido. */

const FERFIN_BANCOS = {
  '001': 'Banco do Brasil', '033': 'Banco Santander', '041': 'Banrisul', '070': 'BRB', '077': 'Banco Inter',
  '104': 'Caixa Econômica Federal', '208': 'BTG Pactual', '212': 'Banco Original', '237': 'Bradesco', '260': 'Nubank',
  '290': 'PagBank', '323': 'Mercado Pago', '336': 'C6 Bank', '341': 'Itaú', '380': 'PicPay', '422': 'Banco Safra',
  '655': 'Banco Votorantim', '748': 'Sicredi', '756': 'Sicoob'
};

/** Texto de um arquivo anexado ({ base64 }); '' se não der para ler. */
function _ferfinTextoArquivo_(a) {
  try { return Utilities.newBlob(Utilities.base64Decode(a.base64)).getDataAsString('ISO-8859-1'); }
  catch (e) { return ''; }
}

/**
 * Lê uma remessa CNAB 240. null se o texto não for uma (PDF, planilha...); senão
 * { pagamentos: [{ nome, cpf, bancoCodigo, banco, agencia, conta, valor, data }], total, datas: ['aaaa-mm-dd'] }.
 */
function _ferfinLerCnab_(texto) {
  const pags = [];
  let atual = null;
  String(texto || '').split(/\r?\n/).forEach(l => {
    if (!/^\d{3}\d{4}3\d{5}[A-Z]/.test(l)) return;           // só os detalhes (registro 3)
    const seg = l.charAt(13);
    if (seg === 'A' && l.length >= 134) {
      const cod = l.slice(20, 23);
      const ag = l.slice(23, 28).replace(/\D/g, '').replace(/^0+/, '').padStart(4, '0');
      const dvAg = l.charAt(28).trim();
      const conta = l.slice(29, 41).replace(/\D/g, '').replace(/^0+/, '');
      const dv = l.charAt(41).trim() || l.charAt(42).trim();   // o Itaú põe o dígito da conta na posição 43
      const d = l.slice(93, 101);                              // DDMMAAAA
      atual = {
        nome: l.slice(43, 73).trim(), cpf: '', bancoCodigo: cod, banco: cod + (FERFIN_BANCOS[cod] ? ' ' + FERFIN_BANCOS[cod] : ''),
        agencia: ag + (dvAg ? '-' + dvAg : ''), conta: conta + (dv ? '-' + dv : ''),
        valor: Math.round(Number(l.slice(119, 134)) || 0) / 100,
        data: /^\d{8}$/.test(d) && Number(d) ? new Date(Number(d.slice(4)), Number(d.slice(2, 4)) - 1, Number(d.slice(0, 2)), 12, 0, 0) : null
      };
      pags.push(atual);
    } else if (seg === 'B' && atual && !atual.cpf && l.charAt(17) === '1') {
      const cpf = l.slice(18, 32).replace(/\D/g, '').replace(/^0+/, '');
      if (cpf) atual.cpf = cpf.padStart(11, '0');
    }
  });
  if (!pags.length) return null;
  const datas = {};
  pags.forEach(x => { if (x.data) datas[_isoF_(x.data)] = 1; });
  return { pagamentos: pags, total: Math.round(pags.reduce((t, x) => t + x.valor, 0) * 100) / 100, datas: Object.keys(datas).sort() };
}

/** Lê os anexos e devolve só as remessas CNAB, cada uma com o nome do arquivo. */
function _ferfinLeiturasCnab_(arquivos) {
  const leituras = [];
  arquivos.forEach((a, i) => {
    const l = _ferfinLerCnab_(_ferfinTextoArquivo_(a));
    if (l) leituras.push(Object.assign({ nome: String(a.nome || ('arquivo_bancario_' + (i + 1))) }, l));
  });
  return leituras;
}

/* Para comparar dados bancários escritos de jeitos diferentes ("0741-2 Banco do Brasil" e "0741-2"). */
function _ferfinBancoCod_(v) { const m = String(v == null ? '' : v).match(/\d+/); return m ? m[0].replace(/^0+/, '').padStart(3, '0') : ''; }
function _ferfinAgBase_(v) { const m = String(v == null ? '' : v).match(/\d+/); return m ? m[0].replace(/^0+/, '') : ''; }
function _ferfinContaDig_(v) { return String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, ''); }

/**
 * Casa cada férias do grupo com um pagamento das remessas: pelo CPF e, se faltar o CPF de um dos lados, pelo
 * nome (a remessa corta o nome em 30 letras). { porId: { ID_SOLICITACAO: pagamento }, semArquivo: [s], sobra: [pagamento] }
 */
function _ferfinCasarArquivo_(grupo, leituras) {
  const pags = [];
  leituras.forEach(l => l.pagamentos.forEach(x => pags.push(Object.assign({ arquivo: l.nome }, x))));
  const usado = {}, porId = {};
  const cpfN = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  grupo.forEach(s => {
    const cpf = cpfN((_colaboradorPorId_(s.ID_COLABORADOR) || {}).CPF);
    let i = cpf ? pags.findIndex((x, k) => !usado[k] && x.cpf && cpfN(x.cpf) === cpf) : -1;
    if (i < 0) {
      const nome = _ferfinNorm_(s.NOME);
      i = pags.findIndex((x, k) => !usado[k] && (!cpf || !x.cpf) && _ferfinNorm_(x.nome).length >= 10 && nome.indexOf(_ferfinNorm_(x.nome)) === 0);
    }
    if (i > -1) { usado[i] = 1; porId[String(s.ID_SOLICITACAO)] = pags[i]; }
  });
  return { porId: porId, semArquivo: grupo.filter(s => !porId[String(s.ID_SOLICITACAO)]), sobra: pags.filter((x, k) => !usado[k]) };
}

/** Férias deferidas e ainda não enviadas do departamento, com início no mês ('aaaa-mm'). */
function _ferfinGrupo_(sh, depto, mes) {
  const alvo = _ferfinNorm_(depto);
  return _sheetToObjects_(sh).filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA' && !_dataF_(s.ENVIADO_FINANCEIRO_EM) &&
    _isoF_(s.DATA_INICIO).slice(0, 7) === mes && _ferfinNorm_((_colaboradorPorId_(s.ID_COLABORADOR) || {}).DEPARTAMENTO_ATUAL) === alvo);
}

/* ---- colunas novas ---- */

/** SOLICITACOES ganha WEB_FINANCEIRO, VALOR_LIQUIDO e LOTE_FINANCEIRO; o MASTER, IDENTIDADE/BANCO/AGENCIA/CONTA (texto). */
function _ferfinGarantirColunas_() {
  const shSol = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  if (FERIAS.COLUNAS_FINANCEIRO.some(c => _headers_(shSol).indexOf(c) === -1)) garantirColunasFinanceiro();
  const shM = _masterSS_().getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const h = _headers_(shM);
  const faltam = FERFIN.COLUNAS_MASTER.filter(c => h.indexOf(c) === -1);
  if (faltam.length) {
    if (shM.getMaxColumns() < h.length + faltam.length) shM.insertColumnsAfter(shM.getMaxColumns(), h.length + faltam.length - shM.getMaxColumns());
    shM.getRange(1, h.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
    shM.getRange(2, h.length + 1, shM.getMaxRows() - 1, faltam.length).setNumberFormat('@'); // "0087" e "0741-2" ficam como texto
    _invalidarCacheFerias_();
  }
}

/** Grava campos no cadastro (MASTER) do colaborador. patch: { BANCO: '...', ... } (só os informados). */
function _ferfinGravarMaster_(idColaborador, patch) {
  const sh = _masterSS_().getSheetByName(DP360.MASTER_SHEETS.COLABORADORES);
  const h = _headers_(sh);
  const ids = sh.getRange(2, h.indexOf('ID_COLABORADOR') + 1, sh.getLastRow() - 1, 1).getValues();
  const i = ids.findIndex(r => String(r[0]) === String(idColaborador));
  if (i < 0) throw new Error('Colaborador não encontrado no cadastro: ' + idColaborador);
  Object.keys(patch).forEach(c => {
    const col = h.indexOf(c);
    if (col > -1) sh.getRange(i + 2, col + 1).setNumberFormat('@').setValue(String(patch[c] == null ? '' : patch[c]).trim());
  });
}

/* ============================================================================================ */
/*  AGENDADAS: dados do financeiro em cada item                                                  */
/* ============================================================================================ */

/** Campos extras de cada item da aba Agendadas (chamado por feriasAgendadas). */
function _ferfinDadosItem_(s, idxRecibos) {
  const c = _colaboradorPorId_(s.ID_COLABORADOR) || {};
  const pag = _ferfinDataPagamento_(s.DATA_INICIO);
  const rec = idxRecibos[_ferfinChaveRecibo_(s.NOME, s.DATA_INICIO)] || null;
  const valor = _ferfinValor_(s.VALOR_LIQUIDO);
  return {
    matricula: String(c.MATRICULA || ''),
    cpf: String(c.CPF || ''),
    identidade: String(c.IDENTIDADE || ''),
    banco: String(c.BANCO || ''),
    agencia: String(c.AGENCIA || ''),
    conta: String(c.CONTA || ''),
    web: String(s.WEB_FINANCEIRO || ''),
    valorLiquido: valor,
    lote: String(s.LOTE_FINANCEIRO || ''),
    dataPagamento: pag.data ? _isoF_(pag.data) : '',
    dataPagamentoErro: pag.erro,
    recibo: rec ? { id: rec.id, nome: rec.nome, url: rec.url } : null
  };
}

/* ============================================================================================ */
/*  FERIAS.FINANCEIRO_SALVAR · WEB, valor e banco digitados na linha da pessoa                  */
/* ============================================================================================ */

/** payload: { id, web?, valor?, banco?, agencia?, conta? } (só os campos enviados são gravados) */
function feriasFinanceiroSalvar(user, p) {
  _ferfinSoDP_(user);
  _ferfinGarantirColunas_();
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const s = _sheetToObjects_(sh).find(x => String(x.ID_SOLICITACAO) === String(p.id));
  if (!s) throw new Error('Férias não encontradas.');
  if (_dataF_(s.ENVIADO_FINANCEIRO_EM)) throw new Error('Estas férias já foram enviadas ao financeiro.');

  const patch = {};
  if (p.web !== undefined) patch.WEB_FINANCEIRO = _ferfinWeb_(p.web);
  if (p.valor !== undefined) {
    const vazio = String(p.valor == null ? '' : p.valor).trim() === '';
    const v = _ferfinValor_(p.valor);
    if (!vazio && (v === null || v <= 0)) throw new Error('Valor inválido: "' + p.valor + '".');
    patch.VALOR_LIQUIDO = vazio ? '' : v;
  }
  if (Object.keys(patch).length) _atualizarLinha_(sh, s._rowNumber, h, patch);

  const banco = {};
  [['banco', 'BANCO'], ['agencia', 'AGENCIA'], ['conta', 'CONTA']].forEach(x => { if (p[x[0]] !== undefined) banco[x[1]] = p[x[0]]; });
  if (Object.keys(banco).length) _ferfinGravarMaster_(s.ID_COLABORADOR, banco);

  _invalidarCacheFerias_();
  return { ok: true, web: patch.WEB_FINANCEIRO !== undefined ? patch.WEB_FINANCEIRO : undefined,
    valor: patch.VALOR_LIQUIDO !== undefined ? patch.VALOR_LIQUIDO : undefined };
}

function _ferfinSoDP_(user) {
  const perfil = String(user.PERFIL).toUpperCase();
  if (perfil !== 'DP' && perfil !== 'ADMIN') throw new Error('Apenas o Departamento Pessoal pode enviar ao financeiro.');
}

/* ============================================================================================ */
/*  FERIAS.FINANCEIRO_IMPORTAR_BI · relatório "BI Férias" do Alterdata                           */
/* ============================================================================================ */

/**
 * Lê o BI Férias do Alterdata (Funcionário, Identidade, Início Férias, Banco, Agência, Conta, Remuneração
 * Líquida...) e preenche, para cada férias deferida ainda não enviada (mesma matrícula e mesmo início):
 * o valor líquido (na solicitação) e identidade/banco/agência/conta (no cadastro).
 * payload: { sheetId } (o Portal converte o .xls/.xlsx num arquivo temporário)
 */
function feriasFinanceiroImportarBI(user, p) {
  _ferfinSoDP_(user);
  if (!p.sheetId) throw new Error('Escolha o arquivo do BI Férias.');
  const dados = SpreadsheetApp.openById(p.sheetId).getSheets()[0].getDataRange().getValues();
  const cab = dados[0].map(x => _ferfinNorm_(x));
  const col = (nomes) => { for (let i = 0; i < nomes.length; i++) { const j = cab.indexOf(nomes[i]); if (j > -1) return j; } return -1; };
  const c = {
    mat: col(['FUNCIONARIO', 'MATRICULA']), nome: col(['NOME DO FUNCIONARIO', 'NOME']), ini: col(['INICIO FERIAS', 'INICIO DAS FERIAS']),
    ident: col(['IDENTIDADE']), banco: col(['BANCO']), ag: col(['AGENCIA']), conta: col(['CONTA']), valor: col(['REMUNERACAO LIQUIDA', 'VALOR LIQUIDO'])
  };
  ['mat', 'ini', 'valor'].forEach(k => { if (c[k] < 0) throw new Error('O arquivo não parece ser o BI Férias: falta a coluna ' + { mat: 'Funcionário', ini: 'Início Férias', valor: 'Remuneração Líquida' }[k] + '.'); });

  _ferfinGarantirColunas_();
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const matN = (v) => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  const idPorMat = {};
  _colaboradores_().forEach(x => { const m = matN(x.MATRICULA); if (m) idPorMat[m] = String(x.ID_COLABORADOR); });
  const sols = _sheetToObjects_(sh).filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA');

  const res = { ok: true, linhas: 0, atualizadas: [], jaEnviadas: [], naoEncontradas: [], valorIlegivel: [] };
  for (let r = 1; r < dados.length; r++) {
    const linha = dados[r];
    const m = matN(linha[c.mat]);
    if (!m) continue;
    res.linhas++;
    const nome = c.nome > -1 ? String(linha[c.nome]).trim() : m;
    const ini = _dataF_(linha[c.ini]);
    const id = idPorMat[m];
    const s = id && ini ? sols.find(x => String(x.ID_COLABORADOR) === id && _isoF_(x.DATA_INICIO) === _isoF_(ini)) : null;
    if (!s) { res.naoEncontradas.push(nome + (ini ? ' (' + _fmtBRF_(ini) + ')' : '')); continue; }
    if (_dataF_(s.ENVIADO_FINANCEIRO_EM)) { res.jaEnviadas.push(nome); continue; }
    const v = _ferfinValor_(linha[c.valor]);
    if (v === null || v <= 0) { res.valorIlegivel.push(nome + ': "' + linha[c.valor] + '"'); continue; }
    _atualizarLinha_(sh, s._rowNumber, h, { VALOR_LIQUIDO: v });
    const cad = {};
    if (c.ident > -1 && String(linha[c.ident]).trim()) cad.IDENTIDADE = linha[c.ident];
    if (c.banco > -1 && String(linha[c.banco]).trim()) cad.BANCO = linha[c.banco];
    if (c.ag > -1 && String(linha[c.ag]).trim()) cad.AGENCIA = linha[c.ag];
    if (c.conta > -1 && String(linha[c.conta]).trim()) cad.CONTA = linha[c.conta];
    if (Object.keys(cad).length) _ferfinGravarMaster_(s.ID_COLABORADOR, cad);
    res.atualizadas.push(nome);
  }
  _invalidarCacheFerias_();
  _auditar_('FERIAS_BI_IMPORTADO', user.EMAIL, 'FERIAS.FINANCEIRO_IMPORTAR_BI', true,
    res.atualizadas.length + ' férias preenchidas pelo BI Férias', { linhas: res.linhas, naoEncontradas: res.naoEncontradas.length });
  res.mensagem = res.atualizadas.length + ' férias preenchidas com valor e banco do BI.' +
    (res.jaEnviadas.length ? ' ' + res.jaEnviadas.length + ' já tinham sido enviadas (não mudei).' : '') +
    (res.naoEncontradas.length ? ' ' + res.naoEncontradas.length + ' do BI sem férias deferidas com o mesmo início no DP360.' : '') +
    (res.valorIlegivel.length ? ' ' + res.valorIlegivel.length + ' com valor ilegível.' : '');
  return res;
}

/* ============================================================================================ */
/*  FERIAS.FINANCEIRO_LER_ARQUIVO · o arquivo bancário preenche valor, banco, agência e conta    */
/* ============================================================================================ */

/**
 * [2026-11-03] Chamado quando o DP anexa o arquivo bancário de um departamento. Cada pagamento da remessa é
 * casado com as férias do departamento no mês (pelo CPF) e preenche o valor líquido (na solicitação) e banco,
 * agência e conta (no cadastro). O que já estava igual não é regravado; o que estava diferente passa a valer o
 * do arquivo e volta listado. Arquivo que não é remessa CNAB (PDF, planilha) só fica anexado.
 * payload: { departamento, mes ('aaaa-mm'), arquivos: [{ base64, nome }] }
 */
function feriasFinanceiroLerArquivo(user, p) {
  _ferfinSoDP_(user);
  const depto = String(p.departamento || '').trim();
  const mes = String(p.mes || '').trim();
  if (!depto) throw new Error('Informe o departamento.');
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Escolha o mês de início das férias.');
  const arquivos = (Array.isArray(p.arquivos) ? p.arquivos : []).filter(a => a && a.base64);
  if (!arquivos.length) throw new Error('Anexe o arquivo bancário do departamento.');

  const leituras = _ferfinLeiturasCnab_(arquivos);
  if (!leituras.length) {
    return { ok: true, cnab: false,
      mensagem: 'Arquivo anexado. Ele não é uma remessa do banco (CNAB 240), então valor, banco, agência e conta continuam sendo digitados.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    _invalidarCacheFerias_();
    _ferfinGarantirColunas_();
    const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
    const h = _headers_(sh);
    const grupo = _ferfinGrupo_(sh, depto, mes);
    const casa = _ferfinCasarArquivo_(grupo, leituras);
    const rotulo = { BANCO: 'banco', AGENCIA: 'agência', CONTA: 'conta' };
    const alteracoes = [], datasDiferentes = [], porId = {};
    grupo.forEach(s => {
      const pg = casa.porId[String(s.ID_SOLICITACAO)];
      if (!pg) return;
      const c = _colaboradorPorId_(s.ID_COLABORADOR) || {};
      const mud = [];
      const valorAntes = _ferfinValor_(s.VALOR_LIQUIDO);
      if (valorAntes === null || Math.abs(valorAntes - pg.valor) > 0.004) {
        _atualizarLinha_(sh, s._rowNumber, h, { VALOR_LIQUIDO: pg.valor });
        if (valorAntes > 0) mud.push('valor de ' + _ferfinMoeda_(valorAntes) + ' para ' + _ferfinMoeda_(pg.valor));
      }
      const cad = {};
      if (_ferfinBancoCod_(c.BANCO) !== _ferfinBancoCod_(pg.banco)) cad.BANCO = pg.banco;
      if (_ferfinAgBase_(c.AGENCIA) !== _ferfinAgBase_(pg.agencia)) cad.AGENCIA = pg.agencia;
      if (_ferfinContaDig_(c.CONTA) !== _ferfinContaDig_(pg.conta)) cad.CONTA = pg.conta;
      Object.keys(cad).forEach(k => { if (String(c[k] || '').trim()) mud.push(rotulo[k] + ' de ' + String(c[k]).trim() + ' para ' + cad[k]); });
      if (Object.keys(cad).length) _ferfinGravarMaster_(s.ID_COLABORADOR, cad);
      if (mud.length) alteracoes.push(s.NOME + ': ' + mud.join(', '));
      const regra = _ferfinDataPagamento_(s.DATA_INICIO).data;
      if (regra && pg.data && _isoF_(regra) !== _isoF_(pg.data)) {
        datasDiferentes.push(s.NOME + ': ' + _fmtBRF_(pg.data) + ' no arquivo e ' + _fmtBRF_(regra) + ' pela regra');
      }
      porId[String(s.ID_SOLICITACAO)] = { valor: pg.valor };
    });
    _invalidarCacheFerias_();

    const n = Object.keys(porId).length;
    _auditar_('FERIAS_ARQUIVO_BANCARIO_LIDO', user.EMAIL, 'FERIAS.FINANCEIRO_LER_ARQUIVO', true,
      depto + ' · ' + mes + ': ' + n + ' de ' + grupo.length + ' férias preenchidas pelo arquivo bancário',
      { arquivos: leituras.map(l => l.nome), alteracoes: alteracoes.length, foraDoArquivo: casa.semArquivo.length, sobra: casa.sobra.length });
    return {
      ok: true, cnab: true, porId: porId, preenchidas: n, total: grupo.length,
      arquivos: leituras.map(l => l.nome + ': ' + l.pagamentos.length + (l.pagamentos.length === 1 ? ' pagamento, ' : ' pagamentos, ') +
        _ferfinMoeda_(l.total) + (l.datas.length ? ', pagamento em ' + l.datas.map(_fmtBRF_).join(' e ') : '')),
      alteracoes: alteracoes, datasDiferentes: datasDiferentes,
      semArquivo: casa.semArquivo.map(s => s.NOME),
      sobra: casa.sobra.map(x => x.nome + ' (' + _ferfinMoeda_(x.valor) + ')'),
      mensagem: 'Arquivo bancário lido: valor, banco, agência e conta de ' + n + ' de ' + grupo.length +
        (grupo.length === 1 ? ' pessoa' : ' pessoas') + ' preenchidos.'
    };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================================ */
/*  FERIAS.FINANCEIRO_ENVIAR_DEPTO · um envio por departamento e mês de início                   */
/* ============================================================================================ */

/**
 * payload: { departamento, mes ('aaaa-mm', mês de início), ids: [ID_SOLICITACAO...] (o que a tela mostrou),
 *   arquivos: [{ base64, nome, tipo }] (arquivo bancário; pelo menos um) }
 */
function feriasFinanceiroEnviarDepto(user, p) {
  _ferfinSoDP_(user);
  const depto = String(p.departamento || '').trim();
  const mes = String(p.mes || '').trim();
  if (!depto) throw new Error('Informe o departamento.');
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Escolha o mês de início das férias.');
  const arquivos = (Array.isArray(p.arquivos) ? p.arquivos : []).filter(a => a && a.base64);
  if (!arquivos.length) throw new Error('Anexe o arquivo bancário do departamento.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    _invalidarCacheFerias_();
    _ferfinGarantirColunas_();
    const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
    const h = _headers_(sh);
    const grupo = _ferfinGrupo_(sh, depto, mes);
    if (!grupo.length) throw new Error('Nenhuma férias pendente de ' + depto + ' em ' + mes.slice(5) + '/' + mes.slice(0, 4) + '.');
    const idsTela = (Array.isArray(p.ids) ? p.ids : []).map(String).sort().join('|');
    if (grupo.map(s => String(s.ID_SOLICITACAO)).sort().join('|') !== idsTela) {
      throw new Error('A lista de ' + depto + ' mudou desde que a tela foi aberta. Atualize a tela e confira antes de enviar.');
    }

    // confere tudo antes de enviar: se faltar algo de alguém, nada é enviado
    const idx = _ferfinIndiceRecibos_(true);
    // [2026-11-03] remessa do banco (CNAB 240) anexada: cada pessoa tem que estar nela, com o mesmo valor e conta
    const leituras = _ferfinLeiturasCnab_(arquivos);
    const casa = leituras.length ? _ferfinCasarArquivo_(grupo, leituras) : null;
    const itens = [], problemas = [];
    grupo.forEach(s => {
      const d = _ferfinDadosItem_(s, idx);
      const falta = [];
      let web = '';
      try { web = _ferfinWeb_(s.WEB_FINANCEIRO); } catch (e) { falta.push('WEB inválido'); }
      if (!web && falta.indexOf('WEB inválido') < 0) falta.push('número WEB');
      if (!(d.valorLiquido > 0)) falta.push('valor das férias');
      if (!d.banco.trim() || !d.agencia.trim() || !d.conta.trim()) falta.push('banco/agência/conta');
      if (!d.recibo) falta.push('recibo na pasta FÉRIAS');
      if (!d.dataPagamento) falta.push(d.dataPagamentoErro || 'data de pagamento');
      if (casa) {
        const pg = casa.porId[String(s.ID_SOLICITACAO)];
        if (!pg) falta.push('não está no arquivo bancário');
        else {
          if (d.valorLiquido > 0 && Math.abs(d.valorLiquido - pg.valor) > 0.004) falta.push('valor diferente do arquivo bancário (' + _ferfinMoeda_(pg.valor) + ')');
          if ((d.conta.trim() && _ferfinContaDig_(d.conta) !== _ferfinContaDig_(pg.conta)) ||
              (d.agencia.trim() && _ferfinAgBase_(d.agencia) !== _ferfinAgBase_(pg.agencia))) falta.push('agência ou conta diferente do arquivo bancário');
        }
      }
      if (falta.length) problemas.push(s.NOME + ': ' + falta.join(', '));
      itens.push(Object.assign({ s: s, web: web, nome: String(s.NOME || '').trim(), departamento: depto,
        inicio: _dataF_(s.DATA_INICIO), fim: _dataF_(s.DATA_FIM) }, d));
    });
    if (problemas.length) throw new Error('Envio bloqueado. Falta: ' + problemas.join(' · '));

    // arquivo bancário: vai anexado e fica arquivado no Drive
    const anexos = [], links = [];
    arquivos.forEach((a, i) => {
      const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.tipo || 'application/octet-stream',
        a.nome || ('arquivo_bancario_' + (i + 1)));
      anexos.push(blob);
      try {
        const raiz = _feriasParam_('FINANCEIRO_DRIVE_PASTA_ID', '');
        const f = raiz ? DriveApp.getFolderById(raiz).createFile(blob) : DriveApp.createFile(blob);
        links.push(f.getUrl());
      } catch (e) { console.error('feriasFinanceiroEnviarDepto: não arquivei o arquivo bancário: ' + e); }
    });
    itens.forEach(it => anexos.push(DriveApp.getFileById(it.recibo.id).getBlob().setName(it.recibo.nome)));

    const agora = new Date();
    const lote = 'LOTE-' + Utilities.formatDate(agora, DP360.FUSO, 'yyyyMMdd-HHmmss');
    const total = Math.round(itens.reduce((t, it) => t + it.valorLiquido, 0) * 100) / 100;
    const mesBr = mes.slice(5) + '/' + mes.slice(0, 4);
    const para = _feriasParam_('EMAIL_FINANCEIRO', '');
    if (!para) throw new Error('Configure o parâmetro EMAIL_FINANCEIRO (destino do envio).');
    const resumoArquivos = arquivos.map((a, i) => {
      const nome = String(a.nome || ('arquivo_bancario_' + (i + 1)));
      const l = leituras.find(x => x.nome === nome);
      return l ? nome + ' · ' + l.pagamentos.length + (l.pagamentos.length === 1 ? ' pagamento' : ' pagamentos') + ' · ' + _ferfinMoeda_(l.total) : nome;
    });
    const enviado = _enviar_(para, _ferfinAssunto_(depto, itens),
      _ferfinEmailHtml_(depto, mesBr, itens, total, lote, resumoArquivos), anexos);
    if (!enviado) throw new Error('Não consegui enviar o e-mail ao financeiro. Nada foi marcado como enviado; tente de novo.');

    itens.forEach(it => {
      _atualizarLinha_(sh, it.s._rowNumber, h, {
        ENVIADO_FINANCEIRO_EM: agora, ENVIADO_FINANCEIRO_POR: _normalizarEmail_(user.EMAIL),
        DOCUMENTO_FINANCEIRO_LINK: links[0] || '', VENCIMENTO_PAGAMENTO: _dataF_(it.dataPagamento),
        WEB_FINANCEIRO: it.web, VALOR_LIQUIDO: it.valorLiquido, LOTE_FINANCEIRO: lote
      });
    });
    _invalidarCacheFerias_();

    let planilha = 'ok';
    try { _ferfinGravarControleWeb_(itens, lote, agora); }
    catch (e) { planilha = String(e && e.message || e); console.error('feriasFinanceiroEnviarDepto: planilha Controle Web: ' + planilha); }

    _auditar_('FERIAS_ENVIADO_FINANCEIRO_DEPTO', user.EMAIL, 'FERIAS.FINANCEIRO_ENVIAR_DEPTO', true,
      depto + ' · ' + mesBr + ': ' + itens.length + ' pessoa(s), ' + _ferfinMoeda_(total) + ' · ' + lote +
      (planilha === 'ok' ? '' : ' · planilha NÃO gravada: ' + planilha), { lote: lote, ids: grupo.map(s => s.ID_SOLICITACAO) });
    return {
      ok: true, enviados: itens.length, total: total, lote: lote, planilha: planilha,
      mensagem: depto + ': ' + itens.length + ' férias enviadas ao financeiro (' + _ferfinMoeda_(total) + ').' +
        (planilha === 'ok' ? ' Planilha Controle Web preenchida.' : ' Atenção: o e-mail foi enviado, mas não consegui preencher a planilha Controle Web (' + planilha + ').')
    };
  } finally {
    lock.releaseLock();
  }
}

/** [2026-11-03] Assunto pedido pela Taynara: "Férias para pagamento · DEPARTAMENTO · Data para pagamento dd/mm/aaaa". */
function _ferfinAssunto_(depto, itens) {
  const datas = [];
  itens.forEach(it => { const t = _fmtBRF_(_dataF_(it.dataPagamento)); if (t && datas.indexOf(t) < 0) datas.push(t); });
  datas.sort((a, b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')));
  return 'Férias para pagamento · ' + depto + ' · Data para pagamento ' + datas.join(' e ');
}

function _ferfinEmailHtml_(depto, mesBr, itens, total, lote, resumoArquivos) {
  const e = _escapeHtml_;
  const datasPag = [];
  itens.forEach(it => { const t = _fmtBRF_(_dataF_(it.dataPagamento)); if (t && datasPag.indexOf(t) < 0) datasPag.push(t); });
  const th = (t) => '<th style="padding:7px 9px;border-bottom:2px solid #d5e0e3;text-align:left;font-size:11.5px;color:#4b5d62;white-space:nowrap">' + t + '</th>';
  const td = (t, dir) => '<td style="padding:7px 9px;border-bottom:1px solid #e6ecee;font-size:12.5px;white-space:nowrap' + (dir ? ';text-align:right' : '') + '">' + t + '</td>';
  const linhas = itens.map(it => '<tr>' + [
    td(e(it.web)), td(e(it.matricula)), td('<b>' + e(it.nome) + '</b>'), td(e(it.cpf)), td(e(it.identidade || '—')),
    td(_fmtBRF_(it.inicio)), td(_fmtBRF_(it.fim)), td(e(it.banco)), td(e(it.agencia)), td(e(it.conta)),
    td('<b>' + _ferfinMoeda_(it.valorLiquido) + '</b>', 1), td('<b>' + _fmtBRF_(_dataF_(it.dataPagamento)) + '</b>')
  ].join('') + '</tr>').join('');
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:auto;border:1px solid #e6ecee;border-radius:16px;overflow:hidden;background:#fff">' +
    '<div style="background:linear-gradient(135deg,#0E5A6B,#093F4B);padding:20px 24px">' +
      '<div style="color:#fff;font-size:17px;font-weight:700">Férias para pagamento · ' + e(depto) + '</div>' +
      '<div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:3px">Departamento Pessoal · CIEDS · férias com início em ' + e(mesBr) + '</div></div>' +
    '<div style="padding:22px 24px;color:#17252a;font-size:14px;line-height:1.6">' +
      _quadro_([['Departamento', e(depto)], ['Pessoas', String(itens.length)], ['Total líquido', _ferfinMoeda_(total)],
        ['Data de pagamento', datasPag.join(', ')], ['Arquivo bancário', resumoArquivos.map(e).join('<br>')], ['Lote', e(lote)]]) +
      '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>' +
        ['WEB', 'Matrícula', 'Nome', 'CPF', 'Identidade', 'Início', 'Fim', 'Banco', 'Agência', 'Conta', 'Valor líquido', 'Data de pagamento'].map(th).join('') +
      '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<p style="font-size:13px;color:#6b7c81;margin-top:16px">📎 Em anexo: ' + (resumoArquivos.length === 1 ? 'o arquivo bancário' : resumoArquivos.length + ' arquivos bancários') +
        ' e ' + (itens.length === 1 ? 'o recibo de férias' : 'os ' + itens.length + ' recibos de férias') + '.</p>' +
      '<p style="margin-top:20px;color:#8a9a9e;font-size:11.5px">Mensagem automática do Portal do DP. Qualquer dúvida, é só responder este e-mail.</p>' +
    '</div></div>';
}

/**
 * [2026-11-03] Linha onde entram as n linhas novas: logo abaixo do bloco de dados que começa na linha 2, como a
 * equipe faz à mão. A aba Férias tem um vão de linhas vazias no meio (em 03/11, da 201 à 998, com linhas de
 * setembro depois dele); pelo getLastRow as linhas novas iam parar depois do vão. Se o espaço livre não couber
 * todas, insere linhas para não escrever por cima de nada.
 */
function _ferfinLinhaLivre_(sh, largura, n) {
  const ultima = sh.getLastRow();
  let inicio = ultima + 1;
  if (ultima >= 2) {
    const vals = sh.getRange(2, 1, ultima - 1, largura).getDisplayValues();
    const vazia = r => r.every(c => String(c).trim() === '');
    const i = vals.findIndex(vazia);
    if (i > -1) {
      inicio = i + 2;
      if (!vals.slice(i, i + n).every(vazia)) sh.insertRowsAfter(i + 1, n);
    }
  }
  if (inicio + n - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), inicio + n - 1 - sh.getMaxRows());
  return inicio;
}

/** Acrescenta as linhas nas abas "Férias" e "Controle Web" da planilha do financeiro (pelos nomes das colunas). */
function _ferfinGravarControleWeb_(itens, lote, agora) {
  const ss = SpreadsheetApp.openById(_feriasParam_('FINANCEIRO_PLANILHA_CONTROLE_ID', FERFIN.PLANILHA_CONTROLE_PADRAO));
  const dataMeioDia = (d) => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0) : '';
  const hoje = dataMeioDia(agora);
  const cpf = (v) => { const d = String(v || '').replace(/\D/g, ''); return d ? d.padStart(11, '0') : ''; };

  const acrescentar = (nomeAba, linhaDe) => {
    const sh = ss.getSheetByName(nomeAba);
    if (!sh) throw new Error('aba "' + nomeAba + '" não encontrada');
    const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(x => _ferfinNorm_(x));
    const valores = [], formatos = [];
    itens.forEach(it => {
      const campos = linhaDe(it); // { 'NOME DA COLUNA': [valor, formato] }
      const v = cab.map(() => ''), f = cab.map(() => '@');
      Object.keys(campos).forEach(k => { const i = cab.indexOf(_ferfinNorm_(k)); if (i > -1) { v[i] = campos[k][0]; f[i] = campos[k][1]; } });
      valores.push(v); formatos.push(f);
    });
    const r = sh.getRange(_ferfinLinhaLivre_(sh, cab.length, valores.length), 1, valores.length, cab.length);
    r.setNumberFormats(formatos).setValues(valores);
  };
  const DATA = 'dd/MM/yyyy', REAIS = '"R$" #,##0.00', TXT = '@';

  acrescentar(FERFIN.ABA_FERIAS, it => ({
    'Funcionário': [it.matricula, TXT], 'Nome do Funcionário': [it.nome, TXT], 'CPF': [cpf(it.cpf), TXT],
    'Departamento': [it.departamento, TXT], 'Identidade': [it.identidade, TXT],
    'Início Férias': [dataMeioDia(it.inicio), DATA], 'Fim Férias': [dataMeioDia(it.fim), DATA],
    'Banco': [it.banco, TXT], 'Agência': [it.agencia, TXT], 'Conta': [it.conta, TXT],
    'Remuneração Líquida': [it.valorLiquido, REAIS], 'Data de Envio': [hoje, DATA], 'Data de pagamento': [dataMeioDia(_dataF_(it.dataPagamento)), DATA]
  }));
  acrescentar(FERFIN.ABA_WEB, it => ({
    'Web': [it.web, TXT], 'Descrição': ['FERIAS', TXT], 'Departamento': [it.departamento, TXT], 'Valor': [it.valorLiquido, REAIS],
    'Data pagamento': [dataMeioDia(_dataF_(it.dataPagamento)), DATA], 'Observação': [it.nome, TXT], 'Status': ['Enviado', TXT],
    'Data Envio': [hoje, DATA], 'Lote': [lote, TXT]
  }));
  SpreadsheetApp.flush();
}

/* ============================================================================================ */
/*  ACERTO ÚNICO (29/10): férias já enviadas pela planilha Controle Web                          */
/* ============================================================================================ */

/**
 * Marca como enviadas ao financeiro as férias deferidas que o DP já mandou pela planilha (linha "FERIAS" na
 * aba Controle Web com o nome na Observação e a data de pagamento até 20 dias antes do início), copiando
 * WEB, valor, lote e datas. Sem executar=true só lista. Rodar pelo editor ou por um ramo temporário.
 */
function ferfinMarcarEnviadasPelaPlanilha(executar) {
  const ss = SpreadsheetApp.openById(_feriasParam_('FINANCEIRO_PLANILHA_CONTROLE_ID', FERFIN.PLANILHA_CONTROLE_PADRAO));
  const web = ss.getSheetByName(FERFIN.ABA_WEB).getDataRange().getValues();
  const cab = web[0].map(x => _ferfinNorm_(x)), ci = (n) => cab.indexOf(_ferfinNorm_(n));
  const linhasFerias = web.slice(1).filter(r => _ferfinNorm_(r[ci('Descrição')]) === 'FERIAS');
  _ferfinGarantirColunas_();
  const sh = _shFerias_(FERIAS.ABAS.SOLICITACOES);
  const h = _headers_(sh);
  const pend = _sheetToObjects_(sh).filter(s => String(s.STATUS).toUpperCase() === 'DEFERIDA' && !_dataF_(s.ENVIADO_FINANCEIRO_EM));
  const res = { executado: !!executar, marcadas: [], ambiguas: [] };
  pend.forEach(s => {
    const ini = _dataF_(s.DATA_INICIO);
    if (!ini) return;
    const achou = linhasFerias.filter(r => {
      if (_ferfinNorm_(r[ci('Observação')]) !== _ferfinNorm_(s.NOME)) return false;
      const pg = _dataF_(r[ci('Data pagamento')]);
      return pg && pg <= ini && (ini - pg) / 86400000 <= 20;
    });
    if (!achou.length) return;
    if (achou.length > 1) { res.ambiguas.push(s.NOME); return; }
    const r = achou[0];
    const patch = {
      ENVIADO_FINANCEIRO_EM: _dataF_(r[ci('Data Envio')]) || new Date(), ENVIADO_FINANCEIRO_POR: 'planilha Controle Web',
      VENCIMENTO_PAGAMENTO: _dataF_(r[ci('Data pagamento')]), WEB_FINANCEIRO: String(r[ci('Web')]).trim(),
      VALOR_LIQUIDO: _ferfinValor_(r[ci('Valor')]), LOTE_FINANCEIRO: String(r[ci('Lote')] || '').trim()
    };
    res.marcadas.push(s.NOME + ' · ' + patch.WEB_FINANCEIRO + ' · ' + _fmtBRF_(ini));
    if (executar) _atualizarLinha_(sh, s._rowNumber, h, patch);
  });
  if (executar) _invalidarCacheFerias_();
  return res;
}
