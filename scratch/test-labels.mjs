
import { mapStatusToJiraLabels } from '../conductor/jira-collector.mjs';
console.log('plan, queue:', mapStatusToJiraLabels('plan', 'queue'));
console.log('review, running:', mapStatusToJiraLabels('review', 'running'));
console.log('done, success:', mapStatusToJiraLabels('done', 'success'));
