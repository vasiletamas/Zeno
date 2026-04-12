let initialized = false

export function initOtel(): void {
  if (initialized) return
  if (process.env.OTEL_ENABLED !== 'true') return

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node')
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
    const { Resource } = require('@opentelemetry/resources')
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions')

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'zeno-agent',
    })

    const traceExporter = new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`,
    })

    const spanProcessors: any[] = []

    if (process.env.SENTRY_DSN) {
      try {
        const { SentrySpanProcessor } = require('@sentry/opentelemetry')
        spanProcessors.push(new SentrySpanProcessor())
      } catch {
        // @sentry/opentelemetry not available — skip Sentry bridge
      }
    }

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      spanProcessors,
    })

    sdk.start()
    initialized = true
  } catch (err) {
    console.error('[otel-setup] Failed to initialize OpenTelemetry:', err)
  }
}
