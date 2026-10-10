/** Run this command from a Scheduled Deployment; no API server or database connection is started. */
export {};
const rawUrl = process.env.JOBS_RUN_URL;
const secret = process.env.JOBS_SECRET;
if (!rawUrl || !secret || secret.length < 32) {
  console.error('Configure JOBS_RUN_URL and a JOBS_SECRET of at least 32 characters.');
  process.exitCode = 1;
} else {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/jobs/run'))
      throw new Error('Use the HTTPS production /api/jobs/run endpoint without credentials or query parameters.');
    const response = await fetch(url, { method: 'POST', headers: { 'X-Jobs-Secret': secret, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(240_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Reminder trigger returned HTTP ${response.status}.`);
    const result = await response.json() as { skippedRun: boolean; run: { id: string; counts: unknown } | null };
    console.log(JSON.stringify({ skippedRun: result.skippedRun, runId: result.run?.id, counts: result.run?.counts }));
  } catch (err) {
    // Do not echo request headers, environment values or fetch options.
    console.error(err instanceof Error ? err.message : 'The reminder trigger failed.');
    process.exitCode = 1;
  }
}
