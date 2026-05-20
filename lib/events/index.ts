export { eventBus, EventBus } from './event-bus'
export type { ZenoEvent, ZenoEventType, EventHandler, Anomaly } from './types'
export { getTurnCost } from './cost-subscriber'
export { getTurnAnomalies, getTurnToolHistory, RollingStats } from './anomaly-subscriber'
export { initOtel } from './otel-setup'

import { eventBus } from './event-bus'
import { registerCostSubscriber } from './cost-subscriber'
import { registerAnomalySubscriber } from './anomaly-subscriber'
import { registerOtelSubscriber } from './otel-subscriber'
import { initOtel } from './otel-setup'

let initialized = false

export function initObservability(): void {
  if (initialized) return
  initialized = true

  // Initialize OTel SDK (lazy, only when OTEL_ENABLED=true)
  initOtel()

  // Register all subscribers on the shared event bus
  registerCostSubscriber(eventBus)
  registerAnomalySubscriber(eventBus)

  // OTel subscriber only if tracing is enabled
  if (process.env.OTEL_ENABLED === 'true') {
    registerOtelSubscriber(eventBus)
  }
}
