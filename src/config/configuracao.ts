/**
 * Configuração do robô lida do ambiente (.env), validada e tipada.
 * Usada tanto pela API (Nest) quanto pela linha de comando.
 */
export type Navegador = 'msedge' | 'chrome';
export type CertModo = 'windows' | 'pfx';

export interface Configuracao {
  navegador: Navegador;
  headless: boolean;
  certModo: CertModo;
  certPfxPath?: string;
  certPfxSenha?: string;
  pastaSaida: string;
  timeout: number;
  /** Espera (ms) pelo certificado depois de clicar em Empregador (tempo para escolher na janela). */
  timeoutCertificado: number;
  /** API HTTP */
  host: string;
  porta: number;
  /** Token que o portal envia em "Authorization: Bearer <token>". */
  token?: string;
}

export class ConfiguracaoInvalidaError extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Configuração inválida no .env:\n - ${problemas.join('\n - ')}`);
    this.name = 'ConfiguracaoInvalidaError';
  }
}

export const CONFIGURACAO = Symbol('CONFIGURACAO');

export function carregarConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const problemas: string[] = [];

  const navegador = (env.NAVEGADOR || 'msedge') as Navegador;
  if (!['msedge', 'chrome'].includes(navegador)) {
    problemas.push(`NAVEGADOR deve ser "msedge" ou "chrome" (recebido "${navegador}")`);
  }

  const certModo = (env.CERT_MODO || 'windows') as CertModo;
  if (!['windows', 'pfx'].includes(certModo)) {
    problemas.push(`CERT_MODO deve ser "windows" ou "pfx" (recebido "${certModo}")`);
  }
  if (certModo === 'pfx' && !env.CERT_PFX_PATH) {
    problemas.push('CERT_PFX_PATH é obrigatório quando CERT_MODO=pfx');
  }

  const timeout = inteiro(env.TIMEOUT, 30000, 'TIMEOUT', problemas);
  const timeoutCertificado = inteiro(env.TIMEOUT_CERTIFICADO, 120000, 'TIMEOUT_CERTIFICADO', problemas);
  const porta = inteiro(env.PORTA, 3100, 'PORTA', problemas);

  if (problemas.length) throw new ConfiguracaoInvalidaError(problemas);

  return {
    navegador,
    headless: env.HEADLESS !== 'false',
    certModo,
    certPfxPath: env.CERT_PFX_PATH || undefined,
    certPfxSenha: env.CERT_PFX_SENHA || undefined,
    pastaSaida: env.PASTA_SAIDA || './saida',
    timeout,
    timeoutCertificado,    host: env.HOST || '127.0.0.1',
    porta,
    token: env.ROBO_TOKEN || undefined,
  };
}

function inteiro(valor: string | undefined, padrao: number, nome: string, problemas: string[]): number {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    problemas.push(`${nome} deve ser um número inteiro positivo (recebido "${valor}")`);
    return padrao;
  }
  return n;
}
