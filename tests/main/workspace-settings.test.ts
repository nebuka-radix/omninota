import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createSettingsRepository, SETTINGS_KEYS } from '../../src/main/repositories/settings-repository'
import { createWorkspaceSettingsService } from '../../src/main/services/workspace-settings-service'
import { DEFAULT_WORKSPACE_SETTINGS, WORKSPACE_LIMITS, type WorkspaceSettings } from '../../src/shared/contracts/workspace'
import {
  normalizeWorkspaceSettings,
  workspaceGetArgsSchema,
  workspaceSaveArgsSchema
} from '../../src/shared/validation/workspace'
import { createTempDir, MIGRATIONS_DIR } from '../helpers/temp-database'

const valid: WorkspaceSettings = {
  version: 1,
  sidebarWidth: 260,
  detailWidth: 320,
  detailVisible: false,
  lastRoute: '/settings',
  milestoneCardWidth: 400
}

describe('workspace.save の入力検証（厳格）', () => {
  it('正しい設定を受け付ける', () => {
    expect(workspaceSaveArgsSchema.safeParse([valid]).success).toBe(true)
  })

  it.each<[string, unknown[]]>([
    ['引数なし', []],
    ['余分なキー', [{ ...valid, openTabs: [] }]],
    ['未知の画面', [{ ...valid, lastRoute: '/review' }]],
    ['プロジェクトIDが不正', [{ ...valid, lastRoute: '/projects/not-a-uuid' }]],
    ['プロジェクトIDが大文字', [{ ...valid, lastRoute: '/projects/6F1C2F8E-3C1D-4F0A-9B7E-2A6D1F3C9E10' }]],
    ['プロジェクトの下位パス', [{ ...valid, lastRoute: '/projects/6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10/x' }]],
    ['外部URL', [{ ...valid, lastRoute: 'https://example.com/projects/6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10' }]],
    ['パストラバーサル', [{ ...valid, lastRoute: '/projects/../settings' }]],
    ['バージョン違い', [{ ...valid, version: 2 }]],
    ['サイドバー幅が最小未満', [{ ...valid, sidebarWidth: WORKSPACE_LIMITS.sidebarWidth.min - 1 }]],
    ['詳細幅が最大超過', [{ ...valid, detailWidth: WORKSPACE_LIMITS.detailWidth.max + 1 }]],
    ['幅が小数', [{ ...valid, sidebarWidth: 250.5 }]],
    ['カード幅が最小未満', [{ ...valid, milestoneCardWidth: WORKSPACE_LIMITS.milestoneCardWidth.min - 1 }]],
    ['カード幅が最大超過', [{ ...valid, milestoneCardWidth: WORKSPACE_LIMITS.milestoneCardWidth.max + 1 }]],
    ['カード幅が文字列', [{ ...valid, milestoneCardWidth: '320' }]],
    ['カード幅なし', [(({ milestoneCardWidth: _omit, ...rest }) => rest)(valid)]],
    ['表示状態が文字列', [{ ...valid, detailVisible: 'true' }]],
    ['任意キー指定の試み', ['theme', 'dark']]
  ])('拒否する: %s', (_label, args) => {
    expect(workspaceSaveArgsSchema.safeParse(args).success).toBe(false)
  })

  it('workspace.get は引数を受け付けない', () => {
    expect(workspaceGetArgsSchema.safeParse([]).success).toBe(true)
    expect(workspaceGetArgsSchema.safeParse(['workspace']).success).toBe(false)
  })
})

describe('保存値の読み取り時の正規化（フォールバック）', () => {
  it('未保存なら既定値', () => {
    expect(normalizeWorkspaceSettings(undefined)).toEqual({ settings: DEFAULT_WORKSPACE_SETTINGS, source: 'default' })
  })

  it.each([['壊れたJSON', '{"version":1,'], ['JSONの配列', '[]'], ['バージョン違い', '{"version":99}'], ['null', 'null']])(
    '%s なら既定値',
    (_label, raw) => {
      expect(normalizeWorkspaceSettings(raw)).toEqual({ settings: DEFAULT_WORKSPACE_SETTINGS, source: 'default' })
    }
  )

  it('正しい保存値はそのまま使う', () => {
    expect(normalizeWorkspaceSettings(JSON.stringify(valid))).toEqual({ settings: valid, source: 'saved' })
  })

  it('フェーズ3〜4で保存した設定（/inbox・/settings）をそのまま読み込める', () => {
    for (const lastRoute of ['/inbox', '/settings'] as const) {
      const raw = JSON.stringify({ ...valid, lastRoute })
      expect(normalizeWorkspaceSettings(raw)).toEqual({ settings: { ...valid, lastRoute }, source: 'saved' })
    }
  })

  it('Projectsの画面（/projects・/projects/<UUID>）を保存・復元できる', () => {
    const projectRoute = '/projects/6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10' as const
    for (const lastRoute of ['/projects', projectRoute] as const) {
      expect(workspaceSaveArgsSchema.safeParse([{ ...valid, lastRoute }]).success).toBe(true)
      const raw = JSON.stringify({ ...valid, lastRoute })
      expect(normalizeWorkspaceSettings(raw)).toEqual({ settings: { ...valid, lastRoute }, source: 'saved' })
    }
  })

  it.each([
    ['/projects/not-a-uuid'],
    ['/projects/6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10/tasks'],
    ['https://example.com/'],
    ['javascript:alert(1)'],
    ['/projects/../settings']
  ])('読み取り時: 不正なルート %j は /inbox に補正する（他の項目は保持）', (lastRoute) => {
    const raw = JSON.stringify({ ...valid, lastRoute })
    expect(normalizeWorkspaceSettings(raw)).toEqual({ settings: { ...valid, lastRoute: '/inbox' }, source: 'repaired' })
  })

  it('範囲外の幅は範囲内に丸め、型違い・未知の画面は項目ごとに既定値にする', () => {
    const raw = JSON.stringify({
      version: 1,
      sidebarWidth: 99999,
      detailWidth: 10,
      detailVisible: 'yes',
      lastRoute: '/review',
      milestoneCardWidth: 5000
    })
    expect(normalizeWorkspaceSettings(raw)).toEqual({
      settings: {
        version: 1,
        sidebarWidth: WORKSPACE_LIMITS.sidebarWidth.max,
        detailWidth: WORKSPACE_LIMITS.detailWidth.min,
        detailVisible: DEFAULT_WORKSPACE_SETTINGS.detailVisible,
        lastRoute: '/inbox',
        milestoneCardWidth: WORKSPACE_LIMITS.milestoneCardWidth.max
      },
      source: 'repaired'
    })
  })

  it('カード幅（フェーズ5.5）: 未設定の旧形式は既定値（320px）で補い、補正扱いにしない。他の項目（左右の幅など）は変えない', () => {
    const { milestoneCardWidth: _omit, ...legacy } = valid
    expect(DEFAULT_WORKSPACE_SETTINGS.milestoneCardWidth).toBe(320)
    expect(normalizeWorkspaceSettings(JSON.stringify(legacy))).toEqual({
      settings: { ...legacy, milestoneCardWidth: 320 },
      source: 'saved'
    })
  })

  it.each<[string, unknown, number]>([
    ['最小未満', 10, WORKSPACE_LIMITS.milestoneCardWidth.min],
    ['最大超過', 99999, WORKSPACE_LIMITS.milestoneCardWidth.max],
    ['小数', 300.4, 300],
    ['文字列', '400', 320],
    ['null', null, 320],
    ['NaN相当（文字列）', 'NaN', 320]
  ])('カード幅が %s なら範囲内・既定値に補正する（左右の幅は変えない）', (_label, milestoneCardWidth, expected) => {
    const raw = JSON.stringify({ ...valid, milestoneCardWidth })
    const result = normalizeWorkspaceSettings(raw)
    expect(result.settings).toEqual({ ...valid, milestoneCardWidth: expected })
    expect(result.source).toBe('repaired')
  })
})

describe('Workspace設定の保存・取得（一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  const logger = { warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    logger.warn.mockClear()
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const service = () => createWorkspaceSettingsService({ repository: createSettingsRepository(db), logger })

  it('未保存なら既定値を返し、DBには書き込まない', () => {
    expect(service().get()).toEqual(DEFAULT_WORKSPACE_SETTINGS)
    expect(createSettingsRepository(db).get(SETTINGS_KEYS.workspace)).toBeUndefined()
  })

  it('保存した値を取得でき、上書き保存で最新値になる', () => {
    service().save(valid)
    expect(service().get()).toEqual(valid)
    service().save({ ...valid, sidebarWidth: 300 })
    expect(service().get().sidebarWidth).toBe(300)
    // カード幅は左右の幅とは独立して保存・取得できる
    service().save({ ...valid, sidebarWidth: 300, milestoneCardWidth: 512 })
    expect(service().get()).toEqual({ ...valid, sidebarWidth: 300, milestoneCardWidth: 512 })
    const count = db.$client.prepare('SELECT COUNT(*) AS c FROM app_settings').get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('DB上の値が壊れていても既定値で読み込み、DBの値は書き換えない', () => {
    createSettingsRepository(db).upsert({ key: 'workspace', value: 'not json', updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(service().get()).toEqual(DEFAULT_WORKSPACE_SETTINGS)
    expect(createSettingsRepository(db).get('workspace')?.value).toBe('not json')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('IPCハンドラー経由: 不正な保存要求はINVALID_INPUTで、DBは変わらない', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const handler = createIpcHandler({
      channel: 'workspace:save',
      argsSchema: workspaceSaveArgsSchema,
      policy,
      logger,
      run: ([settings]) => service().save(settings)
    })

    expect(await handler(event, { ...valid, sidebarWidth: 5 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(createSettingsRepository(db).get('workspace')).toBeUndefined()

    expect(await handler(event, valid)).toEqual({ ok: true, data: valid })
    expect(service().get()).toEqual(valid)
  })
})
