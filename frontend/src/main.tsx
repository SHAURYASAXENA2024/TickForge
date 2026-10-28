import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import HowzThatPage from './HowzThatPage'
import { isResearchPath, legacyHashTarget, usePathname } from './router'
import './index.css'

// Old research links (#/howzthat/...) now live at /howz-that/...
const legacy = legacyHashTarget(window.location.hash)
if (legacy) window.history.replaceState(null, '', legacy)

// Two pages: the dashboard (default) and the standalone "how'z that!" research page.
function Root() {
  const path = usePathname()
  // A new page starts at the top, unless the address points at a section (#id): the page scrolls there itself.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path])
  return isResearchPath(path) ? <HowzThatPage path={path} /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
