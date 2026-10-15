import { Router } from 'express';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';
import { developmentClock } from '../server/development-clock';
import { hourEntriesCsv, hoursByVolunteerCsv, ReportError, reportIncludeTest } from '../server/hoursReport';
import { readHoursReport } from '../server/hoursReportRepository';
import { logger } from '../lib/logger';

const router = Router();
for (const kind of ['hours', 'hours.csv', 'hour-entries.csv'] as const) {
  router.get(`/admin/reports/${kind}`, async (req, res) => {
    try {
      const now = developmentClock(req.query.at);
      const result = await readHoursReport(now, req.query.month, reportIncludeTest(req.query.includeTest));
      res.set('Cache-Control', 'no-store');
      if (kind === 'hours') { res.json(GetAdminHoursReportResponse.parse(result.report)); return; }
      const filename = kind === 'hours.csv' ? 'hours-by-volunteer' : 'hour-entries';
      res.set({ 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="alliance-${filename}-${result.report.month}.csv"` });
      res.send(kind === 'hours.csv' ? hoursByVolunteerCsv(result.report, result.people)
        : hourEntriesCsv(result.report, result.people, result.entries, result.schedule));
    } catch (error) {
      if (error instanceof ReportError || error instanceof RangeError) {
        res.status(error instanceof ReportError ? error.status : 400).json({ error: error.message }); return;
      }
      logger.error({ err: error }, 'Hours report could not be loaded');
      res.status(500).json({ error: 'The hours report could not be loaded. Please try again.' });
    }
  });
}
export default router;
