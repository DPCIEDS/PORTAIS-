/**

 * CADASTRO DE ADMISSÃO — CIEDS (web app standalone)

 * Backend: recebe o formulário, salva os documentos no Drive e grava uma linha na planilha.

 * Não escreve no MASTER nem depende do kernel do DP360.

 *

 * Publicar: Implantar > Nova implantação > App da Web

 *   Executar como: EU (dono)

 *   Quem tem acesso: Qualquer pessoa

 * A planilha e a pasta raiz são criadas automaticamente no 1º envio (IDs guardados em Script Properties).

 */



const CONFIG = {

  APP_TITULO: 'Cadastro de Admissão — CIEDS',

  NOME_PASTA_RAIZ: 'Admissões — Cadastros',

  NOME_PLANILHA: 'ADMISSOES_CADASTROS',

  ABA: 'CADASTROS',

  ABA_CONTRATUAIS: 'DADOS_CONTRATUAIS',

  PROP_PASTA: 'ADM_PASTA_RAIZ_ID',

  PROP_PLANILHA: 'ADM_PLANILHA_ID',

  MAX_BYTES_ARQUIVO: 8 * 1024 * 1024, // 8MB por arquivo (após decodificar)



  // [2026-09-30] Carta de abertura de conta salário no Santander (ver _enviarCartaSantander_).

  ABA_BASE: 'BASE',                                                   // aba da DATABASE com nome, e-mail, função, salário e admissão

  CARTA_MODELO_ID: '15PEcDEPk2muKLTDD5Pq4GttjeWhwb39r8byHKV5ynpE',   // Google Docs no Drive da autodppessoal, com {{NOME}}, {{CPF}}...

  CARTA_COLUNA: 'Carta Santander',                                    // coluna da aba CADASTROS com o resultado do envio

  CARTA_TESTE_EMAIL: 'taynarasilva.rj@cieds.org.br,taynarasilva2411@gmail.com' // destinos da carta de exemplo de testarCartaSantander()

};



// [2026-09-30] Anexos obrigatórios: [campo do arquivo, nome mostrado, condição].

// Sem condição = sempre obrigatório. Tem que bater com docAplica() no Index.html.

const DOCS_OBRIGATORIOS = [

  ['Foto', 'Foto digital recente'],

  ['Carteira de Trabalho', 'Carteira de Trabalho'],

  ['Documento de identidade', 'Carteira de identidade (RG)'],

  ['Documento de identidade - verso', 'Verso da carteira de identidade', 'rgVerso'],

  ['CPF', 'Comprovante de situação cadastral do CPF'],

  ['PIS NIS', 'Declaração do PIS/NIS'],

  ['Nada consta INSS', 'Declaração de Nada Consta / Benefícios do INSS'],

  ['Titulo de eleitor', 'Título de eleitor'],

  ['Reservista', 'Certificado de reservista', 'masculino'],

  ['Certidao civil', 'Certidão de nascimento, casamento ou união estável'],

  ['Comprovante de residencia', 'Comprovante de residência'],

  ['Comprovante de escolaridade', 'Comprovante de escolaridade', 'escolaridade'],

  ['Nada consta Bilhete Unico', 'Nada Consta Bilhete Único / RioCard', 'riocard'],

  ['Comprovante bancário', 'Comprovante da conta bancária', 'temBanco']

];



function _docsObrigatorios_(dados) {

  return DOCS_OBRIGATORIOS.filter(function (d) {

    if (d[2] === 'rgVerso') return dados.rgVersoSeparado === 'Sim';

    if (d[2] === 'masculino') return dados.sexo === 'Masculino';

    if (d[2] === 'riocard') return dados.vtQuer === 'Sim' && /riocard/i.test(String(dados.vtTipos || ''));

    // [2026-10-01] Escolaridade: obrigatório para cursando, completo e pós-graduação; opcional se incompleto.

    // [2026-10-01] Comprovante bancário: só para quem informou um banco (sem conta = Banco vazio).

    if (d[2] === 'temBanco') return String(dados.banco || '').trim() !== '';

    if (d[2] === 'escolaridade') { const g = String(dados.grauInstrucao || ''); return !!g && !/incompleto/i.test(g); }

    return true;

  });

}



// [2026-09-30] Carta do Santander: quem não é Santander recebe a carta (ver CartaSantander.js).

const CARTA_NAO_SE_APLICA = 'Não se aplica (Santander)';



function _ehSantander_(banco) {

  const b = _normCabecalho_(banco).replace(/[^a-z0-9]/g, '');

  return b.indexOf('santand') > -1 || b.indexOf('santader') > -1 || b === '33' || b === '033';

}



// Campos do formulário e o nome da coluna de cada um na aba CADASTROS.

// [2026-09-25] A ordem aqui NÃO precisa ser a da planilha: cada valor é gravado na coluna cujo

// cabeçalho tem esse nome (ver _linhaPorCabecalho_). A ordem só vale para criar a aba do zero.

const CAMPOS = [

  ['nomeCompleto', 'Nome completo'],

  ['nomeSocial', 'Nome social'],

  ['dataNascimento', 'Data de nascimento'],

  ['sexo', 'Sexo (eSocial)'],

  ['estadoCivil', 'Estado civil'],

  ['nacionalidade', 'Nacionalidade'],

  ['naturalidadeCidade', 'Naturalidade (cidade)'],

  ['naturalidadeUF', 'Naturalidade (UF)'],

  ['racaCor', 'Raça/Cor (eSocial)'],

  ['grauInstrucao', 'Grau de instrução'],

  ['nomeMae', 'Nome da mãe'],

  ['nomePai', 'Nome do pai'],

  ['cpf', 'CPF'],

  ['rgNumero', 'RG'],

  ['rgOrgao', 'RG — órgão emissor'],

  ['rgUF', 'RG — UF'],

  ['rgEmissao', 'RG — data de emissão'],

  ['pisPasep', 'PIS/PASEP/NIT'],

  ['tituloEleitor', 'Título de eleitor'],

  ['tituloZona', 'Título — zona'],

  ['tituloSecao', 'Título — seção'],

  ['ctpsDigital', 'CTPS — digital?'],

  ['ctpsNumero', 'CTPS — número'],

  ['ctpsSerie', 'CTPS — série'],

  ['ctpsUF', 'CTPS — UF'],

  ['reservista', 'Certificado de reservista'],

  ['cnhNumero', 'CNH — número'],

  ['cnhCategoria', 'CNH — categoria'],

  ['cnhValidade', 'CNH — validade'],

  ['emailPessoal', 'E-mail pessoal'],

  ['celular', 'Celular/WhatsApp'],

  ['telefoneRecado', 'Telefone recado'],

  ['cep', 'CEP'],

  ['logradouro', 'Logradouro'],

  ['numero', 'Número'],

  ['complemento', 'Complemento'],

  ['bairro', 'Bairro'],

  ['cidade', 'Cidade'],

  ['uf', 'UF'],

  ['banco', 'Banco'],

  ['agencia', 'Agência'],

  ['conta', 'Conta'],

  ['tipoConta', 'Tipo de conta'],

  ['pix', 'Chave PIX'],

  ['vtQuer', 'Vale-transporte — deseja?'],

  ['vtTipos', 'VT — tipo (Jaé/RioCard)'],

  ['vtTotalDia', 'VT — total diário (R$)'],

  ['vtRiocardNumero', 'VT — número do RioCard'],

  ['vtRiocardSemCartao', 'VT — sem RioCard (solicitar novo)'],

  ['vtCienteDesvinculo', 'VT — ciente da desvinculação do cartão anterior']

];



const COLUNAS_EXTRA = [

  'Dependentes (legível)',

  'Dependentes (JSON)',

  'VT — trechos (legível)',

  'VT — trechos (JSON)',

  'Documentos anexados',

  'Consentimento LGPD',

  'Protocolo',

  'Data/hora do envio',

  'Status',

  'Pasta no Drive',

  'Carta Santander'

];



function doGet() {

  return HtmlService.createTemplateFromFile('Index')

    .evaluate()

    .setTitle(CONFIG.APP_TITULO)

    .addMetaTag('viewport', 'width=device-width, initial-scale=1')

    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

}



/**

 * Chamado pelo formulário via google.script.run.

 * payload = { dados: {...}, dependentes: [...], arquivos: [{campo, nome, tipo, base64}] }

 */

function processarCadastro(payload) {

  const res = _gravarCadastro_(payload);

  // [2026-09-30] A carta do Santander sai depois de soltar a trava: leva alguns segundos e,

  // se falhar, o cadastro já está gravado (o motivo fica na coluna Carta Santander).

  // Sem o arquivo CartaSantander.js no projeto, a coluna fica PENDENTE e reenviarCartasSantander()

  // manda depois.

  if (res.ok && res._carta && typeof _enviarCartaSantander_ === 'function') {

    res.cartaSantander = _enviarCartaSantander_(res._carta.dados, res.protocolo, res._carta.pastaId).enviada;

  }

  delete res._carta;

  return res;

}



function _gravarCadastro_(payload) {

  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    const dados = (payload && payload.dados) || {};

    const dependentes = (payload && payload.dependentes) || [];

    const vtTrechos = (payload && payload.vtTrechos) || [];

    const arquivos = (payload && payload.arquivos) || [];


    // [2026-10-01] VALE-TRANSPORTE
    // Se não deseja VT, nenhum valor/detalhe é aceito nem gravado.
    // Se deseja VT, o total diário não pode ultrapassar R$ 10,00.
    if (dados.vtQuer !== 'Sim') {
      dados.vtQuer = 'Não';
      dados.vtTipos = '';
      dados.vtTotalDia = '';
      dados.vtRiocardNumero = '';
      dados.vtRiocardSemCartao = '';
      dados.vtCienteDesvinculo = '';
      vtTrechos.length = 0;
    } else {
      const tipoVT = String(dados.vtTipos || '').trim();

      if (tipoVT !== 'Jaé' && tipoVT !== 'RioCard') {
        throw new Error(
          'Vale-transporte: selecione apenas uma opção, Jaé ou RioCard.'
        );
      }

      // [2026-10-02] RioCard: número obrigatório, a não ser "Não tenho cartão RioCard"; ciência obrigatória.
      if (tipoVT === 'RioCard') {
        if (dados.vtRiocardSemCartao === 'Sim') dados.vtRiocardNumero = '';
        else if (!String(dados.vtRiocardNumero || '').trim()) {
          throw new Error('Vale-transporte: informe o número do cartão RioCard ou marque "Não tenho cartão RioCard".');
        }
        if (dados.vtCienteDesvinculo !== 'Sim') {
          throw new Error('Vale-transporte: confirme que leu a orientação sobre a vinculação do cartão RioCard.');
        }
      }

      let totalVTServidor = 0;

      vtTrechos.forEach(function (t) {
        // Valor do VT é fixo: R$ 5,00 por sentido.
        // Ignora qualquer tentativa de alteração enviada pelo navegador.
        t.ida = '5,00';
        t.volta = '5,00';
        totalVTServidor += 10;
      });

      if (totalVTServidor > 10.005) {
        throw new Error(
          'Vale-transporte: o total diário não pode ultrapassar R$ 10,00.'
        );
      }

      dados.vtTotalDia = totalVTServidor
        ? totalVTServidor.toFixed(2).replace('.', ',')
        : '0,00';
    }



    // [2026-09-30] Todos os anexos são obrigatórios; alguns dependem do que foi respondido.

    const anexados = {};

    arquivos.forEach(function (a) { if (a && a.campo && a.base64) anexados[String(a.campo)] = true; });

    const faltantes = _docsObrigatorios_(dados)

      .filter(function (d) { return !anexados[d[0]]; })

      .map(function (d) { return d[1]; });

    if (faltantes.length) {

      throw new Error('Anexe os documentos obrigatórios: ' + faltantes.join('; ') + '.'); // "; ": a tela mostra em lista

    }



    // Validações no servidor: somente os dados obrigatórios do eSocial

    // que existem neste formulário bloqueiam o envio.

    if (dados.consentLGPD !== 'Sim') {

      throw new Error('É necessário autorizar o tratamento dos dados (LGPD).');

    }



    const obrigatoriosESocial = [

      ['nomeCompleto', 'Nome completo'],

      ['cpf', 'CPF'],
      ['estadoCivil', 'Estado civil'],          // [2026-10-02]
      ['nomeMae', 'Nome da mãe'],              // [2026-10-02]
      ['rgNumero', 'RG'],                     // [2026-10-01] pedido da Taynara
      // [2026-10-05] Título de eleitor deixou de ser obrigatório (pedido da Taynara); se vier preenchido, o formato é conferido abaixo.

      ['dataNascimento', 'Data de nascimento'],

      ['sexo', 'Sexo'],

      ['racaCor', 'Raça/Cor'],

      ['grauInstrucao', 'Grau de instrução'],

      ['nacionalidade', 'Nacionalidade'],

      ['cep', 'CEP'],

      ['logradouro', 'Logradouro'],

      ['numero', 'Número'],

      ['cidade', 'Cidade'],

      ['uf', 'UF'],

      ['emailPessoal', 'E-mail pessoal'],

      ['celular', 'Celular/WhatsApp']

    ];



    const faltantesESocial = obrigatoriosESocial

      .filter(function(c) { return !String(dados[c[0]] || '').trim(); })

      .map(function(c) { return c[1]; });



    if (faltantesESocial.length) {

      throw new Error('Preencha os campos obrigatórios para a admissão: ' + faltantesESocial.join('; ') + '.');

    }



    // [2026-10-02] Formatos (iguais aos da tela).
    const formatos = [];
    if (!_cpfValido_(dados.cpf)) formatos.push('CPF');
    if (!_celularValido_(dados.celular)) formatos.push('Celular/WhatsApp (DDD e 9 dígitos)');
    if (String(dados.cep || '').replace(/\D/g, '').length !== 8) formatos.push('CEP (8 números)');
    const probNasc = _problemaNascimento_(dados.dataNascimento);
    if (probNasc) formatos.push('Data de nascimento (' + probNasc + ')');
    if (String(dados.tituloEleitor || '').trim() && !_tituloValido_(dados.tituloEleitor)) formatos.push('Título de eleitor');
    const sugEmail = _sugestaoEmail_(dados.emailPessoal);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(dados.emailPessoal || '').trim())) formatos.push('E-mail pessoal');
    else if (sugEmail) formatos.push('E-mail pessoal (você quis dizer ' + sugEmail + '?)');
    ['uf', 'naturalidadeUF', 'rgUF', 'ctpsUF'].forEach(function (k) {
      const v = String(dados[k] || '').trim().toUpperCase();
      if (v && UFS_BRASIL.indexOf(v) < 0) formatos.push('UF inválida: ' + v);
    });
    if (formatos.length) {
      throw new Error('Corrija os campos obrigatórios com formato inválido: ' + formatos.join('; ') + '.');
    }

    // [2026-10-01] Só aceitamos conta no Santander: Banco é "Santander" ou vazio (sem conta no Santander).
    if (String(dados.banco || '').trim() && !_ehSantander_(dados.banco)) {
      throw new Error('Banco: aceitamos somente conta no Santander. Se você não tem conta no Santander, marque "Não tenho conta no Santander".');
    }

    // [2026-10-02] Com conta no Santander, Agência, Conta e Tipo são obrigatórios.
    if (String(dados.banco || '').trim()) {
      const faltaConta = [['agencia', 'Agência'], ['conta', 'Conta'], ['tipoConta', 'Tipo de conta']]
        .filter(function (c) { return !String(dados[c[0]] || '').trim(); })
        .map(function (c) { return c[1]; });
      if (faltaConta.length) {
        throw new Error('Preencha os campos obrigatórios da conta no Santander: ' + faltaConta.join('; ') + '.');
      }
    }

    // [2026-10-01] CPF dos dependentes: obrigatório e válido, diferente do titular e sem repetir.

    const problemasDep = [];

    const vistosDep = {};

    // [2026-10-02] Todos os campos do dependente e a documentação são obrigatórios.
    const hojeIso = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
    dependentes.forEach(function (d, i) {
      d = d || {};
      const p = [];
      const nomeDep = String(d.nome || '').trim();
      if (!nomeDep) p.push('nome não informado');
      if (!String(d.parentesco || '').trim()) p.push('parentesco não informado');
      const nasc = String(d.nascimento || '').trim();
      if (!nasc) p.push('data de nascimento não informada');
      else if (nasc > hojeIso) p.push('data de nascimento no futuro');
      const probCpf = _problemaCpfDependente_(d.cpf, dados.cpf, vistosDep);
      if (probCpf) p.push(probCpf);
      if (!anexados['Dependente - ' + nomeDep + ' - documentação']) {
        p.push('documentação do dependente não anexada'); // [2026-10-02] obrigatória para todo dependente
      }
      if (p.length) problemasDep.push('Dependente ' + (i + 1) + (nomeDep ? ' (' + nomeDep + ')' : '') + ': ' + p.join(', '));
    });
    if (problemasDep.length) {
      throw new Error('Corrija os dados dos dependentes: ' + problemasDep.join('; ') + '.');
    }



    // [2026-10-02] Certificado de reservista só vale para sexo masculino.
    if (dados.sexo !== 'Masculino') dados.reservista = '';

    // CTPS digital: quando informada, o CPF é utilizado como número.

    if (dados.ctpsDigital === 'Sim') {

      dados.ctpsNumero = String(dados.cpf || '').replace(/\D/g, '');

      dados.ctpsSerie = '';

      dados.ctpsUF = '';

    }



    const pastaRaiz = _getPastaRaiz_();

    const planilha = _getPlanilha_();

    const aba = planilha.getSheetByName(CONFIG.ABA);

    // [2026-10-02] A mesma pessoa não pode enviar duas vezes (mesmo CPF já na aba CADASTROS).
    if (_linhaDoCpf_(aba, dados.cpf, '')) {
      throw new Error('Já recebemos um cadastro com este CPF. Não é preciso enviar de novo. Se precisar corrigir algum dado, fale com o Departamento de Pessoal: dp@cieds.org.br ou (21) 2544-4516.');
    }



    const protocolo = _gerarProtocolo_();

    const carimbo = new Date();

    const cpfLimpo = String(dados.cpf).replace(/\D/g, '');

    const nomePasta = (dados.nomeCompleto + ' - ' + cpfLimpo + ' - ' + protocolo).slice(0, 180);

    const pastaCand = pastaRaiz.createFolder(nomePasta);

    pastaCand.setDescription('Cadastro de admissão — ' + dados.nomeCompleto);



    // Salvar documentos.

    const nomesArquivos = [];

    arquivos.forEach(function (a) {

      if (!a || !a.base64) return;

      const bytes = Utilities.base64Decode(a.base64);

      if (bytes.length > CONFIG.MAX_BYTES_ARQUIVO) {

        throw new Error('O arquivo "' + (a.nome || a.campo) + '" excede o limite de 8MB.');

      }

      const nomeFinal = (a.campo ? a.campo + ' - ' : '') + (a.nome || 'documento');

      const blob = Utilities.newBlob(bytes, a.tipo || 'application/octet-stream', nomeFinal);

      const arq = pastaCand.createFile(blob);

      nomesArquivos.push(nomeFinal);

    });



    // Dependentes legível + JSON.

    const depLegivel = dependentes.map(function (d) {

      return (d.nome || '') + ' (' + (d.parentesco || '') + ', nasc. ' + (d.nascimento || '') +

        ', CPF ' + (d.cpf || '') + ', IR: ' + (d.dependenteIR || 'Não') +

        ', Sal.família: ' + (d.salarioFamilia || 'Não') + ')';

    }).join(' | ');



    // Trechos do VT legível.

    const vtTrechosLegivel = vtTrechos.map(function (t) {

      return (t.descricao || 'Trecho') + ': ida R$ ' + (t.ida || '0') + ' / volta R$ ' + (t.volta || '0');

    }).join(' | ');



    // [2026-09-25] Monta a linha pelo NOME de cada coluna, não pela posição. Em 23/09 colunas da

    // aba CADASTROS foram reordenadas na planilha (Nacionalidade/Naturalidade, E-mail

    // pessoal/CNH — validade) e, como a linha era gravada por posição, esses valores caíram

    // trocados em todos os cadastros seguintes.

    const valores = CAMPOS.map(function (c) { return [c[1], dados[c[0]] != null ? dados[c[0]] : '']; });

    const extras = [

      depLegivel,

      JSON.stringify(dependentes),

      vtTrechosLegivel,

      JSON.stringify(vtTrechos),

      nomesArquivos.join(' | '),

      dados.consentLGPD || 'Não',

      protocolo,

      carimbo,

      'PENDENTE',

      pastaCand.getUrl(),

      _ehSantander_(dados.banco) ? CARTA_NAO_SE_APLICA : 'PENDENTE'

    ];

    COLUNAS_EXTRA.forEach(function (nome, i) { valores.push([nome, extras[i]]); });



    aba.appendRow(_linhaPorCabecalho_(aba, valores));



    // Alimenta a aba operacional do DP com protocolo + nome.

    // As demais colunas ficam para preenchimento manual.

    _registrarDadosContratuais_(planilha, protocolo, dados.nomeCompleto);



    return {

      ok: true, protocolo: protocolo, pastaUrl: pastaCand.getUrl(),

      _carta: _ehSantander_(dados.banco) ? null : { dados: dados, pastaId: pastaCand.getId() }

    };

  } catch (err) {

    return { ok: false, erro: String(err && err.message ? err.message : err) };

  } finally {

    lock.releaseLock();

  }

}



// [2026-10-02] Formatos. Iguais aos do Index.html (celularValido, tituloValido, problemaNascimento, sugestaoEmail).
const UFS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const DDDS_BRASIL = [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44,
  45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99];

function _celularValido_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 13 && d.indexOf('55') === 0) d = d.slice(2);
  return d.length === 11 && DDDS_BRASIL.indexOf(Number(d.slice(0, 2))) > -1 && d[2] === '9';
}

function _tituloValido_(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 13 && (d.slice(9, 11) === '01' || d.slice(9, 11) === '02')) return true; // títulos antigos de SP/MG
  if (d.length !== 12 || /^(\d)\1+$/.test(d)) return false;
  const uf = Number(d.slice(8, 10));
  if (uf < 1 || uf > 28) return false;
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(d[i]) * (i + 2);
  let dv1 = s % 11; if (dv1 === 10) dv1 = 0; if ((uf === 1 || uf === 2) && dv1 === 0) dv1 = 1;
  let dv2 = (Number(d[8]) * 7 + Number(d[9]) * 8 + dv1 * 9) % 11; if (dv2 === 10) dv2 = 0; if ((uf === 1 || uf === 2) && dv2 === 0) dv2 = 1;
  return dv1 === Number(d[10]) && dv2 === Number(d[11]);
}

/** '' se a data (aaaa-mm-dd) é plausível; senão o motivo. */
function _problemaNascimento_(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'data inválida';
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  if (s > hoje) return 'no futuro';
  let idade = Number(hoje.slice(0, 4)) - Number(m[1]);
  if (hoje.slice(5) < s.slice(5)) idade--;
  if (idade < 14) return 'idade mínima 14 anos';
  if (idade > 100) return 'confira o ano';
  return '';
}

const EMAIL_DOMINIOS_ERRADOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmil.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmeil.com': 'gmail.com', 'gmsil.com': 'gmail.com', 'gemail.com': 'gmail.com',
  'gimail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.com.br': 'gmail.com', 'gmail.combr': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hotamil.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com', 'homail.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'hotmail.com.b': 'hotmail.com.br', 'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outloo.com': 'outlook.com',
  'outlook.co': 'outlook.com', 'outlook.com.b': 'outlook.com.br', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com', 'yahho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.com.b': 'yahoo.com.br',
  'yahoo.combr': 'yahoo.com.br', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com',
  'bol.com': 'bol.com.br', 'uol.com': 'uol.com.br'
};

/** Sugestão de correção para erro comum de digitação no e-mail ('' se não parece erro). */
function _sugestaoEmail_(v) {
  const e = String(v == null ? '' : v).trim().toLowerCase();
  const i = e.lastIndexOf('@');
  if (i < 0) return '';
  const usuario = e.slice(0, i), dom = e.slice(i + 1);
  if (EMAIL_DOMINIOS_ERRADOS[dom]) return usuario + '@' + EMAIL_DOMINIOS_ERRADOS[dom];
  const fim = dom.match(/\.(con|cpm|cmo|comm|coom|cm|om|vom|xom)$/);
  if (fim) return usuario + '@' + dom.slice(0, dom.length - fim[0].length) + '.com';
  return '';
}

/** Linha (valores) da aba CADASTROS com este CPF (e, se informada, esta data de nascimento); null se não há. */
function _linhaDoCpf_(aba, cpf, dataNascimento) {
  const alvo = String(cpf == null ? '' : cpf).replace(/\D/g, '');
  if (!alvo || aba.getLastRow() < 2) return null;
  const valores = aba.getDataRange().getValues();
  const cab = valores[0].map(_normCabecalho_);
  const cCpf = cab.indexOf(_normCabecalho_('CPF'));
  const cNasc = cab.indexOf(_normCabecalho_('Data de nascimento'));
  if (cCpf < 0) return null;
  const alvo11 = ('00000000000' + alvo).slice(-11);
  const isoDe = function (v) {
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const s = String(v == null ? '' : v).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return br ? br[3] + '-' + br[2] + '-' + br[1] : s.slice(0, 10);
  };
  for (let i = 1; i < valores.length; i++) {
    const d = String(valores[i][cCpf] == null ? '' : valores[i][cCpf]).replace(/\D/g, '');
    if (!d || ('00000000000' + d).slice(-11) !== alvo11) continue;
    if (dataNascimento && cNasc > -1 && isoDe(valores[i][cNasc]) !== String(dataNascimento).trim()) continue;
    return valores[i];
  }
  return null;
}

/**
 * Chamado pela tela ao sair do passo 3: diz se já existe cadastro com este CPF E esta data de
 * nascimento (os dois juntos, para não revelar a quem não sabe a data se um CPF tem cadastro).
 */
function verificarCadastroExistente(cpf, dataNascimento) {
  try {
    if (!String(dataNascimento || '').trim()) return { jaCadastrado: false };
    const aba = _getPlanilha_().getSheetByName(CONFIG.ABA);
    return { jaCadastrado: !!_linhaDoCpf_(aba, cpf, dataNascimento) };
  } catch (e) {
    return { jaCadastrado: false };
  }
}

/** CPF válido pelos dígitos verificadores (mesma regra do formulário). */

/**
 * Converte valor monetário do VT para número.
 * Aceita formatos como 10,00 / 10.00 / R$ 10,00.
 */
function _valorVTNumero_(v) {
  const s = String(v == null ? '' : v)
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  if (!s) return 0;

  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error('Vale-transporte: foi informado um valor inválido.');
  }
  return n;
}


function _cpfValido_(v) {

  const d = String(v == null ? '' : v).replace(/\D/g, '');

  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  let s = 0;

  for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);

  let r = (s * 10) % 11; if (r === 10) r = 0;

  if (r !== Number(d[9])) return false;

  s = 0;

  for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);

  r = (s * 10) % 11; if (r === 10) r = 0;

  return r === Number(d[10]);

}



/** '' se o CPF do dependente está ok; senão o motivo. vistos guarda os CPFs já usados. */

function _problemaCpfDependente_(cpfDep, cpfTitular, vistos) {

  const dig = String(cpfDep == null ? '' : cpfDep).replace(/\D/g, '');

  if (!dig) return 'CPF não informado';

  if (!_cpfValido_(dig)) return 'CPF inválido';

  if (dig === String(cpfTitular || '').replace(/\D/g, '')) return 'CPF igual ao do titular';

  if (vistos[dig]) return 'CPF repetido em outro dependente';

  vistos[dig] = true;

  return '';

}



/** Cabeçalho comparável: sem acento, sem diferença de maiúsculas e sem espaços extras

 *  (assim "Nome da mAe" na planilha casa com "Nome da mãe" no código). */

function _normCabecalho_(s) {

  return String(s == null ? '' : s)

    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    .replace(/\s+/g, ' ').trim().toLowerCase();

}



/**

 * Monta a linha a gravar colocando cada valor na coluna cujo cabeçalho (linha 1) tem o mesmo

 * nome. valores = [[nomeDaColuna, valor], ...]. Coluna que não existir na planilha é criada no

 * fim do cabeçalho, para nenhum dado se perder. Colunas da planilha que o formulário não

 * preenche ficam vazias, como antes.

 */

function _linhaPorCabecalho_(aba, valores) {

  const ultimaCol = Math.max(aba.getLastColumn(), 1);

  const cab = aba.getRange(1, 1, 1, ultimaCol).getValues()[0];

  const indice = {};

  cab.forEach(function (h, i) {

    const k = _normCabecalho_(h);

    if (k && !Object.prototype.hasOwnProperty.call(indice, k)) indice[k] = i;

  });



  let proxima = cab.length;

  const novos = [];

  valores.forEach(function (par) {

    const k = _normCabecalho_(par[0]);

    if (!Object.prototype.hasOwnProperty.call(indice, k)) {

      indice[k] = proxima++;

      novos.push(par[0]);

    }

  });

  if (novos.length) {

    aba.getRange(1, cab.length + 1, 1, novos.length).setValues([novos]).setFontWeight('bold');

  }



  let ultimaUsada = 0;

  valores.forEach(function (par) { ultimaUsada = Math.max(ultimaUsada, indice[_normCabecalho_(par[0])]); });

  const linha = [];

  for (let i = 0; i <= ultimaUsada; i++) linha.push('');

  valores.forEach(function (par) { linha[indice[_normCabecalho_(par[0])]] = par[1]; });

  return linha;

}



function _getPastaRaiz_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ADM_PASTA_RAIZ_ID');

  if (!id) {
    throw new Error('ID DA PASTA RAIZ NÃO CONFIGURADO!');
  }

  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error(
      'NÃO FOI POSSÍVEL ACESSAR A PASTA CONFIGURADA: ' + id +
      '. Verifique o ID e as permissões no Google Drive.'
    );
  }
}

function _getPlanilha_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(CONFIG.PROP_PLANILHA);
  let ss;

  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.NOME_PLANILHA);
    props.setProperty(CONFIG.PROP_PLANILHA, ss.getId());
  }

  let aba = ss.getSheetByName(CONFIG.ABA);

  if (!aba) {
    aba = ss.getSheets()[0];
    aba.setName(CONFIG.ABA);
  }

  if (aba.getLastRow() === 0) {
    const headers = CAMPOS.map(function (c) {
      return c[1];
    }).concat(COLUNAS_EXTRA);

    aba.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold');

    aba.setFrozenRows(1);
  }

  return ss;
}


/**
 * Garante a aba DADOS_CONTRATUAIS e inclui uma linha a cada cadastro concluído.
 * Automático: Protocolo + Nome completo. As demais colunas são do DP (manuais ou com fórmula).
 *
 * [2026-10-02] Tudo pelo NOME da coluna (antes era pela posição): não reescreve o cabeçalho,
 * só grava Protocolo e Nome completo, e as listas/formatos vão na coluna de mesmo nome. Coluna
 * esperada que faltar é criada no fim. Colunas com ARRAYFORMULA (Departamento, Função, Salário
 * Base, Data de Admissão) não são tocadas. A nova linha vai logo depois do último Protocolo.
 */
function _registrarDadosContratuais_(ss, protocolo, nomeCompleto) {
  const headers = [
    'Protocolo',
    'Nome completo',
    'Quantidade de dias do contrato de experiência',
    'Vínculo Trabalhista',
    'Categoria',
    'Empresa',
    'Departamento',
    'Função',
    'Salário Base',
    'Término do contrato'
  ];

  let sh = ss.getSheetByName(CONFIG.ABA_CONTRATUAIS);
  if (!sh) sh = ss.insertSheet(CONFIG.ABA_CONTRATUAIS);

  // Cabeçalho: lê o que existe e cria no fim só o que faltar (nunca sobrescreve).
  const ultCol = sh.getLastColumn();
  let cab = ultCol ? sh.getRange(1, 1, 1, ultCol).getValues()[0] : [];
  const abaNova = !cab.some(function (h) { return String(h).trim(); });
  if (abaNova) cab = [];
  const existentes = cab.map(_normCabecalho_);
  const faltam = headers.filter(function (h) { return existentes.indexOf(_normCabecalho_(h)) < 0; });
  if (faltam.length) {
    sh.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam])
      .setBackground('#18564A').setFontColor('#FFFFFF').setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    cab = cab.concat(faltam);
  }
  if (abaNova) {
    sh.setFrozenRows(1);
    sh.setHiddenGridlines(true);
    sh.setRowHeight(1, 42);
  }
  const normCab = cab.map(_normCabecalho_);
  const col = function (nome) { return normCab.indexOf(_normCabecalho_(nome)) + 1; }; // 1 = coluna A

  // Listas de seleção e formatos, na coluna de mesmo nome.
  const linhas = Math.max(sh.getMaxRows() - 1, 1);
  const lista = function (nome, valores, ajuda) {
    const c = col(nome);
    if (c > 0) {
      sh.getRange(2, c, linhas, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(valores, true).setAllowInvalid(false).setHelpText(ajuda).build());
    }
  };
  lista('Vínculo Trabalhista', ['Menor Aprendiz', 'Prazo Determinado', 'Padrão'], 'Selecione o tipo de vínculo trabalhista.');
  lista('Categoria', ['Estagiário', 'Menor Aprendiz', 'Trabalhador'], 'Selecione a categoria.');
  lista('Empresa', ['00001', '00013', '00019', '00002'], 'Selecione a empresa.');
  const formato = function (nome, f) {
    const c = col(nome);
    if (c > 0) sh.getRange(2, c, linhas, 1).setNumberFormat(f);
  };
  formato('Quantidade de dias do contrato de experiência', '0');
  formato('Salário Base', 'R$ #,##0.00');
  formato('Término do contrato', 'dd/mm/yyyy');

  // Nova linha: logo depois do último Protocolo preenchido. Não usa getLastRow(), que conta as
  // células preenchidas pelas fórmulas (ARRAYFORMULA) até o fim da planilha.
  const cProt = col('Protocolo'), cNome = col('Nome completo');
  let novaLinha = 2;
  const ultLin = sh.getLastRow();
  if (ultLin >= 2) {
    const prots = sh.getRange(2, cProt, ultLin - 1, 1).getValues();
    for (let i = prots.length - 1; i >= 0; i--) {
      if (String(prots[i][0]).trim()) { novaLinha = i + 3; break; }
    }
  }
  sh.getRange(novaLinha, cProt).setValue(protocolo);
  sh.getRange(novaLinha, cNome).setValue(nomeCompleto || '');
  sh.setRowHeight(novaLinha, 30);

  _filtroIncluiLinha_(sh, novaLinha);
}

/** Garante que o filtro da aba cubra a linha nova, mantendo os critérios que estavam aplicados. */
function _filtroIncluiLinha_(sh, linha) {
  const ultCol = sh.getLastColumn();
  const f = sh.getFilter();
  if (f) {
    const r = f.getRange();
    if (r.getLastRow() >= linha && r.getLastColumn() >= ultCol) return;
    const criterios = {};
    for (let c = r.getColumn(); c <= r.getLastColumn(); c++) {
      const cr = f.getColumnFilterCriteria(c);
      if (cr) criterios[c] = cr;
    }
    f.remove();
    const novo = sh.getRange(1, 1, Math.max(linha, r.getLastRow()), ultCol).createFilter();
    Object.keys(criterios).forEach(function (c) { novo.setColumnFilterCriteria(Number(c), criterios[c]); });
  } else if (linha >= 2) {
    sh.getRange(1, 1, linha, ultCol).createFilter();
  }
}

function _gerarProtocolo_() {

  const d = new Date();

  const p = function (n) { return String(n).padStart(2, '0'); };

  return 'ADM' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +

    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());

}



/** Utilitário opcional: devolve os links da planilha e da pasta raiz para o DP. */

function linksDoAdmin() {

  const ss = _getPlanilha_();

  const pasta = _getPastaRaiz_();

  Logger.log('Planilha: ' + ss.getUrl());

  Logger.log('Pasta: ' + pasta.getUrl());

  return { planilha: ss.getUrl(), pasta: pasta.getUrl() };

}
