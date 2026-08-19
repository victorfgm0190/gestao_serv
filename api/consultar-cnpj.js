import { requireAuth } from '../lib/auth.js'

// Consulta de CNPJ na BrasilAPI (que espelha a base pública da Receita).
//
// 🔒 requireAuth: sem ele a rota nasce pública e o deploy vira um proxy de
// consulta de CNPJ para qualquer um. A BrasilAPI limita por IP de origem, e o
// IP é o da função — o abuso de terceiros derrubaria a consulta para o Victor.
//
// ⚠️ O ESBOÇO LIA OS CAMPOS DA API ERRADA. A URL é da BrasilAPI, mas
// `data.nome`, `data.fantasia`, `data.telefone`, `data.situacao` e
// `data.municipio?.nome` são nomes da **ReceitaWS**. Conferido contra a
// resposta real: os quatro primeiros são AUSENTES, e `municipio` é uma STRING
// ("LONDRINA"), não um objeto — `municipio?.codigo` dá undefined. Razão social
// sairia só pelo fallback; nome fantasia, telefone, município e o código do
// município viriam VAZIOS. O código do município é o campo mais crítico da
// NFS-e.

const URL_BASE = process.env.CNPJ_API_URL || 'https://brasilapi.com.br/api/cnpj/v1'
const TIMEOUT_MS = 8000

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')
const ouNulo = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Dígitos verificadores do CNPJ. Evita gastar a cota da API com número inválido. */
export function cnpjValido(cnpj) {
  const d = soDigitos(cnpj)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (base) => {
    let peso = base.length - 7
    let soma = 0
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--
      if (peso < 2) peso = 9
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13])
}

/** Resposta da BrasilAPI → os campos que as telas gravam. */
export function mapearCNPJ(d) {
  return {
    cnpj: soDigitos(d.cnpj),
    razao_social: ouNulo(d.razao_social),
    nome_fantasia: ouNulo(d.nome_fantasia),
    endereco: ouNulo(d.logradouro),
    numero: ouNulo(d.numero),
    complemento: ouNulo(d.complemento),
    bairro: ouNulo(d.bairro),
    cep: soDigitos(d.cep) || null,
    municipio: ouNulo(d.municipio),

    // ⚠️ `codigo_municipio_ibge`, NUNCA `codigo_municipio`. A resposta traz os
    // DOIS: para Londrina, `codigo_municipio` é 7667 (código da RFB) e
    // `codigo_municipio_ibge` é 4113700. A NFS-e usa o IBGE — gravar o outro
    // manda a nota para uma prefeitura que não existe nesse cadastro, e o erro
    // só aparece na rejeição (ou pior, na fiscalização).
    municipio_codigo: soDigitos(d.codigo_municipio_ibge) || null,

    uf: ouNulo(d.uf)?.toUpperCase().slice(0, 2) || null,
    email: ouNulo(d.email),
    // A BrasilAPI já entrega DDD+número juntos em `ddd_telefone_1`.
    telefone: soDigitos(d.ddd_telefone_1) || null,
    situacao: ouNulo(d.descricao_situacao_cadastral),
    ativa: String(d.descricao_situacao_cadastral || '').toUpperCase() === 'ATIVA',
  }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const bruto = req.query.cnpj
  if (!bruto) return res.status(400).json({ error: 'CNPJ é obrigatório' })

  const cnpj = soDigitos(bruto)
  if (cnpj.length !== 14) {
    return res.status(400).json({
      error: `CNPJ deve ter 14 dígitos (recebido: ${cnpj.length})`, tipo: 'formato',
    })
  }
  if (!cnpjValido(cnpj)) {
    // Checar o dígito aqui evita queimar a cota da API — que é por IP e
    // compartilhada por todo mundo que usa o deploy.
    return res.status(400).json({ error: 'CNPJ inválido (dígito verificador)', tipo: 'invalido' })
  }

  try {
    const r = await fetch(`${URL_BASE}/${cnpj}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'gestao_serv/1.0' },
    })

    if (r.status === 404) {
      return res.status(404).json({ error: 'CNPJ não encontrado na Receita Federal', tipo: 'nao_encontrado' })
    }
    // ⚠️ 403 e 429 são o caso COMUM, não exceção: a BrasilAPI limita por IP e
    // recusa consultas de datacenter em rajada — reproduzido aqui, com 403
    // numa chamada e 200 na seguinte. O esboço não tratava nenhum dos dois e
    // eles caíam no 500 genérico com "Request failed with status code 403",
    // que não diz à pessoa que basta tentar de novo.
    if (r.status === 403 || r.status === 429) {
      return res.status(429).json({
        error: 'Consulta temporariamente bloqueada pelo provedor (limite de requisições). Tente de novo em alguns segundos.',
        tipo: 'limite',
      })
    }
    if (!r.ok) {
      return res.status(502).json({ error: `Provedor respondeu ${r.status}`, tipo: 'provedor' })
    }

    const dados = mapearCNPJ(await r.json())

    return res.status(200).json({
      success: true,
      dados,
      // Situação cadastral é aviso, não bloqueio: emitir nota para empresa
      // baixada é decisão de quem fatura, não do formulário.
      aviso: dados.ativa ? null : `Situação cadastral na Receita: ${dados.situacao || 'desconhecida'}`,
    })
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError'
    console.error('[consultar-cnpj] falha:', err.name, err.message)
    return res.status(timeout ? 504 : 502).json({
      error: timeout
        ? 'A consulta demorou demais. Tente novamente.'
        : 'Não foi possível consultar o CNPJ agora.',
      tipo: timeout ? 'timeout' : 'rede',
    })
  }
}
