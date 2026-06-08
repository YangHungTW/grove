import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { store } from './store'

// No StrictMode: it double-invokes effects in dev, which would create/dispose
// each xterm twice. Terminal lifecycle is keyed by session id instead.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)

void store.init()
