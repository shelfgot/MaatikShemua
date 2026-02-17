FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for pyvips, kraken, and image processing
RUN apt-get update && apt-get install -y \
    libvips-dev \
    libffi-dev \
    libxml2-dev \
    libxslt1-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY requirements-kraken.txt .
RUN pip install --no-cache-dir -r requirements-kraken.txt \
    && python -c "import kraken; print('kraken:', getattr(kraken, '__version__', 'ok'))"

# Copy application code
COPY . .

# Create data directories
RUN mkdir -p /app/data/pages /app/data/models /app/logs

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
