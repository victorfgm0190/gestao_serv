import { neon } from '@neondatabase/serverless'
import { requireMaster, hashPassword, isMasterUsername } from '../lib/auth.js'
import { ensureUsersTable } from '../lib/users-table.js'

// Gestão de usuários — exclusiva do administrador master (ADMIN_USER).
export default async function handler(req, res) {
  if (!requireMaster(req, res)) return

  const sql = neon(process.env.DATABASE_URL)

  try {
    await ensureUsersTable(sql)

    if (req.method === 'GET') {
      // password_hash nunca sai daqui.
      const users = await sql`
        SELECT id, name, username, is_admin, is_active, created_at
        FROM users ORDER BY name ASC`
      return res.status(200).json({ users })
    }

    if (req.method === 'POST') {
      const { name, username, password, is_admin, is_active } = req.body || {}
      if (!name?.trim() || !username?.trim() || !password) {
        return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios' })
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' })
      }
      // Impede criar uma linha que sombreie o master do ambiente.
      if (isMasterUsername(username.trim())) {
        return res.status(400).json({ error: 'Este nome de usuário é reservado ao administrador master.' })
      }

      const existing = await sql`SELECT id FROM users WHERE username = ${username.trim()} LIMIT 1`
      if (existing.length) return res.status(409).json({ error: 'Já existe um usuário com esse login' })

      const rows = await sql`
        INSERT INTO users (name, username, password_hash, is_admin, is_active)
        VALUES (${name.trim()}, ${username.trim()}, ${hashPassword(password)}, ${Boolean(is_admin)}, ${is_active === undefined ? true : Boolean(is_active)})
        RETURNING id, name, username, is_admin, is_active, created_at`
      return res.status(201).json({ user: rows[0] })
    }

    if (req.method === 'PUT') {
      const id = req.query.id || req.body?.id
      const { name, username, password, is_admin, is_active } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id obrigatório' })

      const current = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`
      if (!current.length) return res.status(404).json({ error: 'Usuário não encontrado' })

      if (username && isMasterUsername(username.trim())) {
        return res.status(400).json({ error: 'Este nome de usuário é reservado ao administrador master.' })
      }
      if (username && username.trim() !== current[0].username) {
        const dup = await sql`SELECT id FROM users WHERE username = ${username.trim()} AND id <> ${id} LIMIT 1`
        if (dup.length) return res.status(409).json({ error: 'Já existe um usuário com esse login' })
      }
      if (password !== undefined && password !== '' && String(password).length < 6) {
        return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' })
      }

      // Senha em branco = manter a atual.
      const newHash = password ? hashPassword(password) : current[0].password_hash

      const rows = await sql`
        UPDATE users SET
          name = ${name?.trim() || current[0].name},
          username = ${username?.trim() || current[0].username},
          password_hash = ${newHash},
          is_admin = ${is_admin === undefined ? current[0].is_admin : Boolean(is_admin)},
          is_active = ${is_active === undefined ? current[0].is_active : Boolean(is_active)}
        WHERE id = ${id}
        RETURNING id, name, username, is_admin, is_active, created_at`
      return res.status(200).json({ user: rows[0] })
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id
      if (!id) return res.status(400).json({ error: 'id obrigatório' })
      const rows = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`
      if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' })
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[users] falha:', error)
    return res.status(500).json({ error: error.message })
  }
}
