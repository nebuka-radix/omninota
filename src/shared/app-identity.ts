// 表示名はomninota。既存データの保存先は名称変更に連動させず維持する。
// 名称・ID・保存先の命名はここに集約する。
// package.jsonのname / productName、今後のelectron-builder設定もこの値に合わせる。
const displayName = 'omninota'

export const APP_IDENTITY = {
  displayName,
  packageName: 'omninota',
  appId: 'com.radix-studio.gtd',
  // userDataのディレクトリ名（~/Library/Application Support/ 配下）
  userDataDirName: 'GTD',
  devUserDataDirName: 'GTD-dev'
} as const
