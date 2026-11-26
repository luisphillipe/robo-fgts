/**
 * Extrato pela linha de comando.
 *
 *   npm run consultar -- --nis 20370954631 --nome "NOME COMPLETO" --uf CE --outorgante 12345678000199
 *
 * --outorgante é opcional: sem ele, consulta como a própria empresa do certificado.
 * O PDF é salvo em saida/<NOME COMPLETO>.pdf
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { carregarConfiguracao } from '../config/configuracao';
import { ConsultaFgtsError, ConsultaFgtsRobo } from '../consulta-fgts/consulta-fgts.robo';

const USO =
  'Uso: npm run consultar -- --nis <NIS> --nome "<NOME COMPLETO>" --uf <UF> [--outorgante <CNPJ/CEI/CPF>]';

async function main(): Promise<number> {
  let valores: { nis?: string; nome?: string; uf?: string; outorgante?: string };
  try {
    ({ values: valores } = parseArgs({
      options: {
        nis: { type: 'string' },
        nome: { type: 'string' },
        uf: { type: 'string' },
        outorgante: { type: 'string' },
      },
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USO}`);
    return 1;
  }

  const { nis, nome, uf, outorgante } = valores;
  if (!nis || !nome || !uf) {
    console.error(USO);
    return 1;
  }

  const robo = new ConsultaFgtsRobo(carregarConfiguracao());
  try {
    const resultado = await robo.consultar({ nis, nome, uf, inscricaoOutorgante: outorgante });
    console.log('\nResultado:');
    console.log(JSON.stringify(resultado, null, 2));
    return 0;
  } catch (e) {
    if (e instanceof ConsultaFgtsError) {
      console.error(`\nFalhou na etapa "${e.etapa}": ${e.message}`);
      if (e.screenshot) console.error(`Print da tela: ${e.screenshot}`);
    } else {
      console.error('\nErro inesperado:', e);
    }
    const trace = path.join(robo.pastaExecucao, 'trace.zip');
    if (fs.existsSync(trace)) console.error(`Trace da execução: ${trace}  (abrir com: npm run trace ${trace})`);
    return 1;
  }
}

main().then(codigo => process.exit(codigo));
