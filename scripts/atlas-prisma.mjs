import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

let out;
try {
    const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/laneconductor?sslmode=disable";
    out = execSync('npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: dbUrl }
    });
} catch (err) {
    // Prisma returns exit code 2 if there's a diff. That's what we want.
    if (err.status === 2) {
        out = err.stdout.toString();
    } else {
        console.error('Failed to generate prisma SQL:', err.message);
        if (err.stderr) console.error('Stderr:', err.stderr.toString());
        process.exit(1);
    }
}

if (out) {
    try {
        // Ensure the directory exists
        const dir = 'prisma';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);

        fs.writeFileSync(path.join(dir, 'schema.sql'), out);
        console.log('SQL schema generated at prisma/schema.sql');
    } catch (err) {
        console.error('Failed to write prisma SQL to file:', err.message);
        process.exit(1);
    }
}
