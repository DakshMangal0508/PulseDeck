import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import PulseDeck from './App.jsx';
import './style.css';

class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', padding: '48px 24px', background: '#15011d', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
          <section style={{ maxWidth: 680, margin: '8vh auto', padding: 28, borderRadius: 16, background: '#090909', border: '1px solid #51477c' }}>
            <h1 style={{ margin: '0 0 12px', fontSize: 22 }}>PulseDeck couldn’t render</h1>
            <p style={{ color: '#c4bddb' }}>A browser error stopped the dashboard from loading. This message can help identify the cause:</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#ff9d78' }}>{this.state.error.message || String(this.state.error)}</pre>
            <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: 0, background: '#ff4d0a', color: '#fff', cursor: 'pointer' }}>Reload PulseDeck</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <PulseDeck />
    </AppErrorBoundary>
  </React.StrictMode>,
);
