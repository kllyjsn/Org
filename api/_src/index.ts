import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isExtensionOrigin } from './extension-tokens.js';
import { allowedWebOrigin, type App, type Vars } from './http.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerResearchRoutes } from './routes/research.js';
import { registerExportRoutes } from './routes/export.js';
import { registerMapRoutes } from './routes/maps.js';
import { registerRosterRoutes } from './routes/roster.js';
import { registerExtensionRoutes } from './routes/extension.js';
import { registerShareRoutes } from './routes/share.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerPeopleRoutes } from './routes/people.js';

const app: App = new Hono<{ Variables: Vars }>();

// Extension routes additionally accept chrome-extension:// origins (bearer
// auth, no cookies). Registered first so it owns the preflight response.
app.use(
  '/api/extension/*',
  cors({
    origin: (o) => (isExtensionOrigin(o) ? o : allowedWebOrigin(o)),
    allowHeaders: ['authorization', 'content-type'],
    credentials: true,
  })
);
app.use(
  '/api/*',
  cors({
    origin: (o, c) =>
      allowedWebOrigin(o) ??
      (c.req.path.startsWith('/api/extension/') && isExtensionOrigin(o) ? o : null),
    credentials: true,
  })
);

registerSystemRoutes(app);
registerBillingRoutes(app);
registerAuthRoutes(app);
registerWorkspaceRoutes(app);
registerResearchRoutes(app);
registerExportRoutes(app);
registerMapRoutes(app);
registerRosterRoutes(app);
registerExtensionRoutes(app);
registerShareRoutes(app);
registerAnalyticsRoutes(app);
registerFeedbackRoutes(app);
registerPeopleRoutes(app);

export default app;
