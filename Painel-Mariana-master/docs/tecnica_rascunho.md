# DP360 — Documentação Técnica (rascunho de trabalho)

## 1. Visão geral da arquitetura

O DP360 é um sistema de RH construído inteiramente em Google Apps Script, rodando sobre planilhas Google Sheets como banco de dados. Não existe banco de dados tradicional — tudo é lido e escrito em Google Sheets via `SpreadsheetApp`.

O sistema é dividido em **7 projetos Apps Script separados** (cada um com seu próprio scriptId, cada um implantado como Web App independente):

| Projeto (pasta) | Papel |
|---|---|
| `DP360_API` | Backend único e compartilhado. Toda a lógica de negócio, autenticação e acesso a planilhas vive aqui. Os outros projetos são só interface. |
| `DP360_PORTAL_DP` | Portal do Departamento Pessoal (equipe de RH) — tela cheia com todos os módulos. |
| `DP360_PORTAL_GESTOR` | Portal do Gestor (líderes de equipe) — mesma base de módulos, escopado à própria equipe. |
| `Ferias_Fim_de_Ano` | Portal "espelho" enxuto, só pra campanha de férias de fim de ano. |
| `GUIA_FERIAS_FIM_DE_ANO_WEB` | Página estática de ajuda/FAQ sobre férias de fim de ano — não fala com a API. |
| `Guia_de_Afastamento` | Página estática de ajuda/FAQ sobre afastamentos — não fala com a API. |
| `Guia_de_Movimentacoes` | Página estática de ajuda/FAQ sobre movimentações — não fala com a API. |

**Padrão "portal espelho":** `DP360_PORTAL_DP`, `DP360_PORTAL_GESTOR` e `Ferias_Fim_de_Ano` NÃO acessam nenhuma planilha diretamente. Cada ação do usuário vira uma chamada `UrlFetchApp.fetch()` de dentro do Apps Script do portal para a URL `/exec` do `DP360_API`, carregando um "segredo compartilhado" (`SEGREDO_FRONT`) que nunca chega ao navegador. Toda ação passa por **duas execuções separadas de Apps Script em sequência** — um custo de latência estrutural conhecido (ver seção 11).

```
Navegador do usuário
     │  google.script.run (HTML Service)
     ▼
Portal (DP360_PORTAL_DP / _GESTOR / Ferias_Fim_de_Ano)
     │  UrlFetchApp.fetch(API_URL, {segredo, token, acao, payload})
     ▼
DP360_API  →  Google Sheets (várias planilhas)
```

## 2. Planilhas (bancos de dados)

| Planilha | ID | Uso |
|---|---|---|
| **DP360_MASTER** | `1wn_dxjBZrK9CPw8vjXwgor5ae3zvBiaRJuDWtoqb8fY` | Fonte única de dados cadastrais. Aba `COLABORADORES` = todo mundo da empresa (nome, matrícula, cargo, situação, gestor, PERFIL_SISTEMA, cidade/UF, horário, etc.). Aba `GESTORES` ainda em construção. Aba `SINCRONIZACAO_HISTORICO` = log de toda alteração feita pelo Raio-X. |
| **DP360_CONFIG** | ID dinâmico (`PropertiesService`, chave `DP360_CONFIG_ID`, criado por `setupDP360()`) | Autenticação e controle de acesso: `USUARIOS`, `CREDENCIAIS`, `PERFIS`, `PERMISSOES`, `SESSOES`, `AUDITORIA`, `PARAMETROS`. |
| **DP360_FERIAS** | `1gX_uwAY4Go4oaqDsPV4qZlN3l2ZFwWqtNuERzQy3WzQ` | Férias (normais e fim de ano): abas `PERIODOS` e `SOLICITACOES`. |
| **Dp360 afastamentos** | `1zYYtJG8RyOcrPZiEkDNZtXWr0AZKrkgS3DuaV9zukO0` | Aba `OCORRENCIAS` — todo o histórico de afastamentos. |
| **CONTROLE DE PAGAMENTO 2026** | `1QNgDYCdA9-l-R3Zk8IAojLQLZhJJ_2C87elDuPPFaOc` | Compartilhada por Rescisão, Movimentações, Processo Trabalhista e Benefícios — abas `CONTROLE.2026`, `MOVIMENTACOES_CASOS`, `PROCESSOS_TRABALHISTAS`, `BENEFICIOS_LANCAMENTOS`, `BENEFICIOS_REGRAS`, `BENEFICIOS_DIAS_UTEIS`. Cada módulo abre essa planilha de forma independente (ID repetido em cada arquivo) — é uma escolha deliberada de "módulos sem dependência rígida entre si", mas significa que uma troca desse ID precisa ser replicada em vários arquivos. |

**⚠️ Armadilha conhecida:** colunas são lidas pelo NOME EXATO do cabeçalho (linha 1), não pela posição. Renomear/adicionar espaço/trocar acento numa coluna faz o código parar de encontrá-la **silenciosamente** (o campo só vem `undefined`, sem erro). Já causou bugs reais (ver seção 10).

## 3. Autenticação e sessão

- Login por e-mail + senha (não é OAuth do Google) — hash HMAC-SHA256 + salt em `CREDENCIAIS`.
- Domínios permitidos (`DP360.DOMINIOS_PERMITIDOS`): `cieds.org.br`, `coletivoaprendiz.org.br`, `gmail.com`, `hotmail.com`.
- Primeiro acesso / esqueci senha: código de 6 dígitos por e-mail (`SOLICITAR_CODIGO_CADASTRO`, expira em 15 min), depois `CONFIRMAR_CADASTRO_SENHA`. **Não existe fluxo separado de "recuperar senha" — é o mesmo caminho de primeiro acesso.**
- Token tipo JWT próprio (`_emitirToken_`), HMAC-SHA256, válido por **10 horas**, com lista de revogação.
- 5 tentativas de senha erradas bloqueiam o login por 15 minutos. **O desbloqueio não tem fluxo self-service — precisa de alguém rodando `desbloquearLogin(email)` direto no editor do Apps Script.**
- Todo login/logout/tentativa fica registrado na aba `AUDITORIA`.
- Quem pode logar: `USUARIOS.ATIVO = "Sim"` E `USUARIOS.PODE_LOGAR = "Sim"` — preenchidos por `sincronizarUsuariosAPartirDaMaster()` a partir da `COLABORADORES` (ver Incidente #2, seção 10).

## 4. Perfis, permissões e escopo de equipe

- Perfil (`PERFIL`, ex.: `GESTOR`, `DP`, `ADMIN`) vem de `COLABORADORES.PERFIL_SISTEMA` na MASTER.
- Permissões por ação ficam na aba `PERMISSOES`; `_usuarioPodeAcao_(user, acao)` decide se uma chamada é permitida (aceita wildcard, ex.: `AFASTAMENTOS.*`).
- Portal do DP só aceita perfis `DP`/`ADMIN` (`DP360.PERFIS_PORTAL_DP`).
- **Escopo de equipe (quem um gestor enxerga):** resolvido por `_equipeDoGestor_(email)`, que filtra `COLABORADORES` por `GESTOR_EMAIL === e-mail do usuário`. É uma relação direta 1 campo → 1 gestor, sem hierarquia organizacional. Usada por Afastamentos, Rescisão, Movimentações e Benefícios.
- **Portal do Gestor força `visao:'GESTOR'` em toda chamada**, mesmo se o usuário logado tiver perfil DP/ADMIN — o toggle "Visão geral" que aparece pra esses perfis é só navegação (não muda o escopo).
- **Exceção hardcoded conhecida:** o módulo de Férias tem sua própria cópia do escopo (`_equipeFeriasDoGestor_`) com um caso especial fixo no código pra uma gestora específica (`marianazenicola.rj@cieds.org.br`), cuja equipe (11 pessoas nominadas) é resolvida por nome e guardada em `ScriptProperties`, porque a MASTER "ainda não representa corretamente a equipe dela" (comentário original no código). Só afeta Férias — os outros módulos usam `GESTOR_EMAIL` normal pra essa mesma pessoa. Vale confirmar se ainda é necessário antes de tratar como definitivo.

## 5. Roteamento de ações (API)

Toda chamada ao `DP360_API` é um `POST` com corpo `{ segredo, token, acao, origem, payload }`.

```
doPost(e)
 ├─ PING, SOLICITAR_CODIGO_CADASTRO, CONFIRMAR_CADASTRO_SENHA, AUTENTICAR,
 │  CONTEXTO, VALIDAR_TOKEN, LOGOUT, CARGA   → tratadas direto em Código.js
 └─ qualquer outra ação → executar(token, acao, payload)  (em Ferias.js)
                            ├─ 'FERIAS.*'        → _feriasExecutar_       (Ferias.js — inclui os Recibos)
                            ├─ 'AFASTAMENTOS.*'  → afastExecutar           (Afastamentos.js)
                            ├─ 'RESCISAO.*'      → rescExecutar            (Rescisão.js — inclui Homologação)
                            ├─ 'PROCESSOTRAB.*'  → procTrabExecutar        (Processotrab.js)
                            ├─ 'MOVIMENTACAO.*'  → movExecutar             (Movimentacoes.js)
                            ├─ 'BENEFICIOS.*'    → beneficiosExecutar      (Beneficios.js)
                            └─ 'RAIOX.*'         → raioxExecutar           (Raiox.js)
```

Padrão comum a todos os módulos: um objeto de constantes (colunas/status/config), um router `xExecutar()`, um par `_ssX_()`/`_shX_()` de acesso à planilha, uma função `garantirAbaX()` que cria/repara colunas faltando (nunca reordena/remove), CRUD via `_sheetToObjects_`/`_atualizarLinha_`/`_headers_` (por nome de coluna, resiliente a reordenação), histórico append-only em `HISTORICO_JSON`, e uma função `diagnosticarX()` de checagem de saúde. Toda ação que muda estado chama `_auditar_(evento, email, acao, ok, mensagem, detalhe)`, gravando na `AUDITORIA` compartilhada.

## 6. Módulo Férias (`Ferias.js`, ~277KB — o maior arquivo do sistema)

Cobre férias normais E a campanha de fim de ano (mesma planilha, mesmo motor de cálculo de saldo).

| Ação | O que faz |
|---|---|
| `FERIAS.CONTEXTO` / `FERIAS.RESUMO` | Tela cheia / versão leve pro painel. |
| `FERIAS.SOLICITAR` / `FERIAS.CANCELAR` | Gestor cria/cancela uma solicitação. |
| `FERIAS.FILA` / `FERIAS.DEFERIR` / `FERIAS.INDEFERIR` | Fila do DP e decisão. |
| `FERIAS.CALENDARIO` | Visão de calendário/custo mensal. |
| `FERIAS.RECIBOS` + 8 ações | Recibo de férias assinado via Autentique (ver detalhe abaixo). |
| `FERIAS.DEFINIR_TETO` / `FERIAS.PROVISAO` / `FERIAS.PAINEL_DP` | Ferramentas financeiras/gerenciais do DP. |
| `FERIAS.SOLICITAR_ABONO` + 3 ações | Venda de dias (abono pecuniário). |
| `FERIAS.ENVIAR_FINANCEIRO_LOTE` / `FERIAS.AGENDADAS` | Envio em lote pro financeiro. |
| `FERIAS.ELEGIVEIS_FIM_DE_ANO` / `AGENDADOS_FIM_DE_ANO` / `AGENDAR_FIM_DE_ANO` | Campanha de fim de ano (ver documento específico). |
| `FERIAS.BUSCAR_COLABORADOR` | Busca livre (usada pela busca global do Portal do DP). |

**Regra de negócio central — fração mínima de 14 dias (CLT art. 134 §1º):** quando as férias são fracionadas, pelo menos uma fração precisa ter 14 dias corridos. O sistema estica automaticamente a fração pra consumir o saldo inteiro quando os 10 dias padrão não fechariam 14 nem sobraria saldo suficiente pra uma fração futura.

**Recibos de férias (`Ferias Recibo.gs.js`, ~44KB):** o PDF do recibo é gerado fora do sistema (Alterdata) e colocado manualmente numa pasta do Drive — o módulo **não gera o PDF**, ele acha o arquivo certo por nome (tokens do nome do colaborador + datas) e data, envia pro Autentique pra assinatura (DP primeiro, colaborador depois), acompanha o status, e arquiva o assinado numa segunda pasta. Colunas adicionadas na `SOLICITACOES`: `ID_AUTENTIQUE`, `STATUS_AUTENTIQUE`, `AUTENTIQUE_ENVIADO_EM`, `RECIBO_LINK`, `RECIBO_ASSINADO_LINK`, `RECIBO_ASSINADO_EM`. **Atenção:** a correspondência de arquivo por nome é frágil — se o PDF do Alterdata tiver um nome ambíguo (bate com mais de uma pessoa/data), o sistema devolve `AMBIGUO` e pede pra renomear incluindo as duas datas. Ações em lote se auto-limitam a 4,5 min (limite do Apps Script é 6 min) e reportam quem não deu tempo de processar.

**Cache:** `feriasElegiveisFimDeAno`/`feriasAgendadosFimDeAno` usam `CacheService` (5 min) por gestor; listagem de recibos cacheia a varredura da pasta do Drive por 30 min (`forcar:true` no botão "Atualizar" força releitura).

## 7. Módulo Rescisão (`Rescisão.js` ~108KB + `Rescisao_Homologacao.js` ~53KB)

Cobre: pedido de demissão/rescisão pelo gestor, aprovação do DP, comparecimento, exame demissional, geração/anexo de carta, conciliação de valores, envio pro financeiro, assinatura via Autentique, e uma sub-área inteira de **homologação** (TRCT assinado por empresa + funcionário + testemunhas).

Fonte de dados: planilha "CONTROLE DE PAGAMENTO 2026", aba `CONTROLE.2026` — colunas fixas indexadas por número em `RESC.COL` (ex.: `MATRICULA:1, NOME:5, DEMISSAO:15, ID_AUTENTIQUE:32, LINK_DRIVE_ASSINATURA:33, STATUS_AUTENTIQUE:34`).

Há também a **"rescisão complementar"** — um registro manual/retroativo (não passa pelo fluxo normal) usado só pra manter indicadores e auditoria em dia, com categorias de motivo (inclusive uma específica pra "Multa 477 CLT", atraso no pagamento da rescisão).

**Integração com Autentique (assinatura eletrônica):** GraphQL, endpoint em `RESC.AUTENTIQUE_ENDPOINT`, token em `_autentiqueToken_()`.

**⚠️ Armadilha conhecida e já corrigida:** `deleteDocument` do Autentique, sozinho, **não bloqueia assinantes pendentes** — só remove da lista ("Apenas excluir"); quem já tinha o link ainda consegue assinar. O jeito certo ("Bloquear e excluir", documentado pela própria Autentique) é chamar `updateDocument` com `deadline_at` = agora **antes** de `deleteDocument`. `_autentiqueApagarDocumento_` já faz isso certo — **qualquer cancelamento de documento no Autentique, em qualquer módulo (Rescisão, Homologação, Recibos), tem que reusar essa função**, nunca chamar `deleteDocument` isolado.

## 8. Outros módulos do backend

### Afastamentos (`Afastamentos.js`, ~48KB)
Ciclo de vida completo de um afastamento médico/licença: atestado → (se >15 dias) INSS → perícia → decisão (deferido/indeferido/prorrogado) → exame ocupacional de retorno → retorno. Planilha própria (`Dp360 afastamentos`), aba `OCORRENCIAS` (append-only — uma prorrogação nunca edita a ocorrência original, cria uma nova linha ligada via `PRORROGACAO_DE`).
- **15 dias é o corte legal**: até 15 dias é responsabilidade da empresa; a partir do 16º dia, vira responsabilidade do INSS — o sistema dispara automaticamente um e-mail de orientação (passo a passo do Meu INSS + DUT) quando o afastamento passa desse limite.
- **Acidente de trabalho**: gera automaticamente um RAT (rascunho, precisa de conferência humana) e avisa por e-mail o técnico de segurança configurado, pra ele emitir a CAT oficial. Calcula estabilidade de 12 meses após o retorno (Lei 8.213/91 art. 118), consultável por outros módulos (pensado pra Rescisão checar antes de permitir uma demissão sem justa causa).
- **Sem assinatura eletrônica** neste módulo — nenhuma etapa passa pelo Autentique.
- Retorno é bloqueado sem resultado do exame ocupacional preenchido (validação no próprio código).

### Movimentações (`Movimentacoes.js`, ~40KB)
Pedido de mudança contratual (departamento, turno, carga horária, cargo, salário, ou pagamento de "adicional" avulso), com aprovação em duas etapas: **RH primeiro, DP depois** (só o DP lança de fato na folha).
- **⚠️ A decisão do RH (aprovar/recusar) NÃO acontece dentro do DP360_API** — vive num miniaplicativo separado e não-autenticado (`MOVIMENTACAO_DECISAO_WEB`, fora deste repositório), acessado por um link assinado (HMAC, válido 10 dias) mandado por e-mail. O RH nunca loga no DP360. Qualquer mudança nas colunas/status de Movimentações precisa ser replicada manualmente nesse outro projeto.
- **Trava de divergência salarial**: compara o salário pedido contra o "praticado" (moda — valor mais frequente — entre quem já ocupa o mesmo cargo/departamento). Se divergir, bloqueia até o gestor confirmar explicitamente com justificativa.
- Trocar pra turno noturno gera automaticamente uma segunda solicitação (ligada) de inclusão do adicional noturno; trocar pra diurno gera a de retirada.
- **Nomes de coluna incertos, assumido no próprio código**: o comentário do arquivo admite não ter certeza absoluta de qual coluna da base de colaboradores guarda salário/cargo atual — tenta várias variantes de nome; se não achar nenhuma, não bloqueia por divergência, só marca "não verificado".

### Processo Trabalhista (`Processotrab.js`, ~21KB)
Acompanha pagamento de FGTS/INSS determinado por decisão judicial ou acordo. **Só DP tem acesso — não existe visão de gestor nesse módulo.**
- Diferente dos outros: o **status não é gravado, é sempre recalculado na leitura** (Pago / Parcial / Pendente), a partir de quais datas de pagamento já foram preenchidas — a única escrita manual no campo status é "Cancelado". Editar a planilha diretamente não muda o status calculado.
- Reusa a mesma planilha "CONTROLE DE PAGAMENTO 2026" e depende de funções carregadas por `Rescisão.js` (`_ssControle_`, `_rescMoeda_`) — precisa desse arquivo já carregado no mesmo projeto pra funcionar.

### Benefícios (`Beneficios.js`, ~41KB)
Controla vale-alimentação/refeição/transporte (Pluxee, RioCard, "Jaeh", outros). Dois fluxos: (1) registrar o que foi **pedido** ao fornecedor vs. o que o fornecedor **confirmou** (relatório), pra conciliar os dois lado a lado; (2) motor de **cálculo automático** por competência (mês), descontando dias de férias, afastamento e rescisão de cada colaborador elegível.
- **Não lê PDF de fornecedor diretamente** — o DP precisa normalizar cada relatório numa planilha simples de 3 colunas antes de importar; o PDF original só é arquivado como anexo.
- Turnos 12x36 não usam tabela de dias úteis — são pagos por metade dos dias corridos do mês, arredondado pra cima.
- Departamentos sem regra configurada, ou UFs sem dias úteis definidos, são pulados silenciosamente (só contados na resposta, não travam o cálculo geral).

### Raio-X (`Raiox.js`, ~25KB)
**Não é uma tela de relatório pro usuário** — é um motor de sincronização que o DP roda periodicamente (ou por gatilho semanal automático) pra manter a `COLABORADORES` da MASTER alinhada com o sistema de folha de pagamento real, a partir de uma planilha exportada de lá ("Raio-X"). Não aparece como módulo no painel de nenhum portal.
- Detecta gente que **sumiu** do Raio-X (não é um campo "inativo" — é ausência) e, se não tiver um caso de rescisão formal nem estiver na planilha de controle, **marca `Desligado` automaticamente**, sem aprovação humana no meio.
- Detecta separadamente desligamentos via a própria planilha de Rescisão (`CONTROLE.2026`), de forma independente do Raio-X — porque nem toda rescisão passa pelo fluxo formal do portal.
- Depois de sincronizar, recalcula períodos de férias automaticamente (novas admissões/desligamentos afetam o período aquisitivo).
- Manda e-mail de alerta (`rescisao@cieds.org.br`, cc `dp@cieds.org.br`) quando encontra inconsistência (alguém "ativo" no Raio-X que já tem rescisão formal, ou o contrário).
- **Gatilho semanal com ID de planilha fixo no código** — se a planilha de origem do Raio-X mudar de lugar/ID, o gatilho continua batendo na antiga até alguém perceber e editar o código.

## 9. Portais — inventário de telas

### Portal do DP (`DP360_PORTAL_DP`)
Tela única com sidebar de módulos: **Painel Geral** (quadro estilo Trello agregando pendências de todos os módulos), **Férias** (6 sub-abas: Fila, Calendário, Venda de dias, Prazos, Agendadas, Recibos — com um "KPI strip" de 12 métricas), **Afastamentos**, **Rescisão** (com sub-área de Homologação), **Trabalhista**, **Movimentações**, **Benefícios** — os últimos 5 só aparecem se o usuário tiver o módulo liberado. Recursos: busca global de colaborador + sino de notificações (ambos marcados "TESTE" no código, com instruções de remoção caso não sejam aprovados), modo escuro com 3 variantes, avatar escolhível (24 ícones, "TESTE"), atualização automática (polling de 60s) nas telas de Recibos e Homologação, e um "importar Raio-X" acessível direto do Painel Geral.

### Portal do Gestor (`DP360_PORTAL_GESTOR`)
Sidebar com: **Painel** (saudação + "o que precisa de você" + "em andamento" + resumo da equipe + atalhos), **Férias** (cartões por colaborador com selo de situação e modal de agendamento em 2 passos), **Afastamentos** (registrar, com sub-formulário completo de acidente de trabalho), **Rescisão** (solicitar desligamento + acompanhar em cartões com status em linguagem simples), **Movimentações** (solicitar mudança contratual, com alerta de divergência salarial), e **Admissão** (travado, "em breve"). 4 temas de cores (Claro/Cinza/Verde-azulado escuro/Preto). O escopo é sempre a própria equipe (`GESTOR_EMAIL`), mesmo pra quem tem perfil DP/ADMIN.

**⚠️ Achado importante:** a campanha de **Férias de Fim de Ano tem todo o código ainda presente neste portal, mas está desativada de propósito** (flags `CAMPANHA_SO_FIM_DE_ANO`/`LOCKDOWN_FIM_DE_ANO`, ambas sempre `false`) — a funcionalidade foi migrada pro portal separado `Ferias_Fim_de_Ano`. O bloco de tela correspondente fica forçado a escondido. Não é bug, é intencional — só documentar pra ninguém "redescobrir" e reativar por engano.

### Ferias_Fim_de_Ano (portal espelho, só a campanha de fim de ano)
Login (mesmo esquema de e-mail/senha/token) → tela única com aviso do prazo, link pro guia, e duas abas: **Pendentes** (quem ainda pode agendar) e **Solicitados** (quem já agendou) — clicar em "agendar" abre um modal com até 2 opções de data (variando por pessoa, conforme a regra dos 14 dias e o período aquisitivo dela). Ver documento específico já produzido sobre esse portal para mais detalhes (bug do OBS/OBSERVACAO, correção de performance, etc.).

### Guias estáticos (não falam com a API)
`GUIA_FERIAS_FIM_DE_ANO_WEB`, `Guia_de_Afastamento`, `Guia_de_Movimentacoes` — páginas de FAQ/explicação em linguagem simples, cada uma com seções fixas e um accordion de perguntas frequentes. Conteúdo já cobre boa parte do que viraria "manual de uso" — o manual de uso (documento separado) reaproveita essa mesma linguagem.

## 10. Incidentes conhecidos e correções (histórico útil pra manutenção futura)

1. **Coluna "OBS" vs "OBSERVACAO" (SOLICITACOES, férias fim de ano):** o código sempre escreveu/leu `OBSERVACAO`, mas a coluna real se chama `OBS`. A marcação `FIM_DE_ANO_2026` nunca era gravada — ninguém saía da lista de pendentes nem aparecia como "solicitado". Corrigido em `Ferias.js`.
2. **Sincronização antiga de usuários com coluna faltando:** contas em `USUARIOS` criadas por uma versão antiga de `sincronizarUsuariosAPartirDaMaster()` (marca `ORIGEM = 'DP360_MASTER.GESTORES'`) ficaram com `CARGO/PERFIL/ATIVO/DOMINIO/PODE_LOGAR/ORIGEM` desalinhados uma casa pra esquerda — afetou 37 de 71 usuários. Travava login silenciosamente. **Se alguém relatar "não consigo logar" com senha certa, confira primeiro se `ATIVO` tem cara de domínio de e-mail em vez de "Sim"/"Não".**
3. **`deleteDocument` do Autentique não bloqueia assinatura** — ver seção 7.
4. **Extensão `.pdf` vazando na comparação de nome exato** (homologação/TRCT) — corrigido.

## 11. Fluxo de deploy e boas práticas operacionais

- **Conta de deploy:** `autodppessoal@cieds.org.br` (conta de serviço, dona de todos os projetos) — nunca conta pessoal. Confirmar sempre antes de publicar.
- **Antes de qualquer `clasp push`:** puxar o conteúdo ao vivo pra uma pasta separada e comparar (`diff`) contra o que vai ser publicado — os projetos são editados manualmente, ao vivo, por outras pessoas.
- **`clasp push` só atualiza o "HEAD"** — a URL `/exec` de produção fica presa numa versão publicada (`clasp deploy -i <deploymentId>`) até novo deploy.
- **Rodar função avulsa sem UI:** criar uma função `teste*` comum no editor e rodar "▶ Executar", lendo o resultado em "Registro de execução" — mais simples e confiável que o truque de `doGet` com token. **Sempre remover o código temporário depois.**
- **Performance:** a arquitetura de "portal espelho" custa uma segunda execução de Apps Script em toda ação — mitigado onde possível com cache (`CacheService`, 5 min) e empacotando dados que costumavam vir em chamadas separadas numa única ida à rede (ex.: login + primeira lista, no fim de ano).
- **Saída de log grande:** `console.log` de JSON grande trunca ("Logging output too large") — resumir/agrupar dentro da função em vez de despejar tudo.
