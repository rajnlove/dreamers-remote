FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir websockify==0.12.0

RUN git clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/novnc

COPY docker/novnc-entrypoint.sh /opt/novnc-entrypoint.sh
RUN chmod +x /opt/novnc-entrypoint.sh

EXPOSE 6080
ENTRYPOINT ["/opt/novnc-entrypoint.sh"]
