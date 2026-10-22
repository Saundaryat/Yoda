# Build the API and web app with plain Node, then run them on top of the official Hermes image
# so Hermes, its Python runtime and its dependencies come from Nous Research, pinned by digest.
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build && pnpm --filter @evals/api deploy --prod --legacy /out/api

FROM nousresearch/hermes-agent:v0.22.4@sha256:7a69201726bc64db2072a1371557137c23312d29705cda2b8ea2a0214a50a4cf
COPY --from=build /out/api /app/api
COPY --from=build /src/apps/web/dist /app/web
# Hermes refuses run homes it doesn't own, so the app runs as the image's hermes user (uid 10000).
RUN mkdir -p /data/runs && chown -R 10000:10000 /data
USER 10000
WORKDIR /app/api
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
