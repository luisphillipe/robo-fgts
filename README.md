# Robô FGTS

Gera o **extrato FGTS em PDF** de um trabalhador no Conectividade Social V2 / SICSE,
inclusive de empresas clientes (**empresa outorgante**, via procuração).
Escrito em TypeScript com NestJS: roda como **API HTTP** (chamada pelo Portal RH) ou pela **linha de comando**.

Precisa rodar numa máquina **Windows** com o Edge e o certificado A1 da empresa instalados.

## Fluxo

1. Tela inicial do Conectividade Social → botão **Empregador** → o site pede o **certificado**
2. Com outorgante: serviço **Acessar Empresa Outorgante** → informa o **CNPJ/CEI/CPF** → **CONTINUAR** (a tela recarrega)
3. Serviço **Solicitar Extrato do Trabalhador** → abre o formulário do SICSE
4. **Base da Conta** (UF do trabalhador) + **PIS/NIS** → **CONTINUAR**
   (o SICSE aceita só um critério de pesquisa além da Base da Conta; o nome é usado na conferência)
5. Tela do extrato: o robô **confere se o nome completo aparece no extrato**. Se não aparecer,
   descarta (nunca gera o extrato de outra pessoa).
6. **Visualizar Impressão** → o PDF é salvo em `saida/<NOME COMPLETO>.pdf`

## Estrutura

```
robo-fgts/
├── src/
│   ├── main.ts                          # sobe a API
│   ├── app.module.ts
│   ├── config/configuracao.ts           # leitura e validação do .env
│   ├── auth/token.guard.ts              # exige o token do portal
│   ├── cli/consultar.ts                 # npm run consultar -- --nis ... --nome ... --uf ...
│   └── consulta-fgts/
│       ├── consulta-fgts.robo.ts        # o robô (Playwright): fluxo completo e PDF
│       ├── seletores.ts                 # seletores das telas (ajustar aqui se a CAIXA mudar)
│       ├── consulta-fgts.service.ts     # fila: uma consulta por vez
│       ├── consulta-fgts.controller.ts  # rotas HTTP
│       ├── consulta-fgts-error.filter.ts# erros do robô -> status HTTP
│       ├── dto/consultar.dto.ts         # validação do corpo
│       └── utilitarios.ts               # NIS, nome, UF, CNPJ (com testes)
├── politica-edge.reg                    # seleção automática do certificado no Edge
├── .env.example
└── saida/
    ├── <NOME COMPLETO>.pdf              # extratos gerados
    └── execucoes/<data-hora>/           # prints e trace de cada execução
```

## 1. Instalar

```bash
npm install
copy .env.example .env
npm run build
```

Não precisa rodar `npx playwright install`: o robô usa o Edge já instalado no Windows.
No `.env`, troque `ROBO_TOKEN` por um valor longo e aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Certificado

**Modo `windows` (recomendado)**

1. Importe o certificado A1 no repositório pessoal do usuário que vai rodar o robô
   (`certmgr.msc` → Pessoal → Importar), marcando a chave como **não exportável**.
2. Confira o CN do certificado em `politica-edge.reg` e execute o arquivo como administrador.
   Ele faz o Edge escolher o certificado sozinho no Conectividade e no SICSE.
3. Teste abrindo o Edge manualmente em `https://conectividadesocialv2.caixa.gov.br`:
   ele deve entrar sem perguntar qual certificado usar.

Sem a política, o Edge mostra a janela de certificados e o robô espera até `TIMEOUT_CERTIFICADO`
(padrão 2 minutos) para alguém escolher.

**Modo `pfx` (só para teste rápido)**

No `.env`: `CERT_MODO=pfx`, `CERT_PFX_PATH` e `CERT_PFX_SENHA`.
Não use em produção nem faça commit do `.env`.

## 3. Consultar pela linha de comando

```bash
npm run consultar -- --nis 20370954631 --nome "NOME COMPLETO" --uf CE --outorgante 12345678000199
```

| Opção | Obrigatória | Descrição |
|---|---|---|
| `--nis` | sim | NIS/PIS do trabalhador |
| `--nome` | sim | nome completo (conferido no extrato e usado no nome do PDF) |
| `--uf` | sim | UF da Base da Conta, ex.: `CE` |
| `--outorgante` | não | CNPJ/CEI/CPF da empresa cliente; sem ele, usa a empresa do certificado |

Com `HEADLESS=false` no `.env` você vê o navegador trabalhando.

## 4. API (para o Portal RH)

```bash
npm start            # produção (dist/)
npm run start:dev    # desenvolvimento, recompila ao salvar
```

Por padrão escuta só em `127.0.0.1:3100`. Para o portal acessar de outro servidor, use `HOST=0.0.0.0`
e libere a porta no firewall **apenas** para o IP do servidor do portal.

| Rota | Token | Corpo | Resposta |
|---|---|---|---|
| `GET /saude` | não | — | `{ "status": "ok", "consultasNaFila": 0 }` |
| `POST /consultas` | sim | um pedido (abaixo) | resultado |
| `POST /consultas/lote` | sim | `{ "itens": [pedido, ...] }` (até 50) | um item por pedido (loga uma vez só) |

Pedido:

```json
{ "nis": "20370954631", "nome": "NOME COMPLETO", "uf": "CE", "inscricaoOutorgante": "12345678000199" }
```

Cabeçalho: `Authorization: Bearer <ROBO_TOKEN>`.

As consultas entram numa fila e rodam **uma por vez**: o site da CAIXA não aceita sessões em paralelo.
Cada consulta leva dezenas de segundos, então use um timeout alto no cliente.

Resposta de sucesso:

```json
{
  "nis": "20370954631",
  "nome": "NOME COMPLETO",
  "uf": "CE",
  "inscricaoOutorgante": "12345678000199",
  "pdf": "saida\\NOME COMPLETO.pdf",
  "consultadoEm": "2026-11-26T19:30:00.000Z"
}
```

Erros:

| Status | Etapa | Significado |
|---|---|---|
| 400 | `validacao` | dados do pedido inválidos |
| 401 | — | token ausente ou errado |
| 422 | `outorgante` | o SICSE recusou a empresa outorgante (sem procuração, CNPJ errado...) |
| 422 | `consulta` | trabalhador não encontrado, base indisponível ou nome não confere |
| 502 | `impressao` | o extrato abriu, mas o PDF não foi gerado |
| 503 | `login` / `navegacao` / `configuracao` | certificado, acesso ao serviço ou tela não reconhecida |

Corpo do erro: `{ "statusCode", "etapa", "erro", "screenshot" }`.

## 5. Mapear telas

Os seletores ficam em `src/consulta-fgts/seletores.ts`, marcados como **MAPEADO** ou **PROVISÓRIO**.
Para capturar uma tela nova ou que mudou:

```bash
npm run mapear
```

Navegue manualmente e feche o navegador. O código gravado fica em `saida/codegen-gravado.js`.

## 6. Quando der erro

Cada execução gera uma pasta em `saida/execucoes/` com:

- `*.png`: print da tela no momento da falha
- `trace.zip`: o passo a passo completo. Para abrir:

```bash
npm run trace saida\execucoes\2026-11-26T19-29-40-123\trace.zip
```

## 7. Desenvolvimento

```bash
npm test             # testes unitários
npm run typecheck    # checagem de tipos
```
# robo-fgts
