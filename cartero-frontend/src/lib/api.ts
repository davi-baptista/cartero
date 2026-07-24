import axios from 'axios'

const BASE_URL = '/api'
export const TOKEN_REFRESHED_EVENT = 'cartero:token-refreshed'

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('cartero-token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

let refreshPromise: Promise<string> | null = null

export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>(
        `${BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then(({ data }) => {
        if (!data.accessToken) {
          throw new Error('A API não retornou um access token')
        }

        localStorage.setItem('cartero-token', data.accessToken)
        api.defaults.headers.common.Authorization = `Bearer ${data.accessToken}`
        window.dispatchEvent(
          new CustomEvent<string>(TOKEN_REFRESHED_EVENT, {
            detail: data.accessToken,
          }),
        )

        return data.accessToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

function clearStoredSession() {
  localStorage.removeItem('cartero-token')
  localStorage.removeItem('cartero-user')
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      originalRequest._retry = true

      try {
        const newToken = await refreshAccessToken()
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshError) {
        clearStoredSession()
        if (window.location.pathname !== '/login') {
          window.location.replace('/login')
        }
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)
