'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyDashDesktop', {
  setCaption: (color, symbolColor) => ipcRenderer.send('studydash:caption', color, symbolColor),
  setAppIcon: value => ipcRenderer.send('studydash:icon', value),
});
