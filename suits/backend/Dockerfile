# Suits AI backend — production image for Render / any Docker host.
#
# System dep: tesseract is needed by pytesseract for the OCR fallback path
# in the ingestor (image uploads, scanned PDFs). PyMuPDF ships pure-binary
# wheels so no extra system libs are required for native PDF parsing.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT at runtime. --proxy-headers + --forwarded-allow-ips
# make uvicorn trust the Render edge proxy so request.url.scheme is https
# and client IPs aren't logged as the proxy.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
