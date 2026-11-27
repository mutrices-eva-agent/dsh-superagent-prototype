import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { requestedModel } from '../src/app/requested-model.ts'

function fixture() {
  const ctx = new Context()
  const models = [{ provider: 'gateway', id: 'lab/model-alpha', name: 'Lab: Model Alpha' },
    { provider: 'direct', id: 'model-alpha', name: 'Model Alpha' }]
  const listModels = vi.fn(async (provider: string) => models.filter(model => model.provider === provider))
  const resolveCallConfig = vi.fn(async (selection: object) => selection)
  ctx.reflect.provide('llm', { listProviders: () => [{ id: 'gateway', name: 'Gateway Service' }, { id: 'direct', name: 'Direct' }],
    listModels, resolveCallConfig })
  return { ctx, listModels, resolveCallConfig }
}

it('given_a_provider_first_directive_when_the_model_name_is_shared_then_pins_the_named_route', async () => {
  const { ctx, listModels } = fixture()
  expect(await requestedModel(ctx, 'Use Gateway Service Model Alpha at high thinking.\nSay hi.')).toEqual({
    provider: 'gateway', model: 'lab/model-alpha', reasoningEffort: 'high',
  })
  expect(listModels.mock.calls).toEqual([['gateway']])
})

it('given_a_provider_first_openrouter_directive_when_the_catalog_lists_argon_then_resolves_the_exact_model', async () => {
  const ctx = new Context()
  ctx.reflect.provide('llm', {
    listProviders: () => [{ id: 'openrouter', name: 'OpenRouter' }],
    listModels: async () => [{ provider: 'openrouter', id: 'google/gemini-4-argon', name: 'Google: Gemini 4 Argon' }],
    resolveCallConfig: async (selection: object) => selection,
  })
  expect(await requestedModel(ctx, 'use openrouter gemini 4 argon')).toEqual({
    provider: 'openrouter', model: 'google/gemini-4-argon',
  })
})

it('given_a_provider_first_directive_when_its_catalog_has_no_matching_model_then_does_not_substitute', async () => {
  const { ctx, resolveCallConfig } = fixture()
  await expect(requestedModel(ctx, 'Use Gateway Service Missing Model')).rejects.toThrow('not available from the named provider')
  expect(resolveCallConfig).not.toHaveBeenCalled()
})

it('given_a_qualified_model_when_requested_then_resolves_the_exact_route_without_catalog_discovery', async () => {
  const { ctx, listModels } = fixture()
  expect(await requestedModel(ctx, 'Please use `gateway/lab/model-alpha` at High thinking.')).toEqual({
    provider: 'gateway', model: 'lab/model-alpha', reasoningEffort: 'high',
  })
  expect(listModels).not.toHaveBeenCalled()
})

it('given_a_model_label_and_provider_when_requested_then_selects_that_provider', async () => {
  const { ctx } = fixture()
  expect(await requestedModel(ctx, 'Start the redesign, use model Model Alpha from Gateway Service at high thinking')).toEqual({
    provider: 'gateway', model: 'lab/model-alpha', reasoningEffort: 'high',
  })
})

it('given_a_short_model_and_effort_request_when_a_provider_is_named_then_preserves_both', async () => {
  const { ctx } = fixture()
  expect(await requestedModel(ctx, 'Model Alpha from Gateway Service at High thinking then, please start.')).toEqual({
    provider: 'gateway', model: 'lab/model-alpha', reasoningEffort: 'high',
  })
})

it('given_a_known_model_on_an_unavailable_provider_when_requested_then_does_not_reroute', async () => {
  const { ctx, resolveCallConfig } = fixture()
  await expect(requestedModel(ctx, 'Use Model Alpha via Missing Gateway')).rejects.toThrow('not available from the named provider')
  expect(resolveCallConfig).not.toHaveBeenCalled()
})

it('given_an_ambiguous_model_when_requested_then_refuses_to_pick_a_provider', async () => {
  const { ctx, resolveCallConfig } = fixture()
  await expect(requestedModel(ctx, 'Use Model Alpha')).rejects.toThrow('ambiguous')
  expect(resolveCallConfig).not.toHaveBeenCalled()
})

it('given_a_model_in_comparison_quoted_or_code_text_when_read_then_does_not_pin_it', async () => {
  const { ctx, listModels } = fixture()
  expect(await requestedModel(ctx, 'Compare Model Alpha with the default.\n> Use Model Alpha\n```text\nUse Model Alpha\n```')).toBeUndefined()
  expect(listModels).not.toHaveBeenCalled()
})

it('given_an_unavailable_named_route_when_requested_then_does_not_substitute_a_model', async () => {
  const { ctx, resolveCallConfig } = fixture()
  resolveCallConfig.mockRejectedValueOnce(new Error('private provider details'))
  await expect(requestedModel(ctx, 'Run with gateway/lab/model-alpha')).rejects.toThrow('gateway/lab/model-alpha or its reasoning effort is unavailable')
  resolveCallConfig.mockRejectedValueOnce(new Error('unknown provider'))
  await expect(requestedModel(ctx, 'Use `missing/model-alpha`')).rejects.toThrow('missing/model-alpha or its reasoning effort is unavailable')
})
