/**
 * Seletores das telas do Conectividade Social V2 e do SICSE.
 *
 * Se a CAIXA mudar a tela, só este arquivo precisa ser ajustado.
 * Para capturar seletores novos:  npm run mapear
 *
 * Status:
 *   MAPEADO    -> capturado das telas reais em 26/11/2026
 *   PROVISÓRIO -> ainda não visto na tela real; confirmar no primeiro teste
 */
import type { Locator, Page } from 'playwright';

export type SeletorTela = (page: Page) => Locator;

export interface Seletores {
  urlInicial: string;
  /** URL do SICSE (sistema antigo onde ficam outorgante e extrato). */
  urlSicse: RegExp;

  // --- Conectividade Social V2 (sicns) ---
  /** Botão "Empregador" da tela inicial: ao clicar, o site pede o certificado. */
  menuEmpregador: SeletorTela;
  /** Diálogo que pode aparecer depois de escolher o certificado. */
  manterCertificadoLogado: SeletorTela;
  /** Selectbox de serviços do Conectividade: só aparece com o certificado aceito. */
  comboServicosEmpregador: SeletorTela;

  /** Comandos (parte do value depois do "|") das opções dos selectbox de serviço. */
  servicoOutorgante: string;
  servicoExtrato: string;

  // --- SICSE: acessar empresa outorgante ---
  outorganteCampoInscricao: SeletorTela;
  outorganteBotaoContinuar: SeletorTela;
  /** Selectbox "Selecione aqui o serviço desejado" do topo das telas do SICSE. */
  sicseComboServicos: SeletorTela;

  // --- SICSE: localizar trabalhador ---
  sicseRegiao: SeletorTela;
  sicseCampoNome: SeletorTela;
  sicseCampoNis: SeletorTela;
  sicseBotaoPesquisar: SeletorTela;

  // --- SICSE: extrato ---
  extratoVisualizarImpressao: SeletorTela;
}

export const seletoresPadrao: Seletores = {
  urlInicial: 'https://conectividadesocialv2.caixa.gov.br/sicns/',
  urlSicse: /sicse\.caixa\.gov\.br/,

  menuEmpregador: p => p.getByRole('button', { name: 'Empregador' }), // MAPEADO
  manterCertificadoLogado: p => p.getByRole('button', { name: 'Manter Certificado Logado' }), // MAPEADO
  comboServicosEmpregador: p => p.getByRole('combobox'), // MAPEADO

  servicoOutorgante: 'AcessarOutorgante.Verificar', // MAPEADO "32|AcessarOutorgante.Verificar" = Acessar Empresa Outorgante
  servicoExtrato: 'ExtratoFgts.AcessarBaseConta', // MAPEADO "24|ExtratoFgts.AcessarBaseConta" = Solicitar Extrato do Trabalhador

  // MAPEADO (validado em 26/11/2026): primeiro campo de texto da tela e botão de imagem "CONTINUAR"
  outorganteCampoInscricao: p => p.locator('form input[type="text"]:visible').first(),
  outorganteBotaoContinuar: p => p.locator('a:has(img[src*="botao_continuar"])').first(),
  sicseComboServicos: p =>
    p.locator('select').filter({ has: p.locator('option', { hasText: 'Selecione aqui o serviço' }) }), // MAPEADO

  sicseRegiao: p => p.locator('select[name="sltRegiao"]'), // MAPEADO
  sicseCampoNome: p => p.locator('input[name="txtNomeTrab"]'), // MAPEADO
  sicseCampoNis: p => p.locator('input[name="txtNumPisPasep"]'), // MAPEADO
  // botão "CONTINUAR" (imagem dentro de <a href="javascript:subm_localizar_trabalhador();">)
  sicseBotaoPesquisar: p => p.locator('a[href*="subm_localizar_trabalhador"]'), // MAPEADO

  // MAPEADO (validado em 26/11/2026): link/botão "Visualizar Impressão" da tela do extrato
  extratoVisualizarImpressao: p =>
    p
      .locator(
        [
          'a:has(img[src*="impress" i])',
          'a:has(img[alt*="impress" i])',
          'a:has-text("Visualizar Impress")',
          'input[type="button"][value*="mpress" i]',
          'input[type="image"][src*="impress" i]',
          'button:has-text("Impress")',
        ].join(', '),
      )
      .first(),
};
