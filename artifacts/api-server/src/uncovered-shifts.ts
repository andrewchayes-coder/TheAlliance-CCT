import { alertReleasedAssignments } from './server/coverageAlerts';

export interface ReleasedAssignments {
  volunteerProfileId: string;
  assignmentIds: string[];
  shiftSlotIds: string[];
  effectiveDate: string;
  activityId: string;
}
export async function onAssignmentsReleased(event: ReleasedAssignments, now = new Date()): Promise<void> {
  await alertReleasedAssignments(event, now);
}
