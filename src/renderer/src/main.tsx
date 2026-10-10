import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { useStore } from './store'
import { paintTheme } from './lib/theme'

;(window as unknown as { __tutti: typeof useStore }).__tutti = useStore      // para el modo captura y la depuración

paintTheme(useStore.getState().themeMode)       // el tema antes del primer pintado: sin parpadeo

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
