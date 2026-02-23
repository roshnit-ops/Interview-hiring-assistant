import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
          <h1 style={{ color: '#f85149' }}>Something went wrong</h1>
          <pre style={{ background: '#1a2332', padding: '1rem', borderRadius: '8px', overflow: 'auto', fontSize: '0.85rem' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <p style={{ color: '#8b9cb3', marginTop: '1rem' }}>Check the browser console for details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif;">Root element not found.</p>';
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
