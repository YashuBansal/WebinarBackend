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
import { logs } from '@opentelemetry/api-logs';
import dotenv from 'dotenv';
dotenv.config();

const {
  OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_SERVICE_NAME
} = process.env;

if (!OTEL_EXPORTER_OTLP_ENDPOINT) {
  throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is not set in .env');
}

if (!OTEL_SERVICE_NAME) {
  throw new Error('OTEL_SERVICE_NAME is not set in .env');
}
 

const traceExporter = new OTLPTraceExporter({
  url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
});

const logExporter = new OTLPLogExporter({
  url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`,
});

// Create resource with service name
// TODO: Change service name later
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
});

// Initialize Logger Provider
const loggerProvider = new LoggerProvider({
  resource,
  processors: [new BatchLogRecordProcessor(logExporter)],
});

// Register the logger provider globally
logs.setGlobalLoggerProvider(loggerProvider);

// Initialize Node SDK
const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Automatically instruments Express, HTTP, and other Node.js libraries
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable file system instrumentation if not needed
      },
    }),
    // Winston instrumentation is commented out since Winston was removed
    // new WinstonInstrumentation({
    //   logHook: (span, record) => {
    //     record['resource.service.name'] = 'test-backend';
    //   },
    // }),
  ],
});

// Start the SDK
try {
  sdk.start();
  console.log('OpenTelemetry instrumentation initialized successfully');
} catch (error) {
  console.error('Error initializing OpenTelemetry:', error);
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  Promise.all([sdk.shutdown(), loggerProvider.shutdown()])
    .then(() => console.log('OpenTelemetry SDK shut down successfully'))
    .catch((error) =>
      console.error('Error shutting down OpenTelemetry:', error),
    )
    .finally(() => process.exit(0));
});

export { loggerProvider };
