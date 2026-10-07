export const appConfig = {
  appName: "Alliance Volunteer Portal",
  orgName: "The Alliance",
  timezone: "America/Los_Angeles",
  defaultCounty: "Placer",
  counties: ["Placer", "Sacramento", "Nevada", "El Dorado", "Sutter"],
  maxShiftsPerVolunteer: 2,
  minShiftsPerVolunteer: 1,
  reminderHoursBefore: 24,
  sameMorningReminder: false,
  sameMorningReminderHour: 7,
  agreementVersion: "v1",
} as const;

export const {
  appName,
  orgName,
  timezone,
  defaultCounty,
  counties,
  maxShiftsPerVolunteer,
  minShiftsPerVolunteer,
  reminderHoursBefore,
  sameMorningReminder,
  sameMorningReminderHour,
} = appConfig;
