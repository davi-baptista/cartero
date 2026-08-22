import { useEffect, useState } from 'react'

/**
 * Devolve `value` depois de `delay` sem novas mudanças.
 *
 * Usado para não pedir uma prévia por tecla digitada: o valor só se propaga
 * quando o usuário para de mexer. A comparação é por JSON porque o valor
 * costuma ser um objeto remontado a cada render — comparar referência
 * disparararia o efeito sempre.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  const serialized = JSON.stringify(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
    // `serialized` é a identidade real do valor; `value` muda de referência
    // a cada render sem necessariamente ter conteúdo diferente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, delay])

  return debounced
}
