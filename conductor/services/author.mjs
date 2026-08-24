import { spawnSync } from 'child_process';

export function deriveInitials(name) {
    if (!name || !name.trim()) return 'XX';
    const initials = name.trim()
        .split(/\s+/)
        .map(w => w[0].toUpperCase())
        .join('')
        .slice(0, 3);
    return initials || 'XX';
}

export function getAuthorInfo() {
    const nameResult = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
    const emailResult = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' });
    const name = nameResult.stdout?.trim() || '';
    const email = emailResult.stdout?.trim() || '';
    return { name, email, initials: deriveInitials(name) };
}
