import { useState, useEffect, useCallback } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { useCNPJConsulta, aplicarDados } from '../../lib/useCNPJConsulta'

// Campo do formulário → campo devolvido por /api/consultar-cnpj.
// `municipio_codigo` vem do IBGE (ver a advertência em api/consultar-cnpj.js).
const DE_PARA_CNPJ = {
  razao_social: 'razao_social', nome_fantasia: 'nome_fantasia',
  endereco: 'endereco', numero: 'numero', complemento: 'complemento',
  bairro: 'bairro', cep: 'cep', municipio_codigo: 'municipio_codigo',
  uf: 'uf', email: 'email', telefone: 'telefone',
}

// Dados do emitente da NFS-e.
//
// ⚠️ Sem lucide-react (não é dependência) e sem header Authorization à mão — o
// interceptor de src/lib/session.js injeta o token, e a chave é
// `gestao_serv_token`, não `jwt`.
//
// ⚠️ Nenhum campo vem pré-preenchido. O esboço trazia município `4106902`
// ("Londrina por padrão" — 4106902 é CURITIBA; Londrina é 4113700), NBS
// `11501100` e tributação `01.06.01` como valores iniciais. O município é o
// campo que decide QUAL PREFEITURA recebe o ISS: um default plausível é o jeito
// mais fácil de emitir a nota inteira na cidade errada e só descobrir na
// fiscalização.
//
// ⚠️ E são campos livres, não <select> com três opções. Os códigos NBS (9
// dígitos) e o item da lista da LC 116 vêm do contador e variam por serviço;
// uma lista fechada de valores inventados impede o usuário de digitar o código
// certo dele.

const CAMPOS_TEXTO = [
  ['razao_social', 'Razão social', 'Como consta no CNPJ', true],
  ['nome_fantasia', 'Nome fantasia', '', false],
  ['cnpj', 'CNPJ', 'Só números ou com máscara', true],
  // Opcional no Emissor Nacional — mas várias prefeituras a exigem, por isso a
  // dica diz isso em vez de só marcar o campo como dispensável.
  ['inscricao_municipal', 'Inscrição municipal (opcional)', 'Opcional no Emissor Nacional; algumas prefeituras exigem', false],
  ['endereco', 'Logradouro', 'Rua, avenida…', true],
  ['numero', 'Número', '', true],
  ['complemento', 'Complemento', 'Sala, andar…', false],
  ['bairro', 'Bairro', '', true],
  ['municipio_codigo', 'Código IBGE do município', '7 dígitos — decide a prefeitura do ISS', true],
  ['uf', 'UF', 'SP, PR…', true],
  ['cep', 'CEP', '8 dígitos', true],
  ['telefone', 'Telefone', '', false],
  ['email', 'E-mail', '', false],
  ['item_lista_servico', 'Item da lista de serviços (LC 116)', 'Ex.: 01.06 — obrigatório na DPS', true],
  ['codigo_tributacao_municipal', 'Código de tributação municipal', 'Opcional — código da prefeitura', false],
  ['cnae', 'CNAE', 'Opcional', false],
  ['nbs', 'NBS', 'Opcional — 9 dígitos', false],
]

const vazioParaCampo = Object.fromEntries([
  ...CAMPOS_TEXTO.map(([k]) => [k, '']),
  ['aliquota_iss', ''], ['ambiente', '2'], ['serie', '00001'],
  ['opta_simples', '3'], ['regime_especial', '0'],
])

export default function NFSeEmitterSettings() {
  const { activeCompany } = useOutletContext()

  const [form, setForm] = useState(vazioParaCampo)
  const [validacao, setValidacao] = useState(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)
  const [okMsg, setOkMsg] = useState(null)
  const { consultar, loading: consultandoCnpj, erro: erroCnpj, aviso: avisoCnpj } = useCNPJConsulta()
  const [resultadoCnpj, setResultadoCnpj] = useState(null)
  const [sobrescrever, setSobrescrever] = useState(false)

  const validar = useCallback(async () => {
    try {
      const res = await fetch(`/api/nfse-validate-setup?company_id=${activeCompany.id}`)
      const data = await res.json()
      setValidacao(res.ok ? data : null)
    } catch (err) {
      console.error('Erro ao validar setup:', err)
      setValidacao(null)
    }
  }, [activeCompany.id])

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null); setOkMsg(null)
    try {
      const res = await fetch(`/api/nfse-emitter-settings?company_id=${activeCompany.id}`)
      const data = await res.json()
      // ⚠️ Coluna nula vira '' — um <input value={null}> vira não-controlado e
      // o React reclama, além de o campo parar de refletir o estado.
      const s = data?.settings || {}
      setForm({
        ...vazioParaCampo,
        ...Object.fromEntries(Object.keys(vazioParaCampo).map((k) => [k, s[k] ?? vazioParaCampo[k]])),
      })
    } catch (err) {
      setErro(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeCompany.id])

  useEffect(() => { carregar(); validar() }, [carregar, validar])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Busca por botão, não por debounce — ver a advertência em useCNPJConsulta.js.
  const buscarCnpj = async () => {
    setResultadoCnpj(null)
    const dados = await consultar(form.cnpj)
    if (!dados) return
    const r = aplicarDados(form, dados, DE_PARA_CNPJ, { sobrescrever })
    setForm((f) => ({ ...f, ...r.form, cnpj: dados.cnpj }))
    setResultadoCnpj({ ...r, municipio: dados.municipio })
  }

  const salvar = async () => {
    setSalvando(true); setErro(null); setOkMsg(null)
    try {
      const res = await fetch('/api/nfse-emitter-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: activeCompany.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) { setErro(data?.error || `Falha (HTTP ${res.status})`); return }
      setOkMsg('Dados salvos.')
      // Recarrega do banco: os campos são normalizados no servidor (CNPJ e CEP
      // ficam só com dígitos, UF em maiúsculas) e a tela tem de mostrar o que
      // foi realmente gravado, não o que foi digitado.
      await carregar()
      await validar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  const producao = String(form.ambiente) === '1'

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-white">🏢 Emitente NFS-e</h1>
        <span className="px-2 py-1 rounded text-xs font-medium text-white"
          style={{ backgroundColor: activeCompany.color }}>
          {activeCompany.name}
        </span>
      </div>

      {validacao && (
        <div className={`p-4 rounded-lg border ${
          validacao.pronto ? 'bg-green-900/25 border-green-700' : 'bg-amber-900/20 border-amber-700'
        }`}>
          <p className={`font-bold ${validacao.pronto ? 'text-green-300' : 'text-amber-300'}`}>
            {validacao.pronto ? '✅ ' : '⚠️ '}{validacao.mensagem}
          </p>
          {validacao.campos_faltantes?.length > 0 && (
            <ul className="text-sm mt-2 space-y-0.5 text-amber-200 list-disc list-inside">
              {validacao.campos_faltantes.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          {validacao.acao && <p className="text-sm mt-2 text-gray-300">{validacao.acao}</p>}
          {validacao.certificado?.presente && validacao.certificado.valido && (
            <p className="text-xs mt-2 text-gray-400">
              Certificado: {validacao.certificado.titular} · vence em {validacao.certificado.dias_restantes} dias
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Carregando…</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          {/* Busca por CNPJ — preenche razão social, endereço e o código IBGE
              do município, que é o campo mais fácil de errar digitando. */}
          <div className="p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
            <span className="text-sm font-semibold text-gray-300 mb-1 block">
              Buscar dados pelo CNPJ
            </span>
            <div className="flex gap-2">
              <input
                type="text" value={form.cnpj} onChange={set('cnpj')}
                placeholder="00.000.000/0000-00"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={buscarCnpj}
                disabled={consultandoCnpj || String(form.cnpj).replace(/\D/g, '').length !== 14}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-sm whitespace-nowrap transition-colors"
              >
                {consultandoCnpj ? '⏳' : '🔍'} Buscar
              </button>
            </div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input type="checkbox" checked={sobrescrever}
                onChange={(e) => setSobrescrever(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <span className="text-xs text-gray-400">Substituir campos já preenchidos</span>
            </label>
            {erroCnpj && <p className="text-red-400 text-xs mt-2">❌ {erroCnpj}</p>}
            {avisoCnpj && <p className="text-amber-400 text-xs mt-2">⚠️ {avisoCnpj}</p>}
            {resultadoCnpj && !erroCnpj && (
              <p className="text-xs mt-2 text-green-400">
                ✅ {resultadoCnpj.municipio ? `${resultadoCnpj.municipio} — ` : ''}
                {resultadoCnpj.preenchidos.length} campo(s) preenchido(s)
                {resultadoCnpj.mantidos.length > 0 && (
                  <span className="text-amber-400">
                    {' '}· {resultadoCnpj.mantidos.length} mantido(s): {resultadoCnpj.mantidos.join(', ')}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {CAMPOS_TEXTO.map(([k, rotulo, dica, obrigatorio]) => (
              <label key={k} className={`block ${k === 'endereco' || k === 'item_lista_servico' ? 'md:col-span-2' : ''}`}>
                <span className="text-sm font-semibold text-gray-300 mb-1 block">
                  {rotulo} {obrigatorio && <span className="text-amber-400">*</span>}
                </span>
                <input
                  type="text" value={form[k]} onChange={set(k)} placeholder={dica}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </label>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-4 border-t border-gray-800 pt-4">
            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Alíquota ISS padrão (%)</span>
              <input type="number" step="0.01" min="0" max="100" value={form.aliquota_iss}
                onChange={set('aliquota_iss')} placeholder="Ex.: 2,00"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none" />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Série</span>
              <input type="text" value={form.serie} onChange={set('serie')}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-blue-500 focus:outline-none" />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-gray-300 mb-1 block">Ambiente</span>
              <select value={String(form.ambiente)} onChange={set('ambiente')}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-blue-500 focus:outline-none">
                <option value="2">2 — Homologação (sem valor fiscal)</option>
                <option value="1">1 — Produção (nota real)</option>
              </select>
            </label>
          </div>

          {/* Trocar para produção é a única mudança desta tela que passa a
              gerar documento fiscal de verdade. Sem o aviso, é um item a mais
              num formulário. */}
          {producao && (
            <div className="p-3 bg-red-900/25 border border-red-700/60 rounded text-red-300 text-sm">
              ⚠️ Em <strong>produção</strong> as notas emitidas são reais e ficam registradas na Receita.
              Confirme antes uma emissão em homologação.
            </div>
          )}

          {erro && <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">❌ {erro}</div>}
          {okMsg && <div className="p-3 bg-green-900/30 border border-green-700 rounded text-green-300 text-sm">✅ {okMsg}</div>}

          <button onClick={salvar} disabled={salvando}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded transition-colors">
            {salvando ? '💾 Salvando…' : '💾 Salvar'}
          </button>

          {/* Salvar parcial é permitido: a configuração fiscal é preenchida em
              várias sessões, e o que ainda falta aparece no painel acima. */}
          <p className="text-xs text-gray-500 text-center">
            Pode salvar incompleto — os campos que faltarem aparecem no aviso acima.
          </p>
        </div>
      )}

      <div className="p-4 bg-gray-800 rounded-lg text-sm text-gray-300 space-y-1">
        <p>🔐 O certificado A1 é enviado em{' '}
          <Link to="/configuracao/nfse" className="text-blue-400 hover:underline">Certificado NFS-e</Link>.</p>
        <p>👥 O CNPJ e o endereço de cada tomador são preenchidos em{' '}
          <Link to="/clientes" className="text-blue-400 hover:underline">Clientes</Link>.</p>
      </div>
    </div>
  )
}
