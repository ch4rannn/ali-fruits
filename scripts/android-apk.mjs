// Builds the Android app. Usage: APP_URL=https://your-site npm run android:apk
// Add "release" for a Play Store bundle: APP_URL=https://your-site npm run android:apk -- release
// Needs the Android SDK and Java 21. Set JAVA_HOME if your default Java is a different version.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.APP_URL
if (!url) {
  console.error('Set APP_URL to your live website, for example APP_URL=https://alifruits.example npm run android:apk')
  process.exit(1)
}
const release = process.argv.includes('release')
const windows = process.platform === 'win32'
const env = { ...process.env }
if (!env.ANDROID_HOME && windows && env.LOCALAPPDATA) env.ANDROID_HOME = join(env.LOCALAPPDATA, 'Android', 'Sdk')

const run = (command, cwd = '.') => execSync(command, { stdio: 'inherit', env, cwd })

if (!existsSync('android')) run('npx cap add android')

// Use the app's own icon on every screen density, in place of the template's default.
const res = 'android/app/src/main/res'
rmSync(join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true })
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const folder = join(res, `mipmap-${density}`)
  mkdirSync(folder, { recursive: true })
  copyFileSync('public/icons/icon-192.png', join(folder, 'ic_launcher.png'))
  copyFileSync('public/icons/icon-192.png', join(folder, 'ic_launcher_round.png'))
}

run('npx cap copy android')
run(`${windows ? 'gradlew.bat' : './gradlew'} ${release ? 'bundleRelease' : 'assembleDebug'} --no-daemon`, 'android')
console.log(release ? 'Bundle: android/app/build/outputs/bundle/release/app-release.aab (sign it before uploading to Play)' : 'APK: android/app/build/outputs/apk/debug/app-debug.apk')
