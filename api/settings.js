import { neon } from '@neondatabase/serverless'
import { requireAuth } from '../lib/auth.js'

// Configuração fiscal por empresa (regime, faturamento médio mensal, salários CLT, ISS)
// e os parâmetros da apuração: `prolabore_percentual` (base do Fator R),
// `prolabore_minimo` (piso, acompanha o salário mínimo e muda todo janeiro) e
// `honorarios_mensal`. Upsert por company_id.
//
// Esta é a única rota que escreve em company_settings — não criar endpoint paralelo
// para os mesmos campos.
//
// O pró-labore em si NÃO é guardado: é derivado do faturamento pelos parâmetros
// (proLaboreDoMes em lib/taxCalc.js). A coluna prolabore_mensal existiu como cache
// desse cálculo e foi removida — três lugares a recalculavam de formas diferentes.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  const sql = neon(process.env.DATABASE_URL)

  if (req.method === 'GET') {
    const { company_id } = req.query
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      SELECT * FROM company_settings WHERE company_id = ${company_id} LIMIT 1`
    return res.status(200).json({ data: rows[0] || null })
  }

  if (req.method === 'POST') {
    const {
      company_id, regime, faturamento_medio_mensal, salarios_mensal, iss_percent,
      prolabore_percentual, prolabore_minimo, honorarios_mensal,
    } = req.body
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      INSERT INTO company_settings
        (company_id, regime, faturamento_medio_mensal, salarios_mensal, iss_percent,
         prolabore_percentual, prolabore_minimo, honorarios_mensal, updated_at)
      VALUES
        (${company_id}, ${regime || 'simples_iii'}, ${faturamento_medio_mensal || 0},
         ${salarios_mensal || 0}, ${iss_percent ?? 5},
         ${prolabore_percentual ?? 0.28}, ${prolabore_minimo ?? 1621}, ${honorarios_mensal ?? 150}, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        regime = EXCLUDED.regime,
        faturamento_medio_mensal = EXCLUDED.faturamento_medio_mensal,
        salarios_mensal = EXCLUDED.salarios_mensal,
        iss_percent = EXCLUDED.iss_percent,
        prolabore_percentual = EXCLUDED.prolabore_percentual,
        prolabore_minimo = EXCLUDED.prolabore_minimo,
        honorarios_mensal = EXCLUDED.honorarios_mensal,
        updated_at = NOW()
      RETURNING *`
    return res.status(200).json({ data: rows[0] })
  }

  // PATCH: atualização parcial — só mexe nos campos enviados (COALESCE mantém o resto).
  // Usado pelo Billing.jsx para gravar só o faturamento do mês após emitir a fatura,
  // sem sobrescrever regime, salários, ISS ou os parâmetros já cadastrados.
  if (req.method === 'PATCH') {
    const {
      company_id, regime, faturamento_medio_mensal, salarios_mensal, iss_percent,
      prolabore_percentual, prolabore_minimo, honorarios_mensal,
    } = req.body
    if (!company_id) return res.status(400).json({ error: 'company_id é obrigatório' })
    const rows = await sql`
      UPDATE company_settings SET
        regime = COALESCE(${regime ?? null}, regime),
        faturamento_medio_mensal = COALESCE(${faturamento_medio_mensal ?? null}, faturamento_medio_mensal),
        salarios_mensal = COALESCE(${salarios_mensal ?? null}, salarios_mensal),
        iss_percent = COALESCE(${iss_percent ?? null}, iss_percent),
        prolabore_percentual = COALESCE(${prolabore_percentual ?? null}::numeric, prolabore_percentual),
        prolabore_minimo = COALESCE(${prolabore_minimo ?? null}::numeric, prolabore_minimo),
        honorarios_mensal = COALESCE(${honorarios_mensal ?? null}::numeric, honorarios_mensal),
        updated_at = NOW()
      WHERE company_id = ${company_id}
      RETURNING *`
    if (!rows.length) {
      // Sem linha ainda: cria com os campos enviados; os demais caem no default da tabela.
      const created = await sql`
        INSERT INTO company_settings
          (company_id, regime, faturamento_medio_mensal, salarios_mensal, iss_percent,
           prolabore_percentual, prolabore_minimo, honorarios_mensal, updated_at)
        VALUES
          (${company_id}, ${regime || 'simples_iii'}, ${faturamento_medio_mensal || 0},
           ${salarios_mensal || 0}, ${iss_percent ?? 5},
           ${prolabore_percentual ?? 0.28}, ${prolabore_minimo ?? 1621}, ${honorarios_mensal ?? 150}, NOW())
        RETURNING *`
      return res.status(200).json({ data: created[0] })
    }
    return res.status(200).json({ data: rows[0] })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
