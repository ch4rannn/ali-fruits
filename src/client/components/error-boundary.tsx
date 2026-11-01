import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Shows a way forward instead of a blank screen. Most often this is a stale tab after a new version was deployed. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-3xl text-forest">Something went wrong</h1>
          <p className="mt-2 text-ink-soft">This page could not be shown. Reloading usually fixes it, and your cart is saved.</p>
          <button type="button" className="mt-4 h-11 rounded-md bg-forest px-5 font-semibold text-paper" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    )
  }
}
