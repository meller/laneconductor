# Track 1042: lc start in sync mode only

**Lane**: done
**Lane Status**: success
**Progress**: 97%
**Phase**: New
**Summary**: lets have two options for the worker to run inwhen its in api (local/remote) mode, one is like today its syncs and also takes things from the queue - the other is sync only meaning user will trigger the /conductor plan imlement review and so on and the worker only syncs the fs and api side, we need to support it in both lc start - default sync and polling, but also lc start sync_only. we will have this also visuablized in our ui in worker mode - we will see if worker is in sync mode and syncing and polling mode
