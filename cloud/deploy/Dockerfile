FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/occt-unified ./vendor/occt-unified
RUN npm ci --omit=dev --ignore-scripts \
    && test -s vendor/occt-unified/cunlian_occt.wasm

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src/ ./src/
COPY desktop/main/ ./desktop/main/
COPY desktop/shared/ ./desktop/shared/
COPY cloud/web/ ./cloud/web/
RUN npx vite build --config cloud/web/vite.config.ts \
    && test -s cloud/web/dist/index.html

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 CUNLIAN_DATA=/data CUNLIAN_WEB=/web
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY vendor/occt-unified ./vendor/occt-unified
COPY src/ ./src/
COPY desktop/main/ ./desktop/main/
COPY desktop/shared/ ./desktop/shared/
COPY mcp/ ./mcp/
COPY cloud/contracts/ ./cloud/contracts/
COPY cloud/server/ ./cloud/server/
COPY --from=web /app/cloud/web/dist/ /web/
RUN install -d -o node -g node -m 0700 /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=4s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "cloud/server/index.mjs"]
