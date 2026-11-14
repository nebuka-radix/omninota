import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from '../src/shared/app-identity'

type PackageJson = {
  name: string
  productName: string
  build: { appId: string; productName: string }
}

// package.json（electron-builder設定を含む）とapp-identity.tsの名称・IDの一致を確認する。
describe('アプリ名・IDの整合性', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson

  it('package.jsonとapp-identity.tsが一致する', () => {
    expect(pkg.name).toBe(APP_IDENTITY.packageName)
    expect(pkg.productName).toBe(APP_IDENTITY.displayName)
    expect(pkg.build.appId).toBe(APP_IDENTITY.appId)
    expect(pkg.build.productName).toBe(APP_IDENTITY.displayName)
  })

  it('通常利用のuserData名は表示名と一致し、開発用と異なる', () => {
    expect(APP_IDENTITY.userDataDirName).toBe("GTD")
    expect(APP_IDENTITY.devUserDataDirName).not.toBe(APP_IDENTITY.userDataDirName)
  })
})
