/**
 * ══════════════════════════════════════════════════════════════════════════
 * Qual item do menu representa a página aberta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Um item de navegação aponta para uma SUPERFÍCIE, não para uma URL exata.
 * "Pessoas" é o item ativo em `/persons`, em `/persons?period=2026-08` e em
 * `/persons?personId=abc` — os dois últimos são estados da mesma tela.
 *
 * Por isso a comparação é por PATHNAME, ignorando query string. Comparar a
 * URL inteira faria o item perder o destaque assim que o usuário abrisse um
 * detalhe, e a sidebar deixaria de dizer onde ele está.
 *
 * ── Por que isso é um helper, e não um `startsWith` inline ──
 *
 * A mesma decisão é usada em dois lugares — o destaque visual e a escolha de
 * navegar ou não. Se divergirem, o item pode aparecer ativo e ainda assim
 * disparar navegação, que é exatamente o bug que esta política resolve.
 */

/** Só o caminho, sem query nem hash. */
function pathnameOf(url: string): string {
  return url.split('?')[0].split('#')[0]
}

/**
 * O item de `href` representa a página em `pathname`?
 *
 * `startsWith` com fronteira de segmento: `/banks` cobre
 * `/banks/:id/invoices` (o histórico do cartão é a mesma superfície), mas
 * NÃO casaria um hipotético `/banksomething`.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  const alvo = pathnameOf(href)
  const atual = pathnameOf(pathname)

  if (atual === alvo) return true
  return atual.startsWith(alvo.endsWith('/') ? alvo : `${alvo}/`)
}

/**
 * Clicar neste item deve NAVEGAR?
 *
 * Não quando já estamos na superfície dele. O caso que motivou a regra: em
 * `/persons?personId=abc`, tocar em "Pessoas" navegava para `/persons` —
 * uma transição que descartava o `personId` e deixava a tela num estado que
 * parecia carregamento perdido.
 *
 * O comportamento correto é fechar o menu e ficar onde está: o usuário pediu
 * a tela em que já se encontra, e o detalhe aberto é estado dele, não sujeira
 * a limpar.
 *
 * Repare que isto NÃO é "mesma URL": `/persons?personId=abc` e `/persons` são
 * URLs diferentes, e é justamente por isso que o `Link` navegava. A pergunta
 * certa é sobre a SUPERFÍCIE.
 */
export function shouldNavigate(href: string, pathname: string): boolean {
  return !isNavItemActive(href, pathname)
}
