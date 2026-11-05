import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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

// ---------- Monthly backups into folders that sync to the cloud (iCloud Drive, OneDrive, Google Drive, Dropbox)
type FolderKey = 'icloud' | 'onedrive' | 'gdrive' | 'dropbox';
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const firstIn = (dir: string, re: RegExp) => { try { return fs.readdirSync(dir).filter(n => re.test(n)).map(n => path.join(dir, n)).find(isDir); } catch { return undefined; } };

function syncFolders(): { key: FolderKey; label: string; path: string }[] {
    const home = os.homedir();
    const cloud = path.join(home, 'Library', 'CloudStorage');
    const found: { key: FolderKey; label: string; path: string }[] = [];
    const add = (key: FolderKey, label: string, p?: string) => { if (p && isDir(p) && !found.some(f => f.key === key)) found.push({ key, label, path: p }); };
    if (process.platform === 'darwin') {
        add('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
        add('onedrive', 'OneDrive', firstIn(cloud, /^OneDrive/));
        const g = firstIn(cloud, /^GoogleDrive/);
        add('gdrive', 'Google Drive', g && (isDir(path.join(g, 'My Drive')) ? path.join(g, 'My Drive') : g));
        add('dropbox', 'Dropbox', firstIn(cloud, /^Dropbox/) || path.join(home, 'Dropbox'));
    } else {
        add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
        add('onedrive', 'OneDrive', process.env.OneDrive || process.env.OneDriveConsumer || path.join(home, 'OneDrive'));
        for (const d of ['G', 'H', 'I']) add('gdrive', 'Google Drive', path.join(`${d}:\\`, 'My Drive'));
        add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
        add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
    }
    return found;
}

ipcMain.handle('zaylo:sync-folders', () => syncFolders());
ipcMain.handle('zaylo:save-files', (_e, arg: { folderKey: FolderKey; files: { name: string; base64: string }[] }) => {
    try {
        const root = syncFolders().find(f => f.key === arg?.folderKey);
        if (!root) return { ok: false, error: 'That folder isn\'t on this computer.' };
        const dir = path.join(root.path, 'Zaylo Backups');
        fs.mkdirSync(dir, { recursive: true });
        for (const f of arg.files || []) {
            const name = path.basename(String(f.name)).replace(/[\\/:*?"<>|]+/g, '-');
            if (!/\.(xlsx|pdf)$/i.test(name)) continue;
            fs.writeFileSync(path.join(dir, name), Buffer.from(String(f.base64), 'base64'));
        }
        return { ok: true, dir };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
});
ipcMain.handle('zaylo:open-path', (_e, p: string) => {
    if (typeof p === 'string' && syncFolders().some(f => p.startsWith(f.path))) return shell.openPath(p);
    return 'not allowed';
});

app.whenReady().then(createWindow);
