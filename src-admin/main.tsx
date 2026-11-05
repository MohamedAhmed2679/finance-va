import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import '../src/index.css';
import './admin.css';
import AdminApp from './AdminApp';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AdminApp />
    </StrictMode>,
);
