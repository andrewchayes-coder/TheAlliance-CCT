import { Router } from 'express';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';
import { developmentClock } from '../server/development-clock';
import { hourEntriesCsv, hoursByVolunteerCsv, hourEntriesRows, hoursByVolunteerRows, ReportError, reportIncludeTest } from '../server/hoursReport';
import { reportWorkbook } from '../server/hoursReportExcel';
import { readHoursReport } from '../server/hoursReportRepository';
import { logger } from '../lib/logger';

const router = Router();
for (const kind of ['hours', 'hours.csv', 'hour-entries.csv', 'hours.xlsx', 'hour-entries.xlsx'] as const) {
  router.get(`/admin/reports/${kind}`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = developmentClock(req.query.at);
      const result = await readHoursReport(now, { month: req.query.month, startDate: req.query.startDate, endDate: req.query.endDate }, reportIncludeTest(req.query.includeTest));
      res.set('Cache-Control', 'no-store');
      if (kind === 'hours') { res.json(GetAdminHoursReportResponse.parse(result.report)); return; }
      const summary = kind.startsWith('hours.');
      const filename = summary ? 'hours-by-volunteer' : 'hour-entries';
      const periodName = `${result.report.period.startDate}-to-${result.report.period.endDate}`;
      if (kind.endsWith('.xlsx')) {
        res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="alliance-${filename}-${periodName}.xlsx"` });
        res.send(await reportWorkbook(summary ? 'Hours by volunteer' : 'Hour entries', summary
          ? hoursByVolunteerRows(result.report, result.people)
          : hourEntriesRows(result.report, result.people, result.entries, result.schedule)));
        return;
      }
      res.set({ 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="alliance-${filename}-${periodName}.csv"` });
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
