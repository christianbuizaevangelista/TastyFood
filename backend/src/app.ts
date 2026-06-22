import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './lib/env';
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

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  // Larger limit to allow base64 file uploads (e.g. proof of payment).
  app.use(express.json({ limit: '6mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'tasty-food-api' }));

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

  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
