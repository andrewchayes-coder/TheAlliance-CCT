import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const schema = process.env.QA_SMOKE_SCHEMA;
if (process.env.NODE_ENV !== 'development' || !schema || !/^qa_smoke_[a-f0-9]{24}$/.test(schema))
  throw new Error('The smoke API must use its isolated development schema.');
const { pool } = await import('@workspace/db');
const result = await pool.query('SELECT current_schema() AS schema');
if (result.rows[0]?.schema !== schema) throw new Error('Smoke isolation failed; refusing to start the API.');
await import(pathToFileURL(resolve('../artifacts/api-server/src/index.ts')).href);
