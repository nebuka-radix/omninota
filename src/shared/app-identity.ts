// 開発上の仮名称。最終的な公開名とは別に決める。
// 名称・ID・保存先の命名はここに集約する。
// package.jsonのname / productName、今後のelectron-builder設定もこの値に合わせる。
const displayName = 'GTD'

export const APP_IDENTITY = {
  displayName,
  packageName: 'gtd-desktop',
  appId: 'com.radix-studio.gtd',
  // userDataのディレクトリ名（~/Library/Application Support/ 配下）
  userDataDirName: displayName,
  devUserDataDirName: `${displayName}-dev`
} as const
