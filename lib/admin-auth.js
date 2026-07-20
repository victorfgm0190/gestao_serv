// Proteção para endpoints administrativos (migrações, recálculos em massa).
// Falha FECHADA: sem segredo configurado no ambiente, nega tudo — assim um
// deploy sem a variável não reabre o endpoint para a internet.
//
// Uso:
//   curl -X POST https://.../api/x -H "Authorization: Bearer $ADMIN_SECRET"
//
// O segredo sai de ADMIN_SECRET; se não existir, cai em CRON_SECRET (que já
// está configurado na Vercel), para não exigir nova variável de imediato.
export function requireAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET
  if (!secret) {
    res.status(503).json({ error: 'ADMIN_SECRET não configurado. Endpoint desabilitado.' })
    return false
  }
  // Só header. Segredo em query string vaza em log de acesso e Referer.
  const header = req.headers['authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token || token !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}
