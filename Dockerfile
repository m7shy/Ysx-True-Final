# Stage 1: Build Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build with empty API URL to allow relative paths (same-origin) in production
RUN VITE_API_URL="" npm run build

# Stage 2: Build Backend
FROM node:20-slim AS backend-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ .
RUN npm run build

# Stage 3: Runtime
FROM node:20-slim
WORKDIR /app/server

# Install production dependencies for server
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy backend build
COPY --from=backend-builder /app/server/dist ./dist
# Copy backend data (tokens, etc.)
COPY --from=backend-builder /app/server/data ./data

# Copy frontend build to ../dist (relative to server/dist/index.js)
# server is at /app/server. 
# We want frontend at /app/dist so that path.join(__dirname, '../../dist') works from /app/server/dist/index.js
WORKDIR /app
COPY --from=frontend-builder /app/dist ./dist

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "dist/index.js"]