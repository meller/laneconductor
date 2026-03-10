# Spec: Landing Page

## Problem Statement
LaneConductor needs a public-facing landing page so developers can discover, understand, and get started with the tool. Currently there is zero web presence.

## Requirements
- REQ-1: Single-page marketing site — hero, features, how it works, CTA
- REQ-2: Dark theme matching the product aesthetic (gray-950 bg, status colors)
- REQ-3: Hosted on **Firebase Hosting** (free HTTPS/SSL, custom domain support)
- REQ-4: Custom domain `laneconductor.com` via Route 53 A records + TXT verification
- REQ-5: Mobile-responsive layout
- REQ-6: No JS frameworks — vanilla HTML/CSS/JS only (keep it lightweight)
- REQ-7: Fast load — no external JS bundles, self-contained

## Acceptance Criteria
- [x] Landing page renders correctly in Chrome on desktop and mobile
- [x] Firebase Hosting project created and `firebase deploy` succeeds
- [x] Page is live on `.web.app` URL before custom domain is applied — https://laneconductor-site.web.app ✅
- [x] Page clearly communicates: what it is, who it's for, how to install
- [x] Visual design matches LaneConductor dark aesthetic
- [x] All links/CTAs work (including GitHub link as a real `<a href>` — added to hero + footer)
- [x] Custom domain DNS — Route 53 A records + TXT ownership verification added (Phase 3)
- [x] `https://laneconductor.com` loads with valid SSL cert (Phase 3)

## Content Sections
1. **Hero** — headline + sub-headline + install command (copyable) + GitHub CTA (linked)
2. **What it is** — 3 key properties: Sovereign / Real-time / Multi-project
3. **How it works** — short diagram / steps
4. **Features** — Heartbeat worker, Kanban dashboard, Claude skill, Makefile targets
5. **Footer** — GitHub link, tagline

## Notes
- Firebase Hosting chosen over GCS for free SSL, CDN, and custom domain support — no manual gsutil/GCS setup needed
- Google Fonts CDN currently used for Inter + JetBrains Mono — consider self-hosting if offline reliability is required
- Waitlist form currently saves to localStorage only — backend integration (Formspree or similar) needed if real signups matter
