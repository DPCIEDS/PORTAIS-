/*************************************************************************************************
 * MÓDULO AFASTAMENTOS · DP360 — arquivo AFASTAMENTOS.gs  (v1.1.0 — inclui FATIA 2)
 * -----------------------------------------------------------------------------------------------
 * FATIA 1: o gestor lança o afastamento, anexa o atestado, e o sistema:
 *   - guarda o atestado no Drive do DP, vinculado ao funcionário
 *   - registra na planilha DP360_AFASTAMENTOS (com link do documento)
 *   - se o atestado for > 15 dias, envia ao gestor + funcionário o informativo do INSS + DUT
 *
 * FATIA 2 (esta versão) — o que acontece depois do atestado inicial, tudo pelo Portal do DP:
 *   • REGISTRAR_AGENDAMENTO_PERICIA → guarda a data e o comprovante de agendamento da perícia
 *     (o colaborador manda por e-mail; o DP só registra no sistema).
 *   • REGISTRAR_DECISAO   → o DP registra o Comunicado de Decisão do INSS: DEFERIDO, INDEFERIDO
 *                           ou PRORROGADO. Se PRORROGADO, encaminha para PRORROGAR.
 *   • PRORROGAR           → cria uma NOVA ocorrência ligada à original (append-only — nada é
 *                           sobrescrito), com o novo atestado, recalculando o encaminhamento ao
 *                           INSS se for o caso.
 *   • EXAME_OCUPACIONAL   → registra o exame ocupacional de retorno (obrigatório, NR-7): data,
 *                           resultado (APTO/INAPTO) e o atestado do exame.
 *   • RETORNAR            → registra a volta ao trabalho, soma os dias totais afastados (incluindo
 *                           prorrogações) e encerra a ocorrência. Se acidente de trabalho, calcula
 *                           e grava a ESTABILIDADE_ATE (12 meses da Lei 8.213/91 art. 118) — pronta
 *                           para a Rescisão consultar antes de uma dispensa sem justa causa.
 *
 * SEM AUTENTIQUE nesta fatia: o colaborador não assina nada no processo de afastamento.
 *
 * O que NÃO está nesta fatia (não pedido até agora): fluxos por tipo mais detalhados, conciliação
 * com a folha (benefício-doença, INSS x empresa).
 *
 * Plugar no kernel: descomente a linha de AFASTAMENTOS em _modulosDisponiveis_() (no Codigo.gs).
 *************************************************************************************************/

const AFAST = {
  VERSAO: '1.0.0',

  SHEET_ID: '1zYYtJG8RyOcrPZiEkDNZtXWr0AZKrkgS3DuaV9zukO0',

  ABAS: {
    OCORRENCIAS: 'OCORRENCIAS',   // fatia 1 grava aqui (append-only, uma linha por afastamento)
    TIPOS: 'TIPOS'                // regras por tipo (já existe da migração)
  },

  // Pasta raiz no Drive do DP onde os documentos ficam. Configurável em PARAMETROS.
  // Dentro dela, o sistema cria uma subpasta por funcionário.
  DRIVE_PASTA_PARAM: 'AFAST_DRIVE_PASTA_ID',

  DIAS_RESPONSABILIDADE_EMPRESA: 15,   // acima disso, encaminha ao INSS

  // Lei 8.213/91, art. 118: estabilidade de 12 meses após o fim do auxílio-doença acidentário.
  ESTABILIDADE_ACIDENTARIA_MESES: 12,

  // Acidente de trabalho: e-mail do técnico de segurança (configurável em PARAMETROS)
  TECNICO_SEGURANCA_PARAM: 'AFAST_TECNICO_SEGURANCA_EMAIL',

  // URL do Guia de Afastamento (mini web app). Fixa aqui para não depender da planilha.
  GUIA_URL: 'https://script.google.com/macros/s/AKfycbw-ZasxwAkkqtwDYxeh6czxB3u6Ag9p3LM4jd1301l5QcMz99V39aDbKhhZlmKsxyZyvA/exec',

  COLUNAS_OCORRENCIAS: [
    'ID_OCORRENCIA', 'ID_COLABORADOR', 'MATRICULA', 'NOME', 'EMPRESA_COD', 'EMPRESA',
    'DEPARTAMENTO', 'GESTOR_EMAIL',
    'TIPO_COD', 'TIPO', 'CID',
    'DATA_INICIO', 'DIAS', 'DATA_FIM_PREVISTA', 'ULTIMO_DIA_TRABALHADO',
    'ENCAMINHA_INSS', 'STATUS',
    'ATESTADO_LINK', 'DUT_ENVIADO', 'INFORMATIVO_ENVIADO',
    'ACIDENTE_TRABALHO', 'RAT_LINK', 'CAT_SOLICITADA', 'RAT_DADOS_JSON',
    'LANCADO_POR', 'LANCADO_EM', 'OBSERVACAO',
    // ---- FATIA 2 ----
    'PERICIA_AGENDADA_EM', 'PERICIA_COMPROVANTE_LINK',
    'DECISAO_RESULTADO', 'DECISAO_DOC_LINK', 'DECISAO_REGISTRADA_POR', 'DECISAO_REGISTRADA_EM',
    'PRORROGACAO_DE',
    'EXAME_OCUPACIONAL_DATA', 'EXAME_OCUPACIONAL_RESULTADO', 'EXAME_OCUPACIONAL_DOC_LINK',
    'DATA_RETORNO', 'DIAS_TOTAIS_AFASTADO', 'ESTABILIDADE_ATE',
    'RETORNO_REGISTRADO_POR', 'RETORNO_REGISTRADO_EM'
  ]
};

/* ============================================================================================ */
/*  ROTEADOR DO MÓDULO                                                                           */
/* ============================================================================================ */

function afastExecutar(acao, p, user) {
  switch (acao) {
    case 'AFASTAMENTOS.CONTEXTO': return afastContexto(user, p);
    case 'AFASTAMENTOS.RESUMO':   return afastResumo(user, p);
    case 'AFASTAMENTOS.LANCAR':   return afastLancar(user, p);
    case 'AFASTAMENTOS.TIPOS':    return { ok: true, tipos: _afastTipos_() };

    // DP — FATIA 2
    case 'AFASTAMENTOS.FILA':                        return afastFila(user, p);
    case 'AFASTAMENTOS.REGISTRAR_AGENDAMENTO_PERICIA': return afastRegistrarAgendamentoPericia(user, p);
    case 'AFASTAMENTOS.REGISTRAR_DECISAO':            return afastRegistrarDecisao(user, p);
    case 'AFASTAMENTOS.PRORROGAR':                    return afastProrrogar(user, p);
    case 'AFASTAMENTOS.EXAME_OCUPACIONAL':            return afastExameOcupacional(user, p);
    case 'AFASTAMENTOS.RETORNAR':                     return afastRetornar(user, p);

    default:
      throw new Error('Ação de afastamentos desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  INFRA                                                                                        */
/* ============================================================================================ */

function _ssAfast_() { return SpreadsheetApp.openById(AFAST.SHEET_ID); }

function _shAfast_(nome) {
  const sh = _ssAfast_().getSheetByName(nome);
  if (!sh) throw new Error('Aba não encontrada em DP360_AFASTAMENTOS: ' + nome);
  return sh;
}

/** Cria a aba OCORRENCIAS se ainda não existir. Rode garantirAbaOcorrencias() uma vez. */
function garantirAbaOcorrencias() {
  const ss = _ssAfast_();
  let sh = ss.getSheetByName(AFAST.ABAS.OCORRENCIAS);

  if (!sh) {
    sh = ss.insertSheet(AFAST.ABAS.OCORRENCIAS);
    sh.getRange(1, 1, 1, AFAST.COLUNAS_OCORRENCIAS.length).setValues([AFAST.COLUNAS_OCORRENCIAS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, AFAST.COLUNAS_OCORRENCIAS.length).setFontWeight('bold');
    return 'Aba OCORRENCIAS criada.';
  }

  // garante que todas as colunas existem (acrescenta ao fim, nunca desloca)
  const h = _headers_(sh);
  const faltando = AFAST.COLUNAS_OCORRENCIAS.filter(c => h.indexOf(c) === -1);

  if (faltando.length) {
    let col = sh.getLastColumn();
    faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));
    return 'Colunas acrescentadas: ' + faltando.join(', ');
  }

  return 'Aba OCORRENCIAS já está pronta.';
}

function _afastTipos_() {
  const sh = _ssAfast_().getSheetByName(AFAST.ABAS.TIPOS);
  if (!sh) return [];

  return _sheetToObjects_(sh).map(t => ({
    cod: String(t.TIPO_COD || '').trim(),
    nome: t.TIPO,
    efeito: t.EFEITO_PERIODO,
    contaTempo: t.CONTA_TEMPO_SERVICO
  }));
}

function _afastParam_(chave, padrao) {
  // parâmetros do módulo ficam na aba PARAMETROS da DP360_FERIAS (fonte única de config)
  try {
    return _feriasParam_(chave, padrao);
  } catch (e) {
    return padrao;
  }
}

/* ============================================================================================ */
/*  ESCOPO — o gestor só enxerga e lança para a própria equipe                                   */
/* ============================================================================================ */

function _afastEquipe_(user) {
  // reaproveita a mesma fonte de verdade do módulo de férias
  return _equipeDoGestor_(user.EMAIL);
}

function _afastColaborador_(user, idColaborador, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');

  // Lançar pelo Portal do Gestor (visão GESTOR) sempre exige que a pessoa seja da equipe,
  // mesmo para ADMIN/DP. Só a visão global explícita libera qualquer colaborador.
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && v === 'GLOBAL';

  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(idColaborador));
  if (!c) throw new Error('Colaborador não encontrado.');

  if (!ehGlobal) {
    const equipe = _afastEquipe_(user);
    if (equipe.indexOf(String(idColaborador)) === -1) {
      throw new Error('Este colaborador não está na sua equipe.');
    }
  }

  return c;
}

/* ============================================================================================ */
/*  CONTEXTO / RESUMO                                                                            */
/* ============================================================================================ */

function afastContexto(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');

  // A visão pedida manda: o Portal do Gestor sempre pede 'GESTOR' e vê só a própria equipe,
  // mesmo que a pessoa seja ADMIN/DP. Só a visão global (Portal do DP) enxerga todos.
  const visao = String((p && p.visao) || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && visao === 'GLOBAL';

  const equipe = ehGlobal ? null : _afastEquipe_(user);
  const colaboradores = _colaboradores_();

  // lista para o gestor escolher quem afastar (só a equipe dele, salvo visão global do DP)
  const time = colaboradores
    .filter(c => ehGlobal || equipe.indexOf(String(c.ID_COLABORADOR)) > -1)
    .map(c => ({
      idColaborador: c.ID_COLABORADOR,
      nome: c.NOME,
      matricula: c.MATRICULA,
      departamento: c.DEPARTAMENTO_ATUAL || ''
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  // ocorrências já lançadas (respeitando a mesma visão)
  const ocorrencias = _ocorrenciasVisiveis_(user, visao).map(o => ({
    id: o.ID_OCORRENCIA,
    nome: o.NOME,
    tipo: o.TIPO,
    inicio: _isoF_(o.DATA_INICIO),
    dias: Number(o.DIAS || 0),
    fim: _isoF_(o.DATA_FIM_PREVISTA),
    status: o.STATUS,
    encaminhaINSS: _sim_(o.ENCAMINHA_INSS),
    atestadoLink: o.ATESTADO_LINK || ''
  })).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));

  return {
    ok: true,
    modulo: 'AFASTAMENTOS',
    versao: AFAST.VERSAO,
    visao: visao,
    equipe: time,
    ocorrencias: ocorrencias,
    tipos: _afastTipos_(),
    guiaUrl: AFAST.GUIA_URL,
    diasResponsabilidadeEmpresa: AFAST.DIAS_RESPONSABILIDADE_EMPRESA
  };
}

function afastResumo(user, p) {
  return afastResumoDe(afastContexto(user, p));
}

function afastResumoDe(ctx) {
  const emAndamento = ctx.ocorrencias.filter(o => o.status !== 'ENCERRADO');

  return {
    modulo: 'AFASTAMENTOS',
    nome: 'Afastamentos',
    icone: '🩺',
    contadores: {
      equipe: ctx.equipe.length,
      afastadosAtivos: emAndamento.length,
      encaminhadosINSS: emAndamento.filter(o => o.encaminhaINSS).length
    },
    precisaDeVoce: [],
    emAndamento: emAndamento.slice(0, 8).map(o => ({
      nome: o.nome,
      inicio: o.inicio,
      fim: o.fim,
      dias: o.dias,
      abono: 0
    }))
  };
}

function _ocorrenciasVisiveis_(user, visao) {
  const sh = _ssAfast_().getSheetByName(AFAST.ABAS.OCORRENCIAS);
  if (!sh) return [];

  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();

  const todas = _sheetToObjects_(sh);
  if (podeGlobal && v === 'GLOBAL') return todas;

  // Visão de gestor: só a equipe
  const equipe = _afastEquipe_(user);
  return todas.filter(o => equipe.indexOf(String(o.ID_COLABORADOR)) > -1);
}

/* ============================================================================================ */
/*  LANÇAR AFASTAMENTO — o coração da fatia 1                                                    */
/* ============================================================================================ */

/**
 * payload:
 *   idColaborador, tipoCod, cid (opcional),
 *   dataInicio (yyyy-mm-dd), dias,
 *   atestadoBase64, atestadoNome, atestadoTipo   (o arquivo do atestado)
 */
function afastLancar(user, p) {
  const c = _afastColaborador_(user, p.idColaborador, p.visao);

  const dias = Math.floor(Number(p.dias || 0));
  if (dias < 1) throw new Error('Informe a quantidade de dias do atestado.');

  const inicio = _dataF_(p.dataInicio);
  if (!inicio) throw new Error('Informe a data de início do afastamento.');

  const tipoCod = String(p.tipoCod || '01').trim();
  const tipo = _afastTipos_().find(t => t.cod === tipoCod) || { nome: 'Afastamento', efeito: 'CONFERIR' };

  const fim = _addDiasF_(inicio, dias - 1);
  const ultimoDiaTrabalhado = _addDiasF_(inicio, -1);
  const encaminhaINSS = dias > AFAST.DIAS_RESPONSABILIDADE_EMPRESA;

  // Acidente de trabalho: o gestor marca ao lançar e informa os dados do acidente.
  const ehAcidente = _sim_(p.acidenteTrabalho);
  const rat = ehAcidente ? (p.rat || {}) : null;

  // 1) guarda o atestado no Drive
  let atestadoLink = '';
  if (p.atestadoBase64) {
    atestadoLink = _salvarDocumento_(
      c, 'atestado',
      p.atestadoBase64, p.atestadoNome || 'atestado.pdf', p.atestadoTipo || 'application/pdf',
      inicio
    );
  }

  // 2) registra a ocorrência
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let idOcorrencia;

  try {
    const sh = _shAfast_(AFAST.ABAS.OCORRENCIAS);
    const h = _headers_(sh);
    idOcorrencia = 'AFA-' + _uuid_().slice(0, 8).toUpperCase();

    const linha = h.map(col => {
      switch (col) {
        case 'ID_OCORRENCIA': return idOcorrencia;
        case 'ID_COLABORADOR': return c.ID_COLABORADOR;
        case 'MATRICULA': return c.MATRICULA || '';
        case 'NOME': return c.NOME || '';
        case 'EMPRESA_COD': return c.EMPRESA_COD || '';
        case 'EMPRESA': return c.EMPRESA || '';
        case 'DEPARTAMENTO': return c.DEPARTAMENTO_ATUAL || '';
        case 'GESTOR_EMAIL': return c.GESTOR_EMAIL || '';
        case 'TIPO_COD': return tipoCod;
        case 'TIPO': return tipo.nome;
        case 'CID': return String(p.cid || '');
        case 'DATA_INICIO': return inicio;
        case 'DIAS': return dias;
        case 'DATA_FIM_PREVISTA': return fim;
        case 'ULTIMO_DIA_TRABALHADO': return ultimoDiaTrabalhado;
        case 'ENCAMINHA_INSS': return encaminhaINSS ? 'Sim' : 'Não';
        case 'STATUS': return encaminhaINSS ? 'ENCAMINHADO_INSS' : 'EM_ATESTADO';
        case 'ATESTADO_LINK': return atestadoLink;
        case 'DUT_ENVIADO': return 'Não';
        case 'INFORMATIVO_ENVIADO': return 'Não';
        case 'ACIDENTE_TRABALHO': return ehAcidente ? 'Sim' : 'Não';
        case 'RAT_LINK': return '';
        case 'CAT_SOLICITADA': return ehAcidente ? 'Não' : '';
        case 'RAT_DADOS_JSON': return rat ? JSON.stringify(rat) : '';
        case 'LANCADO_POR': return _normalizarEmail_(user.EMAIL);
        case 'LANCADO_EM': return new Date();
        default: return '';
      }
    });

    sh.appendRow(linha);

  } finally {
    lock.releaseLock();
  }

  _auditar_('AFAST_LANCADO', user.EMAIL, 'AFASTAMENTOS.LANCAR', true,
    c.NOME + ': ' + tipo.nome + ', ' + dias + ' dias desde ' + _fmtBRF_(inicio) +
    (encaminhaINSS ? ' (encaminha INSS)' : ''),
    { id: idOcorrencia, dias: dias, inss: encaminhaINSS });

  // 3) se passar de 15 dias, manda o informativo + DUT
  let emailEnviado = false;

  if (encaminhaINSS) {
    emailEnviado = _enviarInformativoINSS_(c, inicio, ultimoDiaTrabalhado, dias, idOcorrencia, user.EMAIL);
  }

  // 4) acidente de trabalho: gera o RAT preenchido e envia ao técnico de segurança
  let ratEnviado = false;

  if (ehAcidente) {
    ratEnviado = _processarAcidenteTrabalho_(c, inicio, ultimoDiaTrabalhado, dias, rat, idOcorrencia, user.EMAIL);
  }

  return {
    ok: true,
    id: idOcorrencia,
    encaminhaINSS: encaminhaINSS,
    acidenteTrabalho: ehAcidente,
    ratEnviado: ratEnviado,
    ultimoDiaTrabalhado: _fmtBRF_(ultimoDiaTrabalhado),
    emailEnviado: emailEnviado,
    mensagem: ehAcidente
      ? 'Acidente de trabalho registrado. O técnico de segurança recebeu o RAT preenchido para emitir a CAT' +
        (ratEnviado ? '.' : ' (verifique se o e-mail do técnico está configurado).') +
        (encaminhaINSS ? ' Como passa de 15 dias, o colaborador também recebeu as orientações do INSS.' : '')
      : (encaminhaINSS
          ? 'Afastamento registrado. Como passa de 15 dias, ' + c.NOME.split(' ')[0] +
            ' e você receberam por e-mail as orientações do INSS e o DUT.'
          : 'Afastamento registrado. Dentro dos 15 dias de responsabilidade da empresa.')
  };
}

/* ============================================================================================ */
/*  ACIDENTE DE TRABALHO — RAT preenchido + e-mail ao técnico de segurança                       */
/* ============================================================================================ */

/**
 * Gera o RAT (Relatório de Acidente do Trabalho) preenchido com os dados que o gestor
 * informou + os dados do colaborador, salva no Drive e envia ao técnico de segurança
 * (com gestor e DP em cópia) para emissão da CAT.
 */
function _processarAcidenteTrabalho_(colaborador, inicio, ultimoDia, dias, rat, idOcorrencia, lancadoPor) {
  const tecnico = _afastParam_(AFAST.TECNICO_SEGURANCA_PARAM, '');

  // 1) monta o RAT preenchido como documento e salva no Drive
  let ratLink = '';
  try {
    ratLink = _gerarRAT_(colaborador, inicio, ultimoDia, dias, rat);
    _marcarOcorrencia_(idOcorrencia, { RAT_LINK: ratLink });
  } catch (e) {
    console.error('Falha ao gerar RAT: ' + e);
  }

  if (!tecnico) {
    _auditar_('ACIDENTE_SEM_TECNICO', lancadoPor || '', 'AFASTAMENTOS.LANCAR', false,
      colaborador.NOME + ': acidente registrado, mas o e-mail do técnico de segurança não está configurado.',
      { id: idOcorrencia });
    return false;
  }

  // 2) e-mail ao técnico, com gestor e DP em cópia
  const gestor = _normalizarEmail_(colaborador.GESTOR_EMAIL);
  const emailDP = _emailDoDP_();

  const tipoAcidente = _rotuloTipoAcidente_(rat.tipo);

  const corpo =
    '<p>Prezado(a) Técnico(a) de Segurança do Trabalho,</p>' +
    '<p>Registramos um <b>acidente de trabalho</b> e encaminhamos o <b>RAT preenchido</b> em anexo, ' +
    'para as providências de emissão da <b>CAT</b>.</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(colaborador.NOME)],
      ['Matrícula', _escapeHtml_(colaborador.MATRICULA || '—')],
      ['Empresa', _escapeHtml_(colaborador.EMPRESA || '—')],
      ['Tipo de acidente', tipoAcidente],
      ['Data do acidente', _escapeHtml_(rat.dataAcidente || '—')],
      ['Local', _escapeHtml_(rat.local || '—')],
      ['Parte lesionada', _escapeHtml_(rat.parteLesionada || '—')],
      ['Dias de afastamento', dias + ' dias']
    ]) +
    '<p style="font-size:13.5px">O documento em anexo traz o relato e os demais dados informados no lançamento. ' +
    'Qualquer informação adicional necessária para a CAT, estamos à disposição.</p>' +
    '<p>Atenciosamente,<br>Departamento Pessoal · CIEDS</p>';

  const html = _moldura_('Acidente de Trabalho — RAT para emissão de CAT', corpo,
    'Departamento Pessoal · CIEDS. Este e-mail acompanha o registro de acidente de trabalho.');

  const anexos = [];
  if (ratLink) {
    try {
      const id = _idDoLinkDrive_(ratLink);
      if (id) anexos.push(DriveApp.getFileById(id).getAs('application/pdf').setName('RAT_' + _slug_(colaborador.NOME) + '.pdf'));
    } catch (e) { /* envia sem anexo se falhar */ }
  }

  try {
    MailApp.sendEmail({
      to: tecnico,
      cc: [gestor, emailDP].filter(Boolean).join(','),
      subject: 'Acidente de Trabalho — RAT para CAT — ' + colaborador.NOME,
      htmlBody: html,
      attachments: anexos
    });

    _marcarOcorrencia_(idOcorrencia, { CAT_SOLICITADA: 'Sim' });
    _auditar_('ACIDENTE_RAT_ENVIADO', lancadoPor || '', 'AFASTAMENTOS.LANCAR', true,
      colaborador.NOME + ': RAT enviado ao técnico ' + tecnico + '.', { id: idOcorrencia });

    return true;
  } catch (e) {
    console.error('Falha ao enviar RAT: ' + e);
    return false;
  }
}

function _rotuloTipoAcidente_(cod) {
  const map = { '1': 'Típico (no trabalho)', '2': 'Doença ocupacional', '3': 'Trajeto' };
  return map[String(cod)] || '(não informado)';
}

/**
 * Gera o RAT preenchido como Google Doc, exporta para o Drive e devolve o link.
 * Usa um Doc temporário formatado com as seções do formulário oficial.
 */
function _gerarRAT_(colaborador, inicio, ultimoDia, dias, rat) {
  const doc = DocumentApp.create('RAT_' + _slug_(colaborador.NOME) + '_' + _isoF_(inicio));
  const body = doc.getBody();

  body.appendParagraph('RELATÓRIO DE ACIDENTE DO TRABALHO (RAT)')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('CIEDS · Departamento Pessoal').setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  function secao(titulo) {
    body.appendParagraph(titulo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  }
  function campo(rotulo, valor) {
    const p = body.appendParagraph('');
    p.appendText(rotulo + ': ').setBold(true);
    p.appendText(String(valor == null || valor === '' ? '—' : valor)).setBold(false);
  }

  secao('1 — Informações do Acidentado');
  campo('Nome', colaborador.NOME);
  campo('Matrícula', colaborador.MATRICULA);
  campo('CPF', rat.cpf || colaborador.CPF);
  campo('Telefone', rat.telefone);
  campo('Empresa', colaborador.EMPRESA);
  campo('Departamento', colaborador.DEPARTAMENTO_ATUAL);

  secao('2 — Informações do Acidente');
  campo('Data do acidente', rat.dataAcidente);
  campo('Hora do acidente', rat.horaAcidente);
  campo('Horas trabalhadas até o acidente', rat.horasTrabalhadas);
  campo('Último dia trabalhado', _fmtBRF_(ultimoDia));
  campo('Tipo', _rotuloTipoAcidente_(rat.tipo));
  campo('Especificação do local', rat.local);
  campo('Município do acidente', rat.municipio);
  campo('Endereço do local', rat.endereco);
  campo('Parte lesionada', rat.parteLesionada);
  campo('Agente causador', rat.agenteCausador);
  campo('Situação geradora', rat.situacaoGeradora);
  campo('Houve afastamento?', 'Sim — ' + dias + ' dias');
  campo('Houve registro policial?', rat.registroPolicial || 'Não');
  campo('Testemunhas', rat.testemunhas);

  secao('3 — Relato do Acidente');
  body.appendParagraph(String(rat.relato || '(não informado)'));

  secao('4 — Informações do Atendimento Médico');
  campo('Local do atendimento', rat.localAtendimento);
  campo('Data do atendimento', rat.dataAtendimento);
  campo('CID', rat.cid);
  campo('Natureza da lesão', rat.naturezaLesao);
  campo('Observações', rat.observacoes);

  body.appendParagraph('');
  body.appendParagraph('Rio de Janeiro, ' + _fmtBRF_(_hojeFerias_()) + '.').setItalic(true);
  body.appendParagraph('Documento gerado automaticamente pelo DP360. Requer conferência e assinatura.')
    .setItalic(true).editAsText().setFontSize(9);

  doc.saveAndClose();

  // move para a pasta do funcionário e devolve o link
  const arquivo = DriveApp.getFileById(doc.getId());
  const raizId = _afastParam_(AFAST.DRIVE_PASTA_PARAM, '');

  if (raizId) {
    const pasta = _pastaDoColaborador_(DriveApp.getFolderById(raizId), colaborador);
    pasta.addFile(arquivo);
    DriveApp.getRootFolder().removeFile(arquivo);
  }

  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return arquivo.getUrl();
}

function _idDoLinkDrive_(url) {
  const m = String(url).match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/** Configura o e-mail do técnico de segurança (para os acidentes de trabalho). */
function configurarTecnicoSeguranca(email) {
  if (!email || email.indexOf('@') === -1) throw new Error('Informe um e-mail válido.');
  _setFeriasParam_(AFAST.TECNICO_SEGURANCA_PARAM, String(email).trim().toLowerCase());
  return 'Técnico de segurança configurado: ' + email;
}

/* ============================================================================================ */
/*  DRIVE — documentos vinculados ao funcionário                                                 */
/* ============================================================================================ */

/**
 * Guarda um arquivo no Drive do DP, dentro de uma subpasta do funcionário.
 * Nome do arquivo carrega nome + tipo + data, para o histórico ficar navegável.
 * Retorna o link de visualização.
 */
function _salvarDocumento_(colaborador, categoria, base64, nomeArquivo, mimeType, dataRef) {
  const raizId = _afastParam_(AFAST.DRIVE_PASTA_PARAM, '');
  if (!raizId) {
    throw new Error('A pasta do Drive não está configurada. ' +
      'Rode configurarPastaDrive("ID_DA_PASTA") uma vez.');
  }

  const raiz = DriveApp.getFolderById(raizId);
  const pastaColab = _pastaDoColaborador_(raiz, colaborador);

  const ext = (nomeArquivo.split('.').pop() || 'pdf').toLowerCase();
  const nome = [
    _slug_(colaborador.NOME),
    categoria,
    _isoF_(dataRef || new Date())
  ].join('_') + '.' + ext;

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, nome);

  const arquivo = pastaColab.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return arquivo.getUrl();
}

/** Uma subpasta por funcionário (matrícula + nome), criada sob demanda. */
function _pastaDoColaborador_(raiz, colaborador) {
  const nomePasta = String(colaborador.MATRICULA || '') + ' - ' + String(colaborador.NOME || '');
  const existentes = raiz.getFoldersByName(nomePasta);

  if (existentes.hasNext()) return existentes.next();
  return raiz.createFolder(nomePasta);
}

function _slug_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function configurarPastaDrive(idPasta) {
  if (!idPasta) throw new Error('Informe o ID da pasta do Drive.');

  // valida que a pasta existe e é acessível
  const nome = DriveApp.getFolderById(idPasta).getName();

  _setFeriasParam_(AFAST.DRIVE_PASTA_PARAM, idPasta);

  return 'Pasta configurada: "' + nome + '". Os documentos de afastamento serão salvos aqui.';
}

/* ============================================================================================ */
/*  E-MAIL — informativo do INSS + DUT (reescrito, profissional)                                 */
/* ============================================================================================ */

function _enviarInformativoINSS_(colaborador, inicio, ultimoDia, dias, idOcorrencia, lancadoPor) {
  const email = _emailDoColaborador_(colaborador.ID_COLABORADOR);
  const gestor = _normalizarEmail_(colaborador.GESTOR_EMAIL);
  const emailDP = _emailDoDP_();
  const whatsappDP = _afastParam_('AFAST_WHATSAPP_DP', '(21) 97283-2974');

  const primeiro = String(colaborador.NOME || '').split(' ')[0];
  const primeiroCap = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();

  const corpo =
    '<p>Olá, ' + _escapeHtml_(primeiroCap) + '.</p>' +

    '<p>Esperamos que você esteja se recuperando bem. Estamos aqui para te acompanhar ' +
    'em cada passo deste processo.</p>' +

    '<p>Como o seu afastamento médico ultrapassou <b>15 dias</b>, a partir do 16º dia o seu ' +
    'benefício passa a ser responsabilidade do <b>INSS</b>. Para facilitar, preparamos um guia ' +
    'e anexamos o documento que você vai precisar.</p>' +

    _quadro_([
      ['Início do afastamento', _fmtBRF_(inicio)],
      ['Último dia trabalhado', _fmtBRF_(ultimoDia)],
      ['Dias de atestado', dias + ' dias']
    ]) +

    '<div style="background:#e7f1f3;border-radius:12px;padding:16px 18px;margin:18px 0">' +
      '<b style="color:#0E5A6B">Como agendar a perícia (Meu INSS)</b>' +
      '<ol style="margin:10px 0 0;padding-left:18px;line-height:1.9;font-size:13.5px">' +
        '<li>Acesse <b>meu.inss.gov.br</b> ou o aplicativo <b>Meu INSS</b>.</li>' +
        '<li>Entre com a sua conta <b>Gov.br</b>.</li>' +
        '<li>Toque em <b>"Novo pedido"</b> e procure por <b>Benefício por Incapacidade</b>.</li>' +
        '<li>Siga as instruções e escolha uma data para a perícia.</li>' +
      '</ol>' +
    '</div>' +

    '<p style="font-size:13.5px"><b>No dia da perícia,</b> leve o DUT em anexo, seus laudos e exames ' +
    'atualizados, e um documento de identificação com foto.</p>' +

    '<div style="background:#fdf4e3;border-radius:12px;padding:16px 18px;margin:18px 0">' +
      '<b style="color:#8a5b00">Precisamos da sua ajuda com duas informações</b>' +
      '<p style="margin:8px 0 0;font-size:13.5px">Para conseguirmos organizar o seu retorno com ' +
      'tranquilidade quando chegar a hora, por favor nos envie:</p>' +
      '<ul style="margin:8px 0 0;padding-left:18px;line-height:1.7;font-size:13.5px">' +
        '<li>O <b>comprovante de agendamento</b> da perícia, assim que marcar;</li>' +
        '<li>O <b>resultado da perícia</b> (Comunicado de Decisão), seja ele qual for.</li>' +
      '</ul>' +
      '<p style="margin:10px 0 0;font-size:13px">Você pode responder este e-mail ou falar com a ' +
      'gente pelo WhatsApp do DP: <b>' + _escapeHtml_(whatsappDP) + '</b>.</p>' +
    '</div>' +

    '<p style="font-size:13px;color:#6b7c81">Sem o documento oficial do INSS, não conseguimos ' +
    'regularizar a sua situação na folha nem organizar o seu retorno com segurança — por isso ' +
    'esses dois envios são tão importantes.</p>' +

    '<p>Qualquer dúvida, estamos por aqui. Desejamos uma ótima recuperação. 💙</p>';

  const html = _moldura_('Afastamento e encaminhamento ao INSS', corpo,
    'Departamento Pessoal · CIEDS. Este e-mail acompanha o seu processo de afastamento.');

  // anexa o DUT, se houver um modelo configurado
  const anexos = [];
  const dutModeloId = _afastParam_('AFAST_DUT_MODELO_ID', '');

  if (dutModeloId) {
    try {
      anexos.push(DriveApp.getFileById(dutModeloId).getBlob().setName('DUT.pdf'));
    } catch (e) { /* sem modelo: envia sem anexo */ }
  }

  let enviado = false;

  if (email) {
    try {
      MailApp.sendEmail({
        to: email,
        cc: gestor + (emailDP ? ',' + emailDP : ''),
        subject: 'Afastamento e encaminhamento ao INSS — orientações importantes',
        htmlBody: html,
        attachments: anexos
      });
      enviado = true;
    } catch (e) {
      console.error('Falha ao enviar informativo INSS: ' + e);
    }
  }

  // marca na planilha que os documentos foram enviados
  if (enviado) {
    _marcarOcorrencia_(idOcorrencia, { DUT_ENVIADO: 'Sim', INFORMATIVO_ENVIADO: 'Sim' });
  } else {
    _auditar_('AFAST_SEM_EMAIL', lancadoPor || '', 'AFASTAMENTOS.LANCAR', false,
      colaborador.NOME + ': encaminhado ao INSS, mas sem e-mail do colaborador na base.',
      { id: idOcorrencia });
  }

  return enviado;
}

function _marcarOcorrencia_(id, patch) {
  const sh = _shAfast_(AFAST.ABAS.OCORRENCIAS);
  const h = _headers_(sh);
  const o = _sheetToObjects_(sh).find(x => String(x.ID_OCORRENCIA) === String(id));
  if (o) _atualizarLinha_(sh, o._rowNumber, h, patch);
}

function _ocorrenciaPorId_(id) {
  const sh = _shAfast_(AFAST.ABAS.OCORRENCIAS);
  return _sheetToObjects_(sh).find(x => String(x.ID_OCORRENCIA) === String(id)) || null;
}

function _afastAddMeses_(data, n) {
  const x = new Date(data);
  x.setMonth(x.getMonth() + Number(n));
  return x;
}

/* ============================================================================================ */
/*  FATIA 2 — perícia, decisão, prorrogação, exame ocupacional, retorno, estabilidade            */
/* ============================================================================================ */

/** Fila do DP: agrupa as ocorrências abertas por etapa, para o Portal do DP renderizar direto. */
function afastFila(user, p) {
  const todas = _ocorrenciasVisiveis_(user, 'GLOBAL');
  const grupo = (arr) => arr.slice().sort((a, b) =>
    String(b.LANCADO_EM ? _isoF_(b.LANCADO_EM) : '').localeCompare(String(a.LANCADO_EM ? _isoF_(a.LANCADO_EM) : '')));

  const mapear = (o) => ({
    id: o.ID_OCORRENCIA,
    idColaborador: o.ID_COLABORADOR,
    nome: o.NOME,
    matricula: o.MATRICULA,
    tipo: o.TIPO,
    status: o.STATUS,
    inicio: _isoF_(o.DATA_INICIO),
    fim: _isoF_(o.DATA_FIM_PREVISTA),
    dias: Number(o.DIAS || 0),
    encaminhaINSS: _sim_(o.ENCAMINHA_INSS),
    acidenteTrabalho: _sim_(o.ACIDENTE_TRABALHO),
    atestadoLink: o.ATESTADO_LINK || '',
    periciaAgendadaEm: _isoF_(o.PERICIA_AGENDADA_EM),
    decisaoResultado: o.DECISAO_RESULTADO || '',
    exameOcupacionalResultado: o.EXAME_OCUPACIONAL_RESULTADO || '',
    prorrogacaoDe: o.PRORROGACAO_DE || '',
    dataRetorno: _isoF_(o.DATA_RETORNO),
    diasTotaisAfastado: o.DIAS_TOTAIS_AFASTADO || '',
    estabilidadeAte: _isoF_(o.ESTABILIDADE_ATE)
  });

  return {
    ok: true,
    modulo: 'AFASTAMENTOS',
    emAtestado: grupo(todas.filter(o => o.STATUS === 'EM_ATESTADO')).map(mapear),
    encaminhadosINSS: grupo(todas.filter(o => o.STATUS === 'ENCAMINHADO_INSS')).map(mapear),
    prorrogados: grupo(todas.filter(o => o.STATUS === 'PRORROGADO')).map(mapear),
    aguardandoRetorno: grupo(todas.filter(o => o.STATUS === 'AGUARDANDO_RETORNO')).map(mapear),
    encerrados: grupo(todas.filter(o => o.STATUS === 'ENCERRADO')).slice(0, 30).map(mapear)
  };
}

/**
 * O colaborador manda o comprovante de agendamento da perícia por e-mail; o DP só registra.
 * payload: id, dataAgendamento, comprovanteBase64?, comprovanteNome?, comprovanteTipo?
 */
function afastRegistrarAgendamentoPericia(user, p) {
  const o = _ocorrenciaPorId_(p.id);
  if (!o) throw new Error('Ocorrência não encontrada.');
  if (o.STATUS === 'ENCERRADO') throw new Error('Esta ocorrência já está encerrada.');

  const data = _dataF_(p.dataAgendamento);
  if (!data) throw new Error('Informe a data do agendamento da perícia.');

  let link = '';
  if (p.comprovanteBase64) {
    const c = { ID_COLABORADOR: o.ID_COLABORADOR, NOME: o.NOME, MATRICULA: o.MATRICULA };
    link = _salvarDocumento_(c, 'comprovante_agendamento_pericia',
      p.comprovanteBase64, p.comprovanteNome || 'comprovante.pdf', p.comprovanteTipo || 'application/pdf', data);
  }

  _marcarOcorrencia_(p.id, {
    PERICIA_AGENDADA_EM: data,
    PERICIA_COMPROVANTE_LINK: link || o.PERICIA_COMPROVANTE_LINK || ''
  });

  _auditar_('AFAST_PERICIA_AGENDADA', user.EMAIL, 'AFASTAMENTOS.REGISTRAR_AGENDAMENTO_PERICIA', true,
    o.NOME + ': perícia agendada para ' + _fmtBRF_(data), { id: p.id });

  return { ok: true, mensagem: 'Agendamento da perícia registrado para ' + _fmtBRF_(data) + '.' };
}

/**
 * Registra o Comunicado de Decisão do INSS.
 * payload: id, resultado ('DEFERIDO'|'INDEFERIDO'|'PRORROGADO'), docBase64?, docNome?, docTipo?
 */
function afastRegistrarDecisao(user, p) {
  const o = _ocorrenciaPorId_(p.id);
  if (!o) throw new Error('Ocorrência não encontrada.');
  if (o.STATUS === 'ENCERRADO') throw new Error('Esta ocorrência já está encerrada.');

  const resultado = String(p.resultado || '').toUpperCase().trim();
  if (['DEFERIDO', 'INDEFERIDO', 'PRORROGADO'].indexOf(resultado) === -1) {
    throw new Error('Resultado inválido. Use DEFERIDO, INDEFERIDO ou PRORROGADO.');
  }

  let link = '';
  if (p.docBase64) {
    const c = { ID_COLABORADOR: o.ID_COLABORADOR, NOME: o.NOME, MATRICULA: o.MATRICULA };
    link = _salvarDocumento_(c, 'comunicado_decisao',
      p.docBase64, p.docNome || 'comunicado_decisao.pdf', p.docTipo || 'application/pdf', new Date());
  }

  const novoStatus = (resultado === 'PRORROGADO') ? 'PRORROGADO' : 'AGUARDANDO_RETORNO';

  _marcarOcorrencia_(p.id, {
    STATUS: novoStatus,
    DECISAO_RESULTADO: resultado,
    DECISAO_DOC_LINK: link || o.DECISAO_DOC_LINK || '',
    DECISAO_REGISTRADA_POR: _normalizarEmail_(user.EMAIL),
    DECISAO_REGISTRADA_EM: new Date()
  });

  _auditar_('AFAST_DECISAO_REGISTRADA', user.EMAIL, 'AFASTAMENTOS.REGISTRAR_DECISAO', true,
    o.NOME + ': decisão do INSS = ' + resultado, { id: p.id, resultado: resultado });

  return {
    ok: true,
    resultado: resultado,
    mensagem: resultado === 'PRORROGADO'
      ? 'Decisão registrada como PRORROGADO. Use "Prorrogar" com o novo atestado para dar continuidade.'
      : 'Decisão registrada (' + resultado + '). Falta o exame ocupacional de retorno e confirmar o retorno ao trabalho.'
  };
}

/**
 * Prorrogação: cria uma NOVA ocorrência ligada à original (nada é sobrescrito).
 * payload: id (ocorrência original), dias, dataInicio (opcional; padrão = dia seguinte ao fim
 *   previsto anterior), atestadoBase64, atestadoNome, atestadoTipo, cid (opcional)
 */
function afastProrrogar(user, p) {
  const original = _ocorrenciaPorId_(p.id);
  if (!original) throw new Error('Ocorrência original não encontrada.');
  if (original.STATUS !== 'PRORROGADO') {
    throw new Error('Registre a decisão do INSS como PRORROGADO antes de prorrogar (ação REGISTRAR_DECISAO).');
  }

  const dias = Math.floor(Number(p.dias || 0));
  if (dias < 1) throw new Error('Informe a quantidade de dias do novo atestado.');

  const inicio = p.dataInicio ? _dataF_(p.dataInicio) : _addDiasF_(_dataF_(original.DATA_FIM_PREVISTA), 1);
  if (!inicio) throw new Error('Não consegui calcular a data de início da prorrogação — informe dataInicio.');

  const fim = _addDiasF_(inicio, dias - 1);
  const encaminhaINSS = dias > AFAST.DIAS_RESPONSABILIDADE_EMPRESA;

  const c = {
    ID_COLABORADOR: original.ID_COLABORADOR, NOME: original.NOME, MATRICULA: original.MATRICULA,
    EMPRESA_COD: original.EMPRESA_COD, EMPRESA: original.EMPRESA,
    DEPARTAMENTO_ATUAL: original.DEPARTAMENTO, GESTOR_EMAIL: original.GESTOR_EMAIL
  };

  let atestadoLink = '';
  if (p.atestadoBase64) {
    atestadoLink = _salvarDocumento_(c, 'atestado_prorrogacao',
      p.atestadoBase64, p.atestadoNome || 'atestado.pdf', p.atestadoTipo || 'application/pdf', inicio);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  let novoId;
  try {
    const sh = _shAfast_(AFAST.ABAS.OCORRENCIAS);
    const h = _headers_(sh);
    novoId = 'AFA-' + _uuid_().slice(0, 8).toUpperCase();

    const linha = h.map(col => {
      switch (col) {
        case 'ID_OCORRENCIA': return novoId;
        case 'ID_COLABORADOR': return c.ID_COLABORADOR;
        case 'MATRICULA': return c.MATRICULA || '';
        case 'NOME': return c.NOME || '';
        case 'EMPRESA_COD': return c.EMPRESA_COD || '';
        case 'EMPRESA': return c.EMPRESA || '';
        case 'DEPARTAMENTO': return original.DEPARTAMENTO || '';
        case 'GESTOR_EMAIL': return original.GESTOR_EMAIL || '';
        case 'TIPO_COD': return original.TIPO_COD || '';
        case 'TIPO': return original.TIPO || '';
        case 'CID': return String(p.cid || original.CID || '');
        case 'DATA_INICIO': return inicio;
        case 'DIAS': return dias;
        case 'DATA_FIM_PREVISTA': return fim;
        case 'ULTIMO_DIA_TRABALHADO': return original.ULTIMO_DIA_TRABALHADO || '';
        case 'ENCAMINHA_INSS': return encaminhaINSS ? 'Sim' : 'Não';
        case 'STATUS': return encaminhaINSS ? 'ENCAMINHADO_INSS' : 'EM_ATESTADO';
        case 'ATESTADO_LINK': return atestadoLink;
        case 'DUT_ENVIADO': return 'Não';
        case 'INFORMATIVO_ENVIADO': return 'Não';
        case 'ACIDENTE_TRABALHO': return original.ACIDENTE_TRABALHO || 'Não';
        case 'RAT_LINK': return original.RAT_LINK || '';
        case 'CAT_SOLICITADA': return original.CAT_SOLICITADA || '';
        case 'RAT_DADOS_JSON': return original.RAT_DADOS_JSON || '';
        case 'LANCADO_POR': return _normalizarEmail_(user.EMAIL);
        case 'LANCADO_EM': return new Date();
        case 'PRORROGACAO_DE': return original.ID_OCORRENCIA;
        default: return '';
      }
    });

    sh.appendRow(linha);
  } finally {
    lock.releaseLock();
  }

  _auditar_('AFAST_PRORROGADO', user.EMAIL, 'AFASTAMENTOS.PRORROGAR', true,
    original.NOME + ': prorrogação de ' + dias + ' dias desde ' + _fmtBRF_(inicio),
    { idOriginal: p.id, novoId: novoId, dias: dias });

  let emailEnviado = false;
  if (encaminhaINSS) {
    const ultimoDiaTrabalhado = _dataF_(original.ULTIMO_DIA_TRABALHADO) || _addDiasF_(inicio, -1);
    emailEnviado = _enviarInformativoINSS_(
      _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(original.ID_COLABORADOR)) || c,
      inicio, ultimoDiaTrabalhado, dias, novoId, user.EMAIL
    );
  }

  return {
    ok: true,
    novoId: novoId,
    encaminhaINSS: encaminhaINSS,
    emailEnviado: emailEnviado,
    mensagem: 'Prorrogação registrada (' + dias + ' dias desde ' + _fmtBRF_(inicio) + ').' +
      (encaminhaINSS ? ' Como passa de 15 dias, o colaborador recebeu novamente as orientações do INSS.' : '')
  };
}

/**
 * Exame ocupacional de retorno (NR-7) — obrigatório antes de o colaborador voltar ao trabalho.
 * payload: id, data, resultado ('APTO'|'INAPTO'), docBase64?, docNome?, docTipo?
 */
function afastExameOcupacional(user, p) {
  const o = _ocorrenciaPorId_(p.id);
  if (!o) throw new Error('Ocorrência não encontrada.');

  const data = _dataF_(p.data);
  if (!data) throw new Error('Informe a data do exame ocupacional.');

  const resultado = String(p.resultado || '').toUpperCase().trim();
  if (['APTO', 'INAPTO'].indexOf(resultado) === -1) throw new Error('Resultado inválido. Use APTO ou INAPTO.');

  let link = '';
  if (p.docBase64) {
    const c = { ID_COLABORADOR: o.ID_COLABORADOR, NOME: o.NOME, MATRICULA: o.MATRICULA };
    link = _salvarDocumento_(c, 'exame_ocupacional_retorno',
      p.docBase64, p.docNome || 'exame_ocupacional.pdf', p.docTipo || 'application/pdf', data);
  }

  _marcarOcorrencia_(p.id, {
    EXAME_OCUPACIONAL_DATA: data,
    EXAME_OCUPACIONAL_RESULTADO: resultado,
    EXAME_OCUPACIONAL_DOC_LINK: link || o.EXAME_OCUPACIONAL_DOC_LINK || ''
  });

  _auditar_('AFAST_EXAME_OCUPACIONAL', user.EMAIL, 'AFASTAMENTOS.EXAME_OCUPACIONAL', true,
    o.NOME + ': exame ocupacional = ' + resultado, { id: p.id, resultado: resultado });

  return {
    ok: true,
    resultado: resultado,
    mensagem: resultado === 'APTO'
      ? 'Exame ocupacional registrado como APTO. Já pode confirmar o retorno ao trabalho.'
      : '⚠️ Exame ocupacional registrado como INAPTO. Não confirme o retorno sem antes decidir o próximo passo (nova avaliação, afastamento adicional, etc.).'
  };
}

/**
 * Soma os dias afastados de toda a cadeia de prorrogações (percorre PRORROGACAO_DE até a raiz).
 */
function _afastCadeiaDias_(ocorrencia) {
  let total = Number(ocorrencia.DIAS || 0);
  let atual = ocorrencia;
  let elos = 0;

  while (atual && atual.PRORROGACAO_DE && elos < 50) {
    const anterior = _ocorrenciaPorId_(atual.PRORROGACAO_DE);
    if (!anterior) break;
    total += Number(anterior.DIAS || 0);
    atual = anterior;
    elos++;
  }

  return total;
}

/**
 * RETORNAR — registra a volta ao trabalho e encerra a ocorrência.
 * Se for acidente de trabalho, calcula e grava a estabilidade acidentária (12 meses).
 * payload: id, dataRetorno
 */
function afastRetornar(user, p) {
  const o = _ocorrenciaPorId_(p.id);
  if (!o) throw new Error('Ocorrência não encontrada.');
  if (o.STATUS === 'ENCERRADO') throw new Error('Esta ocorrência já está encerrada.');

  const dataRetorno = _dataF_(p.dataRetorno);
  if (!dataRetorno) throw new Error('Informe a data do retorno ao trabalho.');

  if (!o.EXAME_OCUPACIONAL_RESULTADO) {
    throw new Error('Registre o exame ocupacional de retorno antes de confirmar o retorno (ação EXAME_OCUPACIONAL).');
  }

  const diasTotais = _afastCadeiaDias_(o);
  const ehAcidente = _sim_(o.ACIDENTE_TRABALHO);
  const estabilidadeAte = ehAcidente ? _afastAddMeses_(dataRetorno, AFAST.ESTABILIDADE_ACIDENTARIA_MESES) : '';

  _marcarOcorrencia_(p.id, {
    STATUS: 'ENCERRADO',
    DATA_RETORNO: dataRetorno,
    DIAS_TOTAIS_AFASTADO: diasTotais,
    ESTABILIDADE_ATE: estabilidadeAte,
    RETORNO_REGISTRADO_POR: _normalizarEmail_(user.EMAIL),
    RETORNO_REGISTRADO_EM: new Date()
  });

  _auditar_('AFAST_RETORNO', user.EMAIL, 'AFASTAMENTOS.RETORNAR', true,
    o.NOME + ': retornou em ' + _fmtBRF_(dataRetorno) + ' (' + diasTotais + ' dias afastado no total)' +
    (ehAcidente ? ' — estabilidade até ' + _fmtBRF_(estabilidadeAte) : ''),
    { id: p.id, diasTotais: diasTotais });

  // aviso simples ao gestor (não bloqueia se falhar)
  try {
    const gestor = _normalizarEmail_(o.GESTOR_EMAIL);
    const corpo = '<p><b>' + _escapeHtml_(o.NOME) + '</b> retornou ao trabalho em <b>' +
      _fmtBRF_(dataRetorno) + '</b>.</p>' +
      _quadro_([
        ['Dias afastado (total)', diasTotais + ' dias'],
        ['Exame ocupacional', o.EXAME_OCUPACIONAL_RESULTADO]
      ]) +
      (ehAcidente ? '<p style="font-size:13px;color:#6b7c81">Por ser acidente de trabalho, ' +
        _escapeHtml_(o.NOME.split(' ')[0]) + ' tem estabilidade até <b>' + _fmtBRF_(estabilidadeAte) +
        '</b> (Lei 8.213/91, art. 118).</p>' : '');

    _enviar_(gestor, 'Retorno ao trabalho — ' + o.NOME,
      _moldura_('Retorno ao trabalho', corpo, 'Departamento Pessoal · CIEDS.'), null, null, true); // sem cópia para ferias@
  } catch (e) { /* não bloqueia o retorno se o e-mail falhar */ }

  return {
    ok: true,
    diasTotais: diasTotais,
    estabilidadeAte: estabilidadeAte ? _fmtBRF_(estabilidadeAte) : '',
    mensagem: 'Retorno registrado. Ocorrência encerrada.' +
      (ehAcidente ? ' Estabilidade acidentária gravada até ' + _fmtBRF_(estabilidadeAte) + '.' : '')
  };
}

/**
 * Consulta pública (para outros módulos, ex. Rescisão) se o colaborador tem estabilidade
 * acidentária ativa hoje. Só leitura — nenhum outro módulo é alterado por esta função.
 */
function afastEstabilidadeAtiva(idColaborador) {
  const sh = _ssAfast_().getSheetByName(AFAST.ABAS.OCORRENCIAS);
  if (!sh) return { ativa: false };

  const hoje = _hojeFerias_();
  const doColaborador = _sheetToObjects_(sh).filter(o =>
    String(o.ID_COLABORADOR) === String(idColaborador) && o.ESTABILIDADE_ATE);

  const ativa = doColaborador.find(o => {
    const ate = _dataF_(o.ESTABILIDADE_ATE);
    return ate && ate.getTime() >= hoje.getTime();
  });

  return ativa
    ? { ativa: true, ate: _isoF_(ativa.ESTABILIDADE_ATE), ocorrenciaId: ativa.ID_OCORRENCIA }
    : { ativa: false };
}

/* ============================================================================================ */
/*  DIAGNÓSTICO                                                                                  */
/* ============================================================================================ */

function diagnosticarAfastamentos() {
  const sh = _ssAfast_().getSheetByName(AFAST.ABAS.OCORRENCIAS);
  const ocorr = sh ? _sheetToObjects_(sh) : [];
  const pasta = _afastParam_(AFAST.DRIVE_PASTA_PARAM, '');

  const out = {
    versao: AFAST.VERSAO,
    abaOcorrenciasExiste: !!sh,
    ocorrenciasLancadas: ocorr.length,
    pastaDriveConfigurada: !!pasta,
    tiposCadastrados: _afastTipos_().length,
    porStatus: {}
  };
  ocorr.forEach(o => { out.porStatus[o.STATUS] = (out.porStatus[o.STATUS] || 0) + 1; });

  console.log(JSON.stringify(out, null, 2));
  return out;
}