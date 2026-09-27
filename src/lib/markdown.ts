import type { GlossaryTerm, Segment, SegmentKind, TranslationIssue } from './types'

const variablePattern = /\{\{[^{}]+\}\}|\{[A-Za-z_][\w.-]*\}|%\([^)]+\)[sd]|%[sd]/g
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g

export const unique = <T,>(items: T[]) => Array.from(new Set(items))
export const extractVariables = (text: string) => unique(text.match(variablePattern) ?? [])
export const extractLinks = (text: string) => unique(Array.from(text.matchAll(linkPattern), (match) => match[1]))
export const extractProtected = (text: string) => unique([...extractVariables(text), ...extractLinks(text)])

export const segmentKind = (text: string, fencedCode: boolean): SegmentKind => {
  if (fencedCode || /^ {4}\S/m.test(text)) return 'code'
  if (/^#{1,6}\s+/.test(text)) return 'heading'
  if (extractLinks(text).length) return 'link'
  if (extractVariables(text).length) return 'variable'
  return 'paragraph'
}

export const parseMarkdown = (markdown: string): Segment[] => {
  const normalized = markdown.replace(/\r/g, '')
  const blocks: { text: string; code: boolean }[] = []
  const codeFence = /```[\s\S]*?```/g
  let cursor = 0
  for (const match of normalized.matchAll(codeFence)) {
    const before = normalized.slice(cursor, match.index).split(/\n{2,}/).filter((part) => part.trim())
    blocks.push(...before.map((text) => ({ text: text.trim(), code: false })))
    blocks.push({ text: match[0].trim(), code: true })
    cursor = (match.index ?? 0) + match[0].length
  }
  blocks.push(...normalized.slice(cursor).split(/\n{2,}/).filter((part) => part.trim()).map((text) => ({ text: text.trim(), code: false })))
  return blocks.map((block, index) => ({
    id: `segment-import-${index + 1}`,
    index: index + 1,
    kind: segmentKind(block.text, block.code),
    sourceText: block.text,
    targetText: '',
    status: 'draft' as const,
    protectedTokens: extractProtected(block.text),
    note: '',
  }))
}

const meaningful = (text: string) => text.replace(/[#*_`>\s]/g, '').length > 1

export const analyzeSegment = (segment: Segment, glossary: GlossaryTerm[]): TranslationIssue[] => {
  const issues: TranslationIssue[] = []
  const sourceVariables = extractVariables(segment.sourceText)
  const targetVariables = extractVariables(segment.targetText)
  const sourceLinks = extractLinks(segment.sourceText)
  const targetLinks = extractLinks(segment.targetText)
  if (meaningful(segment.sourceText) && !segment.targetText.trim()) {
    issues.push({ id: `${segment.id}-missing`, segmentId: segment.id, type: 'missing-translation', severity: 'error', message: '译文为空，存在漏译。' })
  }
  const missingVariables = sourceVariables.filter((token) => !targetVariables.includes(token))
  if (missingVariables.length) {
    issues.push({ id: `${segment.id}-variable`, segmentId: segment.id, type: 'missing-variable', severity: 'error', message: `缺少变量占位符：${missingVariables.join('、')}`, expected: missingVariables.join(' ') })
  }
  const missingLinks = sourceLinks.filter((url) => !targetLinks.includes(url))
  if (missingLinks.length) {
    issues.push({ id: `${segment.id}-link`, segmentId: segment.id, type: 'link-mismatch', severity: 'warning', message: `链接目标不一致或缺失：${missingLinks.join('、')}`, expected: missingLinks.join(' ') })
  }
  for (const term of glossary) {
    const sourceHit = term.caseSensitive ? segment.sourceText.includes(term.source) : segment.sourceText.toLowerCase().includes(term.source.toLowerCase())
    if (sourceHit && segment.targetText && !segment.targetText.includes(term.target)) {
      issues.push({ id: `${segment.id}-term-${term.id}`, segmentId: segment.id, type: 'glossary', severity: 'warning', message: `术语“${term.source}”应译为“${term.target}”。`, expected: term.target })
    }
  }
  if (segment.kind === 'code' && segment.targetText && segment.sourceText !== segment.targetText) {
    issues.push({ id: `${segment.id}-code`, segmentId: segment.id, type: 'code-format', severity: 'error', message: '代码块应保持原样，不能翻译或改动格式。' })
  }
  return issues
}

export const analyzeDocument = (segments: Segment[], glossary: GlossaryTerm[]) =>
  segments.flatMap((segment) => segment.status === 'confirmed' ? [] : analyzeSegment(segment, glossary))

export const renderTargetMarkdown = (segments: Segment[]) =>
  segments.map((segment) => segment.targetText || segment.sourceText).join('\n\n')

export const headingLevel = (text: string) => {
  const match = text.match(/^(#{1,6})\s+/)
  return match ? match[1].length : 0
}

export interface ProtectedSpan { start: number; end: number; token: string }

export const protectedSpans = (text: string): ProtectedSpan[] => [
  ...Array.from(text.matchAll(variablePattern), (match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, token: match[0] })),
  ...Array.from(text.matchAll(linkPattern), (match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, token: match[0] })),
].sort((a, b) => a.start - b.start)

export const validateMerge = (parts: Segment[], all: Segment[]): string[] => {
  const reasons: string[] = []
  if (parts.length < 2) return ['至少选择两个相邻片段才能合并。']
  const positions = parts.map((part) => all.findIndex((segment) => segment.id === part.id)).sort((a, b) => a - b)
  if (positions.some((position) => position === -1)) reasons.push('所选片段已不在当前文档中，请重新选择。')
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] !== positions[index - 1] + 1) { reasons.push('只能合并相邻片段，当前选择中间隔着其他片段。'); break }
  }
  if (parts.some((part) => part.kind === 'code')) reasons.push('选区包含代码块，合并会破坏代码块边界。')
  const levels = parts.map((part) => headingLevel(part.sourceText))
  const headings = levels.filter((level) => level > 0)
  if (headings.length > 0 && headings.length < parts.length) reasons.push('标题不能与普通段落合并，会丢失标题层级。')
  if (new Set(headings).size > 1) reasons.push('所选标题层级不一致，合并会破坏标题结构。')
  const mergedSource = parts.map((part) => part.sourceText).join('\n\n')
  if ((mergedSource.match(/```/g) ?? []).length % 2 !== 0) reasons.push('合并后代码围栏 ``` 不成对，代码块归属不完整。')
  const dangling = parts.find((part) => (part.sourceText.replace(/`{2,}/g, '').match(/`/g) ?? []).length % 2 !== 0)
  if (dangling) reasons.push(`片段 #${dangling.index} 的行内代码反引号不成对，受保护标记归属不完整。`)
  return reasons
}

export const validateSplit = (segment: Segment, sourceCut: number, targetCut: number): string[] => {
  const reasons: string[] = []
  if (segment.kind === 'code') reasons.push('代码块不能拆分，会破坏代码块边界。')
  if (headingLevel(segment.sourceText) > 0) reasons.push('标题不能拆分，会破坏标题层级。')
  if (!segment.targetText.trim()) reasons.push('译文为空，请先在译文中输入内容并定位光标。')
  else if (targetCut <= 0 || targetCut > segment.targetText.trimEnd().length) reasons.push('请将光标放在译文中间，拆分点不能落在首尾。')
  if (!segment.sourceText.slice(0, sourceCut).trim() || !segment.sourceText.slice(sourceCut).trim()) reasons.push('拆分点太靠近源文边界，得不到两个非空片段。')
  const hitSource = protectedSpans(segment.sourceText).find((span) => sourceCut > span.start && sourceCut < span.end)
  if (hitSource) reasons.push(`源文拆分点落在受保护标记 ${hitSource.token} 内，归属不完整。`)
  const hitTarget = protectedSpans(segment.targetText).find((span) => targetCut > span.start && targetCut < span.end)
  if (hitTarget) reasons.push(`译文拆分点落在受保护标记 ${hitTarget.token} 内，归属不完整。`)
  return reasons
}

export const proportionalSourceCut = (sourceText: string, targetText: string, targetCut: number): number => {
  if (!sourceText.length || !targetText.length) return 0
  const ideal = Math.round((targetCut / targetText.length) * sourceText.length)
  const isBoundary = (position: number) => position <= 0 || position >= sourceText.length || /[\s。．.!！?？;；]/.test(sourceText[position - 1])
  for (let offset = 0; offset <= 80; offset += 1) {
    if (isBoundary(ideal + offset)) return Math.min(ideal + offset, sourceText.length)
    if (isBoundary(ideal - offset)) return Math.max(ideal - offset, 0)
  }
  return ideal
}
