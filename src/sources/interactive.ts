/** Interactive operator prompts as a local Source, without treating injected agent relays as human input. */
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Trigger } from '../core/index.ts'

export const INTERACTIVE_SOURCE = 'interactive'
export const INTERACTIVE_ACTOR = 'operator'

/**
 * Convert one prompt written by the operator in the main Session into a durable Trigger.
 * DSH's `user-rpc` producer uses source kind `user`; superagent relays and notices use
 * `dsh-superagent`, so they cannot recursively create work. Text blocks retain their
 * order; non-text blocks have no Source representation yet. Messages without text are
 * not triggers. Each prompt has its own Thread: the main Session spans many tickets,
 * so subscribing a ticket to one prompt must not subscribe it to future prompts.
 */
export function interactiveTrigger(sessionId: string, message: UserMessage, at = new Date().toISOString()): Trigger | undefined {
  if (message.source.kind !== 'user') return undefined
  const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  if (!text.trim()) return undefined
  const rpcId = 'rpcId' in message.source && typeof message.source.rpcId === 'string' ? message.source.rpcId : undefined
  const id = rpcId ?? message.id
  return {
    id: `${INTERACTIVE_SOURCE}:${id}`,
    source: INTERACTIVE_SOURCE,
    threads: [{ source: INTERACTIVE_SOURCE, id: `${sessionId}:${id}` }],
    actor: { source: INTERACTIVE_SOURCE, id: INTERACTIVE_ACTOR },
    human: true,
    addressed: 'direct',
    at,
    text,
    meta: { sessionId, messageId: message.id, ...rpcId ? { rpcId } : {} },
  }
}
