import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '../src/index.css';
import './admin.css';
import AdminApp from './AdminApp';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AdminApp />
    </StrictMode>,
);
