import { describe, expect, it } from 'vitest'
import { TASK_TITLE_MAX_LENGTH } from '../../src/shared/contracts/tasks'
import { appGetInfoArgsSchema } from '../../src/shared/validation/app'
import { tasksCreateArgsSchema, tasksListArgsSchema } from '../../src/shared/validation/tasks'

describe('IPC入力の検証スキーマ', () => {
  it('tasks.create: タイトルの前後空白を除去する', () => {
    const result = tasksCreateArgsSchema.safeParse([{ title: '  牛乳を買う \n' }])
    expect(result.success && result.data[0].title).toBe('牛乳を買う')
  })

  it.each([[''], ['   '], ['\n\t　']])('tasks.create: 空白だけのタイトル %j を拒否する', (title) => {
    const result = tasksCreateArgsSchema.safeParse([{ title }])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('タイトルを入力してください。')
  })

  it('tasks.create: 上限ちょうどは許可し、超えたら拒否する', () => {
    expect(tasksCreateArgsSchema.safeParse([{ title: 'あ'.repeat(TASK_TITLE_MAX_LENGTH) }]).success).toBe(true)
    // 前後空白は除去後に数える
    expect(tasksCreateArgsSchema.safeParse([{ title: ` ${'a'.repeat(TASK_TITLE_MAX_LENGTH)} ` }]).success).toBe(true)
    expect(tasksCreateArgsSchema.safeParse([{ title: 'a'.repeat(TASK_TITLE_MAX_LENGTH + 1) }]).success).toBe(false)
  })

  it.each([
    ['引数なし', []],
    ['余分な引数', [{ title: 'a' }, 'extra']],
    ['余分なキー', [{ title: 'a', id: 'x' }]],
    ['文字列以外', [{ title: 1 }]],
    ['nullの入力', [null]]
  ])('tasks.create: 不正な形（%s）を拒否する', (_label, args) => {
    expect(tasksCreateArgsSchema.safeParse(args).success).toBe(false)
  })

  it('引数なしのAPIは余分な引数を拒否する', () => {
    expect(tasksListArgsSchema.safeParse([]).success).toBe(true)
    expect(tasksListArgsSchema.safeParse(['x']).success).toBe(false)
    expect(appGetInfoArgsSchema.safeParse([{}]).success).toBe(false)
  })
})
