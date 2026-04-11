/**
 * Resolve which agent slug handles a given conversation mode.
 * Currently all modes use 'main-chat' with different skill packs.
 * This function is the abstraction point — when a mode needs a
 * separate agent, only this function changes.
 */
export function resolveAgent(mode: string): string {
  switch (mode) {
    case 'SALES':
    case 'ONBOARDING':
    case 'SUPPORT':
    case 'CLAIMS':
    case 'RENEWAL':
      return 'main-chat'
    default:
      return 'main-chat'
  }
}
