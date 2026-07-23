import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { env } from './lib/env';
import { appOrigin } from './lib/email';
import { errorHandler } from './middleware/error';

import { authRouter } from './modules/auth/auth.routes';
import { productsRouter } from './modules/products/products.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { poRouter } from './modules/purchaseOrders/po.routes';
import { posRouter } from './modules/pos/pos.routes';
import { salesRouter } from './modules/sales/sales.routes';
import { kpiRouter } from './modules/kpi/kpi.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { orgsRouter } from './modules/crm/orgs.routes';
import { approvalsRouter } from './modules/crm/approvals.routes';
import { territoriesRouter } from './modules/territories/territories.routes';
import { locationsRouter } from './modules/locations/locations.routes';
import { manaRouter } from './modules/mana/mana.routes';
import { usersRouter } from './modules/users/users.routes';
import { materialsRouter } from './modules/materials/materials.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { referralsRouter } from './modules/referrals/referrals.routes';
import { accountingRouter } from './modules/accounting/accounting.routes';
import { marketingRouter } from './modules/marketing/marketing.routes';
import { hrRouter } from './modules/hr/hr.routes';
import { publicRouter } from './modules/public/public.routes';
import { supportRouter } from './modules/support/support.routes';
import { cronRouter } from './modules/cron/cron.routes';
import { applyRouter } from './modules/public/apply.routes';
import { applicationsRouter } from './modules/marketing/applications.routes';
import { adsRouter } from './modules/marketing/ads.routes';
import { shopRouter } from './modules/public/shop.routes';
import { shopOrdersRouter } from './modules/marketing/shopOrders.routes';

export function createApp() {
  const app = express();

  // Security headers. The app is a self-contained SPA (no external CDNs/fonts),
  // so a strict CSP is safe: scripts only from our origin (blocks injected inline
  // scripts), no framing (clickjacking), and no external connect targets (an
  // injected script can't exfiltrate a stolen token to another host). Individual
  // file-download endpoints override CSP with an even stricter sandbox policy.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    })
  );

  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  // Larger limit to allow base64 file uploads (e.g. proof of payment).
  app.use(express.json({ limit: '6mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  // `origin` is the host every link in every outgoing email is built from. It
  // once pointed at a hostname that was not an alias of the project, so buttons
  // in real people's inboxes led to a 404 while every other check here passed.
  // Nothing else in the app can reveal a wrong value, so it is reported here
  // where a release check can see it. The origin is a public URL, not a secret.
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'tasty-food-api', origin: appOrigin() })
  );

  // Unauthenticated — backs the public recruitment landing page at /join.
  app.use('/api/public', publicRouter);
  // The online distributorship application, also unauthenticated.
  app.use('/api/public/apply', applyRouter);
  // The public JuanPalaman shop, also unauthenticated.
  app.use('/api/public/shop', shopRouter);
  // Scheduler-invoked jobs; gated on CRON_SECRET, not on a user session.
  app.use('/api/cron', cronRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/purchase-orders', poRouter);
  app.use('/api/pos', posRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/kpi', kpiRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/orgs', orgsRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/territories', territoriesRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/mana', manaRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/referrals', referralsRouter);
  app.use('/api/accounting', accountingRouter);
  // Mounted before the general marketing router so it matches first rather
  // than falling through that router's middleware.
  app.use('/api/marketing/applications', applicationsRouter);
  app.use('/api/marketing/ads', adsRouter);
  app.use('/api/marketing/shop-orders', shopOrdersRouter);
  app.use('/api/marketing', marketingRouter);
  app.use('/api/hr', hrRouter);
  app.use('/api/support', supportRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
