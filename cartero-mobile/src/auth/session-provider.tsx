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
import { InvoicesSync } from '../widget/invoices-sync'
import { syncWidgetSnapshots } from '../widget/sync-orchestrator'
import { SnapshotMutationCoordinator } from '../widget/snapshot-mutations'
import { WidgetPrivacyService } from '../widget/privacy-service'
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
  /** Autoridade única sobre a privacidade dos widgets. */
  privacy: WidgetPrivacyService
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
    invoices: InvoicesSync
    privacy: WidgetPrivacyService
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
    /*
      Um único coordenador para todos os escritores de snapshot.

      O sync do Budget, o sync de Invoices e o toggle de privacidade gravam
      arquivos que compartilham a mesma preferência. Sem a fila compartilhada,
      um sync lento terminaria depois de um toggle e sobrescreveria a escolha
      recém-feita — o usuário veria o ajuste ligado com o widget mascarado.
      Continua sendo UMA fila simples, não um coordinator por arquivo: o que
      importa é a ordem relativa entre TODOS os escritores, não isolar cada
      um dos outros.
    */
    const coordinator = new SnapshotMutationCoordinator()

    const currentOwnerId = () => {
      const session = machine.getState()
      return session.status === 'signedIn' ? (session.user?.id ?? null) : null
    }

    /*
      Mesma disciplina de `currentOwnerId`: lida no instante da escrita, nunca
      capturada — uma troca de conta entre o fetch e a gravação não pode
      deixar a timezone da conta anterior vazar para o snapshot da nova (TZ4).
    */
    const currentTimeZone = () => {
      const session = machine.getState()
      return session.status === 'signedIn'
        ? (session.user?.timeZone ?? null)
        : null
    }

    const privacy = new WidgetPrivacyService({
      store: snapshotStore,
      coordinator,
      currentOwnerId,
    })

    const snapshot = new SnapshotSync({
      store: snapshotStore,
      coordinator,
      hideAmounts: (ownerId) => privacy.getHideAmounts(ownerId),
      fetchBudget: ({ month, year }) =>
        api.authorized(`/budget?month=${month}&year=${year}`),
      /*
        Lê o estado ATUAL da máquina, não uma cópia capturada no closure. O
        dono do snapshot precisa ser quem está logado no instante da escrita —
        um valor congelado gravaria a conta anterior depois de uma troca.
      */
      currentOwnerId,
      currentTimeZone,
    })

    /*
      GET /invoices/actionable já é a authority completa de seleção, ordem e
      cardinalidade (M5A + M5A.1 + M5A.2) — o default de limit do backend é
      usado sem parâmetro, para não duplicar a mesma constante em dois
      lugares.
    */
    const invoices = new InvoicesSync({
      store: snapshotStore,
      coordinator,
      hideAmounts: (ownerId) => privacy.getHideAmounts(ownerId),
      fetchActionableInvoices: () => api.authorized('/invoices/actionable'),
      currentOwnerId,
    })

    refs.current = { api, machine, snapshot, invoices, privacy }
  }

  const { api, machine, snapshot, invoices, privacy } = refs.current

  useEffect(() => {
    void machine.bootstrap()
  }, [machine])

  /*
    Os snapshots acompanham a sessão, sem interferir nela.

    `void` é deliberado: uma falha de sync não pode derrubar o login. Budget
    ou Invoices podem estar fora do ar enquanto a autenticação está
    perfeitamente boa, e nesse caso o usuário continua dentro do app — só o
    widget correspondente fica com dado mais velho. `syncWidgetSnapshots`
    isola as duas falhas entre si (`Promise.allSettled`), então nenhuma das
    duas pode derrubar a outra por aqui.
  */
  useEffect(() => {
    if (state.status === 'signedIn') void syncWidgetSnapshots({ budget: snapshot, invoices })
  }, [state.status, snapshot, invoices])

  /*
    Voltar para o primeiro plano é a única chance de perceber o que mudou na
    web enquanto o app estava fechado. Só dispara com sessão ativa: sem ela
    não há o que buscar, e o sync sairia pelo caminho de "sem sessão".
  */
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active' && machine.getState().status === 'signedIn') {
        void syncWidgetSnapshots({ budget: snapshot, invoices })
      }
    }

    const subscription = AppState.addEventListener('change', onChange)
    return () => subscription.remove()
  }, [machine, snapshot, invoices])

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      api,
      privacy,
      signIn: (email, password) => machine.signIn(email, password),
      /*
        Os DOIS snapshots são neutralizados ANTES de a sessão terminar. Na
        ordem inversa, uma falha entre as etapas deixaria a credencial
        removida e os valores da conta anterior intactos no disco — visíveis
        para quem instalasse um widget depois. `allSettled`: a falha de um
        scrub não pode impedir a tentativa no outro.
      */
      signOut: async () => {
        await Promise.allSettled([snapshot.scrub(), invoices.scrub()])
        await machine.signOut()
      },
    }),
    [state, api, machine, snapshot, invoices, privacy],
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
