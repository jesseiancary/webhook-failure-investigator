// The diagnosis structured-output contract now lives in @wfi/contracts, shared with the web UI and
// driving both API validation and OpenAI Structured Outputs. Re-exported here under the module path
// the server already imports (`./diagnosis.schema.js`) so existing importers are unchanged.
export { EvidenceSchema, ReachabilitySchema, DiagnosisSchema } from '@wfi/contracts';
export type { Evidence, Reachability, Diagnosis } from '@wfi/contracts';
