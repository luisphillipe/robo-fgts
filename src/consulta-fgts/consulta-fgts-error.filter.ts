import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ConsultaFgtsError, type EtapaErro } from './consulta-fgts.robo';

/**
 * Traduz as falhas do robô em respostas HTTP que o portal consegue tratar:
 *   400 validacao             -> dados do pedido inválidos
 *   422 outorgante/consulta   -> o site recusou (outorgante sem procuração, NIS não
 *                                encontrado, nome não confere...)
 *   502 impressao             -> o extrato abriu, mas o PDF não foi gerado
 *   503 login/navegacao/configuracao -> problema no robô, certificado ou seletores
 */
const STATUS_POR_ETAPA: Record<EtapaErro, HttpStatus> = {
  validacao: HttpStatus.BAD_REQUEST,
  outorgante: HttpStatus.UNPROCESSABLE_ENTITY,
  consulta: HttpStatus.UNPROCESSABLE_ENTITY,
  impressao: HttpStatus.BAD_GATEWAY,
  login: HttpStatus.SERVICE_UNAVAILABLE,
  navegacao: HttpStatus.SERVICE_UNAVAILABLE,
  configuracao: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch(ConsultaFgtsError)
export class ConsultaFgtsErrorFilter implements ExceptionFilter {
  catch(erro: ConsultaFgtsError, host: ArgumentsHost): void {
    const status = STATUS_POR_ETAPA[erro.etapa];
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, etapa: erro.etapa, erro: erro.message, screenshot: erro.screenshot });
  }
}
