import { useEffect, useRef } from 'react'

export default function useNotifications(activeCompany) {
  const lastCountRef = useRef(null)
  const permissionRef = useRef(false)

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        permissionRef.current = perm === 'granted'
      })
    } else if (Notification.permission === 'granted') {
      permissionRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!activeCompany) return

    async function checkNewDemands() {
      try {
        const res = await fetch(`/api/demands?company_id=${activeCompany.id}`)
        const data = await res.json()
        const demands = data.demands || []
        const novas = demands.filter(d => d.status === 'nova').length

        if (lastCountRef.current !== null && novas > lastCountRef.current && permissionRef.current) {
          const diff = novas - lastCountRef.current
          new Notification(`Gestão Serv — ${activeCompany.name}`, {
            body: `${diff} nova(s) demanda(s) recebida(s)!`,
            icon: '/favicon.ico',
          })
        }
        lastCountRef.current = novas
      } catch(e) {
        console.error('Erro ao verificar demandas:', e)
      }
    }

    checkNewDemands()
    const interval = setInterval(checkNewDemands, 60000)
    return () => clearInterval(interval)
  }, [activeCompany])
}
