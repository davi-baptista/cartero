import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ApiClient } from '../api/client'
import { API_URL } from '../config'
import { secureCredentialStore } from './secure-store'
import { INITIAL_SESSION, SessionMachine } from './session-machine'
import type { SessionState } from './types'

/**
 * Liga a máquina de sessão ao estado do React.
 *
 * O provider não decide nada: toda transição vive em `SessionMachine`, que é
 * testável sem runtime nativo. Aqui só existe a ponte — e é por isso que este
 * arquivo não tem lógica de credencial para revisar.
 */

interface SessionContextValue {
  state: SessionState
  api: ApiClient
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(INITIAL_SESSION)

  /*
    Cliente e máquina criados UMA vez. Recriá-los a cada render descartaria o
    access token em memória e o refresh em voo — o app renovaria a sessão sem
    parar, e a coordenação de concorrência deixaria de existir na prática.
  */
  const refs = useRef<{ api: ApiClient; machine: SessionMachine } | null>(null)

  if (!refs.current) {
    const api = new ApiClient({
      baseUrl: API_URL,
      store: secureCredentialStore,
      onSessionLost: () => refs.current?.machine.handleSessionLost(),
    })
    const machine = new SessionMachine({
      api,
      store: secureCredentialStore,
      emit: setState,
    })
    refs.current = { api, machine }
  }

  const { api, machine } = refs.current

  useEffect(() => {
    void machine.bootstrap()
  }, [machine])

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      api,
      signIn: (email, password) => machine.signIn(email, password),
      signOut: () => machine.signOut(),
    }),
    [state, api, machine],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession precisa estar dentro de <SessionProvider>')
  }
  return context
}
