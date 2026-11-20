FROM node:22-alpine AS frontend
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
ARG VITE_MAPBOX_ACCESS_TOKEN
ENV VITE_MAPBOX_ACCESS_TOKEN=$VITE_MAPBOX_ACCESS_TOKEN
RUN pnpm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=10000
RUN apt-get update && apt-get install -y --no-install-recommends nginx gettext-base ca-certificates \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
WORKDIR /app
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY backend/ ./
COPY --from=frontend /web/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/matcha.conf.template
COPY deploy/start.sh /app/start.sh
EXPOSE 10000
CMD ["bash", "/app/start.sh"]
