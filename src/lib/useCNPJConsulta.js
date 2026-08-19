import { useState, useCallback } from 'react'

// Consulta de CNPJ para preencher formulário.
//
// ⚠️ `consultar` é memoizado com useCallback. Sem isso ele é uma função nova a
// cada render — e um `useEffect(..., [form.cnpj, consultar])`, como o esboço
// propunha, entra em laço infinito: a consulta faz setForm, o setForm
// re-renderiza, o re-render cria outro `consultar`, o efeito dispara de novo.
// Seriam requisições sem fim contra uma API que limita por IP.
//
// ⚠️ Sem header Authorization à mão — o interceptor de src/lib/session.js já o
// injeta em toda chamada /api/.

export function useCNPJConsulta() {
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [aviso, setAviso] = useState(null)

  const consultar = useCallback(async (cnpj) => {
    const digitos = String(cnpj ?? '').replace(/\D/g, '')
    if (digitos.length !== 14) {
      setErro('Informe um CNPJ com 14 dígitos.')
      return null
    }

    setLoading(true); setErro(null); setAviso(null)
    try {
      const res = await fetch(`/api/consultar-cnpj?cnpj=${digitos}`)
      const data = await res.json()
      if (!res.ok) {
        setErro(data?.error || `Falha na consulta (HTTP ${res.status})`)
        return null
      }
      if (data.aviso) setAviso(data.aviso)
      return data.dados
    } catch (err) {
      setErro(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const limpar = useCallback(() => { setErro(null); setAviso(null) }, [])

  return { consultar, loading, erro, aviso, limpar }
}

/**
 * Aplica os dados consultados a um formulário.
 *
 * ⚠️ Por padrão só preenche campo VAZIO. O esboço fazia
 * `dados.x || prev.x` dentro de um debounce automático, então a consulta
 * disparava enquanto se digitava e sobrescrevia o que a pessoa tinha acabado de
 * corrigir à mão — o caso comum ao editar um cliente cujo endereço na Receita
 * está desatualizado.
 *
 * @returns {{ form, preenchidos: string[], mantidos: string[] }}
 */
export function aplicarDados(form, dados, mapa, { sobrescrever = false } = {}) {
  const novo = { ...form }
  const preenchidos = []
  const mantidos = []

  for (const [campoForm, campoDados] of Object.entries(mapa)) {
    const valor = dados?.[campoDados]
    if (valor === null || valor === undefined || String(valor).trim() === '') continue

    const atual = form[campoForm]
    const vazio = atual === null || atual === undefined || String(atual).trim() === ''

    if (vazio || sobrescrever) {
      if (!vazio && String(atual) === String(valor)) continue // já igual, não conta
      novo[campoForm] = String(valor)
      preenchidos.push(campoForm)
    } else if (String(atual) !== String(valor)) {
      mantidos.push(campoForm)
    }
  }

  return { form: novo, preenchidos, mantidos }
}
