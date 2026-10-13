import { createDocument, startStudio, createStudio, DocumentStore, readReference, createChatCompletionProvider, type InteractiveDocument } from 'intelligence-ui/node';
import { renderDocument } from 'intelligence-ui/document';

const doc: InteractiveDocument = createDocument('架构决策', '背景');
doc.decisions = [{ id: 'storage', title: '存储', description: '', options: [
  { id: 'file', label: '文件', description: '' }, { id: 'database', label: '数据库', description: '' }
] }];
renderDocument(doc, true);
const provider = createChatCompletionProvider({ baseURL: 'https://example.invalid/v1', apiKey: 'test', model: 'model' });
const studio = await createStudio({ seedDocument: doc, ai: provider });
studio.server.listen(0, '127.0.0.1');
const running = await startStudio({ port: 0, seedDocument: false, ai: { complete: async messages => messages[0].content } });
await running.close();
const store = new DocumentStore('/tmp/documents');
await store.save(doc, 0, true);
const reference = await readReference('.', 'index.mjs');
reference.content.toUpperCase();
// @ts-expect-error invalid port type
startStudio({ port: '4310' });
// @ts-expect-error providers return text
startStudio({ ai: { complete: async () => 123 } });
