const { contextBridge, ipcRenderer } = require('electron');

const runtimeConfig = ipcRenderer.sendSync('desktop:get-runtime-config-sync');

contextBridge.exposeInMainWorld('__CODEBURG_CONFIG__', runtimeConfig);
contextBridge.exposeInMainWorld('__CODEBURG_TOKEN_STORAGE__', {
  getToken: () => ipcRenderer.sendSync('desktop:auth-token-get-sync'),
  setToken: (token) => ipcRenderer.sendSync('desktop:auth-token-set-sync', token),
  clearToken: () => ipcRenderer.sendSync('desktop:auth-token-clear-sync'),
});

contextBridge.exposeInMainWorld('codeburgDesktop', {
  isDesktop: true,
  getRuntimeConfig: () => ipcRenderer.invoke('desktop:get-runtime-config'),
  getConnectionConfig: () => ipcRenderer.invoke('desktop:get-connection-config'),
  saveConnectionConfig: (serverOrigin) => ipcRenderer.invoke('desktop:set-server-origin', serverOrigin),
  launchApp: () => ipcRenderer.invoke('desktop:launch-app'),
});
