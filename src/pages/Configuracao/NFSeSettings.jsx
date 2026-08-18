import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'

// Configuração do certificado digital A1 usado para assinar a NFS-e.
//
// ⚠️ A empresa vem do switcher da sidebar (`activeCompany`), como em todas as
// outras telas. O esboço trazia um <select> próprio: com dois seletores de
// empresa na mesma página — um na sidebar, outro no meio da tela — a barra
// lateral diria "Imperium" enquanto o certificado exibido é o da Lumen.
//
// ⚠️ Nenhuma chamada monta o header Authorization à mão. O interceptor global
// de src/lib/session.js o injeta em toda requisição /api/. O esboço lia
// `localStorage.getItem('jwt')`, e a chave real é `gestao_serv_token` — daria
// `Bearer null` (hoje o interceptor sobrescreveria e salvaria a chamada, o que
// é pior: o erro ficaria latente até alguém mudar o interceptor).

// Conversão em pedaços. `btoa(String.fromCharCode(...new Uint8Array(buf)))`
// espalha um argumento por byte e estoura a pilha em arquivos grandes — um
// .pfx costuma ter poucos KB, mas o erro seria "Maximum call stack size
// exceeded" no upload, sem relação aparente com certificado.
function bufferParaBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const PEDACO = 0x8000
  let binario = ''
  for (let i = 0; i < bytes.length; i += PEDACO) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + PEDACO))
  }
  return btoa(binario)
}

const dataBR = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—')

function Selo({ status, dias }) {
  const mapa = {
    expired: ['🔴', 'text-red-400', 'EXPIRADO'],
    critical: ['🟠', 'text-orange-400', `CRÍTICO (${dias} dias)`],
    warning: ['🟡', 'text-yellow-400', `AVISO (${dias} dias)`],
    ok: ['✅', 'text-green-400', `OK (${dias} dias)`],
    not_yet_valid: ['⏳', 'text-blue-400', 'AINDA NÃO VIGENTE'],
  }
  // Status desconhecido não pode render nada em branco — o esboço devolvia
  // null no default e a linha simplesmente sumia.
  const [icone, cor, texto] = mapa[status] || ['❔', 'text-gray-400', String(status || 'desconhecido')]
  return (
    <span className={`font-bold ${cor}`}>
      {icone} {texto}
    </span>
  )
}

export default function NFSeSettings() {
  const { activeCompany } = useOutletContext()

  const [certInfo, setCertInfo] = useState(null)
  const [arquivo, setArquivo] = useState(null)
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [mensagem, setMensagem] = useState(null) // { tipo: 'ok'|'erro', texto }

  const buscarStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch(`/api/nfse-certificate?company_id=${activeCompany.id}`)
      const data = await res.json()
      setCertInfo(data?.certificate || null)
    } catch (err) {
      console.error('Erro ao buscar status do certificado:', err)
      setCertInfo(null)
      setMensagem({ tipo: 'erro', texto: `Não foi possível consultar o certificado: ${err.message}` })
    } finally {
      setLoadingStatus(false)
    }
  }, [activeCompany.id])

  useEffect(() => {
    // Trocar de empresa limpa o formulário: senha digitada para a Lumen não
    // pode ficar no campo enquanto a tela já mostra o certificado da Imperium.
    setArquivo(null)
    setSenha('')
    setMensagem(null)
    buscarStatus()
  }, [buscarStatus])

  const enviar = async () => {
    if (!arquivo || !senha) return
    setLoading(true)
    setMensagem(null)
    try {
      const base64 = bufferParaBase64(await arquivo.arrayBuffer())
      const res = await fetch('/api/nfse-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificate_base64: base64,
          password: senha,
          company_id: activeCompany.id,
        }),
      })
      const data = await res.json()

      // `res.ok` e não `data.success`: um 400 com {error} não traz success, e
      // sem checar o status um erro cairia no ramo de sucesso silenciosamente.
      if (!res.ok) {
        setMensagem({ tipo: 'erro', texto: data?.error || `Falha (HTTP ${res.status})` })
        return
      }

      setSenha('')
      setArquivo(null)
      const aviso = data.validade && !data.validade.valid ? ` ⚠️ ${data.validade.reason}.` : ''
      setMensagem({ tipo: 'ok', texto: `Certificado salvo com segurança.${aviso}` })
      await buscarStatus()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setLoading(false)
    }
  }

  const remover = async () => {
    if (!confirm(
      `Remover o certificado da ${activeCompany.name}?\n\n` +
      'Sem ele não é possível assinar NFS-e. O arquivo .pfx não fica guardado ' +
      'em outro lugar — será preciso enviá-lo de novo.'
    )) return

    setLoading(true)
    setMensagem(null)
    try {
      const res = await fetch(`/api/nfse-certificate?company_id=${activeCompany.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        setMensagem({ tipo: 'erro', texto: data?.error || `Falha (HTTP ${res.status})` })
        return
      }
      setCertInfo(null)
      setMensagem({ tipo: 'ok', texto: 'Certificado removido.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setLoading(false)
    }
  }

  const dias = certInfo?.dias_restantes

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-white">🔐 Certificado NFS-e</h1>
        <span
          className="px-2 py-1 rounded text-xs font-medium text-white"
          style={{ backgroundColor: activeCompany.color }}
        >
          {activeCompany.name}
        </span>
      </div>

      {/* STATUS */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">📊 Status do certificado</h2>

        {loadingStatus ? (
          <p className="text-gray-400">Verificando…</p>
        ) : certInfo ? (
          <div className="space-y-4">
            <div className="p-4 bg-gray-800 rounded border border-gray-700">
              <p><Selo status={certInfo.status} dias={dias} /></p>
              <p className="text-sm text-gray-300 mt-1">
                {certInfo.status === 'expired'
                  ? (dias <= -1
                    ? `Expirou há ${Math.abs(dias)} dia(s), em ${dataBR(certInfo.valid_until)}`
                    : `Expirou hoje (${dataBR(certInfo.valid_until)})`)
                  : `Vence em ${dataBR(certInfo.valid_until)}`}
              </p>
            </div>

            <div className="p-4 bg-gray-800 rounded border border-gray-700 text-sm text-gray-300 space-y-2">
              <p><strong>Titular:</strong> {certInfo.subject}</p>
              <p>
                <strong>Thumbprint:</strong>{' '}
                <code className="text-xs bg-gray-900 px-2 py-1 rounded break-all">
                  {certInfo.thumbprint?.slice(0, 32)}…
                </code>
              </p>
              <p><strong>Válido desde:</strong> {dataBR(certInfo.valid_from)}</p>
              <p><strong>Enviado em:</strong> {dataBR(certInfo.uploaded_at)}</p>
            </div>

            <button
              onClick={remover}
              disabled={loading}
              className="px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-sm rounded transition-colors"
            >
              🗑️ Remover certificado
            </button>
          </div>
        ) : (
          <p className="text-gray-400">Nenhum certificado configurado para a {activeCompany.name}.</p>
        )}
      </section>

      {/* UPLOAD */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-bold text-white">
          📤 {certInfo ? 'Substituir certificado' : 'Carregar certificado'}
        </h2>

        <div>
          <span className="text-sm font-semibold text-gray-300">Arquivo .pfx</span>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
              📎 Selecionar arquivo
              <input
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => setArquivo(e.target.files[0] || null)}
                className="hidden"
              />
            </label>
            {arquivo && (
              <span className="text-sm text-gray-300">
                {arquivo.name} <span className="text-gray-500">({(arquivo.size / 1024).toFixed(1)} KB)</span>
              </span>
            )}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-gray-300">Senha do certificado</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha do arquivo .pfx"
            className="mt-2 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <button
          onClick={enviar}
          disabled={loading || !senha || !arquivo}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded transition-colors"
        >
          {loading ? '⏳ Salvando…' : '💾 Salvar certificado'}
        </button>

        {mensagem && (
          <div
            className={`p-3 rounded text-sm border ${
              mensagem.tipo === 'ok'
                ? 'bg-green-900/30 text-green-300 border-green-700'
                : 'bg-red-900/30 text-red-300 border-red-700'
            }`}
          >
            {mensagem.tipo === 'ok' ? '✅ ' : '❌ '}{mensagem.texto}
          </div>
        )}
      </section>

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 space-y-2">
        <p>
          ℹ️ <strong>Certificado A1:</strong> arquivo <code>.pfx</code> emitido por uma
          autoridade certificadora ICP-Brasil. Vale 1 ano e é o que assina a NFS-e.
        </p>
        <p>
          🔒 O arquivo e a senha são gravados <strong>cifrados</strong> (AES-256-GCM) e nunca
          voltam para o navegador — a tela só lê titular, validade e thumbprint.
        </p>
        <p>
          🔔 Um alerta é enviado por e-mail a 30 e a 7 dias do vencimento, e quando ele vence.
        </p>
      </section>
    </div>
  )
}
