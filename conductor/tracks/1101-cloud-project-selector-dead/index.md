**Lane**: review
**Lane Status**: running
**Progress**: 100%
**Summary**: CloudAppInner passes `onSelect` to ProjectSelector, which only accepts `onChange` — so in cloud/remote mode changing the project dropdown does nothing at all. Local mode is unaffected.
