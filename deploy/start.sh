#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-10000}"
# Render supplies its public HTTPS URL. Override APP_ORIGIN for a custom domain.
export APP_ORIGIN="${APP_ORIGIN:-${RENDER_EXTERNAL_URL:-}}"
: "${APP_ORIGIN:?Set APP_ORIGIN or deploy on Render with RENDER_EXTERNAL_URL}"
envsubst '${PORT}' < /etc/nginx/matcha.conf.template > /etc/nginx/nginx.conf
nginx -t
python manage.py migrate
python manage.py storage-init

children=()
shutdown() {
    trap - EXIT TERM INT
    if ((${#children[@]})); then
        kill -TERM "${children[@]}" 2>/dev/null || true
        wait "${children[@]}" 2>/dev/null || true
    fi
}
trap shutdown EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

gunicorn --bind 127.0.0.1:5000 --workers 1 --threads 50 --graceful-timeout 10 --access-logfile - --error-logfile - app:app &
children+=("$!")
nginx -g 'daemon off;' &
children+=("$!")

# A container is unhealthy if either process exits, even with a zero status.
wait -n "${children[@]}"
exit 1
