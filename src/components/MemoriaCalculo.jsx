import { KIND_LABEL } from '../lib/fiscalLabels'

// MEMÓRIA DE CÁLCULO — "de onde veio esse número?".
//
// Nada é calculado aqui: fórmulas e valores chegam prontos no `calculo` do GET de
// api/fiscal-obligations.js, montado pelo mesmo caminho que o ?action=apurar usa para
// gravar. Se este componente recalculasse qualquer coisa, a explicação poderia divergir
// do valor explicado — que é justamente o defeito que ele existe para eliminar.
//
// Componente, e não trecho de tela, porque duas telas o mostram: /fiscal (a apuração em
// si) e o card de Previsão de Impostos do /financial.

const fmt = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Um passo: a fórmula à esquerda, o valor à direita.
// `gravado` só aparece quando o recálculo de agora difere do que está na obrigação —
// não é erro, é o mês tendo mudado depois da apuração.
function Passo({ n, titulo, formula, valor, gravado, tom = 'normal', nota }) {
  const cor = tom === 'destaque' ? 'border-amber-500/40 bg-amber-500/10' : 'border-gray-800 bg-gray-900/60'
  return (
    <div className={`rounded-xl border ${cor} p-3`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className={`text-xs font-medium ${tom === 'destaque' ? 'text-amber-300' : 'text-white'}`}>
          <span className="text-gray-600 mr-1.5">{n}.</span>{titulo}
        </p>
        {valor !== undefined && (
          <p className={`text-sm font-semibold tabular-nums ${tom === 'destaque' ? 'text-amber-300' : 'text-white'}`}>
            {fmt(valor)}
          </p>
        )}
      </div>
      {formula && (
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-gray-400 break-words">{formula}</p>
      )}
      {nota && <p className="mt-1 text-[11px] text-gray-500">{nota}</p>}
      {gravado?.divergente && (
        <p className="mt-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1">
          Gravado na apuração: {fmt(gravado.estimado)}
          {gravado.guia !== null && <> · guia oficial {fmt(gravado.guia)}</>}
          {' '}— o mês mudou desde então. Reapure para alinhar.
        </p>
      )}
    </div>
  )
}

// `aviso` é um nó opcional logo abaixo do título: o /financial usa para avisar que o
// card acima calcula por outra base (RBT12 estimada) e por isso pode divergir daqui.
export default function MemoriaCalculo({ calculo, competencia, aviso = null }) {
  const c = calculo
  const semNf = c.faturas_sem_nf
  let n = 0
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-white font-semibold text-sm">Memória de cálculo — {competencia}</h3>
      <p className="text-gray-600 text-[11px] mb-4">
        O passo a passo que a apuração percorre, do faturamento do mês até o valor de cada guia.
        Previsão de caixa, não contabilidade formal.
      </p>

      {aviso}

      {!c.apuravel && (
        <p className="mb-4 text-amber-300 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          ⚠️ Sem faturamento tributável nesta competência — a apuração não gera obrigação aqui.
          Os valores abaixo são só a conta hipotética (o pró-labore no piso faz aparecer INSS mesmo com R$ 0,00 faturado).
        </p>
      )}

      <div className="space-y-2">
        <Passo n={++n} titulo="Faturamento do mês" valor={c.faturamento_total_mes}
          formula={`${c.faturas.total} fatura(s) emitida(s) na competência`} />

        {semNf.quantidade > 0 && (
          <Passo n={++n} titulo="Faturas sem NF (fora da apuração)" valor={semNf.valor} tom="destaque"
            formula={semNf.formula}
            nota={`${semNf.faturas.map((f) => `${f.client_name} ${fmt(f.invoice_value)}`).join(' · ')} — contrato que não emite nota: não entra no DAS, no INSS, no Fator R nem no rateio. Continua em A Receber.`} />
        )}

        <Passo n={++n} titulo="Base tributável" valor={c.faturamento_tributavel}
          formula={semNf.quantidade > 0 ? semNf.formula : `${c.faturas.tributaveis} fatura(s) com NF`} />

        <Passo n={++n} titulo="RBT12 — receita bruta dos 12 meses" valor={c.rbt12.valor}
          formula={c.rbt12.formula}
          nota={c.rbt12.proporcionalizado
            ? `Só ${c.rbt12.meses} mês(es) com faturamento: a receita é proporcionalizada para 12, o que pode jogar a empresa numa faixa mais alta do que o faturamento real sugere.`
            : null} />

        {c.fator_r && (
          <Passo n={++n} titulo="Fator R — decide o anexo" formula={c.fator_r.formula}
            nota={c.fator_r.atende
              ? 'Folha suficiente: Anexo III, mais barato.'
              : 'Folha abaixo de 28% da receita: cai no Anexo V, bem mais caro.'} />
        )}

        {c.anexo_simples && (
          <Passo n={++n} titulo={`Alíquota efetiva — Anexo ${c.anexo_simples.anexo}`}
            formula={c.anexo_simples.formula}
            nota="A alíquota efetiva é a nominal da faixa menos a parcela a deduzir, diluída na RBT12 — por isso difere da alíquota de tabela." />
        )}

        {c.das && (
          <Passo n={++n} titulo="DAS" valor={c.das.valor} formula={c.das.formula} gravado={c.das.gravado} />
        )}

        {c.itens_lucro_presumido && c.itens_lucro_presumido.map((i) => (
          <Passo key={i.label} n={++n} titulo={i.label} valor={i.value} />
        ))}

        <Passo n={++n} titulo="Pró-labore (base do INSS)" valor={c.prolabore.valor}
          formula={c.prolabore.formula}
          nota={c.prolabore.no_piso ? 'Elevado ao piso: o percentual sobre o faturamento daria menos.' : null} />

        <Passo n={++n} titulo="INSS" valor={c.inss.valor} formula={c.inss.formula} gravado={c.inss.gravado} />

        <Passo n={++n} titulo="Escritório (honorários contábeis)" valor={c.escritorio.valor}
          formula={c.escritorio.formula} gravado={c.escritorio.gravado} />
      </div>

      <div className="mt-4 pt-4 border-t border-gray-800 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-white text-sm font-semibold">Total apurado</p>
          <p className="font-mono text-[11px] text-gray-400 mt-0.5">{c.total.formula}</p>
        </div>
        <p className="text-white text-lg font-bold tabular-nums">{fmt(c.total.calculado)}</p>
      </div>

      {c.lancados_a_mao.length > 0 && (
        <p className="mt-3 text-[11px] text-gray-500">
          Fora da fórmula, lançados à mão: {c.lancados_a_mao.map((o) => `${KIND_LABEL[o.kind] || o.kind} ${fmt(o.valor)}`).join(' · ')}.
          A apuração não os recalcula — por isso sobrevivem a uma reapuração.
          {c.total.gravado !== null && <> Total gravado no mês, com eles: <strong className="text-gray-400">{fmt(c.total.gravado)}</strong>.</>}
        </p>
      )}
    </div>
  )
}
