import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';

const tracksDir = 'conductor/tracks';
const tracks = [];

if (existsSync(tracksDir)) {
    const dirs = readdirSync(tracksDir);
    for (const dir of dirs) {
        const indexPath = join(tracksDir, dir, 'index.md');
        if (existsSync(indexPath)) {
            const content = readFileSync(indexPath, 'utf8');
            const lines = content.split('\n');
            const title = lines[0].replace(/# Track [0-9]*: /, '').trim();
            const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/i) || content.match(/\*\*Status:\s*([^\n]+)/i);
            const progressMatch = content.match(/\*\*Progress\*\*:\s*([^\n]+)/i) || content.match(/\*\*Progress:\s*([^\n]+)/i);

            const trackNumber = dir.match(/^(\d+)/)?.[1] || dir;
            tracks.push({
                id: trackNumber === 'tracks' ? '---' : trackNumber,
                title,
                status: statusMatch ? statusMatch[1].replace(/\*/g, '').trim() : 'unknown',
                progress: progressMatch ? progressMatch[1].replace(/\*/g, '').trim() : '0%'
            });
        }
    }
}

tracks.sort((a, b) => {
    if (a.id === '---') return 1;
    if (b.id === '---') return -1;
    return parseInt(a.id) - parseInt(b.id);
});

let markdown = '# Tracks\n\n| # | Title | Status | Progress |\n|---|-------|--------|----------|\n';
for (const t of tracks) {
    let statusIcon = '⬜';
    if (t.status === 'done') statusIcon = '✅';
    else if (t.status === 'in-progress') statusIcon = '⏳';
    else if (t.status === 'review') statusIcon = '🔍';
    else if (t.status === 'quality-gate') statusIcon = '🛡️';
    markdown += `| ${t.id} | ${t.title} | ${statusIcon} ${t.status} | ${t.progress} |\n`;
}

writeFileSync('conductor/tracks.md', markdown);
console.log('✅ conductor/tracks.md updated');
