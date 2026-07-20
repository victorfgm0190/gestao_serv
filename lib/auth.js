import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Autenticação por JWT (HS256) sobre node:crypto. Sem dependência externa:
// jsonwebtoken/bcrypt não estão instalados e o ambiente não permite instalar.
// scrypt e HMAC-SHA256 são primitivas nativas e adequadas para os dois usos.

const TOKEN_TTL_SECONDS = 8 * 60 * 60   // 8 horas

function secret() {
  const s = process.env.JWT_SECRET
  // Falha FECHADA: sem segredo, nenhum token é emitido nem aceito. Melhor o
  // app parar do que assinar com um valor padrão previsível.
  if (!s || s.length < 16) return null
  return s
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function eq(a, b) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// ---------- senhas ----------

export function hashPassword(password) {
  const salt = randomBytes(16)
  const key = scryptSync(String(password), salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const [alg, saltHex, keyHex] = stored.split('$')
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false
  try {
    const key = scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64)
    return eq(key, Buffer.from(keyHex, 'hex'))
  } catch {
    return false
  }
}

// ---------- tokens ----------

export function signToken(payload, ttl = TOKEN_TTL_SECONDS) {
  const s = secret()
  if (!s) return null
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttl }))
  const sig = createHmac('sha256', s).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function verifyToken(token) {
  const s = secret()
  if (!s || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts

  // Assinatura recalculada sempre com HS256; o alg do header nunca decide o
  // algoritmo (evita alg confusion / alg:none).
  const expected = createHmac('sha256', s).update(`${head}.${body}`).digest('base64url')
  if (!eq(sig, expected)) return null

  let payload
  try {
    if (JSON.parse(Buffer.from(head, 'base64url').toString()).alg !== 'HS256') return null
    payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  } catch {
    return null
  }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

// ---------- master admin (via env) ----------

// Master vem do ambiente e sempre entra, mesmo sem linha na tabela users —
// é a saída caso o banco fique sem nenhum admin ativo.
export function checkMasterCredentials(username, password) {
  const u = process.env.ADMIN_USER
  const p = process.env.ADMIN_PASS
  if (!u || !p) return false
  // Compara os dois lados sempre, para não vazar por tempo qual deles errou.
  const okUser = eq(String(username || ''), u)
  const okPass = eq(String(password || ''), p)
  return okUser && okPass
}

export function isMasterUsername(username) {
  const u = process.env.ADMIN_USER
  return Boolean(u) && String(username || '') === u
}

// ---------- middlewares ----------

// Exige token válido. Retorna o payload, ou null (e já respondeu 401/503).
export function requireAuth(req, res) {
  if (!secret()) {
    res.status(503).json({ error: 'JWT_SECRET não configurado no servidor.' })
    return null
  }
  const header = req.headers?.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token ? verifyToken(token) : null
  if (!payload) {
    res.status(401).json({ error: 'Não autenticado' })
    return null
  }
  return payload
}

// Exige o master admin (ADMIN_USER). Usado na gestão de usuários.
export function requireMaster(req, res) {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!user.master) {
    res.status(403).json({ error: 'Apenas o administrador master pode acessar.' })
    return null
  }
  return user
}

export { TOKEN_TTL_SECONDS }
