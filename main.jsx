import React from 'react';
import { createRoot } from 'react-dom/client';
import PulseDeck from './App.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PulseDeck />
  </React.StrictMode>,
);
