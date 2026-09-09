FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.14-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
ENV TANKAPP_DATA_DIR=/data TANKAPP_ARCHIVE_DIR=/archive TANKAPP_POLLING_FILE=/config/polling.json \
    TANKAPP_INFLUX_ENV=/config/influx.env TANKAPP_NETRC=/config/netrc
COPY engine/requirements.txt /app/engine/requirements.txt
COPY app/requirements.txt /app/app/requirements.txt
RUN pip install --no-cache-dir -r /app/app/requirements.txt
COPY app/ /app/app/
COPY engine/ /app/engine/
COPY data-tools/ /app/data-tools/
COPY tankapp.py /app/tankapp.py
COPY --from=web /web/dist /app/web/dist
RUN mkdir -p /data/runtime /archive /config && chown -R 1000:1000 /data /archive
USER 1000:1000
EXPOSE 1355
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:1355/api/v1/health', timeout=3).read()"
CMD ["python", "-m", "app", "--host", "0.0.0.0", "--port", "1355", "--jobs"]
