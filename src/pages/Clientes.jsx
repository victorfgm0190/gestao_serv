import { useState, useEffect } from 'react'
import { useCNPJConsulta, aplicarDados } from '../lib/useCNPJConsulta'

const COMPANIES = [
  { id: 1, name: 'Lumen', badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/40' },
  { id: 2, name: 'Imperium', badge: 'bg-purple-500/20 text-purple-300 border border-purple-500/40' },
]

// Campos fiscais do TOMADOR — o que a NFS-e precisa saber sobre o cliente.
const CAMPOS_FISCAIS = [
  ['razao_social', 'Razão social', 'Como consta no CNPJ'],
  ['endereco', 'Logradouro', 'Rua, avenida…'],
  ['numero', 'Número', ''],
  ['complemento', 'Complemento', 'Sala, andar…'],
  ['bairro', 'Bairro', ''],
  ['cep', 'CEP', '8 dígitos'],
  ['municipio_codigo', 'Município (IBGE)', '7 dígitos'],
  ['uf', 'UF', 'PR'],
  ['inscricao_municipal', 'Inscrição municipal', 'Opcional'],
  ['email', 'E-mail', ''],
  ['telefone', 'Telefone', ''],
]

// Campo do formulário → campo devolvido por /api/consultar-cnpj.
const DE_PARA_CNPJ = {
  razao_social: 'razao_social', endereco: 'endereco', numero: 'numero',
  complemento: 'complemento', bairro: 'bairro', cep: 'cep',
  municipio_codigo: 'municipio_codigo', uf: 'uf', email: 'email', telefone: 'telefone',
}

const emptyForm = {
  name: '', company_ids: [], cpf_cnpj: '',
  ...Object.fromEntries(CAMPOS_FISCAIS.map(([k]) => [k, ''])),
}

export default function Clientes() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { fetchClients() }, [])

  async function fetchClients() {
    setLoading(true)
    try {
      const res = await fetch('/api/clients')
      const data = await res.json()
      setClients(data.clients || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const { consultar, loading: consultandoCnpj, erro: erroCnpj, aviso: avisoCnpj, limpar: limparCnpj } = useCNPJConsulta()
  const [resultadoCnpj, setResultadoCnpj] = useState(null)
  const [sobrescrever, setSobrescrever] = useState(false)

  // ⚠️ Busca por BOTÃO, não por debounce enquanto se digita. O debounce do
  // esboço dependia de `consultar` na lista de dependências do efeito — e como
  // ele era recriado a cada render, a consulta virava laço infinito contra uma
  // API que limita por IP. E, mesmo funcionando, sobrescreveria o que a pessoa
  // acabou de corrigir à mão.
  async function buscarCnpj() {
    setResultadoCnpj(null)
    const dados = await consultar(form.cpf_cnpj)
    if (!dados) return
    const r = aplicarDados(form, dados, DE_PARA_CNPJ, { sobrescrever })
    setForm((f) => ({ ...f, ...r.form, cpf_cnpj: dados.cnpj }))
    setResultadoCnpj({ ...r, municipio: dados.municipio })
  }

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setResultadoCnpj(null)
    limparCnpj()
    setShowModal(true)
  }

  function openEdit(client) {
    setEditing(client)
    setForm({
      ...emptyForm,
      name: client.name,
      company_ids: [...(client.company_ids || [])],
      cpf_cnpj: client.cpf_cnpj || '',
      // Coluna nula vira '': um <input value={null}> deixa de ser controlado.
      ...Object.fromEntries(CAMPOS_FISCAIS.map(([k]) => [k, client[k] ?? ''])),
    })
    setError('')
    setResultadoCnpj(null)
    limparCnpj()
    setShowModal(true)
  }

  function toggleCompany(id) {
    setForm(f => ({
      ...f,
      company_ids: f.company_ids.includes(id)
        ? f.company_ids.filter(c => c !== id)
        : [...f.company_ids, id],
    }))
  }

  async function save() {
    if (!form.name.trim()) { setError('Informe o nome do cliente.'); return }
    if (form.company_ids.length === 0) { setError('Selecione ao menos uma empresa.'); return }
    setSaving(true)
    setError('')
    try {
      const url = editing ? `/api/clients?id=${editing.id}` : '/api/clients'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          company_ids: form.company_ids,
          cpf_cnpj: form.cpf_cnpj,
          ...Object.fromEntries(CAMPOS_FISCAIS.map(([k]) => [k, form[k]])),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Falha ao salvar')
      }
      setShowModal(false)
      fetchClients()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    try {
      await fetch(`/api/clients?id=${id}`, { method: 'DELETE' })
      setConfirmDelete(null)
      fetchClients()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Clientes</h2>
          <p className="text-gray-400 text-sm mt-1">Gerencie os clientes e as empresas às quais pertencem</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Novo Cliente
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Carregando...</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-4xl mb-3">👥</p>
          <p>Nenhum cliente cadastrado.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Empresas</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
                <tr key={client.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-white">{client.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(client.company_ids || []).map(cid => {
                        const c = COMPANIES.find(x => x.id === cid)
                        if (!c) return null
                        return (
                          <span key={cid} className={`px-2 py-0.5 rounded-md text-xs font-medium ${c.badge}`}>
                            {c.name}
                          </span>
                        )
                      })}
                      {(client.company_ids || []).length === 0 && (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {confirmDelete === client.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-gray-400 text-xs">Confirmar?</span>
                        <button
                          onClick={() => remove(client.id)}
                          className="text-red-400 hover:text-red-300 text-xs font-medium"
                        >
                          Excluir
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-gray-500 hover:text-gray-300 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(client)}
                          className="text-gray-400 hover:text-blue-400 text-xs transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setConfirmDelete(client.id)}
                          className="text-gray-400 hover:text-red-400 text-xs transition-colors"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">
              {editing ? 'Editar cliente' : 'Novo cliente'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Nome</label>
                <input
                  autoFocus
                  placeholder="Nome do cliente"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Empresas</label>
                <div className="space-y-2">
                  {COMPANIES.map(c => (
                    <label key={c.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.company_ids.includes(c.id)}
                        onChange={() => toggleCompany(c.id)}
                        className="w-4 h-4 rounded accent-blue-500"
                      />
                      <span className="text-sm text-gray-200">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* ---- dados fiscais (NFS-e) ---- */}
              <div className="border-t border-gray-800 pt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                  Dados fiscais — usados na NFS-e
                </p>

                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">CPF / CNPJ</label>
                <div className="flex gap-2">
                  <input
                    placeholder="00.000.000/0000-00"
                    value={form.cpf_cnpj}
                    onChange={e => setForm(f => ({ ...f, cpf_cnpj: e.target.value }))}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={buscarCnpj}
                    disabled={consultandoCnpj || form.cpf_cnpj.replace(/\D/g, '').length !== 14}
                    title="Buscar dados na Receita Federal"
                    className="px-3 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm whitespace-nowrap transition-colors"
                  >
                    {consultandoCnpj ? '⏳' : '🔍'} Buscar
                  </button>
                </div>

                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input type="checkbox" checked={sobrescrever}
                    onChange={e => setSobrescrever(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-blue-500" />
                  <span className="text-xs text-gray-400">
                    Substituir campos já preenchidos
                  </span>
                </label>

                {erroCnpj && <p className="text-red-400 text-xs mt-2">❌ {erroCnpj}</p>}
                {avisoCnpj && <p className="text-amber-400 text-xs mt-2">⚠️ {avisoCnpj}</p>}
                {resultadoCnpj && !erroCnpj && (
                  <p className="text-xs mt-2 text-green-400">
                    ✅ {resultadoCnpj.municipio ? `${resultadoCnpj.municipio} — ` : ''}
                    {resultadoCnpj.preenchidos.length} campo(s) preenchido(s)
                    {/* Dizer o que NÃO foi tocado é o ponto: sem isso, a pessoa
                        supõe que tudo veio da Receita e não confere o que ficou. */}
                    {resultadoCnpj.mantidos.length > 0 && (
                      <span className="text-amber-400">
                        {' '}· {resultadoCnpj.mantidos.length} mantido(s) com o valor que já estava
                        ({resultadoCnpj.mantidos.join(', ')})
                      </span>
                    )}
                  </p>
                )}

                <div className="grid md:grid-cols-2 gap-3 mt-4">
                  {CAMPOS_FISCAIS.map(([k, rotulo, dica]) => (
                    <div key={k} className={k === 'endereco' ? 'md:col-span-2' : ''}>
                      <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">{rotulo}</label>
                      <input
                        placeholder={dica}
                        value={form[k]}
                        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
