import { useCallback, useEffect, useRef } from 'react'
import { useGroupRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  clampWidth,
  WORKSPACE_LIMITS,
  type WorkspaceSettings
} from '../../../../shared/contracts/workspace'
import { computePaneWidths, inferOperatedPane, type PaneKey } from './pane-layout'
import { useWorkspace } from './WorkspaceContext'

// 希望幅（保存する値）と実寸（表示する値）を分けて扱う。
// - 希望幅を更新するのは、ユーザーが境界線を直接操作した時（ポインター・キーボード・ダブルクリック）だけ。
//   更新するのは操作した境界線に対応するペインの希望幅だけで、反対側のペインは変えない。
// - 実寸は、希望幅・表示可能な幅・最小幅から computePaneWidths で計算し、
//   ライブラリの公開API（groupRef.setLayout）で適用する。この適用はユーザー操作にならないため保存されない。
// - ウィンドウサイズ変更・詳細パネルの開閉・起動時の復元では、実寸の再計算だけを行う。
const TOLERANCE_PX = 1

type Measured = { sidebar: number; main: number; detail: number | null; available: number }

export function usePaneLayout(compact = false, hideDetail = false) {
  const { settings: workspaceSettings, setSidebarWidth, setDetailWidth } = useWorkspace()
  const settings = hideDetail ? { ...workspaceSettings, detailVisible: false } : workspaceSettings
  const groupRef = useGroupRef()
  const groupElementRef = useRef<HTMLDivElement>(null)
  const sidebarElementRef = useRef<HTMLDivElement>(null)
  const mainElementRef = useRef<HTMLDivElement>(null)
  const detailElementRef = useRef<HTMLDivElement>(null)

  // 最新の希望幅（コールバック内で古い値を使わないため）
  const settingsRef = useRef<WorkspaceSettings>(settings)
  settingsRef.current = settings
  // 幅が足りない時に縮めない側（直前にユーザーが操作したペイン）
  const priorityRef = useRef<PaneKey>('sidebar')
  // 境界線のポインター・キー操作で記録する、操作中の境界線
  const operatedRef = useRef<PaneKey | null>(null)
  // 直前に確認した実寸（操作した境界線が記録されていない場合の判定に使う）
  const lastMeasuredRef = useRef<Measured | null>(null)

  const measure = useCallback((): Measured | null => {
    const sidebar = sidebarElementRef.current?.getBoundingClientRect().width
    const main = mainElementRef.current?.getBoundingClientRect().width
    if (sidebar === undefined || main === undefined) return null
    const detailRect = detailElementRef.current?.getBoundingClientRect()
    const detail = settingsRef.current.detailVisible && detailRect ? detailRect.width : null
    return { sidebar, main, detail, available: sidebar + main + (detail ?? 0) }
  }, [])

  // 希望幅から実寸を計算し、現在の表示と違えば適用する。
  const reconcile = useCallback(() => {
    const measured = measure()
    const group = groupRef.current
    if (!measured || !group || measured.available <= 0) return
    const current = settingsRef.current
    const target = computePaneWidths({
      available: measured.available,
      sidebarPreferred: current.sidebarWidth,
      detailPreferred: current.detailVisible ? current.detailWidth : null,
      priority: priorityRef.current
    })
    const differs =
      Math.abs(target.sidebar - measured.sidebar) > TOLERANCE_PX ||
      (target.detail !== null && measured.detail !== null && Math.abs(target.detail - measured.detail) > TOLERANCE_PX)
    if (differs) {
      const toPercent = (px: number) => (px / measured.available) * 100
      const layout: Layout = { sidebar: toPercent(target.sidebar), main: toPercent(target.main) }
      if (target.detail !== null) layout['detail'] = toPercent(target.detail)
      group.setLayout(layout)
    }
    lastMeasuredRef.current = measure()
  }, [groupRef, measure])

  // ユーザー操作で確定した幅を、操作したペインの希望幅として反映する。
  const commitUserResize = useCallback(() => {
    const measured = measure()
    if (!measured) return
    const pane = operatedRef.current ?? inferOperatedPane(lastMeasuredRef.current ?? measured, measured)
    operatedRef.current = null
    if (pane === 'sidebar') {
      const width = clampWidth(measured.sidebar, WORKSPACE_LIMITS.sidebarWidth)
      settingsRef.current = { ...settingsRef.current, sidebarWidth: width }
      setSidebarWidth(width)
    } else if (pane === 'detail' && measured.detail !== null) {
      const width = clampWidth(measured.detail, WORKSPACE_LIMITS.detailWidth)
      settingsRef.current = { ...settingsRef.current, detailWidth: width }
      setDetailWidth(width)
    }
    if (pane) priorityRef.current = pane
  }, [measure, setSidebarWidth, setDetailWidth])

  // ライブラリの通知。ドラッグ中（onLayoutChange）は扱わず、確定時（onLayoutChanged）だけを見る。
  // 反映後のDOMを測るため、次の描画フレームで処理する。
  const handleLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      requestAnimationFrame(() => {
        if (meta.isUserInteraction) commitUserResize()
        reconcile()
      })
    },
    [commitUserResize, reconcile]
  )

  // ウィンドウサイズの変更でも再計算する（ライブラリの通知の有無に依存しない）。
  useEffect(() => {
    if (compact) return
    const element = groupElementRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reconcile)
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [reconcile, compact])

  // 詳細パネルの開閉後も再計算する（希望幅は変えない）。
  useEffect(() => {
    const frame = requestAnimationFrame(reconcile)
    return () => cancelAnimationFrame(frame)
  }, [settings.detailVisible, reconcile, compact])

  // 境界線の操作開始（ポインター・キー）を記録する。
  const markOperated = useCallback((pane: PaneKey) => {
    operatedRef.current = pane
  }, [])

  // 境界線のダブルクリック: そのペインを既定幅に戻し、そのペインの希望幅だけを保存する。
  const resetToDefault = useCallback(
    (pane: PaneKey) => {
      operatedRef.current = null
      priorityRef.current = pane
      if (pane === 'sidebar') {
        settingsRef.current = { ...settingsRef.current, sidebarWidth: DEFAULT_WORKSPACE_SETTINGS.sidebarWidth }
        setSidebarWidth(DEFAULT_WORKSPACE_SETTINGS.sidebarWidth)
      } else {
        settingsRef.current = { ...settingsRef.current, detailWidth: DEFAULT_WORKSPACE_SETTINGS.detailWidth }
        setDetailWidth(DEFAULT_WORKSPACE_SETTINGS.detailWidth)
      }
      reconcile()
    },
    [reconcile, setSidebarWidth, setDetailWidth]
  )

  return {
    groupRef,
    groupElementRef,
    sidebarElementRef,
    mainElementRef,
    detailElementRef,
    handleLayoutChanged,
    markOperated,
    resetToDefault
  }
}

