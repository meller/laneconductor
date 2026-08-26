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

export function getAuthorInfo(cwd) {
    const opts = { encoding: 'utf8', ...(cwd ? { cwd } : {}) };
    const nameResult = spawnSync('git', ['config', 'user.name'], opts);
    const emailResult = spawnSync('git', ['config', 'user.email'], opts);
    const name = nameResult.stdout?.trim() || '';
    const email = emailResult.stdout?.trim() || '';
    return { name, email, initials: deriveInitials(name) };
}
