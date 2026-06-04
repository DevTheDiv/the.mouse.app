'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings:     ()       => ipcRenderer.invoke('get-settings'),
  saveSettings:    (s)      => ipcRenderer.invoke('save-settings', s),
  getStatus:       ()       => ipcRenderer.invoke('get-status'),
  startApp:        ()       => ipcRenderer.invoke('start-app'),
  stopApp:         ()       => ipcRenderer.invoke('stop-app'),
  restartAppIfRunning: ()    => ipcRenderer.invoke('restart-app-if-running'),
  installDriver:   ()       => ipcRenderer.invoke('install-driver'),
  uninstallDriver: ()       => ipcRenderer.invoke('uninstall-driver'),
  getDriverStatus: ()       => ipcRenderer.invoke('get-driver-status'),
  getAccelCurve:   ()       => ipcRenderer.invoke('get-accel-curve'),
  saveAccelCurve:  (curve)  => ipcRenderer.invoke('save-accel-curve', curve),
  getProfiles:     ()       => ipcRenderer.invoke('get-profiles'),
  createProfile:   (payload)=> ipcRenderer.invoke('create-profile', payload),
  setActiveProfile:(id)     => ipcRenderer.invoke('set-active-profile', id),
  deleteProfile:   (id)     => ipcRenderer.invoke('delete-profile', id),
  getModulePresets:(module) => ipcRenderer.invoke('get-module-presets', module),
  saveModulePreset:(payload)=> ipcRenderer.invoke('save-module-preset', payload),
  deleteModulePreset:(payload)=> ipcRenderer.invoke('delete-module-preset', payload),
  setAutostart:    (enable) => ipcRenderer.invoke('set-autostart', enable),

  getWindowsAccel: ()       => ipcRenderer.invoke('get-windows-accel'),
  setWindowsAccel: (enable) => ipcRenderer.invoke('set-windows-accel', enable),

  getWindowsMouseSpeed: ()    => ipcRenderer.invoke('get-windows-mouse-speed'),
  setWindowsMouseSpeed: (val) => ipcRenderer.invoke('set-windows-mouse-speed', val),
  getUpdateInfo:      ()       => ipcRenderer.invoke('get-update-info'),
  openExternalUrl:    (url)    => ipcRenderer.invoke('open-external-url', url),

  onProcessStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('process-status', handler);
    return () => ipcRenderer.removeListener('process-status', handler);
  },
  onAppError: (cb) => {
    const handler = (_, msg) => cb(msg);
    ipcRenderer.on('app-error', handler);
    return () => ipcRenderer.removeListener('app-error', handler);
  },

  onLiveSens: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('live-sens', handler);
    return () => ipcRenderer.removeListener('live-sens', handler);
  },

  onProfileChanged: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('profile-changed', handler);
    return () => ipcRenderer.removeListener('profile-changed', handler);
  },

  togglePause: () => ipcRenderer.invoke('toggle-pause'),

  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
});
