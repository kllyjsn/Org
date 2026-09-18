import { serve } from '@hono/node-server';
import app from './index.js';
import { activeProvider } from './llm.js';
import { startJobLoop } from './research-jobs.js';

const port = Number(process.env.PORT) || 8787;
console.log(`org api listening on :${port} (provider: ${activeProvider()})`);
serve({ fetch: app.fetch, port });
startJobLoop();
