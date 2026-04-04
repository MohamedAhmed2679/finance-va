import { contextBridge } from 'electron';

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
    on(...args: Parameters<typeof import('electron').ipcRenderer.on>) {
        const [channel, listener] = args;
        return import('electron').then(({ ipcRenderer }) => {
            ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
        });
    },
    off(...args: Parameters<typeof import('electron').ipcRenderer.off>) {
        const [channel, ...omit] = args;
        return import('electron').then(({ ipcRenderer }) => {
            ipcRenderer.off(channel, ...omit);
        });
    },
    send(...args: Parameters<typeof import('electron').ipcRenderer.send>) {
        const [channel, ...omit] = args;
        return import('electron').then(({ ipcRenderer }) => {
            ipcRenderer.send(channel, ...omit);
        });
    },
    invoke(...args: Parameters<typeof import('electron').ipcRenderer.invoke>) {
        const [channel, ...omit] = args;
        return import('electron').then(({ ipcRenderer }) => {
            return ipcRenderer.invoke(channel, ...omit);
        });
    },
});
