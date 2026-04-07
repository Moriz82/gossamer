FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY gossamer ./gossamer

RUN pip install --no-cache-dir .

ENV GOSSAMER_DATABASE_PATH=/data/graph.sqlite \
    GOSSAMER_UPLOADS_DIR=/data/uploads \
    GOSSAMER_EXPORTS_DIR=/data/exports

RUN mkdir -p /data/uploads /data/exports

EXPOSE 8000
CMD ["uvicorn", "gossamer.app:app", "--host", "0.0.0.0", "--port", "8000"]
