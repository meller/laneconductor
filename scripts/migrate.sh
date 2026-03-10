#!/bin/bash
set -e

# Load .env if exists and DATABASE_URL not already set (for local testing)
if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_URL=${DATABASE_URL}

if [ -z "$DB_URL" ]; then
  echo "Error: DATABASE_URL not set."
  exit 1
fi

DB_DISPLAY=$(echo "$DB_URL" | sed 's/:[^@]*@/:****@/')
echo "Migrating database: $DB_DISPLAY"

# Run migrations using Atlas
echo "Running migrations with Atlas..."
# Ensure Prisma SQL is generated
node scripts/atlas-prisma.mjs

# Atlas requires migrations/ directory to be present
if [ ! -d "migrations" ]; then
    echo "Error: migrations directory not found. Please run 'make db-diff' or 'winmake db-diff' locally first."
    exit 1
fi

atlas migrate apply --url "$DB_URL"

echo "Migrations complete!"
