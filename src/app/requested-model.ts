import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { RoleModel } from '../policy.ts'
import { resolveRoleModel } from './role-models.ts'

const normalize = (value: string): string => value.toLowerCase().replace(/[ _-]+/g, ' ').trim()
const providerKey = (value: string): string => normalize(value).replace(/\s+/g, '')
const directive = /(?:^|[\n:,.!?;])\s*(?:(?:and\s+)?(?:please\s+)?(?:use|run\s+(?:it\s+)?(?:with|on)|switch\s+to|model\s*:)\s+|(?:请)?使用(?:模型)?[ \t]*)([^\n]+)/gi
const effort = /^(?:\s+(?:at|with|on))?\s+(off|minimal|low|medium|high|xhigh|max)(?:\s+(?:thinking|reasoning)(?:\s+effort)?)?(?=$|[\s,.;!?，。])/i
const effortAfter = (text: string): string | undefined => text.match(effort)?.[1]?.toLowerCase()

export async function requestedModel(ctx: Context, text: string): Promise<ModelSelection | undefined> {
  let fenced = false
  const prose = text.split('\n').filter(line => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return false }
    return !fenced && !/^\s*>/.test(line)
  }).join('\n')
  const choices = [...prose.matchAll(directive)].map(match => match[1]!.trim())
  if (!choices.length && /^[^\n,.!?;]+?\s+(?:at|with)\s+(?:off|minimal|low|medium|high|xhigh|max)\s+(?:thinking|reasoning)\b/i.test(prose.trim())) {
    choices.push(prose.trim().split('\n')[0]!)
  }
  if (!choices.length) return
  const providers = ctx.llm.listProviders?.() ?? []
  const matches = new Map<string, RoleModel>()
  const add = (provider: string, model: string, reasoningEffort?: string) => {
    matches.set(`${provider}\0${model}\0${reasoningEffort ?? ''}`, { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })
  }
  let catalogs: Awaited<ReturnType<Context['llm']['listModels']>> | undefined
  for (const raw of choices) {
    const choice = raw.replace(/[`"“”]/g, '')
    const routeText = choice.replace(/^model\s+(?=[\w.-]+\/)/i, '')
    const explicit = routeText.match(/^([\w.-]+)\/([\w./:@-]+)/)
    const registered = explicit && providers.find(({ id }) => id.toLowerCase() === explicit[1]?.toLowerCase())
    if (explicit && (registered || /^model\s+/i.test(choice) || /^(?:model\s+)?`[^`]+`/.test(raw))) {
      add(registered?.id ?? explicit[1]!, explicit[2]!.replace(/\.$/, ''), effortAfter(routeText.slice(explicit[0].length)))
      continue
    }
    const qualifier = choice.match(/\s+(?:via|from|on)\s+(.+?)(?=\s+(?:at|with)\s+|[.!?,]|$)/i)
    const requestedProvider = qualifier && providerKey(qualifier[1]!)
    const lookups = [normalize(qualifier ? choice.slice(0, qualifier.index) : choice)]
    if (lookups[0]!.startsWith('model ')) lookups.push(lookups[0]!.slice(6))
    catalogs ??= (await Promise.all(providers.map(async ({ id }) => {
      try { return await ctx.llm.listModels(id) } catch { return [] }
    }))).flat()
    const candidates = catalogs.flatMap(({ provider, id, name }) => {
      const providerInfo = providers.find(entry => entry.id === provider)
      const providerMatches = !requestedProvider || providerKey(provider) === requestedProvider || providerKey(providerInfo?.name ?? '') === requestedProvider
      return [id, id.split('/').at(-1)!, name, name.replace(/^[^:]+:\s*/, '')].map(normalize).flatMap(label => {
        const lookup = lookups.find(value => label && value.startsWith(label) && /^(?:$|[\s,.;!?，。])/.test(value.slice(label.length)))
        return lookup === undefined ? [] : [{ provider, id, providerMatches, length: label.length, effort: effortAfter(lookup.slice(label.length)) }]
      })
    })
    const eligible = candidates.filter(candidate => candidate.providerMatches)
    if (candidates.length && !eligible.length) throw new Error('The requested model is not available from the named provider.')
    const longest = eligible.reduce((max, candidate) => Math.max(max, candidate.length), 0)
    const qualifiedEffort = qualifier ? effortAfter(choice.slice(qualifier.index! + qualifier[0].length)) : undefined
    for (const candidate of eligible) {
      if (candidate.length === longest) add(candidate.provider, candidate.id, candidate.effort ?? qualifiedEffort)
    }
  }
  if (matches.size > 1) throw new Error('The requested model is ambiguous; specify one provider/model and reasoning effort in the worker request.')
  const selected = matches.values().next().value
  if (!selected) return
  try { return await resolveRoleModel(ctx, selected) }
  catch { throw new Error(`The requested model ${selected.provider}/${selected.model} or its reasoning effort is unavailable.`) }
}
