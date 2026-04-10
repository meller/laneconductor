# Deployment Stack

## Provider
- **Infrastructure**: Google Cloud Platform (GCP)
- **Deployment Platform**: Firebase

## Environments
- **Production**: `laneconductor-site` (Firebase Project ID)
- **Staging**: Not yet configured.

## Services
- **Public Website (`landing`)**: Firebase Hosting at [laneconductor-site.web.app](https://laneconductor-site.web.app)
- **Dashboard App (`app`)**: Firebase Hosting at [laneconductor-app.web.app](https://laneconductor-app.web.app)
- **Cloud API (`functions`)**: Firebase Cloud Functions (v2) at `/v1/*`
- **Database**: Supabase Postgres (Connection managed via Secret Manager)

## Secret Management
- **Infrastructure Secrets**: `CLOUD_DB_HOST`, `CLOUD_DB_USER`, `CLOUD_DB_PASSWORD`. Managed via GCP Secret Manager and injected into Cloud Functions via `onRequest({ secrets: [...] })`.
- **Integration Credentials**: Jira tokens, domains, and webhook secrets are stored in the `projects.integrations` JSONB column. They are retrieved at runtime per project and are **never** stored in environment variables or global secrets.

## Deploy Command
To deploy all production components, run:
```bash
./scripts/deploy.sh prod
```
This script handles versioning, building the UI, and deploying all three Firebase targets.
