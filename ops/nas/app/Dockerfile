# O27: Bild und Pipeline bauen gegen dieselben Linien — eine Quelle, zwei
# Konsumenten. Die beiden ARGs vor dem ersten FROM sind die Festlegung; die Pipeline fährt
# dieselben Zahlen (`.github/workflows/tests.yml`: Python-Matrix bzw.
# `setup-node`), und `tests/test_o27_build_parity.py` hält beides zusammen.
# Vorher stand hier python:3.14 / node:26, während die Pipeline gegen Python
# 3.11/3.12 und die Node-Version des CI-Runners prüfte: „grün getestet“ und
# „ausgeliefert“ waren zwei verschiedene Interpreter.
#
# Warum das Bild zurück und nicht die Pipeline hoch: 3.12 und Node 22 sind die
# Linien, gegen die die Suite läuft (Python 3.11 bleibt in der Matrix, weil der
# Pi-Collector darauf steht). Ein Bild auf einer ungetesteten Linie ist der
# Befund — ein Bild auf der getesteten Linie ist die Behebung.
#
# `zoneinfo`/Europa-Berlin: Der tzdata-Datenstand kommt über
# `app/requirements.txt` (`tzdata>=2026.3`) in **beide** Umgebungen, Bild wie
# Pipeline — nicht über das Debian-Paket, das in -slim-Images fehlt.
#
# Beide ARGs stehen **vor dem ersten FROM** — nur dort sind sie global und in
# FROM-Zeilen sichtbar. Ein ARG hinter einem FROM gehört zur Stage; die nächste
# FROM-Zeile sähe ein leeres `${PYTHON_VERSION}` und das Bild hieße
# `python:-slim-bookworm`. Genau so ist der erste Anlauf am 18.09.2026 im
# CI-Job `nas-image` gestorben (`docker build`, exit 1 nach wenigen Sekunden);
# `tests/test_o27_build_parity.py` hält die Regel, weil hier kein Builder läuft.
ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12

FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:${PYTHON_VERSION}-slim-bookworm
# Stage-ARG (bewusst hinter dem FROM): wird nur im ENV dieser Stage benutzt.
ARG TANKAPP_BUILD_COMMIT=""
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
ENV TANKAPP_DATA_DIR=/data TANKAPP_ARCHIVE_DIR=/archive TANKAPP_POLLING_FILE=/config/polling.json \
    TANKAPP_INFLUX_ENV=/config/influx.env TANKAPP_NETRC=/config/netrc \
    TANKAPP_BUILD_COMMIT=${TANKAPP_BUILD_COMMIT}
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
