import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { threadKey, type Thread } from '../src/core/index.ts'
import { SettingsSchema, allowedSender, settingsPolicy } from '../src/policy.ts'
import { INTERACTIVE_ACTOR, INTERACTIVE_SOURCE, interactiveTrigger } from '../src/sources/interactive.ts'
import { SourceRegistry } from '../src/sources/registry.ts'

const SESSION = 'orchestrator-test'
const prompt = (text: string, source: UserMessage['source'] = { kind: 'user', rpcId: 'rpc-1' } as UserMessage['source']) =>
  createUserMessage({ content: [{ type: 'text', text }], source })

describe('interactive Source', () => {
  it('given an operator RPC prompt, when replayed, then the Trigger and Thread identities stay the same', () => {
    const message = prompt('Open a ticket for this request')
    const trigger = interactiveTrigger(SESSION, message, '2026-11-23T00:00:00.000Z')!
    expect(trigger).toEqual({
      id: 'interactive:rpc-1', source: 'interactive', threads: [{ source: 'interactive', id: `${SESSION}:rpc-1` }],
      actor: { source: 'interactive', id: 'operator' }, human: true, addressed: 'direct', at: '2026-11-23T00:00:00.000Z',
      text: 'Open a ticket for this request', meta: { sessionId: SESSION, messageId: trigger.meta.messageId, rpcId: 'rpc-1' },
    })
    expect(interactiveTrigger(SESSION, prompt('Open a ticket for this request'))).toMatchObject({ id: trigger.id, threads: trigger.threads })
  })

  it('given relays, notices, or empty input, when converted, then no Trigger is produced', () => {
    for (const source of [
      { kind: 'dsh-superagent', form: 'relay' },
      { kind: 'dsh-superagent', form: 'notice', summary: 'notice' },
      { kind: 'schedule', form: 'notice', summary: 'schedule' },
    ] as const) expect(interactiveTrigger(SESSION, prompt('not a person', source as UserMessage['source']))).toBeUndefined()
    expect(interactiveTrigger(SESSION, createUserMessage({ content: [], source: { kind: 'user', rpcId: 'empty' } }))).toBeUndefined()
  })

  it('given no external allow-list entry, when the local operator prompts, then admission and Mandate revalidation succeed', () => {
    const settings = SettingsSchema.parse({})
    const sources = new SourceRegistry(() => settings)
    const policy = settingsPolicy(settings, sources)
    const trigger = interactiveTrigger(SESSION, prompt('implement this'))!
    const ref = trigger.threads[0]!
    const thread: Thread = { key: threadKey(ref), ref, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {} }
    const gate = policy.gate(trigger, thread, [])
    expect(gate).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed', source: INTERACTIVE_SOURCE, addressed: 'direct', sender: 'Interactive operator' } })
    if (!gate.admissible) throw new Error('expected interactive admission')
    expect(policy.revalidate({ strength: 'explicit', policyVersion: gate.admissible ? policy.version : '', basis: gate.basis, actor: trigger.actor, scope: '' })).toBe(true)
    expect(allowedSender(settings, trigger.actor)).toEqual({ id: INTERACTIVE_ACTOR, name: 'Interactive operator' })
    expect(allowedSender(settings, { source: 'github', id: INTERACTIVE_ACTOR })).toBeUndefined()
    expect(allowedSender(settings, { source: INTERACTIVE_SOURCE, id: 'someone-else' })).toBeUndefined()
  })
})
