import type { ChatClient, ChatStreamEvent } from './chat.client.js';
import type { Diagnosis } from './diagnosis.schema.js';
import type { DiagnosisClient, DiagnosisResult } from './openai.js';

// Deterministic, offline stand-ins for the OpenAI-backed diagnosis/chat clients. The real factories
// (createOpenAIDiagnosisClient / createOpenAIChatClient) return these when `env.FAKE_LLM` is set, so
// the whole stack — investigate and follow-up chat — runs end to end with no API key and no network.
// That is what the Phase 7 Playwright happy-path drives: submit -> investigate -> read diagnosis ->
// ask a follow-up, deterministically, in CI.
//
// These are explicitly NOT a demonstration of real model behavior: the verdict is canned (a
// grounded-LOOKING `authentication` diagnosis that cites a real log field, `attempts[0].responseStatus`)
// regardless of the event. The e2e submits a matching 401 delivery so the cited field is present on
// the page. Only ever reachable behind the opt-in flag — never on a production path.

/** Model label recorded on fake-backed runs. Unknown to pricing.ts, so cost records 0 (with a warn). */
const FAKE_MODEL = 'fake-llm';

const FAKE_DIAGNOSIS: Diagnosis = {
  failureCategory: 'authentication',
  rootCause:
    'The receiving endpoint rejected the delivery with HTTP 401, indicating the bearer token was invalid or expired. The endpoint answered, so it was reachable.',
  confidence: 0.95,
  evidence: [
    {
      field: 'attempts[0].responseStatus',
      value: '401',
      note: 'The endpoint returned 401 Unauthorized — reachable, but refusing the credentials.',
    },
  ],
  remediationSteps: [
    'Rotate the API credentials and retry delivery using the original event id.',
    'Verify the token expiration policy on the receiving service.',
  ],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

/** A deterministic `DiagnosisClient` returning a fixed grounded-looking diagnosis — no network. */
export function createFakeDiagnosisClient(): DiagnosisClient {
  return {
    async runDiagnosis(): Promise<DiagnosisResult> {
      return {
        diagnosis: FAKE_DIAGNOSIS,
        usage: { promptTokens: 1200, completionTokens: 300 },
        model: FAKE_MODEL,
        toolCalls: [],
      };
    },
  };
}

/** A deterministic `ChatClient` that streams a short canned answer, then a `done` with usage. */
export function createFakeChatClient(): ChatClient {
  return {
    async *streamChat(): AsyncIterable<ChatStreamEvent> {
      const chunks = [
        'Because the logs show an HTTP 401 with an expired-token error',
        ' — a network fault would not have reached the endpoint at all.',
      ];
      let content = '';
      for (const text of chunks) {
        content += text;
        yield { type: 'delta', text };
      }
      yield {
        type: 'done',
        content,
        model: FAKE_MODEL,
        usage: { promptTokens: 800, completionTokens: 40 },
      };
    },
  };
}
