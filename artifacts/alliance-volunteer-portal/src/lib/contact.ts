import { appConfig } from '@workspace/shared/appConfig';

export const STAFF_NAME = appConfig.staffContactName;
export const STAFF_EMAIL = appConfig.staffContactEmail;
export const SOMETHING_WENT_WRONG = `Something went wrong on our end. Please try again. If it keeps happening, email ${STAFF_NAME} at ${STAFF_EMAIL}.`;
