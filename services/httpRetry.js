// ─── Global axios hardening: timeouts + transient-failure retry ──────────────
// Centralizes what was previously per-call: every axios request gets a default
// timeout, and idempotent GET requests retry with backoff on timeouts, 429s,
// 5xx responses, and Torn's rate-limit error (code 5). Non-GET requests are
// never retried automatically (they can be non-idempotent).
//
// Importing this module patches the axios instance; no call sites change.
// Per-call explicit timeout values still take precedence.

const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 500;
const MAX_RETRY_DELAY_MS = 4000;

// Torn embeds errors in the HTTP 200 body as { error: { code, error } };
// code 5 is the documented per-key rate limit.
function extractTornErrorCode(data) {
  if (data && typeof data === 'object' && data.error && typeof data.error === 'object') {
    return Number(data.error.code);
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryGet(err) {
  // Timeout / connection errors
  if (
    err.code === 'ECONNABORTED' ||          // axios timeout
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNRESET' ||
    err.code === 'EAI_AGAIN' ||
    err.code === 'ENOTFOUND'
  ) return true;

  // HTTP status based
  const status = err.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;

  // Torn rate-limit signalled inside the body
  if (extractTornErrorCode(err.response?.data) === 5) return true;

  return false;
}

// Install once (idempotent if the module is somehow imported twice)
if (!axios.defaults.__ssgRetryInstalled) {
  axios.defaults.__ssgRetryInstalled = true;
  axios.defaults.timeout = axios.defaults.timeout || DEFAULT_TIMEOUT_MS;

  axios.interceptors.response.use(
    response => response,
    async err => {
      const config = err.config || {};
      if (!config || config.method !== 'get') return Promise.reject(err);

      config.__retryCount = config.__retryCount || 0;
      if (config.__retryCount >= MAX_RETRIES) return Promise.reject(err);
      if (!shouldRetryGet(err)) return Promise.reject(err);

      config.__retryCount += 1;
      const delay = Math.min(
        RETRY_DELAY_BASE_MS * Math.pow(2, config.__retryCount - 1),
        MAX_RETRY_DELAY_MS
      );
      await sleep(delay);
      return axios.request(config);
    }
  );
}

module.exports = { DEFAULT_TIMEOUT_MS, MAX_RETRIES, shouldRetryGet, extractTornErrorCode };