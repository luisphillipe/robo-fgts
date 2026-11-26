import { Body, Controller, Get, HttpCode, Post, UseFilters, UseGuards } from '@nestjs/common';
import { TokenGuard } from '../auth/token.guard';
import { ConsultaFgtsErrorFilter } from './consulta-fgts-error.filter';
import { ConsultaFgtsService } from './consulta-fgts.service';
import { ConsultarDto, ConsultarLoteDto } from './dto/consultar.dto';

@Controller()
@UseFilters(ConsultaFgtsErrorFilter)
export class ConsultaFgtsController {
  constructor(private readonly service: ConsultaFgtsService) {}

  /** Sem token: para o portal/monitoramento saber se o robô está no ar. */
  @Get('saude')
  saude() {
    return { status: 'ok', consultasNaFila: this.service.consultasNaFila };
  }

  /** POST /consultas  { "nis": "12345678900", "nome": "opcional" } */
  @Post('consultas')
  @HttpCode(200)
  @UseGuards(TokenGuard)
  consultar(@Body() dto: ConsultarDto) {
    return this.service.consultar(dto);
  }

  /** POST /consultas/lote  { "itens": [{ "nis": "..." }, ...] }  — loga uma vez só */
  @Post('consultas/lote')
  @HttpCode(200)
  @UseGuards(TokenGuard)
  consultarLote(@Body() dto: ConsultarLoteDto) {
    return this.service.consultarLote(dto.itens);
  }
}
