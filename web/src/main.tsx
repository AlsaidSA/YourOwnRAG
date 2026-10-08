/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/app';
import '@/styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
