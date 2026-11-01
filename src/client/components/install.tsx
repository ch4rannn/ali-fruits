import { Download } from 'lucide-react'
import { useInstall } from '../lib/pwa'
import { Button, cx } from './ui'

/** Appears only when the phone can actually install the app, and on iPhone explains the manual steps. */
export function InstallButton({ className }: { className?: string }) {
  const install = useInstall()
  if (install.installed) return null
  if (install.canPrompt) {
    return (
      <Button variant="secondary" size="sm" className={className} onClick={() => void install.install()}>
        <Download className="size-4" aria-hidden />
        Install app
      </Button>
    )
  }
  if (install.iosHint) return <p className={cx('text-sm text-ink-soft', className)}>To install on iPhone, tap Share, then Add to Home Screen.</p>
  return null
}
