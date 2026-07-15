/**
 * State Handlers
 *
 * get_current_state — returns the full deriveAndExpose output:
 * { state: DerivedStateV3, actions: ExposedActions }.
 */

import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { ToolHandler } from '../types'

export const getStateHandler: ToolHandler = async (_args, context) => {
  const { state, actions } = deriveAndExpose(await loadDomainSnapshot(context.conversationId))
  return { success: true, data: { state, actions }, message: `Phase ${state.phase}${state.subphase ? '/' + state.subphase : ''}. ${state.nextBestAction}` }
}
