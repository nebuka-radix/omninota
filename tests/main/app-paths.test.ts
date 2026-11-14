import { describe, expect, it } from 'vitest'
import {
  isAllowedAppUrl,
  resolveDatabaseFile,
  resolveMigrationsDir,
  resolveUserDataDir
} from '../../src/main/infrastructure/app-paths'

const appData = '/Users/test/Library/Application Support'

describe('保存先の解決', () => {
  it('開発・previewはGTD-dev、パッケージ版はGTDを使う', () => {
    expect(resolveUserDataDir({ isPackaged: false, appDataDir: appData })).toBe(`${appData}/GTD-dev`)
    expect(resolveUserDataDir({ isPackaged: true, appDataDir: appData })).toBe(`${appData}/GTD`)
  })

  it('検証用の上書き（GTD_DEV_USER_DATA_DIR）は未パッケージ時・絶対パスだけ有効', () => {
    expect(resolveUserDataDir({ isPackaged: false, appDataDir: appData, devOverrideDir: '/tmp/gtd-verify' })).toBe(
      '/tmp/gtd-verify'
    )
    expect(resolveUserDataDir({ isPackaged: true, appDataDir: appData, devOverrideDir: '/tmp/gtd-verify' })).toBe(
      `${appData}/GTD`
    )
    expect(resolveUserDataDir({ isPackaged: false, appDataDir: appData, devOverrideDir: 'relative/dir' })).toBe(
      `${appData}/GTD-dev`
    )
  })

  it('DBファイル名はgtd.sqlite', () => {
    expect(resolveDatabaseFile(`${appData}/GTD`)).toBe(`${appData}/GTD/gtd.sqlite`)
  })

  it('マイグレーションは開発時はプロジェクト直下、パッケージ版はResources配下', () => {
    const base = { appPath: '/repo', resourcesPath: '/Applications/GTD.app/Contents/Resources' }
    expect(resolveMigrationsDir({ ...base, isPackaged: false })).toBe('/repo/migrations')
    expect(resolveMigrationsDir({ ...base, isPackaged: true })).toBe(
      '/Applications/GTD.app/Contents/Resources/migrations'
    )
  })
})

describe('許可するアプリURL', () => {
  const indexHtmlPath = '/repo/out/renderer/index.html'

  it('ビルド後はindex.html（ハッシュ付き含む）だけを許可する', () => {
    const options = { devServerUrl: null, indexHtmlPath }
    expect(isAllowedAppUrl('file:///repo/out/renderer/index.html#/settings', options)).toBe(true)
    expect(isAllowedAppUrl('file:///etc/hosts', options)).toBe(false)
    expect(isAllowedAppUrl('https://example.com/', options)).toBe(false)
    expect(isAllowedAppUrl('not a url', options)).toBe(false)
  })

  it('開発時は開発サーバーと同じオリジンだけを許可する', () => {
    const options = { devServerUrl: 'http://localhost:5173', indexHtmlPath }
    expect(isAllowedAppUrl('http://localhost:5173/#/inbox', options)).toBe(true)
    expect(isAllowedAppUrl('http://localhost:5174/', options)).toBe(false)
    expect(isAllowedAppUrl('file:///repo/out/renderer/index.html', options)).toBe(false)
  })
})
