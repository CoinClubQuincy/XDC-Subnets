
// Sanity log to confirm UMD globals are present (runs on load since app.js is loaded after the SDK script)
(function(){
  const ns = window.Web3Auth || window.web3auth || window.Web3AuthModal || window.web3authModal || null;
  const hasCtor = !!(ns && typeof ns.Web3Auth === 'function');
  console.log('Web3Auth UMD present?', !!ns, 'Constructor present?', hasCtor);
})();

// Optional: background fetch of external config for inspection/debug (does not mutate inline CONFIG)
async function loadExternalConfig() {
  // Try siftr-config.json first (our exported file), then config.json as a fallback.
  const candidates = ['config.json'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        window.JSON_CONFIG = json; // read-only reference for debugging/inspection
        console.log('[config] Loaded external config from', url);
        return json;
      }
    } catch (_) { /* ignore and try next */ }
  }
  console.warn('[config] No external config found (siftr-config.json or config.json). Using inline CONFIG from index.html.');
  return null;
}

// Kick off a background fetch without touching the inline CONFIG in index.html
loadExternalConfig();
