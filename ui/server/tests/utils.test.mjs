import { describe, it, expect } from 'vitest';
import { slugify, trackTemplates } from '../utils.mjs';

describe('utils: slugify', () => {
    it('converts to lowercase', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });

    it('replaces spaces and special chars with -', () => {
        expect(slugify('My Project! @2026')).toBe('my-project-2026');
    });

    it('trims leading/trailing hyphens', () => {
        expect(slugify('---hello---')).toBe('hello');
    });

    it('handles empty string', () => {
        expect(slugify('')).toBe('');
    });
});

describe('utils: trackTemplates', () => {
    it('generates feature templates by default', () => {
        const t = trackTemplates('001', 'My Feature', 'Desc');
        expect(t.index).toContain('# Track 001: My Feature');
        expect(t.index).toContain('Desc');
        expect(t.plan).toContain('## Phase 1: Implementation');
        expect(t.spec).toContain('## Requirements');
    });

    it('generates bug templates', () => {
        const t = trackTemplates('002', 'My Bug', 'Repro steps', 'bug');
        expect(t.index).toContain('# Track 002: My Bug');
        expect(t.plan).toContain('## Phase 1: Investigate and Fix');
        expect(t.plan).toContain('regression test');
        expect(t.spec).toContain('## Steps to Reproduce');
    });

    it('injects description into all three templates', () => {
        const desc = 'This is a test description';
        const t = trackTemplates('003', 'Test', desc);
        expect(t.index).toContain(desc);
        expect(t.plan).toContain(desc);
        expect(t.spec).toContain(desc);
    });
});
