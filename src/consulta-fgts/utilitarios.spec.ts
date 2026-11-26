import {
  converterMoedaBR,
  mascararNis,
  nomeCompleto,
  nomesConferem,
  normalizarNis,
  nomeArquivoPdf,
  normalizarNome,
  textoContemNome,
  validarInscricao,
  validarNis,
  validarUf,
} from './utilitarios';

describe('utilitarios', () => {
  describe('validarNis', () => {
    it('aceita NIS com dígito verificador correto, com ou sem pontuação', () => {
      expect(validarNis('12345678900')).toBe(true);
      expect(validarNis('123.45678.90-0')).toBe(true);
    });

    it('recusa dígito verificador errado', () => {
      expect(validarNis('12345678901')).toBe(false);
    });

    it('recusa tamanho errado, vazio e dígitos repetidos', () => {
      expect(validarNis('1234567890')).toBe(false);
      expect(validarNis('')).toBe(false);
      expect(validarNis(undefined)).toBe(false);
      expect(validarNis('11111111111')).toBe(false);
    });
  });

  it('normalizarNis remove tudo que não é dígito', () => {
    expect(normalizarNis(' 123.45678.90-0 ')).toBe('12345678900');
  });

  describe('converterMoedaBR', () => {
    it.each([
      ['R$ 15.432,87', 15432.87],
      ['R$ 0,00', 0],
      ['1.000.000,5', 1000000.5],
      ['R$ -12,30', -12.3],
    ])('%s -> %d', (texto, esperado) => {
      expect(converterMoedaBR(texto)).toBe(esperado);
    });

    it('texto sem número vira NaN', () => {
      expect(converterMoedaBR('indisponível')).toBeNaN();
      expect(converterMoedaBR(null)).toBeNaN();
    });
  });

  describe('nomes', () => {
    it('normalizarNome tira acento, caixa e espaços extras', () => {
      expect(normalizarNome('  José  da Conceição ')).toBe('JOSE DA CONCEICAO');
    });

    it('nomeCompleto exige pelo menos duas palavras', () => {
      expect(nomeCompleto('Maria Souza')).toBe(true);
      expect(nomeCompleto('Maria')).toBe(false);
      expect(nomeCompleto('')).toBe(false);
    });

    it('nomesConferem ignora acento e caixa', () => {
      expect(nomesConferem('José da Conceição', 'JOSE DA CONCEICAO')).toBe(true);
    });

    it('nomesConferem recusa nomes diferentes, parciais ou vazios', () => {
      expect(nomesConferem('Maria Souza', 'Maria Souza Lima')).toBe(false);
      expect(nomesConferem('Maria Souza', 'Mario Souza')).toBe(false);
      expect(nomesConferem('', '')).toBe(false);
    });
  });

  describe('textoContemNome', () => {
    const tela = 'Extrato do Trabalhador\nNome: THAMIRYS GONÇALVES VILHENA MONTEIRO  PIS: 203.70954.63-1';

    it('acha o nome completo no texto da tela, ignorando acento e caixa', () => {
      expect(textoContemNome(tela, 'Thamirys Goncalves Vilhena Monteiro')).toBe(true);
    });

    it('não aceita nome diferente nem pedaço de palavra', () => {
      expect(textoContemNome(tela, 'Thamirys Goncalves Monteiro')).toBe(false);
      expect(textoContemNome('ANA MARIA SOUZAS', 'Maria Souza')).toBe(false);
      expect(textoContemNome(tela, '')).toBe(false);
    });
  });

  it('validarInscricao aceita CPF, CEI e CNPJ (só tamanho)', () => {
    expect(validarInscricao('768.490.903-72')).toBe(true);
    expect(validarInscricao('123456789012')).toBe(true);
    expect(validarInscricao('06.108.495/0001-53')).toBe(true);
    expect(validarInscricao('123')).toBe(false);
    expect(validarInscricao('00000000000000')).toBe(false);
  });

  it('validarUf aceita sigla de 2 letras', () => {
    expect(validarUf('ce')).toBe(true);
    expect(validarUf('CEA')).toBe(false);
  });

  it('nomeArquivoPdf gera nome seguro', () => {
    expect(nomeArquivoPdf('Thamirys Gonçalves / Vilhena')).toBe('THAMIRYS GONCALVES VILHENA.pdf');
  });

  it('mascararNis esconde o miolo do NIS', () => {
    expect(mascararNis('12345678900')).toBe('123.*****.90-0');
    expect(mascararNis('123')).toBe('***');
  });
});
