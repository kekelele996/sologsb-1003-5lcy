import { extractProtected, segmentKind } from './markdown'
import type { Discussion, HistoryEntry, Segment, TranslationConflict } from './types'

/** 结构操作被阻断的原因（确认前必须解决）。 */
export interface StructureBlocker {
  code:
    | 'not-adjacent'
    | 'code-segment'
    | 'heading-involved'
    | 'code-fence-unbalanced'
    | 'heading-level-mismatch'
    | 'heading-level-truncated'
    | 'heading-explicit-mismatch'
    | 'protected-token-cut'
    | 'protected-attribution-incomplete'
    | 'empty-source-half'
    | 'cut-out-of-range'
  message: string
}

/** 不阻断操作但需要在预览中提醒译者的注意事项。 */
export interface StructureNotice {
  level: 'warning' | 'info'
  message: string
}

export interface MergePlan {
  segments: Segment[]
  sourceText: string
  targetText: string
  kind: Segment['kind']
  blockers: StructureBlocker[]
  notices: StructureNotice[]
  discussionCount: number
  historyCount: number
  confirmedInvolved: boolean
}

export interface SplitSide {
  source: string
  target: string
}

export type SplitKindChoice = 'auto' | 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface SplitEvaluation {
  blockers: StructureBlocker[]
  notices: StructureNotice[]
  kinds: Array<Segment['kind']>
  protectedTokens: string[][]
}

export interface SplitPlan {
  segment: Segment
  initial: SplitSide
}

export interface AppliedStructure {
  segments: Segment[]
  discussions: Discussion[]
  history: HistoryEntry[]
  conflicts: TranslationConflict[]
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const fenceCount = (text: string) => (text.match(/```/g) ?? []).length
const fenceImbalanced = (text: string) => fenceCount(text) % 2 !== 0
const headingLevel = (text: string): number | null => {
  const match = /^\s{0,3}(#{1,6})\s+\S/.exec(text)
  return match ? match[1].length : null
}
const countOccurrences = (text: string, token: string) => text.split(token).length - 1

/** 受保护标记（变量 / 链接整体）在文本中的全部区间。 */
const protectedSpans = (text: string): Array<{ token: string; start: number; end: number }> => {
  const spans: Array<{ token: string; start: number; end: number }> = []
  const push = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue
      spans.push({ token: match[0], start: match.index, end: match.index + match[0].length })
    }
  }
  push(/\{\{[^{}]+\}\}|\{[A-Za-z_][\w.-]*\}|%\([^)]+\)[sd]|%[sd]/g)
  push(/\[[^\]]+\]\([^)]*\)/g)
  return spans
}

/** 被切点切成两半的标记（变量或链接），无则返回 null。 */
const cutToken = (text: string, cut: number): string | null => {
  const hit = protectedSpans(text).find((span) => cut > span.start && cut < span.end)
  if (!hit) return null
  const url = /\[[^\]]+\]\(([^)]*)\)/.exec(hit.token)
  return url ? url[1] || hit.token : hit.token
}

const joinParts = (parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join('\n\n')

export function planMerge(segments: Segment[], discussions: Discussion[], history: HistoryEntry[]): MergePlan {
  const blockers: StructureBlocker[] = []
  const notices: StructureNotice[] = []
  const ordered = [...segments].sort((a, b) => a.index - b.index)

  const adjacent = ordered.every((segment, index) => index === 0 || segment.index === ordered[index - 1].index + 1)
  if (!adjacent) {
    blockers.push({ code: 'not-adjacent', message: '所选片段在文档中不相邻，合并且会跳过中间内容。请只选择连续的相邻片段。' })
  }
  const codeSegments = segments.filter((segment) => segment.kind === 'code')
  if (codeSegments.length) {
    blockers.push({ code: 'code-segment', message: `片段 #${codeSegments.map((segment) => segment.index).join('、#')} 是代码块，代码块必须独立成段，不能与说明文字合并。` })
  }
  const headingSegments = segments.filter((segment) => segment.kind === 'heading')
  if (headingSegments.length) {
    blockers.push({ code: 'heading-involved', message: `片段 #${headingSegments.map((segment) => segment.index).join('、#')} 是标题，标题层级不能并入普通段落。` })
  }
  const sourceText = joinParts(segments.map((segment) => segment.sourceText))
  const targetText = joinParts(segments.map((segment) => segment.targetText))

  // 受保护标记归属：某段源文中出现的标记，该段译文也要配对出现。
  // 整段尚未翻译时放行（仅警告），已翻译但对不上才算归属不完整。
  for (const segment of segments) {
    for (const token of extractProtected(`${segment.sourceText}\n${segment.targetText}`)) {
      if (!segment.sourceText.includes(token)) continue
      const sourceCount = countOccurrences(segment.sourceText, token)
      const targetCount = countOccurrences(segment.targetText, token)
      if (targetCount === sourceCount) continue
      if (!segment.targetText.trim()) {
        notices.push({ level: 'warning', message: `片段 #${segment.index} 尚未翻译，受保护标记 “${token}” 需要在译文中完整保留。` })
      } else {
        blockers.push({ code: 'protected-attribution-incomplete', message: `片段 #${segment.index} 的受保护标记 “${token}” 在源文与译文中的数量不一致（${sourceCount} 对 ${targetCount}），合并后归属不完整。` })
      }
    }
  }
  if (fenceImbalanced(sourceText) || fenceImbalanced(targetText)) {
    blockers.push({ code: 'code-fence-unbalanced', message: '合并结果中的代码围栏（```）数量不成对，结构不完整。' })
  }

  const confirmedInvolved = segments.some((segment) => segment.status === 'confirmed')
  if (confirmedInvolved) {
    notices.push({ level: 'info', message: `所选片段中有 ${segments.filter((segment) => segment.status === 'confirmed').length} 段已确认，合并确认后会整体回到待处理状态，需要重新确认。` })
  }
  if (segments.some((segment) => !segment.targetText.trim())) {
    notices.push({ level: 'warning', message: '其中存在尚未翻译的片段，合并后的译文将缺少这部分内容。' })
  }
  const involvedIds = new Set(segments.map((segment) => segment.id))
  const discussionCount = discussions.filter((discussion) => involvedIds.has(discussion.segmentId)).length
  const historyCount = history.filter((entry) => involvedIds.has(entry.segmentId)).length
  if (discussionCount) notices.push({ level: 'info', message: `${discussionCount} 条讨论将随合并后的片段保留。` })
  if (historyCount) notices.push({ level: 'info', message: `${historyCount} 条修改历史将跟随到合并后的片段。` })

  return {
    segments: ordered,
    sourceText,
    targetText,
    kind: segmentKind(sourceText, false),
    blockers,
    notices,
    discussionCount,
    historyCount,
    confirmedInvolved,
  }
}

/** 在尽量靠近中点的句末标点处选一个默认切点；找不到时退化为中点。 */
export function defaultCut(text: string): number {
  const trimmed = text.trim()
  const midpoint = Math.floor(trimmed.length / 2)
  const terminators = ['。', '！', '？', '!', '?', '；', ';', '\n']
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (const terminator of terminators) {
    let from = 0
    for (;;) {
      const position = trimmed.indexOf(terminator, from)
      if (position === -1) break
      const cut = position + terminator.length
      if (cut > 0 && cut < trimmed.length) {
        const distance = Math.abs(cut - midpoint)
        if (distance < bestDistance) { best = cut; bestDistance = distance }
      }
      from = cut
    }
  }
  if (best === -1) {
    const space = trimmed.indexOf(' ', Math.max(0, midpoint - 24))
    if (space !== -1 && space < trimmed.length - 1) best = space + 1
  }
  return best === -1 ? midpoint : best
}

export function planSplit(segment: Segment): SplitPlan {
  const initial: SplitSide = {
    source: segment.sourceText.slice(0, defaultCut(segment.sourceText)),
    target: segment.targetText.slice(0, defaultCut(segment.targetText || segment.sourceText)),
  }
  return { segment, initial }
}

export function evaluateSplit(segment: Segment, side: SplitSide, kindChoice: SplitKindChoice): SplitEvaluation {
  const blockers: StructureBlocker[] = []
  const notices: StructureNotice[] = []
  const sourceFirst = side.source
  const sourceSecond = segment.sourceText.slice(side.source.length)
  const targetFirst = side.target
  const targetSecond = segment.targetText.slice(side.target.length)
  const clamp = (cut: number, length: number) => Math.max(0, Math.min(cut, length))
  const sourceCut = clamp(side.source.length, segment.sourceText.length)
  const targetCut = clamp(side.target.length, segment.targetText.length)

  if (side.source.length < 0 || side.source.length > segment.sourceText.length || side.target.length < 0 || side.target.length > segment.targetText.length) {
    blockers.push({ code: 'cut-out-of-range', message: '切点超出了片段范围，请重新调整。' })
  }
  if (segment.kind === 'code') {
    blockers.push({ code: 'code-segment', message: '代码块必须整体保持原样，不能在中间拆出新片段。' })
  }
  if (!sourceFirst.trim() || !sourceSecond.trim()) {
    blockers.push({ code: 'empty-source-half', message: '源文的某一侧为空，拆分后会出现空片段，请把切点移到内容中间。' })
  }

  for (const half of [sourceFirst, sourceSecond, targetFirst, targetSecond]) {
    if (half && fenceImbalanced(half)) {
      blockers.push({ code: 'code-fence-unbalanced', message: '切点会把代码围栏（```）拆散到两个片段中，请移到代码块外。' })
      break
    }
  }

  const sourceLevelFirst = headingLevel(sourceFirst)
  const sourceLevelSecond = headingLevel(sourceSecond)
  const targetLevelFirst = headingLevel(targetFirst)
  const targetLevelSecond = headingLevel(targetSecond)

  if (segment.kind === 'heading' || sourceLevelFirst !== null || sourceLevelSecond !== null || targetLevelFirst !== null || targetLevelSecond !== null) {
    const levelFirst = sourceLevelFirst ?? targetLevelFirst
    const levelSecond = sourceLevelSecond ?? targetLevelSecond
    if (levelFirst === null || levelSecond === null) {
      blockers.push({ code: 'heading-level-truncated', message: '切点会截断标题或只让一侧保留标题标记，标题层级不完整；请在标题之外拆分。' })
    } else if (levelFirst !== levelSecond) {
      blockers.push({ code: 'heading-level-mismatch', message: `拆分后两侧标题层级不一致（H${levelFirst} 与 H${levelSecond}），请在各自完整标题之后拆分。` })
    }
    const levels = [sourceLevelFirst, sourceLevelSecond, targetLevelFirst, targetLevelSecond].filter((level): level is number => level !== null)
    if (levels.some((level) => level !== levels[0])) {
      blockers.push({ code: 'heading-level-mismatch', message: '源文与译文的标题层级不对应，拆分后两侧结构会错位。' })
    }
  }

  if (kindChoice.startsWith('h')) {
    const wanted = Number(kindChoice.slice(1))
    const pairs: Array<[string, string, number | null]> = [
      ['源文上半段', sourceFirst, headingLevel(sourceFirst)],
      ['源文下半段', sourceSecond, headingLevel(sourceSecond)],
      ['译文上半段', targetFirst, headingLevel(targetFirst)],
      ['译文下半段', targetSecond, headingLevel(targetSecond)],
    ]
    const bare = pairs.filter(([, , level]) => level === null).map(([label]) => label)
    const wrongLevel = pairs.some(([, , level]) => level !== null && level !== wanted)
    if (bare.length) {
      blockers.push({ code: 'heading-explicit-mismatch', message: `指定拆为 H${wanted} 标题，但${bare.join('、')}没有 H${wanted} 标题标记。` })
    }
    if (wrongLevel) {
      blockers.push({ code: 'heading-level-mismatch', message: `指定拆为 H${wanted} 标题，但部分内容的标题层级不符。` })
    }
  }
  if (kindChoice === 'paragraph' && [sourceLevelFirst, sourceLevelSecond, targetLevelFirst, targetLevelSecond].some((level) => level !== null)) {
    blockers.push({ code: 'heading-level-truncated', message: '切点两侧仍含标题标记，不能标记为普通段落；请改为标题拆分或调整切点。' })
  }

  const cutSourceToken = cutToken(segment.sourceText, sourceCut)
  if (cutSourceToken) blockers.push({ code: 'protected-token-cut', message: `源文切点穿过了受保护标记 “${cutSourceToken}”，请把切点移到标记之外。` })
  const cutTargetToken = cutToken(segment.targetText, targetCut)
  if (cutTargetToken) blockers.push({ code: 'protected-token-cut', message: `译文切点穿过了受保护标记 “${cutTargetToken}”，请把切点移到标记之外。` })

  const attributionPairs: Array<[string, string, string]> = [
    ['上半段', sourceFirst, targetFirst],
    ['下半段', sourceSecond, targetSecond],
  ]
  for (const [label, sourceHalf, targetHalf] of attributionPairs) {
    for (const token of extractProtected(`${sourceHalf}\n${targetHalf}`)) {
      if (!sourceHalf.includes(token)) continue
      const sourceCount = countOccurrences(sourceHalf, token)
      const targetCount = countOccurrences(targetHalf, token)
      if (targetCount === sourceCount) continue
      if (!targetHalf.trim()) continue // 该侧尚未翻译，下面的空译文警告已覆盖
      blockers.push({ code: 'protected-attribution-incomplete', message: `${label}的受保护标记 “${token}” 在源文与译文中的数量不一致（${sourceCount} 对 ${targetCount}），拆分后归属不完整。` })
    }
  }

  if (!targetFirst.trim() || !targetSecond.trim()) {
    notices.push({ level: 'warning', message: '译文的某一侧为空，拆分后对应片段将是待翻译状态。' })
  }
  if (segment.status === 'confirmed') {
    notices.push({ level: 'info', message: '该片段已确认，拆分确认后两个片段都会回到待处理状态，需要重新确认。' })
  }
  notices.push({ level: 'info', message: '该片段的讨论与修改历史将跟随到拆分后的第一个片段。' })

  const resolveKind = (source: string, target: string): Segment['kind'] => {
    if (kindChoice === 'paragraph') return 'paragraph'
    if (kindChoice.startsWith('h')) return 'heading'
    return segmentKind(source, false)
  }
  return {
    blockers,
    notices,
    kinds: [resolveKind(sourceFirst, targetFirst), resolveKind(sourceSecond, targetSecond)],
    protectedTokens: [
      [...new Set([...extractProtected(sourceFirst), ...extractProtected(targetFirst)])],
      [...new Set([...extractProtected(sourceSecond), ...extractProtected(targetSecond)])],
    ],
  }
}

/** 执行合并：片段、讨论、历史、冲突一起跟随到新片段。 */
export function applyMerge(plan: MergePlan, state: AppliedStructure): AppliedStructure & { mergedId: string } {
  const mergedId = newId('segment-merged')
  const first = plan.segments[0]
  const removedIds = new Set(plan.segments.map((segment) => segment.id))
  const merged: Segment = {
    id: mergedId,
    index: first.index,
    kind: plan.kind,
    sourceText: plan.sourceText,
    targetText: plan.targetText,
    status: plan.confirmedInvolved ? 'needs-work' : (first.status === 'confirmed' ? 'confirmed' : 'draft'),
    protectedTokens: extractProtected(`${plan.sourceText}\n\n${plan.targetText}`),
    note: plan.segments.map((segment) => segment.note).filter(Boolean).join(' / '),
  }
  const remaining = state.segments.filter((segment) => !removedIds.has(segment.id))
  const insertAt = remaining.findIndex((segment) => segment.index > first.index)
  const nextSegments = reindex(insertAt === -1 ? [...remaining, merged] : [...remaining.slice(0, insertAt), merged, ...remaining.slice(insertAt)])

  const discussions = state.discussions.map((discussion) => removedIds.has(discussion.segmentId) ? { ...discussion, segmentId: mergedId } : discussion)
  const history = [
    {
      id: newId('history'),
      segmentId: mergedId,
      author: '当前用户',
      action: 'merge' as const,
      before: plan.segments.map((segment) => `#${segment.index}`).join(' + '),
      after: '合并为一个片段，讨论与历史已跟随，已确认内容回到待处理。',
      createdAt: Date.now(),
    },
    ...state.history.map((entry) => removedIds.has(entry.segmentId) ? { ...entry, segmentId: mergedId } : entry),
  ]
  const conflicts = state.conflicts.map((conflict) => removedIds.has(conflict.segmentId) ? { ...conflict, segmentId: mergedId } : conflict)
  return { segments: nextSegments, discussions, history, conflicts, mergedId }
}

/** 执行拆分：讨论与历史跟随第一个片段，两个片段都重新计算受保护标记。 */
export function applySplit(segment: Segment, side: SplitSide, kinds: Array<Segment['kind']>, state: AppliedStructure): AppliedStructure & { firstId: string; secondId: string } {
  const firstId = newId('segment-split')
  const secondId = newId('segment-split')
  const sourceSecond = segment.sourceText.slice(side.source.length)
  const targetSecond = segment.targetText.slice(side.target.length)
  const resetStatus = (status: Segment['status']): Segment['status'] => status === 'confirmed' ? 'needs-work' : status
  const makeSegment = (id: string, offset: number, kind: Segment['kind'], sourceText: string, targetText: string, note: string): Segment => ({
    id,
    index: segment.index + offset,
    kind,
    sourceText: sourceText.trim(),
    targetText: targetText.trim(),
    status: resetStatus(segment.status),
    protectedTokens: extractProtected(`${sourceText}\n\n${targetText}`),
    note,
  })
  const first = makeSegment(firstId, 0, kinds[0], side.source, side.target, segment.note)
  const second = makeSegment(secondId, 1, kinds[1], sourceSecond, targetSecond, '')
  const nextSegments = reindex(state.segments.flatMap((item) => item.id === segment.id ? [first, second] : [item]))
  const discussions = state.discussions.map((discussion) => discussion.segmentId === segment.id ? { ...discussion, segmentId: firstId } : discussion)
  const history = [
    {
      id: newId('history'),
      segmentId: firstId,
      author: '当前用户',
      action: 'split' as const,
      before: `#${segment.index} 单一片段`,
      after: '在译文光标处拆分为两个片段，讨论与历史跟随首段，已确认内容回到待处理。',
      createdAt: Date.now(),
    },
    ...state.history.map((entry) => entry.segmentId === segment.id ? { ...entry, segmentId: firstId } : entry),
  ]
  const conflicts = state.conflicts.map((conflict) => conflict.segmentId === segment.id ? { ...conflict, segmentId: firstId } : conflict)
  return { segments: nextSegments, discussions, history, conflicts, firstId, secondId }
}

const reindex = (segments: Segment[]): Segment[] =>
  [...segments]
    .sort((a, b) => a.index - b.index)
    .map((segment, index) => ({ ...segment, index: index + 1 }))
