import { ConfiguracaoInvalidaError, carregarConfiguracao } from './configuracao';

describe('carregarConfiguracao', () => {
  it('usa padrões seguros com ambiente vazio', () => {
    expect(carregarConfiguracao({})).toMatchObject({
      navegador: 'msedge',
      headless: true,
      certModo: 'windows',
      timeout: 30000,
      timeoutCertificado: 120000,
      host: '127.0.0.1',
      porta: 3100,
      token: undefined,
    });
  });

  it('lê os valores do .env', () => {
    const c = carregarConfiguracao({ HEADLESS: 'false', TIMEOUT: '60000', TIMEOUT_CERTIFICADO: '90000', ROBO_TOKEN: 'abc' });
    expect(c).toMatchObject({ headless: false, timeout: 60000, timeoutCertificado: 90000, token: 'abc' });
  });

  it('lista todos os problemas de uma vez', () => {
    try {
      carregarConfiguracao({ NAVEGADOR: 'firefox', CERT_MODO: 'pfx', TIMEOUT: 'abc' });
      fail('deveria ter lançado erro');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfiguracaoInvalidaError);
      expect((e as ConfiguracaoInvalidaError).problemas).toHaveLength(3);
    }
  });
});
