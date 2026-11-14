import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// 画面枠（トップバー・ステータスバー）の差し込み先（フェーズ5.8）。
// 画面の表示設定（キーワード・状態・並べ替え）と件数は、状態を持つ画面側の部品がそのまま描画し、
// 表示位置だけをトップバー・ステータスバーへ移す（React のポータル）。状態を画面枠側へ複製しない。
// - 画面側の部品がアンマウントされると表示も消える（前の画面の設定・件数が残らない）。
// - 差し込み先の要素は画面枠が常に描画するため、画面の切り替え・入力中に作り直されない（入力・IME変換を中断しない）。
export type ShellSlotName = 'top-bar-controls' | 'status-count'

type Slots = {
  nodes: Partial<Record<ShellSlotName, HTMLElement | null>>
  register: (name: ShellSlotName, node: HTMLElement | null) => void
}

const ShellSlotsContext = createContext<Slots | null>(null)

export function ShellSlotsProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Slots['nodes']>({})
  // register は常に同じ関数にする（ref のコールバックが作り直されて登録・解除を繰り返さないように）
  const register = useCallback<Slots['register']>(
    (name, node) => setNodes((current) => (current[name] === node ? current : { ...current, [name]: node })),
    []
  )
  const value = useMemo<Slots>(() => ({ nodes, register }), [nodes, register])
  return <ShellSlotsContext.Provider value={value}>{children}</ShellSlotsContext.Provider>
}

// 差し込み先の要素に付ける ref（画面枠側で使う）
export function useShellSlotRef(name: ShellSlotName) {
  const slots = useContext(ShellSlotsContext)
  const register = slots?.register
  return useMemo(() => (node: HTMLElement | null) => register?.(name, node), [register, name])
}

// 画面側から差し込む。差し込み先がない（画面枠の外・準備前）場合は何も描画しない。
export function ShellSlot({ name, children }: { name: ShellSlotName; children: ReactNode }) {
  const node = useContext(ShellSlotsContext)?.nodes[name]
  return node ? createPortal(children, node) : null
}
