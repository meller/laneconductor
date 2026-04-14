import { readJiraConfig } from '../conductor/jira-collector.mjs';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('.laneconductor.json', 'utf8'));
const jiraCfg = readJiraConfig(config.collectors);

if (jiraCfg && jiraCfg.token) {
    console.log('✅ Jira config resolved successfully');
    console.log('Domain:', jiraCfg.domain);
    console.log('Email:', jiraCfg.email);
    console.log('Token (first 10 chars):', jiraCfg.token.substring(0, 10) + '...');
} else {
    console.error('❌ Failed to resolve Jira config');
    process.exit(1);
}
