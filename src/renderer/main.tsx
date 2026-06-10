import { createRoot } from 'react-dom/client'
// xterm's own stylesheet MUST load: it positions the hidden .xterm-helper-textarea
// at the cursor so the OS IME (Chinese/Japanese/Korean) attaches in the right
// place — without it, composition input is lost or badly delayed. Imported before
// styles.css so Grove's overrides (hidden scrollbar, invisible textarea) still win.
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { store } from './store'

// No StrictMode: it double-invokes effects in dev, which would create/dispose
// each xterm twice. Terminal lifecycle is keyed by session id instead.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)

void store.init()
