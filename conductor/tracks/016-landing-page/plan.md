# Track 016: Landing Page

## Phase 1: Build the Landing Page ✅ COMPLETE

**Problem**: No public web presence for LaneConductor.
**Solution**: Create a polished single-file HTML landing page that matches the product's dark aesthetic.

- [x] Task 1: Create `landing/index.html` — full landing page
    - [x] Hero section: headline, sub, copyable install command, GitHub CTA
    - [x] "Why LaneConductor" section: Sovereign / Real-time / Multi-project pillars
    - [x] "How it works" section: 3-step flow diagram
    - [x] Features grid: Heartbeat worker, Kanban dashboard, Claude skill, Makefile targets
    - [x] Footer: GitHub link, tagline
- [x] Task 2: Inline all CSS (dark theme, responsive, animations)
- [x] Task 3: Inline minimal JS (copy-to-clipboard for install command)

## Phase 2: Firebase Hosting Deploy ✅ COMPLETE

**Problem**: Need HTTPS + custom domain without infra overhead.
**Solution**: Firebase Hosting — free SSL, automatic cert, works with Route 53 A records.

- [x] Task 1: `landing/firebase.json` and `.firebaserc` created
- [x] Task 2: `firebase login` → authenticate as xxx@gmail.com
- [x] Task 3: Create/select Firebase project (console.firebase.google.com)
- [x] Task 4: Update `.firebaserc` with actual project ID (laneconductor-site)
- [x] Task 5: `cd landing && firebase deploy --only hosting` — deployed successfully
- [x] Task 6: Verify live on `.web.app` URL — https://laneconductor-site.web.app ✅

## Phase 3: Custom Domain via Route 53 ✅ COMPLETE

**Problem**: `laneconductor.com` DNS is in Route 53 — need to point it at Firebase.
**Solution**: Firebase generates A records + TXT verification; add them in Route 53.

- [x] Task 1: In Firebase Console → Hosting → Add custom domain → `laneconductor.com`
- [x] Task 2: Firebase provides TXT record for ownership verification → add in Route 53
- [x] Task 3: Firebase provides A records (two IPs) → add as A record set in Route 53 for `laneconductor.com`
- [x] Task 4: Also add `www.laneconductor.com` if desired (same A records)
- [x] Task 5: Wait for SSL cert provisioning (~5–30 min)
- [x] Task 6: Verify `https://laneconductor.com` loads correctly

**Instructions for Phase 3:**
1. Go to [Firebase Console](https://console.firebase.google.com) → Select laneconductor-site project
2. Navigate to Hosting → "Connect Domain"
3. Enter `laneconductor.com` → Firebase will provide TXT + A records
4. Go to [AWS Route 53](https://console.aws.amazon.com/route53) → Select laneconductor.com zone
5. Add the TXT record for verification (Firebase provides the exact value)
6. Add the 2 A records that Firebase provides (each will have a specific IP)
7. Optionally add same A records for `www.laneconductor.com` subdomain
8. Wait for DNS propagation + SSL cert (5-30 minutes)
9. Once SSL is ready, verify at https://laneconductor.com

## Open Items (from Review)
- **GitHub hero CTA** — added "⭐ Star on GitHub" button in hero + GitHub link in footer ✅ FIXED
- **spec.md updated** — stale GCS acceptance criteria replaced with Firebase approach ✅ FIXED
- **Google Fonts CDN** — removed external CDN dependency; now uses system fonts (Inter → system-ui stack, JetBrains Mono → Menlo/Monaco) ✅ FIXED
- **Waitlist form** — `submitWaitlist()` saves to localStorage only; add Formspree or similar if real signups are needed (optional enhancement)

## ✅ REVIEWED
\n## ✅ REVIEWED

## ✅ REVIEWED
