FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Bake the API URL into the build (browser talks to the backend directly).
ARG VITE_API_URL=http://localhost:4000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

EXPOSE 5173
# Serve the production build.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
