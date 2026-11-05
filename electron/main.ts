import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
// Desktop test builds load the live deployment (same backend and API routes as the web app).
const APP_URL = process.env['ZAYLO_URL'] || process.env['FINANCE_VA_URL'] || 'https://zaylo.cc';

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC as string, 'favicon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
        width: 1280,
        height: 840,
        minWidth: 380,
        backgroundColor: '#EEF1EC',
        title: 'Zaylo',
    });

    // Links that leave the app open in the system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });


    win.setMenuBarVisibility(false); // Hide standard menu

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        win.loadURL(APP_URL).catch(() => win?.loadFile(path.join(process.env.DIST as string, 'index.html')));
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
        win = null;
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.whenReady().then(createWindow);
