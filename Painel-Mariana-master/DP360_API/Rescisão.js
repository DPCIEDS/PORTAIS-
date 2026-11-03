/*************************************************************************************************
 * MÓDULO RESCISÃO · DP360, arquivo RESCISAO.gs  (v1.2.0, inclui RESCISÃO COMPLEMENTAR)
 * -----------------------------------------------------------------------------------------------
 * Cole como NOVO arquivo no projeto DP360_API (ao lado de Codigo.gs, FERIAS.gs, AFASTAMENTOS.gs).
 * Se você já tinha uma versão anterior colada, SUBSTITUA o arquivo inteiro por este.
 *
 * RESCISÃO COMPLEMENTAR (esta versão), rastro do que hoje só fica em texto livre:
 *   Reaproveita a aba já existente "RESCISAO COMPLENTAR" na mesma planilha CONTROLE DE PAGAMENTO
 *   (hoje com 6 linhas lançadas à mão, coluna MOTIVO em texto livre). Este módulo:
 *     • MANTÉM as colunas e os dados que já existem ali intactos.
 *     • ACRESCENTA colunas estruturadas ao FINAL (nunca no meio) para dar categoria + causa raiz:
 *         MOTIVO_CATEGORIA → ERRO_CALCULO_DP | DISSIDIO | MULTA_477 | OUTRO
 *         CAUSA_ATRASO     → (só quando MOTIVO_CATEGORIA = MULTA_477)
 *                            DP_NAO_CUMPRIU_PRAZO | DP_RECEBEU_FORA_DO_PRAZO |
 *                            FINANCEIRO_NAO_PAGOU_A_TEMPO | OUTRO
 *   A coluna MOTIVO (texto livre já existente) continua sendo preenchida também, com um texto
 *   padronizado que bate com o que já está lá, só que agora nasce de uma categoria confiável,
 *   pronta para virar indicador (RESCISAO.COMPLEMENTAR_INDICADORES já entrega uma contagem).
 *
 * FATIA 2, conciliação (v1.1.0):
 *   5) ANEXAR_RESCISAO   → DP anexa o PDF da rescisão calculada no Alterdata; o sistema guarda no
 *                           Drive e TENTA extrair candidatos a "valor líquido" do texto (melhor
 *                           esforço via OCR). Sempre com confirmação humana, nunca grava sozinho.
 *   6) CONFIRMAR_VALORES → DP confirma/edita o VALOR TRCT e informa o FGTS (rateio manual, porque
 *                           uma guia pode cobrir vários funcionários). Grava em R e S da CONTROLE.2026.
 *   7) ENVIAR_FINANCEIRO → manda e-mail ao financeiro com os links dos documentos e grava a
 *                           DATA DO ENVIO PARA FINANCEIRO (coluna T).
 *   8) ENVIAR_AUTENTIQUE → sobe o(s) documento(s) no Autentique para assinatura do colaborador e
 *                           grava o ID AUTENTIQUE (coluna AF). A VERIFICAÇÃO periódica de assinatura
 *                           e a coluna STATUS AUTENTIQUE (AH) continuam sendo a SUA automação já
 *                           existente, este módulo só LÊ essa coluna, nunca escreve nela.
 *   9) BAIXAR_ARQUIVAR   → quando a coluna AH indicar assinado, baixa o PDF assinado do Autentique
 *                           e arquiva na pasta do colaborador no Drive.
 *
 * FATIA 1, a espinha do processo de desligamento:
 *   [GESTOR]  solicita a rescisão de alguém da equipe:
 *              • escolhe o colaborador, o tipo, o modo (aplicar ele mesmo x pedir que o DP contate)
 *              • quando for pedido de demissão, pode gerar o MODELO de carta e/ou anexar a carta assinada
 *   [DP]      conduz o fluxo pelo Portal do DP e o gestor é avisado em cada etapa:
 *              1) AGENDAR      → marca o comparecimento; gestor (e colaborador) são avisados
 *              2) COMPARECIMENTO → registra se compareceu (e a opção de aviso: 7 dias ou 2 horas)
 *                                  ou que NÃO compareceu (com novo agendamento); gestor é avisado
 *              3) EXAME        → grava a DATA DO EXAME DEMISSIONAL na CONTROLE.2026 (coluna AD)
 *              4) DESLIGAR     → grava DEMISSÃO (O), TIPO (Q) e OPÇÃO DE AVISO (Y) na CONTROLE.2026
 *                                → isso dispara as SUAS automações já existentes (TI e e-mail demissional)
 *
 * NÃO quebra nada da planilha: escreve por MATRÍCULA (coluna A) na CONTROLE.2026. Se a linha já
 * existe, preenche as colunas. Se não existe, insere ao fim RECRIANDO as fórmulas via copyTo (o
 * Sheets reajusta as referências). Cabeçalho real da CONTROLE.2026 está na LINHA 2; dados começam
 * na LINHA 3. Já a aba RESCISAO COMPLENTAR tem cabeçalho na LINHA 1, dados a partir da LINHA 2.
 *
 * ⚠️ SOBRE O AUTENTIQUE: a integração usa a API GraphQL pública deles (endpoint e forma de
 * autenticação estáveis há anos), mas eu não tenho como testar a chamada de rede daqui. Rode
 * testarAutentique() depois de configurar o token, ele faz só uma consulta leve (sem custo) para
 * confirmar que o token funciona antes de você confiar no fluxo de assinatura.
 * ⚠️ PENDÊNCIA CONHECIDA: BAIXAR_ARQUIVAR hoje baixa o assinado direto da API do Autentique e
 * grava em LINK_DRIVE_ASSINATURA, só que a coluna AG (LINK DRIVE) já é preenchida pela SUA
 * automação existente. Isso duplica o download. Vamos corrigir isso junto com o Portal do DP
 * (ler o link que a automação já colocou em AG, em vez de baixar de novo).
 *
 * O QUE NÃO ESTÁ NESTA FATIA (vem depois):
 *   FATIA 3, Abandono de emprego: +15 faltas, telegrama, comprovantes, contracheques/ponto.
 *   FATIA 4, Alertas automáticos: fim de contrato (~20 dias antes) e aprendiz que completa 24 anos.
 *   FATIA 5, Buscador da jornada do colaborador (todos os documentos num só lugar).
 *
 * PARA PLUGAR NO KERNEL (2 patches em outros arquivos + 1 função de setup):
 *   1) Codigo.gs   → registrar o módulo em _modulosDisponiveis_() (bloco pronto no fim deste arquivo)
 *   2) FERIAS.gs   → adicionar o roteamento de RESCISAO.* no executar() (bloco pronto no fim)
 *   3) rode UMA vez: rescSetup()      (cria a aba de casos + semeia as permissões)
 *   4) (Fatia 2)   → configurarAutentiqueToken('SEU_TOKEN')  e  testarAutentique()
 *
 * DEPENDÊNCIAS (já existem no projeto): _colaboradores_, _equipeDoGestor_, _emailDoColaborador_,
 *   _emailDoDP_, _moldura_, _quadro_, _enviar_, _feriasParam_, _setFeriasParam_, _dataF_, _isoF_,
 *   _fmtBRF_, _addDiasF_, _hojeFerias_, _sheetToObjects_, _atualizarLinha_, _headers_, _auditar_,
 *   _sim_, _uuid_, _normalizarEmail_, _salvarDocumento_ (AFASTAMENTOS), _slug_ (AFASTAMENTOS),
 *   _pastaDoColaborador_ (AFASTAMENTOS).
 *************************************************************************************************/

const RESC = {
  VERSAO: '1.0.0',

  // URL do mini web app "Guia da Rescisão" (mesmo padrão do AFAST.GUIA_URL: constante fixa no
  // código, não lida da aba PARAMETROS, evita os problemas de cache/deployment que já vimos
  // antes). Preencha depois de publicar o Guia_Rescisao (Implantar > Nova implantação > /exec).
  GUIA_URL: 'https://script.google.com/macros/s/AKfycbwrUJvnjKR0FO_7NfsrbEo3lXuPKOhmFk6JOREUQKEd4stIksPmsA2eN2OsKh-Qf0UO/exec',

  // Planilha "CONTROLE DE PAGAMENTO 2026" (a que você já usa, com as automações).
  CONTROLE_ID: '1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc',

  ABAS: {
    CONTROLE: 'CONTROLE.2026',      // planilha operacional já existente
    CASOS: 'RESCISAO_CASOS',        // log append-only dos casos (o módulo cria)
    COMPLEMENTAR: 'RESCISAO COMPLENTAR'   // aba já existente (nome com esse "typo" mesmo, não mude)
  },

  // Cabeçalho da RESCISAO COMPLENTAR está na LINHA 1 (diferente da CONTROLE.2026). Dados desde a LINHA 2.
  COMPLEMENTAR_LINHA_INICIAL: 2,

  // Colunas que JÁ EXISTIAM na aba antes deste módulo (não mexer na ordem nem no texto livre de P).
  COMPLEMENTAR_COL: {
    MATRICULA: 1, EMPRESA: 2, COD: 3, EMAIL: 4, NOME: 5, DEPARTAMENTO: 6, FUNCAO: 7,
    ADMISSAO: 8, DEMISSAO: 9, MES: 10, TIPO_DEMISSAO: 11,
    VALOR_TRCT: 12, VALOR_TRCT_COMPLEMENTAR: 13,
    DATA_ENVIO_FINANCEIRO: 14, DATA_PAGAMENTO: 15,
    MOTIVO: 16,   // texto livre já usado (ex.: "MULTA 477 ATRASO NO PAGAMENTO"), continua sendo preenchido
    // ---- colunas NOVAS deste módulo, sempre ao final ----
    MOTIVO_CATEGORIA: 17, CAUSA_ATRASO: 18, OBSERVACAO: 19,
    REGISTRADO_POR: 20, REGISTRADO_EM: 21, CASO_RESCISAO_ORIGEM: 22
  },

  // Motivo raiz da rescisão complementar.
  MOTIVOS_COMPLEMENTAR: [
    { cod: 'ERRO_CALCULO_DP', nome: 'Erro no cálculo original (DP)', motivoTexto: 'COMPLEMENTO POR ERRO DE CÁLCULO (DP)' },
    { cod: 'DISSIDIO', nome: 'Dissídio / reajuste retroativo', motivoTexto: 'DISSÍDIO / REAJUSTE RETROATIVO' },
    { cod: 'MULTA_477', nome: 'Multa do art. 477 CLT (atraso no pagamento)', motivoTexto: 'MULTA 477 ATRASO NO PAGAMENTO' },
    { cod: 'OUTRO', nome: 'Outro motivo', motivoTexto: 'OUTRO MOTIVO' }
  ],

  // Causa raiz do atraso, só perguntado quando o motivo é MULTA_477. É esse detalhe que
  // futuramente vira indicador (quanto foi por erro do DP x atraso do financeiro x outro).
  CAUSAS_ATRASO_477: [
    { cod: 'DP_NAO_CUMPRIU_PRAZO', nome: 'O DP não cumpriu o prazo (erro/atraso interno)' },
    { cod: 'DP_RECEBEU_FORA_DO_PRAZO', nome: 'O DP recebeu a solicitação/documentação fora do prazo' },
    { cod: 'FINANCEIRO_NAO_PAGOU_A_TEMPO', nome: 'O financeiro não efetuou o pagamento a tempo' },
    { cod: 'OUTRO', nome: 'Outro' }
  ],

  // Cabeçalho da CONTROLE.2026 está na LINHA 2 (linha 1 é agrupador). Dados começam na LINHA 3.
  CONTROLE_LINHA_INICIAL: 3,
  CONTROLE_LINHA_MODELO: 3,   // de onde copiamos as fórmulas ao inserir uma matrícula nova

  // Índices (1-based) das colunas da CONTROLE.2026 que o módulo lê/escreve.
  COL: {
    MATRICULA: 1,   // A
    EMPRESA: 2,     // B
    COD: 3,         // C
    EMAIL: 4,       // D (fórmula)
    NOME: 5,        // E
    DEPARTAMENTO: 9,// I
    DEMISSAO: 15,   // O  ← grava aqui dispara TI + e-mail demissional
    TIPO: 17,       // Q
    VALOR_TRCT: 18, // R  (FATIA 2, escreve)
    GFD: 19,        // S  (FATIA 2, escreve)
    ENVIO_FINANCEIRO: 20,      // T  (FATIA 2, escreve: DATA DO ENVIO PARA FINANCEIRO)
    DATA_PAGAMENTO: 21,        // U  (fórmula, só leitura, nunca escreve)
    OPCAO_AVISO: 25,// Y
    STATUS_ENVIO_AUTENTIQUE: 27, // AA (FATIA 2, escreve)
    ID_AUTENTIQUE: 32,          // AF (FATIA 2, escreve, o ID do documento no Autentique)
    LINK_DRIVE_ASSINATURA: 33,  // AG (FATIA 2, escreve: link do PDF assinado arquivado)
    STATUS_AUTENTIQUE: 34,      // AH ← SÓ LEITURA. Quem escreve aqui é a SUA automação existente.
    ULTIMA_VERIFICACAO: 35,     // AI ← SÓ LEITURA (idem)
    DATA_EXAME: 30  // AD ← grava aqui dispara a automação de exame demissional
  },

  // Textos que a automação existente usa em AH (STATUS AUTENTIQUE) para indicar "assinado".
  // Ajuste esta lista se o texto exato usado por lá for diferente (rode diagnosticarRescisoes()
  // depois de um caso passar por lá para conferir o valor real gravado).
  MARCADORES_ASSINADO: ['ASSINADO', 'ASSINATURA CONCLUIDA', 'ASSINATURA CONCLUÍDA', 'FINALIZADO', 'CONCLUIDO', 'CONCLUÍDO'],

  // Colunas da CONTROLE.2026 que têm FÓRMULA e precisam ser recriadas ao inserir matrícula nova.
  // D,G,H,J,K,L,M (VLOOKUPs), P (mês), U (pagamento), V,W,X (banco/agência/conta).
  COLUNAS_FORMULA: [4, 7, 8, 10, 11, 12, 13, 16, 21, 22, 23, 24],

  // Estrutura do log de casos (aba RESCISAO_CASOS, cabeçalho na linha 1).
  // Novas colunas SEMPRE no fim (garantirAbaCasosRescisao() acrescenta sem deslocar nada).
  COLUNAS_CASOS: [
    'ID_CASO', 'ID_COLABORADOR', 'MATRICULA', 'NOME', 'EMPRESA', 'COD', 'DEPARTAMENTO', 'GESTOR_EMAIL',
    'TIPO_COD', 'TIPO', 'MODO_SOLICITACAO', 'AVISO_MODALIDADE', 'AVISO_OPCAO',
    'CARTA_LINK', 'STATUS',
    'DATA_AGENDAMENTO', 'DATA_COMPARECIMENTO', 'COMPARECEU',
    'DATA_EXAME', 'DATA_DEMISSAO',
    'SOLICITADO_POR', 'SOLICITADO_EM', 'ATUALIZADO_POR', 'ATUALIZADO_EM',
    'HISTORICO_JSON', 'OBSERVACAO',
    // ---- FATIA 2 (conciliação) ----
    'RESCISAO_DOC_LINK', 'VALOR_TRCT_CANDIDATOS_JSON', 'VALOR_TRCT_CONFIRMADO', 'FGTS_VALOR',
    'CONCILIADO_POR', 'CONCILIADO_EM',
    'FINANCEIRO_ENVIADO_EM', 'FINANCEIRO_DOCS_JSON',
    'AUTENTIQUE_DOC_ID', 'AUTENTIQUE_ENVIADO_EM',
    'ASSINATURA_LINK', 'ARQUIVADO_EM',
    // ---- estabilidade acidentária (checagem em SEM_JUSTA_CAUSA) ----
    'ESTABILIDADE_ATIVA_NA_SOLICITACAO', 'ESTABILIDADE_ATE', 'ESTABILIDADE_JUSTIFICATIVA',
    // ---- exame demissional dispensado (exame anterior com menos de 90 dias) ----
    'EXAME_DISPENSADO', 'EXAME_DISPENSADO_MOTIVO',
    // ---- Pedido de Demissão: registro direto, pulando o Agendar (a pessoa já veio e pediu) ----
    'REGISTRO_DIRETO',
    // ---- Laudo de Insuficiência: documento anexado na solicitação ----
    'LAUDO_LINK'
  ],

  STATUS: {
    SOLICITADA: 'SOLICITADA',
    AGENDADA: 'AGENDADA',
    NAO_COMPARECEU: 'NAO_COMPARECEU',
    COMPARECEU: 'COMPARECEU',
    EXAME_MARCADO: 'EXAME_MARCADO',
    DESLIGADO: 'DESLIGADO',
    CANCELADA: 'CANCELADA',
    // ---- FATIA 2 (conciliação), só chegam aqui depois de DESLIGADO ----
    AGUARDANDO_CONCILIACAO: 'AGUARDANDO_CONCILIACAO',
    VALORES_CONFIRMADOS: 'VALORES_CONFIRMADOS',
    ENVIADO_FINANCEIRO: 'ENVIADO_FINANCEIRO',
    AGUARDANDO_ASSINATURA: 'AGUARDANDO_ASSINATURA',
    ARQUIVADO: 'ARQUIVADO'
  },

  // Config do Autentique (GraphQL). Guardado em PARAMETROS via _rescParam_/_setFeriasParam_.
  AUTENTIQUE_PARAM_TOKEN: 'AUTENTIQUE_TOKEN',
  AUTENTIQUE_ENDPOINT: 'https://api.autentique.com.br/v2/graphql',
  AUTENTIQUE_PARAM_FINANCEIRO_EMAIL: 'RESC_FINANCEIRO_EMAIL',

  // Modelos PRONTOS de carta de pedido de demissão, links estáticos para Google Docs que a
  // própria Karla/Mari cria e compartilha ("Qualquer pessoa com o link, Leitor"). O módulo NUNCA
  // gera documento dinamicamente (isso pedia um escopo extra de autorização, DocumentApp, e
  // sem necessidade, já que o texto é sempre o mesmo). Configure com configurarModelosCartaDemissao().
  MODELOS_CARTA: [
    { cod: 'CUMPRINDO_AVISO', nome: 'Pedido de demissão, cumprindo aviso', param: 'RESC_MODELO_CUMPRINDO_AVISO' },
    { cod: 'SEM_CUMPRIR_AVISO', nome: 'Pedido de demissão, sem cumprir aviso', param: 'RESC_MODELO_SEM_CUMPRIR_AVISO' },
    { cod: 'PERIODO_EXPERIENCIA', nome: 'Pedido de demissão, período de experiência', param: 'RESC_MODELO_PERIODO_EXPERIENCIA' },
    { cod: 'CONTRATO_DETERMINADO', nome: 'Pedido de demissão, contrato determinado', param: 'RESC_MODELO_CONTRATO_DETERMINADO' }
  ],

  // Tipos de rescisão. pedeAviso = a modalidade (trabalhado/indenizado) é aplicável.
  TIPOS: [
    { cod: 'PEDIDO_DEMISSAO', nome: 'Pedido de demissão',              pedeAviso: true,  pedeCarta: true },
    { cod: 'SEM_JUSTA_CAUSA', nome: 'Dispensa sem justa causa',        pedeAviso: true,  pedeCarta: false },
    { cod: 'COM_JUSTA_CAUSA', nome: 'Dispensa por justa causa',        pedeAviso: false, pedeCarta: false },
    { cod: 'TERMINO_CONTRATO', nome: 'Término de contrato',            pedeAviso: false, pedeCarta: false },
    { cod: 'DISTRATO',        nome: 'Comum acordo (art. 484-A)',       pedeAviso: true,  pedeCarta: false },
    { cod: 'ABANDONO',        nome: 'Abandono de emprego',             pedeAviso: false, pedeCarta: false },
    { cod: 'APRENDIZ_24',     nome: 'Término de aprendizagem (24 anos)', pedeAviso: false, pedeCarta: false },
    { cod: 'FALECIMENTO',     nome: 'Falecimento',                     pedeAviso: false, pedeCarta: false },
    { cod: 'LAUDO_INSUFICIENCIA', nome: 'Laudo de Insuficiência',      pedeAviso: false, pedeCarta: false, pedeLaudo: true }
  ],

  // Como cada opção de aviso é escrita na coluna Y (para casar com o padrão já usado na planilha).
  AVISO_OPCAO_TEXTO: { '7_DIAS': '7 DIAS', '2_HORAS': '2 HORAS' },

  // Texto gravado na coluna TIPO DE DEMISSÃO (Q) da CONTROLE.2026. Essa coluna tem validação de
  // dados travada (lista suspensa, "Rejeitar entrada") — só aceita um destes textos exatos, senão
  // o Sheets recusa a gravação. Confirmado com o DP em 2026-09-01 conferindo a lista real da
  // validação (Dados → Validação de dados na coluna Q).
  TIPO_DEMISSAO_TEXTO: {
    PEDIDO_DEMISSAO_TRABALHADO: 'PEDIDO DE DEMISSÃO COM O CUMPRIMENTO DO AVISO',
    PEDIDO_DEMISSAO_INDENIZADO: 'PEDIDO DE DEMISSÃO SEM O CUMPRIMENTO DO AVISO',
    SEM_JUSTA_CAUSA_TRABALHADO: 'AVISO PRÉVIO TRABALHADO',
    SEM_JUSTA_CAUSA_INDENIZADO: 'AVISO INDENIZADO',
    COM_JUSTA_CAUSA: 'JUSTA CAUSA',
    TERMINO_CONTRATO: 'TÉRMINO DE CONTRATO',
    APRENDIZ_24: 'TÉRMINO DE CONTRATO - IDADE 24 ANOS',
    DISTRATO: 'ACORDO',            // vale com aviso trabalhado ou indenizado (ver _tipoDemissaoTextoOuVazio_)
    // [2026-10-21] conferidos contra a lista da coluna Q; "ABANDONO" foi incluído na lista a pedido do DP
    FALECIMENTO: 'FALECIMENTO',
    LAUDO_INSUFICIENCIA: 'LAUDO DE INSUFICIÊNCIA',
    ABANDONO: 'ABANDONO'
  }
};

/* ============================================================================================ */
/*  ROTEADOR DO MÓDULO  (chamado pelo executar() do FERIAS.gs)                                   */
/* ============================================================================================ */

function rescExecutar(acao, p, user) {
  switch (acao) {
    // GESTOR
    case 'RESCISAO.CONTEXTO':      return rescContexto(user, p);
    case 'RESCISAO.RESUMO':        return rescResumo(user, p);
    case 'RESCISAO.TIPOS':         return { ok: true, tipos: RESC.TIPOS };
    case 'RESCISAO.SOLICITAR':     return rescSolicitar(user, p);
    case 'RESCISAO.MODELOS_CARTA': return rescModelosCarta(user, p);
    case 'RESCISAO.CANCELAR':      return rescCancelar(user, p);

    // DP
    case 'RESCISAO.FILA':          return rescFila(user, p);
    case 'RESCISAO.AGENDAR':       return rescAgendar(user, p);
    case 'RESCISAO.REGISTRAR_DIRETO': return rescRegistrarDireto(user, p);
    case 'RESCISAO.COMPARECIMENTO':return rescComparecimento(user, p);
    case 'RESCISAO.EXAME':         return rescExame(user, p);
    case 'RESCISAO.EXAME_DISPENSAR': return rescExameDispensar(user, p);
    case 'RESCISAO.DESLIGAR':      return rescDesligar(user, p);

    // DP, FATIA 2 (conciliação)
    case 'RESCISAO.ANEXAR_RESCISAO':   return rescAnexarRescisao(user, p);
    case 'RESCISAO.CONFIRMAR_VALORES': return rescConfirmarValores(user, p);
    case 'RESCISAO.ENVIAR_FINANCEIRO': return rescEnviarFinanceiro(user, p);
    case 'RESCISAO.ENVIAR_AUTENTIQUE': return rescEnviarAutentique(user, p);
    case 'RESCISAO.CANCELAR_AUTENTIQUE': return rescCancelarAutentique(user, p);
    case 'RESCISAO.VERIFICAR_ASSINATURA': return rescVerificarAssinatura(user, p);
    case 'RESCISAO.BAIXAR_ARQUIVAR':   return rescBaixarArquivar(user, p);

    // DP, HOMOLOGAÇÃO (lê direto da CONTROLE.2026 por matrícula — não depende de caso no Portal;
    // busca automática do TRCT + Seguro Desemprego na pasta do Drive por mês)
    case 'RESCISAO.HOMOLOGACAO_LISTA':              return rescHomologacaoLista(user, p);
    case 'RESCISAO.VER_DOCUMENTOS_HOMOLOGACAO':     return rescVerDocumentosHomologacaoPorMatricula(user, p);
    case 'RESCISAO.ENVIAR_HOMOLOGACAO_AUTENTIQUE':  return rescEnviarHomologacaoAutentiquePorMatricula(user, p);
    case 'RESCISAO.ENVIAR_TODAS_HOMOLOGACOES_AUTENTIQUE': return rescEnviarTodasHomologacoesAutentique(user);
    case 'RESCISAO.BAIXAR_TODAS_HOMOLOGACOES_AUTENTIQUE': return rescBaixarTodasHomologacoesAutentique(user);
    case 'RESCISAO.CANCELAR_HOMOLOGACAO_AUTENTIQUE': return rescCancelarHomologacaoAutentiquePorMatricula(user, p);
    case 'RESCISAO.VERIFICAR_ASSINATURA_HOMOLOGACAO': return rescVerificarAssinaturaHomologacaoPorMatricula(user, p);
    case 'RESCISAO.VERIFICAR_TODAS_ASSINATURAS_HOMOLOGACAO': return rescVerificarTodasAssinaturasHomologacao(user);
    case 'RESCISAO.BAIXAR_ARQUIVAR_HOMOLOGACAO':    return rescBaixarArquivarHomologacaoPorMatricula(user, p);

    // DP, RESCISÃO COMPLEMENTAR
    case 'RESCISAO.COMPLEMENTAR_MOTIVOS':      return { ok: true, motivos: RESC.MOTIVOS_COMPLEMENTAR, causasAtraso: RESC.CAUSAS_ATRASO_477 };
    case 'RESCISAO.COMPLEMENTAR_REGISTRAR':    return rescComplementarRegistrar(user, p);
    case 'RESCISAO.COMPLEMENTAR_LISTAR':       return rescComplementarListar(user, p);
    case 'RESCISAO.COMPLEMENTAR_INDICADORES':  return rescComplementarIndicadores(user, p);

    default:
      throw new Error('Ação de rescisão desconhecida: ' + acao);
  }
}

/* ============================================================================================ */
/*  INFRA, acesso à planilha e à aba de casos                                                   */
/* ============================================================================================ */

var _SS_CONTROLE_RESC_ = null;
function _ssControle_() {
  if (!_SS_CONTROLE_RESC_) _SS_CONTROLE_RESC_ = SpreadsheetApp.openById(RESC.CONTROLE_ID);
  return _SS_CONTROLE_RESC_;
}

function _shControle_() {
  const sh = _ssControle_().getSheetByName(RESC.ABAS.CONTROLE);
  if (!sh) throw new Error('Aba não encontrada em CONTROLE DE PAGAMENTO: ' + RESC.ABAS.CONTROLE);
  return sh;
}

function _shCasos_() {
  const sh = _ssControle_().getSheetByName(RESC.ABAS.CASOS);
  if (!sh) throw new Error('Aba RESCISAO_CASOS não existe. Rode rescSetup() uma vez.');
  return sh;
}

/* ============================================================================================ */
/*  MAPA DE COLUNAS, validação automática contra o cabeçalho real (CONTROLE.2026 e COMPLEMENTAR) */
/*  RESC.COL / RESC.COMPLEMENTAR_COL são índices fixos (ex.: NOME: 5). Essas duas abas já         */
/*  existiam antes do módulo e continuam abertas para edição manual na planilha — se alguém      */
/*  reordenar ou renomear uma coluna por lá, o código continuaria gravando no índice antigo sem   */
/*  avisar nada. Esta checagem compara o cabeçalho atual contra um "retrato" salvo em Script      */
/*  Properties na primeira execução; se divergir depois, BLOQUEIA a escrita com erro claro em vez */
/*  de deixar o dado ir pra coluna errada em silêncio.                                            */
/* ============================================================================================ */

const RESC_BASELINE_PROP_CONTROLE = 'RESC_BASELINE_HEADERS_CONTROLE_V1';
const RESC_BASELINE_PROP_COMPLEMENTAR = 'RESC_BASELINE_HEADERS_COMPLEMENTAR_V1';
const RESC_MAPA_CACHE_KEY = 'RESC_MAPA_COLUNAS_OK_V1';
const RESC_MAPA_CACHE_TTL_SEG = 1800; // 30min: não precisa reconferir a cada chamada dentro da mesma janela

function _rescHeaderAtual_(sh, linhaCabecalho) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(linhaCabecalho, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
}

/**
 * Acha a coluna pelo NOME EXATO do cabeçalho (não pelo índice fixo) — pedido explícito pra
 * gravar em STATUS AUTENTIQUE / ÚLTIMA VERIFICAÇÃO sem depender do número da coluna, que pode
 * mudar se alguém inserir/mover colunas na planilha.
 */
function _colunaPorNomeExato_(sh, linhaCabecalho, nomeExato) {
  const cabecalhos = _rescHeaderAtual_(sh, linhaCabecalho);
  const idx = cabecalhos.indexOf(String(nomeExato).trim());
  if (idx === -1) throw new Error('Coluna "' + nomeExato + '" não encontrada no cabeçalho (linha ' + linhaCabecalho + ').');
  return idx + 1;
}

/** Acha, uma vez só, as colunas STATUS AUTENTIQUE + ÚLTIMA VERIFICAÇÃO pelo nome do cabeçalho —
 *  chame antes de um loop e reaproveite o resultado (evita reler o cabeçalho a cada linha). */
function _colunasStatusAutentiqueAoVivo_(sh) {
  return {
    colStatus: _colunaPorNomeExato_(sh, 2, 'STATUS AUTENTIQUE'),
    colUltimaVerificacao: _colunaPorNomeExato_(sh, 2, 'ÚLTIMA VERIFICAÇÃO')
  };
}

/** Grava o resultado da checagem em tempo real do Autentique direto na STATUS AUTENTIQUE +
 *  ÚLTIMA VERIFICAÇÃO — assim fica visível pra qualquer pessoa que abrir o Portal, não só na
 *  tela de quem clicou em Verificar/Atualizar. Colunas já resolvidas via _colunasStatusAutentiqueAoVivo_. */
function _gravarStatusAutentiqueAoVivo_(sh, colunas, row, info) {
  const texto = info.assinado
    ? 'ASSINADO'
    : 'AGUARDANDO ASSINATURA (' + info.totalAssinados + ' de ' + info.totalAssinantes + ')';
  sh.getRange(row, colunas.colStatus).setValue(texto);
  sh.getRange(row, colunas.colUltimaVerificacao).setValue(new Date());
}

/** [PERF] Versão em lote de _gravarStatusAutentiqueAoVivo_ — grava STATUS AUTENTIQUE + ÚLTIMA
 *  VERIFICAÇÃO de várias linhas em 1 getValues + 1 setValues por coluna (2 no total), em vez de
 *  2 setValue() por linha. Era o gargalo real do botão "Atualizar" em Homologações Enviadas: com
 *  ~200 pendentes isso batia quase 400 vezes na Sheets API, uma de cada vez — lento o bastante
 *  pra parecer travado. Não assume que as 2 colunas são adjacentes (achadas por nome do
 *  cabeçalho, podem estar em qualquer posição). itens: [{ linha, info }]. */
function _gravarStatusAutentiqueAoVivoLote_(sh, colunas, itens) {
  if (!itens.length) return;

  const linhaMin = itens.reduce((m, x) => Math.min(m, x.linha), itens[0].linha);
  const linhaMax = itens.reduce((m, x) => Math.max(m, x.linha), itens[0].linha);
  const nLinhas = linhaMax - linhaMin + 1;

  const rangeStatus = sh.getRange(linhaMin, colunas.colStatus, nLinhas, 1);
  const rangeVerif = sh.getRange(linhaMin, colunas.colUltimaVerificacao, nLinhas, 1);
  const valoresStatus = rangeStatus.getValues();
  const valoresVerif = rangeVerif.getValues();
  const agora = new Date();

  itens.forEach(({ linha, info }) => {
    const texto = info.assinado
      ? 'ASSINADO'
      : 'AGUARDANDO ASSINATURA (' + info.totalAssinados + ' de ' + info.totalAssinantes + ')';
    const idx = linha - linhaMin;
    valoresStatus[idx][0] = texto;
    valoresVerif[idx][0] = agora;
  });

  rangeStatus.setValues(valoresStatus);
  rangeVerif.setValues(valoresVerif);
}

function _rescConferirOuSemearBaseline_(props, chaveProp, headerAtual, mapaColunas, nomeAba) {
  const salvo = props.getProperty(chaveProp);

  if (!salvo) {
    // Primeira vez que essa checagem roda: adota o cabeçalho de agora como referência correta.
    props.setProperty(chaveProp, JSON.stringify(headerAtual));
    return;
  }

  const baseline = JSON.parse(salvo);
  const erros = [];

  Object.keys(mapaColunas).forEach(chave => {
    const idx = mapaColunas[chave] - 1;
    const atual = headerAtual[idx] || '';
    const esperado = baseline[idx] || '';
    if (atual !== esperado) {
      erros.push(chave + ' (coluna ' + (idx + 1) + '): antes era "' + esperado + '", agora está "' + atual + '"');
    }
  });

  if (erros.length) {
    throw new Error(
      'RESCISÃO BLOQUEADA: o cabeçalho da aba "' + nomeAba + '" mudou e não bate mais com o mapa de colunas ' +
      '(RESC.COL / RESC.COMPLEMENTAR_COL em Rescisão.js). Nenhum dado foi gravado.\n- ' + erros.join('\n- ') +
      '\n\nSe a mudança foi intencional (coluna renomeada/reordenada de propósito), ajuste o mapa de colunas ' +
      'no código e depois rode rescAtualizarBaselineColunas() uma vez para confirmar o novo layout.'
    );
  }
}

/**
 * Confere se RESC.COL e RESC.COMPLEMENTAR_COL ainda batem com o cabeçalho real das abas.
 * Roda automaticamente (com cache de 30min) em toda escrita via _controleUpsert_ e
 * rescComplementarRegistrar. Lança erro e não deixa gravar nada se o cabeçalho divergir.
 */
function _rescValidarMapaColunas_() {
  const cache = CacheService.getScriptCache();
  if (cache.get(RESC_MAPA_CACHE_KEY) === '1') return;

  const props = PropertiesService.getScriptProperties();

  _rescConferirOuSemearBaseline_(
    props, RESC_BASELINE_PROP_CONTROLE, _rescHeaderAtual_(_shControle_(), 2), RESC.COL, RESC.ABAS.CONTROLE
  );
  _rescConferirOuSemearBaseline_(
    props, RESC_BASELINE_PROP_COMPLEMENTAR, _rescHeaderAtual_(_shComplementar_(), 1), RESC.COMPLEMENTAR_COL, RESC.ABAS.COMPLEMENTAR
  );

  cache.put(RESC_MAPA_CACHE_KEY, '1', RESC_MAPA_CACHE_TTL_SEG);
}

/**
 * Rode manualmente no editor do Apps Script depois de confirmar uma mudança intencional de
 * layout nas abas CONTROLE.2026 / RESCISAO COMPLENTAR: apaga a referência salva e grava o
 * cabeçalho atual como o novo "correto".
 */
function rescAtualizarBaselineColunas() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(RESC_BASELINE_PROP_CONTROLE);
  props.deleteProperty(RESC_BASELINE_PROP_COMPLEMENTAR);
  CacheService.getScriptCache().remove(RESC_MAPA_CACHE_KEY);
  _rescValidarMapaColunas_();
  return 'Baseline de colunas atualizado a partir do cabeçalho atual de CONTROLE.2026 e RESCISAO COMPLENTAR.';
}

function _rescParam_(chave, padrao) {
  try { return _feriasParam_(chave, padrao); } catch (e) { return padrao; }
}

function _rescTipo_(cod) {
  return RESC.TIPOS.find(t => t.cod === String(cod || '').toUpperCase().trim()) ||
    { cod: 'OUTRO', nome: 'Rescisão', pedeAviso: false, pedeCarta: false };
}

/** Cria a aba de casos (append-only) uma única vez. Idempotente. */
function garantirAbaCasosRescisao() {
  const ss = _ssControle_();
  let sh = ss.getSheetByName(RESC.ABAS.CASOS);

  if (!sh) {
    sh = ss.insertSheet(RESC.ABAS.CASOS);
    sh.getRange(1, 1, 1, RESC.COLUNAS_CASOS.length).setValues([RESC.COLUNAS_CASOS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, RESC.COLUNAS_CASOS.length).setFontWeight('bold');
    return 'Aba RESCISAO_CASOS criada.';
  }

  const h = _headers_(sh);
  const faltando = RESC.COLUNAS_CASOS.filter(c => h.indexOf(c) === -1);
  if (faltando.length) {
    let col = sh.getLastColumn();
    faltando.forEach((nome, i) => sh.getRange(1, col + 1 + i).setValue(nome));
    return 'Colunas acrescentadas em RESCISAO_CASOS: ' + faltando.join(', ');
  }
  return 'Aba RESCISAO_CASOS já está pronta.';
}

/* ============================================================================================ */
/*  ESCOPO, o gestor só enxerga e solicita para a própria equipe                                */
/* ============================================================================================ */

function _rescColaborador_(user, idColaborador, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && v === 'GLOBAL';

  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(idColaborador));
  if (!c) throw new Error('Colaborador não encontrado.');

  if (!ehGlobal) {
    const equipe = _equipeDoGestor_(user.EMAIL);
    if (equipe.indexOf(String(idColaborador)) === -1) {
      throw new Error('Este colaborador não está na sua equipe.');
    }
  }
  return c;
}

function _casosVisiveis_(user, visao) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const v = String(visao || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();

  const todos = _casosTabela_();
  if (podeGlobal && v === 'GLOBAL') return todos;

  const equipe = _equipeDoGestor_(user.EMAIL);
  return todos.filter(c => equipe.indexOf(String(c.ID_COLABORADOR)) > -1);
}

/* ============================================================================================ */
/*  CONTEXTO / RESUMO (alimenta os cards dos portais)                                            */
/* ============================================================================================ */

function rescContexto(user, p) {
  const perfil = String(user.PERFIL).toUpperCase();
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');
  const visao = String((p && p.visao) || (podeGlobal ? 'GLOBAL' : 'GESTOR')).toUpperCase();
  const ehGlobal = podeGlobal && visao === 'GLOBAL';

  const equipe = ehGlobal ? null : _equipeDoGestor_(user.EMAIL);

  const time = _colaboradores_()
    .filter(c => ehGlobal || equipe.indexOf(String(c.ID_COLABORADOR)) > -1)
    .map(c => ({
      idColaborador: c.ID_COLABORADOR,
      nome: c.NOME,
      matricula: c.MATRICULA,
      departamento: c.DEPARTAMENTO_ATUAL || ''
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

  const casos = _casosVisiveis_(user, visao).map(_casoResumo_)
    .sort((a, b) => String(b.solicitadoEm).localeCompare(String(a.solicitadoEm)));

  return {
    ok: true,
    modulo: 'RESCISAO',
    versao: RESC.VERSAO,
    visao: visao,
    guiaUrl: RESC.GUIA_URL || '',
    equipe: time,
    casos: casos,
    tipos: RESC.TIPOS,
    avisoOpcoes: [
      { cod: '7_DIAS', nome: 'Redução de 7 dias corridos' },
      { cod: '2_HORAS', nome: 'Redução de 2 horas por dia' }
    ]
  };
}

function _casoResumo_(c) {
  return {
    id: c.ID_CASO,
    idColaborador: c.ID_COLABORADOR,
    matricula: c.MATRICULA,
    nome: c.NOME,
    tipo: c.TIPO,
    tipoCod: c.TIPO_COD,
    modo: c.MODO_SOLICITACAO,
    avisoModalidade: c.AVISO_MODALIDADE || '',
    avisoOpcao: c.AVISO_OPCAO || '',
    registroDireto: c.REGISTRO_DIRETO || '',
    exameDispensado: c.EXAME_DISPENSADO || '',
    exameDispensadoMotivo: c.EXAME_DISPENSADO_MOTIVO || '',
    status: c.STATUS,
    agendamento: _isoF_(c.DATA_AGENDAMENTO),
    comparecimento: _isoF_(c.DATA_COMPARECIMENTO),
    compareceu: c.COMPARECEU || '',
    exame: _isoF_(c.DATA_EXAME),
    demissao: _isoF_(c.DATA_DEMISSAO),
    cartaLink: c.CARTA_LINK || '',
    laudoLink: c.LAUDO_LINK || '',
    solicitadoPor: c.SOLICITADO_POR,
    solicitadoEm: _isoF_(c.SOLICITADO_EM),
    atualizadoEm: _rescDataHoraF_(c.ATUALIZADO_EM),
    gestorEmail: c.GESTOR_EMAIL,
    // ---- FATIA 2 (conciliação) ----
    rescisaoDocLink: c.RESCISAO_DOC_LINK || '',
    valorTrctCandidatos: (function () {
      try { return JSON.parse(c.VALOR_TRCT_CANDIDATOS_JSON || '[]'); } catch (e) { return []; }
    })(),
    valorTrctConfirmado: c.VALOR_TRCT_CONFIRMADO || '',
    fgtsValor: c.FGTS_VALOR || '',
    financeiroEnviadoEm: _isoF_(c.FINANCEIRO_ENVIADO_EM),
    autentiqueDocId: c.AUTENTIQUE_DOC_ID || '',
    autentiqueEnviadoEm: _isoF_(c.AUTENTIQUE_ENVIADO_EM),
    assinaturaLink: c.ASSINATURA_LINK || '',
    arquivadoEm: _isoF_(c.ARQUIVADO_EM)
  };
}

function rescResumo(user, p) { return rescResumoDe(rescContexto(user, p)); }

function rescResumoDe(ctx) {
  const abertos = ctx.casos.filter(c =>
    c.status !== RESC.STATUS.DESLIGADO && c.status !== RESC.STATUS.CANCELADA);

  const aguardandoDP = ctx.casos.filter(c => c.status === RESC.STATUS.SOLICITADA).length;

  // "Precisa de você": para o gestor, o que exige leitura/ação dele.
  const precisa = abertos
    .filter(c => c.status === RESC.STATUS.SOLICITADA || c.status === RESC.STATUS.AGENDADA)
    .slice(0, 8)
    .map(c => ({
      id: c.id,
      nome: c.nome,
      detalhe: _rotuloStatus_(c.status) + (c.agendamento ? ' · ' + _fmtBRF_(c.agendamento) : '')
    }));

  return {
    modulo: 'RESCISAO',
    nome: 'Rescisões',
    icone: '📄',
    contadores: {
      equipe: ctx.equipe.length,
      emAndamento: abertos.length,
      aguardandoDP: aguardandoDP,
      desligados: ctx.casos.filter(c => c.status === RESC.STATUS.DESLIGADO).length
    },
    precisaDeVoce: precisa,
    emAndamento: abertos.slice(0, 8).map(c => ({
      nome: c.nome, status: _rotuloStatus_(c.status),
      agendamento: c.agendamento, tipo: c.tipo
    })),
    visao: ctx.visao
  };
}

function _rotuloStatus_(s) {
  const m = {
    SOLICITADA: 'Solicitada, aguardando DP',
    AGENDADA: 'Comparecimento agendado',
    NAO_COMPARECEU: 'Não compareceu, reagendar',
    COMPARECEU: 'Compareceu',
    EXAME_MARCADO: 'Exame demissional marcado',
    DESLIGADO: 'Desligado, aguardando conciliação',
    CANCELADA: 'Cancelada',
    AGUARDANDO_CONCILIACAO: 'Aguardando anexar a rescisão',
    VALORES_CONFIRMADOS: 'Valores confirmados, pronto para o financeiro',
    ENVIADO_FINANCEIRO: 'Enviado ao financeiro, aguardando Autentique',
    AGUARDANDO_ASSINATURA: 'Aguardando assinatura no Autentique',
    ARQUIVADO: 'Concluído e arquivado'
  };
  return m[s] || s;
}

/* ============================================================================================ */
/*  GRAVAÇÃO NA CONTROLE.2026, por matrícula, sem quebrar as automações                          */
/* ============================================================================================ */

/**
 * [PERF] A coluna inteira de matrículas era relida do zero em TODA chamada — e algumas ações
 * (enviar homologação, baixar/arquivar) chamavam isso 2x na mesma execução (1x direto, 1x dentro
 * de _controleUpsert_). Agora lê uma vez por execução e reusa.
 */
var _CACHE_CONTROLE_MATRICULAS_ = null;

function _controleMapaMatriculas_(sh) {
  if (_CACHE_CONTROLE_MATRICULAS_) return _CACHE_CONTROLE_MATRICULAS_;

  const ini = RESC.CONTROLE_LINHA_INICIAL;
  const last = sh.getLastRow();
  const mapa = {};

  if (last >= ini) {
    const col = sh.getRange(ini, RESC.COL.MATRICULA, last - ini + 1, 1).getValues();
    for (let i = 0; i < col.length; i++) {
      // _normalizarMatricula_ (mesma usada em Ferias/Beneficios/Raiox) tira zeros à esquerda,
      // senão "000020" na CONTROLE não batia com "20" vindo de outra planilha (e vice-versa).
      const v = _normalizarMatricula_(col[i][0]);
      if (v && mapa[v] === undefined) mapa[v] = ini + i;
    }
  }

  _CACHE_CONTROLE_MATRICULAS_ = mapa;
  return mapa;
}

function _invalidarCacheControleMatriculas_() { _CACHE_CONTROLE_MATRICULAS_ = null; }

/** Acha a linha de uma matrícula (coluna A, a partir da linha 3). 0 se não existir. */
function _controleLinhaPorMatricula_(sh, matricula) {
  const alvo = _normalizarMatricula_(matricula);
  return _controleMapaMatriculas_(sh)[alvo] || 0;
}

/** Insere uma matrícula nova ao fim, recriando as fórmulas (copyTo reajusta as referências). */
function _controleInserirMatricula_(sh, matricula, nome, empresa, cod, depto) {
  const ini = RESC.CONTROLE_LINHA_INICIAL;
  const last = sh.getLastRow();

  // primeira linha vazia na coluna A (reaproveita buracos), senão vai para o fim
  let novaLinha = last + 1;
  if (last >= ini) {
    const col = sh.getRange(ini, RESC.COL.MATRICULA, last - ini + 1, 1).getValues();
    const idx = col.findIndex(r => String(r[0]).trim() === '');
    if (idx > -1) novaLinha = ini + idx;
  }

  const modelo = RESC.CONTROLE_LINHA_MODELO;
  RESC.COLUNAS_FORMULA.forEach(c => sh.getRange(modelo, c).copyTo(sh.getRange(novaLinha, c)));

  sh.getRange(novaLinha, RESC.COL.MATRICULA).setValue(matricula);
  if (nome)    sh.getRange(novaLinha, RESC.COL.NOME).setValue(nome);
  if (empresa) sh.getRange(novaLinha, RESC.COL.EMPRESA).setValue(empresa);
  if (cod)     sh.getRange(novaLinha, RESC.COL.COD).setValue(cod);
  if (depto)   sh.getRange(novaLinha, RESC.COL.DEPARTAMENTO).setValue(depto);

  _invalidarCacheControleMatriculas_();
  return novaLinha;
}

/**
 * Escreve um conjunto de colunas na linha da matrícula (cria a linha se não existir).
 * patchPorIndice: { <indiceColuna1Based>: valor }
 */
function _controleUpsert_(caso, patchPorIndice) {
  _rescValidarMapaColunas_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = _shControle_();
    let row = _controleLinhaPorMatricula_(sh, caso.MATRICULA);

    if (!row) {
      row = _controleInserirMatricula_(sh, caso.MATRICULA, caso.NOME, caso.EMPRESA, caso.COD, caso.DEPARTAMENTO);
    }

    Object.keys(patchPorIndice).forEach(idx => {
      sh.getRange(row, Number(idx)).setValue(patchPorIndice[idx]);
    });

    return row;
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================================ */
/*  CASOS, criar e atualizar (append-only + histórico embutido)                                 */
/* ============================================================================================ */

/**
 * [PERF] RESCISAO_CASOS (log append-only, só cresce) era relido inteiro em toda chamada de
 * _casoPorId_/_casosVisiveis_ — inclusive mais de uma vez na mesma execução (ex.: rescBaixarArquivar
 * chama rescVerificarAssinatura, que chama _casoPorId_ de novo). Agora lê 1x por execução.
 */
var _CACHE_CASOS_ = null;

function _casosTabela_() {
  if (!_CACHE_CASOS_) _CACHE_CASOS_ = _sheetToObjects_(_shCasos_());
  return _CACHE_CASOS_;
}

function _invalidarCacheCasos_() { _CACHE_CASOS_ = null; }

function _casoPorId_(id) {
  return _casosTabela_().find(c => String(c.ID_CASO) === String(id)) || null;
}

function _novoCaso_(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = _shCasos_();
    const h = _headers_(sh);
    const linha = h.map(col => (dados[col] === undefined ? '' : dados[col]));
    sh.appendRow(linha);
    _invalidarCacheCasos_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atualiza um caso, guarda o histórico e valida a transição de status.
 * patch: colunas a alterar. evento: rótulo curto para o histórico e a auditoria.
 */
function _patchCaso_(id, patch, user, evento) {
  const sh = _shCasos_();
  const h = _headers_(sh);
  const caso = _casoPorId_(id);
  if (!caso) throw new Error('Caso de rescisão não encontrado: ' + id);

  // histórico embutido
  let hist = [];
  try { hist = JSON.parse(caso.HISTORICO_JSON || '[]'); } catch (e) { hist = []; }
  hist.push({
    em: _agoraISO_(),
    por: _normalizarEmail_(user.EMAIL),
    evento: evento,
    de: caso.STATUS,
    para: patch.STATUS || caso.STATUS
  });

  patch.HISTORICO_JSON = JSON.stringify(hist);
  patch.ATUALIZADO_POR = _normalizarEmail_(user.EMAIL);
  patch.ATUALIZADO_EM = new Date();

  _atualizarLinha_(sh, caso._rowNumber, h, patch);
  _invalidarCacheCasos_();

  _auditar_('RESC_' + evento, user.EMAIL, 'RESCISAO', true,
    caso.NOME + ' (' + caso.MATRICULA + '): ' + evento, { id: id, status: patch.STATUS || caso.STATUS });

  return Object.assign({}, caso, patch);
}

/* ============================================================================================ */
/*  [GESTOR] SOLICITAR RESCISÃO                                                                  */
/* ============================================================================================ */

/**
 * payload:
 *   idColaborador, tipoCod,
 *   modo: 'APLICAR' (o gestor aplica) | 'DP_CONTATA' (o DP entra em contato),
 *   avisoModalidade: 'TRABALHADO' | 'INDENIZADO'  (quando o tipo pede aviso),
 *   cartaBase64, cartaNome, cartaTipo  (opcional, carta de pedido de demissão assinada),
 *   laudoBase64, laudoNome, laudoTipo  (opcional, laudo de insuficiência),
 *   observacao
 */
function rescSolicitar(user, p) {
  const c = _rescColaborador_(user, p.idColaborador, p.visao);
  const tipo = _rescTipo_(p.tipoCod);
  const modo = String(p.modo || 'DP_CONTATA').toUpperCase() === 'APLICAR' ? 'APLICAR' : 'DP_CONTATA';

  // Estabilidade acidentária (Lei 8.213/91 art. 118): dispensa sem justa causa durante a
  // garantia de emprego é ilegal salvo raríssimas exceções e costuma gerar reintegração/
  // indenização. Nunca bloqueia silenciosamente, exige confirmação explícita e justificativa.
  let estabilidade = { ativa: false, ate: '', ocorrenciaId: '' };
  if (tipo.cod === 'SEM_JUSTA_CAUSA' && typeof afastEstabilidadeAtiva === 'function') {
    estabilidade = afastEstabilidadeAtiva(c.ID_COLABORADOR);

    if (estabilidade.ativa) {
      const confirmou = _sim_(p.confirmarEstabilidade) || p.confirmarEstabilidade === true;
      if (!confirmou) {
        throw new Error(
          c.NOME + ' tem estabilidade acidentária ativa até ' + _fmtBRF_(_dataF_(estabilidade.ate)) +
          ' (Lei 8.213/91, art. 118, 12 meses após retorno de acidente de trabalho). ' +
          'Dispensar sem justa causa nesse período normalmente gera reintegração ou indenização. ' +
          'Se for mesmo necessário, confirme explicitamente e justifique.'
        );
      }
      if (!String(p.justificativaEstabilidade || '').trim()) {
        throw new Error('Confirmando a dispensa durante a estabilidade, informe a justificativa.');
      }
    }
  }

  const avisoModalidade = tipo.pedeAviso
    ? String(p.avisoModalidade || '').toUpperCase().indexOf('INDEN') > -1 ? 'INDENIZADO' : 'TRABALHADO'
    : '';

  // guarda a carta (se anexada) na pasta do colaborador, mesmo Drive dos afastamentos
  let cartaLink = '';
  if (p.cartaBase64) {
    cartaLink = _salvarDocumento_(
      c, 'pedido_demissao',
      p.cartaBase64, p.cartaNome || 'pedido_demissao.pdf', p.cartaTipo || 'application/pdf',
      new Date()
    );
  }

  // guarda o laudo de insuficiência (se anexado), mesma pasta do colaborador
  let laudoLink = '';
  if (p.laudoBase64) {
    laudoLink = _salvarDocumento_(
      c, 'laudo_insuficiencia',
      p.laudoBase64, p.laudoNome || 'laudo_insuficiencia.pdf', p.laudoTipo || 'application/pdf',
      new Date()
    );
  }

  const id = 'RES-' + _uuid_().slice(0, 8).toUpperCase();

  _novoCaso_({
    ID_CASO: id,
    ID_COLABORADOR: c.ID_COLABORADOR,
    MATRICULA: c.MATRICULA || '',
    NOME: c.NOME || '',
    EMPRESA: c.EMPRESA || '',
    COD: c.EMPRESA_COD || '',
    DEPARTAMENTO: c.DEPARTAMENTO_ATUAL || '',
    GESTOR_EMAIL: _normalizarEmail_(c.GESTOR_EMAIL),
    TIPO_COD: tipo.cod,
    TIPO: tipo.nome,
    MODO_SOLICITACAO: modo,
    AVISO_MODALIDADE: avisoModalidade,
    AVISO_OPCAO: '',
    CARTA_LINK: cartaLink,
    LAUDO_LINK: laudoLink,
    STATUS: RESC.STATUS.SOLICITADA,
    DATA_AGENDAMENTO: '',
    DATA_COMPARECIMENTO: '',
    COMPARECEU: '',
    DATA_EXAME: '',
    DATA_DEMISSAO: '',
    SOLICITADO_POR: _normalizarEmail_(user.EMAIL),
    SOLICITADO_EM: new Date(),
    ATUALIZADO_POR: _normalizarEmail_(user.EMAIL),
    ATUALIZADO_EM: new Date(),
    HISTORICO_JSON: JSON.stringify([{ em: _agoraISO_(), por: _normalizarEmail_(user.EMAIL), evento: 'SOLICITADA', de: '', para: RESC.STATUS.SOLICITADA }]),
    OBSERVACAO: String(p.observacao || ''),
    ESTABILIDADE_ATIVA_NA_SOLICITACAO: estabilidade.ativa ? 'Sim' : 'Não',
    ESTABILIDADE_ATE: estabilidade.ativa ? estabilidade.ate : '',
    ESTABILIDADE_JUSTIFICATIVA: estabilidade.ativa ? String(p.justificativaEstabilidade || '').trim() : ''
  });

  _auditar_('RESC_SOLICITADA', user.EMAIL, 'RESCISAO.SOLICITAR', true,
    c.NOME + ': ' + tipo.nome + ' (' + modo + ')', { id: id });

  // avisa o DP que entrou uma solicitação
  _notificarDPNovaSolicitacao_(c, tipo, modo, avisoModalidade, cartaLink, user,
    estabilidade.ativa ? Object.assign({}, estabilidade, { justificativa: p.justificativaEstabilidade }) : null);

  return {
    ok: true,
    id: id,
    tipo: tipo.nome,
    modo: modo,
    cartaLink: cartaLink,
    mensagem: modo === 'APLICAR'
      ? 'Solicitação registrada. O DP vai preparar o processo e você receberá o comunicado para aplicar o desligamento.'
      : 'Solicitação registrada. O DP entrará em contato com ' + String(c.NOME).split(' ')[0] + ' para dar andamento.'
  };
}

/**
 * Devolve os 4 modelos PRONTOS de carta de pedido de demissão (links estáticos, configurados
 * uma vez por configurarModelosCartaDemissao()). Nunca gera documento na hora, por isso não
 * precisa de nenhum escopo extra de autorização (DocumentApp), só o link já existente.
 * Sempre acompanha o aviso: isso é só um MODELO, o colaborador precisa escrever e assinar
 * a carta de próprio punho.
 */
function rescModelosCarta(user, p) {
  const modelos = RESC.MODELOS_CARTA.map(m => ({
    cod: m.cod,
    nome: m.nome,
    link: _rescParam_(m.param, ''),
    disponivel: !!_rescParam_(m.param, '')
  }));

  return {
    ok: true,
    modelos: modelos,
    aviso: 'Isso é apenas um MODELO de referência. O(a) colaborador(a) precisa escrever e assinar ' +
      'a carta de próprio punho, depois é só anexar a via assinada aqui.'
  };
}

/** Rode UMA vez (ou quando quiser trocar algum link): cola os 4 links dos Google Docs já criados
 *  e compartilhados como "Qualquer pessoa com o link, Leitor".
 *  Exemplo:
 *  configurarModelosCartaDemissao({
 *    cumprindoAviso: 'https://docs.google.com/document/d/XXXX/edit',
 *    semCumprirAviso: 'https://docs.google.com/document/d/YYYY/edit',
 *    periodoExperiencia: 'https://docs.google.com/document/d/ZZZZ/edit',
 *    contratoDeterminado: 'https://docs.google.com/document/d/WWWW/edit'
 *  });
 */
function configurarModelosCartaDemissao(links) {
  links = links || {};
  const mapa = {
    cumprindoAviso: 'RESC_MODELO_CUMPRINDO_AVISO',
    semCumprirAviso: 'RESC_MODELO_SEM_CUMPRIR_AVISO',
    periodoExperiencia: 'RESC_MODELO_PERIODO_EXPERIENCIA',
    contratoDeterminado: 'RESC_MODELO_CONTRATO_DETERMINADO'
  };

  let configurados = 0;
  Object.keys(mapa).forEach(chave => {
    if (links[chave]) {
      _setFeriasParam_(mapa[chave], String(links[chave]).trim());
      configurados++;
    }
  });

  return configurados + ' de 4 modelo(s) configurado(s).';
}

/** Cancela a própria solicitação enquanto ainda estiver em SOLICITADA. */
function rescCancelar(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const perfil = String(user.PERFIL).toUpperCase();
  const ehDono = _normalizarEmail_(caso.SOLICITADO_POR) === _normalizarEmail_(user.EMAIL);
  const podeGlobal = (perfil === 'DP' || perfil === 'ADMIN');

  if (!ehDono && !podeGlobal) throw new Error('Você só pode cancelar as solicitações que abriu.');
  if (caso.STATUS !== RESC.STATUS.SOLICITADA) {
    throw new Error('Só é possível cancelar enquanto a solicitação está "Solicitada". Fale com o DP.');
  }

  _patchCaso_(p.id, { STATUS: RESC.STATUS.CANCELADA, OBSERVACAO: String(p.motivo || caso.OBSERVACAO || '') },
    user, 'CANCELADA');

  return { ok: true, mensagem: 'Solicitação cancelada.' };
}

/* ============================================================================================ */
/*  [DP] FILA + COMANDOS DO FLUXO                                                                */
/* ============================================================================================ */

function rescFila(user, p) {
  const casos = _casosVisiveis_(user, 'GLOBAL').map(_casoResumo_);

  const grupo = (arr) => arr.sort((a, b) => String(a.solicitadoEm).localeCompare(String(b.solicitadoEm)));

  return {
    ok: true,
    modulo: 'RESCISAO',
    solicitadas: grupo(casos.filter(c => c.status === RESC.STATUS.SOLICITADA)),
    agendadas: grupo(casos.filter(c => c.status === RESC.STATUS.AGENDADA || c.status === RESC.STATUS.NAO_COMPARECEU)),
    compareceram: grupo(casos.filter(c => c.status === RESC.STATUS.COMPARECEU || c.status === RESC.STATUS.EXAME_MARCADO)),
    // ---- FATIA 2 (conciliação) ----
    conciliacao: grupo(casos.filter(c =>
      [RESC.STATUS.DESLIGADO, RESC.STATUS.AGUARDANDO_CONCILIACAO, RESC.STATUS.VALORES_CONFIRMADOS,
       RESC.STATUS.ENVIADO_FINANCEIRO, RESC.STATUS.AGUARDANDO_ASSINATURA].indexOf(c.status) > -1)),
    arquivados: grupo(casos.filter(c => c.status === RESC.STATUS.ARQUIVADO)).slice(0, 30),
    canceladas: grupo(casos.filter(c => c.status === RESC.STATUS.CANCELADA)).slice(0, 30),
    avisoOpcoes: [
      { cod: '7_DIAS', nome: 'Redução de 7 dias corridos' },
      { cod: '2_HORAS', nome: 'Redução de 2 horas por dia' }
    ]
  };
}

/** Agenda o comparecimento do colaborador ao DP. Avisa gestor e (se houver e-mail) colaborador. */
function rescAgendar(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const data = _dataF_(p.data);
  if (!data) throw new Error('Informe a data do comparecimento.');

  if ([RESC.STATUS.SOLICITADA, RESC.STATUS.AGENDADA, RESC.STATUS.NAO_COMPARECEU].indexOf(caso.STATUS) === -1) {
    throw new Error('Este caso não está numa etapa que permite agendar (status atual: ' + caso.STATUS + ').');
  }

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.AGENDADA,
    DATA_AGENDAMENTO: data,
    COMPARECEU: '',
    OBSERVACAO: p.observacao ? String(p.observacao) : caso.OBSERVACAO
  }, user, 'AGENDADA');

  const reagendamento = (caso.STATUS === RESC.STATUS.NAO_COMPARECEU);
  _notificarAgendamento_(caso, data, reagendamento, p.local, p.horario);

  return { ok: true, mensagem: 'Comparecimento agendado para ' + _fmtBRF_(data) +
    '. O gestor foi avisado' + (_emailDoColaborador_(caso.ID_COLABORADOR) ? ' e o colaborador também.' : '.') };
}

/**
 * Caminho rápido, só para Pedido de Demissão: a pessoa já veio ao DP e pediu demissão na hora —
 * sem precisar marcar um agendamento pra depois. Pula direto de SOLICITADA pra COMPARECEU.
 * O aviso (trabalhado/indenizado) já foi decidido lá no Solicitar; aqui não pergunta de novo.
 * payload: { id }
 */
function rescRegistrarDireto(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  garantirAbaCasosRescisao(); // garante a coluna REGISTRO_DIRETO antes de gravar

  if (String(caso.TIPO_COD || '').toUpperCase() !== 'PEDIDO_DEMISSAO') {
    throw new Error('Registro direto é só para Pedido de Demissão. Para os demais tipos, use Agendar comparecimento.');
  }
  if (caso.STATUS !== RESC.STATUS.SOLICITADA) {
    throw new Error('Só é possível registrar direto enquanto o caso está em "Solicitada" (status atual: ' + caso.STATUS + ').');
  }

  const agora = new Date();
  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.COMPARECEU,
    DATA_AGENDAMENTO: agora,
    DATA_COMPARECIMENTO: agora,
    COMPARECEU: 'Sim',
    AVISO_OPCAO: '', // não existe redução de 7 dias/2h em pedido de demissão
    REGISTRO_DIRETO: 'Sim'
  }, user, 'REGISTRO_DIRETO');

  _notificarComparecimento_(caso, true, '', null);

  return { ok: true, mensagem: 'Pedido de demissão de ' + String(caso.NOME).split(' ')[0] +
    ' registrado direto, sem agendamento. O gestor foi avisado.' };
}

/**
 * Registra o comparecimento.
 * payload: id, compareceu (bool),
 *   se compareceu: avisoOpcao '7_DIAS' | '2_HORAS'
 *   se NÃO compareceu: novaData (para reagendar)
 */
function rescComparecimento(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  if ([RESC.STATUS.AGENDADA, RESC.STATUS.NAO_COMPARECEU].indexOf(caso.STATUS) === -1) {
    throw new Error('Registre o comparecimento apenas em casos agendados (status atual: ' + caso.STATUS + ').');
  }

  const compareceu = _sim_(p.compareceu) || p.compareceu === true;

  if (compareceu) {
    // A redução de 2h/dia ou 7 dias corridos (CLT art. 488) é do aviso prévio DADO PELA
    // EMPRESA — não existe em Pedido de Demissão. Aí o aviso já foi decidido lá no Solicitar
    // (avisoModalidade: TRABALHADO ou INDENIZADO), então não pergunta de novo aqui.
    const exigeAvisoOpcao = String(caso.TIPO_COD || '').toUpperCase() !== 'PEDIDO_DEMISSAO';
    const opc = String(p.avisoOpcao || '').toUpperCase();
    const avisoOpcao = exigeAvisoOpcao
      ? ((opc === '2_HORAS' || opc === '2H') ? '2_HORAS' : (opc === '7_DIAS' || opc === '7D') ? '7_DIAS' : '')
      : '';

    _patchCaso_(p.id, {
      STATUS: RESC.STATUS.COMPARECEU,
      DATA_COMPARECIMENTO: new Date(),
      COMPARECEU: 'Sim',
      AVISO_OPCAO: avisoOpcao
    }, user, 'COMPARECEU');

    _notificarComparecimento_(caso, true, avisoOpcao, null);

    return { ok: true, compareceu: true, avisoOpcao: avisoOpcao,
      mensagem: 'Comparecimento registrado. O gestor foi avisado' +
        (avisoOpcao ? ' (opção de aviso: ' + RESC.AVISO_OPCAO_TEXTO[avisoOpcao] + ').' : '.') };
  }

  // não compareceu → registra e, se houver nova data, reagenda
  const novaData = _dataF_(p.novaData);
  const patch = { COMPARECEU: 'Não', DATA_COMPARECIMENTO: new Date() };

  if (novaData) {
    patch.STATUS = RESC.STATUS.AGENDADA;
    patch.DATA_AGENDAMENTO = novaData;
  } else {
    patch.STATUS = RESC.STATUS.NAO_COMPARECEU;
  }

  _patchCaso_(p.id, patch, user, 'NAO_COMPARECEU');
  _notificarComparecimento_(caso, false, '', novaData);

  return { ok: true, compareceu: false, reagendado: !!novaData,
    mensagem: novaData
      ? 'Registrado o não comparecimento. Reagendado para ' + _fmtBRF_(novaData) + '. O gestor foi avisado.'
      : 'Registrado o não comparecimento. O gestor foi avisado. Reagende quando tiver a nova data.' };
}

/** Grava a DATA DO EXAME DEMISSIONAL na CONTROLE.2026 (coluna AD), dispara sua automação de exame. */
function rescExame(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const data = _dataF_(p.dataExame);
  if (!data) throw new Error('Informe a data do exame demissional.');

  const dataAgendamento = _dataF_(caso.DATA_AGENDAMENTO);
  if (dataAgendamento && data < dataAgendamento) {
    throw new Error('A data do exame (' + _fmtBRF_(data) + ') não pode ser antes do comparecimento agendado (' +
      _fmtBRF_(dataAgendamento) + ').');
  }

  const row = _controleUpsert_(caso, { [RESC.COL.DATA_EXAME]: data });

  _patchCaso_(p.id, {
    STATUS: (caso.STATUS === RESC.STATUS.DESLIGADO ? caso.STATUS : RESC.STATUS.EXAME_MARCADO),
    DATA_EXAME: data
  }, user, 'EXAME_MARCADO');

  return { ok: true, linhaControle: row, mensagem:
    'Data do exame demissional (' + _fmtBRF_(data) + ') gravada na planilha. A automação de exame vai seguir a partir daí.' };
}

/**
 * Dispensa o exame demissional (exame admissional/anterior com menos de 90 dias — NR-7/PCMSO).
 * Não grava nada na CONTROLE.2026 (não dispara a automação de exame, que só faz sentido quando
 * tem exame de verdade pra marcar). payload: { id, motivo? }
 */
function rescExameDispensar(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  garantirAbaCasosRescisao(); // garante as colunas EXAME_DISPENSADO* antes de gravar

  _patchCaso_(p.id, {
    STATUS: (caso.STATUS === RESC.STATUS.DESLIGADO ? caso.STATUS : RESC.STATUS.EXAME_MARCADO),
    EXAME_DISPENSADO: 'Sim',
    EXAME_DISPENSADO_MOTIVO: String(p.motivo || 'Exame anterior com menos de 90 dias.')
  }, user, 'EXAME_DISPENSADO');

  return { ok: true, mensagem: 'Exame demissional dispensado (exame anterior recente). Nada foi gravado na planilha de pagamento — a automação de exame não é disparada.' };
}

/**
 * Confirma o desligamento: grava DEMISSÃO (O), TIPO (Q) e OPÇÃO DE AVISO (Y) na CONTROLE.2026.
 * Gravar a DEMISSÃO é o gatilho das SUAS automações (revogação de acessos pelo TI e e-mail
 * demissional no dia). payload: id, dataDemissao.
 */
function rescDesligar(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const data = _dataF_(p.dataDemissao);
  if (!data) throw new Error('Informe a data do desligamento (DEMISSÃO).');

  const dataExameCaso = _dataF_(caso.DATA_EXAME);
  if (dataExameCaso && data < dataExameCaso) {
    throw new Error('A data do desligamento (' + _fmtBRF_(data) + ') não pode ser antes do exame demissional (' +
      _fmtBRF_(dataExameCaso) + ').');
  }

  const patchControle = {};
  patchControle[RESC.COL.DEMISSAO] = data;
  patchControle[RESC.COL.TIPO] = _tipoDemissaoTexto_(caso.TIPO_COD, caso.TIPO, caso.AVISO_MODALIDADE);
  if (caso.AVISO_OPCAO && RESC.AVISO_OPCAO_TEXTO[caso.AVISO_OPCAO]) {
    patchControle[RESC.COL.OPCAO_AVISO] = RESC.AVISO_OPCAO_TEXTO[caso.AVISO_OPCAO];
  }

  const row = _controleUpsert_(caso, patchControle);

  _patchCaso_(p.id, { STATUS: RESC.STATUS.DESLIGADO, DATA_DEMISSAO: data }, user, 'DESLIGADO');

  // O caso de rescisão, por si só, não move a SITUACAO na base de COLABORADORES — sem isso,
  // a pessoa continuava "ativa" nas telas de férias/benefícios até sumir de um RAIO-X futuro.
  try {
    marcarColaboradorDesligado(caso.MATRICULA || caso.NOME);
  } catch (e) {
    console.error('rescDesligar: falha ao marcar SITUACAO como desligado em COLABORADORES: ' + e);
  }

  _notificarDesligamento_(caso, data);

  return { ok: true, linhaControle: row, mensagem:
    'Desligamento gravado (DEMISSÃO ' + _fmtBRF_(data) + '). As automações de TI e de e-mail demissional ' +
    'vão seguir a partir da planilha. O gestor foi avisado.' };
}

/**
 * Rede de segurança: quando alguém preenche a coluna DEMISSAO (O) direto na CONTROLE.2026,
 * sem passar pelo botão "Desligar" do portal (que já é coberto por rescDesligar() acima),
 * este gatilho instalável pega a edição e marca a mesma pessoa como Desligado em COLABORADORES.
 * Cobre qualquer edição na coluna O — digitação manual, colar valores, ou preencher várias
 * linhas de uma vez.
 */
function onEditControlePagamentoDemissao(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== RESC.ABAS.CONTROLE) return;

    const colIni = range.getColumn();
    const colFim = colIni + range.getNumColumns() - 1;
    if (RESC.COL.DEMISSAO < colIni || RESC.COL.DEMISSAO > colFim) return;

    const linhaIni = range.getRow();
    const linhaFim = linhaIni + range.getNumRows() - 1;
    if (linhaFim < RESC.CONTROLE_LINHA_INICIAL) return;

    for (let linha = Math.max(linhaIni, RESC.CONTROLE_LINHA_INICIAL); linha <= linhaFim; linha++) {
      const demissao = sheet.getRange(linha, RESC.COL.DEMISSAO).getValue();
      if (!demissao) continue; // célula limpa ou ainda vazia, nada a fazer

      const matricula = sheet.getRange(linha, RESC.COL.MATRICULA).getValue();
      if (!matricula) continue;

      const r = marcarColaboradorDesligado(String(matricula));
      if (r.erro) console.error('onEditControlePagamentoDemissao: linha ' + linha + ': ' + r.erro);
    }
  } catch (err) {
    console.error('onEditControlePagamentoDemissao: falha: ' + err);
  }
}

/**
 * Cria o gatilho instalável de edição na CONTROLE.2026 (necessário porque essa planilha não é
 * o container deste script — um onEdit simples não dispararia). Rode UMA vez só; rodar de novo
 * cria um gatilho duplicado (veja/apague em Editor > Gatilhos, o relógio na lateral).
 */
function criarGatilhoDesligamentoManual() {
  ScriptApp.newTrigger('onEditControlePagamentoDemissao')
    .forSpreadsheet(RESC.CONTROLE_ID)
    .onEdit()
    .create();

  return 'Gatilho criado: edição manual da coluna DEMISSAO na CONTROLE.2026 agora marca o colaborador como desligado automaticamente.';
}

/**
 * Monta o texto da coluna Q (TIPO DE DEMISSÃO) considerando a modalidade de aviso.
 * O valor tem que bater exatamente com a lista fixa da validação de dados da CONTROLE.2026
 * (Q) — por isso os textos abaixo são literais, não concatenação livre com o nome do tipo.
 */
/** Monta o texto da coluna Q (TIPO DE DEMISSÃO) considerando a modalidade de aviso — o mapa de
 *  textos aceitos (RESC.TIPO_DEMISSAO_TEXTO) fica junto de RESC.TIPOS, lá no topo do arquivo. */
function _tipoDemissaoTexto_(tipoCod, tipoNome, avisoModalidade) {
  const texto = _tipoDemissaoTextoOuVazio_(tipoCod, avisoModalidade);
  if (!texto) {
    throw new Error(
      'TIPO DE DEMISSÃO sem mapeamento: "' + tipoNome + '"' +
      (avisoModalidade ? ' (aviso ' + avisoModalidade + ')' : '') + '. A coluna Q da CONTROLE.2026 ' +
      'só aceita um texto fixo de uma lista suspensa e esse tipo ainda não foi conferido contra ela. ' +
      'Adicione o texto certo em RESC.TIPO_DEMISSAO_TEXTO (Rescisão.js) antes de desligar por esse tipo.'
    );
  }
  return texto;
}

/** Texto da coluna Q para o tipo + aviso, ou '' se não houver. Procura primeiro "TIPO_AVISO" (pedido de
 *  demissão e sem justa causa mudam com o aviso) e depois só o tipo — [2026-10-21] o comum acordo pede
 *  aviso, mas é sempre "ACORDO"; sem esse segundo passo ele caía no erro. */
function _tipoDemissaoTextoOuVazio_(tipoCod, avisoModalidade) {
  const mapa = RESC.TIPO_DEMISSAO_TEXTO;
  if (avisoModalidade === 'TRABALHADO' || avisoModalidade === 'INDENIZADO') {
    const comAviso = mapa[tipoCod + '_' + avisoModalidade];
    if (comAviso) return comAviso;
  }
  return mapa[tipoCod] || '';
}

/* ============================================================================================ */
/*  FATIA 2, CONCILIAÇÃO: anexar rescisão, valores, financeiro, Autentique, arquivamento         */
/* ============================================================================================ */

/**
 * ANEXAR_RESCISAO, o DP anexa o PDF calculado no Alterdata (o líquido da rescisão).
 * Guarda o arquivo no Drive do colaborador e TENTA extrair candidatos a "valor líquido" via OCR
 * (melhor esforço: precisa do serviço avançado Drive API ligado, ver _rescTextoDoPdf_). Se falhar
 * ou não achar nada, devolve lista vazia e o DP digita o valor à mão em CONFIRMAR_VALORES.
 * payload: id, arquivoBase64, arquivoNome, arquivoTipo
 */
function rescAnexarRescisao(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  if (String(caso.STATUS).toUpperCase() === RESC.STATUS.CANCELADA) {
    throw new Error('Este caso está cancelado.');
  }
  if (!p.arquivoBase64) throw new Error('Anexe o PDF da rescisão calculada.');

  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(caso.ID_COLABORADOR)) ||
    { ID_COLABORADOR: caso.ID_COLABORADOR, NOME: caso.NOME, MATRICULA: caso.MATRICULA };

  const link = _salvarDocumento_(
    c, 'rescisao_calculada',
    p.arquivoBase64, p.arquivoNome || 'rescisao.pdf', p.arquivoTipo || 'application/pdf',
    new Date()
  );

  // melhor esforço: extrai texto e procura candidatos a valor líquido
  let candidatos = [];
  try {
    const bytes = Utilities.base64Decode(p.arquivoBase64);
    const blob = Utilities.newBlob(bytes, p.arquivoTipo || 'application/pdf', p.arquivoNome || 'rescisao.pdf');
    const texto = _rescTextoDoPdf_(blob);
    if (texto) candidatos = _rescCandidatosValorLiquido_(texto);
  } catch (e) {
    console.error('Extração de valores falhou (seguindo sem candidatos): ' + e);
  }

  const patch = {
    STATUS: (caso.STATUS === RESC.STATUS.DESLIGADO ? RESC.STATUS.AGUARDANDO_CONCILIACAO : caso.STATUS),
    RESCISAO_DOC_LINK: link,
    VALOR_TRCT_CANDIDATOS_JSON: JSON.stringify(candidatos)
  };

  _patchCaso_(p.id, patch, user, 'RESCISAO_ANEXADA');

  return {
    ok: true,
    link: link,
    candidatos: candidatos,
    mensagem: candidatos.length
      ? 'Documento anexado. Encontrei ' + candidatos.length + ' valor(es) candidato(s), confira antes de confirmar.'
      : 'Documento anexado. Não consegui extrair o valor automaticamente, informe manualmente.'
  };
}

/**
 * Converte um PDF em texto via OCR (melhor esforço).
 * REQUER o serviço avançado "Drive API" ativado no projeto (Serviços ⊕ na barra lateral do editor
 * do Apps Script → Drive API). Sem isso, retorna '' e o módulo segue sem extração automática.
 */
function _rescTextoDoPdf_(blob) {
  if (typeof Drive === 'undefined' || !Drive.Files) return '';

  let arquivoTemp = null;
  try {
    const resource = { title: 'OCR_TEMP_RESCISAO_' + Utilities.getUuid(), mimeType: MimeType.GOOGLE_DOCS };
    arquivoTemp = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'pt' });
    const texto = DocumentApp.openById(arquivoTemp.id).getBody().getText();
    return texto || '';
  } catch (e) {
    console.error('OCR indisponível ou falhou: ' + e);
    return '';
  } finally {
    if (arquivoTemp) { try { Drive.Files.remove(arquivoTemp.id); } catch (e2) { /* ignora */ } }
  }
}

/**
 * Varre o texto procurando trechos perto de palavras-chave de "valor líquido" e devolve
 * candidatos com o trecho de contexto, SEMPRE para confirmação humana, nunca grava sozinho.
 */
function _rescCandidatosValorLiquido_(texto) {
  const chaves = ['LÍQUIDO A RECEBER', 'VALOR LÍQUIDO', 'TOTAL LÍQUIDO', 'LÍQUIDO'];
  const re = /R\$\s?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/g;

  const linhas = String(texto).split(/\r?\n/);
  const candidatos = [];

  linhas.forEach(linha => {
    const linhaUpper = linha.toUpperCase();
    const temChave = chaves.some(k => linhaUpper.indexOf(k) > -1);
    if (!temChave) return;

    let m;
    re.lastIndex = 0;
    while ((m = re.exec(linha)) !== null) {
      candidatos.push({ valor: m[1], trecho: linha.trim().slice(0, 140) });
    }
  });

  // remove duplicados exatos, mantém no máximo 5
  const vistos = {};
  return candidatos.filter(c => {
    if (vistos[c.valor]) return false;
    vistos[c.valor] = true;
    return true;
  }).slice(0, 5);
}

/**
 * CONFIRMAR_VALORES, o DP confirma o VALOR TRCT (escolhido de um candidato ou digitado) e informa
 * o FGTS (sempre manual, rateio individual, porque uma guia pode cobrir vários funcionários).
 * Grava em R (VALOR TRCT) e S (GFD) da CONTROLE.2026.
 * payload: id, valorTrct ("1.234,56" ou número), fgts ("334,11" ou número)
 */
function rescConfirmarValores(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const valorTrct = String(p.valorTrct || '').trim();
  const fgts = String(p.fgts || '').trim();
  if (!valorTrct) throw new Error('Informe o valor líquido do TRCT.');
  if (!fgts) throw new Error('Informe o valor do FGTS (rateio individual).');

  const patchControle = {};
  patchControle[RESC.COL.VALOR_TRCT] = _rescMoeda_(valorTrct);
  patchControle[RESC.COL.GFD] = _rescMoeda_(fgts);
  _controleUpsert_(caso, patchControle);

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.VALORES_CONFIRMADOS,
    VALOR_TRCT_CONFIRMADO: valorTrct,
    FGTS_VALOR: fgts,
    CONCILIADO_POR: _normalizarEmail_(user.EMAIL),
    CONCILIADO_EM: new Date()
  }, user, 'VALORES_CONFIRMADOS');

  return { ok: true, mensagem: 'Valores gravados na planilha (VALOR TRCT e GFD). Pronto para enviar ao financeiro.' };
}

/** "R$ 1.234,56" ou "1234.56" → "R$1.234,56" no mesmo formato já usado na coluna hoje. */
function _rescMoeda_(v) {
  const s = String(v).replace(/[^\d,.-]/g, '');
  const n = Number(s.indexOf(',') > -1 ? s.replace(/\./g, '').replace(',', '.') : s);
  if (isNaN(n)) return String(v);
  return 'R$' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** dd/MM/yyyy às HH:mm, usado para "atualizado em" no card do gestor. */
function _rescDataHoraF_(v) {
  const d = _dataF_(v);
  return d ? Utilities.formatDate(d, DP360.FUSO, "dd/MM/yyyy 'às' HH:mm") : '';
}

/**
 * ENVIAR_FINANCEIRO, manda e-mail ao financeiro com os links dos documentos (rescisão calculada +
 * carta, se houver) e grava a DATA DO ENVIO PARA FINANCEIRO (coluna T).
 * payload: id
 */
function rescEnviarFinanceiro(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  if (!caso.RESCISAO_DOC_LINK) throw new Error('Anexe a rescisão calculada antes de enviar ao financeiro.');
  if (!caso.VALOR_TRCT_CONFIRMADO) throw new Error('Confirme o VALOR TRCT e o FGTS antes de enviar ao financeiro.');

  const emailFinanceiro = _rescParam_(RESC.AUTENTIQUE_PARAM_FINANCEIRO_EMAIL, '');
  if (!emailFinanceiro) {
    throw new Error('E-mail do financeiro não configurado. Rode configurarEmailFinanceiro("email@cieds.org.br").');
  }

  const docs = [{ nome: 'Rescisão calculada', link: caso.RESCISAO_DOC_LINK }];
  if (caso.CARTA_LINK) docs.push({ nome: 'Carta de pedido de demissão', link: caso.CARTA_LINK });

  const corpo =
    '<p>Segue para pagamento a rescisão de <b>' + _escapeHtml_(caso.NOME) + '</b>.</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(caso.NOME)],
      ['Matrícula', _escapeHtml_(caso.MATRICULA || ',')],
      ['Tipo', _escapeHtml_(caso.TIPO)],
      ['Data do desligamento', _fmtBRF_(caso.DATA_DEMISSAO)],
      ['Valor líquido (TRCT)', _escapeHtml_(caso.VALOR_TRCT_CONFIRMADO)],
      ['FGTS', _escapeHtml_(caso.FGTS_VALOR)]
    ]) +
    '<div style="margin:16px 0">' +
      docs.map(d => '<p style="font-size:13.5px">📎 <a href="' + d.link + '">' + _escapeHtml_(d.nome) + '</a></p>').join('') +
    '</div>' +
    '<p style="font-size:13.5px">Qualquer divergência, é só responder este e-mail.</p>';

  const enviado = _enviar_(emailFinanceiro, 'Rescisão para pagamento, ' + caso.NOME,
    _moldura_('Rescisão para pagamento', corpo, 'Departamento Pessoal · CIEDS.', false), null, null, true);

  if (!enviado) throw new Error('Não consegui enviar o e-mail ao financeiro. Confira o e-mail configurado.');

  _controleUpsert_(caso, { [RESC.COL.ENVIO_FINANCEIRO]: new Date() });

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.ENVIADO_FINANCEIRO,
    FINANCEIRO_ENVIADO_EM: new Date(),
    FINANCEIRO_DOCS_JSON: JSON.stringify(docs)
  }, user, 'ENVIADO_FINANCEIRO');

  return { ok: true, mensagem: 'Enviado ao financeiro e gravado na planilha (DATA DO ENVIO PARA FINANCEIRO).' };
}

function configurarEmailFinanceiro(email) {
  if (!email || String(email).indexOf('@') === -1) throw new Error('Informe um e-mail válido.');
  _setFeriasParam_(RESC.AUTENTIQUE_PARAM_FINANCEIRO_EMAIL, String(email).trim().toLowerCase());
  return 'E-mail do financeiro configurado: ' + email;
}

/* -------------------------------------------------------------------------------------------- */
/*  AUTENTIQUE, cliente GraphQL mínimo                                                          */
/* -------------------------------------------------------------------------------------------- */

function configurarAutentiqueToken(token) {
  if (!token) throw new Error('Informe o token pessoal do Autentique (gerado no painel deles).');
  PropertiesService.getScriptProperties().setProperty(RESC.AUTENTIQUE_PARAM_TOKEN, String(token).trim());
  return 'Token do Autentique salvo nas Propriedades do script. Rode testarAutentique() para confirmar.';
}

function _autentiqueToken_() {
  // 1) preferir Propriedades do Script (mais protegido que a planilha)
  var t = PropertiesService.getScriptProperties().getProperty(RESC.AUTENTIQUE_PARAM_TOKEN);
  // 2) fallback: parametro na planilha (compativel com o que ja existia)
  if (!t) t = _rescParam_(RESC.AUTENTIQUE_PARAM_TOKEN, '');
  if (!t) throw new Error('Token do Autentique não configurado. Rode configurarAutentiqueToken("SEU_TOKEN").');
  return t;
}

/** Consulta leve só para validar token + conectividade, sem criar nada. */
function testarAutentique() {
  const token = _autentiqueToken_();
  const query = 'query { me { name email } }';

  const resp = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  console.log(JSON.stringify(json, null, 2));

  if (json.errors) throw new Error('Autentique respondeu com erro: ' + JSON.stringify(json.errors));

  return 'OK, conectado ao Autentique como: ' + (json.data && json.data.me ? json.data.me.email : '(desconhecido)');
}

/**
 * Sobe um documento no Autentique para assinatura do colaborador.
 * ⚠️ A chamada de criação de documento no Autentique é multipart (arquivo + operações GraphQL) ,
 * a forma exata pode ter mudado desde o meu conhecimento; se der erro aqui, confira a doc atual
 * em https://docs.autentique.com.br antes de tudo, com testarAutentique() já validado.
 */
function _autentiqueCriarDocumento_(nomeDocumento, blob, signatarios) {
  const token = _autentiqueToken_();

  const mutation =
    'mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {' +
    '  createDocument(document: $document, signers: $signers, file: $file) {' +
    '    id name created_at' +
    '  }' +
    '}';

  const operations = JSON.stringify({
    query: mutation,
    variables: { document: { name: nomeDocumento }, signers: signatarios, file: null }
  });
  const map = JSON.stringify({ '0': ['variables.file'] });

  // [FIX 2026-09-24] O Autentique limita pedidos seguidos (HTTP 429 / "Too Many Attempts").
  // Antes, essa resposta virava um erro genérico e, no envio em lote do Kit Admissional,
  // todo mundo depois do limite caía como erro. Agora espera e tenta de novo; se continuar
  // bloqueado, lança um erro marcado (limiteAutentique) para quem chamou parar o lote.
  // Só repete quando o pedido foi recusado sem ser processado (429/425). Em erro 5xx não
  // repete, porque o documento pode ter sido criado e a repetição o duplicaria.
  const ESPERAS_MS = [10000, 20000, 30000];
  let resp, code, txt;
  for (let tentativa = 0; ; tentativa++) {
    resp = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      payload: {
        operations: operations,
        map: map,
        '0': blob
      },
      muteHttpExceptions: true
    });
    code = resp.getResponseCode();
    txt = resp.getContentText();
    const limitado = code === 429 || code === 425 || /too many attempts/i.test(txt);
    if (!limitado) break;
    if (tentativa >= ESPERAS_MS.length) {
      const erro = new Error('O Autentique bloqueou temporariamente por excesso de envios seguidos (HTTP ' +
        code + '). Aguarde 1 minuto e tente de novo.');
      erro.limiteAutentique = true;
      throw erro;
    }
    Utilities.sleep(ESPERAS_MS[tentativa]);
  }

  let json;
  try {
    json = JSON.parse(txt);
  } catch (e) {
    throw new Error('Resposta inválida do Autentique (HTTP ' + code + '): ' + String(txt).substring(0, 150));
  }
  if (json.errors) throw new Error('Autentique recusou o documento: ' + JSON.stringify(json.errors));
  if (!json.data || !json.data.createDocument) {
    throw new Error('Resposta inesperada do Autentique (HTTP ' + code + '): ' + String(txt).substring(0, 150));
  }

  return json.data.createDocument;
}

/**
 * Consulta em tempo real no Autentique se um documento já foi assinado por todo mundo — não
 * depende da coluna STATUS_AUTENTIQUE (essa é escrita por uma automação separada, mais antiga,
 * que pode estar atrasada ou nem saber desse documento). Fonte da verdade: files.signed só
 * existe quando o Autentique já fechou e disponibilizou o PDF assinado por todos.
 */
function _autentiqueDocumentoAssinado_(docId) {
  const token = _autentiqueToken_();
  const query = 'query($id: UUID!){ document(id: $id){ id name files{ signed } signatures{ email action{ name } signed{ created_at } } } }';

  const resp = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query, variables: { id: docId } }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  if (json.errors) throw new Error('Autentique recusou a consulta: ' + JSON.stringify(json.errors));

  const doc = json.data && json.data.document;
  if (!doc) throw new Error('Autentique não encontrou esse documento (pode já ter sido apagado/cancelado).');

  // files.signed pode existir mesmo com assinatura parcial (ex.: só o DP assinou) — não é
  // sinal confiável de "todo mundo assinou". A fonte da verdade é conferir CADA assinatura.
  const assinaturas = doc.signatures || [];
  const totalAssinantes = assinaturas.length;
  const totalAssinados = assinaturas.filter(s => s.signed && s.signed.created_at).length;
  const assinado = totalAssinantes > 0 && totalAssinados === totalAssinantes;

  return {
    assinado: assinado,
    urlAssinado: assinado ? ((doc.files && doc.files.signed) || null) : null,
    totalAssinantes: totalAssinantes,
    totalAssinados: totalAssinados
  };
}

/**
 * [FIX 2026-09-28] Baixa o PDF assinado do Autentique com o token e confere o que voltou antes de
 * alguém salvar. É a mesma correção feita na Admissão em 22-23/09 (_admKitBaixarEArquivar_): sem o
 * Authorization, o Autentique pode devolver uma página de erro/login em HTML, e o código antigo
 * salvava isso com nome .pdf e marcava como "assinado e arquivado". Usada por Recibos de Férias,
 * Homologação e Rescisão. Lança erro (nunca devolve arquivo ruim) quando:
 *  - não há URL do assinado;
 *  - o Autentique responde algo diferente de HTTP 200 (com 3 novas tentativas no 425/429,
 *    o limite de downloads seguidos deles);
 *  - a resposta não é um PDF de verdade (tipo errado ou menos de 1 KB).
 */
function _autentiqueBaixarPdfAssinado_(urlAssinado, nomeArquivo, esperasMs) {
  if (!urlAssinado) throw new Error('O Autentique ainda não disponibilizou o PDF assinado para download.');

  // [2026-09-28] esperasMs opcional: os lotes em rodadas curtas (Homologação) usam uma espera só,
  // para caber no limite de ~60 s entre Portal e API. Sem o parâmetro, segue como antes.
  const ESPERAS_MS = Array.isArray(esperasMs) ? esperasMs : [5000, 12000, 25000];
  let resp, code, tentativa = 0;
  do {
    resp = UrlFetchApp.fetch(urlAssinado, {
      headers: { Authorization: 'Bearer ' + _autentiqueToken_() },
      muteHttpExceptions: true
    });
    code = resp.getResponseCode();
    tentativa++;
    if ((code === 425 || code === 429) && tentativa <= ESPERAS_MS.length) Utilities.sleep(ESPERAS_MS[tentativa - 1]);
  } while ((code === 425 || code === 429) && tentativa <= ESPERAS_MS.length);

  if (code !== 200) {
    const erro = new Error('Falha ao baixar o PDF assinado do Autentique (HTTP ' + code + ' após ' + tentativa +
      ' tentativa(s)). Nada foi salvo. Tente de novo em alguns minutos.');
    erro.limiteAutentique = (code === 425 || code === 429);
    throw erro;
  }
  const blob = resp.getBlob();
  const bytes = blob.getBytes();
  const comecaComPdf = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
  if (bytes.length < 1000 || (blob.getContentType() !== 'application/pdf' && !comecaComPdf)) {
    throw new Error('O Autentique não devolveu um PDF válido (tipo: ' + blob.getContentType() + ', ' + bytes.length +
      ' bytes). Nada foi salvo. Tente de novo mais tarde.');
  }
  return blob.setContentType('application/pdf').setName(nomeArquivo);
}

/**
 * [FIX 2026-09-28] Compartilhamento dos documentos arquivados pelo DP (assinados, PDFs de
 * fornecedor): só quem está logado numa conta @cieds.org.br abre pelo link, e só para ver.
 * Antes era "qualquer pessoa com o link", o que deixava documento com CPF e valores aberto a
 * quem recebesse o link. Quem é de outro domínio (ex.: coletivoaprendiz) continua abrindo se
 * tiver acesso à pasta. Se a política do Workspace recusar, o arquivo fica só com o acesso
 * herdado da pasta, sem travar o fluxo.
 */
function _compartilharSoDominio_(arquivo) {
  try {
    arquivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('Não foi possível ajustar o compartilhamento de ' + arquivo.getName() + ': ' + e.message);
  }
}

/**
 * Apaga um documento no Autentique (cancela o envio, ninguém mais consegue assinar). Usado só
 * pra reverter envios ainda pendentes de assinatura — nunca chamar em documento já assinado.
 */
/**
 * [FIX] "deleteDocument" sozinho é o "Apenas excluir" da tela do Autentique — a doc deles é
 * explícita que isso NÃO bloqueia a assinatura (quem já tem o link/e-mail aberto ainda
 * consegue assinar depois). O equivalente ao "Bloquear e excluir" da tela precisa de um passo
 * antes: updateDocument com deadline_at = agora, que derruba o prazo e barra qualquer
 * assinatura pendente. Só then apaga. Ver https://docs.autentique.com.br/api/mutations/editing-a-document
 */
function _autentiqueApagarDocumento_(docId) {
  const token = _autentiqueToken_();

  const bloqueio = 'mutation($id: UUID!, $doc: UpdateDocumentInput!){ updateDocument(id: $id, document: $doc){ id } }';
  const respBloqueio = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: bloqueio, variables: { id: docId, doc: { deadline_at: new Date().toISOString() } } }),
    muteHttpExceptions: true
  });
  const jsonBloqueio = JSON.parse(respBloqueio.getContentText());
  if (jsonBloqueio.errors) {
    throw new Error('Autentique recusou bloquear o documento antes de excluir: ' + JSON.stringify(jsonBloqueio.errors));
  }

  const mutation = 'mutation($id: UUID!){ deleteDocument(id: $id) }';

  const resp = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: mutation, variables: { id: docId } }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  if (json.errors) throw new Error('Autentique recusou apagar o documento: ' + JSON.stringify(json.errors));
  if (!json.data || !json.data.deleteDocument) throw new Error('Autentique não confirmou a exclusão do documento.');

  return true;
}

/**
 * ENVIAR_AUTENTIQUE, sobe a rescisão (e a carta, se houver) para assinatura do colaborador.
 * Grava só o ID AUTENTIQUE (coluna AF), a VERIFICAÇÃO de status continua sendo a sua automação
 * já existente, que escreve em AH/AI/AJ. Este módulo nunca escreve nessas três colunas.
 * payload: id
 */
function rescEnviarAutentique(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');
  if (!caso.RESCISAO_DOC_LINK) throw new Error('Anexe a rescisão calculada antes de enviar ao Autentique.');

  const email = _emailDoColaborador_(caso.ID_COLABORADOR);
  if (!email) throw new Error('Colaborador sem e-mail cadastrado, não é possível enviar para assinatura.');

  const idDrive = _idDoLinkDrive_(caso.RESCISAO_DOC_LINK);
  if (!idDrive) throw new Error('Não encontrei o arquivo da rescisão no Drive.');

  const blob = DriveApp.getFileById(idDrive).getBlob();
  const nomeDoc = 'Rescisão, ' + caso.NOME;
  const signatarios = [{ email: email, action: 'SIGN' }];

  const doc = _autentiqueCriarDocumento_(nomeDoc, blob, signatarios);

  _controleUpsert_(caso, { [RESC.COL.ID_AUTENTIQUE]: doc.id });

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.AGUARDANDO_ASSINATURA,
    AUTENTIQUE_DOC_ID: doc.id,
    AUTENTIQUE_ENVIADO_EM: new Date()
  }, user, 'ENVIADO_AUTENTIQUE');

  return { ok: true, docId: doc.id,
    mensagem: 'Documento enviado ao Autentique para assinatura de ' + caso.NOME.split(' ')[0] +
      '. O acompanhamento segue pela automação já existente (coluna STATUS AUTENTIQUE).' };
}

/**
 * CANCELAR_AUTENTIQUE, apaga o documento enviado (bloqueia e apaga no Autentique — ninguém mais
 * consegue assinar) e volta o caso para ENVIADO_FINANCEIRO, pronto pra reenviar. Só permite
 * cancelar enquanto ainda não foi arquivado — depois de assinado/baixado, cancelar destruiria o
 * documento já executado.
 * Mesma trava de rescEnviarAutentique/rescVerificarAssinatura: nunca escreve em STATUS AUTENTIQUE/
 * ULTIMA_VERIFICACAO (AH/AI), que são da automação externa já existente — só limpa o ID que este
 * módulo mesmo gravou (coluna AF / AUTENTIQUE_DOC_ID).
 * payload: id
 */
function rescCancelarAutentique(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const docId = String(caso.AUTENTIQUE_DOC_ID || '').trim();
  if (!docId) throw new Error('Este caso ainda não foi enviado ao Autentique.');

  if (String(caso.STATUS || '').toUpperCase() === RESC.STATUS.ARQUIVADO) {
    throw new Error('Este caso já foi arquivado, não é possível cancelar.');
  }

  _autentiqueApagarDocumento_(docId);

  _controleUpsert_(caso, { [RESC.COL.ID_AUTENTIQUE]: '' });

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.ENVIADO_FINANCEIRO,
    AUTENTIQUE_DOC_ID: '',
    AUTENTIQUE_ENVIADO_EM: ''
  }, user, 'CANCELADO_AUTENTIQUE');

  return { ok: true,
    mensagem: 'Envio ao Autentique de ' + caso.NOME.split(' ')[0] +
      ' cancelado. O documento foi apagado e não pode mais ser assinado.' };
}

/**
 * VERIFICAR_ASSINATURA, lê (só leitura) a coluna STATUS AUTENTIQUE (AH), que é preenchida pela
 * SUA automação já existente, e reflete no caso se já pode baixar e arquivar.
 * payload: id
 */
function rescVerificarAssinatura(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');

  const sh = _shControle_();
  const row = _controleLinhaPorMatricula_(sh, caso.MATRICULA);
  if (!row) throw new Error('Matrícula não encontrada na CONTROLE.2026.');

  const statusAtual = String(sh.getRange(row, RESC.COL.STATUS_AUTENTIQUE).getValue() || '').toUpperCase();
  const assinado = RESC.MARCADORES_ASSINADO.some(m => statusAtual.indexOf(m) > -1);

  return {
    ok: true,
    statusAutentique: statusAtual,
    assinado: assinado,
    mensagem: assinado
      ? 'Já está assinado. Use "Baixar e arquivar" para concluir.'
      : 'Ainda não assinado (status atual na planilha: "' + (statusAtual || ',') + '").'
  };
}

/**
 * BAIXAR_ARQUIVAR, quando o Autentique confirmar a assinatura, baixa o PDF assinado e arquiva na
 * pasta do colaborador no Drive. Encerra o caso como ARQUIVADO.
 * payload: id
 */
function rescBaixarArquivar(user, p) {
  const caso = _casoPorId_(p.id);
  if (!caso) throw new Error('Caso não encontrado.');
  if (!caso.AUTENTIQUE_DOC_ID) throw new Error('Este caso ainda não foi enviado ao Autentique.');

  const verificacao = rescVerificarAssinatura(user, p);
  if (!verificacao.assinado) {
    throw new Error('Ainda não está assinado (status: "' + (verificacao.statusAutentique || ',') + '"). Aguarde a assinatura.');
  }

  const token = _autentiqueToken_();
  const query =
    'query Documento($id: UUID!) { document(id: $id) { id name files { signed } } }';

  const resp = UrlFetchApp.fetch(RESC.AUTENTIQUE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query, variables: { id: caso.AUTENTIQUE_DOC_ID } }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  if (json.errors) throw new Error('Autentique recusou a consulta: ' + JSON.stringify(json.errors));

  const urlAssinado = json.data && json.data.document && json.data.document.files
    ? json.data.document.files.signed : '';
  if (!urlAssinado) throw new Error('O Autentique ainda não disponibilizou o arquivo assinado para download.');

  // [FIX 2026-09-28] download com token + conferência de PDF (antes salvava qualquer resposta).
  const blob = _autentiqueBaixarPdfAssinado_(urlAssinado, _slug_(caso.NOME) + '_rescisao_assinada.pdf');

  const c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(caso.ID_COLABORADOR)) ||
    { ID_COLABORADOR: caso.ID_COLABORADOR, NOME: caso.NOME, MATRICULA: caso.MATRICULA };

  const raizId = _rescParam_('AFAST_DRIVE_PASTA_ID', '');
  let linkArquivado = '';

  if (raizId) {
    const pasta = _pastaDoColaborador_(DriveApp.getFolderById(raizId), c);
    const arquivo = pasta.createFile(blob);
    _compartilharSoDominio_(arquivo);
    linkArquivado = arquivo.getUrl();
  } else {
    const arquivo = DriveApp.createFile(blob);
    _compartilharSoDominio_(arquivo);
    linkArquivado = arquivo.getUrl();
  }

  _controleUpsert_(caso, { [RESC.COL.LINK_DRIVE_ASSINATURA]: linkArquivado });

  _patchCaso_(p.id, {
    STATUS: RESC.STATUS.ARQUIVADO,
    ASSINATURA_LINK: linkArquivado,
    ARQUIVADO_EM: new Date()
  }, user, 'ARQUIVADO');

  return { ok: true, link: linkArquivado, mensagem: 'Rescisão assinada baixada e arquivada. Caso concluído.' };
}

/* ============================================================================================ */
/*  E-MAILS (reusa _moldura_/_quadro_/_enviar_ do FERIAS.gs)                                     */
/* ============================================================================================ */

/** E-mail "Nova solicitação de rescisão" — separado do _emailDoDP_() geral (esse é compartilhado
 *  com Férias/Afastamentos; mudar ele mudaria notificação de módulo que ninguém pediu para mexer).
 *  Configurável via PARAMETROS, com o valor pedido como padrão. */
function _rescEmailNovaSolicitacao_() {
  return String(_rescParam_('RESC_EMAIL_NOVA_SOLICITACAO', 'rescisao@cieds.org.br')).trim();
}
function _rescCcNovaSolicitacao_() {
  return String(_rescParam_('RESC_CC_NOVA_SOLICITACAO', 'thayanepinheiro@cieds.org.br')).trim();
}

function _notificarDPNovaSolicitacao_(c, tipo, modo, avisoModalidade, cartaLink, user, estabilidade) {
  const emailDP = _rescEmailNovaSolicitacao_();
  const corpo =
    '<p>Uma nova <b>solicitação de rescisão</b> foi aberta no Portal do Gestor.</p>' +
    (estabilidade && estabilidade.ativa
      ? '<div style="background:#fdeceb;color:#b3261e;border-radius:10px;padding:12px 14px;margin:10px 0;font-size:13.5px">' +
        '⚠️ <b>Estabilidade acidentária ativa até ' + _fmtBRF_(_dataF_(estabilidade.ate)) + '</b> (Lei 8.213/91, art. 118). ' +
        'O gestor confirmou a dispensa mesmo assim, justificativa: ' +
        _escapeHtml_(String(estabilidade.justificativa || ',')) + '</div>'
      : '') +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(c.NOME)],
      ['Matrícula', _escapeHtml_(c.MATRICULA || ',')],
      ['Departamento', _escapeHtml_(c.DEPARTAMENTO_ATUAL || ',')],
      ['Tipo', _escapeHtml_(tipo.nome)],
      ['Modo', modo === 'APLICAR' ? 'Gestor vai aplicar' : 'DP deve contatar o colaborador'],
      ['Aviso prévio', avisoModalidade ? _capa_(avisoModalidade) : ','],
      ['Solicitado por', _escapeHtml_(user.EMAIL)]
    ]) +
    (cartaLink ? '<p style="font-size:13.5px">📎 Carta de pedido de demissão anexada: ' +
      '<a href="' + cartaLink + '">abrir</a></p>' : '') +
    '<p style="font-size:13.5px">Abra o Portal do DP para agendar o comparecimento e dar andamento.</p>';

  _enviar_(emailDP, 'Nova solicitação de rescisão, ' + c.NOME,
    _moldura_('Nova solicitação de rescisão', corpo, 'Departamento Pessoal · CIEDS.', false),
    null, _rescCcNovaSolicitacao_(), true);
}

// [2026-10-16] Vander e Marcela dividem a gestão da mesma área — toda notificação de rescisão
// que iria só pro Vander agora inclui a Marcela também. Mapa fácil de estender se surgir outra
// dupla de gestão (ex.: Teresópolis = Jaqueline + Vitória).
const RESC_GESTOR_DUPLA = { 'vander.rj@cieds.org.br': 'marcellagavinho.rj@cieds.org.br' };
function _rescComDupla_(gestorEmail) {
  const par = RESC_GESTOR_DUPLA[gestorEmail];
  return par ? gestorEmail + ',' + par : gestorEmail;
}

function _notificarAgendamento_(caso, data, reagendamento, local, horario) {
  const gestor = _rescComDupla_(_normalizarEmail_(caso.GESTOR_EMAIL));
  const colabEmail = _emailDoColaborador_(caso.ID_COLABORADOR);
  const emailDP = _emailDoDP_();

  const quadro = _quadro_([
    ['Colaborador(a)', _escapeHtml_(caso.NOME)],
    ['Data do comparecimento', _fmtBRF_(data)],
    ['Horário', _escapeHtml_(horario || 'a combinar')],
    ['Local', _escapeHtml_(local || 'Departamento Pessoal · CIEDS')]
  ]);

  // gestor
  const corpoG =
    (reagendamento
      ? '<p>O comparecimento de <b>' + _escapeHtml_(caso.NOME) + '</b> foi <b>reagendado</b>.</p>'
      : '<p>O DP agendou o comparecimento de <b>' + _escapeHtml_(caso.NOME) + '</b> para dar andamento à rescisão.</p>') +
    quadro +
    '<p style="font-size:13.5px">Você será avisado(a) assim que o comparecimento acontecer.</p>';
  _enviar_(gestor, (reagendamento ? 'Reagendamento' : 'Comparecimento agendado') + ', ' + caso.NOME,
    _moldura_((reagendamento ? 'Comparecimento reagendado' : 'Comparecimento agendado'), corpoG,
      'Departamento Pessoal · CIEDS.', false),
    null, 'rescisao@cieds.org.br', true);

  // colaborador (quando o modo é DP contatar, e há e-mail)
  if (colabEmail && String(caso.MODO_SOLICITACAO).toUpperCase() === 'DP_CONTATA') {
    const primeiro = String(caso.NOME || '').split(' ')[0];
    const corpoC =
      '<p>Olá, ' + _escapeHtml_(primeiro) + '.</p>' +
      '<p>Precisamos que você compareça ao Departamento Pessoal para tratarmos de um assunto ' +
      'sobre o seu contrato. Seguem os dados:</p>' + quadro +
      '<p style="font-size:13.5px">Se precisar remarcar, é só responder este e-mail ou falar com o DP.</p>';
    _enviar_(colabEmail, 'Comparecimento ao Departamento Pessoal',
      _moldura_('Comparecimento ao Departamento Pessoal', corpoC, 'Departamento Pessoal · CIEDS.', false), null, null, true);
  }
}

function _notificarComparecimento_(caso, compareceu, avisoOpcao, novaData) {
  const gestor = _rescComDupla_(_normalizarEmail_(caso.GESTOR_EMAIL));

  let corpo;
  if (compareceu) {
    corpo =
      '<p><b>' + _escapeHtml_(caso.NOME) + '</b> compareceu ao DP e o processo de desligamento seguiu.</p>' +
      _quadro_([
        ['Comparecimento', 'Sim'],
        ['Tipo', _escapeHtml_(caso.TIPO)],
        ['Aviso prévio', caso.AVISO_MODALIDADE ? _capa_(caso.AVISO_MODALIDADE) : ','],
        ['Opção de aviso', avisoOpcao ? RESC.AVISO_OPCAO_TEXTO[avisoOpcao] : ',']
      ]) +
      '<p style="font-size:13.5px">O(a) colaborador(a) vai cumprir o aviso conforme a opção acima. ' +
      'Assim que o desligamento for efetivado, você recebe a confirmação.</p>';
  } else {
    corpo =
      '<p><b>' + _escapeHtml_(caso.NOME) + '</b> <b>não compareceu</b> ao DP na data agendada.</p>' +
      (novaData
        ? _quadro_([['Novo comparecimento', _fmtBRF_(novaData)]]) +
          '<p style="font-size:13.5px">O comparecimento foi reagendado. Avisamos você de novo quando acontecer.</p>'
        : '<p style="font-size:13.5px">Vamos reagendar e te avisar a nova data.</p>');
  }

  _enviar_(gestor,
    (compareceu ? 'Colaborador compareceu, ' : 'Não compareceu, ') + caso.NOME,
    _moldura_(compareceu ? 'Comparecimento realizado' : 'Não compareceu', corpo, 'Departamento Pessoal · CIEDS.', false),
    null, 'rescisao@cieds.org.br', true);
}

function _notificarDesligamento_(caso, data) {
  const gestor = _rescComDupla_(_normalizarEmail_(caso.GESTOR_EMAIL));
  const corpo =
    '<p>O desligamento de <b>' + _escapeHtml_(caso.NOME) + '</b> foi efetivado.</p>' +
    _quadro_([
      ['Colaborador(a)', _escapeHtml_(caso.NOME)],
      ['Matrícula', _escapeHtml_(caso.MATRICULA || ',')],
      ['Tipo', _escapeHtml_(caso.TIPO)],
      ['Data do desligamento', _fmtBRF_(data)]
    ]) +
    '<p style="font-size:13.5px">A revogação de acessos (TI) e o e-mail com os próximos passos ao ' +
    'colaborador seguem automaticamente a partir da planilha de controle.</p>';
  _enviar_(gestor, 'Desligamento efetivado, ' + caso.NOME,
    _moldura_('Desligamento efetivado', corpo, 'Departamento Pessoal · CIEDS.', false),
    null, 'rescisao@cieds.org.br', true);
}

function _capa_(s) {
  s = String(s || '');
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/* ============================================================================================ */
/*  RESCISÃO COMPLEMENTAR, rastro estruturado (motivo + causa raiz) para virar indicador         */
/* ============================================================================================ */

function _shComplementar_() {
  const sh = _ssControle_().getSheetByName(RESC.ABAS.COMPLEMENTAR);
  if (!sh) throw new Error('Aba não encontrada: ' + RESC.ABAS.COMPLEMENTAR);
  return sh;
}

function _rescMotivoComplementar_(cod) {
  return RESC.MOTIVOS_COMPLEMENTAR.find(m => m.cod === String(cod || '').toUpperCase().trim()) || null;
}

function _rescCausaAtraso_(cod) {
  return RESC.CAUSAS_ATRASO_477.find(c => c.cod === String(cod || '').toUpperCase().trim()) || null;
}

/**
 * Garante que as colunas novas existem na aba RESCISAO COMPLENTAR, sempre acrescentadas ao
 * FINAL, nunca deslocando as que já existem (MATRÍCULA ... MOTIVO continuam exatamente onde estão).
 * Rode UMA vez: garantirColunasComplementar()
 */
function garantirColunasComplementar() {
  const sh = _shComplementar_();
  const cabecalhoAtual = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(v => String(v || '').trim());

  const novas = [
    ['MOTIVO_CATEGORIA', RESC.COMPLEMENTAR_COL.MOTIVO_CATEGORIA],
    ['CAUSA_ATRASO', RESC.COMPLEMENTAR_COL.CAUSA_ATRASO],
    ['OBSERVACAO', RESC.COMPLEMENTAR_COL.OBSERVACAO],
    ['REGISTRADO_POR', RESC.COMPLEMENTAR_COL.REGISTRADO_POR],
    ['REGISTRADO_EM', RESC.COMPLEMENTAR_COL.REGISTRADO_EM],
    ['CASO_RESCISAO_ORIGEM', RESC.COMPLEMENTAR_COL.CASO_RESCISAO_ORIGEM]
  ];

  let adicionadas = 0;
  novas.forEach(([nome, col]) => {
    const existente = cabecalhoAtual[col - 1];
    if (!existente) {
      sh.getRange(1, col).setValue(nome).setFontWeight('bold');
      adicionadas++;
    } else if (existente !== nome) {
      throw new Error('A coluna ' + col + ' já tem o cabeçalho "' + existente + '", diferente do esperado ("' +
        nome + '"). Confira RESC.COMPLEMENTAR_COL antes de continuar, não quero sobrescrever nada.');
    }
  });

  return adicionadas
    ? (adicionadas + ' coluna(s) nova(s) acrescentada(s) ao final da aba RESCISAO COMPLENTAR.')
    : 'As colunas novas já estavam presentes.';
}

/**
 * Registra um caso de rescisão complementar. Preenche as colunas já existentes (com o mesmo
 * padrão de texto usado historicamente) + as colunas estruturadas novas.
 * payload:
 *   idColaborador (opcional, se informado, preenche matrícula/nome/e-mail/depto automaticamente)
 *   matricula, nome, email, departamento, funcao, admissao, demissao  (usar se não tiver idColaborador
 *    , ex.: caso antigo, colaborador já fora da base ativa)
 *   tipoDemissao, valorTrct, valorTrctComplementar, dataEnvioFinanceiro, dataPagamento
 *   motivoCategoria ('ERRO_CALCULO_DP'|'DISSIDIO'|'MULTA_477'|'OUTRO')
 *   causaAtraso (obrigatório só quando motivoCategoria = 'MULTA_477')
 *   observacao, casoRescisaoOrigem (ID_CASO da RESCISAO_CASOS, se vier de um desligamento já rastreado)
 */
function rescComplementarRegistrar(user, p) {
  _rescValidarMapaColunas_();
  const motivo = _rescMotivoComplementar_(p.motivoCategoria);
  if (!motivo) throw new Error('Motivo inválido. Use um dos códigos de RESCISAO.COMPLEMENTAR_MOTIVOS.');

  let causa = null;
  if (motivo.cod === 'MULTA_477') {
    causa = _rescCausaAtraso_(p.causaAtraso);
    if (!causa) throw new Error('Para "Multa do art. 477", informe a causa do atraso (causaAtraso).');
  }

  // dados do colaborador: via ID (base ativa) ou informados direto (caso antigo/já desligado)
  let c = null;
  if (p.idColaborador) {
    c = _colaboradores_().find(x => String(x.ID_COLABORADOR) === String(p.idColaborador));
  }

  const matricula = (c && c.MATRICULA) || p.matricula || '';
  const nome = (c && c.NOME) || p.nome || '';
  const email = (c && (c.EMAIL_INSTITUCIONAL || c.EMAIL_PESSOAL)) || p.email || '';
  const empresaCod = (c && c.EMPRESA_COD) || p.empresaCod || '';
  const empresa = (c && c.EMPRESA) || p.empresa || '';
  const departamento = (c && c.DEPARTAMENTO_ATUAL) || p.departamento || '';
  const funcao = (c && c.FUNCAO) || p.funcao || '';

  if (!matricula || !nome) throw new Error('Informe ao menos matrícula e nome (direto ou via idColaborador).');

  const admissao = _dataF_(p.admissao) || (c && _dataF_(c.ADMISSAO)) || '';
  const demissao = _dataF_(p.demissao);
  if (!demissao) throw new Error('Informe a data da demissão original (demissao).');

  const mes = Utilities.formatDate(demissao, DP360.FUSO, 'MM/yyyy');
  const dataEnvioFinanceiro = _dataF_(p.dataEnvioFinanceiro) || '';
  const dataPagamento = _dataF_(p.dataPagamento) || '';

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = _shComplementar_();
    const col = RESC.COMPLEMENTAR_COL;
    const linha = [];

    linha[col.MATRICULA - 1] = matricula;
    linha[col.EMPRESA - 1] = empresa;
    linha[col.COD - 1] = empresaCod;
    linha[col.EMAIL - 1] = email;
    linha[col.NOME - 1] = nome;
    linha[col.DEPARTAMENTO - 1] = departamento;
    linha[col.FUNCAO - 1] = funcao;
    linha[col.ADMISSAO - 1] = admissao;
    linha[col.DEMISSAO - 1] = demissao;
    linha[col.MES - 1] = mes;
    linha[col.TIPO_DEMISSAO - 1] = String(p.tipoDemissao || '').toUpperCase();
    linha[col.VALOR_TRCT - 1] = p.valorTrct != null ? _rescMoeda_(p.valorTrct) : '';
    linha[col.VALOR_TRCT_COMPLEMENTAR - 1] = p.valorTrctComplementar != null ? _rescMoeda_(p.valorTrctComplementar) : '';
    linha[col.DATA_ENVIO_FINANCEIRO - 1] = dataEnvioFinanceiro ? _fmtBRF_(dataEnvioFinanceiro) : '';
    linha[col.DATA_PAGAMENTO - 1] = dataPagamento ? _fmtBRF_(dataPagamento) : '';
    linha[col.MOTIVO - 1] = motivo.motivoTexto;   // mesmo padrão de texto já usado historicamente
    linha[col.MOTIVO_CATEGORIA - 1] = motivo.cod;
    linha[col.CAUSA_ATRASO - 1] = causa ? causa.cod : '';
    linha[col.OBSERVACAO - 1] = String(p.observacao || '');
    linha[col.REGISTRADO_POR - 1] = _normalizarEmail_(user.EMAIL);
    linha[col.REGISTRADO_EM - 1] = new Date();
    linha[col.CASO_RESCISAO_ORIGEM - 1] = String(p.casoRescisaoOrigem || '');

    sh.appendRow(linha);
  } finally {
    lock.releaseLock();
  }

  _auditar_('RESC_COMPLEMENTAR_REGISTRADA', user.EMAIL, 'RESCISAO.COMPLEMENTAR_REGISTRAR', true,
    nome + ': ' + motivo.nome + (causa ? ', ' + causa.nome : ''),
    { matricula: matricula, motivo: motivo.cod, causa: causa ? causa.cod : null });

  return {
    ok: true,
    mensagem: 'Rescisão complementar registrada: ' + motivo.nome + (causa ? ' (' + causa.nome + ')' : '') + '.'
  };
}

/** Lista os casos registrados, com filtros opcionais, para telas de acompanhamento. */
function rescComplementarListar(user, p) {
  p = p || {};
  const sh = _shComplementar_();
  const col = RESC.COMPLEMENTAR_COL;

  const linhas = _sheetToObjects_(sh).map(o => ({
    linha: o._rowNumber,
    matricula: o.MATRICULA,
    nome: o.NOME,
    departamento: o.DEPARTAMENTO,
    demissao: _isoF_(o.DEMISSAO),
    tipoDemissao: o['TIPO DE DEMISSÃO'],
    valorTrct: o['VALOR TRCT '] || o['VALOR TRCT'] || '',
    valorTrctComplementar: o['VALOR TRCT COMPLEMENTAR'],
    dataEnvioFinanceiro: o['DATA DO ENVIO PARA FINANCEIRO'],
    dataPagamento: o['DATA DE PAGAMENTO'],
    motivo: o.MOTIVO,
    motivoCategoria: o.MOTIVO_CATEGORIA || '',
    causaAtraso: o.CAUSA_ATRASO || '',
    observacao: o.OBSERVACAO || '',
    registradoPor: o.REGISTRADO_POR || '',
    registradoEm: _isoF_(o.REGISTRADO_EM),
    casoRescisaoOrigem: o.CASO_RESCISAO_ORIGEM || ''
  }));

  const filtroCategoria = String(p.motivoCategoria || '').toUpperCase();
  const filtroCausa = String(p.causaAtraso || '').toUpperCase();

  const filtradas = linhas.filter(l =>
    (!filtroCategoria || l.motivoCategoria === filtroCategoria) &&
    (!filtroCausa || l.causaAtraso === filtroCausa)
  ).sort((a, b) => String(b.registradoEm || b.demissao).localeCompare(String(a.registradoEm || a.demissao)));

  return { ok: true, total: filtradas.length, casos: filtradas };
}

/**
 * Indicador simples: contagem por motivo e, dentro de MULTA_477, por causa raiz.
 * Ainda simples de propósito, a ideia é evoluir para valores (R$) e por competência quando
 * fizer sentido; por ora é a base para o indicador que você pediu.
 */
function rescComplementarIndicadores(user, p) {
  const r = rescComplementarListar(user, p);
  const casos = r.casos;

  const porMotivo = {};
  const porCausaAtraso477 = {};

  casos.forEach(c => {
    const m = c.motivoCategoria || '(SEM_CATEGORIA, lançamento antigo)';
    porMotivo[m] = (porMotivo[m] || 0) + 1;

    if (c.motivoCategoria === 'MULTA_477') {
      const causa = c.causaAtraso || '(SEM_CAUSA, lançamento antigo)';
      porCausaAtraso477[causa] = (porCausaAtraso477[causa] || 0) + 1;
    }
  });

  return {
    ok: true,
    total: casos.length,
    porMotivo: porMotivo,
    porCausaAtraso477: porCausaAtraso477
  };
}

/* ============================================================================================ */
/*  SETUP + DIAGNÓSTICO + TESTE (funções sem parâmetro, rode pelo ▶)                            */
/* ============================================================================================ */

/** Rode UMA vez: cria a aba de casos, semeia as permissões e prepara a Rescisão Complementar. */
function rescSetup() {
  const r1 = garantirAbaCasosRescisao();
  const r2 = semearPermissoesRescisao();
  const r3 = garantirColunasComplementar();
  const msg = 'RESCISÃO pronta.\n- ' + r1 + '\n- ' + r2 + '\n- ' + r3 +
    '\n\nAgora aplique os 2 patches (Codigo.gs e FERIAS.gs) descritos no cabeçalho, ' +
    'e adicione RESCISAO na coluna MODULOS dos usuários do DP que vão cuidar de rescisões (ADMIN já enxerga tudo).' +
    '\n\nPara a FATIA 2 (conciliação), rode também: ' +
    '\n  configurarEmailFinanceiro("financeiro@cieds.org.br")' +
    '\n  configurarAutentiqueToken("SEU_TOKEN")   (gerado no painel do Autentique)' +
    '\n  testarAutentique()                       (só valida a conexão, não cria nada)' +
    '\n  rescTestarMapaColunas()                  (confere as colunas novas também)' +
    '\n\nPara os MODELOS DE CARTA: crie 4 Google Docs com os textos prontos, compartilhe cada um ' +
    'como "Qualquer pessoa com o link, Leitor", e rode configurarModelosCartaDemissao({...}) ' +
    'com os 4 links (veja o exemplo no comentário da função).';
  console.log(msg);
  return msg;
}

/** Acrescenta as permissões de RESCISAO na aba PERMISSOES (idempotente). */
function semearPermissoesRescisao() {
  const ss = _configSS_();
  const sh = ss.getSheetByName(DP360.SHEETS.PERMISSOES);
  if (!sh) throw new Error('Aba PERMISSOES não encontrada. Rode setupDP360() primeiro.');

  const h = _headers_(sh);
  const existentes = _sheetToObjects_(sh).map(r =>
    String(r.PERFIL).toUpperCase() + '|' + String(r.ACAO).toUpperCase());

  const novas = [
    ['GESTOR', 'RESCISAO.CONTEXTO', 'Sim', 'PROPRIO', 'Consultar rescisões da própria equipe.'],
    ['GESTOR', 'RESCISAO.SOLICITAR', 'Sim', 'PROPRIO', 'Solicitar rescisão da própria equipe.'],
    ['GESTOR', 'RESCISAO.MODELOS_CARTA', 'Sim', 'PROPRIO', 'Ver os modelos prontos de carta de pedido de demissão.'],
    ['GESTOR', 'RESCISAO.CANCELAR', 'Sim', 'PROPRIO', 'Cancelar a própria solicitação pendente.'],
    ['DP', 'RESCISAO.*', 'Sim', 'GLOBAL', 'Ações operacionais de rescisão.']
  ];

  let add = 0;
  novas.forEach(linha => {
    const chave = linha[0].toUpperCase() + '|' + linha[1].toUpperCase();
    if (existentes.indexOf(chave) === -1) {
      const obj = { PERFIL: linha[0], ACAO: linha[1], PERMITIDO: linha[2], ESCOPO: linha[3], DESCRICAO: linha[4] };
      sh.appendRow(h.map(col => (obj[col] === undefined ? '' : obj[col])));
      add++;
    }
  });

  if (typeof _limparCachePermissoes_ === 'function') _limparCachePermissoes_();

  return add ? (add + ' permissão(ões) de rescisão adicionada(s).') : 'Permissões de rescisão já estavam presentes.';
}

function diagnosticarRescisoes() {
  const shC = _ssControle_().getSheetByName(RESC.ABAS.CASOS);
  const casos = shC ? _sheetToObjects_(shC) : [];

  const shCtrl = _shControle_();
  const nomeCabecalho = shCtrl.getRange(2, RESC.COL.DEMISSAO).getValue();

  const shComp = _ssControle_().getSheetByName(RESC.ABAS.COMPLEMENTAR);
  const complementares = shComp ? _sheetToObjects_(shComp) : [];

  const out = {
    versao: RESC.VERSAO,
    controleId: RESC.CONTROLE_ID,
    abaCasosExiste: !!shC,
    casosRegistrados: casos.length,
    checagemColunaDEMISSAO: nomeCabecalho, // deve imprimir "DEMISSÃO"
    emailFinanceiroConfigurado: !!_rescParam_(RESC.AUTENTIQUE_PARAM_FINANCEIRO_EMAIL, ''),
    tokenAutentiqueConfigurado: !!(PropertiesService.getScriptProperties().getProperty(RESC.AUTENTIQUE_PARAM_TOKEN) || _rescParam_(RESC.AUTENTIQUE_PARAM_TOKEN, '')),
    abaComplementarExiste: !!shComp,
    complementaresRegistrados: complementares.length,
    modelosCartaConfigurados: RESC.MODELOS_CARTA.filter(m => !!_rescParam_(m.param, '')).length + ' de 4',
    porStatus: {}
  };
  casos.forEach(c => { out.porStatus[c.STATUS] = (out.porStatus[c.STATUS] || 0) + 1; });

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * [2026-10-16] Mostra a fórmula da coluna TI (28) na linha-modelo (3) e na primeira linha de dados
 * que NÃO está quebrada, pra confirmar o padrão certo antes de corrigir as 534 linhas quebradas.
 * Só leitura.
 */
function conferirFormulaModeloColunaTI() {
  const sh = _shControle_();
  const ini = RESC.CONTROLE_LINHA_INICIAL;
  const last = sh.getLastRow();

  const formulaModelo = sh.getRange(RESC.CONTROLE_LINHA_MODELO, 28).getFormula();

  let primeiraIntacta = null;
  for (let linha = ini; linha <= last; linha++) {
    const matricula = String(sh.getRange(linha, RESC.COL.MATRICULA).getValue() || '').trim();
    if (!matricula) continue;
    const f = sh.getRange(linha, 28).getFormula();
    if (f && f.indexOf('#REF!') === -1) {
      primeiraIntacta = { linha: linha, matricula: matricula, formula: f };
      break;
    }
  }

  const out = {
    formulaNaLinhaModelo3: formulaModelo,
    primeiraLinhaIntacta: primeiraIntacta
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * [2026-10-16] Varre a coluna TI (28) inteira da CONTROLE.2026 procurando fórmula quebrada
 * (contém "#REF!" em vez de referenciar a matrícula da própria linha, ex.: A672). Só leitura —
 * mostra quantas linhas estão afetadas antes de qualquer correção em massa.
 */
function diagnosticarColunaTI() {
  const sh = _shControle_();
  const ini = RESC.CONTROLE_LINHA_INICIAL;
  const last = sh.getLastRow();
  if (last < ini) return 'Nenhuma linha de dados ainda.';

  const n = last - ini + 1;
  const matriculas = sh.getRange(ini, RESC.COL.MATRICULA, n, 1).getValues();
  const nomes = sh.getRange(ini, RESC.COL.NOME, n, 1).getDisplayValues();
  const formulasTI = sh.getRange(ini, 28, n, 1).getFormulas();

  const quebradas = [];
  for (let i = 0; i < n; i++) {
    const matricula = String(matriculas[i][0] || '').trim();
    if (!matricula) continue; // linha vazia/buraco, ignora
    const f = formulasTI[i][0] || '';
    if (f.indexOf('#REF!') !== -1) {
      quebradas.push({ linha: ini + i, matricula: matricula, nome: nomes[i][0], formulaAtual: f });
    }
  }

  const msg = quebradas.length
    ? quebradas.length + ' de ' + n + ' linha(s) com a coluna TI quebrada (#REF!).'
    : 'Nenhuma linha com #REF! na coluna TI (de ' + n + ' linhas verificadas).';

  console.log(msg);
  console.log(JSON.stringify(quebradas, null, 2));
  return { mensagem: msg, totalLinhas: n, quebradas: quebradas };
}

/**
 * [2026-10-16] Dump bruto de uma linha inteira da CONTROLE.2026 (cabeçalho da linha 2 + valores),
 * tanto a FÓRMULA quanto o valor calculado de cada coluna — pra ver exatamente o que está errado
 * nas colunas automáticas (VLOOKUP) sem precisar abrir a planilha. Só leitura.
 * Rode pelo editor passando a matrícula direto, ex.: mostrarLinhaControle(111840).
 */
function mostrarLinhaControle(matricula) {
  const sh = _shControle_();
  const linha = _controleLinhaPorMatricula_(sh, matricula);
  if (!linha) return 'Matrícula ' + matricula + ' não encontrada na CONTROLE.2026.';

  const ultimaColuna = sh.getLastColumn();
  const headers = sh.getRange(2, 1, 1, ultimaColuna).getValues()[0];
  const formulas = sh.getRange(linha, 1, 1, ultimaColuna).getFormulas()[0];
  const valores = sh.getRange(linha, 1, 1, ultimaColuna).getDisplayValues()[0];

  const out = headers.map((h, i) => ({
    coluna: i + 1,
    cabecalho: h,
    formula: formulas[i] || '(sem fórmula, valor fixo)',
    valorExibido: valores[i]
  })).filter(c => c.cabecalho); // ignora colunas sem cabeçalho

  console.log('Linha ' + linha + ' (matrícula ' + matricula + '):');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * [2026-10-16] Diagnóstico pontual da regressão de hoje em _tipoDemissaoTexto_: alguns tipos de
 * rescisão (COM_JUSTA_CAUSA, DISTRATO, APRENDIZ_24, ABANDONO, FALECIMENTO, LAUDO_INSUFICIENCIA)
 * geravam um texto não confirmado contra a dropdown da coluna Q — a CONTROLE.2026 REJEITA esse
 * valor (validação "Rejeitar entrada"), então a gravação de Q falha, rescDesligar lança exceção
 * ANTES de marcar o caso como DESLIGADO, e a pessoa vê erro no Portal. Resultado típico na planilha:
 * coluna O (DEMISSÃO) já preenchida (foi escrita antes de Q na mesma chamada), coluna Q (TIPO DE
 * DEMISSÃO) ainda vazia, e o caso em RESCISAO_CASOS parado num STATUS anterior a DESLIGADO.
 * Roda uma vez pelo editor (▶️ Executar) — só lê, não grava nada.
 */
function diagnosticarTipoDemissaoRegressao20261016() {
  const TIPOS_AFETADOS = ['COM_JUSTA_CAUSA', 'DISTRATO', 'APRENDIZ_24', 'ABANDONO', 'FALECIMENTO', 'LAUDO_INSUFICIENCIA'];

  const hoje = new Date();
  const ehHoje = d => {
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt && !isNaN(dt) && dt.getFullYear() === hoje.getFullYear() &&
      dt.getMonth() === hoje.getMonth() && dt.getDate() === hoje.getDate();
  };

  // Sem assumir COMO a falha aparece (a 1ª versão supôs "TIPO vazio" e não achou nada) — aqui é
  // só um raio-x bruto: todo caso TOCADO hoje (atualizado ou com DATA_DEMISSAO hoje), mostrando o
  // valor REAL que está em CONTROLE.2026 agora, pra comparar com RESC.TIPO_DEMISSAO_TEXTO à mão.
  const casos = _sheetToObjects_(_shCasos_()).filter(c => ehHoje(c.ATUALIZADO_EM) || ehHoje(c.DATA_DEMISSAO));

  const shCtrl = _shControle_();
  const resultado = casos.map(c => {
    const linha = _controleLinhaPorMatricula_(shCtrl, c.MATRICULA);
    const demissao = linha ? shCtrl.getRange(linha, RESC.COL.DEMISSAO).getValue() : null;
    const tipoGravado = linha ? shCtrl.getRange(linha, RESC.COL.TIPO).getValue() : null;
    const tipoEsperado = _tipoDemissaoTextoOuVazio_(c.TIPO_COD, c.AVISO_MODALIDADE) || '(sem mapeamento confirmado)';

    return {
      linhaControle: linha || '(matrícula não encontrada na CONTROLE.2026)',
      matricula: c.MATRICULA,
      nome: c.NOME,
      tipoCod: c.TIPO_COD,
      statusCaso: c.STATUS,
      afetadoPelaRegressao: TIPOS_AFETADOS.indexOf(c.TIPO_COD) !== -1,
      demissaoGravada: demissao ? _fmtBRF_(demissao) : '(vazio)',
      tipoGravadoAgora: tipoGravado || '(vazio)',
      tipoTextoEsperado: tipoEsperado,
      bateComOEsperado: tipoGravado === tipoEsperado
    };
  });

  console.log(resultado.length + ' caso(s) tocado(s) hoje (atualizado ou com DATA_DEMISSAO hoje).');
  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * TESTE seguro: valida o mapa de colunas contra o cabeçalho real da planilha,
 * sem escrever nada. Confere se os índices em RESC.COL batem com a linha 2.
 */
function rescTestarMapaColunas() {
  const sh = _shControle_();
  const esperado = {
    MATRICULA: 'MATRÍCULA', EMPRESA: 'EMPRESA', COD: 'COD', EMAIL: 'EMAIL', NOME: 'NOME',
    DEPARTAMENTO: 'DEPARTAMENTO', DEMISSAO: 'DEMISSÃO', TIPO: 'TIPO DE DEMISSÃO',
    VALOR_TRCT: 'VALOR TRCT', GFD: 'GFD', OPCAO_AVISO: 'OPÇÃO DE AVISO',
    DATA_EXAME: 'DATA DO EXAME DEMISSIONAL',
    // ---- FATIA 2 ----
    ENVIO_FINANCEIRO: 'DATA DO ENVIO PARA FINANCEIRO',
    STATUS_ENVIO_AUTENTIQUE: 'STATUS DE ENVIO AUTENTIQUE',
    ID_AUTENTIQUE: 'ID AUTENTIQUE',
    LINK_DRIVE_ASSINATURA: 'LINK DRIVE',
    STATUS_AUTENTIQUE: 'STATUS AUTENTIQUE'
  };

  const erros = [];
  Object.keys(esperado).forEach(k => {
    const real = String(sh.getRange(2, RESC.COL[k]).getValue()).trim().toUpperCase();
    const esp = esperado[k].toUpperCase();
    if (real !== esp) erros.push(k + ': esperado "' + esp + '", achei "' + real + '" na coluna ' + RESC.COL[k]);
  });

  if (erros.length) {
    const msg = 'MAPA DE COLUNAS DIVERGENTE:\n- ' + erros.join('\n- ') +
      '\n\nAjuste os índices em RESC.COL antes de usar o módulo.';
    console.log(msg);
    throw new Error(msg);
  }

  const msg = 'OK, mapa de colunas confere com o cabeçalho da CONTROLE.2026.';
  console.log(msg);
  return msg;
}
/**
 * Cria os 4 Google Docs com os modelos de carta de pedido de demissão, compartilha como
 * "Qualquer pessoa com o link, Leitor" e já configura os links automaticamente.
 * Rode UMA vez pelo ▶. Se rodar de novo, cria 4 documentos NOVOS (duplicados), não rode 2x.
 * Na primeira execução, o Google vai pedir autorização (Drive/Docs), é normal, aceite.
 */
function criarModelosCartaDemissao() {
  const raizId = _rescParam_('AFAST_DRIVE_PASTA_ID', ''); // opcional: guarda na mesma pasta dos documentos

  const modelos = [
    {
      chave: 'cumprindoAviso',
      titulo: 'Modelo - Pedido de Demissão (Cumprindo Aviso)',
      texto: [
        'Prezados,',
        '',
        'Por motivos pessoais, venho por meio desta comunicar formalmente o meu pedido de demissão do cargo de [Nome do seu Cargo].',
        'Informo que cumprirei o aviso prévio trabalhado de 30 dias, conforme determina a legislação, permanecendo à disposição da empresa no período de [Data de Início do Aviso] a [Data de Término do Aviso].',
        'Agradeço a oportunidade de fazer parte desta equipe, bem como o aprendizado e o crescimento profissional desenvolvidos ao longo do período em que colaborei com a organização.',
        'Atenciosamente,',
        '',
        '[Sua Assinatura se for entregar impressa]',
        '[Seu Nome Completo]',
        '',
        '[Cidade - Estado], [Dia] de [Mês] de [Ano].'
      ]
    },
    {
      chave: 'semCumprirAviso',
      titulo: 'Modelo - Pedido de Demissão (Sem Cumprir Aviso)',
      texto: [
        'Prezados,',
        '',
        'Eu, [Nome Completo], inscrito(a) no CPF nº [XXX.XXX.XXX-XX], ocupante do cargo de [Cargo], venho por meio desta apresentar meu pedido de demissão, com desligamento a partir desta data, [data].',
        '',
        'Informo que não cumprirei o período de aviso prévio, estando ciente de que será realizado o desconto correspondente, conforme previsto na legislação trabalhista vigente.',
        '',
        'Agradeço à empresa pela oportunidade e experiência adquirida durante o período em que exerci minhas atividades.',
        '',
        '[Cidade], [data]',
        '',
        '[Nome Completo]'
      ]
    },
    {
      chave: 'periodoExperiencia',
      titulo: 'Modelo - Pedido de Demissão (Período de Experiência)',
      texto: [
        'Prezados,',
        '',
        'Por motivos pessoais, venho por meio desta comunicar formalmente o meu pedido de demissão do cargo de [Nome do seu Cargo], o qual ocupo atualmente no de período de experiência.',
        'Informo que meu último dia de trabalho será em [Data do seu último dia de trabalho].',
        'Agradeço a oportunidade concedida e o aprendizado adquirido durante este período de convivência com a equipe.',
        '',
        '[Seu Nome Completo]',
        '',
        '[Cidade], [Dia] de [Mês] de [Ano].'
      ]
    },
    {
      chave: 'contratoDeterminado',
      titulo: 'Modelo - Pedido de Demissão (Contrato Determinado)',
      texto: [
        'Prezados,',
        '',
        'Comunico formalmente que, por motivos pessoais, estou solicitando o encerramento antecipado do meu contrato de trabalho por prazo determinado no cargo de [Seu Cargo].',
        '',
        'Informo que meu último dia de trabalho será em [Data do último dia].',
        '',
        '',
        '[Sua Assinatura]',
        '',
        '[Seu Nome Completo]',
        '',
        '[Cidade - Estado], [Data de Hoje].'
      ]
    }
  ];

  const links = {};

  modelos.forEach(m => {
    const doc = DocumentApp.create(m.titulo);
    const body = doc.getBody();
    body.clear();
    m.texto.forEach(linha => body.appendParagraph(linha));
    doc.saveAndClose();

    const arquivo = DriveApp.getFileById(doc.getId());

    if (raizId) {
      try {
        DriveApp.getFolderById(raizId).addFile(arquivo);
        DriveApp.getRootFolder().removeFile(arquivo);
      } catch (e) { /* mantém na raiz do Drive se falhar */ }
    }

    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    links[m.chave] = arquivo.getUrl();

    Logger.log(m.titulo + ' → ' + arquivo.getUrl());
  });

  const resultado = configurarModelosCartaDemissao(links);
  Logger.log(resultado);

  return { ok: true, links: links, mensagem: resultado };

}

function rodarConfigurarEmailFinanceiroRescisao() {
  return configurarEmailFinanceiro("dpfin@cieds.org.br,gustavo.rj@cieds.org.br");
}