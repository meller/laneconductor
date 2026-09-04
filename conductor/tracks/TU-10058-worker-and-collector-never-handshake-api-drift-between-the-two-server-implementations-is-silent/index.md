# Track TU-10058: Worker and collector never handshake — API drift between the two server implementations is silent

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: LaneConductor has two independent implementations of one collector API: ui/server/index.mjs (local, port 8091) and cloud/functions/index.js (Firebase). A worker talks to whichever it is pointed at.…
