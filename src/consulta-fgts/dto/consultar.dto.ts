import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { nomeCompleto, validarInscricao, validarNis, validarUf } from '../utilitarios';

export const MAX_ITENS_LOTE = 50;

/** Cria um decorator de validação a partir de uma função pura dos utilitários. */
function validarCom(nome: string, mensagem: string, fn: (valor: string) => boolean) {
  return (opcoes?: ValidationOptions) => (alvo: object, propriedade: string) =>
    registerDecorator({
      name: nome,
      target: alvo.constructor,
      propertyName: propriedade,
      options: { message: mensagem, ...opcoes },
      validator: { validate: (valor: unknown) => typeof valor === 'string' && fn(valor) },
    });
}

const IsNis = validarCom('isNis', 'nis deve ser um NIS/PIS/PASEP válido (11 dígitos com dígito verificador)', validarNis);
const IsNomeCompleto = validarCom('isNomeCompleto', 'nome deve ser o nome completo (nome e sobrenome)', nomeCompleto);
const IsUf = validarCom('isUf', 'uf deve ser a sigla do estado, ex.: CE', validarUf);
const IsInscricao = validarCom(
  'isInscricao',
  'inscricaoOutorgante deve ser um CNPJ (14), CEI (12) ou CPF (11 dígitos)',
  validarInscricao,
);

export class ConsultarDto {
  /** NIS/PIS do trabalhador, com ou sem pontuação: "203.70954.63-1" ou "20370954631". */
  @IsString()
  @IsNis()
  nis!: string;

  /** Nome completo: conferido na tela do extrato e usado no nome do PDF. */
  @IsString()
  @MaxLength(70)
  @IsNomeCompleto()
  nome!: string;

  /** UF da Base da Conta do trabalhador, ex.: "CE". */
  @IsString()
  @IsUf()
  uf!: string;

  /** CNPJ/CEI/CPF da empresa outorgante (cliente). Omitir = própria empresa do certificado. */
  @IsOptional()
  @IsString()
  @IsInscricao()
  inscricaoOutorgante?: string;
}

export class ConsultarLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITENS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => ConsultarDto)
  itens!: ConsultarDto[];
}
