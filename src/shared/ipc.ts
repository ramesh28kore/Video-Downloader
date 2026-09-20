// IPC channel names shared between main, preload and renderer.
export const IPC = {
  // downloads
  AddDownload: 'download:add',
  ProbeUrl: 'download:probe',
  List: 'download:list',
  Get: 'download:get',
  Start: 'download:start',
  Pause: 'download:pause',
  Resume: 'download:resume',
  Cancel: 'download:cancel',
  Retry: 'download:retry',
  Remove: 'download:remove',
  SetSpeedLimit: 'download:setSpeedLimit',
  OpenFile: 'download:openFile',
  OpenFolder: 'download:openFolder',
  ShowInFolder: 'download:showInFolder',
  DuplicateResolved: 'download:duplicateResolved',
  // queue
  QueueStats: 'queue:stats',
  QueueStartAll: 'queue:startAll',
  QueuePauseAll: 'queue:pauseAll',
  QueueStopAll: 'queue:stopAll',
  QueueReorder: 'queue:reorder',
  // history
  HistoryQuery: 'history:query',
  HistoryClear: 'history:clear',
  // settings
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  PickFolder: 'settings:pickFolder',
  MediaBridgeConfig: 'settings:mediaBridgeConfig',
  // categories
  CategoryList: 'category:list',
  CategoryCreate: 'category:create',
  CategoryUpdate: 'category:update',
  CategoryDelete: 'category:delete',
  // clipboard
  ClipboardIgnore: 'clipboard:ignore',
  // window
  WinMinimize: 'win:minimize',
  WinMaximize: 'win:maximize',
  WinClose: 'win:close',
  // events main -> renderer
  EvCreated: 'download:created',
  EvUpdated: 'download:updated',
  EvProgress: 'download:progress',
  EvCompleted: 'download:completed',
  EvFailed: 'download:failed',
  EvQueue: 'queue:updated',
  EvClipboardUrl: 'clipboard:url',
  EvMediaDetected: 'media:detected',
  EvSettings: 'settings:changed',
  EvHistoryChanged: 'history:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
