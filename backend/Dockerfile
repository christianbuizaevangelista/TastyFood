FROM node:20-bookworm-slim

# Prisma needs openssl at runtime.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 4000
CMD ["bash", "./docker-entrypoint.sh"]
