// Cria a tabela de usuários sob demanda. Idempotente e barato.
// Feito assim de propósito: migração por endpoint manual já se mostrou um
// gargalo neste projeto, e o login do master (que vem do env) precisa
// funcionar mesmo antes de qualquer migração rodar.
export async function ensureUsersTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    username VARCHAR(60) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`
}
