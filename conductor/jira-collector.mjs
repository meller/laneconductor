import { execSync } from 'child_process';
// conductor/jira-collector.mjs
// Jira polling-based collector - syncs Jira issues to/from LaneConductor tracks
// Uses "latest version wins" conflict resolution with timestamp-based change detection

/**
 * Read Jira config from collectors array
 * Resolves token from environment variable, GCP Secret Manager, or plain text
 * @param {Array} collectors - Collectors from .laneconductor.json
 * @returns {Object|null} Jira config with resolved token, or null if not found
 */
export function readJiraConfig(collectors) {
  if (!collectors || !Array.isArray(collectors)) return null;

  const jiraCollector = collectors.find((c) => c.type === 'jira');
  if (!jiraCollector) return null;

  let token = null;

  // Try to resolve token in priority order:
  // 1. Environment variable (if token_env specified)
  // 2. GCP Secret Manager (if token_store_type: 'gcp-secret')
  // 3. Plain text (if token specified)

  if (jiraCollector.token_env && process.env[jiraCollector.token_env]) {
    token = process.env[jiraCollector.token_env];
    console.log(`[jira-collector] Using token from env var: ${jiraCollector.token_env}`);
  } else if (jiraCollector.token_store_type === 'gcp-secret' && jiraCollector.token_secret_name) {
    try {
      // Using imported execSync instead of require

      const cmd = `gcloud secrets versions access latest --secret="${jiraCollector.token_secret_name}"`.trim();
      token = execSync(cmd, { encoding: 'utf8' }).trim();
      console.log(`[jira-collector] Using token from GCP Secret: ${jiraCollector.token_secret_name}`);
    } catch (err) {
      console.error(
        `[jira-collector] Failed to fetch GCP Secret "${jiraCollector.token_secret_name}": ${err.message}`
      );
      return null;
    }
  } else if (jiraCollector.token) {
    token = jiraCollector.token;
    console.log('[jira-collector] Using plain text token (consider using GCP Secret Manager)');
  }

  if (!token) {
    console.warn(
      `[jira-collector] Jira token not found. Configure: token_env, token_store_type, or token`
    );
    return null;
  }

  return {
    ...jiraCollector,
    token, // Resolved token
  };
}

/**
 * Poll Jira for issues updated since last sync
 * Called periodically by the sync worker
 *
 * @param {Object} config - Jira config with domain, email, token, project_key
 * @param {string} since - ISO timestamp to query issues updated since (e.g., "2026-04-10T00:00:00Z")
 * @returns {Promise<Array>} Array of Jira issues
 */
export async function pollJira(config, since) {
  if (!config || !config.domain || !config.email || !config.token || !config.project_key) {
    return [];
  }

  try {
    const jqlDate = formatJqlDate(since);
    const jql = `project = "${config.project_key}" AND updated >= "${jqlDate}"`;
    const url = `https://${config.domain}/rest/api/3/search/jql`;
    const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');

    const body = {
      jql,
      maxResults: 100,
      fields: ['key', 'summary', 'description', 'created', 'updated', 'status'],
    };

    console.log(`[jira-collector] Fetching from new API: ${url} with JQL: ${jql}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      console.error(
        `[jira-collector] Fetch error: ${response.status} ${await response.text()}`
      );
      return [];
    }

    const data = await response.json();
    return data.issues || [];
  } catch (err) {
    console.error(`[jira-collector] Poll error: ${err.message}`);
    return [];
  }
}

/**
 * Convert Jira issue to LaneConductor track update format
 * Used both for creating new tracks and updating existing ones
 *
 * @param {Object} issue - Jira issue object
 * @param {Object} config - Jira config with optional target_mapping
 * @returns {Object} Track data {track_number, title, lane, content, jira_key, jira_status, updated}
 */
export function jiraIssueToTrackUpdate(issue, config) {
  const lane = mapJiraStatusToLane(issue.fields.status?.name, config);
  const description = issue.fields.description;
  const parsedFiles = parseAdfToTrackFiles(description);
  
  // If no sections found, try to parse the whole thing as text for indexContent
  if (!parsedFiles.indexContent && description) {
    const text = parseAdfToText(description);
    parsedFiles.indexContent = text;
    parsedFiles.content = text;
  }

  return {
    track_number: String(issue.key),
    title: String(issue.fields.summary || `Issue ${issue.key}`),
    lane: String(lane),
    content: String(parsedFiles.indexContent || parsedFiles.content || ''),
    indexContent: String(parsedFiles.indexContent || ''),
    planContent: String(parsedFiles.planContent || ''),
    specContent: String(parsedFiles.specContent || ''),
    testContent: String(parsedFiles.testContent || ''),
    logContent: String(parsedFiles.logContent || ''),
    jira_key: String(issue.key),
    jira_status: String(issue.fields.status?.name || ''),
    updated: String(issue.fields.updated || ''),
  };
}

/**
 * Utility to parse Jira ADF back into component markdown files
 * @param {Object|string} descriptionDoc 
 */
export function parseAdfToTrackFiles(descriptionDoc) {
  const files = { indexContent: '', planContent: '', specContent: '', testContent: '', logContent: '', content: '' };
  
  if (!descriptionDoc || !descriptionDoc.content) {
    if (typeof descriptionDoc === 'string') {
       files.content = descriptionDoc;
       files.indexContent = descriptionDoc;
    }
    return files;
  }

  let currentFile = null;
  let fallbackContent = '';

  for (const block of descriptionDoc.content) {
    if (block.type === 'heading') {
      const headingText = getAdfText(block).trim().toLowerCase();
      if (['index', 'plan', 'spec', 'test', 'log'].includes(headingText)) {
        currentFile = headingText + 'Content';
      } else {
        currentFile = null;
      }
    } else if (block.type === 'codeBlock' && currentFile) {
      files[currentFile] = getAdfText(block);
      currentFile = null; // reset
    } else if (block.type === 'paragraph' || block.type === 'codeBlock' || block.type === 'heading') {
      const text = getAdfText(block);
      if (text.trim()) fallbackContent += text + '\n\n';
    }
  }

  if (!files.indexContent && !files.planContent && !files.specContent && !files.testContent && !files.logContent) {
    files.content = fallbackContent.trim();
    files.indexContent = fallbackContent.trim();
  }

  return files;
}

/**
 * Build Jira ADF Description containing all 4 markdown files
 * @param {Object} trackData 
 */
export function buildTrackAdf(trackData) {
  const content = [];

  const addFileSection = (title, fileContent) => {
    if (!fileContent) return;
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: title }]
    });
    content.push({
      type: 'codeBlock',
      attrs: { language: 'markdown' },
      content: [{ type: 'text', text: fileContent }] // Must be non-empty string for ADF codeBlock text
    });
  };

  addFileSection('Index', trackData.indexContent || trackData.content);
  addFileSection('Plan', trackData.planContent);
  addFileSection('Spec', trackData.specContent);
  addFileSection('Test', trackData.testContent);
  addFileSection('Log', trackData.logContent);

  if (content.length === 0) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: ' ' }]
    });
  }

  return {
    version: 1,
    type: 'doc',
    content
  };
}

/**
 * Utility to parse simple Jira ADF back into plain text
 * @param {Object} doc - ADF document
 */
export function parseAdfToText(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  if (!doc.content) return '';
  
  return doc.content.map(block => getAdfText(block)).join('\n').trim();
}

/**
 * Recursively extract text from ADF blocks
 * @param {Object} block 
 * @returns {string}
 */
export function getAdfText(block) {
  if (!block) return '';
  if (typeof block === 'string') return block;
  if (block.text) return String(block.text);
  if (block.content && Array.isArray(block.content)) {
    return block.content.map(c => getAdfText(c)).join('');
  }
  return '';
}

/**
 * Map Jira status to LaneConductor lane
 * Handles common Jira statuses → LC workflow lanes
 *
 * @param {string} jiraStatus - Status from Jira issue
 * @param {Object} config - Jira config with optional target_mapping
 * @returns {string} Lane name
 */
export function mapJiraStatusToLane(jiraStatus, config) {
  if (!jiraStatus) return 'plan';

  if (config?.target_mapping) {
    // Inverse lookup from target_mapping { lane: jiraStatus }
    const entry = Object.entries(config.target_mapping).find(
      ([k, v]) => v.toLowerCase() === jiraStatus.toLowerCase()
    );
    if (entry) return entry[0];
  }

  const statusMap = {
    'Backlog': 'backlog',
    'To Do': 'plan',
    'TODO': 'plan',
    'Selected for Development': 'plan',
    'In Progress': 'implement',
    'In Review': 'review',
    'Review': 'review',
    'Testing': 'quality-gate',
    'QA': 'quality-gate',
    'Done': 'done',
    'Resolved': 'done',
    'Closed': 'done',
  };

  return statusMap[jiraStatus] || 'plan';
}

/**
 * Map LaneConductor lane to Jira status
 * Inverse mapping for pushing track changes to Jira
 *
 * @param {string} lane - LC lane name
 * @param {Object} config - Jira config with optional target_mapping
 * @returns {string} Jira status name
 */
export function mapLaneToJiraStatus(lane, config) {
  if (config?.target_mapping && config.target_mapping[lane]) {
    return config.target_mapping[lane];
  }

  const laneMap = {
    backlog: 'Backlog',      // 1:1 mapping - worker creates if missing
    plan: 'To Do',
    queue: 'To Do',
    implement: 'In Progress',
    running: 'In Progress',
    review: 'In Review',
    'quality-gate': 'Testing', // 1:1 mapping - worker creates if missing
    done: 'Done',
    success: 'Done',
  };

  return laneMap[lane] || 'To Do';
}

export function mapStatusToJiraLabels(lane, status) {
  const labels = [];
  
  // Lane-based status labels
  if (lane) {
    const canonicalLane = lane.toLowerCase().trim();
    labels.push(`lconductor-${canonicalLane}`);
  }

  // Action-based status labels (Running/Queue/Done/Failed)
  if (status === 'queue') labels.push('lconductor-queue');
  if (status === 'running') labels.push('lconductor-running');
  if (status === 'success') labels.push('lconductor-success');
  if (status === 'failure' || status === 'error') labels.push('lconductor-failed');

  // Safety check for Done
  if (lane === 'done' && !labels.includes('lconductor-success')) {
    labels.push('lconductor-success');
  }

  return labels;
}

/**
 * Create a new Jira issue from a local track
 * Called when an FS track has no jira_key yet (FS→Jira creation)
 *
 * @param {Object} config - Jira config with domain, email, token, project_key
 * @param {Object} trackData - Track data with title, lane, content
 * @returns {Promise<string|null>} Jira issue key (e.g. "KAN-12") or null on failure
 */
export async function createJiraIssue(config, trackData) {
  if (!config || !trackData) return null;

  const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
  const url = `https://${config.domain}/rest/api/3/issue`;

  try {
    const payload = {
      fields: {
        project: { key: config.project_key },
        summary: trackData.title || 'Untitled Track',
        description: buildTrackAdf(trackData),
        issuetype: { name: 'Task' },
        labels: mapStatusToJiraLabels(trackData.lane, trackData.status),
      },
    };

    console.log(`[jira-collector] Sending labels for ${trackData.title}: ${JSON.stringify(payload.fields.labels)}`);
    
    // Add a small jitter/delay to avoid overwhelming Jira API during mass sync
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[jira-collector] Create issue error: ${response.status} ${await response.text()}`);
      return null;
    }

    const data = await response.json();
    const issueKey = data.key;
    console.log(`[jira-collector] Created Jira issue ${issueKey} for track "${trackData.title}"`);

    // Transition to the correct status if not "To Do"
    if (trackData.lane) {
      const targetStatus = mapLaneToJiraStatus(trackData.lane, config);
      if (targetStatus && targetStatus.toLowerCase() !== 'to do') {
        await transitionJiraStatus(config, issueKey, targetStatus, auth);
      }
    }

    return issueKey;
  } catch (err) {
    console.error(`[jira-collector] Create issue error: ${err.message}`);
    return null;
  }
}

/**
 * Push track update to Jira
 * Updates issue description and transitions status if lane changed
 *
 * @param {Object} config - Jira config
 * @param {string} issueKey - Jira issue key (e.g., "KAN-123")
 * @param {Object} trackData - Track data with title, lane, content
 * @returns {Promise<boolean>} True if successful
 */
export async function pushTrackToJira(config, issueKey, trackData) {
  if (!config || !issueKey || !trackData) return false;

  const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
  const baseUrl = `https://${config.domain}/rest/api/3/issue/${issueKey}`;

  try {
    // Update description and labels
    const updatePayload = {
      fields: {
        description: buildTrackAdf(trackData),
        labels: mapStatusToJiraLabels(trackData.lane, trackData.status),
      },
    };

    // Add a small jitter/delay
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

    const updateResponse = await fetch(`${baseUrl}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
      signal: AbortSignal.timeout(30000),
    });

    if (!updateResponse.ok) {
      console.error(
        `[jira-collector] Update description error: ${updateResponse.status}`
      );
      return false;
    }

    // Transition status if lane changed
    if (trackData.lane) {
      const targetStatus = mapLaneToJiraStatus(trackData.lane, config);
      await transitionJiraStatus(config, issueKey, targetStatus, auth);
    }

    return true;
  } catch (err) {
    console.error(`[jira-collector] Push to Jira error: ${err.message}`);
    return false;
  }
}

/**
 * Transition Jira issue status
 * Gets available transitions and finds the target one
 *
 * @param {Object} config - Jira config
 * @param {string} issueKey - Jira issue key
 * @param {string} targetStatus - Target status name (e.g., "Done")
 * @param {string} auth - Base64 auth header
 * @returns {Promise<boolean>} True if successful
 */
async function transitionJiraStatus(config, issueKey, targetStatus, auth) {
  try {
    // Get available transitions
    const transUrl = `https://${config.domain}/rest/api/3/issue/${issueKey}/transitions`;
    // Add a small jitter/delay
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    const transResponse = await fetch(transUrl, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30000),
    });

    if (!transResponse.ok) {
      console.warn(`[jira-collector] Get transitions error: ${transResponse.status}`);
      return false;
    }

    const transData = await transResponse.json();
    const targetTrans = transData.transitions?.find(
      (t) => t.to.name === targetStatus
    );

    if (!targetTrans) {
      console.log(
        `[jira-collector] No transition available to "${targetStatus}", skipping`
      );
      return false;
    }

    // POST transition
    // Add a small jitter/delay
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    const doTransResponse = await fetch(transUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: targetTrans.id } }),
      signal: AbortSignal.timeout(30000),
    });

    if (!doTransResponse.ok) {
      console.error(
        `[jira-collector] Transition error: ${doTransResponse.status}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[jira-collector] Transition error: ${err.message}`);
    return false;
  }
}

/**
 * Push comment to Jira issue
 *
 * @param {Object} config - Jira config
 * @param {string} issueKey - Jira issue key
 * @param {string} text - Comment text
 * @returns {Promise<boolean>} True if successful
 */
export async function pushCommentToJira(config, issueKey, text) {
  if (!config || !issueKey || !text) return false;

  try {
    const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
    const url = `https://${config.domain}/rest/api/3/issue/${issueKey}/comments`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          version: 0,
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text }],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      console.error(`[jira-collector] Post comment error: ${response.status}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[jira-collector] Post comment error: ${err.message}`);
    return false;
  }
}

/**
 * Get comments from Jira issue updated since timestamp
 *
 * @param {Object} config - Jira config
 * @param {string} issueKey - Jira issue key
 * @param {string} since - ISO timestamp to get comments since
 * @returns {Promise<Array>} Array of comment objects
 */
export async function getJiraComments(config, issueKey, since) {
  if (!config || !issueKey) return [];

  try {
    const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
    const url = `https://${config.domain}/rest/api/3/issue/${issueKey}/comment`;

    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      console.error(`[jira-collector] Get comments error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const sinceDate = new Date(since);

    // Filter to only comments updated since timestamp
    return (data.comments || []).filter((h) => {
      const changeDate = new Date(h.updated || h.created);
      return changeDate > sinceDate;
    });
  } catch (err) {
    console.error(`[jira-collector] Get comments error: ${err.message}`);
    return [];
  }
}

/**
 * Format date for Jira JQL (YYYY-MM-DD)
 *
 * @param {string} isoString - ISO timestamp
 * @returns {string} Formatted date for JQL
 */
export function formatJqlDate(isoString) {
  const date = new Date(isoString);
  return date.toISOString().split('T')[0];
}
