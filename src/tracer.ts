import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import dotenv from 'dotenv';

dotenv.config();

const { OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME } = process.env;

let loggerProvider: LoggerProvider | undefined;
let sdk: NodeSDK | undefined;

function initOpenTelemetry() {
  if (!OTEL_EXPORTER_OTLP_ENDPOINT || !OTEL_SERVICE_NAME) {
    console.warn(
      '[OTEL] Missing OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_SERVICE_NAME. OpenTelemetry is disabled for this process.',
    );
    return;
  }

  const baseEndpoint = OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '');

  const traceExporter = new OTLPTraceExporter({
    url: `${baseEndpoint}/v1/traces`,
  });

  const logExporter = new OTLPLogExporter({
    url: `${baseEndpoint}/v1/logs`,
  });

  // Create resource with service name
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
  });

  // Initialize Logger Provider
  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logExporter)],
  });

  // Register the logger provider globally so `logs.getLogger(...)` works everywhere
  logs.setGlobalLoggerProvider(loggerProvider);

  // Initialize Node SDK
  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Automatically instruments Express, HTTP, and other Node.js libraries
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Disable file system instrumentation if not needed
        },
      }),
    ],
  });

  try {
    sdk.start();

    // Minimal sanity OTEL log to verify connectivity
    const startupLogger = logs.getLogger(OTEL_SERVICE_NAME);

    startupLogger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      body: 'OTEL startup sanity LOG from tracer.ts',
      attributes: {
        'otel.sanity': true,
        'service.name': OTEL_SERVICE_NAME,
      },
    });
  } catch (error) {
    console.error('[OTEL] Error initializing OpenTelemetry:', error);
  }
}

// Bootstrap immediately when this module is imported
initOpenTelemetry();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  if (!sdk || !loggerProvider) {
    return process.exit(0);
  }

  Promise.all([sdk.shutdown(), loggerProvider.shutdown()])
    .then(() => undefined)
    .catch((error) =>
      console.error('[OTEL] Error shutting down OpenTelemetry:', error),
    )
    .finally(() => process.exit(0));
});

export { loggerProvider };
