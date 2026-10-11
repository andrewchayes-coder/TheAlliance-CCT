import { appConfig } from '@workspace/shared/appConfig';

export const VOLUNTEER_CONTACT_NAME = appConfig.volunteerContactName;
export const VOLUNTEER_CONTACT_EMAIL = appConfig.volunteerContactEmail;
export const SOMETHING_WENT_WRONG = `Something went wrong on our end. Please try again. If it keeps happening, email ${VOLUNTEER_CONTACT_NAME} at ${VOLUNTEER_CONTACT_EMAIL}.`;
