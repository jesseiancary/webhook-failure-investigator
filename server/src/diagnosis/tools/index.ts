// The Phase-5 retrieval tools: standalone executors that surface real, redacted data for grounding.
// PR1 builds and tests them in isolation; PR2 wires them into a bounded tool-calling loop (OpenAI
// function definitions + an eventId-scoped dispatcher) and persists each call as an
// InvestigationMessage.

export { getEventPayload, getDeliveryHistory } from './event-tools.js';
export { fetchApiDocs, rankApiDocs, type RankableDoc, type RankedDoc } from './api-docs.js';
export { buildDiagnosisToolkit } from './toolkit.js';
export {
  EventToolParamsSchema,
  FetchApiDocsParamsSchema,
  type EventToolParams,
  type FetchApiDocsParams,
} from './schemas.js';
