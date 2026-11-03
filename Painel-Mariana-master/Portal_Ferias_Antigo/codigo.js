/*************************************************************************************************
 * CIEDS · PORTAL DE FÉRIAS  —  Código do servidor (Apps Script)
 * -----------------------------------------------------------------------------------------------
 * Fluxo:
 *   1. Gestor acessa o app e vê apenas os colaboradores vinculados ao seu e-mail.
 *   2. Gestor escolhe colaborador, data de início e quantidade de dias.
 *   3. O sistema grava a solicitação, faz split de saldo quando necessário e envia e-mails.
 *   4. DP responde na planilha:
 *        - Deferido/Aprovado: envia e-mail ao gestor e colaborador.
 *        - Indeferido/Recusado: envia e-mail ao gestor com motivo, arquiva na aba
 *          "Arquivo - Recusadas", limpa N/O, limpa decisão e restaura saldo.
 *************************************************************************************************/

const CONFIG = {
  SHEET_ID: '1FHrTvmz7gSFX2XmFVkvQYNOW_Ooo7Pbr66hXYSW0hn4',
  ABA_DADOS: 'Previsão Férias 2026',
  ABA_RECUSADAS: 'Arquivo - Recusadas',
  ABA_CREDENCIAIS: 'Portal - Credenciais',
  PRIMEIRA_LINHA_DADOS: 2,

  // Link opcional da política de férias. Se deixar vazio, o banner não aparece.
  POLITICA_URL: '',

  // Segurança do login por senha
  PROP_PEPPER: 'PORTAL_FERIAS_PEPPER',
  SESSION_TTL_HORAS: 10,
  SENHA_MIN_CARACTERES: 8,
  HASH_ITERACOES: 800,
  CODIGO_EXPIRA_MINUTOS: 15,
  CODIGO_MAX_TENTATIVAS: 5,
  LOGIN_MAX_TENTATIVAS: 5,
  LOGIN_BLOQUEIO_MINUTOS: 15,

  // Travas de início de férias: domingo(0), quinta(4), sexta(5), sábado(6).
  DIAS_INICIO_BLOQUEADOS: [4, 5, 6, 0],

  // Travas de feriado nacional.
  BLOQUEAR_INICIO_FERIADO: true,
  BLOQUEAR_VESPERA_FERIADO: true,
  DIAS_VESPERA_FERIADO: 2,
  FERIADOS_EXTRA: {},

  // Domínios permitidos para acessar o portal.
  // Importante: cadastrar sem o @.
  DOMINIOS_PERMITIDOS: [
    'cieds.org.br',
    'coletivoaprendiz.org.br'
  ],

  CABECALHO_RECUSADAS: [
    'Código',
    'Nome',
    'Departamento',
    'Admissão',
    'Vcto. Férias',
    'Gestão',
    'Email gestor',
    'Período aquisitivo',
    'Faltas no período',
    'Dias gozados',
    'Dias de direito',
    'Dias a serem gozados',
    'Conceder até',
    'Agendamento Inicio',
    'Agendamento Fim',
    'Desligamento',
    'Afastamento',
    'Salário Base',
    'Adicional Noturno',
    'Gratificação de Função',
    'Total Base',
    'Quantidade de dias de férias',
    'Abono',
    'Previa Bruto',
    '1/3 de Férias',
    'Abono +1/3',
    'INSS',
    'IRRF',
    'Previa férias',
    'Tipo',
    'Alterdata',
    'Mês Referência (calendário)',
    'Split Processado',
    'Solicitado pelo Gestor',
    'Aprovado DP',
    'Data Aprovação DP',
    'Motivo Recusa',
    'Alerta 20 dias Enviado',
    'Data Arquivamento'
  ],

  COL: {
    NOME:              'B',
    GESTAO:            'F',
    EMAIL_GESTOR:      'G',
    PERIODO_AQUIS:     'H',
    DIAS_GOZADOS:      'J',
    DIAS_A_GOZAR:      'L',
    CONCEDER_ATE:      'M',
    APROVADO_DP:       'AI',
    MOTIVO_RECUSA:     'AK',

    ID_UNICO:          'AM',
    DATA_APROVACAO_DP: 'AJ',

    DATA_INICIO:       'N',
    DATA_FIM:          'O',
    SOLICITADO_GESTOR: 'AH',
    OBSERVACAO:        'AQ',

    EMAIL_COLABORADOR: 'AP'
  },

  EMAIL_DP: 'ferias@cieds.org.br',
  PRAZO_RESPOSTA_DP_DIAS: 15,
  DIAS_UTEIS_PAGAMENTO_ANTES: 2,
  DIAS_RECIBO_ANTES: 5,

  FUSO: 'America/Sao_Paulo',

  MARCA: {
    nome: 'CIEDS',
    logo: 'https://www.cieds.org.br/storage/settings/November2023/EpbAW45QebvsTGIqQIoi.svg',
    corPrimaria: '#0E5A6B',
    corAcento:  '#E4007C'
  },

  APROVADO: ['aprovado', 'aprovada', 'sim', 'deferido', 'deferida', 'ok'],
  RECUSADO: ['recusado', 'recusada', 'nao', 'não', 'negado', 'indeferido', 'indeferida', 'reprovado'],
  PENDENTE: 'Pendente'
};

/* ============================================================================================ */
/*  INFRA / WEB APP                                                                              */
/* ============================================================================================ */

/* ============================================================================================
 * [DESATIVADO 30/09/2026] Este portal foi substituído pelo Portal do Gestor do DP360 e não
 * recebe mais nada: a página mostra só um aviso, as funções chamadas pela página recusam
 * (para quem ainda estiver com ela aberta) e os gatilhos da planilha (aoEditarDP,
 * onEditGerenciamentoFerias e rotinaDiaria) não fazem mais nada. O código antigo continua
 * abaixo, sem uso. Para reativar, volte à versão 20 da implantação.
 * ============================================================================================ */
var PORTAL_DESATIVADO_MSG = 'Este Portal de Férias foi desativado em 30/09/2026. ' +
  'Os pedidos de férias agora são feitos pelo Portal do Gestor (DP360). Dúvidas: ferias@cieds.org.br.';

function _portalDesativado_() {
  throw new Error(PORTAL_DESATIVADO_MSG);
}

function doGet() {
  var html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Portal de Férias desativado</title></head>' +
    '<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f7f8;color:#1c2b33">' +
    '<div style="max-width:560px;margin:60px auto;padding:0 16px">' +
    '<div style="background:#0E5A6B;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;font-weight:700;font-size:18px">CIEDS · Portal de Férias</div>' +
    '<div style="background:#fff;padding:24px;border-radius:0 0 14px 14px;border:1px solid #e3e9ec;border-top:0">' +
    '<h2 style="margin:0 0 12px;color:#0E5A6B;font-size:20px">Este portal foi desativado</h2>' +
    '<p style="line-height:1.5">Os pedidos de férias agora são feitos pelo <b>Portal do Gestor (DP360)</b>. ' +
    'Nada mais é recebido por este endereço.</p>' +
    '<p style="line-height:1.5">Dúvidas: <a href="mailto:ferias@cieds.org.br" style="color:#0E5A6B">ferias@cieds.org.br</a></p>' +
    '</div></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('CIEDS · Portal de Férias (desativado)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

function _ss() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function _aba() {
  return _ss().getSheetByName(CONFIG.ABA_DADOS);
}

function _normalizarEmail_(emailInformado) {
  const email = String(emailInformado || '').toLowerCase().trim();

  if (!email || email.indexOf('@') === -1) {
    throw new Error('Informe um e-mail institucional válido.');
  }

  const dominio = email.split('@').pop();

  if (CONFIG.DOMINIOS_PERMITIDOS.indexOf(dominio) === -1) {
    throw new Error(
      'Acesso não permitido para o domínio "' + dominio + '". ' +
      'Use uma conta @cieds.org.br ou @coletivoaprendiz.org.br.'
    );
  }

  return email;
}

function _segredo_() {
  const props = PropertiesService.getScriptProperties();
  let segredo = props.getProperty(CONFIG.PROP_PEPPER);

  if (!segredo) {
    segredo = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(CONFIG.PROP_PEPPER, segredo);
  }

  return segredo;
}

function inicializarPortalSenhas() {
  _segredo_();
  _abaCredenciais_();
  return 'Portal inicializado. Aba de credenciais criada e segredo configurado.';
}

function _hashSeguro_(valor, salt) {
  let texto = String(salt || '') + '|' + String(valor || '') + '|' + _segredo_();

  for (let i = 0; i < CONFIG.HASH_ITERACOES; i++) {
    texto = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)
    );
  }

  return texto;
}

function _compararSeguro_(a, b) {
  a = String(a || '');
  b = String(b || '');

  if (a.length !== b.length) return false;

  let r = 0;

  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return r === 0;
}

function _criarToken_(email) {
  const payload = {
    v: 1,
    email: email,
    exp: Date.now() + CONFIG.SESSION_TTL_HORAS * 60 * 60 * 1000
  };

  const corpo = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const assinatura = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(corpo, _segredo_())
  );

  return corpo + '.' + assinatura;
}

function _emailPorToken_(token) {
  token = String(token || '').trim();

  const partes = token.split('.');

  if (partes.length !== 2) {
    throw new Error('Sessão inválida. Entre novamente.');
  }

  const corpo = partes[0];
  const assinatura = partes[1];
  const esperada = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(corpo, _segredo_())
  );

  if (!_compararSeguro_(assinatura, esperada)) {
    throw new Error('Sessão inválida. Entre novamente.');
  }

  const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(corpo)).getDataAsString('UTF-8');
  const payload = JSON.parse(json);

  if (!payload.email || !payload.exp || Number(payload.exp) < Date.now()) {
    throw new Error('Sessão expirada. Entre novamente.');
  }

  return _normalizarEmail_(payload.email);
}

const CRED_HEADERS = [
  'Email gestor',
  'Nome gestor',
  'Senha Salt',
  'Senha Hash',
  'Ativo',
  'Código Salt',
  'Código Hash',
  'Código Expira Em',
  'Tentativas Código',
  'Tentativas Login',
  'Bloqueado Até',
  'Último Login',
  'Criado Em',
  'Atualizado Em'
];

function _abaCredenciais_() {
  const ss = _ss();
  let aba = ss.getSheetByName(CONFIG.ABA_CREDENCIAIS);

  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_CREDENCIAIS);
  }

  if (aba.getMaxColumns() < CRED_HEADERS.length) {
    aba.insertColumnsAfter(aba.getMaxColumns(), CRED_HEADERS.length - aba.getMaxColumns());
  }

  aba.getRange(1, 1, 1, CRED_HEADERS.length).setValues([CRED_HEADERS]);
  aba.setFrozenRows(1);

  try {
    aba.hideSheet();
  } catch (e) {
    // Se não puder ocultar, segue funcionando normalmente.
  }

  return aba;
}

function _idxCred_(nome) {
  return CRED_HEADERS.indexOf(nome);
}

function _linhaParaCred_(row) {
  const obj = {};

  CRED_HEADERS.forEach((h, i) => obj[h] = row[i]);

  return obj;
}

function _buscarCred_(email) {
  const aba = _abaCredenciais_();
  const ult = aba.getLastRow();

  if (ult < 2) return null;

  const col = aba.getRange(2, 1, ult - 1, 1).getValues();

  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').toLowerCase().trim() === email) {
      const linha = i + 2;
      const row = aba.getRange(linha, 1, 1, CRED_HEADERS.length).getValues()[0];
      return { aba: aba, linha: linha, cred: _linhaParaCred_(row) };
    }
  }

  return null;
}

function _salvarCred_(email, dados) {
  const aba = _abaCredenciais_();
  const existente = _buscarCred_(email);
  const agora = new Date();

  let cred = existente ? existente.cred : {};

  Object.keys(dados || {}).forEach(k => cred[k] = dados[k]);

  cred['Email gestor'] = email;
  cred['Atualizado Em'] = agora;

  if (!cred['Criado Em']) {
    cred['Criado Em'] = agora;
  }

  if (cred['Ativo'] === undefined || cred['Ativo'] === '') {
    cred['Ativo'] = true;
  }

  const valores = CRED_HEADERS.map(h => cred[h] === undefined ? '' : cred[h]);

  if (existente) {
    aba.getRange(existente.linha, 1, 1, CRED_HEADERS.length).setValues([valores]);
  } else {
    aba.appendRow(valores);
  }
}

function _buscarGestorNaBase_(email) {
  const aba = _aba();
  const ultLin = aba.getLastRow();
  const ultCol = aba.getLastColumn();
  let nomeGestor = '';
  let total = 0;

  if (ultLin < CONFIG.PRIMEIRA_LINHA_DADOS) {
    return { existe: false, nome: '', total: 0 };
  }

  const dados = aba.getRange(
    CONFIG.PRIMEIRA_LINHA_DADOS,
    1,
    ultLin - CONFIG.PRIMEIRA_LINHA_DADOS + 1,
    ultCol
  ).getValues();

  dados.forEach(row => {
    const emailGestor = String(row[IDX.EMAIL_GESTOR - 1] || '').toLowerCase().trim();

    if (emailGestor === email) {
      total++;
      nomeGestor = row[IDX.GESTAO - 1] || nomeGestor;
    }
  });

  return { existe: total > 0, nome: nomeGestor, total: total };
}

function _validarSenhaForte_(senha) {
  senha = String(senha || '');

  if (senha.length < CONFIG.SENHA_MIN_CARACTERES) {
    throw new Error('A senha precisa ter pelo menos ' + CONFIG.SENHA_MIN_CARACTERES + ' caracteres.');
  }

  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/[0-9]/.test(senha)) {
    throw new Error('A senha precisa ter letras e números.');
  }
}

function solicitarCodigoSenha(emailInformado) {
  _portalDesativado_(); // [DESATIVADO 30/09/2026]
  const email = _normalizarEmail_(emailInformado);
  const gestor = _buscarGestorNaBase_(email);

  if (!gestor.existe) {
    throw new Error('Este e-mail não está cadastrado como gestor na planilha de férias.');
  }

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const salt = Utilities.getUuid();
  const hash = _hashSeguro_(codigo, salt);
  const expira = new Date(Date.now() + CONFIG.CODIGO_EXPIRA_MINUTOS * 60 * 1000);

  _salvarCred_(email, {
    'Nome gestor': gestor.nome || '',
    'Código Salt': salt,
    'Código Hash': hash,
    'Código Expira Em': expira,
    'Tentativas Código': 0,
    'Ativo': true
  });

  MailApp.sendEmail({
    to: email,
    subject: 'Código de acesso — Portal de Férias CIEDS',
    htmlBody: _wrap(
      'Código de acesso',
      '<p>Você solicitou cadastro ou redefinição de senha no Portal de Férias.</p>' +
      '<p style="font-size:24px;font-weight:bold;letter-spacing:4px;color:' + CONFIG.MARCA.corPrimaria + '">' + codigo + '</p>' +
      '<p>Este código expira em <b>' + CONFIG.CODIGO_EXPIRA_MINUTOS + ' minutos</b>.</p>' +
      '<p>Se você não solicitou este código, ignore esta mensagem.</p>'
    )
  });

  return {
    ok: true,
    mensagem: 'Enviamos um código para ' + email + '. Verifique sua caixa de entrada.'
  };
}

function definirSenhaComCodigo(emailInformado, codigo, senha) {
  _portalDesativado_(); // [DESATIVADO 30/09/2026]
  const email = _normalizarEmail_(emailInformado);
  const gestor = _buscarGestorNaBase_(email);

  if (!gestor.existe) {
    throw new Error('Este e-mail não está cadastrado como gestor na planilha de férias.');
  }

  _validarSenhaForte_(senha);

  const item = _buscarCred_(email);

  if (!item || !item.cred['Código Hash'] || !item.cred['Código Salt']) {
    throw new Error('Solicite um novo código antes de cadastrar a senha.');
  }

  const cred = item.cred;
  const tentativas = Number(cred['Tentativas Código']) || 0;

  if (tentativas >= CONFIG.CODIGO_MAX_TENTATIVAS) {
    throw new Error('Código bloqueado por excesso de tentativas. Solicite um novo código.');
  }

  const expira = cred['Código Expira Em'] ? new Date(cred['Código Expira Em']) : null;

  if (!expira || expira.getTime() < Date.now()) {
    throw new Error('Código expirado. Solicite um novo código.');
  }

  const hashInformado = _hashSeguro_(String(codigo || '').trim(), cred['Código Salt']);

  if (!_compararSeguro_(hashInformado, cred['Código Hash'])) {
    _salvarCred_(email, { 'Tentativas Código': tentativas + 1 });
    throw new Error('Código inválido. Confira o código enviado por e-mail.');
  }

  const saltSenha = Utilities.getUuid();
  const hashSenha = _hashSeguro_(senha, saltSenha);

  _salvarCred_(email, {
    'Nome gestor': gestor.nome || '',
    'Senha Salt': saltSenha,
    'Senha Hash': hashSenha,
    'Ativo': true,
    'Código Salt': '',
    'Código Hash': '',
    'Código Expira Em': '',
    'Tentativas Código': 0,
    'Tentativas Login': 0,
    'Bloqueado Até': ''
  });

  return { ok: true, mensagem: 'Senha cadastrada com sucesso. Agora você já pode entrar.' };
}

function loginComSenha(emailInformado, senha) {
  _portalDesativado_(); // [DESATIVADO 30/09/2026]
  let email;

  try {
    email = _normalizarEmail_(emailInformado);
  } catch (e) {
    return { ok: false, mensagem: e.message || String(e) };
  }

  const gestor = _buscarGestorNaBase_(email);

  if (!gestor.existe) {
    return { ok: false, mensagem: 'Este e-mail não está cadastrado como gestor na planilha de férias.' };
  }

  const item = _buscarCred_(email);

  if (!item || !item.cred['Senha Hash'] || !item.cred['Senha Salt']) {
    return {
      ok: false,
      precisaCadastro: true,
      mensagem: 'Senha ainda não cadastrada. Clique em "Primeiro acesso / esqueci minha senha".'
    };
  }

  const cred = item.cred;

  if (String(cred['Ativo']).toLowerCase() === 'false') {
    return { ok: false, mensagem: 'Acesso inativo. Fale com o Departamento Pessoal.' };
  }

  const bloqueadoAte = cred['Bloqueado Até'] ? new Date(cred['Bloqueado Até']) : null;

  if (bloqueadoAte && bloqueadoAte.getTime() > Date.now()) {
    return {
      ok: false,
      mensagem: 'Acesso temporariamente bloqueado por excesso de tentativas. Tente novamente após ' + fmtBR(bloqueadoAte) + '.'
    };
  }

  const hashInformado = _hashSeguro_(senha, cred['Senha Salt']);

  if (!_compararSeguro_(hashInformado, cred['Senha Hash'])) {
    const tentativas = (Number(cred['Tentativas Login']) || 0) + 1;
    const dados = { 'Tentativas Login': tentativas };

    if (tentativas >= CONFIG.LOGIN_MAX_TENTATIVAS) {
      dados['Bloqueado Até'] = new Date(Date.now() + CONFIG.LOGIN_BLOQUEIO_MINUTOS * 60 * 1000);
      dados['Tentativas Login'] = 0;
    }

    _salvarCred_(email, dados);

    return {
      ok: false,
      mensagem: tentativas >= CONFIG.LOGIN_MAX_TENTATIVAS
        ? 'Senha incorreta. Acesso bloqueado temporariamente por segurança.'
        : 'Senha incorreta. Confira e tente novamente.'
    };
  }

  _salvarCred_(email, {
    'Nome gestor': gestor.nome || '',
    'Tentativas Login': 0,
    'Bloqueado Até': '',
    'Último Login': new Date()
  });

  const token = _criarToken_(email);

  return {
    ok: true,
    token: token,
    contexto: _montarContextoPorEmail_(email)
  };
}

function resetarSenhaGestor(emailInformado) {
  const email = _normalizarEmail_(emailInformado);
  const gestor = _buscarGestorNaBase_(email);

  if (!gestor.existe) {
    throw new Error('Este e-mail não está cadastrado como gestor na planilha de férias.');
  }

  _salvarCred_(email, {
    'Nome gestor': gestor.nome || '',
    'Senha Salt': '',
    'Senha Hash': '',
    'Tentativas Login': 0,
    'Bloqueado Até': '',
    'Ativo': true
  });

  return 'Senha resetada para ' + email + '. O gestor deverá usar Primeiro acesso / esqueci minha senha.';
}

function sairLogin() {
  return { ok: true };
}

function colToIndex(letra) {
  if (!letra) return 0;

  letra = String(letra).toUpperCase().trim();

  let n = 0;

  for (let i = 0; i < letra.length; i++) {
    n = n * 26 + (letra.charCodeAt(i) - 64);
  }

  return n;
}

const IDX = {};
Object.keys(CONFIG.COL).forEach(k => IDX[k] = colToIndex(CONFIG.COL[k]));

function fmtBR(d) {
  return d ? Utilities.formatDate(new Date(d), CONFIG.FUSO, 'dd/MM/yyyy') : '';
}

function hojeSP() {
  const s = Utilities.formatDate(new Date(), CONFIG.FUSO, 'yyyy/MM/dd');
  return new Date(s + ' 00:00:00');
}

function uuid() {
  return Utilities.getUuid();
}

function dataISOParaDataLocal_(iso) {
  if (!iso) return null;

  const partes = String(iso).split('-');

  if (partes.length !== 3) {
    throw new Error('Data inválida: ' + iso);
  }

  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);

  if (!ano || !mes || !dia) {
    throw new Error('Data inválida: ' + iso);
  }

  // Meio-dia evita que o Google Sheets converta para o dia anterior por causa de fuso horário.
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

function subtrairDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

function subtrairDiasUteis(d, n) {
  const x = new Date(d);
  let restantes = n;

  while (restantes > 0) {
    x.setDate(x.getDate() - 1);

    const dow = x.getDay();

    if (dow !== 0 && dow !== 6) {
      restantes--;
    }
  }

  return x;
}


/* ============================================================================================ */
/*  TRAVAS DE FÉRIAS — período aquisitivo, dias bloqueados e feriados                            */
/* ============================================================================================ */

function _dateToISO_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), CONFIG.FUSO, 'yyyy-MM-dd');
}

function _addDias_(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function _addMeses_(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function _parseDataBR_(s) {
  const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;

  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;

  return new Date(ano, Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
}

function _extrairFimPeriodoAquisitivo_(valorPeriodo, concederAte) {
  if (valorPeriodo instanceof Date && !isNaN(valorPeriodo.getTime())) {
    return valorPeriodo;
  }

  const s = String(valorPeriodo || '');
  const datas = s.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g) || [];

  if (datas.length >= 2) {
    return _parseDataBR_(datas[1]);
  }

  if (datas.length === 1) {
    return _parseDataBR_(datas[0]);
  }

  if (concederAte) {
    const limite = new Date(concederAte);

    if (!isNaN(limite.getTime())) {
      // Regra trabalhista usual: conceder até = 12 meses após o fim do período aquisitivo.
      return _addMeses_(limite, -12);
    }
  }

  return null;
}

function _inicioMinimoPorPeriodo_(periodo, concederAte) {
  const fim = _extrairFimPeriodoAquisitivo_(periodo, concederAte);

  if (!fim || isNaN(fim.getTime())) {
    return { fim: null, inicioMinimo: null };
  }

  return {
    fim: fim,
    inicioMinimo: _addDias_(fim, 1)
  };
}

function _pascoa_(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

function _feriadosNacionais_(ano) {
  const feriados = {};

  function add(iso, nome) {
    feriados[iso] = nome;
  }

  add(ano + '-01-01', 'Confraternização Universal');
  add(ano + '-04-21', 'Tiradentes');
  add(ano + '-05-01', 'Dia do Trabalho');
  add(ano + '-09-07', 'Independência do Brasil');
  add(ano + '-10-12', 'Nossa Senhora Aparecida');
  add(ano + '-11-02', 'Finados');
  add(ano + '-11-15', 'Proclamação da República');
  add(ano + '-11-20', 'Dia Nacional de Zumbi e da Consciência Negra');
  add(ano + '-12-25', 'Natal');

  const sextaSanta = _addDias_(_pascoa_(ano), -2);
  add(_dateToISO_(sextaSanta), 'Sexta-feira Santa');

  const extras = CONFIG.FERIADOS_EXTRA || {};
  Object.keys(extras).forEach(iso => add(iso, extras[iso]));

  return feriados;
}

function _feriadosCalendario_() {
  const hoje = new Date();
  const anos = [hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1, hoje.getFullYear() + 2];
  const todos = {};

  anos.forEach(ano => {
    const f = _feriadosNacionais_(ano);
    Object.keys(f).forEach(k => todos[k] = f[k]);
  });

  return todos;
}

function _motivoBloqueioInicio_(inicio, periodo, concederAte) {
  const info = _inicioMinimoPorPeriodo_(periodo, concederAte);

  if (info.inicioMinimo && inicio < info.inicioMinimo) {
    return 'O início das férias não pode ser anterior a ' + fmtBR(info.inicioMinimo) +
      ', pois o período aquisitivo ainda não foi completado.';
  }

  const dow = inicio.getDay();

  if ((CONFIG.DIAS_INICIO_BLOQUEADOS || []).indexOf(dow) > -1) {
    const nomes = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return 'As férias não podem começar em ' + nomes[dow] + '. Escolha um dia de segunda a quarta-feira.';
  }

  const iso = _dateToISO_(inicio);
  const feriados = _feriadosNacionais_(inicio.getFullYear());

  if (CONFIG.BLOQUEAR_INICIO_FERIADO && feriados[iso]) {
    return 'As férias não podem começar em feriado nacional: ' + fmtBR(inicio) + ' — ' + feriados[iso] + '.';
  }

  if (CONFIG.BLOQUEAR_VESPERA_FERIADO) {
    const n = Number(CONFIG.DIAS_VESPERA_FERIADO) || 2;

    for (let k = 1; k <= n; k++) {
      const prox = _addDias_(inicio, k);
      const pIso = _dateToISO_(prox);
      const pFeriados = _feriadosNacionais_(prox.getFullYear());

      if (pFeriados[pIso]) {
        return 'As férias não podem começar nos ' + n + ' dias que antecedem feriado nacional: ' +
          fmtBR(prox) + ' — ' + pFeriados[pIso] + '.';
      }
    }
  }

  return '';
}

/* ============================================================================================ */
/*  LEITURA — contexto do gestor logado + equipe                                                 */
/* ============================================================================================ */

function getContexto(token) {
  _portalDesativado_(); // [DESATIVADO 30/09/2026]
  const email = _emailPorToken_(token);
  return _montarContextoPorEmail_(email);
}

function _montarContextoPorEmail_(email) {
  email = _normalizarEmail_(email);

  const aba = _aba();
  const ultLin = aba.getLastRow();
  const ultCol = aba.getLastColumn();

  const equipe = [];
  let nomeGestor = '';

  if (ultLin >= CONFIG.PRIMEIRA_LINHA_DADOS) {
    const dados = aba.getRange(
      CONFIG.PRIMEIRA_LINHA_DADOS,
      1,
      ultLin - CONFIG.PRIMEIRA_LINHA_DADOS + 1,
      ultCol
    ).getValues();

    dados.forEach((row, i) => {
      const emailGestor = String(row[IDX.EMAIL_GESTOR - 1] || '').toLowerCase().trim();

      if (emailGestor !== email) return;

      nomeGestor = row[IDX.GESTAO - 1] || nomeGestor;

      const statusRaw = String(row[IDX.APROVADO_DP - 1] || '').trim();

      const solicitado = IDX.SOLICITADO_GESTOR
        ? String(row[IDX.SOLICITADO_GESTOR - 1] || '').trim() !== ''
        : false;

      const inicio = IDX.DATA_INICIO ? row[IDX.DATA_INICIO - 1] : '';
      const fim = IDX.DATA_FIM ? row[IDX.DATA_FIM - 1] : '';
      const concederAte = IDX.CONCEDER_ATE ? row[IDX.CONCEDER_ATE - 1] : '';
      const periodo = row[IDX.PERIODO_AQUIS - 1] || '';
      const aquisitivo = _inicioMinimoPorPeriodo_(periodo, concederAte);

      equipe.push({
        origem: 'base',
        id: String(row[IDX.ID_UNICO - 1] || ''),
        linha: CONFIG.PRIMEIRA_LINHA_DADOS + i,
        nome: row[IDX.NOME - 1] || '(sem nome)',
        periodo: String(periodo || ''),
        diasAGozar: Number(row[IDX.DIAS_A_GOZAR - 1]) || 0,
        diasGozados: Number(row[IDX.DIAS_GOZADOS - 1]) || 0,
        concederAte: fmtBR(concederAte),
        concederAteISO: concederAte ? _dateToISO_(concederAte) : '',
        fimPeriodoAquisISO: aquisitivo.fim ? _dateToISO_(aquisitivo.fim) : '',
        inicioMinimoISO: aquisitivo.inicioMinimo ? _dateToISO_(aquisitivo.inicioMinimo) : '',
        dataInicio: inicio ? fmtBR(inicio) : '',
        dataFim: fim ? fmtBR(fim) : '',
        motivoRecusa: IDX.MOTIVO_RECUSA ? String(row[IDX.MOTIVO_RECUSA - 1] || '') : '',
        status: classificarStatus_(statusRaw, solicitado)
      });
    });
  }

  const historico = _getHistoricoRecusadasGestor_(email);

  if (!nomeGestor && historico.length) {
    nomeGestor = historico[0].gestao || '';
  }

  return {
    email: email,
    autorizado: equipe.length > 0 || historico.length > 0,
    gestor: nomeGestor,
    marca: CONFIG.MARCA,
    prazoDP: CONFIG.PRAZO_RESPOSTA_DP_DIAS,
    politicaUrl: CONFIG.POLITICA_URL || '',
    feriados: _feriadosCalendario_(),
    bloquearInicioFeriado: !!CONFIG.BLOQUEAR_INICIO_FERIADO,
    bloquearVesperaFeriado: !!CONFIG.BLOQUEAR_VESPERA_FERIADO,
    diasVesperaFeriado: Number(CONFIG.DIAS_VESPERA_FERIADO) || 2,
    equipe: equipe,
    historico: historico
  };
}

function classificarStatus_(raw, solicitado) {
  const v = String(raw || '').toLowerCase().trim();

  if (CONFIG.APROVADO.indexOf(v) > -1) {
    return { chave: 'deferido', rotulo: 'Deferida' };
  }

  if (CONFIG.RECUSADO.indexOf(v) > -1) {
    return { chave: 'indeferido', rotulo: 'Indeferida' };
  }

  if (solicitado) {
    return { chave: 'pendente', rotulo: 'Aguardando DP' };
  }

  return { chave: 'livre', rotulo: 'Disponível' };
}

/* ============================================================================================ */
/*  ENVIO DA SOLICITAÇÃO                                                                         */
/* ============================================================================================ */

function enviarSolicitacao(payload) {
  _portalDesativado_(); // [DESATIVADO 30/09/2026]
  payload = payload || {};

  const email = _emailPorToken_(payload.token);
  const aba = _aba();
  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    const linha = _acharLinhaPorId_(aba, payload.id);

    if (!linha) {
      throw new Error('Registro não encontrado. Atualize a página e tente de novo.');
    }

    const emailGestorLinha = String(aba.getRange(linha, IDX.EMAIL_GESTOR).getValue() || '').toLowerCase().trim();

    if (emailGestorLinha !== email) {
      throw new Error('Você não tem permissão para agendar as férias deste colaborador.');
    }

    const nome = aba.getRange(linha, IDX.NOME).getValue();
    const diasAGozar = Number(aba.getRange(linha, IDX.DIAS_A_GOZAR).getValue()) || 0;

    const statusRaw = String(aba.getRange(linha, IDX.APROVADO_DP).getValue() || '').trim();
    const solicitado = IDX.SOLICITADO_GESTOR
      ? String(aba.getRange(linha, IDX.SOLICITADO_GESTOR).getValue() || '').trim() !== ''
      : false;
    const statusAtual = classificarStatus_(statusRaw, solicitado);

    if (statusAtual.chave !== 'livre') {
      throw new Error('Este registro não está disponível para nova solicitação. Status atual: ' + statusAtual.rotulo + '.');
    }

    const diasGozadosAnterior = IDX.DIAS_GOZADOS
      ? aba.getRange(linha, IDX.DIAS_GOZADOS).getValue()
      : '';

    const concederAte = aba.getRange(linha, IDX.CONCEDER_ATE).getValue();
    const periodo = aba.getRange(linha, IDX.PERIODO_AQUIS).getValue();

    const dias = parseInt(payload.dias, 10);

    if (!dias || dias < 1) {
      throw new Error('Informe uma quantidade de dias válida.');
    }

    if (dias > diasAGozar) {
      throw new Error('Você pediu ' + dias + ' dias, mas há apenas ' + diasAGozar + ' dias a gozar.');
    }

    const inicio = dataISOParaDataLocal_(payload.dataInicio);

    if (!inicio || isNaN(inicio.getTime())) {
      throw new Error('Data de início inválida.');
    }

    if (inicio < hojeSP()) {
      throw new Error('A data de início não pode ser no passado.');
    }

    if (concederAte && inicio > new Date(concederAte)) {
      throw new Error(
        'O início (' + fmtBR(inicio) + ') ultrapassa o limite "Conceder até" (' + fmtBR(concederAte) + ').'
      );
    }

    const motivoBloqueio = _motivoBloqueioInicio_(inicio, periodo, concederAte);

    if (motivoBloqueio) {
      throw new Error(motivoBloqueio);
    }

    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + dias - 1);

    const saldo = diasAGozar - dias;

    _set(aba, linha, 'DATA_INICIO', inicio);
    _set(aba, linha, 'DATA_FIM', fim);
    _set(aba, linha, 'DIAS_GOZADOS', dias);
    _set(aba, linha, 'DIAS_A_GOZAR', dias);
    _set(
      aba,
      linha,
      'SOLICITADO_GESTOR',
      email + ' em ' + Utilities.formatDate(new Date(), CONFIG.FUSO, 'dd/MM/yyyy HH:mm')
    );

    if (IDX.APROVADO_DP) {
      aba.getRange(linha, IDX.APROVADO_DP).clearContent();
    }

    if (IDX.MOTIVO_RECUSA) {
      aba.getRange(linha, IDX.MOTIVO_RECUSA).clearContent();
    }

    if (IDX.DATA_APROVACAO_DP) {
      aba.getRange(linha, IDX.DATA_APROVACAO_DP).clearContent();
    }

    let novoId = '';
    let obs = 'Agendado ' + dias + ' dia(s): ' + fmtBR(inicio) + ' a ' + fmtBR(fim) + '.';

    if (saldo > 0) {
      novoId = _criarLinhaSaldo_(aba, linha, saldo);
      obs += ' Saldo de ' + saldo + ' dia(s) movido para nova linha (ID ' + novoId + ').';
    }

    const metaPortal = {
      saldoAnterior: diasAGozar,
      diasGozadosAnterior: diasGozadosAnterior,
      splitId: novoId || ''
    };

    obs += ' __PORTAL_META__' + JSON.stringify(metaPortal) + '__FIM_META__';

    _set(aba, linha, 'OBSERVACAO', obs);

    _emailGestorRecebido_(email, nome, dias, inicio, fim);
    _emailDPNovaSolicitacao_(email, nome, dias, inicio, fim, linha);

    SpreadsheetApp.flush();

    return {
      ok: true,
      saldo: saldo,
      mensagem: 'Solicitação enviada ao DP! ' + (
        saldo > 0
          ? 'Agendamos ' + dias + ' dias e o saldo de ' + saldo + ' dias ficou disponível para novo agendamento.'
          : 'Você e o DP receberão a confirmação por e-mail.'
      )
    };

  } finally {
    lock.releaseLock();
  }
}

function _criarLinhaSaldo_(aba, linhaOrig, saldo) {
  const ultCol = aba.getLastColumn();
  const valores = aba.getRange(linhaOrig, 1, 1, ultCol).getValues()[0];
  const novoId = uuid();

  const zera = [
    'DATA_INICIO',
    'DATA_FIM',
    'SOLICITADO_GESTOR',
    'APROVADO_DP',
    'MOTIVO_RECUSA',
    'DATA_APROVACAO_DP',
    'OBSERVACAO',
    'DIAS_GOZADOS'
  ];

  zera.forEach(k => {
    if (IDX[k]) valores[IDX[k] - 1] = '';
  });

  if (IDX.ID_UNICO) {
    valores[IDX.ID_UNICO - 1] = novoId;
  }

  if (IDX.DIAS_A_GOZAR) {
    valores[IDX.DIAS_A_GOZAR - 1] = saldo;
  }

  aba.appendRow(valores);

  return novoId;
}

function _acharLinhaPorId_(aba, id) {
  if (!id) return null;

  const qtdLinhas = aba.getLastRow() - CONFIG.PRIMEIRA_LINHA_DADOS + 1;

  if (qtdLinhas < 1) return null;

  const col = aba.getRange(
    CONFIG.PRIMEIRA_LINHA_DADOS,
    IDX.ID_UNICO,
    qtdLinhas,
    1
  ).getValues();

  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) {
      return CONFIG.PRIMEIRA_LINHA_DADOS + i;
    }
  }

  return null;
}

function _set(aba, linha, chaveCol, valor) {
  if (!IDX[chaveCol]) return;

  aba.getRange(linha, IDX[chaveCol]).setValue(valor);
}

function _get(aba, linha, chaveCol) {
  if (!IDX[chaveCol]) return '';

  return aba.getRange(linha, IDX[chaveCol]).getValue();
}

function _clear(aba, linha, chaveCol) {
  if (!IDX[chaveCol]) return;

  aba.getRange(linha, IDX[chaveCol]).clearContent();
}

/* ============================================================================================ */
/*  GATILHO — DP responde na planilha                                                            */
/* ============================================================================================ */

function aoEditarDP(e) {
  return; // [DESATIVADO 30/09/2026] gatilho de edição não faz mais nada
  try {
    if (!e || !e.range) return;

    const aba = e.range.getSheet();

    if (aba.getName() !== CONFIG.ABA_DADOS) return;

    const colunaEditada = e.range.getColumn();

    const editouAprovacao = colunaEditada === IDX.APROVADO_DP;
    const editouMotivo = colunaEditada === IDX.MOTIVO_RECUSA;

    if (!editouAprovacao && !editouMotivo) return;

    let linha = e.range.getRow();

    if (linha < CONFIG.PRIMEIRA_LINHA_DADOS) return;

    const valor = String(aba.getRange(linha, IDX.APROVADO_DP).getValue() || '').toLowerCase().trim();

    const aprovado = CONFIG.APROVADO.indexOf(valor) > -1;
    const recusado = CONFIG.RECUSADO.indexOf(valor) > -1;

    if (!aprovado && !recusado) return;

    const motivo = IDX.MOTIVO_RECUSA
      ? String(aba.getRange(linha, IDX.MOTIVO_RECUSA).getValue() || '').trim()
      : '';

    if (recusado && !motivo) {
      return;
    }

    if (aprovado && !editouAprovacao) {
      return;
    }

    _set(aba, linha, 'DATA_APROVACAO_DP', hojeSP());

    const nome = aba.getRange(linha, IDX.NOME).getValue();
    const emailGestor = String(aba.getRange(linha, IDX.EMAIL_GESTOR).getValue() || '').trim();
    const inicio = aba.getRange(linha, IDX.DATA_INICIO).getValue();
    const fim = aba.getRange(linha, IDX.DATA_FIM).getValue();
    const dias = Number(aba.getRange(linha, IDX.DIAS_GOZADOS).getValue()) || 0;

    const emailColab = IDX.EMAIL_COLABORADOR
      ? String(aba.getRange(linha, IDX.EMAIL_COLABORADOR).getValue() || '').trim()
      : '';

    if (aprovado) {
      if (emailGestor) {
        _emailGestorDeferido_(emailGestor, nome, dias, inicio, fim);
      }

      if (emailColab) {
        _emailColaboradorAgendado_(emailColab, nome, dias, inicio, fim);
      }

      return;
    }

    if (recusado) {
      if (emailGestor) {
        _emailGestorIndeferido_(emailGestor, nome, dias, inicio, fim, motivo);
      }

      _arquivarRecusada_(aba, linha);
      _reiniciarLinhaIndeferida_(aba, linha);
    }

  } catch (err) {
    console.error('aoEditarDP: ' + err);
  }
}

/* ============================================================================================ */
/*  ARQUIVO DE RECUSADAS / RESTAURAÇÃO DE SALDO                                                  */
/* ============================================================================================ */

function _normHeader_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _mapaCabecalho_(cabecalho) {
  const mapa = {};

  cabecalho.forEach((h, i) => {
    mapa[_normHeader_(h)] = i;
  });

  return mapa;
}

function _valorPorCabecalho_(row, mapa, nomeCabecalho) {
  const idx = mapa[_normHeader_(nomeCabecalho)];

  return idx === undefined ? '' : row[idx];
}

function _numPorCabecalho_(row, mapa, nomeCabecalho) {
  const v = _valorPorCabecalho_(row, mapa, nomeCabecalho);

  return Number(v) || 0;
}

function _abaRecusadas_() {
  const ss = _ss();

  let aba = ss.getSheetByName(CONFIG.ABA_RECUSADAS);

  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_RECUSADAS);
  }

  const headers = CONFIG.CABECALHO_RECUSADAS;

  if (aba.getMaxColumns() < headers.length) {
    aba.insertColumnsAfter(
      aba.getMaxColumns(),
      headers.length - aba.getMaxColumns()
    );
  }

  aba.getRange(1, 1, 1, headers.length).setValues([headers]);
  aba.setFrozenRows(1);

  return aba;
}

function _arquivarRecusada_(abaOrigem, linha) {
  const abaArquivo = _abaRecusadas_();

  const cabOrigem = abaOrigem
    .getRange(1, 1, 1, abaOrigem.getLastColumn())
    .getValues()[0];

  const rowOrigem = abaOrigem
    .getRange(linha, 1, 1, abaOrigem.getLastColumn())
    .getValues()[0];

  const mapa = _mapaCabecalho_(cabOrigem);

  const registro = CONFIG.CABECALHO_RECUSADAS.map(h => {
    const hNorm = _normHeader_(h);

    if (hNorm === _normHeader_('Data Arquivamento')) {
      return new Date();
    }

    if (hNorm === _normHeader_('Aprovado DP')) {
      const valor = _valorPorCabecalho_(rowOrigem, mapa, h);
      const v = String(valor || '').toLowerCase().trim();

      if (CONFIG.RECUSADO.indexOf(v) > -1) return 'Indeferido';
      if (CONFIG.APROVADO.indexOf(v) > -1) return 'Deferido';

      return valor;
    }

    return _valorPorCabecalho_(rowOrigem, mapa, h);
  });

  abaArquivo.appendRow(registro);
}

function _lerMetaPortal_(texto) {
  const s = String(texto || '');
  const m = s.match(/__PORTAL_META__([\s\S]*?)__FIM_META__/);

  if (!m) return {};

  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return {};
  }
}

function _extrairSplitIdAntigo_(texto) {
  const s = String(texto || '');
  const m = s.match(/ID\s+([0-9a-fA-F-]{20,})/);

  return m ? m[1] : '';
}

function _linhaSplitPodeSerReabsorvida_(aba, linhaSplit) {
  const inicio = _get(aba, linhaSplit, 'DATA_INICIO');
  const fim = _get(aba, linhaSplit, 'DATA_FIM');
  const solicitado = _get(aba, linhaSplit, 'SOLICITADO_GESTOR');
  const decisao = _get(aba, linhaSplit, 'APROVADO_DP');

  return !inicio && !fim && !solicitado && !decisao;
}

function _reiniciarLinhaIndeferida_(aba, linhaOriginal) {
  let linha = linhaOriginal;

  const obs = _get(aba, linha, 'OBSERVACAO');
  const meta = _lerMetaPortal_(obs);

  const diasPedido =
    Number(_get(aba, linha, 'DIAS_GOZADOS')) ||
    Number(_get(aba, linha, 'DIAS_A_GOZAR')) ||
    0;

  const splitId = meta.splitId || _extrairSplitIdAntigo_(obs);

  let saldoSplit = 0;
  let splitReabsorvido = false;

  if (splitId) {
    const linhaSplit = _acharLinhaPorId_(aba, splitId);

    if (linhaSplit && linhaSplit !== linha) {
      if (_linhaSplitPodeSerReabsorvida_(aba, linhaSplit)) {
        saldoSplit = Number(_get(aba, linhaSplit, 'DIAS_A_GOZAR')) || 0;

        aba.deleteRow(linhaSplit);

        splitReabsorvido = true;

        if (linhaSplit < linha) {
          linha--;
        }
      }
    }
  }

  let saldoRestaurado;

  if (splitId && !splitReabsorvido) {
    saldoRestaurado = diasPedido;
  } else if (meta.saldoAnterior !== undefined && meta.saldoAnterior !== '') {
    saldoRestaurado = Number(meta.saldoAnterior) || diasPedido + saldoSplit;
  } else {
    saldoRestaurado = diasPedido + saldoSplit;
  }

  const temDiasGozadosAnterior = Object.prototype.hasOwnProperty.call(meta, 'diasGozadosAnterior');

  _clear(aba, linha, 'DATA_INICIO');
  _clear(aba, linha, 'DATA_FIM');
  _clear(aba, linha, 'SOLICITADO_GESTOR');
  _clear(aba, linha, 'APROVADO_DP');
  _clear(aba, linha, 'DATA_APROVACAO_DP');
  _clear(aba, linha, 'MOTIVO_RECUSA');

  _set(aba, linha, 'DIAS_A_GOZAR', saldoRestaurado);
  _set(aba, linha, 'DIAS_GOZADOS', temDiasGozadosAnterior ? meta.diasGozadosAnterior : '');

  _set(
    aba,
    linha,
    'OBSERVACAO',
    'Solicitação indeferida em ' +
      Utilities.formatDate(new Date(), CONFIG.FUSO, 'dd/MM/yyyy HH:mm') +
      ' e arquivada na aba "' + CONFIG.ABA_RECUSADAS + '". Saldo restaurado para ' +
      saldoRestaurado + ' dia(s).'
  );

  SpreadsheetApp.flush();
}

function _getHistoricoRecusadasGestor_(emailGestorLogado) {
  const ss = _ss();
  const aba = ss.getSheetByName(CONFIG.ABA_RECUSADAS);

  if (!aba) return [];

  const ultLin = aba.getLastRow();
  const ultCol = aba.getLastColumn();

  if (ultLin < 2) return [];

  const cab = aba.getRange(1, 1, 1, ultCol).getValues()[0];
  const mapa = _mapaCabecalho_(cab);

  const dados = aba.getRange(2, 1, ultLin - 1, ultCol).getValues();

  const hist = [];

  dados.forEach((row, i) => {
    const emailGestor = String(_valorPorCabecalho_(row, mapa, 'Email gestor') || '').toLowerCase().trim();

    if (emailGestor !== emailGestorLogado) return;

    const inicio = _valorPorCabecalho_(row, mapa, 'Agendamento Inicio');
    const fim = _valorPorCabecalho_(row, mapa, 'Agendamento Fim');

    const dias =
      _numPorCabecalho_(row, mapa, 'Quantidade de dias de férias') ||
      _numPorCabecalho_(row, mapa, 'Dias gozados') ||
      _numPorCabecalho_(row, mapa, 'Dias a serem gozados');

    hist.push({
      origem: 'arquivo',
      id: 'recusada-' + (i + 2),
      linha: i + 2,
      nome: _valorPorCabecalho_(row, mapa, 'Nome') || '(sem nome)',
      gestao: _valorPorCabecalho_(row, mapa, 'Gestão') || '',
      periodo: String(_valorPorCabecalho_(row, mapa, 'Período aquisitivo') || ''),
      diasAGozar: dias || 0,
      diasGozados: dias || 0,
      concederAte: fmtBR(_valorPorCabecalho_(row, mapa, 'Conceder até')),
      concederAteISO: '',
      dataInicio: inicio ? fmtBR(inicio) : '',
      dataFim: fim ? fmtBR(fim) : '',
      motivoRecusa: String(_valorPorCabecalho_(row, mapa, 'Motivo Recusa') || ''),
      dataArquivamento: fmtBR(_valorPorCabecalho_(row, mapa, 'Data Arquivamento')),
      status: { chave: 'indeferido', rotulo: 'Indeferida' }
    });
  });

  return hist;
}

/* ============================================================================================ */
/*  E-MAILS                                                                                      */
/* ============================================================================================ */

function _wrap(titulo, corpo) {
  const m = CONFIG.MARCA;

  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:14px;overflow:hidden">'
    + '<div style="background:' + m.corPrimaria + ';padding:20px 24px">'
    +   '<img src="' + m.logo + '" alt="CIEDS" height="34" style="height:34px">'
    + '</div>'
    + '<div style="padding:24px">'
    +   '<h2 style="margin:0 0 12px;color:' + m.corPrimaria + ';font-size:19px">' + titulo + '</h2>'
    +   corpo
    +   '<p style="margin-top:28px;color:#8a8a8a;font-size:12px">Mensagem automática do Portal de Férias · Departamento Pessoal · CIEDS</p>'
    + '</div></div>';
}

function _cardFerias(nome, dias, inicio, fim) {
  return '<table style="width:100%;border-collapse:collapse;background:#f6f9fa;border-radius:10px;margin:8px 0">'
    + _linha('Colaborador(a)', nome)
    + _linha('Período', fmtBR(inicio) + ' a ' + fmtBR(fim))
    + _linha('Dias', dias + ' dia(s)')
    + '</table>';
}

function _linha(k, v) {
  return '<tr><td style="padding:8px 14px;color:#666;font-size:13px">' + k + '</td>'
    + '<td style="padding:8px 14px;font-weight:bold;font-size:13px">' + v + '</td></tr>';
}

function _emailGestorRecebido_(emailGestor, nome, dias, inicio, fim) {
  const corpo = '<p>Recebemos sua solicitação de férias e ela foi encaminhada ao Departamento Pessoal.</p>'
    + _cardFerias(nome, dias, inicio, fim)
    + '<p>O DP tem até <b>' + CONFIG.PRAZO_RESPOSTA_DP_DIAS + ' dias</b> para responder com o deferimento ou indeferimento. '
    + 'Você será avisado(a) por e-mail assim que houver retorno.</p>';

  MailApp.sendEmail({
    to: emailGestor,
    subject: '✅ Solicitação de férias recebida — ' + nome,
    htmlBody: _wrap('Solicitação recebida', corpo)
  });
}

function _emailDPNovaSolicitacao_(emailGestor, nome, dias, inicio, fim, linha) {
  const link = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit';

  const corpo = '<p>Uma nova solicitação de férias precisa de aprovação.</p>'
    + _cardFerias(nome, dias, inicio, fim)
    + '<p><b>Solicitado por:</b> ' + emailGestor + '<br><b>Linha na planilha:</b> ' + linha + '</p>'
    + '<p>Para responder, preencha a coluna <b>Aprovado DP</b> com <b>Deferido</b> ou <b>Indeferido</b>. '
    + 'Em caso de indeferimento, preencha também a coluna <b>Motivo Recusa</b>.</p>'
    + '<p><b>Importante:</b> o e-mail ao gestor só será enviado quando o motivo do indeferimento estiver preenchido.</p>'
    + '<p><a href="' + link + '" style="background:' + CONFIG.MARCA.corAcento + ';color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Abrir planilha</a></p>';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_DP,
    subject: '🟡 Nova solicitação de férias — ' + nome + ' (aprovação pendente)',
    htmlBody: _wrap('Nova solicitação de férias', corpo)
  });
}

function _emailGestorDeferido_(emailGestor, nome, dias, inicio, fim) {
  const corpo = '<p>Boa notícia! A solicitação de férias abaixo foi <b style="color:#1a8a4b">DEFERIDA</b> pelo DP.</p>'
    + _cardFerias(nome, dias, inicio, fim)
    + '<p>O(a) colaborador(a) já foi avisado(a) sobre o agendamento, o pagamento e o recibo.</p>';

  MailApp.sendEmail({
    to: emailGestor,
    subject: '🟢 Férias deferidas — ' + nome,
    htmlBody: _wrap('Férias deferidas', corpo)
  });
}

function _emailGestorIndeferido_(emailGestor, nome, dias, inicio, fim, motivo) {
  const corpo = '<p>A solicitação de férias abaixo foi <b style="color:#c0392b">INDEFERIDA</b> pelo DP.</p>'
    + _cardFerias(nome, dias, inicio, fim)
    + '<p style="background:#fdecea;border-radius:8px;padding:12px 14px"><b>Motivo do indeferimento:</b> '
    + (motivo || '(não informado)') + '</p>'
    + '<p>A linha foi reiniciada no portal, e o saldo voltou a ficar disponível para novo agendamento.</p>';

  MailApp.sendEmail({
    to: emailGestor,
    subject: '🔴 Férias indeferidas — ' + nome,
    htmlBody: _wrap('Solicitação indeferida', corpo)
  });
}

function _emailColaboradorAgendado_(emailColab, nome, dias, inicio, fim) {
  const dataPagto = subtrairDiasUteis(inicio, CONFIG.DIAS_UTEIS_PAGAMENTO_ANTES);
  const dataRecibo = subtrairDias(inicio, CONFIG.DIAS_RECIBO_ANTES);

  const corpo = '<p>Olá, ' + nome + '! Suas férias foram <b>agendadas e deferidas</b>. 🎉</p>'
    + _cardFerias(nome, dias, inicio, fim)
    + '<ul style="font-size:14px;line-height:1.7">'
    +   '<li>💰 O <b>pagamento</b> das férias cai na sua conta em até <b>2 dias úteis antes</b> do início — previsto para <b>' + fmtBR(dataPagto) + '</b>.</li>'
    +   '<li>✍️ Você receberá o <b>recibo de férias</b> pela plataforma <b>Autentique</b> para assinatura até <b>5 dias antes</b> do início — por volta de <b>' + fmtBR(dataRecibo) + '</b>.</li>'
    + '</ul>'
    + '<p>Bom descanso!</p>';

  MailApp.sendEmail({
    to: emailColab,
    subject: '🌴 Suas férias foram agendadas — início em ' + fmtBR(inicio),
    htmlBody: _wrap('Férias agendadas', corpo)
  });
}


function testarPortalSenhasSemEnviarEmail() {
  const salt = 'salt-teste';
  const senha = 'Teste1234';
  const h1 = _hashSeguro_(senha, salt);
  const h2 = _hashSeguro_(senha, salt);
  const h3 = _hashSeguro_('Outra1234', salt);

  if (!_compararSeguro_(h1, h2)) throw new Error('Falha no hash: hashes iguais não conferem.');
  if (_compararSeguro_(h1, h3)) throw new Error('Falha no hash: hashes diferentes conferiram.');

  const email = CONFIG.DOMINIOS_PERMITIDOS.length
    ? 'teste@' + CONFIG.DOMINIOS_PERMITIDOS[0]
    : 'teste@cieds.org.br';

  const token = _criarToken_(email);
  const emailToken = _emailPorToken_(token);

  if (emailToken !== email) throw new Error('Falha no token de sessão.');

  const f2026 = _feriadosNacionais_(2026);
  if (f2026['2026-01-01'] !== 'Confraternização Universal') throw new Error('Falha em feriado fixo.');
  if (!f2026['2026-04-03']) throw new Error('Falha no cálculo da Sexta-feira Santa de 2026.');

  return 'OK — hash, token e feriados validados.';
}

/* ============================================================================================ */
/*  UTILITÁRIOS DE INSTALAÇÃO                                                                    */
/* ============================================================================================ */

function criarGatilhos() {
  // Versão sem ScriptApp.getProjectTriggers(), porque em alguns ambientes do Apps Script
  // esse método falha com "erro desconhecido" mesmo quando a permissão está correta.
  // Para evitar gatilho duplicado, marcamos a criação em ScriptProperties.
  const props = PropertiesService.getScriptProperties();
  const marcador = 'TRIGGER_AO_EDITAR_DP_CRIADO';

  if (props.getProperty(marcador) === 'SIM') {
    const msg = 'Gatilho aoEditarDP já marcado como criado. Se precisar recriar, apague a propriedade "' + marcador + '" em Project Settings > Script Properties ou crie manualmente pela tela de Acionadores.';
    console.log(msg);
    return msg;
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

    ScriptApp.newTrigger('aoEditarDP')
      .forSpreadsheet(ss)
      .onEdit()
      .create();

    props.setProperty(marcador, 'SIM');

    const msg = 'OK — gatilho aoEditarDP criado com sucesso.';
    console.log(msg);
    return msg;

  } catch (err) {
    const msg =
      'Não consegui criar o gatilho por código. Isso costuma ser falha/limitação do ScriptApp no Apps Script. ' +
      'Crie manualmente: Acionadores > Adicionar acionador > função aoEditarDP > Origem: Planilha > Evento: Ao editar. ' +
      'Erro original: ' + (err && err.message ? err.message : err);

    console.error(msg);
    throw new Error(msg);
  }
}

function testarConfiguracao() {
  const aba = _aba();
  const cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];

  const linhas = Object.keys(CONFIG.COL).map(k => {
    const letra = CONFIG.COL[k];
    const idx = colToIndex(letra);
    const titulo = idx ? (cab[idx - 1] || '(vazio)') : '— não configurada —';

    return k.padEnd(20) + ' → col ' + (letra || '(vazio)').padEnd(4) + ' → cabeçalho: "' + titulo + '"';
  });

  console.log('Aba: ' + CONFIG.ABA_DADOS + '\n\n' + linhas.join('\n'));
}