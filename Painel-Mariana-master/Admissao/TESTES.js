function verificarPastaDrive() {
  const pastaRaiz = _getPastaRaiz_();

  Logger.log("ID DA PASTA RAIZ: " + pastaRaiz.getId());
  Logger.log("LINK DA PASTA RAIZ: " + pastaRaiz.getUrl());

  const pastaColaborador = DriveApp.getFolderById(
    "1Gy2n9c55AUJueLCmNqRoI5EDWt53GpeI"
  );

  const pais = pastaColaborador.getParents();

  while (pais.hasNext()) {
    const pai = pais.next();
    Logger.log("ID DA PASTA PAI: " + pai.getId());
    Logger.log("NOME DA PASTA PAI: " + pai.getName());
  }
}
