import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import './styles/globals.css';
import { Toaster } from "./components/ui/sonner"

ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
        <App />
        <Toaster position="bottom-right" richColors />
    </React.StrictMode>
); 