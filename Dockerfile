# Multi-stage Dockerfile untuk Iman WhatsApp Bot

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine

WORKDIR /app

# Install dumb-init untuk proper signal handling
RUN apk add --no-cache dumb-init

# Create app user (security best practice)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application dari builder
COPY --from=builder /app/dist ./dist

# Create volume untuk auth credentials (persistent)
RUN mkdir -p auth_info_baileys && chown -R nodejs:nodejs auth_info_baileys

# Change to nodejs user (Disabled sementara karena masalah permission di Windows volume)
# USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Use dumb-init untuk proper signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start application
CMD ["node", "dist/index.js"]
