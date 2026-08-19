import { useState } from 'react'

// Painel do XML assinado numa prévia: ver, baixar e copiar.
//
// Um componente só porque os quatro modais (emitir, cancelar, substituir,
// re-emitir) mostram o MESMO documento vindo do mesmo campo `xml_assinado` —
// quatro cópias divergiriam no dia em que o download ganhasse um cabeçalho ou
// a cópia um cuidado a mais.
//
// ⚠️ O XML fica em ESTADO do React, vindo por prop — nunca em `window`. Um
// global sobrevive ao fechamento do modal: reabri-lo para outra nota mostraria,
// e baixaria, o XML da nota anterior enquanto a prévia nova ainda carrega.
//
// ⚠️ É o XML ASSINADO, o mesmo que será transmitido. Uma prévia que mostrasse o
// documento sem assinatura estaria exibindo outro arquivo — e a assinatura é
// justamente o que o SEFIN recusa quando algo está errado nela.

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

export default function XmlPrevia({
  xml,
  nome = 'documento',
  titulo = 'Ver XML assinado',
  // Linhas extras no texto copiado (nº da nota, motivo…). É um ARRAY, não uma
  // string pronta: quem chama não precisa lidar com escape de quebra de linha,
  // e nulos/vazios caem fora sozinhos.
  contexto = null,
  aberto = false,
}) {
  const [erro, setErro] = useState(null)
  const [copiado, setCopiado] = useState(false)

  if (!xml) return null

  const baixar = () => {
    setErro(null)
    try {
      const href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
      const a = document.createElement('a')
      a.href = href
      a.download = `${String(nome).replace(/[^\w.-]/g, '') || 'documento'}.xml`
      // Anexar antes do clique: em alguns navegadores o clique num elemento
      // fora do documento é ignorado em silêncio.
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Sem o revoke, cada download deixa o arquivo preso na memória da aba.
      URL.revokeObjectURL(href)
    } catch (err) {
      setErro(`Não foi possível baixar: ${err.message}`)
    }
  }

  const copiar = async () => {
    setErro(null)
    try {
      const texto = [contexto, contexto ? '' : null, xml].filter((l) => l !== null).join('\n')
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch (err) {
      // clipboard exige contexto seguro (https/localhost) — dizer isso evita a
      // leitura de que o botão está quebrado.
      setErro(`Não foi possível copiar: ${err.message}. Use o download.`)
    }
  }

  return (
    <details className="text-xs" open={aberto}>
      <summary className="cursor-pointer text-gray-400 hover:text-gray-200">
        {titulo} <span className="text-gray-600">({kb(xml.length)})</span>
      </summary>

      {/* ⚠️ O XML é mostrado INTEIRO, não recortado em 500 caracteres: a
          assinatura fica no fim, e é ela o motivo mais comum de recusa. O
          painel rola. */}
      <pre className="mt-2 p-2 bg-gray-950 border border-gray-800 rounded max-h-48 overflow-auto text-[10px] text-gray-400 whitespace-pre-wrap break-all">
        {xml}
      </pre>

      <div className="flex flex-wrap gap-2 mt-2">
        <button
          type="button" onClick={baixar}
          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors"
        >
          ⬇️ Baixar XML
        </button>
        <button
          type="button" onClick={copiar}
          className="px-3 py-1 bg-purple-800 hover:bg-purple-700 text-white text-xs rounded transition-colors"
        >
          {copiado ? '✅ Copiado' : '📋 Copiar para depurar'}
        </button>
      </div>

      {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
    </details>
  )
}
