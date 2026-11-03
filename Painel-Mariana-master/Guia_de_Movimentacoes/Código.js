/*************************************************************************************************
 * GUIA DA MOVIMENTAÇÃO · CIEDS — mini web app
 * -----------------------------------------------------------------------------------------------
 * Projeto Apps Script INDEPENDENTE. Não fala com a API, não acessa planilha.
 * Serve só uma página: o Guia da Movimentação, colorido, em qualquer navegador.
 *
 * PUBLICAR:
 *   1) Cole os 2 arquivos: Codigo.gs e Guia.html
 *   2) Implantar > Nova implantação > App da Web
 *        Executar como: EU · Acesso: QUALQUER PESSOA
 *   3) Copie a URL /exec — é ela que vai em MOV.GUIA_URL, no topo do MOVIMENTACOES.gs
 *
 * ATUALIZAR o guia depois: edite o Guia.html > Salvar > Implantar > Gerenciar > nova versão.
 * A URL continua a mesma.
 *************************************************************************************************/

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Guia')
    .setTitle('Guia da Movimentação · CIEDS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}