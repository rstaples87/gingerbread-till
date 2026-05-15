import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import DebugDiagnostic from './pages/DebugDiagnostic.jsx'
import './index.css'

function isDebugRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return path === '/debug'
}

function Root() {
  if (isDebugRoute()) {
    return <DebugDiagnostic />
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
