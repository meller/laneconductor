/**
 * Jira Inbound Adapter
 * Maps Jira Webhook payloads to LaneConductor track commands.
 */

/**
 * Maps incoming Jira event to a standardized LaneConductor action
 * @param {object} payload - Raw Jira webhook body
 * @returns {object|null} - Integration action or null if ignored
 */
function mapPayload(payload) {
  const issue = payload.issue;
  if (!issue) return null;

  // Filter for AI tasks (matches existing logic in index.js)
  const isAiTask = issue.fields.labels?.includes('ai-task') || 
                   issue.fields.status?.name === 'To Do';
  
  if (!isAiTask) {
    console.log(`[jira] Ignoring non-AI task: ${issue.key}`);
    return null;
  }

  return {
    type: 'UPSERT_TRACK',
    track_number: issue.key,
    title: issue.fields.summary,
    summary: issue.fields.description || 'Jira-synced task',
    // Metadata for the tracks.integrations column
    metadata: {
      jira: {
        id: issue.id,
        key: issue.key,
        self: issue.self,
        updated: issue.fields.updated
      }
    }
  };
}

module.exports = {
  mapPayload
};
