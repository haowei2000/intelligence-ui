import { mountUI } from './mount.mjs';

/** Parses a text/event-stream body into { event, data } messages. */
export async function* readEventStream(body, signal) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  // Some fetch implementations only notice an abort on the next chunk; cancel the read directly.
  const cancel = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let index;
      while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
        let event = 'message', data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(':')) continue;
          const [field, ...rest] = line.split(':');
          const content = rest.join(':').replace(/^ /, '');
          if (field === 'event') event = content;
          if (field === 'data') data.push(content);
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/**
 * Connects a container to a surface on an Intelligence UI service. Each committed document is
 * rendered as one card in arrival order; updates are applied in place with state preservation.
 * Uses fetch streaming instead of EventSource so authentication headers stay out of URLs.
 */
export function connectSurface({ baseUrl, surfaceId, container, headers = {}, fetch: fetchImpl = globalThis.fetch, mountOptions = {}, onDelivery, onConnection, onError, retryMs = 2000 }) {
  if (!baseUrl || !surfaceId || !container) throw new TypeError('connectSurface needs baseUrl, surfaceId and container');
  const base = `${baseUrl.replace(/\/$/, '')}/surfaces/${encodeURIComponent(surfaceId)}`;
  const controllers = new Map(), abort = new AbortController();
  const resolveHeaders = async () => ({ ...(typeof headers === 'function' ? await headers() : headers) });
  const report = error => { try { onError?.(error); } catch { /* ignore */ } };
  const connection = status => { try { onConnection?.(status); } catch (error) { report(error); } };
  async function request(path, init) {
    const response = await fetchImpl(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(await resolveHeaders()), ...init.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || `Request failed with ${response.status}`), { status: response.status, body });
    return body;
  }
  function deliver(message) {
    onDelivery?.(message);
    if (message.type === 'document.committed') {
      const committed = message.committed, existing = controllers.get(committed.id);
      if (existing) {
        const result = existing.apply(committed);
        if (result.outcome !== 'applied' && result.outcome !== 'unchanged' && result.outcome !== 'stale') report(Object.assign(new Error(`Delivery ${result.outcome}`), result));
        return;
      }
      const slot = container.ownerDocument.createElement('div');
      slot.dataset.document = committed.id;
      container.append(slot);
      controllers.set(committed.id, mountUI(slot, {
        ...mountOptions, document: committed,
        onAction: (event, { signal }) => request('/events', { method: 'POST', body: JSON.stringify(event), signal }),
        onSave: (state, { signal, documentId, revision }) => request(`/documents/${encodeURIComponent(documentId)}/state`, { method: 'PUT', body: JSON.stringify({ state, baseRevision: revision }), signal }),
        onError: error => { report(error); mountOptions.onError?.(error); }
      }));
    }
    if (message.type === 'action.status') controllers.get(message.documentId)?.setActionStatus(message.eventId, message.status, message.message);
  }
  (async () => {
    while (!abort.signal.aborted) {
      try {
        const response = await fetchImpl(`${base}/stream`, { headers: { Accept: 'text/event-stream', ...(await resolveHeaders()) }, signal: abort.signal });
        if (!response.ok || !response.body) throw new Error(`Stream failed with ${response.status}`);
        connection('open');
        for await (const { data } of readEventStream(response.body, abort.signal)) {
          try { deliver(JSON.parse(data)); } catch (error) { report(error); }
        }
      } catch (error) { if (!abort.signal.aborted) report(error); }
      if (!abort.signal.aborted) { connection('retrying'); await new Promise(resolve => setTimeout(resolve, retryMs)); }
    }
  })();
  return {
    controllers,
    async close() {
      abort.abort();
      connection('closed');
      await Promise.allSettled([...controllers.values()].map(controller => controller.flush()));
      for (const controller of controllers.values()) controller.destroy();
      controllers.clear();
    }
  };
}
