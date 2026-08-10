// Resolução da regra financeira de um lançamento — dono único.
//
// ⚠️ A regra vem do CONTRATO (`contracts.financial_rule_id`), NUNCA do cliente.
//
// Até 2026-08-10 os cinco pontos de cálculo (invoices POST/PUT, time-entries POST/PUT
// e recalc-time-entries) faziam `financial_rules WHERE client_id = X LIMIT 1` — sem
// ORDER BY. O Postgres devolvia o que estivesse primeiro no seq scan, ordem que muda
// com UPDATE, VACUUM ou troca de plano. O Bokada (client_id 13) tem duas regras:
// #8 (hora, split 100/0) e #12 (por_projeto, split 50/50). Um UPDATE na #8 reescreve
// a tupla no fim da heap e o LIMIT 1 passa a devolver a #12 — o split das faturas por
// hora vira 50/50 e o Fabrício começa a receber. Sem erro, sem aviso, direto no
// dinheiro. Nada no código detectaria: os dois valores são plausíveis.
//
// O vínculo correto já existia — `contracts.financial_rule_id`, com FK e preenchido
// em 10/10 contratos. Só não era lido. Este módulo é o único lugar que o lê, para que
// os cinco pontos não voltem a divergir; mesmo princípio de `lib/fiscal-lines.js` e
// `lib/fabricio-breakdown.js`.

// Carrega o contrato e a regra vinculada a ele.
// → { contrato, rule } | { error }
//
// Devolve o contrato junto porque quem precisa da regra quase sempre precisa dele
// também (deslocamento em `calcular`, `require_nf` na emissão da nota) — e assim a
// consulta acontece uma vez só.
export async function contratoComRegra(sql, contract_id, opts = {}) {
  if (!contract_id) {
    return { error: 'Lançamento sem contrato: a regra financeira vem do contrato, não do cliente.' }
  }

  // `WHERE id` é a PK — o LIMIT 1 aqui é redundante, não um desempate.
  const contratos = opts.company_id
    ? await sql`SELECT * FROM contracts WHERE id = ${contract_id} AND company_id = ${opts.company_id} LIMIT 1`
    : await sql`SELECT * FROM contracts WHERE id = ${contract_id} LIMIT 1`

  const contrato = contratos[0]
  if (!contrato) return { error: `Contrato ${contract_id} não encontrado.` }

  if (!contrato.financial_rule_id) {
    return { error: `O contrato "${contrato.name}" (id ${contrato.id}) não tem regra financeira vinculada. Vincule a regra em /contracts antes de lançar.` }
  }

  const regras = await sql`SELECT * FROM financial_rules WHERE id = ${contrato.financial_rule_id} LIMIT 1`
  if (!regras.length) {
    return { error: `A regra financeira ${contrato.financial_rule_id}, vinculada ao contrato "${contrato.name}", não existe mais.` }
  }

  return { contrato, rule: regras[0] }
}

// Contrato de uma fatura por agenda quando o modal não mandou nenhum.
// → { contract_id } | { error }
//
// O seletor de contrato do modal de agenda não é obrigatório (`saveAgendaInvoice`
// só exige cliente + apontamentos), e as 11 faturas antigas sem `contract_id` no
// banco são a prova de que a chamada sem ele acontece. Os apontamentos, esses,
// sempre têm contrato: a tela de horas o exige e as 63 linhas do banco o têm.
//
// Discordância entre eles é recusada em vez de arbitrada: faturar horas de dois
// contratos numa nota só aplicaria a regra de um deles ao valor do outro, que é a
// mesma classe de erro que este módulo existe para impedir.
export function contratoDosApontamentos(entries) {
  const ids = [...new Set((entries || []).map(e => e.contract_id).filter(Boolean))]
  if (ids.length === 1) return { contract_id: ids[0] }
  if (ids.length === 0) {
    return { error: 'Selecione o contrato: os apontamentos escolhidos não têm contrato vinculado.' }
  }
  return { error: `Os apontamentos selecionados pertencem a contratos diferentes (ids ${ids.join(', ')}). Fature um contrato por vez.` }
}
