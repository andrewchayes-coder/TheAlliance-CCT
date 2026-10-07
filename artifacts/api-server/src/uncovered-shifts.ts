import { logger } from './lib/logger';

export interface ReleasedAssignments {
  volunteerProfileId: string;
  assignmentIds: string[];
  shiftSlotIds: string[];
  effectiveDate: string;
  activityId: string;
}
/** Scheduling-step integration point. No coverage calculation or alert is claimed yet. */
export async function onAssignmentsReleased(event: ReleasedAssignments): Promise<void> {
  logger.info({ ...event, checkDeferred: true }, 'Standing assignments released; uncovered-shift check awaits the scheduling module.');
}
