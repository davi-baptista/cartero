import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { ApiClient } from '../api/client'
import { API_URL } from '../config'
import { snapshotStore } from '../../modules/cartero-widget-snapshot/src'
import { SnapshotSync } from '../widget/snapshot-sync'
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
  const refs = useRef<{
    api: ApiClient
    machine: SessionMachine
    snapshot: SnapshotSync
  } | null>(null)

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
    const snapshot = new SnapshotSync({
      store: snapshotStore,
      fetchBudget: ({ month, year }) =>
        api.authorized(`/budget?month=${month}&year=${year}`),
      /*
        Lê o estado ATUAL da máquina, não uma cópia capturada no closure. O
        dono do snapshot precisa ser quem está logado no instante da escrita —
        um valor congelado gravaria a conta anterior depois de uma troca.
      */
      currentOwnerId: () => {
        const session = machine.getState()
        return session.status === 'signedIn' ? (session.user?.id ?? null) : null
      },
    })

    refs.current = { api, machine, snapshot }
  }

  const { api, machine, snapshot } = refs.current

  useEffect(() => {
    void machine.bootstrap()
  }, [machine])

  /*
    O snapshot acompanha a sessão, sem interferir nela.

    `void` é deliberado: uma falha de sync não pode derrubar o login. O
    Budget pode estar fora do ar enquanto a autenticação está perfeitamente
    boa, e nesse caso o usuário continua dentro do app — só o widget fica com
    dado mais velho.
  */
  useEffect(() => {
    if (state.status === 'signedIn') void snapshot.sync()
  }, [state.status, snapshot])

  /*
    Voltar para o primeiro plano é a única chance de perceber o que mudou na
    web enquanto o app estava fechado. Só dispara com sessão ativa: sem ela
    não há o que buscar, e o sync sairia pelo caminho de "sem sessão".
  */
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active' && machine.getState().status === 'signedIn') {
        void snapshot.sync()
      }
    }

    const subscription = AppState.addEventListener('change', onChange)
    return () => subscription.remove()
  }, [machine, snapshot])

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      api,
      signIn: (email, password) => machine.signIn(email, password),
      /*
        O snapshot é neutralizado ANTES de a sessão terminar. Na ordem
        inversa, uma falha entre as duas etapas deixaria a credencial removida
        e os valores da conta anterior intactos no disco — visíveis para quem
        instalasse um widget depois.
      */
      signOut: async () => {
        await snapshot.scrub()
        await machine.signOut()
      },
    }),
    [state, api, machine, snapshot],
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
