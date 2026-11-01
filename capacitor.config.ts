import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android app opens the live website inside a native shell, so prices, orders and every fix stay
 * in one place and a website deploy updates the app. Build it with: APP_URL=https://your-site npm run android:apk
 */
const url = process.env.APP_URL

const config: CapacitorConfig = {
  appId: 'in.alifruits.app',
  appName: 'Ali Fruits',
  webDir: 'mobile/www',
  server: url ? { url, cleartext: url.startsWith('http://'), errorPath: 'offline.html' } : undefined,
  android: { allowMixedContent: false },
}

export default config
