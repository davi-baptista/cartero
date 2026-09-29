/**
 * Resolve the Person drawer target while the URL catches up with a click.
 *
 * `personId` remains the durable authority, but a pending id must win for the
 * render between `router.push` and the next search-param update. Otherwise a
 * close followed by opening another person renders the old URL target once.
 */
export function resolvePersonTargetId(
  urlPersonId: string | null,
  pendingPersonId: string | null,
  dismissedPersonId: string | null,
  dismissedGeneration: number,
  openGeneration: number,
): string | null {
  if (pendingPersonId !== null) return pendingPersonId

  return dismissedPersonId === urlPersonId && openGeneration <= dismissedGeneration
    ? null
    : urlPersonId
}
