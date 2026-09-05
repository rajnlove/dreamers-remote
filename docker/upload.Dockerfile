FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build:upload

FROM node:20-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=192
RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && apk del .build-deps
COPY --from=server-build /app/dist ./dist
COPY --from=web-build /web/dist-upload ./public
RUN mkdir -p /data && chown 3001:3001 /data && chmod 700 /data
# No media tooling, docker socket or remote desktop backend in this process.
USER 3001:3001
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8090/upload/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/upload/main.js"]
