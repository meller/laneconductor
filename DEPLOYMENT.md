# Deployment Documentation: LaneConductor Ecosystem

LaneConductor consists of three primary components that must be built and deployed for production use.

## 1. Cloud API (Firebase Functions)
The backend collector and integration proxy.

> [!WARNING]
> **Cloud Cost Notice:**
> If you are operating LaneConductor in **Local-only mode** (`local-api` or `local-fs` using a local database), the cloud-hosted Functions API is **not required**.
> Deploying the functions creates a public HTTP endpoint on Google Cloud that will attract bot scanners, triggering cold starts and generating GCP compute charges.
> To prevent this, the cloud API has been decommissioned. You should skip functions deployment and only deploy the hosting targets.

- **Source**: `cloud/functions`
- **Deployment**: (Skip if in local-only mode)
  ```bash
  firebase deploy --only functions
  ```
- **Secrets**: Managed via GCP Secret Manager. Ensure `gcloud auth application-default login` has been run and secrets are accessible.

## 2. Database Migrations (Atlas)
LaneConductor uses **Atlas** for declarative schema management and sequential migrations.

- **Prerequisites**: [Install Atlas CLI](https://atlasgo.io/getting-started/#installation).
- **Process**: Migrations are stored in the `migrations/` directory.
- **Automated**: The deployment script runs `atlas migrate apply` automatically if the Atlas CLI is present.
- **Manual Migration**:
  ```bash
  export DATABASE_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL" --project="laneconductor-site")
  atlas migrate apply --env remote --url "$DATABASE_URL"
  ```

## 3. Dashboard App (Vite)
The Kanban UI for project tracking.

- **Source**: `ui`
- **Build**:
  ```bash
  cd ui && npm install && npm run build
  ```
- **Deployment**:
  ```bash
  firebase deploy --only hosting:app
  ```

## 3. Public Website (Static)
Landing pages and Knowledge Base.

- **Source**: `landing`
- **Deployment**:
  ```bash
  firebase deploy --only hosting:landing
  ```

---

## Automated Deployment
The recommended way to deploy LaneConductor is via the centralized deployment script. This script handles version patching, building the dashboard, and deploying all Firebase targets.

```bash
./scripts/deploy.sh prod
```

This script will:
1. Patch the version in `ui/package.json`.
2. Build the Dashboard UI.
3. Deploy Functions, the App, and the Website to Firebase.
4. Provide a post-deployment checklist.
