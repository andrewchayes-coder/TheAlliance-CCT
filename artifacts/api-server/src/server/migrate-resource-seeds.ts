import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, pool, resourcesTable } from '@workspace/db';
import { uploadResourceFile } from './resource-files';
try {
  const rows = await db.select().from(resourcesTable);
  let count = 0;
  for (const row of rows) {
    if (!/^seed-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(row.fileKey ?? '')) continue;
    const name = row.fileKey!.split('/').pop()!;
    const file = await uploadResourceFile(name, await readFile(resolve(process.cwd(), 'seed-resources', name)));
    await db.update(resourcesTable).set(file).where(eq(resourcesTable.id, row.id));
    count++;
  }
  console.log(`Moved ${count} seed documents into private Object Storage; resource IDs are unchanged.`);
} finally { await pool.end(); }
