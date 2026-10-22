const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

function originAllowed(url, origins) {
  return origins.some(entry => {
    if (entry === '*') return true;
    const wildcard = /^(https?):\/\/\*\.(.+)$/.exec(entry);
    if (wildcard) return url.protocol === `${wildcard[1]}:` && url.hostname.endsWith(`.${wildcard[2].replace(/:\d+$/, '')}`) && (!/:\d+$/.test(wildcard[2]) || url.port === wildcard[2].split(':').pop());
    return url.origin === entry;
  });
}

/**
 * Checks a URL against a contract policy for one resource type (image, link, webPreview).
 * Returns null when allowed, or { code, message, expected }.
 */
export function checkUrl(value, resource, policy) {
  const rule = policy.urls[resource];
  let url;
  try { url = new URL(value); } catch { return { code: 'POLICY_URL_INVALID', message: 'The URL must be absolute and well formed.', expected: { schemes: rule.schemes } }; }
  const scheme = url.protocol.slice(0, -1);
  if (!rule.schemes.includes(scheme)) return { code: 'POLICY_URL_SCHEME', message: `The ${scheme}: scheme is not allowed for ${resource}.`, expected: { schemes: rule.schemes } };
  if (scheme === 'data') return resource === 'image' && DATA_IMAGE.test(value) ? null : { code: 'POLICY_URL_SCHEME', message: 'Only base64 PNG, JPEG, GIF, WebP or AVIF data URLs are allowed for images.', expected: { schemes: rule.schemes } };
  if (scheme === 'mailto') return null;
  if (url.username || url.password) return { code: 'POLICY_URL_CREDENTIALS', message: 'URLs must not contain credentials.' };
  if (!originAllowed(url, rule.origins)) return { code: 'POLICY_URL_ORIGIN', message: `The origin ${url.origin} is not allowed for ${resource}.`, expected: { origins: rule.origins } };
  if (resource === 'webPreview') {
    const sandbox = policy.webPreview.sandbox;
    if (sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin') && originAllowed(url, policy.webPreview.hostOrigins.filter(origin => origin !== '*'))) {
      return { code: 'POLICY_SANDBOX_SAME_ORIGIN', message: 'This origin is served by the host page; a scripted same-origin frame could remove its own sandbox.', expected: { notOrigins: policy.webPreview.hostOrigins } };
    }
  }
  return null;
}

/** Sandbox tokens for a preview frame on a given page; never grants allow-same-origin for the page's own origin. */
export function sandboxFor(url, policy, pageOrigin) {
  let tokens = [...policy.webPreview.sandbox];
  try { if (pageOrigin && new URL(url).origin === pageOrigin) tokens = tokens.filter(token => token !== 'allow-same-origin'); } catch { /* invalid URLs are rejected before rendering */ }
  return tokens.join(' ');
}
