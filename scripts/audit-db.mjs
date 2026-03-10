import pg from 'pg';
import fs from 'fs';

const pool = new pg.Pool({
    database: 'laneconductor',
    user: 'postgres',
    password: 'postgres',
    host: 'localhost',
    port: 5432
});

async function audit() {
    try {
        let doc = "# Database Schema Audit\n\nGenerated on: " + new Date().toISOString() + "\n\n";

        // 1. Tables and Columns
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");

        for (const table of tables.rows) {
            const tableName = table.table_name;
            doc += `## Table: ${tableName}\n\n`;

            const columns = await pool.query(`
                SELECT column_name, data_type, is_nullable, column_default 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [tableName]);

            doc += "| Column | Type | Nullable | Default |\n|---|---|---|---|\n";
            for (const col of columns.rows) {
                doc += `| ${col.column_name} | ${col.data_type} | ${col.is_nullable} | ${col.column_default || ''} |\n`;
            }
            doc += "\n";
        }

        // 2. Foreign Keys
        doc += "## Foreign Keys\n\n";
        const fks = await pool.query(`
            SELECT
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
        `);

        doc += "| Table | Column | References | Foreign Column |\n|---|---|---|---|\n";
        for (const fk of fks.rows) {
            doc += "| " + fk.table_name + " | " + fk.column_name + " | " + fk.foreign_table_name + " | " + fk.foreign_column_name + " |\n";
        }
        doc += "\n";

        fs.writeFileSync('conductor/tracks/1009-schema-and-db-migration-management/audit_results.md', doc);
        console.log("Audit complete. Results saved to audit_results.md");

    } catch (err) {
        console.error("Audit failed:", err);
    } finally {
        await pool.end();
    }
}

audit();
