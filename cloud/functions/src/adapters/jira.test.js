const jiraAdapter = require('./jira');

describe('JiraAdapter', () => {
  describe('mapPayload', () => {
    test('should map a valid AI task (label: ai-task)', () => {
      const payload = {
        issue: {
          id: '101',
          key: 'PROJ-1',
          fields: {
            summary: 'Test summary',
            description: 'Test description',
            labels: ['ai-task'],
            status: { name: 'To Do' },
            updated: '2026-04-10T11:00:00Z'
          }
        }
      };

      const result = jiraAdapter.mapPayload(payload);
      
      expect(result).not.toBeNull();
      expect(result.type).toBe('UPSERT_TRACK');
      expect(result.track_number).toBe('PROJ-1');
      expect(result.title).toBe('Test summary');
      expect(result.summary).toBe('Test description');
      expect(result.metadata.jira.key).toBe('PROJ-1');
    });

    test('should map a task in "To Do" status even without labels', () => {
      const payload = {
        issue: {
          id: '102',
          key: 'PROJ-2',
          fields: {
            summary: 'Another test',
            labels: [],
            status: { name: 'To Do' }
          }
        }
      };

      const result = jiraAdapter.mapPayload(payload);
      expect(result).not.toBeNull();
      expect(result.track_number).toBe('PROJ-2');
    });

    test('should ignore tasks that are not AI-task and not in To Do', () => {
      const payload = {
        issue: {
          id: '103',
          key: 'PROJ-3',
          fields: {
            summary: 'Ignore me',
            labels: ['other'],
            status: { name: 'In Progress' }
          }
        }
      };

      const result = jiraAdapter.mapPayload(payload);
      expect(result).toBeNull();
    });

    test('should return null if no issue is present', () => {
      const result = jiraAdapter.mapPayload({});
      expect(result).toBeNull();
    });
  });
});
