// OpenTelemetry + Langfuse tracing bootstrap.
//
// This file MUST be imported before any code that creates spans (i.e. first in
// the app entry point). `dotenv/config` runs first so the Langfuse credentials
// are loaded before the span processor reads them.
import "dotenv/config";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;

/** Tracing is opt-in: it only activates when Langfuse credentials are present. */
export const tracingEnabled = Boolean(publicKey && secretKey);

let sdk: NodeSDK | undefined;
let langfuseSpanProcessor: LangfuseSpanProcessor | undefined;

if (tracingEnabled) {
  langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    // Defaults to the EU cloud (https://cloud.langfuse.com) when unset.
    baseUrl: process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST,
    // Separates dev/staging/prod traces in the Langfuse UI.
    environment:
      process.env.LANGFUSE_TRACING_ENVIRONMENT ??
      process.env.NODE_ENV ??
      "development",
  });

  sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
  sdk.start();

  console.log("Langfuse tracing enabled.");
} else {
  console.log(
    "Langfuse tracing disabled — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable.",
  );
}

/**
 * Flush any buffered spans and shut the OpenTelemetry SDK down.
 * Call this before the process exits so the last traces are not lost.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await langfuseSpanProcessor?.forceFlush();
    await sdk.shutdown();
  } catch (err) {
    console.error("Error shutting down Langfuse tracing:", err);
  }
}
