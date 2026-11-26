import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CONFIGURACAO, type Configuracao } from '../config/configuracao';

/** Exige "Authorization: Bearer <ROBO_TOKEN>" (o token que o portal conhece). */
@Injectable()
export class TokenGuard implements CanActivate {
  private readonly esperado: Buffer;

  constructor(@Inject(CONFIGURACAO) config: Configuracao) {
    if (!config.token) throw new Error('ROBO_TOKEN não definido no .env');
    this.esperado = Buffer.from(config.token);
  }

  canActivate(contexto: ExecutionContext): boolean {
    const cabecalho = contexto.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const recebido = Buffer.from(cabecalho.replace(/^Bearer\s+/i, ''));
    if (recebido.length !== this.esperado.length || !timingSafeEqual(recebido, this.esperado)) {
      throw new UnauthorizedException('Token inválido');
    }
    return true;
  }
}
