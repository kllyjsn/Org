import { handle } from 'hono/vercel';
import app from './_src/index.js';

export default handle(app);
