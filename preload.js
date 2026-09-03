/* 预加载：向渲染进程暴露安全的 IPC 接口 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GlassBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  moveWindowBy: (dx, dy) => ipcRenderer.invoke('win:moveBy', dx, dy),
  resizeWindowTo: (w, h) => ipcRenderer.invoke('win:resizeTo', w, h),
  hideWindow: () => ipcRenderer.invoke('win:hide'),
  llmChat: (payload) => ipcRenderer.invoke('llm:chat', payload),
  listModels: (payload) => ipcRenderer.invoke('llm:listModels', payload),
});
