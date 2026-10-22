import { useRef, useState } from 'react';
import { DocumentRenderer } from '@haowei2000/intelligence-ui/react';

export default function App({ initialDocument }) {
  const [document, setDocument] = useState(initialDocument);
  const [error, setError] = useState('');
  const renderer = useRef(null);

  async function save(next, { signal, baseRevision }) {
    const response = await fetch(`/api/pages/${next.manifest.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: next, expectedRevision: baseRevision }),
      signal,
    });
    if (!response.ok) throw new Error(`保存失败：${response.status}`);
    setError('');
    return response.json();
  }

  return <>
    <DocumentRenderer
      ref={renderer}
      value={document}
      onChange={setDocument}
      onSave={save}
      onError={error => setError(error.message)}
    />
    {error && <div role="alert">
      {error}
      <button onClick={() => renderer.current.flush().catch(error => setError(error.message))}>重试保存</button>
    </div>}
  </>;
}
