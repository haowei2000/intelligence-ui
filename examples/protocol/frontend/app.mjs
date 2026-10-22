// A frontend hosted separately from the service. It only knows the service URL and its own
// user session; it never sees model credentials or the Agent.
import { connectSurface } from '/assets/runtime.mjs';

const config = await (await fetch('/config.json')).json();
const status = document.querySelector('#connection');
connectSurface({
  baseUrl: `${config.service}/ui`,
  surfaceId: config.surface,
  container: document.querySelector('#surface'),
  // Real hosts send their own session credentials; the demo uses a static user token.
  headers: { Authorization: `Bearer ${config.userToken}` },
  mountOptions: { styleNonce: document.querySelector('meta[name=style-nonce]')?.content },
  onConnection: state => { status.textContent = { open: 'Connected. Waiting for the Agent…', retrying: 'Reconnecting…', closed: 'Disconnected' }[state]; },
  onDelivery: () => { status.textContent = 'Connected'; },
  onError: error => { status.textContent = `Connection problem: ${error.message}`; }
});
