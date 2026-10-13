import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

try {
  const response = await fetch('/api/page');
  if (!response.ok) throw new Error(`加载失败：${response.status}`);
  const initialDocument = await response.json();
  createRoot(document.getElementById('root')).render(<StrictMode><App initialDocument={initialDocument} /></StrictMode>);
} catch (error) { document.getElementById('root').textContent = error.message; }
