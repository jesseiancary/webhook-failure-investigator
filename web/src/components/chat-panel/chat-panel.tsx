import { Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InvestigationMessage } from '../../api/types';
import { ApiError } from '../../api/client';
import { formatCost } from '../../lib/format';
import { streamChat } from '../../lib/sse';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Textarea } from '../ui/textarea';

// The follow-up chat panel on the investigation detail page. It replays the persisted conversation,
// then streams each new answer token-by-token over SSE (see lib/sse.ts). Answers stay grounded in
// the investigation — the server re-provides the logs each turn — so this is a thin transport+view.

interface ChatUiMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  /** The assistant message is still streaming (show a caret, disable input). */
  pending?: boolean;
  /** The turn failed mid-stream; render it as a non-destructive error note. */
  error?: boolean;
  model?: string;
  costUsd?: string;
}

/**
 * Select the chat conversation out of the full persisted thread — the `user` rows and the plain
 * `assistant` answers (no `toolCalls`). This mirrors the server's own `loadChatHistory`, so the
 * Phase-5 diagnosis retrieval trace (assistant rows with tool calls, `role:'tool'` results) is
 * excluded here just as it is there.
 */
function replayThread(messages: InvestigationMessage[]): ChatUiMessage[] {
  return [...messages]
    .sort((a, b) => a.seq - b.seq)
    .filter(
      (m) =>
        (m.role === 'user' || (m.role === 'assistant' && m.toolCalls == null)) &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      key: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      model: m.model ?? undefined,
      costUsd: m.costUsd ?? undefined,
    }));
}

export function ChatPanel({
  investigationId,
  initialMessages,
}: {
  investigationId: string;
  initialMessages: InvestigationMessage[];
}) {
  const replayed = useMemo(() => replayThread(initialMessages), [initialMessages]);
  const [messages, setMessages] = useState<ChatUiMessage[]>(replayed);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Re-seed when navigating between investigations (initialMessages identity changes).
  useEffect(() => {
    setMessages(replayed);
  }, [replayed]);

  // Cancel any in-flight stream on unmount so we don't write into a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchAssistant = (key: string, patch: Partial<ChatUiMessage>): void => {
    setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  };

  async function send(): Promise<void> {
    const question = input.trim();
    if (!question || isStreaming) return;

    const answerKey = `pending-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { key: `user-${Date.now()}`, role: 'user', content: question },
      { key: answerKey, role: 'assistant', content: '', pending: true },
    ]);
    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        investigationId,
        question,
        {
          onDelta: (text) =>
            setMessages((prev) =>
              prev.map((m) => (m.key === answerKey ? { ...m, content: m.content + text } : m)),
            ),
          onDone: (payload) =>
            patchAssistant(answerKey, {
              pending: false,
              model: payload.model,
              costUsd: payload.costUsd,
            }),
          onError: () =>
            patchAssistant(answerKey, {
              pending: false,
              error: true,
              content: 'This answer failed to stream. Please try again.',
            }),
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return; // unmounted / superseded — nothing to show.
      const message =
        err instanceof ApiError ? `Request failed (${err.status}).` : 'Request failed.';
      patchAssistant(answerKey, { pending: false, error: true, content: message });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask a follow-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask about the diagnosis — the assistant answers grounded in this event’s logs.
            </p>
          ) : (
            messages.map((message) => <ChatBubble key={message.key} message={message} />)
          )}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label="Follow-up question"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="e.g. Why did the signature check fail?"
            rows={2}
            disabled={isStreaming}
            className="min-h-0"
          />
          <Button type="submit" size="icon" disabled={isStreaming || input.trim().length === 0}>
            <Send />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ChatBubble({ message }: { message: ChatUiMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
            : 'max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm'
        }
      >
        <p className={`whitespace-pre-wrap ${message.error ? 'text-destructive' : ''}`}>
          {message.content}
          {message.pending ? <span className="animate-pulse">▋</span> : null}
        </p>
        {message.model && !message.error ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {message.model} · {formatCost(message.costUsd ?? null)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
