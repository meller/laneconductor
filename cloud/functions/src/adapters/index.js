/**
 * Inbound Adapter Registry
 * Maps external provider payloads (Jira, GitHub, etc.) to LaneConductor commands.
 */

const adapters = {
  jira: require('./jira'),
};

/**
 * Resolve provider adapter and process payload
 * @param {string} provider - e.g., 'jira'
 * @param {object} payload - The raw webhook body
 * @returns {object} Standardized LaneConductor action command
 */
function translate(provider, payload) {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  return adapter.mapPayload(payload);
}

module.exports = {
  translate,
  adapters: Object.keys(adapters)
};
