/**
 * [2026-10-05] Nome da pessoa como deve aparecer nos e-mails ("Prezado(a) ...").
 * A aba BASE às vezes guarda anotações do DP junto do nome (ex.: "NATHALIA MARTINS DE ASSIS POSTO
 * MIGRADO"), e essas anotações iam parar no e-mail enviado ao candidato. Todos os e-mails de exame
 * e de pendência passam o nome por aqui antes de montar o texto.
 */
function nomeParaEmail_(nome) {
  return String(nome == null ? '' : nome)
    .replace(/\s*\([^)]*\)/g, ' ')              // "(anotação)"
    .replace(/\s+[-–—]\s+.*$/, '')               // "NOME - anotação"
    .replace(/\bPOSTO\s+MIGRAD[OA]S?\b/gi, ' ')  // "POSTO MIGRADO"
    .replace(/\s+MIGRAD[OA]S?\s*$/i, '')         // "MIGRADO" solto no fim
    .replace(/\s+/g, ' ')
    .trim();
}

/** O mesmo ajuste dentro de assunto/corpo já montados numa aba (envio de ASO da leva sexta). */
function textoSemAnotacaoNome_(texto) {
  return String(texto == null ? '' : texto).replace(/[ \t]+POSTO\s+MIGRAD[OA]S?\b/gi, '');
}
