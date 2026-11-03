function verMeuSegredo() {
  var s = PropertiesService.getScriptProperties().getProperty('API_SEGREDO');
  console.log('tamanho: ' + (s ? s.length : 'VAZIO') + ' | início: ' + (s ? s.slice(0, 8) : '-') + ' | fim: ' + (s ? s.slice(-8) : '-'));
}