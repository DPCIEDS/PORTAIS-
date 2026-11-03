/**
 * [2026-10-21] CANCELAR ADMISSÃO
 * Menu "Admissão" > "Cancelar admissão (registrar em Cancelados)": escolhe uma ou mais pessoas da
 * aba BASE, informa o motivo e cada uma ganha uma linha na aba Cancelados (Nome, Email, Posto de
 * Trabalho, Departamento, Motivo, Observação e "Cancelado em").
 *
 * [2026-10-21] Na BASE, a célula do nome de quem é registrado (ou já estava em Cancelados) fica com
 * fundo #e06666 (pedido da Taynara).
 *
 * A pessoa continua na BASE, como nos cancelamentos feitos à mão: a CHECKLIST_ADMISSAO aponta para
 * as linhas da BASE (apagar uma linha quebraria as fórmulas) e o lembrete do formulário já deixa de
 * fora quem está em Cancelados. Quem já está em Cancelados (mesmo nome, ou mesmo e-mail com nome
 * compatível) não é registrado de novo. As colunas são achadas pelo nome do cabeçalho.
 * Só usa serviços que o projeto já usava (planilha, menu, diálogo): não pede autorização nova.
 */

const CANC_ADM = {
  ABA: 'Cancelados',
  COL_DATA: 'Cancelado em', // criada no fim do cabeçalho no primeiro uso
  COR_BASE: '#e06666'       // fundo da célula do nome na aba BASE
};

function abrirCancelarAdmissao() {
  const html = HtmlService.createHtmlOutputFromFile('CancelarAdmissaoDialogo').setWidth(700).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Cancelar admissão');
}

/** Aba Cancelados, seus valores e o índice (0-based) de cada coluna usada. */
function _cancAdmAba_(ss) {
  const aba = ss.getSheetByName(CANC_ADM.ABA);
  if (!aba) throw new Error('Aba ' + CANC_ADM.ABA + ' não encontrada.');
  const valores = aba.getDataRange().getValues();
  const col = _ex10Mapa_(valores[0] || []);
  const c = {
    nome: col('Nome'),
    email: col('Email') > -1 ? col('Email') : col('E-mail'),
    posto: col('Posto de Trabalho'),
    departamento: col('Departamento'),
    motivo: col('Motivo'),
    obs: col('Observação'), // há duas "Observação": vale a primeira
    data: col(CANC_ADM.COL_DATA)
  };
  if (c.nome < 0) throw new Error('Coluna "Nome" não encontrada na aba ' + CANC_ADM.ABA + '.');
  if (c.motivo < 0) throw new Error('Coluna "Motivo" não encontrada na aba ' + CANC_ADM.ABA + '.');
  return { aba: aba, valores: valores, c: c };
}

/** Quem já está em Cancelados: nomes normalizados e e-mails (com o nome, para conferir). */
function _cancAdmJaCancelados_(k) {
  const nomes = {}, emails = {};
  for (let i = 1; i < k.valores.length; i++) {
    const nome = String(k.valores[i][k.c.nome] || '').trim();
    if (!nome) continue;
    nomes[_ex10NomeN_(nome)] = true;
    const email = k.c.email > -1 ? String(k.valores[i][k.c.email] || '').trim().toLowerCase() : '';
    if (email) (emails[email] = emails[email] || []).push(nome);
  }
  return { nomes: nomes, emails: emails };
}

function _cancAdmEstaCancelado_(ja, nome, email) {
  if (ja.nomes[_ex10NomeN_(nome)]) return true;
  const outros = ja.emails[String(email || '').trim().toLowerCase()] || [];
  return outros.some(function (n) { return _ex10NomesCompativeis_(nome, n); });
}

/** Para a janela: pessoas da BASE, datas de admissão e os motivos já usados em Cancelados. */
function cancAdmListar() {
  const b = _envioFormLerBase_();
  const col = _ex10Mapa_(b.valores[0]);
  const cDep = col('Departamento'), cCpf = col('CPF');
  const k = _cancAdmAba_(b.ss);
  const ja = _cancAdmJaCancelados_(k);

  const pessoas = [], porData = {};
  for (let i = 1; i < b.valores.length; i++) {
    const r = b.valores[i];
    const nome = String(r[b.c.NOME] || '').trim();
    if (!nome) continue;
    const email = String(r[b.c.EMAIL] || '').trim();
    const iso = _envioFormIso_(r[b.c.ADMISSAO], b.tz);
    if (iso) porData[iso] = (porData[iso] || 0) + 1;
    pessoas.push({
      linha: i + 1, nome: nome, email: email,
      posto: b.c.FUNCAO > -1 ? String(r[b.c.FUNCAO] || '').trim() : '',
      departamento: cDep > -1 ? String(r[cDep] || '').trim() : '',
      cpf: cCpf > -1 ? String(r[cCpf] || '').trim() : '',
      iso: iso, admissao: iso ? _envioFormBr_(iso) : '',
      cancelado: _cancAdmEstaCancelado_(ja, nome, email)
    });
  }

  const contagem = {};
  for (let i = 1; i < k.valores.length; i++) {
    const m = String(k.valores[i][k.c.motivo] || '').trim();
    if (m && m.length <= 120) contagem[m] = (contagem[m] || 0) + 1;
  }
  const motivos = Object.keys(contagem).sort(function (a, z) { return contagem[z] - contagem[a] || a.localeCompare(z); });

  return {
    pessoas: pessoas,
    datas: Object.keys(porData).sort().map(function (iso) { return { iso: iso, br: _envioFormBr_(iso), total: porData[iso] }; }),
    motivos: motivos
  };
}

/** Coluna "Cancelado em": se não existir, entra na primeira coluna livre depois do cabeçalho. */
function _cancAdmColunaData_(k) {
  if (k.c.data > -1) return k.c.data;
  const cab = k.valores[0] || [];
  let ultimoCab = -1;
  cab.forEach(function (h, j) { if (String(h || '').trim()) ultimoCab = j; });
  let j = ultimoCab + 1;
  const vazia = function (col) {
    for (let i = 1; i < k.valores.length; i++) if (String(k.valores[i][col] == null ? '' : k.valores[i][col]).trim()) return false;
    return true;
  };
  while (j < cab.length && !vazia(j)) j++; // não põe o título em cima de coluna que já tem dados
  const alvo = k.aba.getRange(1, j + 1);
  alvo.setValue(CANC_ADM.COL_DATA);
  if (ultimoCab > -1) k.aba.getRange(1, ultimoCab + 1).copyTo(alvo, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  k.c.data = j;
  return j;
}

/**
 * Registra o cancelamento. itens = [{ linha, nome }] da BASE (a linha é conferida pelo nome, para o
 * caso de a BASE ter mudado com a janela aberta). Devolve quem foi registrado, quem já estava em
 * Cancelados e o que não deu certo.
 */
function cancAdmRegistrar(itens, motivo, observacao) {
  motivo = String(motivo || '').trim();
  observacao = String(observacao || '').trim();
  if (!motivo) throw new Error('Informe o motivo do cancelamento.');
  if (!Array.isArray(itens) || !itens.length) throw new Error('Escolha pelo menos uma pessoa.');

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Há outra operação em andamento nesta planilha. Aguarde e tente de novo.');
  try {
    const b = _envioFormLerBase_();
    const col = _ex10Mapa_(b.valores[0]);
    const cDep = col('Departamento');
    const k = _cancAdmAba_(b.ss);
    const ja = _cancAdmJaCancelados_(k);

    const registrados = [], pulados = [], erros = [], novas = [], vistos = {}, pintar = [];
    itens.forEach(function (it) {
      const linha = Number(it && it.linha);
      const nomeJanela = String((it && it.nome) || '').trim();
      const r = linha >= 2 ? b.valores[linha - 1] : null;
      if (!r || _ex10NomeN_(r[b.c.NOME]) !== _ex10NomeN_(nomeJanela)) {
        erros.push({ nome: nomeJanela || '(sem nome)', motivo: 'a aba BASE mudou com a janela aberta; feche e abra de novo' });
        return;
      }
      const nome = String(r[b.c.NOME]).trim(), email = String(r[b.c.EMAIL] || '').trim();
      const chave = _ex10NomeN_(nome);
      if (vistos[chave] || _cancAdmEstaCancelado_(ja, nome, email)) {
        if (!vistos[chave]) pintar.push(linha); // já estava em Cancelados: o nome fica vermelho também
        pulados.push(nome);
        return;
      }
      vistos[chave] = true;
      pintar.push(linha);
      novas.push({
        nome: nome, email: email,
        posto: b.c.FUNCAO > -1 ? String(r[b.c.FUNCAO] || '').trim() : '',
        departamento: cDep > -1 ? String(r[cDep] || '').trim() : ''
      });
      registrados.push(nome);
    });

    if (novas.length) {
      const cData = _cancAdmColunaData_(k);
      const usadas = [k.c.nome, k.c.email, k.c.posto, k.c.departamento, k.c.motivo, k.c.obs, cData].filter(function (x) { return x > -1; });
      const largura = Math.max.apply(null, usadas) + 1;
      // Escreve logo depois da última linha com algo nas colunas usadas (há valores soltos mais à direita).
      let ultima = 1;
      for (let i = 1; i < k.valores.length; i++) {
        for (let j = 0; j < largura; j++) {
          if (String(k.valores[i][j] == null ? '' : k.valores[i][j]).trim()) { ultima = i + 1; break; }
        }
      }
      const agora = new Date();
      const linhas = novas.map(function (p) {
        const l = new Array(largura).fill('');
        l[k.c.nome] = p.nome;
        if (k.c.email > -1) l[k.c.email] = p.email;
        if (k.c.posto > -1) l[k.c.posto] = p.posto;
        if (k.c.departamento > -1) l[k.c.departamento] = p.departamento;
        l[k.c.motivo] = motivo;
        if (k.c.obs > -1) l[k.c.obs] = observacao;
        l[cData] = agora;
        return l;
      });
      k.aba.getRange(ultima + 1, 1, linhas.length, largura).setValues(linhas);
      k.aba.getRange(ultima + 1, cData + 1, linhas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    }
    // Na BASE, só o fundo da célula do nome muda (depois de gravar em Cancelados).
    pintar.forEach(function (linha) { b.aba.getRange(linha, b.c.NOME + 1).setBackground(CANC_ADM.COR_BASE); });
    SpreadsheetApp.flush();
    return { registrados: registrados, pulados: pulados, erros: erros };
  } finally {
    lock.releaseLock();
  }
}
