import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from 'playwright';
import type { Configuracao } from '../config/configuracao';
import { seletoresPadrao, type Seletores } from './seletores';
import {
  mascararNis,
  nomeArquivoPdf,
  nomeCompleto,
  normalizarNis,
  normalizarUf,
  textoContemNome,
  validarInscricao,
  validarNis,
  validarUf,
} from './utilitarios';

const ORIGENS_CAIXA = ['https://conectividadesocialv2.caixa.gov.br', 'https://sicse.caixa.gov.br'];

/**
 * No SICSE, window.print vira no-op: a tela de impressão não pode abrir a janela
 * de impressão do Windows (travaria o robô); o PDF é gerado pelo próprio robô.
 *
 * Não emular attachEvent (IE): o SICSE usa a existência dele para detectar o
 * navegador e, com ele presente, a entrada da sessão falha em loop ("Error Servidor!").
 */
const AJUSTES_SICSE = `(() => {
  if (location.hostname !== 'sicse.caixa.gov.br') return;
  window.print = () => {};
})();`;

export type EtapaErro = 'validacao' | 'configuracao' | 'login' | 'navegacao' | 'outorgante' | 'consulta' | 'impressao';

export class ConsultaFgtsError extends Error {
  constructor(
    message: string,
    readonly etapa: EtapaErro,
    readonly screenshot: string | null = null,
  ) {
    super(message);
    this.name = 'ConsultaFgtsError';
  }
}

export type OpcoesRobo = Pick<
  Configuracao,
  'navegador' | 'headless' | 'certModo' | 'certPfxPath' | 'certPfxSenha' | 'pastaSaida' | 'timeout' | 'timeoutCertificado'
> & { seletores?: Partial<Seletores> };

export interface PedidoConsulta {
  /** NIS/PIS do trabalhador. */
  nis: string;
  /** Nome completo: conferido na tela do extrato e usado no nome do PDF. */
  nome: string;
  /** UF da Base da Conta (estado onde o trabalhador está vinculado), ex.: "CE". */
  uf: string;
  /** CNPJ/CEI/CPF da empresa outorgante (cliente). Vazio = consulta como a própria empresa do certificado. */
  inscricaoOutorgante?: string;
}

export interface ResultadoConsulta {
  nis: string;
  nome: string;
  uf: string;
  inscricaoOutorgante: string | null;
  /** Caminho do PDF do extrato. */
  pdf: string;
  consultadoEm: string;
}

/**
 * Robô de extrato FGTS no Conectividade Social V2 / SICSE.
 *
 * Fluxo:
 *  1. Tela inicial -> "Empregador" -> o site pede o certificado
 *  2. (com outorgante) serviço "Acessar Empresa Outorgante" -> CNPJ/CEI/CPF -> CONTINUAR
 *  3. serviço "Solicitar Extrato do Trabalhador"
 *  4. Base da Conta (UF) + PIS -> CONTINUAR
 *  5. Tela do extrato: confere o nome -> "Visualizar Impressão" -> salva o PDF em saida/<NOME>.pdf
 *
 * Uma instância = uma sessão de navegador.
 *  - um trabalhador:  await robo.consultar(pedido)
 *  - vários:          await robo.iniciar(); for (...) await robo.consultarExtrato(...); await robo.encerrar();
 */
export class ConsultaFgtsRobo {
  private readonly logger = new Logger(ConsultaFgtsRobo.name);
  private readonly seletores: Seletores;
  readonly pastaExecucao: string;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private portal: Page | null = null;
  private sicse: Page | null = null;
  private autenticado = false;
  private ultimoAlerta: string | null = null;

  constructor(private readonly opcoes: OpcoesRobo) {
    this.seletores = { ...seletoresPadrao, ...(opcoes.seletores ?? {}) };
    // prints e trace de cada execução: saida/execucoes/2026-11-26T16-30-00-123
    this.pastaExecucao = path.join(
      opcoes.pastaSaida,
      'execucoes',
      new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''),
    );
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  async consultar(pedido: PedidoConsulta): Promise<ResultadoConsulta> {
    this.validarPedido(pedido); // antes de abrir o navegador
    try {
      await this.iniciar();
      return await this.consultarExtrato(pedido);
    } finally {
      await this.encerrar();
    }
  }

  async iniciar(): Promise<void> {
    fs.mkdirSync(this.pastaExecucao, { recursive: true });
    this.logger.log(`Iniciando navegador (${this.opcoes.navegador}, headless=${this.opcoes.headless})`);

    this.browser = await chromium.launch({ channel: this.opcoes.navegador, headless: this.opcoes.headless });
    this.context = await this.browser.newContext(this.montarOpcoesContexto());
    this.context.setDefaultTimeout(this.opcoes.timeout);
    await this.context.addInitScript(AJUSTES_SICSE);

    // alertas (window.alert) do site: guarda a mensagem e fecha, em qualquer aba
    this.context.on('page', p => this.registrarAlertas(p));

    // "filme" da execução: npm run trace saida/execucoes/.../trace.zip
    await this.context.tracing.start({ screenshots: true, snapshots: true });

    this.portal = await this.context.newPage();
  }

  async consultarExtrato(pedido: PedidoConsulta): Promise<ResultadoConsulta> {
    const { nis, uf, inscricaoOutorgante } = this.validarPedido(pedido);
    const nome = pedido.nome.trim();
    this.logger.log(
      `Extrato do NIS ${mascararNis(nis)} (UF ${uf}` + (inscricaoOutorgante ? `, outorgante ${inscricaoOutorgante})` : ')'),
    );

    const formulario = await this.abrirFormularioExtrato(inscricaoOutorgante);
    const extrato = await this.localizarTrabalhador(formulario, nis, uf, nome);
    const pdf = await this.salvarPdf(extrato, nome, nis);

    this.logger.log(`PDF salvo em ${pdf}`);
    return { nis, nome, uf, inscricaoOutorgante, pdf, consultadoEm: new Date().toISOString() };
  }

  async encerrar(): Promise<void> {
    if (this.context) {
      const tracePath = path.join(this.pastaExecucao, 'trace.zip');
      await this.context.tracing.stop({ path: tracePath }).catch(() => undefined);
      this.logger.log(`Trace salvo em ${tracePath}`);
    }
    await this.browser?.close().catch(() => undefined);
    this.browser = this.context = this.portal = this.sicse = null;
    this.autenticado = false;
  }

  // ---------------------------------------------------------------------------
  // Etapas
  // ---------------------------------------------------------------------------

  /** Tela inicial -> "Empregador" -> certificado -> selectbox de serviços do Conectividade. */
  private async abrirServicosEmpregador(): Promise<Locator> {
    const portal = this.exigirPortal();
    const s = this.seletores;
    const combo = s.comboServicosEmpregador(portal);

    await this.executarEtapa('navegacao', 'erro-tela-inicial', async () => {
      if (!(await s.menuEmpregador(portal).isVisible())) {
        this.logger.log('Acessando a tela inicial do Conectividade Social');
        await portal.goto(s.urlInicial, { waitUntil: 'domcontentloaded' });
      }
      await s.menuEmpregador(portal).click();
    });

    const espera = this.autenticado ? this.opcoes.timeout : this.opcoes.timeoutCertificado;
    if (!this.autenticado) {
      this.logger.log(`Aguardando o certificado ser escolhido (até ${Math.round(espera / 1000)}s)`);
    }
    await this.executarEtapa('login', 'erro-certificado', async () => {
      const manter = s.manterCertificadoLogado(portal);
      await combo.or(manter).first().waitFor({ timeout: espera });
      if (await manter.isVisible()) await manter.click();
      // depois do certificado o Conectividade ainda abre a sessão no SICSE em segundo plano
      await portal.waitForLoadState('networkidle', { timeout: this.opcoes.timeout }).catch(() => undefined);
      await combo.waitFor();
    }).catch(e => {
      if (e instanceof ConsultaFgtsError && !this.autenticado) {
        throw new ConsultaFgtsError(
          `O selectbox de serviços não apareceu depois de clicar em Empregador: ` +
            `o certificado não foi escolhido ou não foi aceito (${e.message})`,
          'login',
          e.screenshot,
        );
      }
      throw e;
    });

    if (!this.autenticado) this.logger.log('Certificado aceito');
    this.autenticado = true;
    return combo;
  }

  /** Escolhe um serviço num selectbox e devolve a aba do SICSE que abrir (mesma aba ou nova). */
  private async escolherServico(pagina: Page, combo: Locator, servico: string): Promise<Page> {
    const s = this.seletores;
    await combo.waitFor();
    const valor = await combo
      .locator('option')
      .evaluateAll(
        (opcoes, alvo) =>
          opcoes.map(o => (o as HTMLOptionElement).value).find(v => v.split('|')[1] === alvo) ?? null,
        servico,
      );
    if (!valor) {
      throw new ConsultaFgtsError(
        `Serviço "${servico}" não encontrado no selectbox. O certificado tem acesso a esse serviço?`,
        'navegacao',
        await this.print(`erro-servico-${servico}`),
      );
    }

    const jaNoSicse = s.urlSicse.test(pagina.url());
    // Conectividade -> SICSE: abre na mesma aba ou numa aba nova
    const mesmaAba = jaNoSicse
      ? Promise.resolve(null)
      : pagina
          .waitForURL(s.urlSicse)
          .then(() => pagina)
          .catch(() => null);
    const novaAba = this.context!.waitForEvent('page')
      .then(async p => (await p.waitForURL(s.urlSicse), p))
      .catch(() => null);
    // dentro do SICSE a própria tela recarrega: espera o próximo carregamento
    const recarregou = jaNoSicse
      ? pagina
          .waitForEvent('load')
          .then(() => pagina)
          .catch(() => null)
      : Promise.resolve(null);

    await combo.selectOption(valor);

    const destino = await primeiroNaoNulo([mesmaAba, novaAba, recarregou]);
    if (!destino) throw new Error(`O SICSE não abriu depois de escolher o serviço "${servico}"`);

    // o SICSE faz mais de um POST ao abrir; só segue depois que a rede acalmar
    await destino.waitForLoadState('networkidle', { timeout: this.opcoes.timeout }).catch(() => undefined);
    this.sicse = destino;
    return destino;
  }

  /** Chega ao formulário "Localização do Trabalhador", passando pelo outorgante se houver. */
  private async abrirFormularioExtrato(inscricaoOutorgante: string | null): Promise<Page> {
    const s = this.seletores;
    if (this.sicse && this.sicse !== this.portal && !this.sicse.isClosed()) await this.sicse.close();
    this.sicse = null;

    const combo = await this.abrirServicosEmpregador();
    const portal = this.exigirPortal();

    if (!inscricaoOutorgante) {
      return this.executarEtapa('navegacao', 'erro-abrir-extrato', async () => {
        const pagina = await this.escolherServico(portal, combo, s.servicoExtrato);
        await s.sicseCampoNis(pagina).waitFor();
        return pagina;
      });
    }

    const telaOutorgante = await this.executarEtapa('outorgante', 'erro-abrir-outorgante', () =>
      this.escolherServico(portal, combo, s.servicoOutorgante),
    );

    await this.executarEtapa('outorgante', 'erro-outorgante', async () => {
      this.logger.log(`Acessando empresa outorgante ${inscricaoOutorgante}`);
      await s.outorganteCampoInscricao(telaOutorgante).fill(inscricaoOutorgante);

      this.ultimoAlerta = null;
      const recarregou = telaOutorgante.waitForEvent('load').catch(() => null);
      await s.outorganteBotaoContinuar(telaOutorgante).click();

      const resposta = await primeiroNaoNulo([
        this.esperarAlerta(this.opcoes.timeout).then(m => (m === null ? null : ('alerta' as const))),
        recarregou.then(r => (r ? ('recarregou' as const) : null)),
      ]);
      if (resposta === 'alerta') {
        throw new ConsultaFgtsError(
          `SICSE recusou a empresa outorgante ${inscricaoOutorgante}: ${this.ultimoAlerta}`,
          'outorgante',
          await this.print('alerta-outorgante'),
        );
      }
      if (!resposta) throw new Error('A tela não recarregou depois do CONTINUAR do outorgante');
      await telaOutorgante.waitForLoadState('networkidle', { timeout: this.opcoes.timeout }).catch(() => undefined);
    });

    return this.executarEtapa('navegacao', 'erro-abrir-extrato', async () => {
      const pagina = await this.escolherServico(
        telaOutorgante,
        s.sicseComboServicos(telaOutorgante),
        s.servicoExtrato,
      );
      await s.sicseCampoNis(pagina).waitFor();
      return pagina;
    });
  }

  /** Preenche Base da Conta + PIS, clica em CONTINUAR e espera a tela do extrato. */
  private async localizarTrabalhador(pagina: Page, nis: string, uf: string, nome: string): Promise<Page> {
    const s = this.seletores;

    await this.executarEtapa('consulta', `erro-localizar-${nis}`, async () => {
      await this.escolherBaseDaConta(pagina, uf);
      // O SICSE aceita UM critério de pesquisa além da Base da Conta
      // ("Preencha apenas um dos campos para pesquisa"). Pesquisa pelo PIS, que é
      // único; o nome é conferido na tela do extrato.
      await s.sicseCampoNome(pagina).fill('');
      await s.sicseCampoNis(pagina).fill(nis);

      this.ultimoAlerta = null;
      await s.sicseBotaoPesquisar(pagina).click();

      const resposta = await primeiroNaoNulo([
        this.esperarAlerta(this.opcoes.timeout).then(m => (m === null ? null : ('alerta' as const))),
        s
          .extratoVisualizarImpressao(pagina)
          .waitFor({ timeout: this.opcoes.timeout })
          .then(() => 'extrato' as const)
          .catch(() => null),
      ]);

      if (resposta === 'alerta') {
        throw new ConsultaFgtsError(`SICSE: ${this.ultimoAlerta}`, 'consulta', await this.print(`alerta-${nis}`));
      }
      if (!resposta) {
        throw new ConsultaFgtsError(
          'A tela depois do CONTINUAR não foi reconhecida como o extrato (botão "Visualizar Impressão" não encontrado). ' +
            'Veja o print para mapear essa tela em src/consulta-fgts/seletores.ts.',
          'consulta',
          await this.print(`tela-nao-reconhecida-${nis}`),
        );
      }
    });

    // Conferência do trabalhador: nunca gerar o extrato de outra pessoa.
    const texto = await pagina.locator('body').innerText().catch(() => '');
    if (!textoContemNome(texto, nome)) {
      throw new ConsultaFgtsError(
        `O nome "${nome}" não aparece no extrato deste NIS: pode ser outro trabalhador. Extrato descartado.`,
        'consulta',
        await this.print(`nome-divergente-${nis}`),
      );
    }
    this.logger.log('Trabalhador conferido pelo nome');
    return pagina;
  }

  private async escolherBaseDaConta(pagina: Page, uf: string): Promise<void> {
    const regiao = this.seletores.sicseRegiao(pagina);
    const opcoes = await regiao
      .locator('option')
      .evaluateAll(os => os.map(o => ({ valor: (o as HTMLOptionElement).value, rotulo: o.textContent?.trim() ?? '' })));
    const opcao = opcoes.find(o => o.valor && o.rotulo.toUpperCase().startsWith(`${uf}-`));
    if (!opcao) {
      const disponiveis = opcoes.filter(o => o.valor).map(o => o.rotulo);
      throw new ConsultaFgtsError(
        `Base da Conta para a UF "${uf}" não disponível para esta empresa. Disponíveis: ${disponiveis.join(', ') || 'nenhuma'}`,
        'consulta',
        await this.print(`erro-base-${uf}`),
      );
    }
    await regiao.selectOption(opcao.valor);
  }

  /**
   * Clica em "Visualizar Impressão" e salva o PDF em saida/<NOME>.pdf.
   * Aceita as três formas que a tela pode usar: download de arquivo, resposta em PDF
   * (aberta numa aba) ou página de impressão em HTML (convertida em PDF pelo robô).
   */
  private async salvarPdf(extrato: Page, nome: string, nis: string): Promise<string> {
    const context = this.context!;
    const destino = path.join(this.opcoes.pastaSaida, nomeArquivoPdf(nome));
    fs.mkdirSync(this.opcoes.pastaSaida, { recursive: true });

    return this.executarEtapa('impressao', `erro-impressao-${nis}`, async () => {
      const limite = { timeout: this.opcoes.timeout };
      const download = extrato.waitForEvent('download', limite).catch(() => null);
      const respostaPdf = context
        .waitForEvent('response', {
          ...limite,
          predicate: r => (r.headers()['content-type'] ?? '').includes('application/pdf'),
        })
        .catch(() => null);
      const novaAba = context.waitForEvent('page', limite).catch(() => null);
      const recarregou = extrato.waitForEvent('load', limite).catch(() => null);

      await this.seletores.extratoVisualizarImpressao(extrato).click();

      const primeiro = await primeiroNaoNulo<
        | { tipo: 'download'; d: NonNullable<Awaited<typeof download>> }
        | { tipo: 'pdf'; r: NonNullable<Awaited<typeof respostaPdf>> }
        | { tipo: 'pagina'; p: Page }
      >([
        download.then(d => (d ? { tipo: 'download' as const, d } : null)),
        respostaPdf.then(r => (r ? { tipo: 'pdf' as const, r } : null)),
        novaAba.then(p => (p ? { tipo: 'pagina' as const, p } : null)),
        recarregou.then(p => (p ? { tipo: 'pagina' as const, p: extrato } : null)),
      ]);

      if (!primeiro) throw new Error('Nada aconteceu depois de clicar em "Visualizar Impressão"');

      if (primeiro.tipo === 'download') {
        await primeiro.d.saveAs(destino);
        return destino;
      }
      if (primeiro.tipo === 'pdf') {
        fs.writeFileSync(destino, await primeiro.r.body());
        return destino;
      }

      // Página: pode ser um PDF aberto no visualizador do Edge ou uma página HTML de impressão.
      const pagina = primeiro.p;
      const pdfNaAba = await respostaPdfAte(respostaPdf, 3000);
      if (pdfNaAba) {
        fs.writeFileSync(destino, await pdfNaAba.body());
        return destino;
      }
      await pagina.waitForLoadState('networkidle', limite).catch(() => undefined);
      await this.imprimirPaginaEmPdf(pagina, destino);
      return destino;
    });
  }

  /** Converte a página de impressão (HTML) em PDF. */
  private async imprimirPaginaEmPdf(pagina: Page, destino: string): Promise<void> {
    await pagina.emulateMedia({ media: 'print' });
    const opcoesPdf = { format: 'A4', printBackground: true, margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' } };
    try {
      await pagina.pdf({ path: destino, ...opcoesPdf });
      return;
    } catch {
      // page.pdf() só funciona em headless; com o navegador visível usa o DevTools direto
    }
    const cdp = await this.context!.newCDPSession(pagina);
    const { data } = (await cdp.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    })) as { data: string };
    fs.writeFileSync(destino, Buffer.from(data, 'base64'));
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  /** Converte qualquer falha inesperada da etapa em ConsultaFgtsError com print da tela. */
  private async executarEtapa<T>(etapa: EtapaErro, nomePrint: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ConsultaFgtsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new ConsultaFgtsError(msg, etapa, await this.print(nomePrint));
    }
  }

  /** Valida o pedido; devolve os campos normalizados. */
  private validarPedido(pedido: PedidoConsulta): { nis: string; uf: string; inscricaoOutorgante: string | null } {
    const nis = normalizarNis(pedido.nis);
    if (!validarNis(nis)) throw new ConsultaFgtsError(`NIS inválido: ${mascararNis(nis)}`, 'validacao');
    if (!nomeCompleto(pedido.nome)) {
      throw new ConsultaFgtsError('Informe o nome completo do trabalhador (nome e sobrenome)', 'validacao');
    }
    const uf = normalizarUf(pedido.uf);
    if (!validarUf(uf)) throw new ConsultaFgtsError(`UF inválida: "${pedido.uf}" (use a sigla, ex.: CE)`, 'validacao');

    const inscricao = normalizarNis(pedido.inscricaoOutorgante);
    if (inscricao && !validarInscricao(inscricao)) {
      throw new ConsultaFgtsError(
        `CNPJ/CEI/CPF do outorgante inválido: "${pedido.inscricaoOutorgante}"`,
        'validacao',
      );
    }
    return { nis, uf, inscricaoOutorgante: inscricao || null };
  }

  private montarOpcoesContexto(): BrowserContextOptions {
    const ctx: BrowserContextOptions = { locale: 'pt-BR', acceptDownloads: true };

    if (this.opcoes.certModo === 'pfx') {
      const { certPfxPath, certPfxSenha } = this.opcoes;
      if (!certPfxPath || !fs.existsSync(certPfxPath)) {
        throw new ConsultaFgtsError(`Certificado .pfx não encontrado: ${certPfxPath}`, 'configuracao');
      }
      ctx.clientCertificates = ORIGENS_CAIXA.map(origin => ({ origin, pfxPath: certPfxPath, passphrase: certPfxSenha }));
      this.logger.log('Certificado: arquivo .pfx');
    } else {
      // Modo "windows": o Edge usa o certificado do repositório do usuário; a
      // política AutoSelectCertificateForUrls (politica-edge.reg) escolhe sem perguntar.
      this.logger.log('Certificado: repositório do Windows');
    }
    return ctx;
  }

  private registrarAlertas(page: Page): void {
    page.on('dialog', dialog => {
      this.ultimoAlerta = dialog.message();
      this.logger.warn(`Alerta do site: ${this.ultimoAlerta}`);
      dialog.dismiss().catch(() => undefined);
    });
  }

  private async esperarAlerta(limiteMs: number): Promise<string | null> {
    const fim = Date.now() + limiteMs;
    while (Date.now() < fim) {
      if (this.ultimoAlerta !== null) return this.ultimoAlerta;
      await new Promise(r => setTimeout(r, 200));
    }
    return this.ultimoAlerta;
  }

  private exigirPortal(): Page {
    if (!this.portal) throw new ConsultaFgtsError('Navegador não iniciado (chame iniciar() antes)', 'configuracao');
    return this.portal;
  }

  private async print(nome: string): Promise<string | null> {
    const page = this.sicse && !this.sicse.isClosed() ? this.sicse : this.portal;
    if (!page || page.isClosed()) return null;
    const arquivo = path.join(this.pastaExecucao, `${nome}.png`);
    await page.screenshot({ path: arquivo, fullPage: true }).catch(() => undefined);
    return arquivo;
  }
}

/** Resolve com o primeiro valor não nulo; null se todas resolverem nulo. */
function primeiroNaoNulo<T>(promessas: Promise<T | null>[]): Promise<T | null> {
  return new Promise(resolve => {
    let pendentes = promessas.length;
    if (!pendentes) resolve(null);
    for (const p of promessas) {
      p.then(
        v => (v !== null ? resolve(v) : --pendentes === 0 && resolve(null)),
        () => --pendentes === 0 && resolve(null),
      );
    }
  });
}

/** Espera a resposta em PDF por até `ms`; null se não vier. */
function respostaPdfAte<T>(promessa: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([promessa, new Promise<null>(r => setTimeout(() => r(null), ms))]);
}
