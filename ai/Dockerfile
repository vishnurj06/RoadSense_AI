FROM python:3.11-slim

WORKDIR /app

# OpenCV needs these at runtime; the slim image doesn't ship them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Weights are gitignored, so they are mounted in rather than baked:
#   docker run -v ./weights:/app/weights -p 8001:8001 roadsense-ai
ENV MODEL_PATH=/app/weights/best.pt

EXPOSE 8001
CMD ["uvicorn", "infer_service:app", "--host", "0.0.0.0", "--port", "8001"]
