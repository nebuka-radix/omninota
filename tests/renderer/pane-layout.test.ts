import { describe, expect, it } from 'vitest'
import { computePaneWidths, inferOperatedPane } from '../../src/renderer/src/features/workspace/pane-layout'

// 最小幅: サイドバー108（フェーズ5.8で180から変更）/ メイン320 / 詳細220
describe('希望幅から実寸を計算する', () => {
  it('十分な幅があれば希望幅のまま表示する', () => {
    expect(
      computePaneWidths({ available: 1150, sidebarPreferred: 240, detailPreferred: 320, priority: 'sidebar' })
    ).toEqual({ sidebar: 240, main: 590, detail: 320 })
  })

  it('サイドバーを広げて足りなくなった分は、詳細パネルの実寸だけを縮める（例: 320 → 240）', () => {
    // 1150 - 510 - 320 = 320 で main が最小幅。サイドバーを590にすると80px不足する
    expect(
      computePaneWidths({ available: 1150, sidebarPreferred: 480, detailPreferred: 320, priority: 'sidebar' })
    ).toEqual({ sidebar: 480, main: 350, detail: 320 })
    const narrow = computePaneWidths({ available: 1040, sidebarPreferred: 480, detailPreferred: 320, priority: 'sidebar' })
    expect(narrow).toEqual({ sidebar: 480, main: 320, detail: 240 })
  })

  it('サイドバーを狭めて幅ができたら、詳細パネルは希望幅へ戻る', () => {
    expect(
      computePaneWidths({ available: 1040, sidebarPreferred: 300, detailPreferred: 320, priority: 'sidebar' })
    ).toEqual({ sidebar: 300, main: 420, detail: 320 })
  })

  it('詳細パネルを操作した時は、サイドバー側を先に縮める', () => {
    expect(
      computePaneWidths({ available: 1040, sidebarPreferred: 400, detailPreferred: 500, priority: 'detail' })
    ).toEqual({ sidebar: 220, main: 320, detail: 500 })
  })

  it('両方を最小幅まで縮めても足りなければ、メインパネルが最小幅を下回る', () => {
    expect(
      computePaneWidths({ available: 580, sidebarPreferred: 300, detailPreferred: 300, priority: 'sidebar' })
    ).toEqual({ sidebar: 108, main: 252, detail: 220 })
  })

  it('詳細パネル非表示ではサイドバーとメインだけで配分する', () => {
    expect(
      computePaneWidths({ available: 600, sidebarPreferred: 400, detailPreferred: null, priority: 'detail' })
    ).toEqual({ sidebar: 280, main: 320, detail: null })
  })

  it('希望幅が範囲外なら範囲内として扱う', () => {
    expect(
      computePaneWidths({ available: 2000, sidebarPreferred: 9999, detailPreferred: 1, priority: 'sidebar' })
    ).toEqual({ sidebar: 480, main: 1300, detail: 220 })
  })
})

describe('操作した境界線が記録されていない場合の判定', () => {
  it('片方だけ変わればそのペイン', () => {
    expect(inferOperatedPane({ sidebar: 240, detail: 300 }, { sidebar: 300, detail: 300 })).toBe('sidebar')
    expect(inferOperatedPane({ sidebar: 240, detail: 300 }, { sidebar: 240, detail: 360 })).toBe('detail')
  })

  it('両方変わった場合は広がった側（反対側は押されて縮んだ）', () => {
    expect(inferOperatedPane({ sidebar: 240, detail: 320 }, { sidebar: 480, detail: 240 })).toBe('sidebar')
    expect(inferOperatedPane({ sidebar: 400, detail: 300 }, { sidebar: 250, detail: 500 })).toBe('detail')
  })

  it('変化がなければnull（1px以内は誤差）', () => {
    expect(inferOperatedPane({ sidebar: 240, detail: 300 }, { sidebar: 240.6, detail: 300 })).toBeNull()
  })
})
