/**
 * Funções puras (testáveis sem navegador).
 */

export function normalizarNis(nis: unknown): string {
  return String(nis ?? '').replace(/\D/g, '');
}

/** Valida NIS/PIS/PASEP: 11 dígitos + dígito verificador (módulo 11). */
export function validarNis(nis: unknown): boolean {
  const n = normalizarNis(nis);
  if (!/^\d{11}$/.test(n) || /^(\d)\1{10}$/.test(n)) return false;

  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((acc, peso, i) => acc + peso * Number(n[i]), 0);
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(n[10]);
}

/** "R$ 15.432,87" -> 15432.87  |  texto sem número -> NaN */
export function converterMoedaBR(texto: unknown): number {
  const limpo = String(texto ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return limpo === '' || limpo === '-' ? NaN : Number(limpo);
}

/** "  José da   Silva " -> "JOSE DA SILVA" (sem acento, maiúsculo, espaços simples) */
export function normalizarNome(nome: unknown): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome completo: pelo menos duas palavras. */
export function nomeCompleto(nome: unknown): boolean {
  return normalizarNome(nome).split(' ').filter(Boolean).length >= 2;
}

/**
 * Confere se o nome devolvido pelo SICSE é o mesmo trabalhador pedido.
 * Comparação exata depois de normalizar (acentos, caixa, espaços): é melhor
 * recusar uma consulta do que devolver o saldo de outra pessoa.
 */
export function nomesConferem(esperado: unknown, encontrado: unknown): boolean {
  const a = normalizarNome(esperado);
  return a !== '' && a === normalizarNome(encontrado);
}

/**
 * Confere se o nome completo aparece no texto da tela (ex.: o extrato).
 * Compara palavra a palavra, depois de normalizar, para não aceitar
 * "MARIA SOUZA" dentro de "ANA MARIA SOUZAS".
 */
export function textoContemNome(texto: unknown, nome: unknown): boolean {
  const alvo = normalizarNome(nome);
  if (!alvo) return false;
  return ` ${normalizarNome(texto)} `.includes(` ${alvo} `);
}

/** Inscrição do outorgante: CPF (11), CEI (12) ou CNPJ (14) dígitos. */
export function validarInscricao(inscricao: unknown): boolean {
  const n = normalizarNis(inscricao);
  return [11, 12, 14].includes(n.length) && !/^(\d)\1+$/.test(n);
}

export function normalizarUf(uf: unknown): string {
  return String(uf ?? '').trim().toUpperCase();
}

export function validarUf(uf: unknown): boolean {
  return /^[A-Z]{2}$/.test(normalizarUf(uf));
}

/** "Thamirys Gonçalves" -> "THAMIRYS GONCALVES.pdf" (seguro para nome de arquivo no Windows) */
export function nomeArquivoPdf(nome: unknown): string {
  const base = normalizarNome(nome) || 'TRABALHADOR';
  return `${base}.pdf`;
}

/** Evita expor o NIS completo nos logs (LGPD): 123.*****.90-0 */
export function mascararNis(nis: unknown): string {
  const n = normalizarNis(nis);
  return n.length === 11 ? `${n.slice(0, 3)}.*****.${n.slice(8, 10)}-${n[10]}` : '***';
}
