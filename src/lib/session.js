// Sessão do usuário no browser: token em localStorage + interceptor de fetch.

const KEY = 'gestao_serv_token'

export const getToken = () => localStorage.getItem(KEY)
export const setToken = (t) => localStorage.setItem(KEY, t)
export const clearToken = () => localStorage.removeItem(KEY)

// Lê o payload do JWT sem validar assinatura — serve só para exibir nome e
// decidir o que mostrar na tela. Quem valida de verdade é o backend; nunca
// confie nisto para autorização.
export function getUser() {
  const token = getToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export const isLoggedIn = () => getUser() !== null
export const isMaster = () => Boolean(getUser()?.master)

export function logout() {
  clearToken()
  window.location.href = '/login'
}

// Injeta o Authorization em toda chamada /api/ e trata 401 de forma central.
// Feito por interceptor, e não editando as 41 chamadas espalhadas em 10
// arquivos: esquecer uma delas seria uma requisição sem token, quebrando em
// produção de forma silenciosa.
export function installFetchInterceptor() {
  const original = window.fetch
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '')
    const isApi = url.startsWith('/api/') || url.includes('/api/')

    if (isApi) {
      const token = getToken()
      if (token) {
        const headers = new Headers(
          init.headers || (typeof input !== 'string' ? input.headers : undefined) || {}
        )
        headers.set('Authorization', `Bearer ${token}`)
        init = { ...init, headers }
      }
    }

    const res = await original(input, init)

    // Token expirado ou inválido: derruba a sessão e volta pro login.
    // O /api/login fica de fora — lá o 401 é "senha errada", não sessão morta.
    if (res.status === 401 && isApi && !url.includes('/api/login')) {
      clearToken()
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return res
  }
}
