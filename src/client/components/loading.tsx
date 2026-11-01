import { useLocation } from 'react-router-dom'
import { Spinner } from './ui'

// Read once, before React replaces it: the readable text the Worker put in the page for this address.
const serverText = typeof document === 'undefined' ? null : (document.querySelector('.ssr-fallback')?.outerHTML ?? null)
const serverPath = typeof window === 'undefined' ? '' : window.location.pathname

/**
 * While the first page loads, keep showing the server's text instead of a spinner, so visitors on slow
 * connections and search engines always see a heading and content. The HTML comes from this site's own
 * Worker, which escapes every value. Later page changes in the app show an ordinary spinner.
 */
export function PageLoading() {
  const { pathname } = useLocation()
  if (serverText && pathname === serverPath) return <div dangerouslySetInnerHTML={{ __html: serverText }} />
  return <Spinner />
}
