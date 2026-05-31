FROM python:3.11-slim
WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the backend source as an importable `backend` package. This keeps the
# nested `backend.telegram` module from shadowing the python-telegram-bot
# library and lets relative imports resolve correctly.
COPY . ./backend/

RUN mkdir -p /app/data

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
