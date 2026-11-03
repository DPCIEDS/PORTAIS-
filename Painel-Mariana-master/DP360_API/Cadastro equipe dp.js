function cadastrarPessoaDP() {
  var email = "karlacarvalho.rj@cieds.org.br";
  var nome  = "Karla Cristine Carvalho";
  var perfil = "DP";
  var modulos = "FERIAS, AFASTAMENTOS";

  var r1 = cadastrarUsuarioManual(email, nome, perfil);
  Logger.log("Cadastro: " + r1);

  var r2 = definirModulos(email, modulos);
  Logger.log("Módulos: " + r2);

  return "Pronto. Agora " + nome + " pode fazer o primeiro acesso no portal.";
}