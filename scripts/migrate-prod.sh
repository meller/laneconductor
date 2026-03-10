#!/bin/bash
set -e

# Configuration — set GCP_PROJECT_ID in your environment or .env
PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
DB_PORT="${DB_PORT:-6543}"
DB_NAME="${DB_NAME:-postgres}"

echo "Fetching DB credentials from Secret Manager..."
DB_HOST=$(gcloud secrets versions access latest --secret="CLOUD_DB_HOST" --project="$PROJECT_ID")
DB_USER=$(gcloud secrets versions access latest --secret="CLOUD_DB_USER" --project="$PROJECT_ID")
DB_PASSWORD=$(gcloud secrets versions access latest --secret="CLOUD_DB_PASSWORD" --project="$PROJECT_ID")

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "ERROR: Failed to retrieve one or more secrets from Secret Manager."
    exit 1
fi

echo "Constructing DATABASE_URL..."
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# Run migrations
echo "Running migrations against production database..."
./scripts/migrate.sh

echo "Production migrations complete!"
