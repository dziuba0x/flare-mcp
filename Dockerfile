# flare-mcp hub — hostable MCP + x402 REST service for Flare Network.
#   docker build -t flare-mcp-hub .
#   docker run -p 8402:8402 -e X402_ENABLED=true -e X402_PAY_TO=0x... \
#     -e FLARE_PRIVATE_KEY=0x... flare-mcp-hub
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist

# Bind on all interfaces inside the container; publish the port you like.
ENV FLARE_MCP_HTTP_HOST=0.0.0.0
ENV FLARE_MCP_HTTP_PORT=8402
EXPOSE 8402
USER node
CMD ["node", "dist/index.js"]
