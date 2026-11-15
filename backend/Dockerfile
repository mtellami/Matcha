FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY . .
CMD ["sh", "-c", "python manage.py migrate && gunicorn --bind 0.0.0.0:5000 --workers 1 --threads 50 app:app"]
