'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Combine, FileText, Info, Scissors, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { evaluateSplit, type MergePlan, type SplitKindChoice, type SplitSide } from '@/lib/structure'
import type { Segment } from '@/lib/types'
import { cn } from '@/lib/utils'

const kindLabel: Record<Segment['kind'], string> = { heading: '标题', paragraph: '段落', code: '代码块', link: '链接', variable: '占位符' }
const kindChoices: Array<[SplitKindChoice, string]> = [
  ['auto', '自动识别'], ['paragraph', '段落'], ['h1', 'H1 标题'], ['h2', 'H2 标题'], ['h3', 'H3 标题'],
  ['h4', 'H4'], ['h5', 'H5'], ['h6', 'H6'],
]

function DialogShell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-2.5 border-b bg-slate-50 px-5 py-3.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600/10 text-blue-700">{icon}</div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-slate-400" onClick={onClose}><X className="h-4 w-4" /></Button>
        </header>
        {children}
      </div>
    </div>
  )
}

function NoticeList({ blockers, notices }: { blockers: MergePlan['blockers']; notices: MergePlan['notices'] }) {
  return (
    <div className="space-y-2">
      {blockers.map((blocker, index) => (
        <div key={`${blocker.code}-${index}`} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{blocker.message}</span>
        </div>
      ))}
      {notices.map((notice, index) => (
        <div key={index} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5', notice.level === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800')}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{notice.message}</span>
        </div>
      ))}
    </div>
  )
}

export function MergePreviewDialog({ plan, onCancel, onConfirm }: { plan: MergePlan; onCancel: () => void; onConfirm: () => void }) {
  const blocked = plan.blockers.length > 0
  return (
    <DialogShell title="合并相邻片段 · 预览" icon={<Combine className="h-4 w-4" />} onClose={onCancel}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        <NoticeList blockers={plan.blockers} notices={plan.notices} />
        {blocked && <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">存在结构问题，已停在预览，不会修改片段。请取消后调整选择或先修复译文。</p>}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>将合并 {plan.segments.length} 个相邻片段：</span>
          {plan.segments.map((segment) => (
            <Badge key={segment.id} variant="outline" className="gap-1 text-[10px]"><FileText className="h-3 w-3" />#{String(segment.index).padStart(2, '0')} {kindLabel[segment.kind]}</Badge>
          ))}
          <Badge variant="secondary" className="text-[10px]">合并后：{kindLabel[plan.kind]}</Badge>
          {plan.confirmedInvolved && <Badge variant="warning" className="text-[10px]">确认后回到待处理</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">English · 合并后源文</div>
            <div className="document-prose max-h-64 overflow-y-auto p-3 text-xs leading-5 text-slate-700">{plan.sourceText}</div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-blue-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-500">简体中文 · 合并后译文</div>
            <div className="document-prose max-h-64 overflow-y-auto p-3 text-xs leading-5 text-slate-700">{plan.targetText || <span className="text-slate-400">（暂无译文）</span>}</div>
          </div>
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t bg-slate-50 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" disabled={blocked} onClick={onConfirm}><Combine className="h-4 w-4" />确认合并</Button>
      </footer>
    </DialogShell>
  )
}

export interface SplitConfirmPayload {
  side: SplitSide
  kindChoice: SplitKindChoice
}

export function SplitPreviewDialog({ segment, initialCut, onCancel, onConfirm }: {
  segment: Segment
  initialCut: SplitSide
  onCancel: () => void
  onConfirm: (payload: SplitConfirmPayload) => void
}) {
  const [side, setSide] = useState<SplitSide>(initialCut)
  const [kindChoice, setKindChoice] = useState<SplitKindChoice>('auto')
  useEffect(() => { setSide(initialCut); setKindChoice('auto') }, [initialCut])

  const evaluation = evaluateSplit(segment, side, kindChoice)
  const blocked = evaluation.blockers.length > 0
  const sourceSecond = segment.sourceText.slice(side.source.length)
  const targetSecond = segment.targetText.slice(side.target.length)

  const HalfEditor = ({ label, tone, value, onChange, placeholder, readOnly = false }: { label: string; tone: 'source' | 'target'; value: string; onChange?: (value: string) => void; placeholder?: string; readOnly?: boolean }) => (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn('border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider', tone === 'source' ? 'bg-slate-50 text-slate-400' : 'bg-blue-50 text-blue-500')}>{label}</div>
      {readOnly ? (
        <div className="document-prose min-h-[88px] bg-slate-50/50 p-2.5 text-xs leading-5 text-slate-600">{value || <span className="text-slate-400">{placeholder}</span>}</div>
      ) : (
        <Textarea value={value} onChange={(event) => onChange?.(event.target.value)} rows={5} className="resize-y rounded-none border-0 text-xs leading-5 focus-visible:ring-0" placeholder={placeholder} />
      )}
    </div>
  )

  return (
    <DialogShell title={`在片段 #${segment.index} 光标处拆分 · 预览`} icon={<Scissors className="h-4 w-4" />} onClose={onCancel}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        <NoticeList blockers={evaluation.blockers} notices={evaluation.notices} />
        {blocked && <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">边界不合法，已停在预览，不会修改片段。请调整切点或拆分类型。</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">拆分后片段类型：</span>
          <div className="flex flex-wrap gap-1">
            {kindChoices.map(([value, label]) => (
              <button key={value} onClick={() => setKindChoice(value)} className={cn('rounded-md border px-2 py-1 text-[10px] font-medium transition', kindChoice === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>{label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <HalfEditor label="English · 上半段源文（编辑内容即移动切点）" tone="source" value={side.source} onChange={(value) => setSide((current) => ({ ...current, source: value }))} />
          <HalfEditor label="简体中文 · 上半段译文（即光标之前的内容）" tone="target" value={side.target} onChange={(value) => setSide((current) => ({ ...current, target: value }))} placeholder="上半段暂无译文…" />
          <HalfEditor label="English · 下半段源文（只读预览）" tone="source" value={sourceSecond} readOnly />
          <HalfEditor label="简体中文 · 下半段译文（只读预览）" tone="target" value={targetSecond} readOnly placeholder="下半段暂无译文…" />
        </div>
        <p className="text-[10px] text-slate-400">切点由上半段内容末尾决定：直接增删上半段文本即可调整拆分边界，下半段会实时对应。</p>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          <span>拆分结果：</span>
          <Badge variant="outline" className="text-[10px]">上半段 · {kindLabel[evaluation.kinds[0]]} · {evaluation.protectedTokens[0]?.length ?? 0} 个受保护标记</Badge>
          <Badge variant="outline" className="text-[10px]">下半段 · {kindLabel[evaluation.kinds[1]]} · {evaluation.protectedTokens[1]?.length ?? 0} 个受保护标记</Badge>
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t bg-slate-50 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" disabled={blocked} onClick={() => onConfirm({ side, kindChoice })}><Scissors className="h-4 w-4" />确认拆分</Button>
      </footer>
    </DialogShell>
  )
}
