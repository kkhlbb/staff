FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && test -s node_modules/replicad-opencascadejs/dist/replicad_single.wasm

FROM dependencies AS web
COPY cloud/deploy/web/ /web/

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 CUNLIAN_DATA=/data CUNLIAN_WEB=/web
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY desktop/main/ ./desktop/main/
COPY desktop/shared/ ./desktop/shared/
COPY mcp/ ./mcp/
COPY cloud/contracts/ ./cloud/contracts/
COPY cloud/server/ ./cloud/server/
COPY --from=web /web/ /web/
RUN install -d -o node -g node -m 0700 /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=4s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "cloud/server/index.mjs"]
