#!/usr/bin/env bash
set -e

echo "⏳ Waiting for database & syncing schema..."
# Retry prisma db push until the database is reachable.
until npx prisma db push --skip-generate --accept-data-loss; do
  echo "   database not ready yet, retrying in 3s..."
  sleep 3
done

# Seed only when the database is empty so restarts don't wipe data.
USER_COUNT=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(c=>{console.log(c);return p.\$disconnect()}).catch(()=>{console.log(0)})")
if [ "$USER_COUNT" = "0" ]; then
  echo "🌱 Seeding database..."
  npx ts-node prisma/seed.ts
else
  echo "✔ Database already seeded ($USER_COUNT users). Skipping seed."
fi

echo "🚀 Starting API..."
node dist/server.js
