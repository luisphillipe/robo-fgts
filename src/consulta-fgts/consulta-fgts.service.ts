import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIGURACAO, type Configuracao } from '../config/configuracao';
import { ConsultaFgtsError, ConsultaFgtsRobo, type PedidoConsulta, type ResultadoConsulta } from './consulta-fgts.robo';

export type ItemLote =
  | { nis: string; sucesso: true; resultado: ResultadoConsulta }
  | { nis: string; sucesso: false; etapa: string; erro: string; screenshot: string | null };

/** Falhas que derrubam a sessão inteira: não adianta tentar os próximos NIS. */
const ETAPAS_FATAIS = new Set(['configuracao', 'login', 'navegacao']);

@Injectable()
export class ConsultaFgtsService {
  private readonly logger = new Logger(ConsultaFgtsService.name);
  /** O site da CAIXA não aguenta sessões paralelas: uma consulta (ou lote) por vez. */
  private fila: Promise<unknown> = Promise.resolve();
  private aguardando = 0;

  constructor(@Inject(CONFIGURACAO) private readonly config: Configuracao) {}

  get consultasNaFila(): number {
    return this.aguardando;
  }

  consultar(pedido: PedidoConsulta): Promise<ResultadoConsulta> {
    return this.enfileirar(() => this.criarRobo().consultar(pedido));
  }

  /** Vários NIS numa sessão só (loga uma vez). */
  consultarLote(pedidos: PedidoConsulta[]): Promise<ItemLote[]> {
    return this.enfileirar(async () => {
      const robo = this.criarRobo();
      const itens: ItemLote[] = [];
      try {
        await robo.iniciar();
        for (const pedido of pedidos) {
          try {
            itens.push({ nis: pedido.nis, sucesso: true, resultado: await robo.consultarExtrato(pedido) });
          } catch (e) {
            if (!(e instanceof ConsultaFgtsError) || ETAPAS_FATAIS.has(e.etapa)) throw e;
            itens.push({ nis: pedido.nis, sucesso: false, etapa: e.etapa, erro: e.message, screenshot: e.screenshot });
          }
        }
        return itens;
      } finally {
        await robo.encerrar();
      }
    });
  }

  private criarRobo(): ConsultaFgtsRobo {
    return new ConsultaFgtsRobo(this.config);
  }

  private enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    this.aguardando++;
    if (this.aguardando > 1) this.logger.log(`Consulta na fila (${this.aguardando - 1} à frente)`);
    const execucao = this.fila.then(tarefa).finally(() => this.aguardando--);
    this.fila = execucao.catch(() => undefined);
    return execucao;
  }
}
