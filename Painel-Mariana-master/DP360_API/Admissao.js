/*************************************************************************************************
 * DP360 · MÓDULO DE ADMISSÕES — DP360_API_Admissao.gs
 * -----------------------------------------------------------------------------------------------
 * Vive no MESMO projeto Apps Script da API central (junto de Codigo.gs, FERIAS.gs, etc.).
 * Segue o contrato de módulo do kernel: admResumo / admResumoDe / admContexto / admExecutar.
 *
 * O que este arquivo entrega (item 1 da ordem combinada):
 *   - Lê a base do formulário de admissão (planilha ADMISSOES_CADASTROS), sem duplicá-la.
 *   - Cria e mantém a aba operacional do DP (ADMISSOES_TRATATIVA), ligada ao cadastro por Protocolo.
 *   - Gera o arquivo de importação do RioCard (individual e em lote) no layout oficial.
 *   - Envia o Kit Admissional para assinatura no Autentique, verifica e baixa o assinado
 *     (mesmo cliente Autentique e mesmo padrão de "núcleo enviar/baixar" usados em Recibos de
 *     Férias e Homologação de Rescisão — ver ADMISSAO.KIT_* mais abaixo).
 *
 *   - Gera o PDF único do Kit Admissional (Imagem/Voz, LGPD, Normas médicas, Art. 480 quando
 *     aplicável, Sigilo e VT) a partir dos dados do cadastro + DADOS_CONTRATUAIS, salvando na
 *     mesma pasta do colaborador (para o Kit_Admissional.pdf ser achado por _admKitAcharArquivo_).
 *
 * Ainda NÃO entra aqui (próximo item): upload de ASO/Alterdata.
 *
 * ATIVAÇÃO (uma vez) — ver instruções ao final do arquivo.
 *************************************************************************************************/

/* ============================================================================================ */
/*  CONFIGURAÇÃO — os poucos valores que dependem da sua operação. Preencha os marcados >>>       */
/* ============================================================================================ */

const ADM = {
  // >>> COLE o ID da planilha ADMISSOES_CADASTROS (rode linksDoAdmin() no projeto do formulário).
  CADASTROS_ID: '1hCMuXFX41J-gAnieI5uo8Uf4hiNx18N37xej0NEyQZ0',
  ABA_CADASTROS: 'CADASTROS',

  // Planilha operacional "CHECK LIST ADMISSIONAL C/ AUTOMAÇÃO" (mantida pelo DP, fora do formulário).
  // Usada só pra ENGORDAR a lista do Kit Admissional com quem não passou pelo formulário público.
  // SEM pasta no Drive — essas pessoas aparecem só pra visualização, sem botões de Autentique.
  // >>> ABA_CHECKLIST é a aba do ano corrente — trocar manualmente todo janeiro (ex. 'ADMISSÃO/2027').
  CHECKLIST_ID: '1gEMSJ6j2nf4bRPqgFLzVKV_QYej1qmiDD5rKmtUtLyE',
  ABA_CHECKLIST: 'ADMISSÃO/2026',

  // >>> Só entra gente admitida a partir desta data — quem é de antes já foi tratado por fora
  // (mandado pro Autentique manualmente antes desta função existir). Mover pra frente conforme
  // o tempo passa, se fizer sentido (ex.: virar '2026-10-01' quando outubro fechar).
  CHECKLIST_DATA_MINIMA: '2026-09-01',

  // Pasta raiz "2026" no Drive, compartilhada pela Tayna em 18/09/2026 — dentro dela tem uma
  // subpasta por mês (SETEMBRO, OUTUBRO...) e dentro de cada mês uma por LOTAÇÃO, e dentro de
  // cada lotação uma por pessoa ("<matrícula> - <nome>"), onde o kit assinado é arquivado depois
  // de baixado do Autentique. >>> precisa de uma pasta nova (e desse ID atualizado) todo janeiro.
  CHECKLIST_DRIVE_ANO_ID: '1wAR5-7lA_8DbyHjjimUjLyVUnCcZI8wG',

  // Onde ficam as abas operacionais do DP. Vazio = usa a MESMA planilha de CADASTROS (recomendado:
  // mesma conta, tudo junto). Para separar, cole aqui o ID de outra planilha do DP.
  TRATATIVA_ID: '',
  ABA_TRATATIVA: 'ADMISSOES_TRATATIVA',
  ABA_KIT_DOCS: 'ADMISSOES_KIT_DOCS',
  ABA_CONTRATUAIS: 'DADOS_CONTRATUAIS',

  // Estrutura de subpastas dentro da pasta que o formulário já criou para cada colaborador.
  SUBPASTAS: {
    RECEBIDOS: '01_Documentos_Recebidos',
    GERADOS:   '02_Documentos_Gerados',
    ALTERDATA: '03_Alterdata',
    KIT:       '04_Kit_Admissional',
    ASSINADO:  '05_Assinado'
  },

  // [2026-09-24] Pasta única com uma cópia de TODO kit assinado por todos (pedido do DP), além do
  // arquivo de cada pessoa em 05_Assinado. Fica dentro de "00_AUTOMAÇÕES E DESENVOLVIMENTO", a
  // mesma pasta (Drive compartilhado) que guarda as pastas dos colaboradores.
  PASTA_KITS_ASSINADOS: {
    PAI_ID: '1ukvK_j9tz8jx3NjPNyVi9XQ4SqrmiNtv',
    NOME: 'KITS ADMISSIONAIS ASSINADOS',
    // [2026-09-30] Protocolos que NÃO podem ter cópia na pasta central, por decisão do DP. A
    // sincronização manda para a lixeira a cópia que houver e nunca mais copia. A pasta da pessoa
    // (05_Assinado) e a tratativa não mudam.
    // ADM20260921160355 = Magna Maria Teixeira da Luz (documento excluído no Autentique depois de assinado).
    EXCLUIR: ['ADM20260921160355']
  },

  // [2026-09-24] De quanto em quanto tempo (min) a assinatura automática do DP roda de verdade.
  // O gatilho continua a cada 15 min, mas só uma passada por intervalo trabalha; as outras saem
  // na hora. Poupa a cota diária de execução de gatilhos da conta autodppessoal (6 h/dia).
  ASSINATURA_DP_INTERVALO_MIN: 60,

  // [2026-09-28] Reenvio automático do kit para quem ainda não assinou: UMA VEZ POR DIA (pedido da
  // Taynara), na primeira passada do gatilho dentro da faixa de horário (Brasília). O gatilho pode
  // rodar mais vezes no dia (hoje é de 2 em 2 h); as outras passadas saem sem enviar nada.
  REENVIO_KIT_JANELA: [8, 20],
  // Quem recebe, a cada passada, um e-mail com a cópia do que foi reenviado (pedido 2026-09-28).
  // O e-mail de lembrete sai do Autentique, que não aceita cópia; por isso vai este resumo à parte.
  // Vários endereços: separar por vírgula. Vazio = não manda cópia.
  REENVIO_KIT_COPIA: 'taynarasilva.rj@cieds.org.br',

  // [2026-09-30] Reenvio automático DESLIGADO a pedido da Taynara ("preciso que pare de enviar
  // aviso para assinarem o kit admissional"). O gatilho pode continuar existindo: com false, cada
  // passada sai sem enviar nada. Para religar, trocar para true.
  REENVIO_KIT_ATIVO: false,

  // Geração do PDF do Kit Admissional (DocumentApp -> PDF único, salvo em SUBPASTAS.KIT).
  KIT: {
    CIDADE_DOC: 'Rio de Janeiro',
    CNPJ: '02.680.126/0001-80',
    COR_TITULO: '#000000',
    // Pasta com os documentos fixos (mesmos pra todo mundo, atualize o conteúdo do arquivo
    // mantendo o nome, que o kit sempre pega a versão mais recente).
    PASTA_FIXOS_ID: '1ukvK_j9tz8jx3NjPNyVi9XQ4SqrmiNtv',
    ARQ_CODIGO_ETICA: 'Código de Ética CIEDS.pdf',
    ARQ_DIRETRIZES: 'FIXO_Diretrizes_Atestados_Afastamentos_Licencas.pdf',
    EXIGIR_ALTERDATA: true,
    EXIGIR_SALARIO_FAMILIA: false, // true apenas quando o termo foi emitido e conferido
    // O termo de ciencia e incluido conforme os dias de experiencia; nao autoriza desconto automatico.
  },

  RIOCARD: {
    // Layout do arquivo. Para a família 04.x, trocar '04.02' por '04.01' muda APENAS o header
    // (o registro de detalhe do cartão 04 é idêntico nas duas). Confirme no portal qual ele aceita.
    VERSAO: '04.02',

    // >>> COLE o CNPJ (14 dígitos, sem pontuação) do comprador cadastrado junto ao RioCard.
    // Se CIEDS e Coletivo Aprendiz compram como CNPJs diferentes, isso vira decisão por projeto
    // (hoje está fixo; me avise se precisar variar por entidade).
    CNPJ_COMPRADOR: '02680126000180',

    CD_CIDADE: '02',      // 02 = Rio de Janeiro (tabela 01 do layout)
    CD_REDE:   '01',      // 01 = Ônibus (tabela 02 do layout)
    CD_TP_CARTAO: '04',   // 04 = Cartão VT RioCard Personalizado Usuário (tabela 04)

    REMOVER_ACENTOS: false,  // os exemplos do layout mantêm acentos; vire true se o portal recusar
    QUEBRA_LINHA: '\r\n',    // CRLF (padrão Windows/Bloco de Notas). Vire '\n' se necessário.
    CHARSET: 'ISO-8859-1',   // 1 byte por caractere, mantém o alinhamento fixo do arquivo
    ALERTA_VLUSO_CENTAVOS: 10000  // avisa se o VT diário passar de R$100 (provável erro de digitação)
  },

  // Enum de status geral da admissão.
  STATUS: {
    CADASTRO_RECEBIDO: 'Cadastro recebido',
    EM_CONFERENCIA: 'Em conferência pelo DP',
    PENDENCIA_DOCUMENTAL: 'Pendência documental',
    AGUARDANDO_ASO: 'Aguardando ASO',
    ASO_APROVADO: 'ASO aprovado',
    CADASTRO_ALTERDATA: 'Cadastro no Alterdata',
    AGUARDANDO_DOCS_ALTERDATA: 'Aguardando documentos Alterdata',
    KIT_EM_PREPARACAO: 'Kit em preparação',
    KIT_PRONTO: 'Kit pronto',
    KIT_ERRO: 'Erro ao gerar kit',
    ENVIADO_ASSINATURA: 'Enviado para assinatura',
    AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
    ASSINADO: 'Assinado',
    CONCLUIDA: 'Admissão concluída',
    CANCELADA: 'Cancelada'
  },

  // Cabeçalho da aba de tratativa. Colunas novas SEMPRE ao final (protege automações).
  HEADERS_TRATATIVA: [
    'PROTOCOLO', 'CPF', 'NOME', 'STATUS', 'RESPONSAVEL',
    'PROJETO', 'DEPARTAMENTO', 'CARGO', 'SALARIO', 'DATA_ADMISSAO',
    'MATRICULA', 'MATRICULA_RIOCARD', 'OBSERVACOES', 'PENDENCIAS',
    'ASO_STATUS', 'ASO_DATA', 'ASO_CLINICA', 'ASO_OBS', 'ASO_ARQUIVO_URL',
    'VT_STATUS', 'RIOCARD_STATUS', 'RIOCARD_ARQUIVO_URL', 'RIOCARD_GERADO_EM',
    'ALTERDATA_STATUS', 'KIT_STATUS', 'KIT_URL',
    'ASSINATURA_STATUS', 'ASSINATURA_URL',
    'CRIADO_EM', 'ATUALIZADO_EM', 'HISTORICO_JSON',
    'KIT_ID_AUTENTIQUE', 'KIT_ENVIADO_EM', 'KIT_ASSINADO_EM'
  ]
};

// Nomes EXATOS das colunas na planilha do formulário (conforme o Codigo.gs do cadastro).
const ADM_COL = {
  NOME: 'Nome completo',
  CPF: 'CPF',
  NASCIMENTO: 'Data de nascimento',
  SEXO: 'Sexo (eSocial)',
  RG: 'RG',
  RG_ORGAO: 'RG — órgão emissor',
  CELULAR: 'Celular/WhatsApp',
  EMAIL: 'E-mail pessoal',
  VT_QUER: 'Vale-transporte — deseja?',
  VT_TIPOS: 'VT — tipo (Jaé/RioCard)',
  VT_TOTAL_DIA: 'VT — total diário (R$)',
  VT_RIOCARD_NUMERO: 'VT — número do RioCard',
  VT_RIOCARD_SEM: 'VT — sem RioCard (solicitar novo)',
  PROTOCOLO: 'Protocolo',
  ENVIO: 'Data/hora do envio',
  STATUS_CAD: 'Status',
  PASTA: 'Pasta no Drive'
};

// Nomes EXATOS das colunas na planilha operacional CHECK LIST ADMISSIONAL (aba ADM.ABA_CHECKLIST).
const ADM_CHECKLIST_COL = {
  NOME: 'NOME',
  CPF: 'CPF',
  MATRICULA: 'MATRICULA',
  LOTACAO: 'LOTAÇÃO',
  DATA_ADMISSAO: 'DATA DE ADMISSÃO'
};

var ADM_MESES_PT_ = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO',
  'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/** Acha, dentro de `pastaPai`, a subpasta cujo nome bate com `nomeAlvo` ignorando acento/caixa. */
function _admAcharSubpastaNormalizada_(pastaPai, nomeAlvo) {
  var alvoNorm = _admNormalizarNome_(nomeAlvo);
  var it = pastaPai.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (_admNormalizarNome_(f.getName()) === alvoNorm) return f;
  }
  return null;
}

/**
 * Procura, na pasta anual do Drive (ADM.CHECKLIST_DRIVE_ANO_ID), o arquivo do kit já assinado e
 * arquivado de alguém da planilha CHECK LIST (sem pasta própria do formulário). Caminho esperado:
 * <ano>/<MÊS>/<LOTAÇÃO>/<matrícula> - <nome>/<arquivo>.pdf — matrícula e lotação casam ignorando
 * acento/caixa. Devolve null se qualquer nível não existir (ainda não foi arquivado, ou a
 * estrutura de pastas daquele mês/lotação ainda não foi criada) — nunca lança erro por não achar.
 */
/**
 * Nunca devolve null — sempre um objeto { pastaUrl, arquivoUrl, arquivoNome }, com os campos
 * vazios ('') pra qualquer nível que não exista ainda (mês, lotação, pasta da pessoa ou
 * arquivo dentro dela). `pastaUrl` é útil mesmo sem arquivo (é onde alguém vai arquivar depois).
 */
function _admChecklistArquivoArquivado_(dataAdmissaoISO, lotacao, matricula, nome) {
  var vazio = { pastaUrl: '', arquivoUrl: '', arquivoNome: '' };
  if (!ADM.CHECKLIST_DRIVE_ANO_ID || !dataAdmissaoISO) return vazio;

  var mesIdx = Number(String(dataAdmissaoISO).substring(5, 7)) - 1;
  var mesNome = ADM_MESES_PT_[mesIdx];
  if (!mesNome) return vazio;

  var raiz = DriveApp.getFolderById(ADM.CHECKLIST_DRIVE_ANO_ID);
  var pastaMes = _admAcharSubpastaNormalizada_(raiz, mesNome);
  if (!pastaMes) return vazio;

  var pastaLotacao = _admAcharSubpastaNormalizada_(pastaMes, lotacao);
  if (!pastaLotacao) return vazio;

  var matriculaStr = String(matricula || '').trim();
  var nomeNorm = _admNormalizarNome_(nome);
  var pastaPessoa = null;
  var it = pastaLotacao.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var fNorm = _admNormalizarNome_(f.getName());
    if (matriculaStr && fNorm.indexOf(matriculaStr) === 0) { pastaPessoa = f; break; }
    if (fNorm.indexOf(nomeNorm) > -1) { pastaPessoa = f; break; }
  }
  if (!pastaPessoa) return vazio;

  var pastaUrl = pastaPessoa.getUrl();
  var itArq = pastaPessoa.getFiles();
  if (!itArq.hasNext()) return { pastaUrl: pastaUrl, arquivoUrl: '', arquivoNome: '' };
  var arquivo = itArq.next();
  return { pastaUrl: pastaUrl, arquivoUrl: arquivo.getUrl(), arquivoNome: arquivo.getName() };
}

/** Link estável de visualização de um documento no Autentique (confirmado por teste: HTTP 200,
 *  funciona antes e depois de assinado — não precisa consultar a API pra montar). */
function _admLinkAutentiqueDocumento_(docId) {
  if (!docId) return '';
  return 'https://app.autentique.com.br/documentos/' + String(docId).trim();
}

// Colunas da aba DADOS_CONTRATUAIS (usadas pelo Kit Admissional: cargo/salário/departamento
// e se há contrato de experiência, para decidir o Termo do art. 480).
const ADM_CONTR_COL = {
  FUNCAO: 'Função',
  SALARIO: 'Salário Base',
  DEPARTAMENTO: 'Departamento',
  EXPERIENCIA_DIAS: 'Quantidade de dias do contrato de experiência'
};

// Colunas de CADASTROS usadas só na montagem do Kit (endereço, RG-UF, trechos de VT em JSON).
const ADM_COL_MAP = {
  NOME_SOCIAL: 'Nome social',
  LOGRADOURO: 'Logradouro',
  NUMERO: 'Número',
  COMPLEMENTO: 'Complemento',
  BAIRRO: 'Bairro',
  CIDADE: 'Cidade',
  UF: 'UF',
  CEP: 'CEP',
  RG_UF: 'RG — UF',
  VT_TRECHOS_JSON: 'VT — trechos (JSON)'
};

/* ============================================================================================ */
/*  CONTRATO DO MÓDULO (chamado pelo kernel)                                                      */
/* ============================================================================================ */

function admExecutar(acao, p, user) {
  switch (String(acao || '').toUpperCase()) {
    case 'ADMISSAO.CONTEXTO':          return admContexto(user, p);
    case 'ADMISSAO.RESUMO':            return admResumo(user, p);
    case 'ADMISSAO.FICHA':             return admFicha(user, p);
    case 'ADMISSAO.SALVAR_TRATATIVA':  return admSalvarTratativa(user, p);
    case 'ADMISSAO.RIOCARD_GERAR':     return admRiocardGerar(user, p);
    case 'ADMISSAO.RIOCARD_GERAR_LOTE':return admRiocardGerarLote(user, p);
    case 'ADMISSAO.RIOCARD_MARCAR_CONCLUIDO': return admRiocardMarcarConcluido(user, p);
    case 'ADMISSAO.KIT_GERAR':         return admKitGerar(user, p);
    case 'ADMISSAO.ALTERDATA_IMPORTAR_LOTE': return admAlterdataImportarLote(user,p);
    case 'ADMISSAO.ALTERDATA_IMPORTAR_INDIVIDUAIS': return admAlterdataImportarIndividuais(user,p);
    case 'ADMISSAO.ALTERDATA_SALVAR_DIRETO': return admAlterdataSalvarDireto(user,p);
    case 'ADMISSAO.ALTERDATA_STATUS': return admAlterdataStatus(user,p);
    case 'ADMISSAO.KIT_LISTA':         return admKitLista(user, p);
    case 'ADMISSAO.KIT_VER':           return admKitVer(user, p);
    case 'ADMISSAO.KIT_ENVIAR':        return admKitEnviar(user, p);
    case 'ADMISSAO.KIT_ENVIAR_LOTE':   return admKitEnviarLote(user, p);
    case 'ADMISSAO.KIT_VERIFICAR':     return admKitVerificar(user, p);
    case 'ADMISSAO.KIT_VERIFICAR_LOTE': return admKitVerificarLote(user, p);
    case 'ADMISSAO.KIT_BAIXAR':        return admKitBaixar(user, p);
    case 'ADMISSAO.KIT_BAIXAR_LOTE':   return admKitBaixarLote(user, p);
    case 'ADMISSAO.KIT_CANCELAR':      return admKitCancelar(user, p);
    default: throw new Error('Ação de admissões desconhecida: ' + acao);
  }
}

function admContexto(user, p) {
  const cadastros = _admCadastros_();
  const trat = _admTratativaMapa_();

  const itens = cadastros.map(function (c) {
    const proto = String(c[ADM_COL.PROTOCOLO] || '');
    const t = trat[proto] || null;
    return _admItemFila_(c, t);
  });

  const ind = {
    total: itens.length,
    aguardandoConferencia: itens.filter(function (i) { return i.status === ADM.STATUS.CADASTRO_RECEBIDO; }).length,
    pendenciaDocumental:   itens.filter(function (i) { return i.status === ADM.STATUS.PENDENCIA_DOCUMENTAL; }).length,
    aguardandoASO:         itens.filter(function (i) { return i.status === ADM.STATUS.AGUARDANDO_ASO; }).length,
    aguardandoAlterdata:   itens.filter(function (i) { return i.status === ADM.STATUS.CADASTRO_ALTERDATA || i.status === ADM.STATUS.AGUARDANDO_DOCS_ALTERDATA; }).length,
    aguardandoKit:         itens.filter(function (i) { return i.status === ADM.STATUS.KIT_EM_PREPARACAO; }).length,
    aguardandoAssinatura:  itens.filter(function (i) { return i.status === ADM.STATUS.AGUARDANDO_ASSINATURA || i.status === ADM.STATUS.ENVIADO_ASSINATURA; }).length,
    concluidas:            itens.filter(function (i) { return i.status === ADM.STATUS.CONCLUIDA; }).length,
    riocardPendente:       itens.filter(function (i) { return i.usaRiocard && i.riocardStatus !== 'Concluído' && i.status !== ADM.STATUS.CANCELADA; }).length
  };

  return { ok: true, modulo: 'ADMISSAO', nome: 'Admissões', icone: '🧾', indicadores: ind, itens: itens };
}

function admResumo(user, p) { return admResumoDe(admContexto(user, p)); }

function admResumoDe(ctx) {
  const i = ctx.indicadores;
  return {
    modulo: 'ADMISSAO', nome: 'Admissões', icone: '🧾',
    contadores: {
      emAndamento: i.total - i.concluidas,
      aguardandoConferencia: i.aguardandoConferencia,
      pendencia: i.pendenciaDocumental,
      aguardandoASO: i.aguardandoASO,
      riocardPendente: i.riocardPendente
    },
    precisaDeVoce: ctx.itens
      .filter(function (x) { return x.status === ADM.STATUS.CADASTRO_RECEBIDO || x.status === ADM.STATUS.PENDENCIA_DOCUMENTAL; })
      .slice(0, 8)
      .map(function (x) { return { protocolo: x.protocolo, nome: x.nome, detalhe: x.status }; })
  };
}

function admFicha(user, p) {
  const proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  const c = _admCadastroPorProtocolo_(proto);
  if (!c) throw new Error('Cadastro não encontrado: ' + proto);

  const t = _admTratativaMapa_()[proto] || null;
  const contr = _admContratuaisPorProtocolo_(proto);

  return {
    ok: true,
    cadastro: _admCadastroPublico_(c),
    tratativa: t,
    contratuais: contr,
    dependentes: _admParseJSON_(c['Dependentes (JSON)']),
    vtTrechos: _admParseJSON_(c['VT — trechos (JSON)']),
    documentos: String(c['Documentos anexados'] || '').split(' | ').filter(Boolean),
    pastaUrl: String(c[ADM_COL.PASTA] || ''),
    item: _admItemFila_(c, t)
  };
}

function admSalvarTratativa(user, p) {
  const proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  const c = _admCadastroPorProtocolo_(proto);
  if (!c) throw new Error('Cadastro não encontrado: ' + proto);

  const campos = (p && p.campos) || {};
  const antes = _admTratativaMapa_()[proto] || null;

  const permitidos = [
    'STATUS', 'RESPONSAVEL', 'PROJETO', 'DEPARTAMENTO', 'CARGO', 'SALARIO',
    'DATA_ADMISSAO', 'MATRICULA', 'MATRICULA_RIOCARD', 'OBSERVACOES', 'PENDENCIAS',
    'ASO_STATUS', 'ASO_DATA', 'ASO_CLINICA', 'ASO_OBS', 'ASO_ARQUIVO_URL',
    'VT_STATUS', 'RIOCARD_STATUS', 'ALTERDATA_STATUS', 'KIT_STATUS', 'ASSINATURA_STATUS'
  ];

  const patch = {};
  permitidos.forEach(function (k) { if (campos.hasOwnProperty(k)) patch[k] = campos[k]; });

  const historico = { data: _agoraISO_(), usuario: user.EMAIL, acao: 'SALVAR_TRATATIVA', alteracoes: patch };
  const depois = _admUpsertTratativa_(c, patch, historico);

  _auditar_('ADMISSAO_TRATATIVA', user.EMAIL, 'ADMISSAO.SALVAR_TRATATIVA', true, 'Tratativa atualizada.', { protocolo: proto, patch: patch });

  return { ok: true, tratativa: depois, antes: antes };
}

/* ============================================================================================ */
/*  RIOCARD — GERAÇÃO DO ARQUIVO DE IMPORTAÇÃO                                                    */
/*  As funções entre os marcadores PURO são as únicas testadas no Node (sem APIs Google).         */
/* ============================================================================================ */

/*__PURO_INICIO__*/

function _admDigitos_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

// [FIX 2026-10-06] CPF como chave de comparação com a CHECK LIST: só dígitos, devolvendo os zeros
// à esquerda que o Sheets come quando o CPF fica gravado como número (03799846794 vira
// 3799846794). Sem isso a sincronização não achava a linha de quem tem CPF começando com 0 e
// criava outra a cada 15 min — a aba chegou a 126 mil linhas e a lista de kits parou de carregar.
function _admCpfChave_(v) {
  var d = _admDigitos_(v);
  return d && d.length < 11 ? ('00000000000' + d).slice(-11) : d;
}

// CPF pra GRAVAR na CHECK LIST: com pontos e traço o Sheets guarda como texto e não come o zero.
function _admCpfTexto_(v) {
  var d = _admCpfChave_(v);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : String(v == null ? '' : v);
}

function _admRemoverAcentos_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Numérico: alinhado à direita, zeros à esquerda. Se exceder, mantém os n dígitos da direita.
function _admPadNum_(v, n) {
  var d = _admDigitos_(v);
  if (d.length > n) d = d.slice(d.length - n);
  while (d.length < n) d = '0' + d;
  return d;
}

// Alfa: alinhado à esquerda, espaços à direita. upper/remAcentos opcionais. Trunca no tamanho.
function _admPadAlfa_(v, n, opts) {
  opts = opts || {};
  var s = String(v == null ? '' : v);
  if (opts.remAcentos) s = _admRemoverAcentos_(s);
  if (opts.upper) s = s.toUpperCase();
  s = s.replace(/[\r\n\t]+/g, ' ');
  if (s.length > n) s = s.slice(0, n);
  while (s.length < n) s = s + ' ';
  return s;
}

// "R$ 3,85" / "3,85" / "3.85" / "8"  → centavos (inteiro). Reais com 2 casas.
function _admCentavos_(v) {
  if (v == null || v === '') return 0;
  var s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  var temV = s.indexOf(',') > -1, temP = s.indexOf('.') > -1;
  if (temV && temP) { s = s.replace(/\./g, '').replace(',', '.'); }       // ponto=milhar, vírgula=decimal
  else if (temV)    { s = s.replace(',', '.'); }                          // só vírgula = decimal
  // só ponto ou nenhum separador: parseFloat já resolve (trata como reais)
  var reais = parseFloat(s);
  if (isNaN(reais)) return 0;
  return Math.round(reais * 100);
}

// Aceita Date, "aaaa-mm-dd" ou "dd/mm/aaaa" → "ddmmaaaa" (8 dígitos) ou '' se não der.
function _admDataDDMMAAAA_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var dd = String(v.getDate()).padStart(2, '0');
    var mm = String(v.getMonth() + 1).padStart(2, '0');
    var aa = String(v.getFullYear());
    return dd + mm + aa;
  }
  var s = String(v).trim();
  var mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);        // aaaa-mm-dd
  if (mIso) return mIso[3] + mIso[2] + mIso[1];
  var mBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);        // dd/mm/aaaa
  if (mBr) return mBr[1] + mBr[2] + mBr[3];
  return '';
}

function _admSexoMF_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  if (!s) return ' ';
  if (s[0] === 'M' || s[0] === '1') return 'M';
  if (s[0] === 'F' || s[0] === '2') return 'F';
  return ' ';
}

// Celular → { ddd: '3N', tel: '10A' }. Best-effort; não bloqueia (cartão 04 já tem outros dados).
function _admTelefone_(cel) {
  var d = _admDigitos_(cel);
  if (d.length >= 3) {
    var ddd = d.slice(0, 2);
    var num = d.slice(2);
    return { ddd: _admPadNum_(ddd, 3), tel: _admPadAlfa_(num, 10) };
  }
  return { ddd: '000', tel: _admPadAlfa_('', 10) };
}

// Validação padrão de CPF (dígitos verificadores).
function _admCpfValido_(cpf) {
  var s = _admDigitos_(cpf);
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  var soma = 0, i, resto;
  for (i = 1; i <= 9; i++) soma += parseInt(s.substring(i - 1, i), 10) * (11 - i);
  resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(s.substring(9, 10), 10)) return false;
  soma = 0;
  for (i = 1; i <= 10; i++) soma += parseInt(s.substring(i - 1, i), 10) * (12 - i);
  resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(s.substring(10, 11), 10);
}

// Matrícula sintética para o RioCard: o CPF (dígitos). Estável, única, sem depender do Alterdata.
function _admMatriculaRiocard_(cpf) { return _admDigitos_(cpf); }

// Header tipo 01. Family 04.x: seq(5)+'01'+'CADUSU'+versao(5)+cnpj(14) = 32 chars.
function _admRiocardHeader_(cnpj, versao) {
  return _admPadNum_(1, 5) + '01' + _admPadAlfa_('CADUSU', 6) + _admPadAlfa_(versao, 5) + _admPadNum_(cnpj, 14);
}

// Trailer tipo 99. Family 04.x: seq(5)+'99' = 7 chars (sem Qt_registros — isso é só da 02.00).
function _admRiocardTrailer_(seq) { return _admPadNum_(seq, 5) + '99'; }

// Detalhe tipo 02, cartão 04 (personalizado usuário). Comprimento fixo = 201 chars.
// u = { matricula, nome, cpf, vlusoCentavos, cartao, nascimento, sexo, rg, rgOrgao, ddd, tel, email }
function _admRiocardDetalhe_(seq, u, cfg) {
  var opts = { upper: true, remAcentos: cfg.REMOVER_ACENTOS };
  var cartaoDig = _admDigitos_(u.cartao);
  var cartao = cartaoDig ? _admPadNum_(cartaoDig, 13) : _admPadAlfa_('', 13); // vazio = 13 espaços (novo cartão)

  return _admPadNum_(seq, 5)
    + '02'
    + _admPadAlfa_(u.matricula, 15)
    + _admPadAlfa_(u.nome, 40, opts)
    + _admPadNum_(u.cpf, 11)
    + _admPadNum_(u.vlusoCentavos, 6)
    + _admPadNum_(cfg.CD_CIDADE, 2)
    + _admPadNum_(cfg.CD_REDE, 2)
    + cartao
    + _admPadNum_(cfg.CD_TP_CARTAO, 2)
    + _admPadNum_(u.nascimento, 8)
    + _admPadAlfa_(u.sexo, 1)
    + _admPadAlfa_(u.rg, 15, opts)
    + _admPadAlfa_(u.rgOrgao, 6, opts)
    + _admPadNum_(u.ddd, 3)
    + _admPadAlfa_(u.tel, 10)
    + _admPadAlfa_(u.email, 60);
}

// Nome externo do arquivo: CADUSU_<versao4>_<cnpj14>_<aaaammdd>_<hhmm>.txt
function _admRiocardNomeArquivo_(cnpj, versao, dataObj) {
  var d = dataObj;
  var aaaammdd = String(d.getFullYear())
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  var hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  var ver4 = String(versao).replace('.', '');
  return 'CADUSU_' + ver4 + '_' + _admPadNum_(cnpj, 14) + '_' + aaaammdd + '_' + hhmm + '.txt';
}

// Monta o arquivo inteiro a partir de uma lista de usuários JÁ normalizados e válidos.
function _admRiocardMontar_(usuarios, cfg, dataObj) {
  var linhas = [];
  linhas.push(_admRiocardHeader_(cfg.CNPJ_COMPRADOR, cfg.VERSAO));
  var seq = 1;
  usuarios.forEach(function (u) { seq++; linhas.push(_admRiocardDetalhe_(seq, u, cfg)); });
  seq++;
  linhas.push(_admRiocardTrailer_(seq));

  return {
    conteudo: linhas.join(cfg.QUEBRA_LINHA) + cfg.QUEBRA_LINHA,
    nomeArquivo: _admRiocardNomeArquivo_(cfg.CNPJ_COMPRADOR, cfg.VERSAO, dataObj),
    qtdUsuarios: usuarios.length,
    qtdRegistros: seq
  };
}

// cadastro (linha do formulário) → usuário normalizado do RioCard, ou motivo de rejeição.
function _admUsuarioRiocardDe_(cad, matriculaRiocard, cfg) {
  var cpf = _admDigitos_(cad[ADM_COL.CPF]);
  if (!_admCpfValido_(cpf)) return { ok: false, motivo: 'CPF inválido ou ausente.' };

  var tel = _admTelefone_(cad[ADM_COL.CELULAR]);
  var vluso = _admCentavos_(cad[ADM_COL.VT_TOTAL_DIA]);

  var avisos = [];
  if (vluso <= 0) avisos.push('VT diário zerado — confira o valor.');
  if (vluso > cfg.ALERTA_VLUSO_CENTAVOS) avisos.push('VT diário acima de R$100 — possível erro de digitação.');

  // "Sem RioCard" (quer cartão NOVO) é diferente de "tem cartão mas não informou o número" —
  // sem esta distinção, os dois casos viram o mesmo registro em branco (pedido de cartão novo),
  // arriscando a operadora emitir um segundo cartão pra quem já tem um.
  var semCartaoMarcado = _admSim_(cad[ADM_COL.VT_RIOCARD_SEM]);
  var numeroCartao = String(cad[ADM_COL.VT_RIOCARD_NUMERO] || '').trim();
  if (!semCartaoMarcado && !numeroCartao) {
    avisos.push('Não marcou "sem RioCard" mas também não informou o número do cartão — confira com o colaborador antes de gerar (vai sair como pedido de cartão NOVO).');
  }

  var u = {
    matricula: matriculaRiocard || _admMatriculaRiocard_(cpf),
    nome: cad[ADM_COL.NOME],
    cpf: cpf,
    vlusoCentavos: vluso,
    cartao: (semCartaoMarcado ? '' : numeroCartao), // "sem cartão"=novo
    nascimento: _admDataDDMMAAAA_(cad[ADM_COL.NASCIMENTO]),
    sexo: _admSexoMF_(cad[ADM_COL.SEXO]),
    rg: cad[ADM_COL.RG],
    rgOrgao: cad[ADM_COL.RG_ORGAO],
    ddd: tel.ddd,
    tel: tel.tel,
    email: cad[ADM_COL.EMAIL]
  };

  // Truncamento silencioso: campos de largura fixa no layout do RioCard cortam sem avisar.
  var camposFixos = [
    { rotulo: 'nome', valor: u.nome, tam: 40 },
    { rotulo: 'RG', valor: u.rg, tam: 15 },
    { rotulo: 'e-mail', valor: u.email, tam: 60 },
    { rotulo: 'número do cartão', valor: u.cartao, tam: 13 }
  ];
  camposFixos.forEach(function (cfx) {
    if (String(cfx.valor || '').length > cfx.tam) {
      avisos.push('Campo "' + cfx.rotulo + '" tem mais de ' + cfx.tam + ' caracteres e vai ser cortado no arquivo: "' + cfx.valor + '".');
    }
  });

  return { ok: true, u: u, avisos: avisos };
}

// Elegível ao RioCard: quer VT e o tipo inclui RioCard.
function _admElegivelRiocard_(cad) {
  var quer = _admSim_(cad[ADM_COL.VT_QUER]);
  var tipo = _admRemoverAcentos_(String(cad[ADM_COL.VT_TIPOS] || '')).toLowerCase();
  return quer && tipo.indexOf('riocard') > -1;
}

// "Sim"/"sim"/"true"/"quero"/"x" → true. Aqui para as funções puras não dependerem do kernel.
function _admSim_(v) {
  var s = _admRemoverAcentos_(String(v == null ? '' : v)).trim().toLowerCase();
  return s === 'sim' || s === 's' || s === 'true' || s === 'x' || s === 'quero' || s === '1';
}

/*__PURO_FIM__*/

/* ------------------------------------------------------------------------------------------- */
/*  RIOCARD — camada com Google Apps (Sheets/Drive). Não testada no Node.                        */
/* ------------------------------------------------------------------------------------------- */

function admRiocardGerar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);
  if (!_admElegivelRiocard_(cad)) throw new Error('Este colaborador não optou por RioCard.');

  var trat = _admTratativaMapa_()[proto] || null;
  var matriculaRiocard = (trat && trat.MATRICULA_RIOCARD) ? String(trat.MATRICULA_RIOCARD)
                        : _admMatriculaRiocard_(cad[ADM_COL.CPF]);

  var norm = _admUsuarioRiocardDe_(cad, matriculaRiocard, ADM.RIOCARD);
  if (!norm.ok) throw new Error('Não foi possível gerar: ' + norm.motivo);

  var montado = _admRiocardMontar_([norm.u], ADM.RIOCARD, new Date());

  var pastaColab = _admPastaDoCadastro_(cad);
  var destino = _admSubpasta_(pastaColab, ADM.SUBPASTAS.GERADOS);
  var arquivo = _admSalvarTexto_(destino, montado.nomeArquivo, montado.conteudo, ADM.RIOCARD.CHARSET);

  _admUpsertTratativa_(cad, {
    MATRICULA_RIOCARD: matriculaRiocard,
    RIOCARD_STATUS: 'Arquivo gerado',
    RIOCARD_ARQUIVO_URL: arquivo.getUrl(),
    RIOCARD_GERADO_EM: _agoraISO_()
  }, { data: _agoraISO_(), usuario: user.EMAIL, acao: 'RIOCARD_GERAR', arquivo: montado.nomeArquivo });

  _auditar_('ADMISSAO_RIOCARD', user.EMAIL, 'ADMISSAO.RIOCARD_GERAR', true, 'Arquivo RioCard gerado.',
    { protocolo: proto, arquivo: montado.nomeArquivo });

  return { ok: true, nomeArquivo: montado.nomeArquivo, url: arquivo.getUrl(), avisos: norm.avisos };
}

/** ADMISSAO.RIOCARD_MARCAR_CONCLUIDO - o DP confirma que o RioCard desta pessoa já foi
 *  processado pela operadora (fora do sistema), pra ela parar de reentrar sozinha em "Gerar
 *  RioCard em lote" pra sempre. payload: { protocolo } */
function admRiocardMarcarConcluido(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  _admUpsertTratativa_(cad, { RIOCARD_STATUS: 'Concluído' },
    { data: _agoraISO_(), usuario: user.EMAIL, acao: 'RIOCARD_MARCAR_CONCLUIDO' });

  _auditar_('ADMISSAO_RIOCARD_CONCLUIDO', user.EMAIL, 'ADMISSAO.RIOCARD_MARCAR_CONCLUIDO', true,
    'RioCard marcado como concluído.', { protocolo: proto });

  return { ok: true, mensagem: 'RioCard de ' + String(cad[ADM_COL.NOME]).split(' ')[0] + ' marcado como concluído — não entra mais no lote.' };
}

function admRiocardGerarLote(user, p) {
  var protocolos = (p && p.protocolos) || [];
  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var alvo = cadastros.filter(function (c) {
    if (!_admElegivelRiocard_(c)) return false;
    if (protocolos.length) return protocolos.indexOf(String(c[ADM_COL.PROTOCOLO] || '')) > -1;
    // sem lista explícita: todos que ainda não foram concluídos no RioCard
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return !(t && t.RIOCARD_STATUS === 'Concluído');
  });

  var usuarios = [], rejeitados = [], avisos = [];
  alvo.forEach(function (c) {
    var proto = String(c[ADM_COL.PROTOCOLO] || '');
    var t = tratMapa[proto];
    var matr = (t && t.MATRICULA_RIOCARD) ? String(t.MATRICULA_RIOCARD) : _admMatriculaRiocard_(c[ADM_COL.CPF]);
    var norm = _admUsuarioRiocardDe_(c, matr, ADM.RIOCARD);
    if (!norm.ok) { rejeitados.push({ protocolo: proto, nome: c[ADM_COL.NOME], motivo: norm.motivo }); return; }
    (norm.avisos || []).forEach(function (a) { avisos.push({ protocolo: proto, nome: c[ADM_COL.NOME], aviso: a }); });
    usuarios.push({ _cad: c, _matr: matr, u: norm.u });
  });

  if (!usuarios.length) {
    // ok:true mesmo sem gerar nada - o bridge do portal (_api_) descarta qualquer campo extra
    // quando ok:false (só relata json.erro), então "rejeitados" nunca chegaria à tela do DP
    // se isto fosse ok:false. Com ok:true, o front decide como mostrar o detalhe de cada rejeição.
    var motivoResumo = rejeitados.length
      ? rejeitados.length + ' rejeitado(s): ' + rejeitados.map(function (r) { return r.nome + ' (' + r.motivo + ')'; }).join(' · ')
      : 'Ninguém pendente de RioCard no momento.';
    return { ok: true, qtd: 0, rejeitados: rejeitados, mensagem: 'Nenhum arquivo gerado — ' + motivoResumo };
  }

  var montado = _admRiocardMontar_(usuarios.map(function (x) { return x.u; }), ADM.RIOCARD, new Date());

  var raiz = _admPastaRaizLote_();
  var arquivo = _admSalvarTexto_(raiz, montado.nomeArquivo, montado.conteudo, ADM.RIOCARD.CHARSET);

  usuarios.forEach(function (x) {
    _admUpsertTratativa_(x._cad, {
      MATRICULA_RIOCARD: x._matr,
      RIOCARD_STATUS: 'Arquivo gerado',
      RIOCARD_ARQUIVO_URL: arquivo.getUrl(),
      RIOCARD_GERADO_EM: _agoraISO_()
    }, { data: _agoraISO_(), usuario: user.EMAIL, acao: 'RIOCARD_GERAR_LOTE', arquivo: montado.nomeArquivo });
  });

  _auditar_('ADMISSAO_RIOCARD_LOTE', user.EMAIL, 'ADMISSAO.RIOCARD_GERAR_LOTE', true,
    usuarios.length + ' incluído(s), ' + rejeitados.length + ' rejeitado(s).',
    { arquivo: montado.nomeArquivo, qtd: usuarios.length });

  return {
    ok: true, nomeArquivo: montado.nomeArquivo, url: arquivo.getUrl(),
    qtd: usuarios.length, rejeitados: rejeitados, avisos: avisos
  };
}

/* ============================================================================================ */
/*  ACESSO A DADOS — planilhas e Drive                                                            */
/* ============================================================================================ */

var _SS_ADM_CAD_ = null, _SS_ADM_TRAT_ = null;

function _admSSCadastros_() {
  if (!_SS_ADM_CAD_) {
    if (!ADM.CADASTROS_ID || ADM.CADASTROS_ID.indexOf('COLAR_ID') === 0) {
      throw new Error('Configure ADM.CADASTROS_ID com o ID da planilha ADMISSOES_CADASTROS.');
    }
    _SS_ADM_CAD_ = SpreadsheetApp.openById(ADM.CADASTROS_ID);
  }
  return _SS_ADM_CAD_;
}

function _admSSTratativa_() {
  if (!_SS_ADM_TRAT_) {
    _SS_ADM_TRAT_ = ADM.TRATATIVA_ID ? SpreadsheetApp.openById(ADM.TRATATIVA_ID) : _admSSCadastros_();
  }
  return _SS_ADM_TRAT_;
}

function _admShCadastros_() {
  var sh = _admSSCadastros_().getSheetByName(ADM.ABA_CADASTROS);
  if (!sh) throw new Error('Aba "' + ADM.ABA_CADASTROS + '" não encontrada na planilha de cadastros.');
  return sh;
}

function _admShTratativa_() {
  var ss = _admSSTratativa_();
  var sh = ss.getSheetByName(ADM.ABA_TRATATIVA);
  if (!sh) {
    sh = ss.insertSheet(ADM.ABA_TRATATIVA);
    sh.getRange(1, 1, 1, ADM.HEADERS_TRATATIVA.length).setValues([ADM.HEADERS_TRATATIVA]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, ADM.HEADERS_TRATATIVA.length).setValues([ADM.HEADERS_TRATATIVA]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _admCadastros_() { return _sheetToObjects_(_admShCadastros_()); }

var _SS_ADM_CHECK_ = null;

function _admSSChecklist_() {
  if (!_SS_ADM_CHECK_) {
    if (!ADM.CHECKLIST_ID) throw new Error('Configure ADM.CHECKLIST_ID com o ID da planilha de checklist.');
    _SS_ADM_CHECK_ = SpreadsheetApp.openById(ADM.CHECKLIST_ID);
  }
  return _SS_ADM_CHECK_;
}

function _admShChecklist_() {
  var sh = _admSSChecklist_().getSheetByName(ADM.ABA_CHECKLIST);
  if (!sh) throw new Error('Aba "' + ADM.ABA_CHECKLIST + '" não encontrada na planilha de checklist (aba mudou de ano?).');
  return sh;
}

function _admChecklistCadastros_() { return _sheetToObjects_(_admShChecklist_()); }

/**
 * [PERF 2026-10-06] A lista de kits não lê mais a CHECK LIST ao vivo: com a aba enorme (126 mil
 * linhas, cópias da sincronização — ver _admCpfChave_) qualquer leitura nela levava de 20 s a
 * mais de 3 min, e a lista não carregava (o portal desiste em ~60 s). A sincronização de 15 min
 * (admChecklistSincronizarLinks), que já lê a aba inteira, guarda no cache só as linhas com
 * admissão a partir de ADM.CHECKLIST_DATA_MINIMA, no formato de _sheetToObjects_, e a lista lê
 * daqui. Sem cache (antes da 1ª sincronização) a lista sai sem quem só está na CHECK LIST.
 */
var ADM_CACHE_CHECKLIST_LISTA_ = 'ADM_CHECKLIST_LISTA_KIT';

function _admChecklistGuardarParaLista_(linhas) {
  var campos = [ADM_CHECKLIST_COL.NOME, ADM_CHECKLIST_COL.CPF, ADM_CHECKLIST_COL.MATRICULA,
    ADM_CHECKLIST_COL.LOTACAO, 'LINK ARQUIVO ASSINADO'];
  var guardar = [];
  linhas.forEach(function (row) {
    var adm = _isoF_(row[ADM_CHECKLIST_COL.DATA_ADMISSAO]);
    if (!adm || adm < ADM.CHECKLIST_DATA_MINIMA) return;
    var o = { _rowNumber: row._rowNumber };
    campos.forEach(function (c) { o[c] = row[c] instanceof Date ? _isoF_(row[c]) : row[c]; });
    o[ADM_CHECKLIST_COL.DATA_ADMISSAO] = adm;
    guardar.push(o);
  });
  var json = JSON.stringify(guardar);
  if (json.length > 95000) throw new Error('linhas da CHECK LIST grandes demais pro cache (' + json.length + ' bytes)');
  CacheService.getScriptCache().put(ADM_CACHE_CHECKLIST_LISTA_, json, 21600); // 6 h, o máximo
  return guardar.length;
}

function _admChecklistDaLista_() {
  var json = CacheService.getScriptCache().get(ADM_CACHE_CHECKLIST_LISTA_);
  return json ? JSON.parse(json) : null;
}

/** Garante as 2 colunas de link no fim da CHECK LIST (mesmo padrão de admKitSetup, linha 709). */
function _admChecklistSetup_() {
  var sh = _admShChecklist_();
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x || '').trim(); });
  var alvo = ['LINK KIT AUTENTIQUE', 'LINK PASTA DRIVE', 'LINK ARQUIVO ASSINADO'];
  var faltam = alvo.filter(function (c) { return h.indexOf(c) === -1; });
  if (faltam.length) sh.getRange(1, h.length + 1, 1, faltam.length).setValues([faltam]);
}

/**
 * Acha (por CPF, em `checklistPorCpf`) ou cria a linha desse cadastro do formulário na CHECK
 * LIST. Só preenche o que o formulário/tratativa realmente sabem (nome, CPF, e-mail, nascimento,
 * RG, e o que a tratativa já tiver de matrícula/lotação/cargo/data de admissão) — o resto fica
 * em branco pro DP completar manualmente, igual já acontece hoje pra quem é cadastrado direto
 * na CHECK LIST. `checklistPorCpf` é atualizado in-place com a linha nova (evita recriá-la de
 * novo se `admKitLista` processar o mesmo cadastro outra vez na mesma execução).
 */
function _admChecklistGarantirLinha_(cad, trat, checklistPorCpf) {
  var cpfDig = _admCpfChave_(cad[ADM_COL.CPF]);
  if (!cpfDig) return null;

  var existente = checklistPorCpf[cpfDig];
  if (existente) return existente;

  var sh = _admShChecklist_();
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x || '').trim(); });
  var proto = String(cad[ADM_COL.PROTOCOLO] || '');

  var linha = h.map(function (col) {
    switch (col) {
      case 'NOME': return cad[ADM_COL.NOME] || '';
      case 'CPF': return _admCpfTexto_(cad[ADM_COL.CPF]);
      case 'EMAIL': return cad[ADM_COL.EMAIL] || '';
      case 'DATA DE NASCIMENTO': return cad[ADM_COL.NASCIMENTO] || '';
      case 'RG': return cad[ADM_COL.RG] || '';
      case 'MATRICULA': return trat ? (trat.MATRICULA || '') : '';
      case 'LOTAÇÃO': return trat ? (trat.DEPARTAMENTO || '') : '';
      case 'CARGO': return trat ? (trat.CARGO || '') : '';
      case 'DATA DE ADMISSÃO': return trat ? (trat.DATA_ADMISSAO || '') : '';
      case 'SITUAÇÃO': return 'CADASTRAR';
      case 'OBS': return 'Sincronizado do formulário de candidatura (protocolo ' + proto + ').';
      default: return '';
    }
  });
  sh.appendRow(linha);

  var obj = {};
  h.forEach(function (col, i) { obj[col] = linha[i]; });
  obj._rowNumber = sh.getLastRow();
  checklistPorCpf[cpfDig] = obj;
  return obj;
}

/** Grava os links na linha da CHECK LIST, só os que forem novos/diferentes do que já está lá —
 *  evita reescrever a planilha à toa a cada carregamento da lista. `linkDrive` é a PASTA (só
 *  navegação); `linkArquivo` (opcional) é o ARQUIVO PDF assinado e arquivado em si — são coisas
 *  diferentes, não confundir (bug 2026-09-22: admKitLista usava o link da pasta como se fosse o
 *  do arquivo, e a tela de Assinados abria a pasta do Drive em vez do PDF). */
function _admChecklistAtualizarLinks_(linhaChecklist, linkAutentique, linkDrive, linkArquivo) {
  if (!linhaChecklist || !linhaChecklist._rowNumber) return;

  var patch = {};
  if (linkAutentique && linhaChecklist['LINK KIT AUTENTIQUE'] !== linkAutentique) patch['LINK KIT AUTENTIQUE'] = linkAutentique;
  if (linkDrive && linhaChecklist['LINK PASTA DRIVE'] !== linkDrive) patch['LINK PASTA DRIVE'] = linkDrive;
  if (linkArquivo && linhaChecklist['LINK ARQUIVO ASSINADO'] !== linkArquivo) patch['LINK ARQUIVO ASSINADO'] = linkArquivo;
  if (!Object.keys(patch).length) return;

  var sh = _admShChecklist_();
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x || '').trim(); });
  _atualizarLinha_(sh, linhaChecklist._rowNumber, h, patch);

  // atualiza o objeto em memória também, pra não regravar de novo se ele for reusado na mesma execução
  Object.keys(patch).forEach(function (k) { linhaChecklist[k] = patch[k]; });
}

function _admNormalizarNome_(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Busca no Autentique documentos "FICHA <NOME>" (o kit admissional de quem foi admitido via
 * planilha CHECK LIST, sem pasta própria no Drive do formulário) criados a partir de
 * `corteISO` (string ISO, comparação lexicográfica funciona igual pra data e pra datetime).
 * Pagina do mais recente pro mais antigo e para assim que a página inteira já é mais velha que
 * o corte — normalmente só 1 ou 2 páginas, nunca passa a lista toda (hoje ~1200 documentos).
 * Devolve um mapa NOME_NORMALIZADO -> { id, assinado }.
 */
function _admAutentiqueFichasRecentes_(corteISO) {
  var token = _autentiqueToken_();
  var mapa = {};
  var pagina = 1;
  var MAX_PAGINAS = 10; // trava de segurança, não deveria nem chegar perto disso

  while (pagina <= MAX_PAGINAS) {
    // [FIX 2026-09-23] Antes só pedia files{signed} e tratava a existencia desse link como
    // "assinado por todos" — o Autentique pode preencher esse link antes de todo mundo
    // assinar, entao gente aparecia "Assinado" com signatario pendente de verdade. Agora pede
    // as assinaturas individuais tambem e só considera completo quando todas estiverem feitas
    // (mesmo criterio usado em _reciboConsultarDocumento_).
    var query = 'query($page: Int){ documents(page: $page) { total data { id name created_at files { signed } signatures { signed } } } }';
    var resp = UrlFetchApp.fetch('https://api.autentique.com.br/v2/graphql', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ query: query, variables: { page: pagina } }),
      muteHttpExceptions: true
    });
    var json = JSON.parse(resp.getContentText());
    if (json.errors) throw new Error('Autentique respondeu com erro: ' + JSON.stringify(json.errors));

    var lote = (json.data && json.data.documents && json.data.documents.data) || [];
    if (!lote.length) break;

    lote.forEach(function (doc) {
      var nome = String(doc.name || '').trim();
      if (nome.toUpperCase().indexOf('FICHA ') !== 0) return; // só nos interessa kit admissional
      var chave = _admNormalizarNome_(nome.substring(6));
      if (!mapa[chave]) { // mantém o mais recente se houver mais de um com o mesmo nome
        var sigs = doc.signatures || [];
        var completo = sigs.length > 0 && sigs.every(function (s) { return !!s.signed; });
        mapa[chave] = { id: doc.id, assinado: completo };
      }
    });

    var maisAntigoDaPagina = lote[lote.length - 1].created_at;
    pagina++;
    if (String(maisAntigoDaPagina) < corteISO) break; // página inteira já é mais velha que o corte
  }

  return mapa;
}

function _admCadastroPorProtocolo_(proto) {
  var todos = _admCadastros_();
  for (var i = 0; i < todos.length; i++) {
    if (String(todos[i][ADM_COL.PROTOCOLO] || '') === proto) return todos[i];
  }
  return null;
}

function _admTratativaMapa_() {
  var linhas = _sheetToObjects_(_admShTratativa_());
  var mapa = {};
  linhas.forEach(function (l) {
    if (l.HISTORICO_JSON) l._historico = _admParseJSON_(l.HISTORICO_JSON);
    mapa[String(l.PROTOCOLO || '')] = l;
  });
  return mapa;
}

// Cria/atualiza a linha de tratativa do protocolo, acrescentando um evento ao histórico.
function _admUpsertTratativa_(cad, patch, eventoHistorico) {
  var sh = _admShTratativa_();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var proto = String(cad[ADM_COL.PROTOCOLO] || '');
  var agora = _agoraISO_();

  var objs = _sheetToObjects_(sh);
  var existente = null;
  for (var i = 0; i < objs.length; i++) { if (String(objs[i].PROTOCOLO || '') === proto) { existente = objs[i]; break; } }

  var atual = {};
  headers.forEach(function (h) { atual[h] = existente ? existente[h] : ''; });

  if (!existente) {
    atual.PROTOCOLO = proto;
    atual.CPF = cad[ADM_COL.CPF] || '';
    atual.NOME = cad[ADM_COL.NOME] || '';
    atual.STATUS = ADM.STATUS.CADASTRO_RECEBIDO;
    atual.CRIADO_EM = agora;
  }

  Object.keys(patch || {}).forEach(function (k) { if (headers.indexOf(k) > -1) atual[k] = patch[k]; });
  atual.ATUALIZADO_EM = agora;

  var hist = _admParseJSON_(atual.HISTORICO_JSON) || [];
  if (eventoHistorico) hist.push(eventoHistorico);
  atual.HISTORICO_JSON = JSON.stringify(hist);

  var linha = headers.map(function (h) { return atual[h] != null ? atual[h] : ''; });

  if (existente) {
    sh.getRange(existente._rowNumber, 1, 1, headers.length).setValues([linha]);
  } else {
    sh.appendRow(linha);
  }
  return atual;
}

function _admPastaDoCadastro_(cad) {
  var url = String(cad[ADM_COL.PASTA] || '');
  var m = url.match(/\/folders\/([-\w]+)/) || url.match(/[?&]id=([-\w]+)/);
  if (!m) throw new Error('Sem pasta no Drive para este cadastro (coluna "' + ADM_COL.PASTA + '").');
  return DriveApp.getFolderById(m[1]);
}

function _admSubpasta_(pai, nome) {
  var it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

function _admPastaRaizLote_() {
  var raiz = _admSSCadastros_(); // pasta onde fica a planilha
  var arqPlan = DriveApp.getFileById(raiz.getId());
  var pais = arqPlan.getParents();
  var pastaBase = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  return _admSubpasta_(pastaBase, 'RioCard_Lotes');
}

function _admSalvarTexto_(pasta, nome, conteudo, charset) {
  // Remove versão anterior com o mesmo nome (evita duplicar em regenerações no mesmo minuto).
  var iguais = pasta.getFilesByName(nome);
  while (iguais.hasNext()) { iguais.next().setTrashed(true); }

  var blob = Utilities.newBlob('', 'text/plain', nome);
  blob.setDataFromString(conteudo, charset || 'ISO-8859-1');
  var arquivo = pasta.createFile(blob);
  // Arquivo pessoal: nao habilitar acesso publico por link.
  return arquivo;
}

/* ============================================================================================ */
/* ============================================================================================ */
/*  KIT ADMISSIONAL — GERAÇÃO DO PDF ÚNICO A PARTIR DOS DADOS DO CADASTRO                         */
/*  Gera um Google Doc temporário (DocumentApp), exporta 1 PDF e salva em SUBPASTAS.KIT, com nome */
/*  contendo "kit" — assim _admKitAcharArquivo_ (abaixo) encontra o arquivo automaticamente.       */
/* ============================================================================================ */

// Logo e rodapé do papel timbrado OFICIAL do CIEDS (Papel_timbrado.docx: cabeçalho e rodapé
// reais, com os 4 endereços atuais — Rio I, Rio II, São Paulo, Pacajus). Ficam embutidos em
// base64 para o kit não depender de nenhum arquivo externo no Drive.
var ADM_KIT_LOGO_B64 = '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';
var ADM_KIT_RODAPE_B64 = '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';

function _admImagemDeB64_(b64, nome) {
  return Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', nome || 'img.png');
}

// Insere uma imagem no body já escalada para a largura alvo (mantendo proporção).
function _admInserirImagem_(body, blob, larguraAlvoPx, alinhamento) {
  var img = body.appendImage(blob);
  var razao = larguraAlvoPx / img.getWidth();
  img.setWidth(Math.round(img.getWidth() * razao));
  img.setHeight(Math.round(img.getHeight() * razao));
  var par = img.getParent();
  if (par && par.getType() === DocumentApp.ElementType.PARAGRAPH) {
    par.asParagraph().setAlignment(alinhamento || DocumentApp.HorizontalAlignment.LEFT);
  }
  return img;
}

/*__KIT_PURO_INICIO__*/

function _admStr_(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  var s = String(v).trim();
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}

function _admNum_(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') > -1) s = s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function _admBRL_(v) {
  var n = _admNum_(v);
  if (isNaN(n)) return '';
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function _admReaisVirgula_(v) {
  var n = _admNum_(v);
  if (isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',');
}

function _admTelFmt_(v) {
  var d = _admStr_(v).replace(/\D/g, '');
  if (d.length === 11) return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
  return _admStr_(v);
}

function _admCEPFmt_(v) {
  var d = _admStr_(v).replace(/\D/g, '');
  if (d.length === 8) return d.slice(0,5) + '-' + d.slice(5);
  return _admStr_(v);
}

function _admDataFmt_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var p = function(n){ return String(n).padStart(2,'0'); };
    return p(v.getDate()) + '/' + p(v.getMonth()+1) + '/' + v.getFullYear();
  }
  var s = String(v).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  return s;
}

function _admDataHoje_(hoje) {
  var d = hoje || new Date();
  var meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
}

// Monta o mapa de placeholders a partir dos objetos-linha (puro).
function _admKitDados_(cad, contr, trat, cfg, hoje) {
  cfg = cfg || {}; contr = contr || {}; trat = trat || {};

  var logradouro = _admStr_(cad[ADM_COL_MAP.LOGRADOURO]);
  var numero = _admStr_(cad[ADM_COL_MAP.NUMERO]);
  var compl = _admStr_(cad[ADM_COL_MAP.COMPLEMENTO]);
  var endereco = logradouro + (numero ? ', ' + numero : '') + (compl ? ' - ' + compl : '');

  var rg = _admStr_(cad[ADM_COL.RG]);
  var rgOrgao = _admStr_(cad[ADM_COL.RG_ORGAO]).toUpperCase();
  var rgUF = _admStr_(cad[ADM_COL_MAP.RG_UF]).toUpperCase();
  var rgCompleto = rg + (rgOrgao ? ' ' + rgOrgao : '') + (rgUF ? '/' + rgUF : '');

  var riocard = _admStr_(cad[ADM_COL.VT_RIOCARD_NUMERO]);
  if (riocard === '0' || riocard === '0.0') riocard = '';

  var cargo = _admStr_(contr[ADM_CONTR_COL.FUNCAO]) || _admStr_(trat.CARGO);
  var salario = _admBRL_(contr[ADM_CONTR_COL.SALARIO]) || _admBRL_(trat.SALARIO);
  var departamento = _admStr_(contr[ADM_CONTR_COL.DEPARTAMENTO]) || _admStr_(trat.DEPARTAMENTO);

  var usaVT = _admSim_(cad[ADM_COL.VT_QUER]);
  var tipos = _admStr_(cad[ADM_COL.VT_TIPOS]);

  return {
    NOME_COMPLETO: _admStr_(cad[ADM_COL.NOME]),
    CPF: _admStr_(cad[ADM_COL.CPF]),
    RG: rgCompleto,
    DATA_NASCIMENTO: _admDataFmt_(cad[ADM_COL.NASCIMENTO]),
    ENDERECO_COMPLETO: endereco,
    BAIRRO: _admStr_(cad[ADM_COL_MAP.BAIRRO]),
    CIDADE_UF: _admStr_(cad[ADM_COL_MAP.CIDADE]) + (cad[ADM_COL_MAP.UF] ? '/' + _admStr_(cad[ADM_COL_MAP.UF]) : ''),
    EMAIL: _admStr_(cad[ADM_COL.EMAIL]),
    CELULAR: _admTelFmt_(cad[ADM_COL.CELULAR]),
    CARGO: cargo,
    SALARIO: salario,
    DEPARTAMENTO: departamento,
    PROJETO: _admStr_(trat.PROJETO) || departamento,
    DATA_ADMISSAO: _admDataFmt_(trat.DATA_ADMISSAO),
    RIOCARD_NUMERO: riocard,
    RIOCARD_NOVO: _admSim_(cad[ADM_COL.VT_RIOCARD_SEM]) ? 'Sim' : 'Não',
    VT_TOTAL_DIA: _admReaisVirgula_(cad[ADM_COL.VT_TOTAL_DIA]),
    VT_MODALIDADE: tipos || (usaVT ? 'Não informada' : 'Não se aplica'),
    VT_SIM_MARCA: usaVT ? '[X]' : '[ ]',
    VT_NAO_MARCA: usaVT ? '[ ]' : (cad[ADM_COL.VT_QUER] ? '[X]' : '[ ]'),
    VT_JAE_MARCA: /ja[ée]/i.test(tipos) ? '[X]' : '[ ]',
    VT_RIOCARD_MARCA: /riocard/i.test(tipos) ? '[X]' : '[ ]',
    VT_OPCAO_RESUMO: usaVT
      ? ('Deseja receber Vale-Transporte' + (tipos ? ' — ' + tipos : ''))
      : 'Não deseja receber Vale-Transporte',
    CIDADE_DOC: cfg.CIDADE_DOC || 'Rio de Janeiro',
    CNPJ: cfg.CNPJ || '',
    DATA_HOJE: _admDataHoje_(hoje),
    _usaVT: usaVT,
    _vtRespostaInformada: /^(sim|s|true|1|quero|x|nao|não|n|false|0)(\b|\s|[,.!])/i.test(_admStr_(cad[ADM_COL.VT_QUER])),
    _experienciaDias: _admNum_(contr[ADM_CONTR_COL.EXPERIENCIA_DIAS]) || 0,
    _trechos: _admParseJSON_(cad[ADM_COL_MAP.VT_TRECHOS_JSON]) || [],
    _dependentesIR: _admKitDependentesIR_(cad),
    _racaDeclarada: _admKitCampo_(cad, ['Raça/Cor (eSocial)', 'Raca/Cor (eSocial)', 'Raça/cor (eSocial)', 'Cor/raça', 'Raça/cor', 'Cor / raça']) ||
      _admKitCampo_(contr || {}, ['Raça/Cor (eSocial)']) ||
      _admKitCampo_(trat || {}, ['Raça/Cor (eSocial)'])
  };
}

/** Localiza cabeçalhos independentemente de acentos, espaçamentos e pontuação. */
function _admKitCampo_(linha, nomes) {
  linha = linha || {};
  function chave(s) { return _admRemoverAcentos_(String(s || '')).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  var chaves = {};
  Object.keys(linha).forEach(function(k) { chaves[chave(k)] = linha[k]; });
  for (var i=0;i<nomes.length;i++) {
    var v = chaves[chave(nomes[i])];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return '';
}

function _admKitSimIR_(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = _admRemoverAcentos_(_admStr_(v)).trim().toUpperCase();
  if (/^(SIM|S|TRUE|1|X|IRRF|IR|IMPOSTO DE RENDA|SIM IRRF)$/.test(s)) return true;
  if (/^(NAO|N|FALSE|0|NAO IRRF|NAO SE APLICA)$/.test(s)) return false;
  return null;
}

/** Não confunde ter filhos com ter dependentes declarados para IRRF. */
function _admKitDependentesIR_(cad) {
  var bruto = _admKitCampo_(cad, ['Dependentes (JSON)', 'Dependentes JSON']);
  if (bruto === '') return []; // o cadastro não registrou dependentes
  var todos = typeof bruto === 'string' ? _admParseJSON_(bruto) : bruto;
  if (!Array.isArray(todos)) throw new Error('Dependentes (JSON) inválido: confira os dados do cadastro antes de emitir a declaração de IRRF.');
  var sinalizadores = ['irrf','ir','dependenteIR','paraIR','dependenteParaIRRF','dependenteParaImpostoDeRenda','deducaoIRRF','deducaoIR','Dependente para IRRF','IRRF (Sim/Não)','Para fins de IRRF','Dependente para fins de IR'];
  return todos.filter(function(d) {
    if (!d || typeof d !== 'object') throw new Error('Registro de dependente inválido no cadastro.');
    var valor = _admKitCampo_(d,sinalizadores);
    var sinal = _admKitSimIR_(valor);
    if (sinal === null) throw new Error('Não foi possível confirmar a opção de IRRF de um dependente. Confira Dependentes (JSON) antes de gerar o kit.');
    return sinal;
  }).map(function(d){
    var obj = {
      nome: _admStr_(_admKitCampo_(d,['nome','nomeCompleto','Nome completo','Nome do dependente'])),
      cpf: _admStr_(_admKitCampo_(d,['cpf','CPF do dependente'])),
      nascimento: _admDataFmt_(_admKitCampo_(d,['dataNascimento','nascimento','Data de nascimento'])),
      parentesco: _admStr_(_admKitCampo_(d,['parentesco','grauParentesco','Grau de parentesco','vinculo','tipoDependente']))
    };
    if (!obj.nome || !obj.cpf || !obj.nascimento || !obj.parentesco) throw new Error('Dependente de IRRF sem nome, CPF, nascimento ou parentesco: confira o cadastro antes de gerar o kit.');
    return obj;
  });
}

/** Normaliza a opção declarada no cadastro; não deduz raça/cor por outros dados. */
function _admKitRaca_(valor) {
  var s = _admRemoverAcentos_(_admStr_(valor)).trim().toUpperCase();
  var mapa = {'1':'Branca','2':'Preta','3':'Amarela','4':'Parda','5':'Indígena',
    'BRANCA':'Branca','BRANCO':'Branca','PRETA':'Preta','PRETO':'Preta',
    'PARDA':'Parda','PARDO':'Parda','AMARELA':'Amarela','AMARELO':'Amarela',
    'INDIGENA':'Indígena','INDIGENO':'Indígena',
    'PREFIRO NAO INFORMAR':'Prefiro não informar','NAO INFORMADO POR OPCAO':'Prefiro não informar'};
  return mapa[s] || '';
}

function _admKitAplica_(condicao, dados) {
  switch (String(condicao || 'sempre')) {
    case 'sempre': return true;
    case 'usa_vt': return !!dados._usaVT;
    case 'contrato_experiencia': return dados._experienciaDias > 0;
    default: return true;
  }
}

function _admPreencher_(txt, dados) {
  return String(txt == null ? '' : txt).replace(/\{\{(\w+)\}\}/g, function (_, k) {
    return dados[k] != null ? String(dados[k]) : '';
  });
}

function _admKitPendencias_(dados) {
  var p = [];
  if (!dados.NOME_COMPLETO) p.push('Nome completo ausente no cadastro.');
  if (!dados.CPF) p.push('CPF ausente no cadastro.');
  if (!dados._vtRespostaInformada) p.push('Opção de vale-transporte não informada (Sim/Não).');
  if (dados._usaVT && (!dados._trechos || !dados._trechos.length)) p.push('Optou por VT mas não há trechos informados.');
  if (dados._usaVT && (!dados.VT_TOTAL_DIA || _admNum_(dados.VT_TOTAL_DIA) <= 0)) p.push('Optou por VT mas o total diário não é válido.');
  if (!_admKitRaca_(dados._racaDeclarada)) p.push('Raça/Cor (eSocial) ausente ou não reconhecida na DATABASE. Confirme a opção declarada pelo próprio colaborador antes de gerar o kit.');
  return p;
}

/*__KIT_PURO_FIM__*/

function _admKitDocumentos_() {
  return [
    // DECLARACAO IRRF: depende dos campos efetivos do JSON de dependentes; validar com cadastro real.
    { id:'irrf', nome:'Declaracao de Dependentes para Fins de Imposto de Renda', ordem:1, condicao:'sempre', blocos:[
      {t:'titulo',txt:'DECLARACAO DE DEPENDENTES PARA FINS DE IMPOSTO DE RENDA'},
      {t:'par',txt:'Eu, {{NOME_COMPLETO}}, inscrito(a) no CPF {{CPF}}, declaro, para fins de retencao do Imposto de Renda na fonte, que as informacoes abaixo refletem minha situacao cadastral atual.'},
      {t:'dependentes_ir'},
      {t:'par',txt:'Declaro que os dados informados sao verdadeiros, que comunicarei qualquer alteracao que afete a condicao de dependente e que a indicacao para fins de IRRF e de minha responsabilidade. Estou ciente de que uma mesma pessoa nao deve ser utilizada como dependente em duplicidade em declaracoes nas quais isso nao seja permitido.'},
      {t:'data'},{t:'assin',label:'Assinatura do declarante'}
    ]},
    // MINUTA INTERNA: texto sugerido; validar com DP/juridico antes de uso institucional.
    { id:'responsabilidade_informacoes', nome:'Termo de Responsabilidade das Informacoes', ordem:45, condicao:'sempre', blocos:[
      {t:'titulo',txt:'TERMO DE RESPONSABILIDADE DAS INFORMACOES'},
      {t:'par',txt:'Eu, {{NOME_COMPLETO}}, CPF {{CPF}}, declaro que as informacoes e documentos fornecidos durante meu processo admissional correspondem aos dados por mim informados, estando ciente da necessidade de apresentar documentacao autentica e comunicar atualizacoes cadastrais relevantes ao Departamento Pessoal.'},
      {t:'par',txt:'Comprometo-me a informar alteracoes de endereco, contato, dependentes e demais dados que possam afetar meu cadastro ou beneficios, observadas as finalidades e os procedimentos institucionais aplicaveis.'},
      {t:'data'},{t:'assin',label:'Assinatura do colaborador'}
    ]},
    // Autodeclaracao deve ser manifestacao do colaborador; jamais inferir cor/raca.
    { id:'autodeclaracao_etnico_racial', nome:'Autodeclaracao Etnico-Racial', ordem:65, condicao:'sempre', blocos:[
      {t:'titulo',txt:'AUTODECLARACAO ETNICO-RACIAL'},
      {t:'par',txt:'Eu, {{NOME_COMPLETO}}, CPF {{CPF}}, para fins de registro cadastral, AUTODECLARO que minha cor ou raca, segundo as categorias do IBGE, e:'},
      {t:'raca_opcoes'},
      {t:'par',txt:'A opção assinalada e descrita acima reproduz a autodeclaração informada por mim no cadastro admissional.'},
      {t:'data'},{t:'assin',label:'Assinatura do declarante'}
    ]},

    { id: 'imagem_voz', nome: 'Autorização de Uso de Imagem e Voz', ordem: 10, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'AUTORIZAÇÃO DE USO DE IMAGEM E VOZ' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, portador(a) do CPF nº {{CPF}}, AUTORIZO voz, sons, conversas, fotografia, vídeo, reprodução impressa, que poderá ser utilizada em informativos, vídeos e sites editado e publicado pelo CIEDS - Centro Integrado de Estudos e Programas de Desenvolvimento Sustentável, CNPJ {{CNPJ}}, com sede na Rua Conselheiro Saraiva, 28 – 8º andar - Centro, Rio de Janeiro.' },
      { t: 'par', txt: 'A presente autorização é concedida a título gratuito, abrindo mão de qualquer remuneração pela captação, gravação, edição e uso pelo prazo de proteção da Obra previsto na Lei nº 9.610/98, abrangendo o uso da imagem e voz em todo o território nacional e internacional, nas formas de DVD, site, mídias sociais e impressos de forma institucional e de terceiros. Nenhuma das imagens poderá ser comercializada.' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Assinatura' }
    ]},
    { id: 'lgpd', nome: 'Termo de Consentimento LGPD', ordem: 20, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'TERMO DE CONSENTIMENTO PARA TRATAMENTO DE DADOS PESSOAIS' },
      { t: 'subtitulo', txt: 'LEI GERAL DE PROTEÇÃO DE DADOS PESSOAIS – LGPD' },
      { t: 'par', txt: 'Através do presente instrumento, eu {{NOME_COMPLETO}}, inscrito(a) no CPF sob nº {{CPF}}, aqui denominado(a) como TITULAR, venho por meio deste autorizar que a empresa CENTRO INTEGRADO DE ESTUDOS E PROGRAMAS DE DESENVOLVIMENTO SUSTENTÁVEL, aqui denominada como CONTROLADORA, inscrita no CNPJ sob nº {{CNPJ}}, em razão do contrato de trabalho, disponha dos meus dados pessoais e dados pessoais sensíveis, de acordo com os artigos 7º e 11 da Lei nº 13.709/2018, conforme disposto neste termo.' },
      { t: 'par', txt: 'CLÁUSULA PRIMEIRA — Dados Pessoais. O Titular autoriza a Controladora a tratar os seguintes dados: nome completo; data de nascimento; número e imagem do RG, CPF, Título de Eleitor, Certificado de Reservista e CNH (quando necessária à função); número e imagem do cartão de vale-transporte (quando utilizado); número e imagem do PIS; CTPS física e/ou digital; fotografia 3x4; certidão de casamento ou declaração de união estável; diploma/comprovante de escolaridade; endereço completo; telefones, WhatsApp e e-mails; banco, agência e conta; usuário e senha de serviços da Controladora; comunicações entre Titular e Controladora; exames e atestados médicos admissionais, periódicos, de retorno, de mudança de função e demissionais; certidão de nascimento de filhos menores de 14 anos, carteira de vacinação de menores de 7 anos e comprovante de matrícula/frequência escolar; e demais documentos específicos da função.' },
      { t: 'par', txt: 'CLÁUSULA SEGUNDA — Finalidade. Os dados serão utilizados para: identificar e contatar o Titular; cumprir obrigações legais, trabalhistas e previdenciárias, inclusive acordo/convenção coletiva; procedimentos de admissão e execução do contrato, inclusive após seu término; cumprir obrigações de órgãos de fiscalização; executar contrato do qual o Titular seja parte; a pedido do Titular; exercício regular de direitos em processo judicial, administrativo ou arbitral; proteção da vida e da incolumidade física; tutela da saúde por profissionais de saúde; interesses legítimos da Controladora; e contratação de serviços de benefícios com as empresas RioCard e/ou Sodexo, repassando a estas somente os dados de identificação necessários.' },
      { t: 'par', txt: 'CLÁUSULA TERCEIRA — Compartilhamento. A Controladora fica autorizada a compartilhar os dados com outros agentes de tratamento quando necessário às finalidades deste termo, respeitados os princípios da Lei nº 13.709/2018.' },
      { t: 'par', txt: 'CLÁUSULA QUARTA — Segurança. A Controladora se responsabiliza por manter medidas de segurança técnicas e administrativas suficientes à proteção dos dados, comunicando ao Titular e à ANPD eventual incidente que acarrete risco ou dano relevante.' },
      { t: 'par', txt: 'CLÁUSULA QUINTA — Término do Tratamento. É permitido manter e utilizar os dados durante todo o período contratual e após o término, para cumprimento de obrigação legal ou de órgãos de fiscalização, nos termos do art. 16 da Lei nº 13.709/2018.' },
      { t: 'par', txt: 'CLÁUSULA SEXTA — Revogação. O Titular poderá revogar o consentimento a qualquer tempo, por e-mail ou carta escrita, ressalvadas as hipóteses em que a Controladora poderá permanecer utilizando os dados por obrigação legal ou exercício regular de direitos.' },
      { t: 'par', txt: 'CLÁUSULA SÉTIMA — Permanência. O Titular fica ciente de que a Controladora deverá permanecer com os dados pelo período mínimo de guarda de documentos trabalhistas, previdenciários e de segurança e saúde no trabalho, mesmo após o encerramento do vínculo.' },
      { t: 'par', txt: 'CLÁUSULA OITAVA — Penalidades. Em caso de vazamento ou acesso não autorizado, as partes poderão compor os danos; não havendo acordo, a Controladora está sujeita às penalidades do art. 52 da Lei nº 13.709/2018.' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Nome do Empregado (Titular)' }
    ]},
    { id: 'ciencia_diretrizes_medicas', nome: 'Ciencia das Diretrizes de Atestados Medicos', ordem: 30, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'CIÊNCIA DAS DIRETRIZES DE ATESTADOS MÉDICOS' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, CPF {{CPF}}, declaro ter recebido as Diretrizes de Atestados Médicos, Afastamentos e Licenças disponibilizadas pelo CIEDS, que integram este kit admissional em documento próprio, e ter ciência dos procedimentos institucionais ali apresentados.' },
      { t: 'data' }, { t: 'assin', label: 'Assinatura do colaborador' }
    ]},
    { id: 'art480', nome: 'Termo de Ciência — Art. 480 da CLT (Período de Experiência)', ordem: 40, condicao: 'contrato_experiencia', blocos: [
      { t: 'titulo', txt: 'TERMO DE CIÊNCIA — ARTIGO 480 DA CLT' },
      { t: 'subtitulo', txt: 'RESCISÃO ANTECIPADA DURANTE O PERÍODO DE EXPERIÊNCIA' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, inscrito(a) no CPF sob o nº {{CPF}}, declaro estar ciente de que meu contrato de trabalho contempla um período inicial de experiência, conforme as condições e os prazos estabelecidos no contrato individual de trabalho.' },
      { t: 'par', txt: 'Declaro estar ciente de que, durante a vigência do contrato de experiência, eventual rescisão antecipada por minha iniciativa, sem justa causa, poderá ensejar indenização ao empregador pelos prejuízos comprovadamente decorrentes da rescisão, observados os requisitos e limites previstos no artigo 480 da Consolidação das Leis do Trabalho.' },
      { t: 'par', txt: 'Declaro, ainda, estar ciente de que, encerrado o período de experiência e mantido o vínculo empregatício por prazo indeterminado, não se aplica a indenização prevista no artigo 480 da CLT em razão do encerramento antecipado daquele período.' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Assinatura do colaborador' }
    ]},
    { id: 'termo_etica', nome: 'Termo de Compromisso — Código de Ética', ordem: 99, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'TERMO DE COMPROMISSO' },
      { t: 'subtitulo', txt: 'RECIBO DE ENTREGA DO CÓDIGO DE ÉTICA E DISCIPLINA' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, colaborador(a) do CIEDS (Centro Integrado de Estudos e Programas de Desenvolvimento Sustentável), recebi na data de hoje o Código de Ética e Disciplina desta Instituição.' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Assinatura' },
      { t: 'par', txt: 'CPF: {{CPF}}' }
    ]},
    { id: 'sigilo', nome: 'Termo de Responsabilidade, Confidencialidade e Sigilo', ordem: 50, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'TERMO DE RESPONSABILIDADE, CONFIDENCIALIDADE E SIGILO' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, colaborador(a) do CIEDS (Centro Integrado de Estudos e Programas de Desenvolvimento Sustentável), assumo o compromisso de proteger o patrimônio de informações desta Instituição, em forma eletrônica, física ou outra, bem como de manter confidencialidade e sigilo das informações a que tiver acesso.' },
      { t: 'par', txt: 'Por este termo comprometo-me a prestar contas pela proteção, uso e divulgação das informações a mim concedidas, aplicando-se a responsabilidade a informações confidenciais desenvolvidas internamente e a qualquer informação confidencial recebida de terceiros, sejam clientes, fornecedores ou parceiros.' },
      { t: 'par', txt: 'No caso de desligamento, voluntário ou não, estou proibido de retirar, copiar ou divulgar qualquer informação da Instituição, em qualquer forma, sendo ela de propriedade exclusiva ou confidencial. A reprodução não autorizada de materiais protegidos por direito autoral ou marca registrada, além de outros usos indevidos de propriedade intelectual pertencente à Instituição ou por ela usada, são proibidas.' },
      { t: 'par', txt: 'Comprometo-me a manter sigilo das informações confidenciais repassadas pela Instituição ou por outras empresas, inclusive clientes e/ou parceiros, salvo quando a divulgação for autorizada pelas áreas competentes.' },
      { t: 'par', txt: 'Fica reservado à Instituição o direito de monitorar o fluxo de informações em qualquer meio disponibilizado para a realização do trabalho, incluindo, sem limitação, a conta de e-mail profissional, ligações pelas linhas da Instituição, correspondências físicas e eletrônicas e demais registros, a fim de verificar o cumprimento do Código de Ética e demais normas e salvaguardar seus interesses.' },
      { t: 'par', txt: 'A vigência desta obrigação terá validade enquanto a informação não for tornada de conhecimento público por outra pessoa, ou mediante autorização escrita concedida pelas partes interessadas. Pelo não cumprimento deste Termo, fica o abaixo assinado ciente de todas as sanções judiciais que poderão advir.' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Colaborador(a)' }
    ]},
    { id: 'vale_transporte', nome: 'Formulário de Solicitação de Vale-Transporte', ordem: 60, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'FORMULÁRIO DE SOLICITAÇÃO DE VALE-TRANSPORTE' },
      { t: 'par', txt: 'Opção registrada: {{VT_SIM_MARCA}} Solicito vale-transporte.   {{VT_NAO_MARCA}} Não solicito vale-transporte.', bold: true },
      { t: 'campos', itens: [
        ['Nome completo', '{{NOME_COMPLETO}}'], ['CPF', '{{CPF}}'],
        ['Data de admissão', '{{DATA_ADMISSAO}}'], ['Endereço residencial', '{{ENDERECO_COMPLETO}}'],
        ['Bairro', '{{BAIRRO}}'], ['Município / UF', '{{CIDADE_UF}}']
      ]},
      { t: 'par', txt: 'Modalidade informada: {{VT_JAE_MARCA}} Jaé   {{VT_RIOCARD_MARCA}} RioCard.' },
      { t: 'campos', itens: [
        ['Número do RioCard', '{{RIOCARD_NUMERO}}'], ['Solicitar novo cartão?', '{{RIOCARD_NOVO}}']
      ]},
      { t: 'vt_trechos_condicionais' },
      { t: 'vt_total_condicional' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Assinatura do colaborador' }
    ]},
    { id: 'declaracao_vt', nome: 'Declaração de Vale-Transporte', ordem: 61, condicao: 'sempre', blocos: [
      { t: 'titulo', txt: 'DECLARAÇÃO DE VALE-TRANSPORTE' },
      { t: 'par', txt: 'Eu, {{NOME_COMPLETO}}, CPF nº {{CPF}}, declaro que a opção registrada no meu cadastro admissional é: {{VT_OPCAO_RESUMO}}.' },
      { t: 'vt_declaracao_contextual' },
      { t: 'esp' }, { t: 'data' }, { t: 'assin', label: 'Assinatura do colaborador' }
    ]}
  ];
}

/* ============================================================================================ */
/*  MERGE FINAL — Contrato + Ficha + Dados Pessoais (gerado) + Fixos, num PDF só, com texto       */
/*  selecionável (não é imagem). Usa pdf-lib (JS puro, carregado do CDN em tempo de execução —     */
/*  só busca o CÓDIGO da biblioteca, nenhum dado do colaborador sai daqui).                        */
/* ============================================================================================ */

// pdf-lib usa setTimeout internamente pra ceder o loop, e o Apps Script não tem timer real.
// [FIX] Essa correção PRECISA estar em escopo global e ser instalada ANTES do eval() — o código
// da biblioteca roda nesse mesmo escopo global (não no escopo local de quem chama esta função),
// então um "var setTimeout" só local (como estava antes) nunca chegava até o pdf-lib: a promise
// interna dela ficava esperando um timer que nunca disparava, e a geração do kit travava pra
// sempre (descoberto com o cadastro de teste "Teste taynara": a chamada nunca voltava).
function _pdfLibCarregar_() {
  if (typeof PDFLib !== 'undefined') return; // já carregada nesta execução

  if (typeof globalThis.setTimeout !== 'function' || !globalThis.setTimeout.__admShimSincrono) {
    globalThis.setTimeout = function (f, t) { Utilities.sleep(t || 0); return f(); };
    globalThis.setTimeout.__admShimSincrono = true;
  }

  var cdnjs = 'https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js';
  eval(UrlFetchApp.fetch(cdnjs).getContentText());
}

async function _admMergePdfs_(blobsEmOrdem, nomeSaida) {
  _pdfLibCarregar_();

  var final = await PDFLib.PDFDocument.create();
  for (var i = 0; i < blobsEmOrdem.length; i++) {
    var bytes = new Uint8Array(blobsEmOrdem[i].getBytes());
    var origem = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    var paginas = await final.copyPages(origem, origem.getPageIndices());
    paginas.forEach(function (pg) { final.addPage(pg); });
  }
  var bytesFinais = await final.save();
  return Utilities.newBlob([].slice.call(new Int8Array(bytesFinais)), 'application/pdf', nomeSaida);
}


// Localiza EXCLUSIVAMENTE o PDF individual importado do Alterdata, por tipo e protocolo.
// Nao varre a pasta raiz ou outras subpastas: nelas podem existir outros contratos
// ou documentos gerados, que nao devem ser confundidos com o contrato importado.
// Nunca escolhe arbitrariamente entre dois arquivos com o MESMO nome exato.
function _admAcharDocumentoAlterdataPorTipo_(pastaColab, tipo, protocolo) {
  if (['contrato', 'ficha', 'salario_familia'].indexOf(tipo) < 0) {
    throw new Error('Tipo Alterdata nao reconhecido: ' + tipo);
  }
  var proto = String(protocolo || '').trim();
  if (!proto || !/^ADM[A-Za-z0-9_-]+$/.test(proto)) {
    throw new Error('Protocolo invalido ao localizar documento Alterdata.');
  }
  var subpastas = pastaColab.getFoldersByName(ADM.SUBPASTAS.ALTERDATA);
  if (!subpastas.hasNext()) return { status: 'NAO_ACHOU' };
  var pastaAlterdata = subpastas.next();
  if (subpastas.hasNext()) {
    throw new Error('Mais de uma subpasta 03_Alterdata encontrada: confira a pasta do colaborador.');
  }
  var nomeExato = tipo + '_' + proto + '.pdf';
  var arquivos = pastaAlterdata.getFilesByName(nomeExato);
  var arquivo = null;
  var quantidade = 0;
  while (arquivos.hasNext()) {
    var candidato = arquivos.next();
    quantidade++;
    if (!arquivo) arquivo = candidato;
  }
  if (quantidade === 0) return { status: 'NAO_ACHOU' };
  if (quantidade > 1) return { status: 'AMBIGUO', qtd: quantidade, nome: nomeExato };
  if (arquivo.getMimeType() !== MimeType.PDF) {
    throw new Error('O arquivo ' + nomeExato + ' nao tem formato PDF.');
  }
  return { status: 'OK', arquivo: arquivo };
}

// Busca por NOME EXATO na pasta de documentos fixos (Código de Ética, Diretrizes). Erro aqui é
// sempre configuração (nome errado / arquivo não subiu ainda), então lança direto.
function _admAcharArquivoFixo_(nomeExato) {
  if (!ADM.KIT.PASTA_FIXOS_ID) throw new Error('Configure ADM.KIT.PASTA_FIXOS_ID.');
  var pasta = DriveApp.getFolderById(ADM.KIT.PASTA_FIXOS_ID);
  var it = pasta.getFilesByName(nomeExato);
  if (!it.hasNext()) throw new Error('Documento fixo não encontrado: "' + nomeExato + '". Confira o nome exato na pasta de fixos.');
  return it.next();
}

/**
 * ADMISSAO.KIT_GERAR — chamada pelo botão "Gerar Kit". NÃO monta o PDF na hora (isso pode levar
 * 60-90s por causa do merge com pdf-lib, que só funciona com await de verdade — ver nota em
 * _admKitGerarEmSegundoPlano_). Em vez disso, valida rápido, marca "Kit em preparação" e agenda
 * um gatilho avulso pra montar em segundo plano. O front já sabe ler KIT_STATUS (admKitLista) e
 * mostra o status atualizando sozinho quando a lista for recarregada.
 */
function admKitGerar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var contr = _admContratuaisPorProtocolo_(proto);
  var trat = _admTratativaMapa_()[proto] || {};

  var dados = _admKitDados_(cad, contr, trat, ADM.KIT, new Date());

  var pend = _admKitPendencias_(dados);
  var docStatus=admAlterdataStatus(user,{protocolo:proto});
  if(!docStatus.pronto) pend=pend.concat(docStatus.pendencias);

  // [FIX 2026-09-22] "forcar" nunca era lido aqui — o front pedia confirmação e reenviava
  // forcar:true, mas essa segunda chamada caía nesse mesmo bloco de novo, sempre recusando.
  // Além disso, o retorno usava ok:false, que o _api_() do portal trata como falha "dura" e
  // já lança um erro genérico antes do front conseguir ler `pendencias` e mostrar a pergunta
  // — na prática, quem tinha pendência via "não acontece nada" ao clicar em Gerar Kit.
  var forcar = !!(p && p.forcar);
  if (pend.length && !forcar) {
    return { ok: true, precisaConfirmar: true, pendencias: pend };
  }

  _admUpsertTratativa_(cad, { KIT_STATUS: ADM.STATUS.KIT_EM_PREPARACAO },
    { data: _agoraISO_(), usuario: user.EMAIL, acao: 'KIT_GERAR_AGENDADO' });

  _admAgendarKitEmSegundoPlano_(proto, true, user.EMAIL);

  _auditar_('ADMISSAO_KIT', user.EMAIL, 'ADMISSAO.KIT_GERAR', true, 'Kit admissional agendado.', { protocolo: proto });

  return { ok: true, status: 'em_preparacao', mensagem: 'Kit sendo gerado em segundo plano. Atualize a lista em instantes.' };
}

/** Cria o gatilho avulso (dispara em ~1s) e guarda o protocolo associado a ele nas Propriedades
 *  do Script — gatilhos de tempo não aceitam parâmetro direto, então o vínculo é feito pelo
 *  UID do próprio gatilho. */
function _admAgendarKitEmSegundoPlano_(proto, forcar, emailUsuario) {
  var trigger = ScriptApp.newTrigger('_admKitGerarEmSegundoPlano_').timeBased().after(1000).create();
  var uid = trigger.getUniqueId();
  PropertiesService.getScriptProperties().setProperty('ADMKIT_JOB_' + uid, JSON.stringify({
    protocolo: proto, forcar: !!forcar, usuarioEmail: emailUsuario || ''
  }));
}

function _admRemoverGatilhoPorUid_(uid) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getUniqueId() === uid) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Handler do gatilho avulso — roda como uma execução própria do Apps Script, SEM nenhuma
 * resposta HTTP pra devolver. É por isso que pode ser async e usar await de verdade (o pdf-lib
 * só funciona assim — confirmado: dentro de uma cadeia async/await real, o merge completa em
 * 65-95s; por Utilities.sleep() dentro de um doGet/doPost síncrono, nunca resolve, porque
 * Utilities.sleep() não drena a fila de microtasks do V8. E doGet/doPost não podem ser async —
 * o Apps Script recusa o retorno. Daí a necessidade deste gatilho separado.)
 */
async function _admKitGerarEmSegundoPlano_(e) {
  var uid = e && e.triggerUid;
  var props = PropertiesService.getScriptProperties();
  var chave = 'ADMKIT_JOB_' + uid;
  var bruto = props.getProperty(chave);

  if (uid) _admRemoverGatilhoPorUid_(uid);
  if (bruto) props.deleteProperty(chave);
  if (!bruto) return; // gatilho sem job associado (não deveria acontecer)

  var job = JSON.parse(bruto);
  var proto = job.protocolo;
  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) return; // cadastro sumiu nesse meio tempo

  try {
    var contr = _admContratuaisPorProtocolo_(proto);
    var trat = _admTratativaMapa_()[proto] || {};
    var dados = _admKitDados_(cad, contr, trat, ADM.KIT, new Date());

    var docsPessoais = _admKitDocumentos_()
      .filter(function (d) { return _admKitAplica_(d.condicao, dados); })
      .sort(function (a, b) { return a.ordem - b.ordem; });

    // ---- 1) Gera o PDF dos dados pessoais (os documentos preenchidos automaticamente) ----
    var temp = DocumentApp.create('KIT_' + proto + '_' + Date.now());
    var body = temp.getBody();
    body.setMarginTop(83).setMarginBottom(103).setMarginLeft(50).setMarginRight(50);
    var STYLE_BASE = {};
    STYLE_BASE[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
    STYLE_BASE[DocumentApp.Attribute.FOREGROUND_COLOR] = '#000000';
    STYLE_BASE[DocumentApp.Attribute.FONT_SIZE] = 11;
    // Espacamento ajustado em cada paragrafo. Nao definir aqui valores globais que possam distorcer a paginacao.
    body.setAttributes(STYLE_BASE);

    // Cabecalho e rodape sao sections reais, repetidos automaticamente em paginas extras.
    // Imagens extraidas do papel timbrado oficial anexado pela gestora (aspect ratio preservado).
    var h=temp.addHeader();
    _admInserirImagem_(h, _admImagemDeB64_(ADM_KIT_LOGO_B64, 'logo_CIEDS.png'), 91);
    var f=temp.addFooter();
    _admInserirImagem_(f, _admImagemDeB64_(ADM_KIT_RODAPE_B64,'rodape_CIEDS.png'), 485, DocumentApp.HorizontalAlignment.CENTER);
    docsPessoais.forEach(function (d, i) {
      // DocumentApp nao oferece Paragraph.setPageBreakBefore().
      // Inserir UMA quebra de pagina ANTES de cada novo documento,
      // preservando o fluxo natural das paginas internas do documento anterior.
      if (i > 0) body.appendPageBreak();
      _admRenderDoc_(body, d, dados);
    });
    temp.saveAndClose();
    var blobDadosPessoais = DriveApp.getFileById(temp.getId()).getAs('application/pdf');
    DriveApp.getFileById(temp.getId()).setTrashed(true);

    // ---- 2) Localiza Contrato de Trabalho e Ficha de Registro na pasta da pessoa ----
    var pasta = _admPastaDoCadastro_(cad);
    var avisos = [];

    var achouContrato = _admAcharDocumentoAlterdataPorTipo_(pasta, 'contrato', proto);
    if (achouContrato.status === 'AMBIGUO') throw new Error('Ha mais de um contrato_' + proto + '.pdf em 03_Alterdata; confira os arquivos duplicados.');
    if (achouContrato.status === 'NAO_ACHOU' && ADM.KIT.EXIGIR_ALTERDATA) throw new Error('Contrato ausente: importe e valide o PDF individual antes de gerar o kit.');

    var achouFicha = _admAcharDocumentoAlterdataPorTipo_(pasta, 'ficha', proto);
    if (achouFicha.status === 'AMBIGUO') throw new Error('Ha mais de um ficha_' + proto + '.pdf em 03_Alterdata; confira os arquivos duplicados.');
    if (achouFicha.status === 'NAO_ACHOU' && ADM.KIT.EXIGIR_ALTERDATA) throw new Error('Ficha de registro ausente: importe e valide o PDF individual antes de gerar o kit.');

    var achouFamilia=_admAcharDocumentoAlterdataPorTipo_(pasta, 'salario_familia', proto);
    if (achouFamilia.status === 'AMBIGUO') throw new Error('Ha mais de um salario_familia_' + proto + '.pdf em 03_Alterdata; confira os arquivos duplicados.');
    if (ADM.KIT.EXIGIR_SALARIO_FAMILIA && achouFamilia.status !== 'OK') throw new Error('Termo de salario-familia exigido e nao encontrado.');

    // ---- 3) Documentos fixos (mesmos pra todo mundo) ----
    var arqEtica = _admAcharArquivoFixo_(ADM.KIT.ARQ_CODIGO_ETICA);
    var arqDiretrizes = _admAcharArquivoFixo_(ADM.KIT.ARQ_DIRETRIZES);

    // ---- 4) Junta tudo num PDF só, nesta ordem: Contrato → Ficha → Dados Pessoais → Fixos ----
    var blobsEmOrdem = [];
    if (achouContrato.status === 'OK') blobsEmOrdem.push(achouContrato.arquivo.getBlob());
    if (achouFicha.status === 'OK') blobsEmOrdem.push(achouFicha.arquivo.getBlob());
    if (achouFamilia.status === 'OK') blobsEmOrdem.push(achouFamilia.arquivo.getBlob());
    blobsEmOrdem.push(blobDadosPessoais);
    blobsEmOrdem.push(arqEtica.getBlob());
    blobsEmOrdem.push(arqDiretrizes.getBlob());

    var nome = 'Kit_Admissional - ' + dados.NOME_COMPLETO + ' - ' + proto + '.pdf';
    var pdfFinal = await _admMergePdfs_(blobsEmOrdem, nome);

    var destino = _admSubpasta_(pasta, ADM.SUBPASTAS.KIT);
    var iguais = destino.getFilesByName(nome);
    while (iguais.hasNext()) { iguais.next().setTrashed(true); }
    var arquivo = destino.createFile(pdfFinal);
    // Conteudo pessoal: manter permissoes restritas herdadas da pasta no Drive.

    _admUpsertTratativa_(cad, {
      KIT_STATUS: ADM.STATUS.KIT_PRONTO,
      KIT_URL: arquivo.getUrl()
    }, { data: _agoraISO_(), usuario: job.usuarioEmail, acao: 'KIT_GERAR', arquivo: nome, documentos: docsPessoais.map(function (d){ return d.id; }), avisos: avisos });

    _auditar_('ADMISSAO_KIT', job.usuarioEmail, 'ADMISSAO.KIT_GERAR', true, 'Kit admissional gerado (contrato + ficha + dados pessoais + fixos).',
      { protocolo: proto, arquivo: nome, qtdDocsPessoais: docsPessoais.length, avisos: avisos });

  } catch (err) {
    _admUpsertTratativa_(cad, { KIT_STATUS: ADM.STATUS.KIT_ERRO },
      { data: _agoraISO_(), usuario: job.usuarioEmail, acao: 'KIT_GERAR_ERRO', erro: String(err) });
    _auditar_('ADMISSAO_KIT', job.usuarioEmail, 'ADMISSAO.KIT_GERAR', false, String(err), { protocolo: proto });
  }
}

/** Todo texto gerado pelo DP360 é preto; margens, títulos e parágrafos padronizados. */
function _admKitEstiloPar_(par, opc) {
  opc = opc || {};
  // DocumentApp.Paragraph.setLineSpacing recebe MULTIPLICADOR DE LINHAS:
  // 1 = simples, 1.15 = 1,15 linha. O valor 110 fazia o Docs reservar
  // espaco para 110 linhas, espalhando uma frase em cada pagina.
  // setSpacingAfter, por sua vez, recebe pontos: 11 pt ~ um Enter.
  par.setSpacingBefore(opc.antes == null ? 0 : opc.antes);
  par.setSpacingAfter(opc.depois == null ? 11 : opc.depois);
  par.setLineSpacing(1);
  par.setAlignment(opc.alinhamento || DocumentApp.HorizontalAlignment.JUSTIFY);
  par.editAsText().setFontFamily('Arial').setFontSize(opc.tamanho || 11)
    .setForegroundColor('#000000').setBold(!!opc.negrito);
  return par;
}

function _admRenderDoc_(body, doc, dados) {
  var pre = _admPreencher_;
  var PRETO = '#000000';
  var FONTE = 'Arial';
  doc.blocos.forEach(function (b) {
    if (b.t === 'titulo') {
      var t = body.appendParagraph(pre(b.txt, dados));
      t.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      _admKitEstiloPar_(t, {negrito:true,tamanho:12,antes:4,depois:12,alinhamento:DocumentApp.HorizontalAlignment.CENTER});
    } else if (b.t === 'subtitulo') {
      var sub=body.appendParagraph(pre(b.txt,dados));
      _admKitEstiloPar_(sub,{negrito:true,antes:0,depois:11,alinhamento:DocumentApp.HorizontalAlignment.CENTER});
    } else if (b.t === 'par') {
      _admKitEstiloPar_(body.appendParagraph(pre(b.txt, dados)), {negrito:!!b.bold});
    } else if (b.t === 'esp') {
      _admKitEstiloPar_(body.appendParagraph(''),{depois:10});
    } else if (b.t === 'data') {
      _admKitEstiloPar_(body.appendParagraph(pre('{{CIDADE_DOC}}, {{DATA_HOJE}}.', dados)),
        {antes:8,depois:12,alinhamento:DocumentApp.HorizontalAlignment.LEFT});
    } else if (b.t === 'assin') {
      _admKitEstiloPar_(body.appendParagraph('__________________________________________'),
        {depois:2,alinhamento:DocumentApp.HorizontalAlignment.CENTER});
      _admKitEstiloPar_(body.appendParagraph(b.label || 'Assinatura do colaborador'),
        {depois:10,alinhamento:DocumentApp.HorizontalAlignment.CENTER});
    } else if (b.t === 'campos') {
      var linhas=b.itens.map(function(it){return [it[0],pre(it[1],dados)];});
      var tb=body.appendTable(linhas);
      tb.setBorderColor('#000000');
      for(var r=0;r<tb.getNumRows();r++) {
        var cel0=tb.getRow(r).getCell(0), cel1=tb.getRow(r).getCell(1);
        cel0.setWidth(150); cel0.editAsText().setForegroundColor(PRETO).setFontFamily(FONTE).setFontSize(10).setBold(true);
        cel1.editAsText().setForegroundColor(PRETO).setFontFamily(FONTE).setFontSize(10);
      }
      _admKitEstiloPar_(body.appendParagraph(''),{depois:6});
    } else if (b.t === 'dependentes_ir') {
      var dep=dados._dependentesIR || [];
      if (!dep.length) {
        _admKitEstiloPar_(body.appendParagraph('(X) Declaro não possuir dependentes para fins de IRRF nesta data.'),{negrito:true,depois:16});
      } else {
        _admKitEstiloPar_(body.appendParagraph('(X) Declaro possuir os seguintes dependentes para fins de IRRF nesta data:'),
          {negrito:true,depois:12});
        var linhasIR=[['Nome completo','CPF','Nascimento','Parentesco']];
        dep.forEach(function(d){linhasIR.push([d.nome,d.cpf,d.nascimento,d.parentesco]);});
        var tir=body.appendTable(linhasIR); tir.setBorderColor(PRETO);
        for(var ii=0;ii<tir.getNumRows();ii++) {
          tir.getRow(ii).editAsText().setFontFamily(FONTE).setForegroundColor(PRETO).setFontSize(9);
        }
        tir.getRow(0).editAsText().setBold(true);
        _admKitEstiloPar_(body.appendParagraph(''),{depois:8});
      }
    } else if (b.t === 'raca_opcoes') {
      var escolha=_admKitRaca_(dados._racaDeclarada);
      if (!escolha) throw new Error('Raça/Cor (eSocial) inválida ou ausente; documento de autodeclaração não pode ser emitido sem escolha do funcionário.');
      var cores=['Branca','Preta','Parda','Amarela','Indígena','Prefiro não informar'];
      cores.forEach(function(c){
        _admKitEstiloPar_(body.appendParagraph('('+(c === escolha?'X':' ')+') '+c),{depois:5,alinhamento:DocumentApp.HorizontalAlignment.LEFT});
      });
      _admKitEstiloPar_(body.appendParagraph('Opção declarada no cadastro: '+escolha+'.'),{negrito:true,antes:8,depois:18});
    } else if (b.t === 'vt_trechos_condicionais') {
      if (dados._usaVT) {
        _admKitEstiloPar_(body.appendParagraph('TRAJETOS INFORMADOS — RESIDÊNCIA / TRABALHO / RESIDÊNCIA'),{negrito:true,depois:12});
        _admRenderDoc_(body,{blocos:[{t:'trechos'}]},dados);
      } else {
        _admKitEstiloPar_(body.appendParagraph('Trajetos e valores: não se aplica (colaborador não solicita vale-transporte).'));
      }
    } else if (b.t === 'vt_total_condicional') {
      if (dados._usaVT) _admKitEstiloPar_(body.appendParagraph('Total diário do deslocamento: R$ '+dados.VT_TOTAL_DIA),{negrito:true});
    } else if (b.t === 'vt_declaracao_contextual') {
      var declaracao=dados._usaVT
        ? 'Declaro que os trajetos e valores informados no formulário correspondem ao deslocamento habitual residência–trabalho–residência; comprometo-me a utilizar o vale-transporte exclusivamente nesses deslocamentos e a comunicar alterações de endereço, trajeto, meio de transporte ou tarifa. Estou ciente da participação do empregado mediante desconto em folha, observados os limites legais.'
        : 'Declaro que, nesta data, não solicito vale-transporte. Caso passe a necessitar do benefício, comprometo-me a informar o CIEDS e apresentar os dados de trajeto necessários à análise e concessão.';
      _admKitEstiloPar_(body.appendParagraph(declaracao));
    } else if (b.t === 'trechos') {
      var linhas2=[['Descrição','Valor ida','Valor volta']];
      (dados._trechos || []).forEach(function(t){
        linhas2.push([_admStr_(t.descricao || 'Trecho'),'R$ '+_admReaisVirgula_(t.ida || '0'),'R$ '+_admReaisVirgula_(t.volta || '0')]);
      });
      if (linhas2.length === 1) linhas2.push(['—','—','—']);
      var tt=body.appendTable(linhas2); tt.setBorderColor(PRETO);
      for(var rr=0;rr<tt.getNumRows();rr++) {
        tt.getRow(rr).editAsText().setForegroundColor(PRETO).setFontFamily(FONTE).setFontSize(10);
      }
      tt.getRow(0).editAsText().setBold(true);
      _admKitEstiloPar_(body.appendParagraph(''),{depois:6});
    }
  });
}

function _admShContratuais_() {
  var ss = _admSSCadastros_();
  return ss.getSheetByName(ADM.ABA_CONTRATUAIS);
}

function _admContratuaisPorProtocolo_(proto) {
  var sh = _admShContratuais_();
  if (!sh) return null;
  var objs = _sheetToObjects_(sh);
  for (var i = 0; i < objs.length; i++) {
    if (String(objs[i][ADM_COL.PROTOCOLO] || '') === proto) return objs[i];
  }
  return null;
}

/*  KIT ADMISSIONAL — ENVIO/VERIFICAÇÃO/DOWNLOAD NO AUTENTIQUE                                    */
/*  Mesmo cliente Autentique global de Rescisão.js (_autentiqueCriarDocumento_,                   */
/*  _autentiqueApagarDocumento_, _autentiqueToken_) e a mesma consulta genérica de                */
/*  "Ferias Recibo.gs.js" (_reciboConsultarDocumento_, que não é específica de férias).            */
/*  Diferença de arquitetura em relação ao Recibo: aqui NÃO há uma pasta compartilhada pra         */
/*  varrer — cada admissão já tem sua PRÓPRIA pasta no Drive (_admPastaDoCadastro_), então a       */
/*  busca do arquivo é sempre escopada a essa pasta (mais simples, sem cache de pasta inteira).    */
/* ============================================================================================ */

/** Garante as colunas de controle do kit ao FIM da aba de tratativa (idempotente, auto-chamada). */
function admKitSetup() {
  var sh = _admShTratativa_();
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x || '').trim(); });
  var alvo = ['KIT_ID_AUTENTIQUE', 'KIT_ENVIADO_EM', 'KIT_ASSINADO_EM'];
  var faltam = alvo.filter(function (c) { return h.indexOf(c) === -1; });
  if (!faltam.length) return 'Colunas do kit já existiam.';

  sh.getRange(1, h.length + 1, 1, faltam.length).setValues([faltam]);
  return 'Colunas criadas: ' + faltam.join(', ') + '.';
}

/** Acha o PDF do kit na pasta DESSA admissão (raiz + subpastas 04_Kit_Admissional,
 *  02_Documentos_Gerados, 01_Documentos_Recebidos), por nome contendo "kit". */
function _admKitAcharArquivo_(cad) {
  var pastaColab;
  try {
    pastaColab = _admPastaDoCadastro_(cad);
  } catch (e) {
    return { status: 'ERRO', motivo: e.message };
  }

  var candidatos = [];
  var vistos = {};

  function varrer(pasta) {
    var it = pasta.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (vistos[f.getId()]) continue;
      vistos[f.getId()] = true;
      var nome = f.getName();
      var ehPdf = /\.pdf$/i.test(nome) || f.getMimeType() === MimeType.PDF;
      if (!ehPdf) continue;
      var norm = _admRemoverAcentos_(nome).toLowerCase();
      if (norm.indexOf('kit') > -1) candidatos.push(f);
    }
  }

  varrer(pastaColab);
  [ADM.SUBPASTAS.KIT, ADM.SUBPASTAS.GERADOS, ADM.SUBPASTAS.RECEBIDOS].forEach(function (nomeSub) {
    var it = pastaColab.getFoldersByName(nomeSub);
    if (it.hasNext()) varrer(it.next());
  });

  var pastasVerificadas = ['pasta principal', ADM.SUBPASTAS.KIT, ADM.SUBPASTAS.GERADOS, ADM.SUBPASTAS.RECEBIDOS].join(', ');

  if (!candidatos.length) {
    return { status: 'NAO_ACHOU', pastasVerificadas: pastasVerificadas };
  }
  if (candidatos.length > 1) {
    return {
      status: 'AMBIGUO', qtd: candidatos.length,
      nomes: candidatos.map(function (f) { return f.getName(); })
    };
  }
  return { status: 'OK', arquivo: candidatos[0] };
}

/** DP assina primeiro (mesmo e-mail configurado pra Recibos de Férias), depois o colaborador
 *  (com CPF travando a assinatura, quando cadastrado). */
function _admKitSignatarios_(cad) {
  var email = String(cad[ADM_COL.EMAIL] || '').trim();
  if (!email || email.indexOf('@') === -1) {
    return { erro: 'Colaborador sem e-mail pessoal cadastrado.' };
  }

  var cpf = _admDigitos_(cad[ADM_COL.CPF]);
  var doColab = { email: email, action: 'SIGN' };
  var aviso = '';

  // CPF errado travado na assinatura = colaborador nunca consegue assinar (o Autentique exige
  // que ele digite exatamente esse CPF), e nada distingue isso de "ainda não assinou" — trava
  // silenciosa. Só aplica a trava com CPF que passa nos dígitos verificadores.
  if (cpf && _admCpfValido_(cpf)) {
    doColab.configs = { cpf: cpf };
  } else if (cpf) {
    aviso = 'CPF cadastrado (' + cpf + ') não é válido — enviado SEM travar por CPF. Corrija o CPF no cadastro assim que possível.';
  }

  return {
    signatarios: [
      { email: _reciboDpEmail_(), action: 'SIGN' },  // 1o: DP
      doColab                                        // 2o: colaborador
    ],
    emailColab: email,
    aviso: aviso
  };
}

/** Salva um blob já pronto (ex.: PDF assinado baixado do Autentique), removendo versão anterior
 *  com o mesmo nome. Irmã de _admSalvarTexto_, que é só pra conteúdo texto com charset fixo. */
function _admSalvarBlob_(pasta, blob) {
  var nome = blob.getName();
  var iguais = pasta.getFilesByName(nome);
  while (iguais.hasNext()) { iguais.next().setTrashed(true); }

  var arquivo = pasta.createFile(blob);
  // PDF assinado contem informacoes pessoais: preservar permissoes restritas da pasta.
  return arquivo;
}

/* ------------------------------------------------------------------------------------------- */
/*  NÚCLEO DE ENVIO/DOWNLOAD — usados pelo botão por item E pelo lote                             */
/* ------------------------------------------------------------------------------------------- */

function _admKitEnviarNucleo_(cad, user) {
  var proto = String(cad[ADM_COL.PROTOCOLO] || '');
  var trat = _admTratativaMapa_()[proto] || null;
  if (trat && String(trat.KIT_ID_AUTENTIQUE || '').trim()) {
    return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Kit já enviado antes.' };
  }

  // So sobe pro Autentique quando o status realmente for "Kit pronto" — "Kit em
  // preparação", "Erro ao gerar kit" ou sem geração pedida ainda (Pendente) não pode
  // subir. Vale tanto pro botão individual quanto pro lote, que passam os dois por aqui.
  var statusAtual = trat && trat.KIT_STATUS ? String(trat.KIT_STATUS) : 'Pendente';
  if (statusAtual !== ADM.STATUS.KIT_PRONTO) {
    return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Kit ainda não está pronto (status atual: ' + statusAtual + ').' };
  }

  var achou = _admKitAcharArquivo_(cad);
  if (achou.status === 'NAO_ACHOU') return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Kit admissional não encontrado. Procurei um PDF com "kit" no nome em: ' + achou.pastasVerificadas + '.' };
  if (achou.status === 'AMBIGUO')   return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Vários PDFs com "kit" no nome (' + achou.qtd + '): ' + achou.nomes.join(' · ') + '. Deixe só um na pasta.' };
  if (achou.status === 'ERRO')      return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: achou.motivo };

  var sig = _admKitSignatarios_(cad);
  if (sig.erro) return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: sig.erro };

  if (typeof _autentiqueCriarDocumento_ !== 'function') {
    throw new Error('Cliente do Autentique não encontrado. Confirme que Rescisão.js está no mesmo projeto da API.');
  }

  // [FIX 2026-10-05] Trava por protocolo contra envio em dobro. Em 05/10, dois lotes rodando ao
  // mesmo tempo (o botão antigo dava erro aos ~60 s e foi clicado de novo) leram a tratativa antes de
  // o outro gravar o documento e criaram 2 documentos no Autentique para 11 pessoas. Agora, sob o lock
  // do script, confere de novo a tratativa e marca o protocolo como "enviando" (CacheService, 10 min):
  // um segundo envio do mesmo kit nesse intervalo é pulado. A marca sai depois que a tratativa grava o
  // documento, ou se o envio falhar antes de criar o documento (para poder tentar de novo).
  var cacheEnvio = CacheService.getScriptCache();
  var chaveEnvio = 'ADM_KIT_ENVIANDO_' + proto;
  var lockEnvio = LockService.getScriptLock();
  if (!lockEnvio.tryLock(30000)) {
    return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Sistema ocupado no momento; tente de novo em instantes.' };
  }
  try {
    if (cacheEnvio.get(chaveEnvio)) {
      return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Envio deste kit já está em andamento.' };
    }
    var tratAgora = _admTratativaMapa_()[proto] || null;
    if (tratAgora && String(tratAgora.KIT_ID_AUTENTIQUE || '').trim()) {
      return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Kit já enviado antes.' };
    }
    cacheEnvio.put(chaveEnvio, String(Date.now()), 600);
  } finally {
    lockEnvio.releaseLock();
  }

  var nomeDoc = 'KIT ADMISSIONAL - ' + cad[ADM_COL.NOME];
  var doc = null, gravou = false;
  try {
    var blob = achou.arquivo.getBlob();
    doc = _autentiqueCriarDocumento_(nomeDoc, blob, sig.signatarios);

    _admUpsertTratativa_(cad, {
      KIT_ID_AUTENTIQUE: doc.id,
      KIT_STATUS: ADM.STATUS.KIT_PRONTO,
      KIT_URL: achou.arquivo.getUrl(),
      KIT_ENVIADO_EM: _agoraISO_(),
      ASSINATURA_STATUS: ADM.STATUS.ENVIADO_ASSINATURA
    }, { data: _agoraISO_(), usuario: user.EMAIL, acao: 'KIT_ENVIAR', arquivo: nomeDoc });
    gravou = true;
  } finally {
    // Documento criado mas tratativa não gravada: mantém a marca (10 min) para não criar outro.
    if (!doc || gravou) { try { cacheEnvio.remove(chaveEnvio); } catch (eCache) { } }
  }

  _auditar_('ADMISSAO_KIT_ENVIADO', user.EMAIL, 'ADMISSAO.KIT_ENVIAR', true,
    cad[ADM_COL.NOME] + ' -> doc ' + doc.id, { protocolo: proto });

  return { resultado: 'ENVIADO', nome: cad[ADM_COL.NOME], docId: doc.id, aviso: sig.aviso || '' };
}

function _admKitBaixarNucleo_(cad, trat, user, infoPronta) {
  var docId = String((trat && trat.KIT_ID_AUTENTIQUE) || '').trim();
  if (!docId) return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Kit ainda não enviado ao Autentique.' };

  if (String((trat && trat.ASSINATURA_URL) || '').trim()) {
    return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Kit assinado já baixado.' };
  }

  // [2026-09-24] No lote, a situação já vem da listagem em lote (_admKitConsultarVarios_); mesmos
  // campos de _reciboConsultarDocumento_ (assinado, rejeitado, assinados, total, urlAssinado).
  var info = infoPronta || _reciboConsultarDocumento_(docId);
  if (info.rejeitado) return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Documento rejeitado por um signatário.' };
  if (!info.assinado) return { resultado: 'PENDENTE', nome: cad[ADM_COL.NOME], motivo: 'Ainda não assinado (' + info.assinados + '/' + info.total + ').' };
  if (!info.urlAssinado) return { resultado: 'PENDENTE', nome: cad[ADM_COL.NOME], motivo: 'Autentique ainda não gerou o PDF assinado.' };

  // [FIX 2026-09-24] Trava por documento. Em 24/09 16:05 o download automático e o botão
  // "Baixar e arquivar todos" rodaram juntos e baixaram as mesmas 8 pessoas ao mesmo tempo,
  // duplicando cópias na pasta central. Quem chega primeiro marca o documento por 10 min (mais
  // que uma execução inteira); o outro pula. Se o download falhar, a marca sai na hora.
  var chaveBaixando = 'ADM_KIT_BAIXANDO_' + docId;
  if (!_admKitMarcarBaixando_(chaveBaixando)) {
    return { resultado: 'PULADO', nome: cad[ADM_COL.NOME], motivo: 'Outro processo está baixando este kit agora.' };
  }
  var resultado = null;
  try {
    resultado = _admKitBaixarEArquivar_(cad, user, info);
  } finally {
    if (!resultado || resultado.resultado !== 'BAIXADO') CacheService.getScriptCache().remove(chaveBaixando);
  }
  return resultado;
}

/** Marca o documento como "sendo baixado" (CacheService, 10 min). false se já estava marcado. */
function _admKitMarcarBaixando_(chave) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (cache.get(chave)) return false;
    cache.put(chave, '1', 600);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Baixa o PDF assinado do Autentique, salva em 05_Assinado, copia para a pasta central e grava
 *  na tratativa. Chamado só por _admKitBaixarNucleo_, depois das conferências e da trava. */
function _admKitBaixarEArquivar_(cad, user, info) {
  // [FIX 2026-09-22] Causa raiz do "documento em branco" na aba Assinados: este fetch nunca
  // mandou o Authorization do Autentique, e o resultado (mesmo quando era uma pagina de erro/
  // login HTML de 0 bytes) era salvo sem checagem nenhuma, como se fosse o PDF de verdade — daí
  // a maioria virar "assinado e arquivado" com um arquivo vazio por dentro. Agora manda o Bearer
  // e recusa a salvar se a resposta nao vier 200 ou nao for de fato um PDF com conteudo.
  // [FIX 2026-09-22 #2] No reparo em lote, ~1/3 das tentativas voltou HTTP 425 ("Too Early") —
  // o Autentique parece limitar a taxa de downloads em sequencia rapida do mesmo tipo de link.
  // [FIX 2026-09-23] 2s/4s/6s nao foi pausa suficiente — no reparo em lote, 13 de 86 ainda
  // vieram 425 mesmo com essa espera. Aumenta pra 5s/12s/25s (~42s no pior caso) antes de
  // desistir de vez.
  var respArq, tentativa = 0;
  var ESPERAS_425_MS = [5000, 12000, 25000];
  do {
    respArq = UrlFetchApp.fetch(info.urlAssinado, {
      headers: { Authorization: 'Bearer ' + _autentiqueToken_() },
      muteHttpExceptions: true
    });
    tentativa++;
    if (respArq.getResponseCode() === 425 && tentativa <= ESPERAS_425_MS.length) Utilities.sleep(ESPERAS_425_MS[tentativa - 1]);
  } while (respArq.getResponseCode() === 425 && tentativa <= ESPERAS_425_MS.length);

  if (respArq.getResponseCode() !== 200) {
    return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Falha ao baixar o PDF assinado do Autentique (HTTP ' + respArq.getResponseCode() + ' após ' + tentativa + ' tentativa(s)).' };
  }
  var blob = respArq.getBlob().setName('KIT ADMISSIONAL - ' + cad[ADM_COL.NOME] + ' - ASSINADO.pdf');
  if (blob.getContentType() !== 'application/pdf' || blob.getBytes().length < 1000) {
    return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'O arquivo devolvido pelo Autentique nao e um PDF valido (tipo: ' + blob.getContentType() + ', ' + blob.getBytes().length + ' bytes). Tente de novo mais tarde.' };
  }

  var pastaColab = _admPastaDoCadastro_(cad);
  var destino = _admSubpasta_(pastaColab, ADM.SUBPASTAS.ASSINADO);
  var arquivo = _admSalvarBlob_(destino, blob);
  var link = arquivo.getUrl();

  // [2026-09-24] Cópia na pasta central KITS ADMISSIONAIS ASSINADOS. Se falhar, o arquivamento na
  // pasta da pessoa continua valendo; admKitSincronizarPastaKitsAssinados completa a cópia depois.
  try { _admKitCopiarParaPastaCentral_(cad, arquivo); }
  catch (eCentral) { console.log('Cópia na pasta central falhou para ' + cad[ADM_COL.NOME] + ': ' + eCentral.message); }

  _admUpsertTratativa_(cad, {
    ASSINATURA_STATUS: ADM.STATUS.ASSINADO,
    ASSINATURA_URL: link,
    KIT_ASSINADO_EM: _agoraISO_()
  }, { data: _agoraISO_(), usuario: user.EMAIL, acao: 'KIT_BAIXAR' });

  _auditar_('ADMISSAO_KIT_BAIXADO', user.EMAIL, 'ADMISSAO.KIT_BAIXAR', true,
    cad[ADM_COL.NOME] + ' -> assinado arquivado', { protocolo: String(cad[ADM_COL.PROTOCOLO] || '') });

  return { resultado: 'BAIXADO', nome: cad[ADM_COL.NOME], link: link };
}

/* ------------------------------------------------------------------------------------------- */
/*  AÇÕES — chamadas pelo portal (ADMISSAO.KIT_*)                                                */
/* ------------------------------------------------------------------------------------------- */

/** ADMISSAO.KIT_LISTA - lista de kits por admissão, pra montar as "sessões" no portal
 *  (Pendentes / Enviados / Assinados). */
function admKitLista(user, p) {
  admKitSetup();

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();
  var cpfsVistos = {};

  // [PERF] A sincronização com a CHECK LIST (criar linha + gravar links) SAI daqui — com a
  // planilha de candidatos crescendo rápido (formulário no ar pra 100+ pessoas), gravar em cada
  // carregamento da lista passou de 20s (achado em 2026-09-18, Pendentes "não carregava" — era
  // isso). Essa parte virou admChecklistSincronizarLinks(), rodando só em segundo plano (gatilho
  // por tempo) — ver esse arquivo mais abaixo. Aqui só lê, rápido — e da CHECK LIST só o cache
  // que essa sincronização deixa (ver _admChecklistGuardarParaLista_).

  // Só entra quem se candidatou a partir de ADM.CHECKLIST_DATA_MINIMA — mesmo corte usado abaixo
  // pra quem vem só da CHECK LIST. Sem isso, cadastro antigo (teste, ou de antes do corte) ficava
  // aparecendo em Pendentes pra sempre (achado em 2026-09-18, reclamação: "gente de antes de
  // setembro ainda aparece").
  var lista = cadastros.filter(function (c) {
    var envio = _isoF_(c[ADM_COL.ENVIO]);
    return envio && envio >= ADM.CHECKLIST_DATA_MINIMA;
  }).map(function (c) {
    var proto = String(c[ADM_COL.PROTOCOLO] || '');
    var t = tratMapa[proto] || null;
    var docId = t ? String(t.KIT_ID_AUTENTIQUE || '').trim() : '';
    var assinaturaStatus = t ? String(t.ASSINATURA_STATUS || '') : '';
    var assinadoLink = t ? String(t.ASSINATURA_URL || '').trim() : '';
    var cpfDig = _admCpfChave_(c[ADM_COL.CPF]);
    if (cpfDig) cpfsVistos[cpfDig] = true;

    return {
      protocolo: proto,
      nome: c[ADM_COL.NOME],
      kitStatus: t ? (t.KIT_STATUS || 'Pendente') : 'Pendente',
      kitUrl: t ? String(t.KIT_URL || '') : '',
      assinaturaStatus: assinaturaStatus,
      assinaturaUrl: assinadoLink,
      // Link direto pro documento no Autentique, junto do link do PDF arquivado no Drive —
      // pedido explicito pra conferir os dois na aba Enviados/Assinados.
      linkAutentique: docId ? _admLinkAutentiqueDocumento_(docId) : '',
      enviado: !!docId,
      assinado: /assinad/i.test(assinaturaStatus) || !!assinadoLink,
      baixado: !!assinadoLink,
      origem: 'CADASTRO',
      lotacao: t ? (t.DEPARTAMENTO || '') : '',
      dataAdmissao: t ? _isoF_(t.DATA_ADMISSAO) : ''
    };
  });

  var checklistLinhasBrutas = [];
  try {
    checklistLinhasBrutas = _admChecklistDaLista_() || [];
    if (!checklistLinhasBrutas.length) Logger.log('admKitLista: CHECK LIST sem cache ainda (a sincronização de 15 min preenche) — segue sem ela.');
  } catch (eLeitura) {
    Logger.log('admKitLista: falha lendo o cache da CHECK LIST (' + eLeitura.message + ').');
  }

  // Fonte adicional: quem só está na planilha operacional do DP (CHECK LIST ADMISSIONAL), sem
  // pasta no Drive — por isso sem botões de Autentique, só visualização (ver renderAdmKitLista).
  // Só entra quem foi admitido a partir de ADM.CHECKLIST_DATA_MINIMA (meses anteriores já foram
  // tratados por fora, antes dessa função existir). Isolado em try/catch de propósito: se a aba
  // do ano mudar e ninguém atualizar ADM.ABA_CHECKLIST, isso não pode derrubar a lista principal
  // (formulário + Autentique).
  try {
    var candidatosChecklist = [];
    var linhaDoCandidato = []; // mesmo índice de candidatosChecklist — a linha bruta da CHECK LIST correspondente (pra gravar os links depois, sem vazar pro JSON devolvido)

    checklistLinhasBrutas.forEach(function (row) {
      var cpfDig = _admCpfChave_(row[ADM_CHECKLIST_COL.CPF]);
      if (!cpfDig || cpfsVistos[cpfDig]) return; // sem CPF não dá pra cruzar com segurança; já veio pelo formulário
      var dataAdmissao = _isoF_(row[ADM_CHECKLIST_COL.DATA_ADMISSAO]);
      if (!dataAdmissao || dataAdmissao < ADM.CHECKLIST_DATA_MINIMA) return; // mês já tratado por fora
      cpfsVistos[cpfDig] = true;

      candidatosChecklist.push({
        protocolo: '',
        nome: row[ADM_CHECKLIST_COL.NOME] || '',
        matricula: String(row[ADM_CHECKLIST_COL.MATRICULA] || '').trim(),
        kitStatus: 'Sem pasta de admissão',
        kitUrl: '',
        assinaturaStatus: '',
        assinaturaUrl: '',
        linkAutentique: '',
        enviado: false,
        assinado: false,
        baixado: false,
        origem: 'CHECKLIST',
        lotacao: row[ADM_CHECKLIST_COL.LOTACAO] || '',
        dataAdmissao: dataAdmissao
      });
      linhaDoCandidato.push(row);
    });

    // Cruza com o Autentique: quem já tem "FICHA <NOME>" lá não é mais "sem pasta" — já foi
    // enviado (e pode até já estar assinado). Só chama a API se sobrou alguém pra checar.
    if (candidatosChecklist.length) {
      try {
        var corte = _isoF_(_addDiasF_(_dataF_(ADM.CHECKLIST_DATA_MINIMA), -30));
        var fichas = _admAutentiqueFichasRecentes_(corte);
        candidatosChecklist.forEach(function (item, idx) {
          var achado = fichas[_admNormalizarNome_(item.nome)];
          if (!achado) return;
          item.enviado = true;
          item.assinado = achado.assinado;
          item.kitStatus = achado.assinado ? 'Assinado' : 'Pendente de assinatura no Autentique';
          item.linkAutentique = _admLinkAutentiqueDocumento_(achado.id);

          // [PERF 2026-09-22] Antes, checava aqui mesmo (ao vivo) se já tinha sido baixado e
          // arquivado na pasta do Drive (2026/<mês>/<lotação>/<matrícula> - <nome>/) — uma
          // varredura de pastas por pessoa, que sozinha respondia por ~15s dos ~25s que a lista
          // toda levava pra carregar (achado 2026-09-22, medido com diagAdmPerf). Passa a ler o
          // link já calculado pelo admChecklistSincronizarLinks() em segundo plano (gatilho de
          // 15 min — ver criarGatilhoSincronizacaoChecklistAdmissao()), sem nenhuma chamada ao
          // Drive aqui. Só troca de "Assinado" pra "Assinado e arquivado" depois que o próximo
          // ciclo do gatilho gravar o link — atraso de no máximo 15 min, aceitável.
          // [FIX 2026-09-22] Essa primeira versão do PERF usava 'LINK PASTA DRIVE' aqui, que é
          // o link da PASTA (só navegação), não do ARQUIVO — a aba Assinados abria a pasta do
          // Drive em vez do PDF assinado, aparecendo como um documento em branco pra todo mundo.
          // Usa 'LINK ARQUIVO ASSINADO', que aponta pro PDF de verdade.
          var linkArquivoCache = String((linhaDoCandidato[idx] && linhaDoCandidato[idx]['LINK ARQUIVO ASSINADO']) || '').trim();
          if (linkArquivoCache) {
            item.baixado = true;
            item.assinaturaUrl = linkArquivoCache;
            item.kitStatus = 'Assinado e arquivado';
          }
        });
      } catch (eAut) {
        Logger.log('admKitLista: falha consultando Autentique pra checklist (' + eAut.message + ') — segue sem cruzar.');
      }
    }

    lista = lista.concat(candidatosChecklist);
  } catch (e) {
    Logger.log('admKitLista: falha lendo checklist operacional (' + e.message + ') — seguindo só com o formulário.');
  }

  // [2026-09-24] Pedido do DP: admissao de um mes que ainda nao comecou (ex.: outubro, visto em
  // setembro) nao aparece na lista; entra sozinha quando o mes chegar. Quem ja foi enviado ao
  // Autentique continua em Enviados/Assinados. Sem data de admissao continua aparecendo.
  var mesCorrenteKit = Utilities.formatDate(new Date(), DP360.FUSO, 'yyyy-MM');
  lista = lista.filter(function (x) {
    return x.enviado || !x.dataAdmissao || String(x.dataAdmissao).slice(0, 7) <= mesCorrenteKit;
  });

  return {
    ok: true,
    lista: lista,
    pendentes: lista.filter(function (x) { return !x.enviado; }).length,
    enviados: lista.filter(function (x) { return x.enviado && !x.baixado; }).length,
    assinados: lista.filter(function (x) { return x.baixado; }).length
  };
}

/**
 * [PERF] Sincronização da CHECK LIST em segundo plano — a parte que SAIU de admKitLista (ver
 * comentário lá, achado em 2026-09-18: gravar isso a cada carregamento da lista chegou a levar
 * ~21s com 70+ cadastros). Faz 2 coisas, pensada pra rodar por gatilho de tempo ou disparo manual
 * (ainda nenhum dos dois configurado — só a função existe por enquanto):
 *  1) Formulário → CHECK LIST: garante 1 linha por candidato (a partir de ADM.CHECKLIST_DATA_MINIMA)
 *     e grava o link do Autentique (se já tem kit) + o link da pasta do Drive do cadastro.
 *  2) CHECK LIST (quem não veio do formulário): grava o link do Autentique + da pasta arquivada
 *     no Drive pra quem o admKitLista já teria cruzado com uma ficha assinada/enviada.
 */
function admChecklistSincronizarLinks() {
  admKitSetup();
  _admChecklistSetup_();

  var resumo = { linhasCriadas: 0, linksGravados: 0, erros: [] };

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();
  var checklistLinhasBrutas = _admChecklistCadastros_();
  try {
    resumo.linhasNoCacheDaLista = _admChecklistGuardarParaLista_(checklistLinhasBrutas);
  } catch (eCache) {
    resumo.erros.push('Cache da lista de kits: ' + eCache.message);
  }
  var checklistPorCpf = {};
  checklistLinhasBrutas.forEach(function (row) {
    var cpfDig = _admCpfChave_(row[ADM_CHECKLIST_COL.CPF]);
    if (cpfDig) checklistPorCpf[cpfDig] = row;
  });

  var cpfsVistos = {};

  cadastros.forEach(function (c) {
    var envio = _isoF_(c[ADM_COL.ENVIO]);
    if (!envio || envio < ADM.CHECKLIST_DATA_MINIMA) return;

    var cpfDig = _admCpfChave_(c[ADM_COL.CPF]);
    if (cpfDig) cpfsVistos[cpfDig] = true;

    try {
      var proto = String(c[ADM_COL.PROTOCOLO] || '');
      var t = tratMapa[proto] || null;
      var existiaAntes = !!(cpfDig && checklistPorCpf[cpfDig]);

      var linhaChecklist = _admChecklistGarantirLinha_(c, t, checklistPorCpf);
      if (linhaChecklist && !existiaAntes) resumo.linhasCriadas++;

      var linkAutentique = t && t.KIT_ID_AUTENTIQUE ? _admLinkAutentiqueDocumento_(t.KIT_ID_AUTENTIQUE) : '';
      var linkDrive = String(c[ADM_COL.PASTA] || '');
      if (linhaChecklist && (linkAutentique || linkDrive)) {
        _admChecklistAtualizarLinks_(linhaChecklist, linkAutentique, linkDrive);
        resumo.linksGravados++;
      }
    } catch (eSync) {
      resumo.erros.push('Cadastro ' + (c[ADM_COL.NOME] || '') + ': ' + eSync.message);
    }
  });

  try {
    var corte = _isoF_(_addDiasF_(_dataF_(ADM.CHECKLIST_DATA_MINIMA), -30));
    var fichas = _admAutentiqueFichasRecentes_(corte);

    checklistLinhasBrutas.forEach(function (row) {
      var cpfDig = _admCpfChave_(row[ADM_CHECKLIST_COL.CPF]);
      if (!cpfDig || cpfsVistos[cpfDig]) return; // já veio pelo formulário, já foi tratado acima
      var dataAdmissao = _isoF_(row[ADM_CHECKLIST_COL.DATA_ADMISSAO]);
      if (!dataAdmissao || dataAdmissao < ADM.CHECKLIST_DATA_MINIMA) return;

      var nome = row[ADM_CHECKLIST_COL.NOME] || '';
      var achado = fichas[_admNormalizarNome_(nome)];
      if (!achado) return;

      try {
        var linkAutentique = _admLinkAutentiqueDocumento_(achado.id);
        var matricula = String(row[ADM_CHECKLIST_COL.MATRICULA] || '').trim();
        var lotacao = row[ADM_CHECKLIST_COL.LOTACAO] || '';
        var infoDrive = _admChecklistArquivoArquivado_(dataAdmissao, lotacao, matricula, nome);
        _admChecklistAtualizarLinks_(row, linkAutentique, infoDrive.pastaUrl, infoDrive.arquivoUrl);
        resumo.linksGravados++;
      } catch (eLinks) {
        resumo.erros.push('CHECK LIST ' + nome + ': ' + eLinks.message);
      }
    });
  } catch (eAut) {
    resumo.erros.push('Consulta Autentique: ' + eAut.message);
  }

  return resumo;
}

/** ADMISSAO.KIT_VER - só leitura, mesma busca usada antes de enviar, sem enviar nada.
 *  payload: { protocolo } */
function admKitVer(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var achou = _admKitAcharArquivo_(cad);
  if (achou.status === 'NAO_ACHOU') throw new Error('Kit admissional não encontrado. Procurei um PDF com "kit" no nome em: ' + achou.pastasVerificadas + '.');
  if (achou.status === 'AMBIGUO')   throw new Error('Vários PDFs com "kit" no nome (' + achou.qtd + '): ' + achou.nomes.join(' · ') + '. Deixe só um na pasta.');
  if (achou.status === 'ERRO')      throw new Error(achou.motivo);

  return { ok: true, kitUrl: achou.arquivo.getUrl(), kitNome: achou.arquivo.getName() };
}

/** ADMISSAO.KIT_ENVIAR - um kit. payload: { protocolo } */
function admKitEnviar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var r = _admKitEnviarNucleo_(cad, user);
  if (r.resultado === 'ENVIADO') {
    var msg = 'Kit de ' + String(r.nome).split(' ')[0] + ' enviado ao Autentique.';
    if (r.aviso) msg += ' ⚠️ ' + r.aviso;
    return { ok: true, docId: r.docId, aviso: r.aviso || '', mensagem: msg };
  }
  if (r.resultado === 'PULADO')  return { ok: true, pulado: true, mensagem: r.motivo || 'Este kit já tinha sido enviado.' };
  throw new Error(r.motivo || 'Não foi possível enviar o kit.');
}

/** ADMISSAO.KIT_ENVIAR_LOTE - todos os pendentes (ou a lista de protocolos em payload.protocolos).
 *  Para antes dos 6 min do Apps Script e reporta o resumo, igual ao lote de Recibos/RioCard. */
function admKitEnviarLote(user, p) {
  var protocolosAlvo = (p && p.protocolos) || [];
  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var fila = cadastros.filter(function (c) {
    var proto = String(c[ADM_COL.PROTOCOLO] || '');
    if (protocolosAlvo.length) return protocolosAlvo.indexOf(proto) > -1;
    var t = tratMapa[proto];
    // [FIX 2026-09-24] Só entra na fila quem está com o kit pronto e ainda não foi enviado.
    // Antes a fila tinha todo cadastro não enviado, e o lote gastava tempo pulando um por um.
    return !!t && !String(t.KIT_ID_AUTENTIQUE || '').trim() &&
      String(t.KIT_STATUS || '') === ADM.STATUS.KIT_PRONTO;
  });

  var t0 = Date.now();
  var LIMITE_MS = 4.5 * 60 * 1000;
  // [FIX 2026-09-24] Pausa curta entre envios: o Autentique bloqueia rajadas de pedidos, e
  // antes cada clique enviava ~20 kits e marcava todo o resto como erro.
  var PAUSA_ENTRE_ENVIOS_MS = 2000;
  var enviados = 0, pulados = 0, erros = 0, naoProcessados = 0;
  var bloqueadoAutentique = false;
  var detalhes = [], motivosErro = [];

  for (var i = 0; i < fila.length; i++) {
    if (Date.now() - t0 > LIMITE_MS) { naoProcessados = fila.length - i; break; }
    var cad = fila[i];
    try {
      var r = _admKitEnviarNucleo_(cad, user);
      if (r.resultado === 'ENVIADO') {
        enviados++;
        detalhes.push('OK ' + r.nome);
        if (i < fila.length - 1) Utilities.sleep(PAUSA_ENTRE_ENVIOS_MS);
      }
      else if (r.resultado === 'PULADO') { pulados++; }
      else {
        erros++;
        detalhes.push('ERRO ' + r.nome + ': ' + r.motivo);
        motivosErro.push(r.nome + ': ' + r.motivo);
      }
    } catch (e) {
      if (e && e.limiteAutentique) {
        // O Autentique continuou bloqueando mesmo depois das esperas: para aqui sem marcar
        // ninguém como erro. Quem sobrou vai no próximo clique.
        bloqueadoAutentique = true;
        naoProcessados = fila.length - i;
        break;
      }
      erros++;
      detalhes.push('ERRO ' + cad[ADM_COL.NOME] + ': ' + e.message);
      motivosErro.push(cad[ADM_COL.NOME] + ': ' + e.message);
    }
  }

  _auditar_('ADMISSAO_KIT_LOTE', user.EMAIL, 'ADMISSAO.KIT_ENVIAR_LOTE', true,
    'enviados ' + enviados + ' . erros ' + erros + (naoProcessados ? ' . restaram ' + naoProcessados : '') +
    (bloqueadoAutentique ? ' . bloqueado pelo Autentique' : ''), {});

  var mensagem = enviados + ' enviado(s), ' + erros + ' com erro.';
  if (pulados) mensagem += ' ' + pulados + ' ainda não estava(m) com o kit pronto (pulado).';
  if (bloqueadoAutentique) {
    mensagem += ' O Autentique pediu uma pausa: restaram ' + naoProcessados + '. Aguarde 1 minuto e clique de novo.';
  } else if (naoProcessados) {
    mensagem += ' Restaram ' + naoProcessados + ' - clique de novo para continuar.';
  }
  if (motivosErro.length) {
    var listaErros = motivosErro.slice(0, 3).join(' | ') +
      (motivosErro.length > 3 ? ' (e mais ' + (motivosErro.length - 3) + ')' : '');
    mensagem += ' Erros: ' + listaErros + (/\.$/.test(listaErros) ? '' : '.');
  }
  return {
    ok: true, enviados: enviados, pulados: pulados, erros: erros, naoProcessados: naoProcessados,
    bloqueadoAutentique: bloqueadoAutentique, detalhes: detalhes, mensagem: mensagem
  };
}

/* [FIX 2026-09-23] Verificação de assinatura resistente ao limite de pedidos do Autentique.
 * Antes, o "Verificar todos" consultava documento por documento, sem pausa; com ~180 kits o
 * Autentique respondia "Too Many Attempts" e a maioria virava erro — escondido da mensagem.
 * Mesmo critério de "assinado" de _reciboConsultarDocumento_ (todas as assinaturas feitas). */
function _admAutentiquePost_(query, vars) {
  var ultimo = '';
  for (var tent = 0; tent < 4; tent++) {
    if (tent > 0) Utilities.sleep(5000 * tent);
    var resp = UrlFetchApp.fetch(_reciboEndpoint_(), {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + _autentiqueToken_() },
      payload: JSON.stringify({ query: query, variables: vars || {} }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var txt = resp.getContentText();
    ultimo = 'HTTP ' + code + ': ' + txt.substring(0, 150);
    if (code === 429 || code === 425 || code >= 500 || /too many attempts/i.test(txt)) continue;
    var json;
    try { json = JSON.parse(txt); } catch (e) { throw new Error('Resposta inválida do Autentique (' + ultimo + ')'); }
    if (json.errors) throw new Error('Autentique recusou a consulta: ' + JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error('Autentique bloqueou por excesso de pedidos (' + ultimo + ')');
}

/** Resume as assinaturas de um documento: completo só com TODAS feitas; separa DP x pessoa. */
function _admKitResumoAssinaturas_(doc) {
  var sigs = doc.signatures || [];
  var dpEmail = String(_reciboDpEmail_() || '').toLowerCase();
  var total = sigs.length;
  var assinados = sigs.filter(function (s) { return !!s.signed; }).length;
  var faltaDp = sigs.some(function (s) { return String(s.email || '').toLowerCase() === dpEmail && !s.signed; });
  var faltaPessoa = sigs.some(function (s) { return String(s.email || '').toLowerCase() !== dpEmail && !s.signed; });
  // [2026-09-24] usados pela assinatura automática do DP (admKitAssinarDpLote)
  var outrosAssinados = sigs.filter(function (s) { return String(s.email || '').toLowerCase() !== dpEmail && !!s.signed; }).length;
  return {
    nome: String(doc.name || ''),
    total: total, assinados: assinados,
    assinado: total > 0 && assinados === total,
    rejeitado: sigs.some(function (s) { return !!s.rejected; }),
    urlAssinado: (doc.files && doc.files.signed) ? doc.files.signed : '',
    faltaDp: faltaDp, faltaPessoa: faltaPessoa, outrosAssinados: outrosAssinados
  };
}

var ADM_KIT_DOC_CAMPOS_ = 'id name signatures { email signed { created_at } rejected { created_at } } files { signed }';

/** Um documento, com retentativa. */
function _admKitConsultarDoc_(docId) {
  var data = _admAutentiquePost_('query($id: UUID!){ document(id: $id){ ' + ADM_KIT_DOC_CAMPOS_ + ' } }', { id: docId });
  var doc = data && data.document;
  if (!doc) throw new Error('Documento não encontrado no Autentique (ID ' + docId + ').');
  return _admKitResumoAssinaturas_(doc);
}

/** Vários documentos de uma vez, pela listagem da conta (60 por página, do mais novo pro mais
 *  velho), parando quando achar todos os IDs pedidos. Devolve { mapa: {id: info}, erro }. */
function _admKitConsultarVarios_(ids, limiteMs) {
  var faltam = {};
  ids.forEach(function (id) { faltam[id] = true; });
  var qtdFaltam = Object.keys(faltam).length;
  var mapa = {};
  var t0 = Date.now();
  var erro = '';
  for (var pagina = 1; pagina <= 60 && qtdFaltam > 0; pagina++) {
    if (Date.now() - t0 > limiteMs) break;
    if (pagina > 1) Utilities.sleep(1500);
    var data;
    try {
      data = _admAutentiquePost_('query($p: Int){ documents(limit: 60, page: $p){ total data { ' + ADM_KIT_DOC_CAMPOS_ + ' } } }', { p: pagina });
    } catch (e) { erro = String(e.message || e); break; }
    var docs = (data && data.documents && data.documents.data) || [];
    docs.forEach(function (d) {
      if (faltam[d.id]) { mapa[d.id] = _admKitResumoAssinaturas_(d); delete faltam[d.id]; qtdFaltam--; }
    });
    if (docs.length < 60) break;
  }
  return { mapa: mapa, erro: erro };
}

/** Núcleo de verificação — usado pelo botão por item E pelo lote. Consulta o Autentique em
 *  tempo real e, se já estiver assinado por todos, atualiza ASSINATURA_STATUS na tratativa. */
function _admKitVerificarNucleo_(cad, trat, user, infoPronta) {
  var docId = String((trat && trat.KIT_ID_AUTENTIQUE) || '').trim();
  if (!docId) return { resultado: 'ERRO', nome: cad[ADM_COL.NOME], motivo: 'Este kit ainda não foi enviado ao Autentique.' };

  // [FIX 2026-09-23] Consulta com retentativa quando o Autentique responde "Too Many Attempts"
  // (antes, esse bloqueio virava erro silencioso). No lote, a info já vem pronta da listagem.
  var info = infoPronta || _admKitConsultarDoc_(docId);

  if (info.assinado && !/assinad/i.test(String((trat && trat.ASSINATURA_STATUS) || ''))) {
    _admUpsertTratativa_(cad, { ASSINATURA_STATUS: ADM.STATUS.ASSINADO },
      { data: _agoraISO_(), usuario: user.EMAIL, acao: 'KIT_VERIFICAR', resultado: 'assinado' });
  }

  return {
    resultado: info.rejeitado ? 'REJEITADO' : (info.assinado ? 'ASSINADO' : 'PENDENTE'),
    nome: cad[ADM_COL.NOME],
    assinado: info.assinado, rejeitado: info.rejeitado, assinados: info.assinados, total: info.total,
    faltaDp: !!info.faltaDp, faltaPessoa: !!info.faltaPessoa
  };
}

/** ADMISSAO.KIT_VERIFICAR - consulta o Autentique em tempo real. payload: { protocolo } */
function admKitVerificar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var trat = _admTratativaMapa_()[proto] || null;
  if (!trat || !String(trat.KIT_ID_AUTENTIQUE || '').trim()) throw new Error('Este kit ainda não foi enviado ao Autentique.');

  var r = _admKitVerificarNucleo_(cad, trat, user);

  var mensagem = r.resultado === 'REJEITADO'
    ? 'Um signatário rejeitou o documento.'
    : (r.resultado === 'ASSINADO'
        ? 'Assinado por todos (' + r.assinados + '/' + r.total + '). Já pode baixar.'
        : 'Ainda não assinado (' + r.assinados + '/' + r.total + ').');

  return { ok: true, assinado: r.assinado, rejeitado: r.rejeitado, assinados: r.assinados, total: r.total, mensagem: mensagem };
}

/** ADMISSAO.KIT_VERIFICAR_LOTE - confere a assinatura de todo mundo já enviado e ainda não
 *  baixado (pedido explícito: um botão que checa se os documentos da sessão Enviados estão
 *  assinados, sem precisar clicar pessoa por pessoa). */
function admKitVerificarLote(user, p) {
  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var fila = cadastros.filter(function (c) {
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return t && String(t.KIT_ID_AUTENTIQUE || '').trim() && !String(t.ASSINATURA_URL || '').trim();
  });

  var t0 = Date.now();
  var LIMITE_MS = 4.5 * 60 * 1000;

  // [FIX 2026-09-23] Busca tudo pela listagem (poucas consultas, com pausa) em vez de um pedido
  // por documento sem pausa — era isso que estourava o limite do Autentique.
  var ids = fila.map(function (c) { return String(tratMapa[String(c[ADM_COL.PROTOCOLO] || '')].KIT_ID_AUTENTIQUE).trim(); });
  var lista = _admKitConsultarVarios_(ids, 2.5 * 60 * 1000);

  var assinados = 0, faltaSoDp = 0, faltaPessoa = 0, rejeitados = 0, erros = 0, naoProcessados = 0;
  var naoExistem = [];
  var detalhesErro = [];
  var avulsas = 0;

  for (var i = 0; i < fila.length; i++) {
    if (Date.now() - t0 > LIMITE_MS) { naoProcessados = fila.length - i; break; }
    var cad = fila[i];
    var t = tratMapa[String(cad[ADM_COL.PROTOCOLO] || '')];
    var info = lista.mapa[String(t.KIT_ID_AUTENTIQUE).trim()] || null;
    try {
      if (!info) {
        // não apareceu na listagem: consulta avulsa, com pausa pra não estourar o limite
        if (avulsas > 0) Utilities.sleep(1200);
        avulsas++;
      }
      var r = _admKitVerificarNucleo_(cad, t, user, info);
      if (r.resultado === 'ASSINADO') assinados++;
      else if (r.resultado === 'REJEITADO') rejeitados++;
      else if (r.faltaPessoa) faltaPessoa++;
      else faltaSoDp++;
    } catch (e) {
      var msgErro = String(e.message || e);
      // documento cancelado/excluído no Autentique: clicar de novo não resolve, precisa reenviar
      if (/document_not_found|não encontrado no Autentique/i.test(msgErro)) { naoExistem.push(cad[ADM_COL.NOME]); continue; }
      erros++;
      if (detalhesErro.length < 10) detalhesErro.push(cad[ADM_COL.NOME] + ': ' + msgErro.substring(0, 160));
    }
  }

  var pendentes = faltaSoDp + faltaPessoa;
  _auditar_('ADMISSAO_KIT_VERIFICAR_LOTE', user.EMAIL, 'ADMISSAO.KIT_VERIFICAR_LOTE', true,
    'assinados ' + assinados + ' . falta so DP ' + faltaSoDp + ' . falta pessoa ' + faltaPessoa +
    ' . rejeitados ' + rejeitados + ' . nao existem ' + naoExistem.length + ' . erros ' + erros + ' . restaram ' + naoProcessados +
    ' . avulsas ' + avulsas + (lista.erro ? ' . listagem: ' + lista.erro.substring(0, 120) : ''),
    { erros: detalhesErro, naoExistem: naoExistem });

  var partes = [assinados + ' assinado(s) por todos'];
  if (faltaSoDp) partes.push(faltaSoDp + ' aguardando só a assinatura do DP (' + _reciboDpEmail_() + ')');
  if (faltaPessoa) partes.push(faltaPessoa + ' aguardando a assinatura do colaborador');
  if (rejeitados) partes.push(rejeitados + ' rejeitado(s)');
  var mensagem = partes.join(', ') + '.';
  if (naoExistem.length) mensagem += ' ' + naoExistem.length + ' não existe(m) mais no Autentique (cancelado/excluído — precisa reenviar): ' + naoExistem.join(', ') + '.';
  if (erros) mensagem += ' ' + erros + ' não puderam ser consultados agora — clique de novo em alguns minutos.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' — clique de novo.';

  return {
    ok: true, assinados: assinados, pendentes: pendentes, faltaSoDp: faltaSoDp, faltaPessoa: faltaPessoa,
    rejeitados: rejeitados, naoExistem: naoExistem, erros: erros, naoProcessados: naoProcessados, detalhesErro: detalhesErro, mensagem: mensagem
  };
}

/** ADMISSAO.KIT_BAIXAR - baixa o kit assinado pra pasta 05_Assinado. payload: { protocolo } */
function admKitBaixar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var trat = _admTratativaMapa_()[proto] || null;
  var r = _admKitBaixarNucleo_(cad, trat, user);
  if (r.resultado === 'BAIXADO')  return { ok: true, link: r.link, mensagem: 'Kit assinado de ' + String(r.nome).split(' ')[0] + ' salvo na pasta de assinados.' };
  if (r.resultado === 'PULADO')   return { ok: true, pulado: true, mensagem: /outro processo/i.test(r.motivo || '') ? r.motivo : 'O kit assinado já tinha sido baixado.' };
  if (r.resultado === 'PENDENTE') throw new Error(r.motivo);
  throw new Error(r.motivo || 'Não foi possível baixar o kit assinado.');
}

/** ADMISSAO.KIT_BAIXAR_LOTE - baixa todos os kits assinados ainda não arquivados. */
function admKitBaixarLote(user, p) {
  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var fila = cadastros.filter(function (c) {
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return t && String(t.KIT_ID_AUTENTIQUE || '').trim() && !String(t.ASSINATURA_URL || '').trim();
  });

  var t0 = Date.now();
  var LIMITE_MS = 4.5 * 60 * 1000;
  var baixados = 0, pendentes = 0, erros = 0, naoProcessados = 0;

  // [PERF 2026-09-24] Antes: uma consulta ao Autentique por pessoa, com pausa de 0,7 s — com
  // ~200 kits enviados, cada passada do gatilho levava ~4,5 min, 96 vezes por dia, e ameaçava a
  // cota diária de execução da conta (6 h/dia, compartilhada com as outras automações). Agora:
  // uma listagem em lote (60 documentos por página, a mesma do "Verificar todos"); só quem já
  // está assinado por todos segue para o download. Quem não aparece na listagem é consultado
  // avulso, com pausa, como antes.
  var ids = fila.map(function (c) { return String(tratMapa[String(c[ADM_COL.PROTOCOLO] || '')].KIT_ID_AUTENTIQUE).trim(); });
  var lista = _admKitConsultarVarios_(ids, 2 * 60 * 1000);
  var chamadasAutentique = 0;

  for (var i = 0; i < fila.length; i++) {
    if (Date.now() - t0 > LIMITE_MS) { naoProcessados = fila.length - i; break; }
    var cad = fila[i];
    var t = tratMapa[String(cad[ADM_COL.PROTOCOLO] || '')];
    var info = lista.mapa[String(t.KIT_ID_AUTENTIQUE).trim()] || null;
    // Ainda falta assinatura: nada a baixar, e sem nenhum pedido ao Autentique.
    if (info && !info.assinado && !info.rejeitado) { pendentes++; continue; }
    // [FIX 2026-09-23] Pausa curta entre pedidos — reduz a chance de disparar o rate-limit
    // (HTTP 425) do Autentique numa sequência rápida de downloads.
    // Documento rejeitado não vai à rede: o núcleo só devolve o erro.
    var vaiAoAutentique = !(info && info.rejeitado);
    if (vaiAoAutentique && chamadasAutentique > 0) Utilities.sleep(info ? 700 : 1200);
    if (vaiAoAutentique) chamadasAutentique++;
    try {
      var r = _admKitBaixarNucleo_(cad, t, user, info);
      if (r.resultado === 'BAIXADO') baixados++;
      else if (r.resultado === 'PENDENTE') pendentes++;
      else if (r.resultado === 'ERRO') erros++;
    } catch (e) { erros++; }
  }

  _auditar_('ADMISSAO_KIT_BAIXAR_LOTE', user.EMAIL, 'ADMISSAO.KIT_BAIXAR_LOTE', true,
    'baixados ' + baixados + ' . pendentes ' + pendentes + ' . erros ' + erros, {});

  var mensagem = baixados + ' kit(s) assinado(s) baixado(s), ' + pendentes + ' ainda sem assinar.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' - clique de novo.';
  return { ok: true, baixados: baixados, pendentes: pendentes, erros: erros, naoProcessados: naoProcessados, mensagem: mensagem };
}

/**
 * Roda sozinha, a cada 15 min (gatilho de tempo, ver criarGatilhoKitAutomatico). Confere todo
 * kit enviado e ainda não baixado e, assim que detecta que os DOIS já assinaram, baixa e
 * arquiva em 05_Assinado sem esperar ninguém do DP clicar em "Baixar Kit". Reaproveita o mesmo
 * núcleo do botão manual (admKitBaixarLote -> _admKitBaixarNucleo_) — só baixa quando
 * _reciboConsultarDocumento_ confirma COMPLETAMENTE assinado; se estiver faltando alguém, essa
 * pessoa continua em "Enviados" até a próxima passada do gatilho.
 */
function admKitVerificarEBaixarAutomatico() {
  var inicio = Date.now();
  var usuarioSistema = { EMAIL: 'sistema-automatico@dp360' };
  var r = admKitBaixarLote(usuarioSistema, {});
  console.log('admKitVerificarEBaixarAutomatico: ' + r.mensagem);

  // [2026-09-24] Com o tempo que sobrar (limite do Apps Script: 6 min), completa a pasta central
  // KITS ADMISSIONAIS ASSINADOS com o que ainda não estiver lá (backfill e falhas de cópia).
  try {
    var s = admKitSincronizarPastaKitsAssinados(usuarioSistema, { prazo: inicio + 5.25 * 60 * 1000 });
    console.log('Pasta central: ' + s.mensagem);
  } catch (eSinc) {
    console.log('Sincronização da pasta central falhou: ' + eSinc.message);
  }
  return r.mensagem;
}

/** Rodar UMA VEZ pra ligar o download automático do Kit (idempotente — não duplica o gatilho). */
function criarGatilhoKitAutomatico() {
  var jaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'admKitVerificarEBaixarAutomatico';
  });
  if (jaExiste) return 'Gatilho de download automático do Kit já existia, não criei outro.';

  ScriptApp.newTrigger('admKitVerificarEBaixarAutomatico').timeBased().everyMinutes(15).create();
  return 'Gatilho criado: a cada 15 min, confere os kits enviados e baixa sozinho os que já estiverem completamente assinados.';
}

/* ============================================================================================ */
/*  PASTA CENTRAL "KITS ADMISSIONAIS ASSINADOS" (pedido 2026-09-24)                              */
/* ============================================================================================ */
/*
 * Todo kit assinado por todos os signatários ganha uma cópia do PDF baixado do Autentique em
 * 00_AUTOMAÇÕES E DESENVOLVIMENTO / KITS ADMISSIONAIS ASSINADOS. O arquivo de cada pessoa em
 * 05_Assinado continua sendo o oficial (é o link ASSINATURA_URL que o portal mostra).
 * - Novos: _admKitBaixarNucleo_ copia logo depois de salvar em 05_Assinado.
 * - Já arquivados antes disso, ou cópia que falhou: admKitSincronizarPastaKitsAssinados, que roda
 *   no fim de cada passada do download automático e também pode ser rodada à mão no editor
 *   (sincronizarPastaKitsAssinados).
 * O nome leva o protocolo para não misturar duas pessoas com o mesmo nome.
 */

var _ADM_PASTA_KITS_ASSINADOS_ = null;

function _admPastaKitsAssinados_() {
  if (_ADM_PASTA_KITS_ASSINADOS_) return _ADM_PASTA_KITS_ASSINADOS_;
  var pai = DriveApp.getFolderById(ADM.PASTA_KITS_ASSINADOS.PAI_ID);
  var it = pai.getFoldersByName(ADM.PASTA_KITS_ASSINADOS.NOME);
  if (it.hasNext()) return (_ADM_PASTA_KITS_ASSINADOS_ = it.next());
  // Criação com trava: o download automático e o botão do portal podem chegar juntos aqui
  // na primeira vez, e sem a trava nasceriam duas pastas com o mesmo nome.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    it = pai.getFoldersByName(ADM.PASTA_KITS_ASSINADOS.NOME);
    _ADM_PASTA_KITS_ASSINADOS_ = it.hasNext() ? it.next() : pai.createFolder(ADM.PASTA_KITS_ASSINADOS.NOME);
  } finally {
    lock.releaseLock();
  }
  return _ADM_PASTA_KITS_ASSINADOS_;
}

function _admNomeKitNaPastaCentral_(cad) {
  return 'KIT ADMISSIONAL - ' + String(cad[ADM_COL.NOME] || '').trim() + ' - ' + String(cad[ADM_COL.PROTOCOLO] || '').trim() + ' - ASSINADO.pdf';
}

// [FIX 2026-09-25] A cópia central é reconhecida pelo PROTOCOLO, não pelo nome inteiro: o nome
// pode ser corrigido depois no CADASTROS (ex.: "CORRÊA" virou "CORReA" em 25/09) e, pelo nome, a
// sincronização criaria uma segunda cópia do mesmo kit. Arquivo sem protocolo no nome usa o nome.
function _admChaveKitCentralDoArquivo_(nomeArquivo) {
  var m = String(nomeArquivo || '').match(/ - (\S+) - ASSINADO\.pdf$/i);
  return m ? m[1].toUpperCase() : String(nomeArquivo || '');
}

/** [2026-09-30] Protocolo que fica fora da pasta central (ver ADM.PASTA_KITS_ASSINADOS.EXCLUIR). */
function _admKitForaDaPastaCentral_(chave) {
  var lista = (ADM.PASTA_KITS_ASSINADOS.EXCLUIR || []).map(function (x) { return String(x).trim().toUpperCase(); });
  return lista.indexOf(String(chave || '').trim().toUpperCase()) > -1;
}

function _admChaveKitCentralDoCadastro_(cad) {
  var proto = String(cad[ADM_COL.PROTOCOLO] || '').trim().toUpperCase();
  return proto || _admNomeKitNaPastaCentral_(cad);
}

/** Copia o PDF assinado (já salvo em 05_Assinado) para a pasta central, substituindo a cópia
 *  anterior da mesma pessoa, se houver (ex.: reparo que baixou de novo). */
function _admKitCopiarParaPastaCentral_(cad, arquivo) {
  var chave = _admChaveKitCentralDoCadastro_(cad);
  if (_admKitForaDaPastaCentral_(chave)) return null; // [2026-09-30] fora da pasta central por decisão do DP
  var pasta = _admPastaKitsAssinados_();
  var nome = _admNomeKitNaPastaCentral_(cad);
  // Cópias anteriores do mesmo kit, mesmo que o nome da pessoa tenha mudado depois.
  var anteriores = chave !== nome ? pasta.searchFiles('title contains "' + chave + '"') : pasta.getFilesByName(nome);
  while (anteriores.hasNext()) {
    var f = anteriores.next();
    if (_admChaveKitCentralDoArquivo_(f.getName()) === chave || f.getName() === nome) f.setTrashed(true);
  }
  return arquivo.makeCopy(nome, pasta);
}

/** Garante que todo kit arquivado (ASSINATURA_URL preenchido) tenha a cópia na pasta central.
 *  Não baixa nada do Autentique: copia o PDF que já está em 05_Assinado. p.prazo = horário
 *  (ms) para parar; sem ele, usa 5 min a partir de agora. */
function admKitSincronizarPastaKitsAssinados(user, p) {
  var prazo = (p && p.prazo) || (Date.now() + 5 * 60 * 1000);
  if (Date.now() > prazo - 20000) return { copiados: 0, jaTinham: 0, erros: 0, restaram: -1, mensagem: 'sem tempo nesta passada.' };

  var pasta = _admPastaKitsAssinados_();
  var existentes = {};
  // [FIX 2026-09-24] Nome repetido (download duplo de 24/09 16:05, antes da trava por
  // documento): fica só a cópia mais nova; as outras vão para a lixeira.
  // [FIX 2026-09-25] Agrupa pelo protocolo (ver _admChaveKitCentralDoArquivo_).
  var porNome = {}, repetidosRemovidos = 0, excluidosRemovidos = 0;
  var itArq = pasta.getFiles();
  while (itArq.hasNext()) {
    var arqCentral = itArq.next();
    var nomeCentral = _admChaveKitCentralDoArquivo_(arqCentral.getName());
    // [2026-09-30] Protocolo fora da pasta central (ADM.PASTA_KITS_ASSINADOS.EXCLUIR): vai para a lixeira.
    if (_admKitForaDaPastaCentral_(nomeCentral)) { arqCentral.setTrashed(true); excluidosRemovidos++; continue; }
    var jaVisto = porNome[nomeCentral];
    if (!jaVisto) { porNome[nomeCentral] = arqCentral; continue; }
    var maisVelho = jaVisto.getDateCreated() <= arqCentral.getDateCreated() ? jaVisto : arqCentral;
    porNome[nomeCentral] = maisVelho === jaVisto ? arqCentral : jaVisto;
    maisVelho.setTrashed(true);
    repetidosRemovidos++;
  }
  Object.keys(porNome).forEach(function (n) { existentes[n] = true; });

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();
  var fila = cadastros.filter(function (c) {
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return t && String(t.ASSINATURA_URL || '').trim() && !_admKitForaDaPastaCentral_(_admChaveKitCentralDoCadastro_(c));
  });

  var copiados = 0, jaTinham = 0, erros = 0, restaram = 0;
  var detalhesErro = [];
  for (var i = 0; i < fila.length; i++) {
    var cad = fila[i];
    var nome = _admNomeKitNaPastaCentral_(cad);
    var chave = _admChaveKitCentralDoCadastro_(cad);
    if (existentes[chave]) { jaTinham++; continue; }
    if (Date.now() > prazo) { restaram = fila.length - i; break; }
    try {
      var url = String(tratMapa[String(cad[ADM_COL.PROTOCOLO] || '')].ASSINATURA_URL);
      var m = url.match(/\/d\/([-\w]+)/) || url.match(/[?&]id=([-\w]+)/);
      if (!m) throw new Error('link do kit assinado sem ID do Drive');
      var arq = DriveApp.getFileById(m[1]);
      if (arq.isTrashed()) throw new Error('o kit assinado em 05_Assinado está na lixeira');
      if (arq.getMimeType() !== 'application/pdf' || arq.getSize() < 1000) throw new Error('o kit assinado em 05_Assinado não é um PDF válido');
      arq.makeCopy(nome, pasta);
      existentes[chave] = true;
      copiados++;
    } catch (e) {
      erros++;
      if (detalhesErro.length < 10) detalhesErro.push(cad[ADM_COL.NOME] + ': ' + String(e.message || e).substring(0, 160));
    }
  }
  // restaram só conta quem ainda não tem cópia
  if (restaram) {
    restaram = fila.slice(fila.length - restaram).filter(function (c) { return !existentes[_admChaveKitCentralDoCadastro_(c)]; }).length;
  }

  var mensagem = copiados + ' kit(s) copiado(s) para ' + ADM.PASTA_KITS_ASSINADOS.NOME + ', ' + (jaTinham) + ' já estavam lá.';
  if (repetidosRemovidos) mensagem += ' ' + repetidosRemovidos + ' cópia(s) repetida(s) foram para a lixeira.';
  if (excluidosRemovidos) mensagem += ' ' + excluidosRemovidos + ' cópia(s) de protocolo excluído da pasta central foram para a lixeira.';
  if (erros) mensagem += ' ' + erros + ' com erro: ' + detalhesErro.slice(0, 3).join(' | ');
  if (restaram) mensagem += ' Restaram ' + restaram + ' para a próxima passada.';

  if (copiados || erros || repetidosRemovidos || excluidosRemovidos) {
    _auditar_('ADMISSAO_KIT_PASTA_CENTRAL', user.EMAIL, 'ADMISSAO.KIT_PASTA_CENTRAL', erros === 0,
      'copiados ' + copiados + ' . ja tinham ' + jaTinham + ' . erros ' + erros + ' . restaram ' + restaram +
      ' . repetidos removidos ' + repetidosRemovidos + ' . excluidos removidos ' + excluidosRemovidos, { erros: detalhesErro });
  }
  return { copiados: copiados, jaTinham: jaTinham, erros: erros, restaram: restaram, repetidosRemovidos: repetidosRemovidos, excluidosRemovidos: excluidosRemovidos, detalhesErro: detalhesErro, mensagem: mensagem };
}

/** Rodar à mão no editor para completar a pasta central na hora. */
function sincronizarPastaKitsAssinados() {
  var r = admKitSincronizarPastaKitsAssinados({ EMAIL: 'sistema-automatico@dp360' }, { prazo: Date.now() + 5.5 * 60 * 1000 });
  console.log(r.mensagem);
  return r.mensagem;
}

/* ============================================================================================ */
/*  ASSINATURA AUTOMÁTICA DO DP (pedido 2026-09-24)                                              */
/* ============================================================================================ */
/*
 * Pedido: o dp@cieds.org.br assina sozinho, no Autentique, todo kit admissional em que o
 * colaborador JÁ assinou. Usa a mutation signDocument, que assina em nome do DONO do token da
 * API (hoje a conta "Departamento Pessoal", dp@cieds.org.br) — por isso cada passada confere
 * antes quem é o dono do token e não assina nada se não for o e-mail do DP.
 *
 * Só assina quando TUDO isto vale para o documento:
 *   - está na ADMISSOES_TRATATIVA como kit enviado e ainda não arquivado (KIT_ID_AUTENTIQUE
 *     preenchido, ASSINATURA_URL vazio) — documento avulso no Autentique fica de fora;
 *   - o nome do documento no Autentique começa com "KIT ADMISSIONAL";
 *   - nenhum signatário rejeitou;
 *   - a única assinatura que falta é a do DP, e pelo menos uma outra pessoa já assinou;
 *   - o arquivo do kit gravado no envio (KIT_URL) tem o protocolo ou o nome da própria pessoa
 *     no nome. Trava do caso Fernanda x Jovelino (2026-09-24): o link de pasta errado no
 *     CADASTROS fez subir o PDF de outra pessoa com o nome dela — isso não pode ser assinado
 *     pela empresa sem alguém olhar.
 *
 * Não grava nada na ADMISSOES_TRATATIVA (só na AUDITORIA): a rotina de download
 * (admKitVerificarEBaixarAutomatico) roda em paralelo e reescreve a linha inteira da pessoa;
 * gravar aqui ao mesmo tempo poderia apagar o ASSINATURA_URL que ela acabou de gravar. Depois
 * que o DP assina, essa rotina de download vê o documento completo e arquiva em 05_Assinado.
 */

/** E-mail do dono do token do Autentique (query "me"). */
function _admAutentiqueDonoDoToken_() {
  var data = _admAutentiquePost_('query { me { email } }', {});
  return String((data && data.me && data.me.email) || '').trim().toLowerCase();
}

/** Assina o documento como o dono do token. Repete só se o Autentique recusou por excesso de
 *  pedidos (429/425, pedido não processado); em outro erro não repete. */
function _admAutentiqueAssinarDocumento_(docId) {
  var ESPERAS_MS = [10000, 20000, 30000];
  var code, txt;
  for (var tent = 0; ; tent++) {
    var resp = UrlFetchApp.fetch(_reciboEndpoint_(), {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + _autentiqueToken_() },
      payload: JSON.stringify({ query: 'mutation($id: UUID!){ signDocument(id: $id) }', variables: { id: docId } }),
      muteHttpExceptions: true
    });
    code = resp.getResponseCode();
    txt = resp.getContentText();
    var limitado = code === 429 || code === 425 || /too many attempts/i.test(txt);
    if (!limitado) break;
    if (tent >= ESPERAS_MS.length) {
      var erroLimite = new Error('O Autentique bloqueou temporariamente por excesso de pedidos (HTTP ' + code + ').');
      erroLimite.limiteAutentique = true;
      throw erroLimite;
    }
    Utilities.sleep(ESPERAS_MS[tent]);
  }
  var json;
  try { json = JSON.parse(txt); } catch (e) { throw new Error('Resposta inválida do Autentique (HTTP ' + code + '): ' + String(txt).substring(0, 150)); }
  if (json.errors) throw new Error('Autentique recusou a assinatura: ' + JSON.stringify(json.errors).substring(0, 300));
  if (!json.data || json.data.signDocument !== true) throw new Error('Autentique não confirmou a assinatura (HTTP ' + code + '): ' + String(txt).substring(0, 150));
  return true;
}

function _admNormNome_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Trava: o arquivo do kit gravado no envio é mesmo desta pessoa? */
function _admKitArquivoEhDaPessoa_(cad, trat) {
  var url = String((trat && trat.KIT_URL) || '');
  var m = url.match(/\/d\/([-\w]+)/) || url.match(/[?&]id=([-\w]+)/);
  if (!m) return { ok: false, motivo: 'sem link do arquivo do kit na tratativa (KIT_URL)' };
  var nomeArq;
  try { nomeArq = DriveApp.getFileById(m[1]).getName(); }
  catch (e) { return { ok: false, motivo: 'arquivo do kit não abriu no Drive (' + String(e.message || e).substring(0, 80) + ')' }; }
  var proto = String(cad[ADM_COL.PROTOCOLO] || '');
  var nomePessoa = _admNormNome_(cad[ADM_COL.NOME]);
  if ((proto && nomeArq.indexOf(proto) > -1) || (nomePessoa && _admNormNome_(nomeArq).indexOf(nomePessoa) > -1)) return { ok: true };
  return { ok: false, motivo: 'o arquivo do kit enviado ("' + nomeArq + '") não tem o protocolo nem o nome da pessoa' };
}

/** Assina como DP todos os kits que só esperam o DP. Usado pelo gatilho; não está no portal. */
function admKitAssinarDpLote(user, p) {
  var dpEmail = String(_reciboDpEmail_() || '').trim().toLowerCase();
  var dono = _admAutentiqueDonoDoToken_();
  if (!dpEmail || dono !== dpEmail) {
    var msgDono = 'Assinatura automática do DP parada: o token do Autentique é da conta ' + (dono || '(desconhecida)') +
      ', não de ' + (dpEmail || '(e-mail do DP não configurado)') + '. Nada foi assinado.';
    _auditar_('ADMISSAO_KIT_ASSINAR_DP_LOTE', user.EMAIL, 'ADMISSAO.KIT_ASSINAR_DP_LOTE', false, msgDono, {});
    return { ok: false, assinados: 0, mensagem: msgDono };
  }

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();
  var fila = cadastros.filter(function (c) {
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return t && String(t.KIT_ID_AUTENTIQUE || '').trim() && !String(t.ASSINATURA_URL || '').trim();
  });

  var t0 = Date.now();
  var LIMITE_MS = 4.5 * 60 * 1000;
  var ids = fila.map(function (c) { return String(tratMapa[String(c[ADM_COL.PROTOCOLO] || '')].KIT_ID_AUTENTIQUE).trim(); });
  var lista = _admKitConsultarVarios_(ids, 2.5 * 60 * 1000);

  var candidatos = fila.filter(function (c) {
    var info = lista.mapa[String(tratMapa[String(c[ADM_COL.PROTOCOLO] || '')].KIT_ID_AUTENTIQUE).trim()];
    return info && !info.rejeitado && !info.assinado && info.faltaDp && !info.faltaPessoa &&
      info.outrosAssinados > 0 && /^\s*KIT ADMISSIONAL/i.test(info.nome);
  });

  var assinados = 0, barrados = 0, erros = 0, naoProcessados = 0;
  var nomesAssinados = [], detalhesBarrados = [], detalhesErro = [];

  for (var i = 0; i < candidatos.length; i++) {
    if (Date.now() - t0 > LIMITE_MS) { naoProcessados = candidatos.length - i; break; }
    var cad = candidatos[i];
    var proto = String(cad[ADM_COL.PROTOCOLO] || '');
    var t = tratMapa[proto];
    var docId = String(t.KIT_ID_AUTENTIQUE).trim();

    var trava = _admKitArquivoEhDaPessoa_(cad, t);
    if (!trava.ok) {
      barrados++;
      if (detalhesBarrados.length < 20) detalhesBarrados.push(cad[ADM_COL.NOME] + ': ' + trava.motivo);
      continue;
    }

    if (assinados + erros > 0) Utilities.sleep(1500);
    try {
      _admAutentiqueAssinarDocumento_(docId);
      assinados++;
      if (nomesAssinados.length < 50) nomesAssinados.push(cad[ADM_COL.NOME]);
      _auditar_('ADMISSAO_KIT_ASSINADO_DP', user.EMAIL, 'ADMISSAO.KIT_ASSINAR_DP', true,
        cad[ADM_COL.NOME] + ' -> doc ' + docId + ' assinado como ' + dpEmail + ' (colaborador já tinha assinado)', { protocolo: proto });
    } catch (e) {
      if (e.limiteAutentique) { naoProcessados = candidatos.length - i; break; }
      erros++;
      if (detalhesErro.length < 10) detalhesErro.push(cad[ADM_COL.NOME] + ': ' + String(e.message || e).substring(0, 200));
    }
  }

  var mensagem = assinados + ' kit(s) assinado(s) como DP.';
  if (barrados) mensagem += ' ' + barrados + ' barrado(s) pela conferência do arquivo (precisam de olhar manual).';
  if (erros) mensagem += ' ' + erros + ' com erro.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' para a próxima passada.';
  if (lista.erro) mensagem += ' Listagem do Autentique incompleta: ' + lista.erro.substring(0, 120);

  _auditar_('ADMISSAO_KIT_ASSINAR_DP_LOTE', user.EMAIL, 'ADMISSAO.KIT_ASSINAR_DP_LOTE', true,
    'candidatos ' + candidatos.length + ' . assinados ' + assinados + ' . barrados ' + barrados + ' . erros ' + erros +
    ' . restaram ' + naoProcessados + (lista.erro ? ' . listagem: ' + lista.erro.substring(0, 120) : ''),
    { assinados: nomesAssinados, barrados: detalhesBarrados, erros: detalhesErro });

  return {
    ok: true, candidatos: candidatos.length, assinados: assinados, barrados: barrados, erros: erros,
    naoProcessados: naoProcessados, nomesAssinados: nomesAssinados, detalhesBarrados: detalhesBarrados,
    detalhesErro: detalhesErro, mensagem: mensagem
  };
}

/** Roda sozinha pelo gatilho (ver criarGatilhoAssinaturaDpAutomatica). */
function admKitAssinarDpAutomatico() {
  // [2026-09-24] O gatilho é de 15 min, mas só trabalha uma vez por ADM.ASSINATURA_DP_INTERVALO_MIN
  // (folga de 5 min para o atraso natural do gatilho). As outras passadas saem na hora, sem
  // consultar nada, e quase não gastam cota.
  var props = PropertiesService.getScriptProperties();
  var ultima = Number(props.getProperty('ADM_ASSINAR_DP_ULTIMA_EXEC') || 0);
  var intervaloMs = (ADM.ASSINATURA_DP_INTERVALO_MIN - 5) * 60 * 1000;
  if (Date.now() - ultima < intervaloMs) {
    return 'Assinatura automática do DP: fora do intervalo, nada a fazer nesta passada.';
  }
  props.setProperty('ADM_ASSINAR_DP_ULTIMA_EXEC', String(Date.now()));

  var r = admKitAssinarDpLote({ EMAIL: 'sistema-automatico@dp360' }, {});
  console.log('admKitAssinarDpAutomatico: ' + r.mensagem);
  return r.mensagem;
}

/** Rodar à mão no editor para o DP assinar na hora, sem esperar o intervalo da automática. */
function assinarKitsComoDpAgora() {
  PropertiesService.getScriptProperties().setProperty('ADM_ASSINAR_DP_ULTIMA_EXEC', String(Date.now()));
  var r = admKitAssinarDpLote({ EMAIL: 'sistema-automatico@dp360' }, {});
  console.log(r.mensagem);
  return r.mensagem;
}

/** Rodar UMA VEZ, no editor, com a conta autodppessoal, para ligar a assinatura automática do DP
 *  (idempotente — não duplica o gatilho). */
function criarGatilhoAssinaturaDpAutomatica() {
  var jaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'admKitAssinarDpAutomatico';
  });
  if (jaExiste) return 'Gatilho da assinatura automática do DP já existia, não criei outro.';

  ScriptApp.newTrigger('admKitAssinarDpAutomatico').timeBased().everyMinutes(15).create();
  return 'Gatilho criado: a cada 15 min, o DP assina sozinho os kits em que o colaborador já assinou.';
}

/** Desliga a assinatura automática do DP. */
function removerGatilhoAssinaturaDpAutomatica() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'admKitAssinarDpAutomatico') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n ? 'Assinatura automática do DP desligada.' : 'Não havia gatilho da assinatura automática do DP.';
}

/* ============================================================================================ */
/*  REENVIO AUTOMÁTICO DO KIT PARA QUEM NÃO ASSINOU (pedido 2026-09-28)                          */
/* ============================================================================================ */
/*
 * Pedido: reenviar o kit admissional só para quem ainda não assinou, até assinar. Começou de 2 em
 * 2 horas e, no mesmo dia (28/09), passou a ser UMA VEZ POR DIA.
 * "Reenviar" = o Autentique manda de novo o e-mail de assinatura ao colaborador (mutation
 * resendSignatures). NÃO cria documento novo: o documento e o link de assinatura são os mesmos.
 *
 * Só reenvia quando TUDO isto vale:
 *   - kit enviado pelo portal e ainda não arquivado (KIT_ID_AUTENTIQUE preenchido, ASSINATURA_URL vazio);
 *   - a admissão não está cancelada na tratativa;
 *   - o documento existe no Autentique e o nome começa com "KIT ADMISSIONAL";
 *   - ninguém recusou o documento;
 *   - o colaborador (signatário que não é o DP) ainda não assinou.
 * O DP nunca recebe o reenvio: ele assina sozinho depois do colaborador (assinatura automática).
 * Quem assina sai da lista na passada seguinte, sem precisar de nada.
 * Só roda entre ADM.REENVIO_KIT_JANELA[0] h e [1] h (Brasília): ninguém recebe e-mail de madrugada.
 */
var ADM_KIT_DOC_CAMPOS_REENVIO_ = 'id name signatures { public_id email action { name } signed { created_at } rejected { created_at } }';

/** Como _admKitConsultarVarios_, mas devolve os documentos crus (com o public_id de cada
 *  signatário, que o reenvio precisa). Devolve { docs: {id: doc}, erro }. */
function _admKitDocsParaReenvio_(ids, limiteMs) {
  var faltam = {};
  ids.forEach(function (id) { faltam[id] = true; });
  var qtdFaltam = Object.keys(faltam).length;
  var docs = {};
  var t0 = Date.now();
  var erro = '';
  for (var pagina = 1; pagina <= 60 && qtdFaltam > 0; pagina++) {
    if (Date.now() - t0 > limiteMs) { erro = 'tempo da listagem esgotado na página ' + pagina; break; }
    if (pagina > 1) Utilities.sleep(1500);
    var data;
    try {
      data = _admAutentiquePost_('query($p: Int){ documents(limit: 60, page: $p){ data { ' + ADM_KIT_DOC_CAMPOS_REENVIO_ + ' } } }', { p: pagina });
    } catch (e) { erro = String(e.message || e); break; }
    var lista = (data && data.documents && data.documents.data) || [];
    lista.forEach(function (d) {
      if (faltam[d.id]) { docs[d.id] = d; delete faltam[d.id]; qtdFaltam--; }
    });
    if (lista.length < 60) break;
  }
  return { docs: docs, erro: erro };
}

/** Pede ao Autentique para reenviar o e-mail de assinatura a estes signatários (public_id). */
function _admAutentiqueReenviarAssinaturas_(publicIds) {
  var limpos = publicIds.filter(function (id) { return /^[\w-]+$/.test(String(id || '')); });
  if (!limpos.length) return true;
  var lista = limpos.map(function (id) { return '"' + id + '"'; }).join(', ');
  var data = _admAutentiquePost_('mutation { resendSignatures(public_ids: [' + lista + ']) }', {});
  if (!data || data.resendSignatures !== true) throw new Error('Autentique não confirmou o reenvio: ' + JSON.stringify(data).substring(0, 150));
  return true;
}

/**
 * Reenvia o kit a quem ainda não assinou. p.simular = true só monta a lista, sem mandar nada.
 * Usado pelo gatilho (admKitReenviarPendentesAutomatico); não está no portal.
 */
function admKitReenviarPendentesLote(user, p) {
  p = p || {};
  var dpEmail = String(_reciboDpEmail_() || '').trim().toLowerCase();
  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();
  var fila = cadastros.filter(function (c) {
    var t = tratMapa[String(c[ADM_COL.PROTOCOLO] || '')];
    return t && String(t.KIT_ID_AUTENTIQUE || '').trim() && !String(t.ASSINATURA_URL || '').trim() &&
      String(t.STATUS || '') !== ADM.STATUS.CANCELADA;
  });

  var t0 = Date.now();
  var LIMITE_MS = 5 * 60 * 1000;
  var idDe = function (c) { return String(tratMapa[String(c[ADM_COL.PROTOCOLO] || '')].KIT_ID_AUTENTIQUE).trim(); };
  var lista = _admKitDocsParaReenvio_(fila.map(idDe), 2.5 * 60 * 1000);

  // Quem ainda não assinou: o(s) signatário(s) que não são o DP, com ação de assinar e sem assinatura.
  var pendentes = [];
  var jaAssinaram = 0, semDocumento = 0, recusados = 0, outroNome = 0;
  fila.forEach(function (c) {
    var doc = lista.docs[idDe(c)];
    if (!doc) { semDocumento++; return; }
    if (!/^\s*KIT ADMISSIONAL/i.test(String(doc.name || ''))) { outroNome++; return; }
    var sigs = doc.signatures || [];
    if (sigs.some(function (s) { return !!s.rejected; })) { recusados++; return; }
    var doColab = sigs.filter(function (s) {
      var acao = String((s.action && s.action.name) || 'SIGN').toUpperCase();
      return String(s.email || '').toLowerCase() !== dpEmail && acao.indexOf('SIGN') > -1;
    });
    var faltando = doColab.filter(function (s) { return !s.signed && s.public_id; });
    if (!faltando.length) { jaAssinaram++; return; }
    pendentes.push({ nome: String(c[ADM_COL.NOME] || ''), protocolo: String(c[ADM_COL.PROTOCOLO] || ''),
      emails: faltando.map(function (s) { return s.email; }), ids: faltando.map(function (s) { return s.public_id; }) });
  });

  var base = { ok: true, simulacao: !!p.simular, naFila: fila.length, pendentes: pendentes.length,
    jaAssinaram: jaAssinaram, semDocumento: semDocumento, recusados: recusados, outroNome: outroNome,
    listagemIncompleta: lista.erro || '' };

  if (p.simular) {
    // confere no esquema do Autentique que o comando de reenvio existe e quais argumentos recebe
    try {
      var sch = _admAutentiquePost_('{ __type(name: "Mutation") { fields { name args { name } } } }', {});
      base.comandosReenvio = ((sch && sch.__type && sch.__type.fields) || [])
        .filter(function (f) { return /resend/i.test(f.name); })
        .map(function (f) { return f.name + '(' + (f.args || []).map(function (a) { return a.name; }).join(', ') + ')'; });
    } catch (eSch) { base.comandosReenvio = 'consulta ao esquema falhou: ' + String(eSch.message || eSch).substring(0, 150); }
    base.lista = pendentes.map(function (x) { return x.nome + ' <' + x.emails.join(', ') + '>'; });
    base.mensagem = pendentes.length + ' pessoa(s) seriam lembradas agora (simulação, nada foi enviado).';
    _auditar_('ADMISSAO_KIT_REENVIO_SIMULACAO', user.EMAIL, 'ADMISSAO.KIT_REENVIO', true, base.mensagem,
      { lista: base.lista.slice(0, 200), semDocumento: semDocumento, recusados: recusados, listagem: lista.erro });
    return base;
  }

  var reenviados = 0, erros = 0, naoProcessados = 0;
  var nomes = [], detalhesErro = [], paraCopia = [];
  var LOTE = 10;
  for (var i = 0; i < pendentes.length; i += LOTE) {
    if (Date.now() - t0 > LIMITE_MS) { naoProcessados = pendentes.length - i; break; }
    if (i > 0) Utilities.sleep(2000);
    var grupo = pendentes.slice(i, i + LOTE);
    try {
      _admAutentiqueReenviarAssinaturas_([].concat.apply([], grupo.map(function (x) { return x.ids; })));
      grupo.forEach(function (x) { reenviados++; if (nomes.length < 300) nomes.push(x.nome); paraCopia.push(x); });
    } catch (e) {
      // o lote falhou: tenta um a um, para saber quem deu erro e não perder os outros
      grupo.forEach(function (x) {
        try {
          Utilities.sleep(1000);
          _admAutentiqueReenviarAssinaturas_(x.ids);
          reenviados++; if (nomes.length < 300) nomes.push(x.nome); paraCopia.push(x);
        } catch (e2) {
          erros++;
          if (detalhesErro.length < 20) detalhesErro.push(x.nome + ': ' + String(e2.message || e2).substring(0, 200));
        }
      });
    }
  }

  var mensagem = reenviados + ' kit(s) reenviado(s) a quem ainda não assinou.';
  if (erros) mensagem += ' ' + erros + ' com erro.';
  if (naoProcessados) mensagem += ' Restaram ' + naoProcessados + ' para a próxima passada.';
  if (lista.erro) mensagem += ' Listagem do Autentique incompleta: ' + lista.erro.substring(0, 120);

  _auditar_('ADMISSAO_KIT_REENVIO_LOTE', user.EMAIL, 'ADMISSAO.KIT_REENVIO', erros === 0,
    'pendentes ' + pendentes.length + ' . reenviados ' + reenviados + ' . erros ' + erros + ' . restaram ' + naoProcessados +
    ' . ja assinaram ' + jaAssinaram + ' . sem documento ' + semDocumento + (lista.erro ? ' . listagem: ' + lista.erro.substring(0, 120) : ''),
    { reenviados: nomes, erros: detalhesErro });

  base.reenviados = reenviados; base.erros = erros; base.naoProcessados = naoProcessados;
  base.nomes = nomes; base.detalhesErro = detalhesErro; base.mensagem = mensagem;
  base.copia = _admKitReenvioEnviarCopia_(paraCopia, detalhesErro, mensagem);
  return base;
}

/** Manda a ADM.REENVIO_KIT_COPIA um resumo de quem recebeu o lembrete nesta passada.
 *  Falha aqui não atrapalha o reenvio: só fica registrada. */
function _admKitReenvioEnviarCopia_(enviados, detalhesErro, mensagem) {
  var para = String(ADM.REENVIO_KIT_COPIA || '').trim();
  if (!para || (!enviados.length && !detalhesErro.length)) return 'sem cópia';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var quando = Utilities.formatDate(new Date(), DP360.FUSO, "dd/MM/yyyy 'às' HH:mm");
  var linhas = enviados.map(function (x, i) {
    return '<tr><td style="padding:3px 8px;color:#666">' + (i + 1) + '</td><td style="padding:3px 8px">' + esc(x.nome) +
      '</td><td style="padding:3px 8px">' + esc(x.emails.join(', ')) + '</td></tr>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#222">' +
    '<p>Cópia do reenvio automático do <b>kit admissional</b> em ' + esc(quando) + '.</p>' +
    '<p>O Autentique mandou de novo o e-mail de assinatura para ' + enviados.length +
    ' pessoa(s) que ainda não tinham assinado. Não foi criado documento novo: o link de assinatura é o mesmo.</p>' +
    (enviados.length ? '<table style="border-collapse:collapse;font-size:12px"><tr style="background:#eee"><th style="padding:3px 8px">#</th>' +
      '<th style="padding:3px 8px;text-align:left">Nome</th><th style="padding:3px 8px;text-align:left">E-mail</th></tr>' + linhas + '</table>' : '') +
    (detalhesErro.length ? '<p style="color:#b00"><b>Com erro:</b><br>' + detalhesErro.map(esc).join('<br>') + '</p>' : '') +
    '<p style="color:#666">' + esc(mensagem) + '<br>Próximo reenvio amanhã, a partir das ' +
    ADM.REENVIO_KIT_JANELA[0] + 'h, só para quem continuar sem assinar.</p></div>';
  try {
    MailApp.sendEmail({
      to: para,
      subject: 'Kit admissional: lembrete reenviado a ' + enviados.length + ' pessoa(s) — ' + quando,
      htmlBody: html
    });
    return 'cópia enviada para ' + para;
  } catch (e) {
    console.error('Falha ao mandar a cópia do reenvio para ' + para + ': ' + e);
    return 'falha ao mandar a cópia: ' + String(e.message || e).substring(0, 150);
  }
}

/** Guarda o dia (Brasília) do último reenvio. O envio de 28/09 foi feito à mão às 12:05, antes
 *  de existir esta marca: por isso, sem marca gravada, o último dia é 28/09. */
var ADM_REENVIO_KIT_PROP_DIA_ = 'ADM_REENVIO_KIT_ULTIMO_DIA';

function _admReenvioKitMarcarHoje_() {
  var hoje = Utilities.formatDate(new Date(), DP360.FUSO, 'yyyy-MM-dd');
  PropertiesService.getScriptProperties().setProperty(ADM_REENVIO_KIT_PROP_DIA_, hoje);
  return hoje;
}

/** Roda sozinha pelo gatilho (ver criarGatilhoReenvioKit). Envia no máximo UMA VEZ POR DIA: na
 *  primeira passada dentro da faixa de horário. As outras passadas do dia saem sem enviar nada. */
function admKitReenviarPendentesAutomatico() {
  if (!ADM.REENVIO_KIT_ATIVO) {
    return 'Reenvio de kits: desligado (ADM.REENVIO_KIT_ATIVO = false), nada enviado.';
  }
  var agora = new Date();
  var hora = Number(Utilities.formatDate(agora, DP360.FUSO, 'H'));
  if (hora < ADM.REENVIO_KIT_JANELA[0] || hora >= ADM.REENVIO_KIT_JANELA[1]) {
    return 'Reenvio de kits: fora do horário (' + hora + 'h), nada enviado.';
  }
  var hoje = Utilities.formatDate(agora, DP360.FUSO, 'yyyy-MM-dd');
  var ultimoDia = PropertiesService.getScriptProperties().getProperty(ADM_REENVIO_KIT_PROP_DIA_) || '2026-09-28';
  if (String(ultimoDia) >= hoje) {
    return 'Reenvio de kits: já feito hoje (' + hoje + '), nada enviado.';
  }
  // marca antes de enviar: se a passada cair no meio, não repete o envio no mesmo dia
  _admReenvioKitMarcarHoje_();
  var r = admKitReenviarPendentesLote({ EMAIL: 'sistema-automatico@dp360' }, {});
  console.log('admKitReenviarPendentesAutomatico: ' + r.mensagem);
  return r.mensagem;
}

/** Rodar à mão no editor: só mostra quem seria lembrado, sem mandar nada. */
function simularReenvioKits() {
  var r = admKitReenviarPendentesLote({ EMAIL: 'sistema-automatico@dp360' }, { simular: true });
  console.log(r.mensagem + '\n' + (r.lista || []).join('\n'));
  return r.mensagem;
}

/** Rodar à mão no editor: reenvia agora, sem esperar o gatilho. Conta como o envio do dia. */
function reenviarKitsPendentesAgora() {
  _admReenvioKitMarcarHoje_();
  var r = admKitReenviarPendentesLote({ EMAIL: 'sistema-automatico@dp360' }, {});
  console.log(r.mensagem);
  return r.mensagem;
}

/** Liga o reenvio automático (idempotente — não duplica o gatilho). */
function criarGatilhoReenvioKit() {
  var jaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'admKitReenviarPendentesAutomatico';
  });
  if (jaExiste) return 'Gatilho do reenvio de kits já existia, não criei outro.';
  ScriptApp.newTrigger('admKitReenviarPendentesAutomatico').timeBased().everyDays(1).atHour(ADM.REENVIO_KIT_JANELA[0]).create();
  return 'Gatilho criado: uma vez por dia, a partir das ' + ADM.REENVIO_KIT_JANELA[0] +
    'h, o kit é reenviado a quem ainda não assinou.';
}

/** Desliga o reenvio automático. */
function removerGatilhoReenvioKit() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'admKitReenviarPendentesAutomatico') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n ? 'Reenvio automático de kits desligado.' : 'Não havia gatilho do reenvio de kits.';
}

/**
 * [PERF 2026-09-22] Rodar UMA VEZ pra ligar a sincronização em segundo plano da CHECK LIST
 * (idempotente — não duplica o gatilho). admKitLista() agora depende dela: sem esse gatilho
 * rodando, o link "Assinado e arquivado" de quem veio pela CHECK LIST (não pelo formulário)
 * nunca fica pronto, e essas pessoas ficam paradas em "Assinado" mesmo depois de já
 * arquivadas. Mesma cadência do gatilho de download automático do Kit (15 min), pra ficar
 * no máximo 15 min desatualizado — troca justa por tirar ~15s de varredura de pastas do
 * Drive de cada carregamento da tela.
 */
function criarGatilhoSincronizacaoChecklistAdmissao() {
  var jaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'admChecklistSincronizarLinks';
  });
  if (jaExiste) return 'Gatilho de sincronização da CHECK LIST já existia, não criei outro.';

  ScriptApp.newTrigger('admChecklistSincronizarLinks').timeBased().everyMinutes(15).create();
  return 'Gatilho criado: a cada 15 min, sincroniza a CHECK LIST e grava os links do Autentique/Drive que a tela do Kit Admissional usa (sem isso, a tela ficava recalculando tudo ao vivo, levando ~25s).';
}

/** ADMISSAO.KIT_CANCELAR - apaga o documento no Autentique (bloqueia + apaga, ninguém mais
 *  consegue assinar) e limpa os campos de envio, voltando pra "Pronto para Envio". Só permite
 *  cancelar enquanto pendente de assinatura — depois de assinado/baixado, cancelar destruiria o
 *  documento já executado. payload: { protocolo } */
function admKitCancelar(user, p) {
  var proto = String((p && p.protocolo) || '').trim();
  if (!proto) throw new Error('Informe o protocolo da admissão.');

  var cad = _admCadastroPorProtocolo_(proto);
  if (!cad) throw new Error('Cadastro não encontrado: ' + proto);

  var trat = _admTratativaMapa_()[proto] || null;
  var docId = String((trat && trat.KIT_ID_AUTENTIQUE) || '').trim();
  if (!docId) throw new Error('Este kit ainda não foi enviado ao Autentique.');

  var assinadoLink = String((trat && trat.ASSINATURA_URL) || '').trim();
  if (assinadoLink) throw new Error('Este kit já foi baixado e arquivado, não é possível cancelar.');

  var info = _reciboConsultarDocumento_(docId);
  if (info.assinado) throw new Error('Este kit já foi assinado por todos. Baixe e arquive em vez de cancelar, para não perder o documento assinado.');

  _autentiqueApagarDocumento_(docId);

  _admUpsertTratativa_(cad, {
    KIT_ID_AUTENTIQUE: '',
    KIT_ENVIADO_EM: '',
    KIT_STATUS: 'Pendente',
    ASSINATURA_STATUS: ''
  }, { data: _agoraISO_(), usuario: user.EMAIL, acao: 'KIT_CANCELAR' });

  _auditar_('ADMISSAO_KIT_CANCELADO', user.EMAIL, 'ADMISSAO.KIT_CANCELAR', true,
    cad[ADM_COL.NOME] + ' -> doc ' + docId + ' apagado no Autentique', { protocolo: proto });

  return { ok: true, mensagem: 'Envio do kit de ' + String(cad[ADM_COL.NOME]).split(' ')[0] + ' cancelado. O documento foi apagado no Autentique e não pode mais ser assinado.' };
}

/* ============================================================================================ */
/*  MONTAGEM DE ITENS / UTILITÁRIOS                                                               */
/* ============================================================================================ */

function _admItemFila_(cad, trat) {
  return {
    protocolo: String(cad[ADM_COL.PROTOCOLO] || ''),
    nome: String(cad[ADM_COL.NOME] || ''),
    cpf: String(cad[ADM_COL.CPF] || ''),
    enviadoEm: cad[ADM_COL.ENVIO] || '',
    projeto: trat ? (trat.PROJETO || '') : '',
    departamento: trat ? (trat.DEPARTAMENTO || '') : '',
    dataAdmissao: trat ? (trat.DATA_ADMISSAO || '') : '',
    responsavel: trat ? (trat.RESPONSAVEL || '') : '',
    status: trat && trat.STATUS ? trat.STATUS : ADM.STATUS.CADASTRO_RECEBIDO,
    usaRiocard: _admElegivelRiocard_(cad),
    riocardStatus: trat ? (trat.RIOCARD_STATUS || 'Pendente') : 'Pendente',
    asoStatus: trat ? (trat.ASO_STATUS || 'Não iniciado') : 'Não iniciado',
    alterdataStatus: trat ? (trat.ALTERDATA_STATUS || 'Pendente') : 'Pendente',
    kitStatus: trat ? (trat.KIT_STATUS || 'Pendente') : 'Pendente',
    assinaturaStatus: trat ? (trat.ASSINATURA_STATUS || 'Não enviado') : 'Não enviado'
  };
}

function _admCadastroPublico_(cad) {
  // devolve o cadastro sem o número da linha interno
  var out = {};
  Object.keys(cad).forEach(function (k) { if (k !== '_rowNumber') out[k] = cad[k]; });
  return out;
}

function _admParseJSON_(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/*************************************************************************************************
 * ATIVAÇÃO (fazer uma vez, e depois "Nova versão" na implantação existente da API — nunca
 * "Nova implantação", para não trocar a URL que os portais usam):
 *
 * 1) Cole este arquivo no projeto da API (ao lado de Codigo.gs e FERIAS.gs).
 *
 * 2) Preencha no topo: ADM.CADASTROS_ID e ADM.RIOCARD.CNPJ_COMPRADOR
 *    (rode linksDoAdmin() no projeto do formulário para pegar o ID da planilha).
 *
 * 3) Em Codigo.gs, dentro de _modulosDisponiveis_(), acrescente:
 *
 *      if (typeof admResumo === 'function') {
 *        m.ADMISSAO = {
 *          nome: 'Admissões',
 *          permissao: 'ADMISSAO.CONTEXTO',
 *          resumo: admResumo,
 *          resumoDe: admResumoDe,
 *          contexto: admContexto
 *        };
 *      }
 *
 * 4) Em Codigo.gs, dentro de _semearPerfisPermissoes_(), acrescente no array permsDefault:
 *
 *      ['DP', 'ADMISSAO.*', 'Sim', 'GLOBAL', 'Ações operacionais de admissões.'],
 *
 *    Depois rode setupDP360() (ou adicione a linha direto na aba PERMISSOES).
 *
 * 5) Em FERIAS.gs, dentro de executar(), antes do return final, acrescente:
 *
 *      if (acao.indexOf('ADMISSAO.') === 0 && typeof admExecutar === 'function') {
 *        return admExecutar(acao, payload || {}, user);
 *      }
 *
 * 6) Libere o módulo para quem cuida de admissões (coluna MODULOS):
 *      definirModulos('fulano@cieds.org.br', 'FERIAS, ADMISSAO')
 *    (ADMIN já enxerga tudo automaticamente.)
 *************************************************************************************************/

/* ============================================================================================ */
/*  [TEMP-DIAG] Por que o Kit Admissional não gera pra uma pessoa — checa cada pré-requisito     */
/*  sem gerar nada (somente leitura). Chamado pelo doGet?diagKit=...&nome=...                     */
/* ============================================================================================ */
function _diagnosticoKitAdmissional_(nomeFiltro) {
  var nomeNorm = _admRemoverAcentos_(String(nomeFiltro || '')).toLowerCase();
  var todos = _admCadastros_();

  var achados = todos.filter(function (c) {
    return _admRemoverAcentos_(String(c[ADM_COL.NOME] || '')).toLowerCase().indexOf(nomeNorm) > -1;
  });

  if (!achados.length) return { ok: true, encontrados: 0, mensagem: 'Nenhum cadastro com esse nome.' };

  var tratMapa = _admTratativaMapa_();

  return {
    ok: true,
    encontrados: achados.length,
    pessoas: achados.map(function (cad) {
      var proto = String(cad[ADM_COL.PROTOCOLO] || '');
      var contr = _admContratuaisPorProtocolo_(proto);
      var trat = tratMapa[proto] || {};

      var out = {
        nome: cad[ADM_COL.NOME],
        protocolo: proto,
        statusCadastro: cad[ADM_COL.STATUS_CAD],
        temLinhaEmDadosContratuais: !!contr,
        dadosContratuais: contr,
        kitStatusAtual: trat.KIT_STATUS || '(nenhum)',
        kitUrlAtual: trat.KIT_URL || ''
      };

      try {
        var dados = _admKitDados_(cad, contr, trat, ADM.KIT, new Date());
        out.pendenciasCadastro = _admKitPendencias_(dados);
      } catch (e1) { out.erroAoMontarDados = String(e1); }

      try {
        var pasta = _admPastaDoCadastro_(cad);
        out.pastaUrl = pasta.getUrl();

        var contratoInfo = _admAcharDocumentoAlterdataPorTipo_(pasta, 'contrato', proto);
        out.contratoDeTrabalho = contratoInfo.arquivo
          ? { status: contratoInfo.status, arquivo: contratoInfo.arquivo.getName() }
          : contratoInfo;

        var fichaInfo = _admAcharDocumentoAlterdataPorTipo_(pasta, 'ficha', proto);
        out.fichaDeRegistro = fichaInfo.arquivo
          ? { status: fichaInfo.status, arquivo: fichaInfo.arquivo.getName() }
          : fichaInfo;
      } catch (e2) { out.erroAoAcharPastaOuDocs = String(e2); }

      try {
        out.arquivoCodigoEtica = 'OK: ' + _admAcharArquivoFixo_(ADM.KIT.ARQ_CODIGO_ETICA).getName();
      } catch (e3) { out.arquivoCodigoEtica = 'ERRO: ' + String(e3); }

      try {
        out.arquivoDiretrizes = 'OK: ' + _admAcharArquivoFixo_(ADM.KIT.ARQ_DIRETRIZES).getName();
      } catch (e4) { out.arquivoDiretrizes = 'ERRO: ' + String(e4); }

      return out;
    })
  };
}/* ============================================================================================
 * IMPORTACAO ALTERDATA — SEGURA E AUDITAVEL
 *
 * LIMITACAO IMPORTANTE: pdf-lib separa paginas mas NAO le texto/CPF de PDFs.
 * O lote exige mapeamento de paginas revisado pelo DP; NAO declara identificacao automatica.
 * p = {lotes:[{arquivoId:'ID_DO_PDF_NO_DRIVE', atribuicoes:[
 *       {protocolo:'ADM-...', cpf:'00000000000', tipo:'contrato', paginas:[1,2]},
 *       {protocolo:'ADM-...', cpf:'00000000000', tipo:'ficha', paginas:[3]},
 *       {protocolo:'ADM-...', cpf:'00000000000', tipo:'salario_familia', paginas:[4]}
 * ]}], confirmarConferencia:true }
 * Cada pagina e 1-indexada. Arquivos ambíguos sao bloqueados; nao adivinhar o titular.
 *
 * Integrar botao no front chamando ADMISSAO.ALTERDATA_IMPORTAR_LOTE quando pronto.
 * Para testar pelo editor: admAlterdataImportarTeste_ (preencha parametros manualmente).
 * ============================================================================================ */
/** Confere a presença dos arquivos por protocolo. Não usa OCR nem assume titularidade pelo nome do PDF. */
function admAlterdataStatus(user,p) {
  var proto=String((p&&p.protocolo)||'').trim();
  var cad=_admCadastroPorProtocolo_(proto);
  if(!cad) throw new Error('Protocolo não encontrado.');
  var cpf=_admCpfSomenteDigitos_(cad[ADM_COL.CPF]);
  var pasta=_admPastaDoCadastro_(cad);
  var encontrados={};
  ['contrato','ficha','salario_familia'].forEach(function(tipo){
    var sub=_admSubpasta_(pasta,ADM.SUBPASTAS.ALTERDATA);
    var it=sub.getFilesByName(tipo+'_'+proto+'.pdf'), count=0;
    while(it.hasNext()){it.next();count++;}
    encontrados[tipo]={status:count===1?'OK':count>1?'AMBIGUO':'PENDENTE'};
  });
  var props=PropertiesService.getScriptProperties();
  var emProcessamento=!!props.getProperty('ADMALT_INDIV_PENDENTE_'+proto);
  var pend=[];
  if(encontrados.contrato.status!=='OK')pend.push('Contrato não importado ou duplicado.');
  if(encontrados.ficha.status!=='OK')pend.push('Ficha de registro não importada ou duplicada.');
  if(encontrados.salario_familia.status==='AMBIGUO')pend.push('Termo de Salário-Família duplicado.');
  try {
    var contr=_admContratuaisPorProtocolo_(proto), trat=_admTratativaMapa_()[proto]||{};
    var dados=_admKitDados_(cad,contr,trat,ADM.KIT,new Date());
    pend=pend.concat(_admKitPendencias_(dados));
  } catch(ex){pend.push('Erro nos dados admissionais: '+String(ex.message||ex));}
  if(emProcessamento)pend.push('Importação em andamento.');
  return {ok:true,protocolo:proto,nome:String(cad[ADM_COL.NOME]||''),cpf:cpf,
    arquivos:encontrados,emProcessamento:emProcessamento,pendencias:pend,pronto:pend.length===0};
}
/** Um único funcionário por remessa; PDF por tipo, páginas integrais, sem visualizador/recortes. */
function admAlterdataImportarIndividuais(user,p){
  var proto=String((p&&p.protocolo)||'').trim();
  var cpf=_admCpfSomenteDigitos_(p&&p.cpf);
  var cad=_admCadastroPorProtocolo_(proto);
  if(!cad||!/^\d{11}$/.test(cpf)||cpf!==_admCpfSomenteDigitos_(cad[ADM_COL.CPF]))
    throw new Error('CPF do funcionário não corresponde ao protocolo; envio bloqueado.');
  if(!p||p.confirmarConferencia!==true||!Array.isArray(p.lotes)||!p.lotes.length||p.lotes.length>8)
    throw new Error('Confirme os documentos; envie de 1 a 8 PDFs do mesmo funcionário.');
  var ja={},ids={};
  p.lotes.forEach(function(l){
    if(!l.arquivoId||ids[l.arquivoId]||!Array.isArray(l.atribuicoes)||l.atribuicoes.length!==1)
      throw new Error('Cada arquivo deve representar um único documento de um funcionário.');
    ids[l.arquivoId]=true;
    var a=l.atribuicoes[0];
    if(a.protocolo!==proto||_admCpfSomenteDigitos_(a.cpf)!==cpf||
       ['contrato','ficha','salario_familia'].indexOf(a.tipo)<0||ja[a.tipo])
      throw new Error('Protocolo, CPF ou tipo de documento inválido/duplicado.');
    ja[a.tipo]=true;
    a.todasPaginas=true; a.paginas=[];
  });
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var props=PropertiesService.getScriptProperties();
    if(props.getProperty('ADMALT_INDIV_PENDENTE_'+proto))throw new Error('Já existe importação em andamento para esse funcionário.');
    var pasta=_admSubpasta_(_admPastaDoCadastro_(cad),ADM.SUBPASTAS.ALTERDATA);
    Object.keys(ja).forEach(function(tipo){
      if(pasta.getFilesByName(tipo+'_'+proto+'.pdf').hasNext())
        throw new Error('Já existe '+tipo+' para o funcionário. Confira antes de reenviar.');
    });
    var r=admAlterdataImportarLote(user,p);
    props.setProperty('ADMALT_INDIV_PENDENTE_'+proto,JSON.stringify({desde:Date.now(),ids:Object.keys(ids)}));
    return r;
  }finally{lock.releaseLock();}
}
function admAlterdataImportarLote(user,p) {
  if (!p || p.confirmarConferencia !== true) throw new Error('Revise a correspondencia CPF / protocolo / paginas e confirmeConferencia antes da importacao.');
  if (!Array.isArray(p.lotes) || !p.lotes.length) throw new Error('Informe lotes com arquivoId e atribuicoes.');
  if (p.lotes.length > 8) throw new Error('Importe ate 8 PDFs por envio.');
  p.lotes.forEach(function(l){
    if(!l.arquivoId || !Array.isArray(l.atribuicoes) || !l.atribuicoes.length)
      throw new Error('Informe o PDF e pelo menos uma atribuicao.');
    var arquivo=DriveApp.getFileById(String(l.arquivoId));
    if(arquivo.getMimeType()!==MimeType.PDF) throw new Error('O arquivo informado nao e um PDF.');
    if(arquivo.getSize()>20*1024*1024) throw new Error('PDF maior que 20MB: divida o lote.');
  });
  var job={lotes:p.lotes, usuario: (user && user.EMAIL)||''};
  var t=ScriptApp.newTrigger('_admAlterdataImportarWorker_').timeBased().after(1000).create();
  PropertiesService.getScriptProperties().setProperty('ADMALT_JOB_'+t.getUniqueId(), JSON.stringify(job));
  return {ok:true,status:'agendado',mensagem:'Importacao em segundo plano. Consulte a aba ADM_ALTERDATA_IMPORTACAO para o resultado; nao gere kits ate todos os documentos estarem conferidos.'};
}
function _admAlterdataLog_(linhas) {
  var ss=_admSSCadastros_(), sh=ss.getSheetByName('ADM_ALTERDATA_IMPORTACAO') || ss.insertSheet('ADM_ALTERDATA_IMPORTACAO');
  if (!sh.getLastRow()) sh.appendRow(['DATA_HORA','ARQUIVO_ID','PROTOCOLO','TIPO','PAGINAS','STATUS','DETALHE']);
  linhas.forEach(function(l){sh.appendRow([new Date()].concat(l));});
}
function _admCpfSomenteDigitos_(v) {return String(v == null ? '' : v).replace(/\D/g,'');}
async function _admAlterdataImportarWorker_(e) {
  var uid=e && e.triggerUid;
  if (!uid) throw new Error('UID do gatilho nao recebido.');
  var props=PropertiesService.getScriptProperties();
  var jobRaw=props.getProperty('ADMALT_JOB_'+uid);
  _admRemoverGatilhoPorUid_(uid); props.deleteProperty('ADMALT_JOB_'+uid);
  if (!jobRaw) return;
  var job=JSON.parse(jobRaw), log=[];
  try {
    _pdfLibCarregar_();
    var preparar=[], documentosPorCadastro={};
    // Passo 1: validar TODOS os PDFs e TODOS os mapeamentos, antes de gravar qualquer arquivo.
    for (var i=0;i<job.lotes.length;i++) {
      var lote=job.lotes[i];
      if (!lote.arquivoId || !Array.isArray(lote.atribuicoes) || !lote.atribuicoes.length) throw new Error('Lote sem PDF ou atribuicoes.');
      var file=DriveApp.getFileById(String(lote.arquivoId));
      if (file.getMimeType()!==MimeType.PDF) throw new Error('O arquivo '+lote.arquivoId+' nao e PDF.');
      var doc=await PDFLib.PDFDocument.load(new Uint8Array(file.getBlob().getBytes()),{ignoreEncryption:true});
      var total=doc.getPageCount(), usadas={};
      for (var k=0;k<lote.atribuicoes.length;k++) {
        var a=lote.atribuicoes[k];
        if (['contrato','ficha','salario_familia'].indexOf(String(a.tipo))<0) throw new Error('Tipo invalido: '+a.tipo);
        if (!a.protocolo || !/^\d{11}$/.test(_admCpfSomenteDigitos_(a.cpf))) throw new Error('Protocolo ou CPF ausente/invalido.');
        if (a.todasPaginas === true && Array.isArray(a.paginas) && a.paginas.length===0) a.paginas=Array.from({length:total},function(_,idx){return idx+1;});
        if (!Array.isArray(a.paginas) || !a.paginas.length) throw new Error('Informe as paginas para '+a.protocolo+'.');
        var unicidade=String(a.protocolo)+'|'+String(a.tipo);
        if (documentosPorCadastro[unicidade]) throw new Error('Documento '+a.tipo+' duplicado para o protocolo '+a.protocolo+'.');
        documentosPorCadastro[unicidade]=true;
        var cad=_admCadastroPorProtocolo_(String(a.protocolo));
        if (!cad) throw new Error('Protocolo nao existe na base: '+a.protocolo);
        if (_admCpfSomenteDigitos_(cad[ADM_COL.CPF])!==_admCpfSomenteDigitos_(a.cpf)) throw new Error('CPF nao corresponde ao protocolo '+a.protocolo+'. Importacao bloqueada.');
        var pages=[];
        a.paginas.forEach(function(n){
          if (!Number.isInteger(n) || n<1 || n>total) throw new Error('Numero de pagina invalido: '+n+'.');
          if (usadas[n]) throw new Error('Pagina '+n+' atribuida a mais de uma pessoa/documento no mesmo PDF.');
          usadas[n]=true; pages.push(n-1);
        });
        preparar.push({id:file.getId(),cad:cad,proto:String(a.protocolo),tipo:String(a.tipo),paginas:pages,fonte:doc});
      }
      if (Object.keys(usadas).length!==total) throw new Error('Ha paginas nao atribuidas no arquivo '+lote.arquivoId+'. Nenhum documento deste lote foi salvo.');
    }
    // Antecipar conflitos: bloquear importacao antes de gravar qualquer arquivo.
    preparar.forEach(function(r){
      var dest=_admSubpasta_(_admPastaDoCadastro_(r.cad),ADM.SUBPASTAS.ALTERDATA);
      if (dest.getFilesByName(r.tipo+'_'+r.proto+'.pdf').hasNext()) throw new Error('Documento individual ja existe: '+r.tipo+'_'+r.proto+'.pdf');
    });
    // Passo 2: salvar os documentos separados nas pastas do protocolo correspondente.
    for (var j=0;j<preparar.length;j++) {
      var r=preparar[j];
      var nd=await PDFLib.PDFDocument.create();
      var pg=await nd.copyPages(r.fonte,r.paginas);
      pg.forEach(function(pagina){nd.addPage(pagina);});
      var bytes=await nd.save();
      var nome=r.tipo+'_'+r.proto+'.pdf';
      var pasta=_admSubpasta_(_admPastaDoCadastro_(r.cad),ADM.SUBPASTAS.ALTERDATA);
      var existing=pasta.getFilesByName(nome);
      // Nunca substituir silently: o gestor deve conferir se e reimportacao consciente.
      if (existing.hasNext()) throw new Error('Arquivo ja existe: '+nome+'. Remova a versao antiga depois de conferir antes de importar novamente.');
      var b=Utilities.newBlob([].slice.call(new Int8Array(bytes)),'application/pdf',nome);
      var criado=pasta.createFile(b);
      log.push([r.id,r.proto,r.tipo,r.paginas.map(function(v){return v+1;}).join(','),'IMPORTADO',criado.getUrl()]);
    }
  } catch(ex) {
    log.push(['','','','','ERRO',String(ex && ex.message || ex)]);
  }
  _admAlterdataLog_(log);
  var done={};
  (job.lotes||[]).forEach(function(l){(l.atribuicoes||[]).forEach(function(a){if(a.todasPaginas===true)done[a.protocolo]=true;});});
  Object.keys(done).forEach(function(proto){PropertiesService.getScriptProperties().deleteProperty('ADMALT_INDIV_PENDENTE_'+proto);});
}


/* ============================================================================================
 * ALTERDATA V5 — Envio DIRETO à pasta original do funcionário.
 * Recebe um PDF individual de cada vez via API autenticada; sem staging nem visualizador.
 * O usuário seleciona funcionário e tipo e confirma que conferiu o conteúdo do PDF.
 * NÃO identifica CPF lendo páginas de PDF: a validação é CPF cadastral x protocolo.
 * ============================================================================================ */
function admAlterdataSalvarDireto(user,p) {
  var proto=String((p&&p.protocolo)||'').trim();
  var cpf=_admCpfSomenteDigitos_(p&&p.cpf);
  var tipo=String((p&&p.tipo)||'').trim();
  var nome=String((p&&p.nome)||'').trim();
  var base64=String((p&&p.base64)||'');
  if(!proto || !/^\d{11}$/.test(cpf)) throw new Error('Informe funcionário com protocolo e CPF cadastrados.');
  if(['contrato','ficha','salario_familia'].indexOf(tipo)<0) throw new Error('Tipo de documento inválido.');
  if(p.confirmarConferencia!==true) throw new Error('Confirme que verificou o titular e o tipo do PDF antes de anexar.');
  if(!/\.pdf$/i.test(nome) || /[\\/]/.test(nome)) throw new Error('Selecione arquivo PDF válido.');
  if(!base64 || base64.length>11*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new Error('PDF inválido ou maior que o limite de 8 MB.');
  var cad=_admCadastroPorProtocolo_(proto);
  if(!cad) throw new Error('Protocolo não encontrado na base de cadastros.');
  if(_admCpfSomenteDigitos_(cad[ADM_COL.CPF])!==cpf)
    throw new Error('CPF não corresponde ao cadastro do protocolo; documento não foi salvo.');
  var bytes=Utilities.base64Decode(base64);
  if(bytes.length<8 || bytes.length>8*1024*1024 ||
     bytes[0]!==37 || bytes[1]!==80 || bytes[2]!==68 || bytes[3]!==70 || bytes[4]!==45)
    throw new Error('Conteúdo não parece ser um PDF válido ou excede 8 MB.');
  // Exige pasta ORIGINAL cadastrada; jamais cria outra pasta raiz/desvinculada.
  var pastaColab=_admPastaDoCadastro_(cad);
  if(pastaColab.isTrashed()) throw new Error('A pasta original do funcionário está na lixeira.');
  var lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var destino=_admSubpasta_(pastaColab,ADM.SUBPASTAS.ALTERDATA);
    var arquivoNome=tipo+'_'+proto+'.pdf';
    if(destino.getFilesByName(arquivoNome).hasNext())
      throw new Error('Documento '+tipo+' já consta na pasta do funcionário. Confira antes de substituir.');
    var novo=destino.createFile(Utilities.newBlob(bytes,'application/pdf',arquivoNome));
    try { _admAlterdataLog_([[novo.getId(),proto,tipo,'todas','IMPORTADO_DIRETO',novo.getUrl()]]); }
    catch(e){ Logger.log('Arquivo salvo mas falhou registro de auditoria: '+e.message); }
    return {ok:true,protocolo:proto,tipo:tipo,nome:String(cad[ADM_COL.NOME]||''),
      arquivoId:novo.getId(),arquivoUrl:novo.getUrl(),pastaUrl:destino.getUrl(),
      mensagem:'Documento '+tipo+' salvo na pasta original do funcionário.'};
  } finally {lock.releaseLock();}
}
/**
 * Gera kits em lote para todos os colaboradores
 * que já estão com documentos e dados prontos.
 *
 * Executar manualmente no Apps Script:
 * gerarKitsProntos
 */
function gerarKitsProntos() {

  var user = {
    EMAIL: Session.getActiveUser().getEmail() || 'execucao_manual'
  };

  var cadastros = _admCadastros_();
  var tratMapa = _admTratativaMapa_();

  var total = cadastros.length;
  var prontos = 0;
  var agendados = 0;
  var pulados = 0;
  var erros = 0;

  var detalhes = [];

  // Segurança: evita criar gatilhos demais de uma só vez.
  var LIMITE_POR_EXECUCAO = 20;

  for (var i = 0; i < cadastros.length; i++) {

    if (agendados >= LIMITE_POR_EXECUCAO) {
      break;
    }

    var cad = cadastros[i];

    var proto = String(
      cad[ADM_COL.PROTOCOLO] || ''
    ).trim();

    var nome = String(
      cad[ADM_COL.NOME] || ''
    ).trim();

    // ---------------------------------------------------------
    // SEM PROTOCOLO
    // ---------------------------------------------------------

    if (!proto) {

      pulados++;

      detalhes.push({
        nome: nome,
        protocolo: '',
        status: 'PULADO',
        motivo: 'Sem protocolo.'
      });

      continue;
    }

    try {

      var trat = tratMapa[proto] || {};

      // -------------------------------------------------------
      // JÁ TEM KIT PRONTO
      // -------------------------------------------------------

      if (
        trat.KIT_STATUS === ADM.STATUS.KIT_PRONTO &&
        String(trat.KIT_URL || '').trim()
      ) {

        pulados++;

        detalhes.push({
          nome: nome,
          protocolo: proto,
          status: 'PULADO',
          motivo: 'Kit já está pronto.'
        });

        continue;
      }

      // -------------------------------------------------------
      // JÁ ESTÁ SENDO GERADO
      // -------------------------------------------------------

      if (
        trat.KIT_STATUS === ADM.STATUS.KIT_EM_PREPARACAO
      ) {

        pulados++;

        detalhes.push({
          nome: nome,
          protocolo: proto,
          status: 'PULADO',
          motivo: 'Kit já está em preparação.'
        });

        continue;
      }

      // -------------------------------------------------------
      // VERIFICA DOCUMENTOS + DADOS
      // -------------------------------------------------------

      var status = admAlterdataStatus(
        user,
        {
          protocolo: proto
        }
      );

      if (
        !status ||
        status.pronto !== true
      ) {

        pulados++;

        var motivoPendencia = 'Ainda possui pendências.';

        if (
          status &&
          Array.isArray(status.pendencias) &&
          status.pendencias.length
        ) {
          motivoPendencia =
            status.pendencias.join(' | ');
        }

        detalhes.push({
          nome: nome,
          protocolo: proto,
          status: 'PULADO',
          motivo: motivoPendencia
        });

        continue;
      }

      prontos++;

      // -------------------------------------------------------
      // MARCA COMO EM PREPARAÇÃO
      // -------------------------------------------------------

      _admUpsertTratativa_(
        cad,
        {
          KIT_STATUS:
            ADM.STATUS.KIT_EM_PREPARACAO
        },
        {
          data: _agoraISO_(),
          usuario: user.EMAIL,
          acao: 'KIT_GERAR_LOTE_AGENDADO'
        }
      );

      // -------------------------------------------------------
      // AGENDA O MESMO WORKER QUE O SISTEMA JÁ USA
      // -------------------------------------------------------

      _admAgendarKitEmSegundoPlano_(
        proto,
        true,
        user.EMAIL
      );

      agendados++;

      detalhes.push({
        nome: nome,
        protocolo: proto,
        status: 'AGENDADO',
        motivo:
          'Documentação completa. Kit enviado para geração.'
      });

    } catch (err) {

      erros++;

      detalhes.push({
        nome: nome,
        protocolo: proto,
        status: 'ERRO',
        motivo:
          err && err.message
            ? err.message
            : String(err)
      });

      try {

        _admUpsertTratativa_(
          cad,
          {
            KIT_STATUS:
              ADM.STATUS.KIT_ERRO
          },
          {
            data: _agoraISO_(),
            usuario: user.EMAIL,
            acao: 'KIT_GERAR_LOTE_ERRO',
            erro: String(err)
          }
        );

      } catch (ignorar) {
      }
    }
  }

  var resultado = {
    ok: true,
    totalCadastros: total,
    prontosEncontrados: prontos,
    kitsAgendados: agendados,
    pulados: pulados,
    erros: erros,
    limitePorExecucao:
      LIMITE_POR_EXECUCAO,
    detalhes: detalhes
  };

  Logger.log(
    JSON.stringify(
      resultado,
      null,
      2
    )
  );

  return resultado;
}