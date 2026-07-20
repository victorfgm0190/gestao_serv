import { neon } from '@neondatabase/serverless'
import { checkMasterCredentials, signToken, verifyPassword, TOKEN_TTL_SECONDS } from '../lib/auth.js'
import { ensureUsersTable } from '../lib/users-table.js'

// Único endpoint público da API (junto com o cron, que tem segredo próprio).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' })
  }

  try {
    // 1) Master admin do ambiente — funciona mesmo sem tabela/banco.
    if (checkMasterCredentials(username, password)) {
      const token = signToken({ sub: 'master', username: String(username), name: 'Administrador', master: true, is_admin: true })
      if (!token) return res.status(503).json({ error: 'JWT_SECRET não configurado no servidor.' })
      return res.status(200).json({
        token, expires_in: TOKEN_TTL_SECONDS,
        user: { username: String(username), name: 'Administrador', master: true, is_admin: true },
      })
    }

    // 2) Usuário da tabela.
    const sql = neon(process.env.DATABASE_URL)
    await ensureUsersTable(sql)
    const rows = await sql`SELECT * FROM users WHERE username = ${String(username)} LIMIT 1`
    const user = rows[0]

    // Mensagem única para usuário inexistente, senha errada e conta inativa —
    // não revela quais usuários existem.
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' })
    }

    const token = signToken({
      sub: String(user.id), username: user.username, name: user.name,
      master: false, is_admin: Boolean(user.is_admin),
    })
    if (!token) return res.status(503).json({ error: 'JWT_SECRET não configurado no servidor.' })

    return res.status(200).json({
      token, expires_in: TOKEN_TTL_SECONDS,
      user: { id: user.id, username: user.username, name: user.name, master: false, is_admin: Boolean(user.is_admin) },
    })
  } catch (error) {
    console.error('[login] falha:', error)
    return res.status(500).json({ error: 'Erro ao autenticar' })
  }
}
