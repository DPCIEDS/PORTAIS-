# DP360 — Manual de Uso (rascunho de trabalho)

## Como o sistema é organizado

O DP360 tem **três portais separados** e **três páginas de ajuda**. Cada pessoa usa o portal certo pro seu papel:

- **Portal do Gestor** — pra quem lidera uma equipe: pede férias, registra afastamentos, solicita desligamentos e movimentações da própria equipe.
- **Portal do DP** — pra quem trabalha no Departamento Pessoal: recebe e decide tudo que os gestores enviam, mais ferramentas de gestão (financeiro, benefícios, indicadores).
- **Portal de Férias de Fim de Ano** — só durante a campanha de fim de ano (setembro a outubro), pra agendar as duas datas fixas de dezembro.
- **Guias de ajuda** (Férias de Fim de Ano, Afastamento, Movimentações) — páginas só de leitura, com explicações e perguntas frequentes, sem precisar logar.

Login em qualquer portal: e-mail institucional + senha. Primeiro acesso ou esqueceu a senha? O link "É meu primeiro acesso ou esqueci a senha" leva pro mesmo lugar — pede um código de 6 dígitos por e-mail e cria a senha na hora (mínimo 8 caracteres, com maiúscula, minúscula e número).

---

## Portal do Gestor

### Painel (tela inicial)
Assim que você entra, vê uma saudação e quatro blocos:
- **"O que precisa de você"** — pendências que exigem uma ação sua agora (agendar férias, aplicar um desligamento, etc.).
- **"Em andamento"** — o que você já enviou e está esperando o DP decidir, com prazo de resposta e opção de cancelar.
- **"Seu time"** — números rápidos da sua equipe.
- **Atalhos** — um card pra cada módulo disponível pra você.

### Férias
1. Escolha o colaborador na lista (dá pra filtrar por status: Toda a equipe / Disponíveis / Aguardando o DP / Confirmadas, ou buscar por nome).
2. Clique em **"Agendar"** no card da pessoa.
3. Escolha a data de início e a quantidade de dias — o sistema avisa na hora se a data ou a quantidade não são permitidas (dia da semana bloqueado, saldo insuficiente, regra dos 14 dias).
4. Confira o resumo e envie. O prazo de resposta do DP aparece na tela.
5. Pra cancelar uma solicitação que ainda está pendente, use o botão "cancelar" no histórico da pessoa.

### Afastamentos
1. Clique em **"+ Registrar afastamento"**.
2. Escolha o colaborador, o tipo de afastamento, a data de início e a quantidade de dias. CID é opcional.
3. Anexe o atestado (PDF ou foto).
4. Se o afastamento passar de 15 dias, o sistema já avisa que vai entrar no fluxo do INSS automaticamente.
5. **Se for acidente de trabalho**, marque a caixinha correspondente — isso abre campos extras (tipo do acidente, data/hora, local, parte lesionada, relato). O sistema vai gerar automaticamente um rascunho de RAT e avisar o técnico de segurança.

### Rescisão
1. Clique em **"+ Nova solicitação"**.
2. Escolha o colaborador e o tipo de desligamento (pedido de demissão, sem/com justa causa, término de contrato, comum acordo, entre outros).
3. Escolha se quer que o **DP entre em contato** com o colaborador ou se você mesmo vai aplicar o desligamento.
4. Se o tipo exigir carta de demissão, baixe o modelo, colha a assinatura e anexe de volta.
5. Acompanhe cada caso pelo card — o texto mostra em linguagem simples onde o processo está ("Solicitação enviada ao DP", "Pronto pra você aplicar", etc.). Clique em "Ver processo" pra mais detalhes, ou "Cancelar" enquanto ainda estiver como "Solicitação enviada".

### Movimentações
1. Clique em **"+ Nova movimentação"**.
2. Escolha o colaborador e o tipo: transferência de departamento, troca de turno, carga horária, cargo, salário, ou pagamento de um "adicional" avulso.
3. Informe a competência (mês/ano) em que a mudança deve começar.
4. **Se pedir uma mudança de salário que fugir muito do praticado no departamento**, o sistema vai pedir confirmação explícita com uma justificativa antes de deixar enviar.
5. Trocar pra turno noturno gera automaticamente um segundo pedido (inclusão do adicional noturno) — não precisa fazer nada além disso, o sistema cuida.
6. O pedido passa primeiro pelo RH, depois pelo DP — acompanhe pelo card, que mostra ajustes feitos pelo RH (se houver) e o motivo, se for recusado.

### Configurações
Ícone de engrenagem na barra lateral — escolha entre os temas Claro, Cinza neutro, Verde-azulado escuro ou Preto. Um ícone de sol/lua na barra lateral alterna rapidamente entre claro e o último escuro escolhido.

---

## Portal do DP

### Painel Geral
Um quadro com uma coluna por módulo que você tem acesso, cada card sendo uma pendência clicável que leva direto pra tela certa. Tem um botão "Importar Raio-X" pra atualizar o cadastro de colaboradores a partir da planilha exportada da folha de pagamento.

### Férias — 6 abas
- **Fila**: pedidos dos gestores esperando sua decisão. "Confirmar" aprova, "Não" recusa (com justificativa, que vai por e-mail pro gestor). O botão "memória" mostra o cálculo detalhado do valor (salário, adicional noturno, 1/3 constitucional, venda de dias, descontos).
- **Calendário**: previsão de custo mês a mês, com barra de progresso contra um teto configurável (clique em "editar" pra mudar o teto de um mês).
- **Venda de dias**: pedidos de abono pecuniário esperando confirmação, mais um botão pra você mesmo registrar um pedido em nome de qualquer colaborador.
- **Prazos**: quem já perdeu o prazo legal (viraria pagamento em dobro) e quem está a menos de 60 dias de perder.
- **Agendadas**: férias já aprovadas — selecione uma ou mais e envie em lote pro financeiro, anexando os documentos necessários.
- **Recibos**: controle da assinatura do recibo de férias via Autentique. Sub-abas Pendentes / Prontos para envio / Enviados / Assinados. **"Cancelar envio" é irreversível** — o documento é apagado do Autentique de vez.

### Afastamentos
Acompanhe cada caso pelas sub-abas (Em atestado, Encaminhados INSS, Prorrogados, Aguardando retorno, Encerrados). Ações: agendar perícia, registrar a decisão do INSS, prorrogar (quando o INSS estende o afastamento), registrar o exame ocupacional de retorno, e confirmar o retorno ao trabalho.

### Rescisão
Sub-abas: Solicitadas → Agendadas → Compareceram/Exame → Conciliação → Arquivados, mais **Homologação** como uma área própria.
- Agende o comparecimento, registre se a pessoa compareceu, marque (ou dispense, com justificativa) o exame demissional, e confirme o desligamento.
- Na Conciliação: anexe a rescisão calculada, confirme os valores (TRCT líquido + FGTS), envie pro financeiro, depois pro Autentique pra assinatura.
- **Homologação**: mesmo padrão da tela de Recibos (Pendentes / Prontos para envio / Enviadas / Assinadas), com busca por nome e envio/download em lote. **"Cancelar envio" também é irreversível aqui.**
- Botão "+ Nova rescisão" no topo permite ao DP abrir um caso pra qualquer colaborador da empresa, não só os que os gestores enviaram. "+ Rescisão complementar" é pra registrar manualmente um caso antigo/retroativo, só pra manter os indicadores corretos.

### Trabalhista
Acompanhamento de pagamentos de FGTS/INSS determinados por processo judicial ou acordo. "+ Novo processo" registra o caso; depois é só marcar "Pagar FGTS"/"Pagar INSS" quando cada um for feito, anexando o comprovante.

### Movimentações
Fila de "Aguardando o DP" (já aprovadas pelo RH) — clique em "Decidir" pra aprovar (informando em qual competência de folha vai entrar) ou reprovar (com motivo).

### Benefícios
- **Calcular**: escolha competência, fornecedor e tipo de benefício, informe os dias úteis por estado, e calcule.
- **Lotes importados**: importe o que foi pedido ao fornecedor e o que ele confirmou, cada um a partir de uma planilha preparada.
- **Conciliar**: compare pedido x relatório do fornecedor e veja divergências.
- **Regras**: valor por departamento, importado de uma planilha.

### Busca global e notificações (topo da tela)
Digite qualquer nome no campo de busca pra achar um colaborador ou pular direto pra uma seção. O sino mostra quantos itens urgentes estão pendentes no momento.

### Configurações
Escolha de tema (mesmas opções do Portal do Gestor) e um avatar (ícone de rosto) puramente decorativo.

---

## Portal de Férias de Fim de Ano

Só fica disponível durante a janela da campanha (setembro a outubro, dependendo do ano). Login com o mesmo e-mail/senha do resto do sistema.

1. Depois de entrar, você vê a lista de colaboradores da sua equipe que podem agendar (aba **Pendentes**).
2. Clique em **"agendar"** no nome da pessoa.
3. Escolha uma das opções de data mostradas (variam por pessoa, respeitando a regra dos 14 dias corridos e quando cada um tem direito).
4. Clique em **"Enviar ao DP"**.
5. A pessoa some da aba Pendentes e passa pra aba **Solicitados**, com a data confirmada.

Cada pessoa só pode escolher **uma única data** nessa campanha — depois de agendada, não aparece mais pra reagendar.

Dúvidas sobre as regras (a fração de 14 dias, quem pode participar, o que acontece depois de agendar)? Tem um botão **"Guia de Férias de Fim de Ano"** na própria tela, que abre uma página só de leitura com tudo explicado, incluindo perguntas frequentes.

---

## Guias de ajuda (consulta livre, sem login)

### Guia de Férias de Fim de Ano
Explica as duas datas fixas de dezembro, quem pode participar, a regra dos 14 dias corridos (com exemplo numérico), o passo a passo de como agendar, o que acontece depois (confirmação ou ajuste pedido pelo DP), e um FAQ com 4 perguntas comuns.

### Guia de Afastamento
Explica os três caminhos de um afastamento (até 15 dias / mais de 15 dias com INSS / acidente de trabalho), a regra dos 15 dias, o que fazer em caso de acidente (RAT/CAT), o passo a passo de como registrar, o que acontece depois de registrar, e um FAQ com 6 perguntas (atestado curto, dúvida se é acidente, diferença entre RAT e CAT, foto por WhatsApp, prorrogação, quem é avisado).

### Guia de Movimentações
Explica os seis tipos de movimentação, como funciona a aprovação em duas etapas (RH → DP), os três desfechos possíveis (aprovado / reprovado pelo RH / reprovado pelo DP), as três conferências automáticas do sistema (salário, cargo inédito, turno noturno), e um FAQ com 4 perguntas (o que é "competência de início", se dá pra cancelar, por que um pedido de salário foi bloqueado, quando chega a confirmação por e-mail).

---

## Perguntas frequentes gerais

**Esqueci minha senha, e agora?**
Na tela de login, clique em "É meu primeiro acesso ou esqueci a senha" — é o mesmo caminho pros dois casos. Você recebe um código por e-mail e cria uma senha nova.

**Errei a senha várias vezes e agora não consigo mais tentar.**
Depois de 5 tentativas erradas, o acesso fica bloqueado por 15 minutos. Se continuar bloqueado depois disso, fale com o suporte técnico — o desbloqueio manual precisa ser feito por quem administra o sistema.

**Cancelei uma ação sem querer, dá pra desfazer?**
Cancelamentos de solicitações (férias, rescisão, movimentação) só são possíveis enquanto o pedido ainda está pendente — depois que o DP começa a decidir, fale direto com o Departamento Pessoal.

**"Cancelar envio" em Recibos/Homologação é reversível?**
Não — o documento é apagado do Autentique e não tem volta. Se precisar reenviar, é preciso fazer um novo envio do zero.
