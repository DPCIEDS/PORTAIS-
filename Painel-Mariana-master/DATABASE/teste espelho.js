function mostrarLinkEspelhoChecklist() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('DP360_CHECKLIST_ESPELHO_ID');

  if (!id) {
    throw new Error(
      'A planilha espelho ainda não foi criada ou o ID não está salvo nas propriedades do script.'
    );
  }

  const ss = SpreadsheetApp.openById(id);
  const url = ss.getUrl();

  Logger.log('PLANILHA ESPELHO: ' + url);

  try {
    SpreadsheetApp.getUi().alert(
      'Planilha espelho',
      url,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {}

  return url;
}