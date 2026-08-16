// RASTREAMENTO ORIGEM → DESTINO (tabela `payment_sources`).
//
// Responde "de onde saiu cada centavo e para onde foi": um pagamento de R$ 8.900 em Lucros
// vira duas linhas — Pharmalog serviço 8.586,22 → lucros, Bokada serviço 313,78 → lucros.
//
// ── TRÊS COISAS QUE NÃO SÃO ÓBVIAS E VÃO POUPAR UMA INVESTIGAÇÃO ───────────────────────
//
// 1. O DRIVER NÃO É `pg`. É `@neondatabase/serverless`, que usa tagged template
//    (sql`...`) e devolve um ARRAY de linhas — não `db.query($1, [...])` com
//    `result.rows`. A especificação deste módulo veio escrita na API do `pg`; o que está
//    aqui é a mesma coisa no driver que o projeto realmente usa. Chamar `.query()` num
//    `sql` do Neon estoura em runtime.
//
// 2. `payment_id` NÃO EXISTE NA HORA DE MONTAR O INSERT. O projeto grava tudo em
//    `sql.transaction([...])`, e o driver do Neon não devolve RETURNING de dentro de uma
//    transação em lote — é a razão pela qual `fiscal_allocations` também resolve o id com
//    `INSERT ... SELECT ... ORDER BY pp.id DESC LIMIT 1`. Fazemos o mesmo:
//    `writeOrigemDestino()` devolve um fragmento não-aguardado que descobre o
//    `payable_payments.id` recém-inserido pelo par (payable, paid_at, notes).
//    ⚠️ O `LIMIT 1` não é enfeite: sem ele, um pagamento anterior com o MESMO
//    (paid_at, notes) casaria duas linhas e a origem seria gravada em dobro.
//
// 3. RASTREAR FORA DA TRANSAÇÃO É PIOR QUE NÃO RASTREAR. Se o INSERT da trilha não
//    estiver na MESMA transação do pagamento, um erro no meio deixa origem sem pagamento
//    (ou o contrário), e a tabela que existe para ser a verdade passa a ser a única fonte
//    errada. Por isso a função devolve write, e não faz await.
//
// O estorno não precisa de nada: `payment_sources.payment_id` é FK ON DELETE CASCADE para
// `payable_payments`, então apagar o pagamento leva a trilha junto.

const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
const num = (v) => parseFloat(v) || 0

// Categoria digitada no modal → `destination_category`.
//
// `honorarios` e `escritorio` caem no MESMO destino porque são a mesma linha na tela (os
// R$ 150 da contabilidade): `honorarios` é o kind rateado, `escritorio` é o legado da
// migração de victor_reserves. Mapeá-los para destinos distintos criaria um "escritorio"
// fantasma que nunca soma com o outro.
//
// ⚠️ `demais`, `servico` e `lucro` NÃO estavam no vocabulário da especificação
// (pro_labore|escritorio|das|inss|lucros|pagar_fabricio), mas são categorias que o motor
// aceita e grava hoje. Ficam com a própria chave: forçá-las em `lucros` faria a soma por
// destino mentir sobre o que foi pago.
export const DESTINO_POR_CATEGORIA = {
  honorarios: 'escritorio',
  escritorio: 'escritorio',
  das: 'das',
  inss: 'inss',
  pro_labore: 'pro_labore',
  lucros: 'lucros',
  demais: 'demais',
  servico: 'servico',
  lucro: 'lucro',
}

// ⚠️ Este mapa NÃO é mais o destino — é a LINHA DE SALDO que a categoria consome.
//
// O destino de um movimento é a categoria que foi paga, crua: "Honorários 150" tem
// `destination_category = 'honorarios'` em TODAS as suas linhas, inclusive nas que
// transbordaram para lucro/serviço. Sem isso, um mesmo pagamento apareceria repartido
// entre dois destinos ('honorarios' no rateio e 'escritorio' no transbordo) e a soma "o
// que saiu para os honorários" precisaria conhecer o mapa para fechar.
//
// O mapa continua valendo para a ORIGEM: pagar Honorários consome o saldo da linha
// "Escritório", que é onde o kind `honorarios` aparece na tela.
export const linhaDeSaldoDe = (categoria) => DESTINO_POR_CATEGORIA[categoria] || categoria
export const destinoDe = linhaDeSaldoDe

// De qual coluna do payable o dinheiro saiu. É sempre uma das duas — `payables_victor` tem
// `service_amount` e `profit_amount`, e um `paid_amount` único.
export const SOURCE_SERVICE = 'service'
export const SOURCE_PROFIT = 'profit'
export const SOURCE_COMPENSACAO_FABRICIO = 'compensation_fabricio'

// Um movimento = uma linha de payment_sources.
//
// `payable_id` + `when` + `notes_sessao` são o que localiza o `payable_payments.id` no
// INSERT; não vão para a tabela.
const movimento = ({
  payable_id, client_id, month, year, source_type, destino, valor, notes,
  sem_debito = false, obligation_id = null,
}) => ({
  payable_id, client_id, month, year, source_type, destino, valor: r2(valor), notes,
  sem_debito, obligation_id,
})

// Quebra um consumo em lucro/serviço sob a hipótese ÚNICA do sistema: o lucro é consumido
// primeiro. A mesma de `prepararCandidatos()` (victor-rateio), `quebrarPago()`
// (victor-breakdown) e `aplicarDelta()` (fiscal-redistribution).
//
// Divergir aqui faria o rastreamento contar como "serviço" o que o resto do sistema já
// tratou como lucro — e a trilha existiria para contradizer o saldo.
export function quebrarConsumo(rec, consumido) {
  const lucroDisponivel = Math.max(r2(num(rec.profit_amount) - num(rec.paid_amount)), 0)
  const de_lucro = r2(Math.min(consumido, lucroDisponivel))
  return { de_lucro, de_servico: r2(consumido - de_lucro) }
}

// ── MOVIMENTOS A PARTIR DO ?action=pagar-com-rateio ────────────────────────────────────
//
// Aqui a informação é EXATA: `planejar()` já devolve, por alocação, o cliente, a
// competência, a categoria e a quebra `de_lucro`/`de_servico`. Nada é estimado.
//
// ⚠️ Categorias de imposto não aparecem: sob a Opção 1 (2026-08-14) elas não consomem
// payable nenhum — quitam a guia com caixa. Sem origem no que a empresa deve ao Victor,
// não há movimento a registrar, e inventar um diria que o dinheiro saiu de um lançamento
// que segue inteiro.
export function movimentosDoPlano(plano) {
  const out = []
  for (const a of plano?.alocacoes || []) {
    // Destino = a categoria PAGA, crua — nunca a linha de saldo. Ver linhaDeSaldoDe().
    const destino = a.categoria
    const base = {
      payable_id: a.payable_id, client_id: a.client_id, month: a.month, year: a.year, destino,
    }

    // Fatia do rateio paga SEM debitar o payable (cascata do imposto). A origem não é
    // lucro nem serviço — é a própria provisão daquele tributo, que a apuração já havia
    // atribuído ao cliente. Registrá-la como 'profit'/'service' diria que saiu do bolso do
    // Victor agora, quando a absorção já tinha feito isso na redistribuição.
    //
    // ⚠️ Não tem `payment_id`: não existe `payable_payments` para ela. O INSERT com SELECT
    // não casaria nada, então esta linha é gravada à parte, com payment_id NULL.
    if (a.sem_debito) {
      // ORIGEM = a linha de saldo consumida (`escritorio`/`das`/`inss`), DESTINO = a
      // categoria que foi paga. Nesta cascata os dois quase coincidem — pagar Honorários
      // consome o saldo de Escritório —, e a distinção só aparece quando o valor
      // transborda: aí as linhas seguintes têm origem `profit`/`service` e o MESMO destino.
      // É o que permite somar "quanto dos honorários saiu de cada lugar".
      out.push(movimento({
        ...base,
        source_type: linhaDeSaldoDe(a.categoria),   // escritorio | das | inss
        valor: a.valor,
        sem_debito: true,
        // Liga a trilha à quitação da guia — ver writesDeOrigemDestino().
        obligation_id: a.obligation_id ?? null,
        notes: `Cascata: saldo de ${linhaDeSaldoDe(a.categoria)} do cliente ${a.client_id} → ${a.categoria} (fatia da guia, sem debitar o lançamento)`,
      }))
      continue
    }
    if (a.de_lucro > 0.005) {
      out.push(movimento({
        ...base, source_type: SOURCE_PROFIT, valor: a.de_lucro,
        notes: `Cascata: cliente ${a.client_id} lucro → ${destino}`,
      }))
    }
    if (a.de_servico > 0.005) {
      out.push(movimento({
        ...base, source_type: SOURCE_SERVICE, valor: a.de_servico,
        notes: `Cascata: cliente ${a.client_id} serviço → ${destino}`,
      }))
    }
  }
  return out
}

// ── MOVIMENTOS A PARTIR DO ?action=pagar-distribuido ───────────────────────────────────
//
// ⚠️ Aqui o destino é APROXIMADO, e a distinção importa.
//
// Aquele endpoint soma todas as categorias num pool único e consome os payables do mês
// mais antigo ao mais novo; a quebra por categoria sobrevive só como texto em
// `payable_payments.notes`. Então:
//
//   ORIGEM  (cliente, competência, lucro × serviço)  → EXATA, sai do payable consumido
//   DESTINO (qual categoria)                         → RATEADO proporcionalmente
//
// É o mesmo rateio que `proportionalCats()` já faz na tela para ler o histórico, e não uma
// segunda regra: uma sessão de "Lucros 8.000 + Pró-labore 900" que consome R$ 900 de um
// payable atribui 8/8,9 a lucros e 0,9/8,9 a pró-labore. O `notes` de cada linha diz que
// foi rateado, para ninguém ler a fatia como fato.
//
// A alternativa seria não rastrear este fluxo — mas ele é o do Flow B e o da edição de
// sessão, e um buraco na trilha é pior que uma fatia declaradamente proporcional.
export function movimentosDoConsumo({ applied = [], lista = [], despesas = {} }) {
  const porId = new Map(lista.map((r) => [r.id, r]))
  const cats = Object.entries(despesas)
    .map(([k, v]) => [k, num(v)])
    .filter(([, v]) => v > 0.005)
  const totalCats = r2(cats.reduce((s, [, v]) => s + v, 0))
  const out = []

  for (const ap of applied) {
    const rec = porId.get(ap.id)
    if (!rec) continue
    const { de_lucro, de_servico } = quebrarConsumo(rec, ap.consumed)
    // Sem categoria alguma (não deveria acontecer: o handler exige total > 0) a sessão
    // inteira vira um destino genérico, em vez de sumir do rastreamento.
    const fatias = totalCats > 0
      ? cats.map(([k, v]) => [k, v / totalCats])
      : [['lucros', 1]]

    for (const [origem, valorOrigem] of [[SOURCE_PROFIT, de_lucro], [SOURCE_SERVICE, de_servico]]) {
      if (valorOrigem <= 0.005) continue
      // Resíduo do arredondamento na MAIOR fatia — mesma regra de `ratear()` na apuração.
      // Sem isso a soma dos movimentos não fecha com o consumido, e a trilha "perde" centavos.
      const partes = fatias.map(([k, peso]) => [k, r2(valorOrigem * peso)])
      const soma = r2(partes.reduce((s, [, v]) => s + v, 0))
      const residuo = r2(valorOrigem - soma)
      if (Math.abs(residuo) >= 0.01 && partes.length) {
        const maior = partes.reduce((a, b) => (b[1] > a[1] ? b : a))
        maior[1] = r2(maior[1] + residuo)
      }
      for (const [categoria, valor] of partes) {
        if (valor <= 0.005) continue
        const destino = categoria
        out.push(movimento({
          payable_id: ap.id, client_id: ap.client_id, month: ap.month, year: ap.year,
          source_type: origem, destino, valor,
          notes: `Cascata: cliente ${ap.client_id} ${origem === SOURCE_PROFIT ? 'lucro' : 'serviço'} → ${destino} · fatia proporcional da sessão`,
        }))
      }
    }
  }
  return out
}

// ── ABSORÇÃO DE IMPOSTO (Opção 2, reativada em 2026-08-15) ────────────────────────────
//
// Quando o imposto real passa da provisão retida na NF, o excedente é descontado do que o
// Victor recebe — do lucro primeiro, do serviço no que não couber (`aplicarDelta`). Isso é
// dinheiro saindo dele para o fisco, e por isso vira linha de `payment_sources`.
//
// ⚠️ O REGISTRO NÃO MORA DENTRO DE `aplicarDelta()` NEM DE `cascataDoLucro()`, como a
// especificação pedia — as duas são funções PURAS e `lib/victor-recorte.js` as chama a
// cada GET da aba, para desenhar a cascata. Um `await registrarOrigemDestino()` ali
// gravaria linhas novas a cada vez que alguém abre a tela: a tabela encheria de duplicatas
// só de navegar, sem nenhum pagamento ter acontecido. O registro mora no ponto de
// GRAVAÇÃO (`?action=recalcular` com `aplicar: true`), na mesma transação do UPDATE.
//
// ⚠️ `destination_category = 'impostos'`, e não `das`/`inss`/`escritorio`. O valor
// absorvido é o EXCEDENTE sobre a provisão — ele não pertence a um tributo específico:
// a provisão de 7% cobre parte de cada um, e dizer "R$ 47,05 foram para o DAS" seria uma
// atribuição inventada. `impostos` diz a verdade disponível: foi para tributo, sem
// escolher qual.
//
// `payment_id` fica NULL: absorção não é pagamento — é redução do que se tem a receber.
// A visão Rastreio a mostra em seção própria, fora do histórico de pagamentos.
export const DESTINO_ABSORCAO = 'impostos'

// Movimentos de uma absorção. Uma linha por ORIGEM (lucro e serviço), nunca uma só
// somando as duas: é justamente a divisão entre elas que a cascata decide, e colapsá-la
// apagaria a única informação que o registro acrescenta.
// ⚠️ O VALOR PODE SER NEGATIVO, e essa é a metade da história que quase se perdeu.
//
// `aplicarDelta` trata os dois sentidos: quando o imposto real fica ABAIXO da provisão
// retida (o caso comum — a NF reserva 7% e o Simples cobra ~6%), o delta é negativo e a
// sobra VOLTA para o lucro do Victor. Filtrar só valores positivos registraria os descontos
// e esconderia as devoluções: o payable #45 teve o lucro subindo de 377,04 para 1.250,47 e
// não haveria linha nenhuma explicando de onde vieram os R$ 873,43.
//
// Uma linha negativa aqui significa "o imposto devolveu", e a soma da coluna passa a ser o
// efeito LÍQUIDO do tributo sobre o que o Victor recebe.
export function movimentosDaAbsorcao({ payable, from_profit = 0, from_service = 0, etapa = 2, real = 0, provisionado = 0 }) {
  const out = []
  const excedente = r2(real - provisionado)
  const nome = etapa >= 3 ? 'guia oficial' : 'apuração do mês'
  const base = {
    payable_id: payable.id, client_id: payable.client_id,
    month: payable.month, year: payable.year, destino: DESTINO_ABSORCAO,
  }
  const nota = (origem, valor) => (valor < 0
    ? `Devolução de imposto (${nome}): a provisão da NF (${r2(provisionado).toFixed(2)}) passou do imposto real `
      + `(${r2(real).toFixed(2)}); ${r2(-valor).toFixed(2)} voltaram para ${origem}`
    : `Absorção de imposto (${nome}): ${origem} cobriu parte do excedente de ${excedente.toFixed(2)} `
      + `(imposto real ${r2(real).toFixed(2)} − provisão da NF ${r2(provisionado).toFixed(2)})`)

  if (Math.abs(r2(from_profit)) > 0.005) {
    out.push(movimento({ ...base, source_type: SOURCE_PROFIT, valor: from_profit, notes: nota('o lucro', from_profit) }))
  }
  if (Math.abs(r2(from_service)) > 0.005) {
    out.push(movimento({ ...base, source_type: SOURCE_SERVICE, valor: from_service, notes: nota('o serviço', from_service) }))
  }
  return out
}

// Fragmentos SQL da absorção, para a transação do `?action=recalcular`.
//
// ⚠️ Começa APAGANDO as absorções anteriores daquele payable. O recalcular é idempotente
// por construção (mede sempre contra o baseline da FATURA, nunca contra o payable já
// ajustado), e o rastreamento tem de ser também: sem o DELETE, aplicar duas vezes — ou
// lançar a guia depois de já ter apurado — somaria uma segunda absorção sobre a primeira e
// a tabela afirmaria o dobro do que saiu.
//
// `payment_id IS NULL` no filtro protege o que é pagamento: uma linha de absorção nunca
// tem pagamento, e uma linha de pagamento nunca deve morrer aqui.
export function writesDeAbsorcao(sql, { company_id, payable_id, movimentos = [] }) {
  // ⚠️ O filtro NÃO olha o texto de `notes`.
  //
  // A primeira versão usava `notes LIKE 'Absorção de imposto%'` e as linhas de DEVOLUÇÃO
  // começam com "Devolução de imposto" — o DELETE não as alcançava e cada reprocessamento
  // somava uma cópia (14 linhas viraram 17 na segunda passada). O que identifica a linha é
  // o par (destino `impostos`, sem pagamento) na competência daquele payable; a redação da
  // nota é para humano ler, não para o motor casar.
  const writes = [sql`
    DELETE FROM payment_sources
    WHERE company_id = ${company_id}
      AND destination_category = ${DESTINO_ABSORCAO}
      AND payment_id IS NULL
      AND (month, year, client_id) IN (
        SELECT month, year, client_id FROM payables_victor WHERE id = ${payable_id}
      )`]
  for (const m of movimentos) {
    writes.push(sql`
      INSERT INTO payment_sources
        (company_id, source_type, client_id, month, year,
         destination_category, amount, payment_id, notes, created_at, updated_at)
      VALUES (${company_id}, ${m.source_type}, ${m.client_id ?? null}, ${m.month}, ${m.year},
              ${m.destino}, ${m.valor}, NULL, ${m.notes ?? null}, NOW(), NOW())`)
  }
  return writes
}

// ── GRAVAÇÃO ──────────────────────────────────────────────────────────────────────────

// Fragmentos SQL (não-aguardados) para entrar na MESMA `sql.transaction` do pagamento.
//
// `notes_sessao` é a string gravada em `payable_payments.notes` — é ela, com `when` e o
// payable, que identifica o pagamento recém-inserido. Tem de ser exatamente a mesma que o
// INSERT do pagamento usou, senão o SELECT não casa e a linha some sem erro.
export function writesDeOrigemDestino(sql, { company_id, movimentos = [], when, notes_sessao }) {
  return movimentos.map((m) => (m.sem_debito
    // Fatia do rateio paga sem debitar lançamento: não há `payable_payments` a localizar,
    // então o INSERT é direto e `payment_id` fica NULL. Usar o SELECT aqui gravaria zero
    // linhas — a trilha sumiria justamente no caminho novo.
    // ⚠️ `fiscal_payment_id` sai de um SELECT pelo mesmo motivo do `payment_id`: o driver
    // não devolve RETURNING dentro da transação em lote, e o INSERT da quitação já está
    // antes nesta mesma lista. A FK é ON DELETE CASCADE — estornar a guia em /fiscal leva
    // a trilha junto, sem código de limpeza. Sem esse elo a linha ficaria órfã afirmando
    // um pagamento desfeito.
    ? sql`
      INSERT INTO payment_sources
        (company_id, source_type, client_id, month, year,
         destination_category, amount, payment_id, fiscal_payment_id, notes,
         created_at, updated_at)
      SELECT ${company_id}, ${m.source_type}, ${m.client_id ?? null},
             ${m.month}, ${m.year}, ${m.destino}, ${m.valor}, NULL, fp.id, ${m.notes ?? null},
             NOW(), NOW()
      FROM fiscal_payments fp
      WHERE fp.obligation_id = ${m.obligation_id ?? null} AND fp.paid_at = ${when}
      ORDER BY fp.id DESC LIMIT 1`
    : sql`
    INSERT INTO payment_sources
      (company_id, source_type, client_id, month, year,
       destination_category, amount, payment_id, notes, created_at, updated_at)
    SELECT ${company_id}, ${m.source_type}, ${m.client_id ?? null}, ${m.month}, ${m.year},
           ${m.destino}, ${m.valor}, pp.id, ${m.notes ?? null}, NOW(), NOW()
    FROM payable_payments pp
    WHERE pp.payable_type = 'victor' AND pp.payable_id = ${m.payable_id}
      AND pp.paid_at = ${when} AND pp.notes = ${notes_sessao}
    ORDER BY pp.id DESC LIMIT 1`))
}

// INSERT avulso, para quando o `payment_id` JÁ é conhecido (fora de transação em lote) —
// é o caso da compensação do Fabrício, que não passa por `payable_payments`.
export async function registrarOrigemDestino(sql, opts) {
  const {
    company_id, source_type, client_id = null, month, year,
    destination_category, amount, payment_id = null,
    fabricio_compensation_id = null, notes = null,
  } = opts
  const rows = await sql`
    INSERT INTO payment_sources
      (company_id, source_type, client_id, month, year,
       destination_category, amount, payment_id, fabricio_compensation_id, notes,
       created_at, updated_at)
    VALUES (${company_id}, ${source_type}, ${client_id}, ${month}, ${year},
            ${destination_category}, ${r2(amount)}, ${payment_id},
            ${fabricio_compensation_id}, ${notes}, NOW(), NOW())
    RETURNING *`
  return rows[0]
}

// ── LEITURA E LIMPEZA ─────────────────────────────────────────────────────────────────

export async function listarOrigemDestinoPagamento(sql, payment_id) {
  return sql`
    SELECT ps.*, c.name AS client_name
    FROM payment_sources ps
    LEFT JOIN clients c ON c.id = ps.client_id
    WHERE ps.payment_id = ${payment_id}
    ORDER BY ps.created_at, ps.id`
}

// A FK é ON DELETE CASCADE, então apagar o `payable_payments` já limpa a trilha. Esta
// função existe para o caso de se querer refazer SÓ o rastreamento de um pagamento que
// continua válido — reprocessar histórico, por exemplo — sem tocar no dinheiro.
export async function limparOrigemDestinoPagamento(sql, payment_id) {
  return sql`DELETE FROM payment_sources WHERE payment_id = ${payment_id} RETURNING id`
}
