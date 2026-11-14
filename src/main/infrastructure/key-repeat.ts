export type KeyRepeatPreferences = {
  setUserDefault: (key: string, type: 'boolean', value: boolean) => void
}

// Application NSUserDefaults only; never change the global key repeat rate.
export function enableNativeKeyRepeat(platform: string, preferences: KeyRepeatPreferences): void {
  if (platform === 'darwin') preferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false)
}
