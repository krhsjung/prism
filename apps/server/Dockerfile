# syntax=docker/dockerfile:1
# NestJS monorepo image. Pick the app with --build-arg APP=api|auth|socket.
ARG APP=api

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY services ./services
COPY libs ./libs
ARG APP
RUN pnpm exec nest build "${APP}"
# 런타임 이미지 축소: dev 의존성 제거 (prod deps만 남김)
RUN pnpm prune --prod --ignore-scripts

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG APP
# webpack 번들(main.js)은 node_modules를 런타임에 require하므로 빌드 산출물과 함께 복사.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build "/app/dist/services/${APP}/main.js" ./main.js
# 컨테이너 내부 listen 포트는 k8s가 env(PORT/AUTH_PORT)로 지정한다.
EXPOSE 3000
CMD ["node", "main.js"]
