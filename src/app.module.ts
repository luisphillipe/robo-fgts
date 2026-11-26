import { Module } from '@nestjs/common';
import { CONFIGURACAO, carregarConfiguracao } from './config/configuracao';
import { ConsultaFgtsController } from './consulta-fgts/consulta-fgts.controller';
import { ConsultaFgtsService } from './consulta-fgts/consulta-fgts.service';

@Module({
  controllers: [ConsultaFgtsController],
  providers: [{ provide: CONFIGURACAO, useFactory: () => carregarConfiguracao() }, ConsultaFgtsService],
})
export class AppModule {}
