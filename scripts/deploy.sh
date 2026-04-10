#!/bin/bash
# LaneConductor — Deployment Script
# Usage: bash scripts/deploy.sh [prod|staging] [--no-confirm]
set -e

ENV=${1:-prod}
NO_CONFIRM=${2:-}
GCP_PROJECT="laneconductor-site"
FRONTEND_URL="https://laneconductor-site.web.app"
APP_URL="https://laneconductor-app.web.app"

echo "🏁 Deploying LaneConductor"
echo "   Environment    : $ENV"
echo "   Website URL    : $FRONTEND_URL"
echo "   Dashboard URL  : $APP_URL"
echo ""

# ── Pre-flight checks ──────────────────────────────────────────────────────
echo "✓ Pre-flight checks..."

if [ ! -d "ui" ] || [ ! -d "cloud/functions" ]; then
  echo "❌ Missing ui/ or cloud/functions/ directory"
  exit 1
fi

# ── Bump Version ──────────────────────────────────────────────────────────
echo ""
echo "📦 Bumping version..."
cd ui
CURRENT_VERSION=$(node -p "require('./package.json').version")
npm version patch --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "   Version: $CURRENT_VERSION → $NEW_VERSION"
cd ..

# ── Build Frontend ─────────────────────────────────────────────────────────
echo ""
echo "🏗️  Building Dashboard UI..."
cd ui
npm ci
npm run build
cd ..

if [ ! -d "ui/dist" ]; then
  echo "❌ Frontend build failed - dist/ not found"
  exit 1
fi

echo "✅ UI built (v$NEW_VERSION)"

# ── Deployment confirmation ───────────────────────────────────────────────
if [ -z "$NO_CONFIRM" ]; then
  echo ""
  echo "⚠️  Ready to deploy to $ENV"
  echo "   Version: $NEW_VERSION"
  echo "   UI dist size: $(du -sh ui/dist | cut -f1)"
  echo ""
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
  fi
fi

# ── Deployment Logic ───────────────────────────────────────────────────────
echo ""
echo "🚀 Deploying to $ENV..."

# Deployment options based on environment
if [ "$ENV" = "prod" ]; then
  echo "   [1/4] Applying Database Migrations (Atlas)..."
  if command -v atlas &> /dev/null; then
    # Fetch the secret DATABASE_URL from Secret Manager
    export DATABASE_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL" --project="$GCP_PROJECT")
    
    if [ -z "$DATABASE_URL" ]; then
      echo "      ❌ Could not retrieve DATABASE_URL from Secret Manager. Skipping migrations."
    else
      # Run atlas migrate apply
      # Workaround for Neon/PgBouncer: use direct connection for migrations (removes -pooler)
      # and disable prepared statements if the driver supports it via query param.
      DIRECT_URL=$(echo "$DATABASE_URL" | sed 's/-pooler//')
      
      echo "      🔄 Using direct connection for migrations to avoid pooler issues..."
      atlas migrate apply --env remote --url "$DIRECT_URL" --allow-dirty
    fi
  else
    echo "      ⚠️  'atlas' CLI not found. Skipping migrations. Please ensure Atlas is installed for automated schema updates."
  fi

  echo "   [2/4] Deploying Cloud Functions (API)..."
  firebase deploy --project "$GCP_PROJECT" --only functions --non-interactive
  
  echo "   [3/4] Deploying Dashboard App..."
  firebase deploy --project "$GCP_PROJECT" --only hosting:app --non-interactive

  echo "   [4/4] Deploying Public Website..."
  firebase deploy --project "$GCP_PROJECT" --only hosting:landing --non-interactive

  echo ""
  echo "✅ Deployment complete!"
  echo "   Website: $FRONTEND_URL"
  echo "   App:     $APP_URL"

elif [ "$ENV" = "staging" ]; then
  echo "❌ Staging environment not yet configured for LaneConductor"
  exit 1
fi

echo ""
echo "📋 Post-Deployment Checklist:"
echo "   [ ] Website loads at $FRONTEND_URL"
echo "   [ ] Dashboard loads at $APP_URL"
echo "   [ ] API health: curl $FRONTEND_URL/health"
echo ""
