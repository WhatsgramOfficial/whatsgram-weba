const WEBSYNC_KEY = 'tgme_sync';

export const forceWebsync = (_authed?: boolean) => {
  return Promise.resolve();
};

export function stopWebsync() {
  // Websync is disabled for Whatsgram
}

export function startWebsync() {
  // Websync is disabled for Whatsgram
}

export function clearWebsync() {
  localStorage.removeItem(WEBSYNC_KEY);
}
