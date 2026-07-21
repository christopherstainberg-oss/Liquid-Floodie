# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY scripts ./scripts
COPY src ./src
COPY index.html styles.css app.js sw.js manifest.webmanifest ./
COPY public ./public
RUN mkdir -p data icons && npm run build

FROM nginx:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/christopherstainberg-oss/Liquid-Floodie"
LABEL org.opencontainers.image.description="LiquidFloodie — whole-food liquid meals while maintaining dietary restrictions"
LABEL org.opencontainers.image.licenses="MIT"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
