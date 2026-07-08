
import { buildTrackAdf } from '../conductor/jira-collector.mjs';

const testData = {
  indexContent: '# My Index\nSome content here',
  planContent: '## Plan\nDo things',
  specContent: '## Spec\nDetails',
  testContent: '## Test\nCheck things',
  logContent: '## Log\nDone things'
};

const adf = buildTrackAdf(testData);
console.log(JSON.stringify(adf, null, 2));
