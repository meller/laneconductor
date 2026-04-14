
import { parseAdfToTrackFiles, getAdfText } from '../conductor/jira-collector.mjs';

const mockAdf = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello World' }
      ]
    }
  ]
};

const result = parseAdfToTrackFiles(mockAdf);
console.log('Result:', JSON.stringify(result, null, 2));
