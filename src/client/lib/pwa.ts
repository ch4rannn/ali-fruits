import { useEffect, useState } from 'react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallEvent
    listeners.forEach((listener) => listener())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((listener) => listener())
  })
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/** Offers installation where the browser supports a prompt, and explains the manual steps on iPhone. */
export function useInstall() {
  const [, tick] = useState(0)
  useEffect(() => {
    const listener = () => tick((n) => n + 1)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  const installed = isStandalone()
  return {
    installed,
    canPrompt: Boolean(deferred) && !installed,
    iosHint: isIos() && !installed,
    async install() {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      tick((n) => n + 1)
    },
  }
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Each part of the business installs as its own app: shop, staff and riders get different home-screen icons. */
export function useAppManifest(kind: 'shop' | 'admin' | 'rider') {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (link) link.href = kind === 'shop' ? '/manifest.webmanifest' : `/${kind}.webmanifest`
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (theme) theme.content = kind === 'rider' ? '#153a20' : '#1e4d2b'
  }, [kind])
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app works the same without offline support.
    })
  })
}
