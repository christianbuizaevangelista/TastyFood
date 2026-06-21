import { createApp } from './app';
import { env } from './lib/env';

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🍽️  Tasty Food API listening on http://localhost:${env.port}`);
});
