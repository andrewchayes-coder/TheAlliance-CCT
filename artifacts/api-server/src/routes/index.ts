import { Router, type IRouter } from "express";
import notificationsRouter from './notifications';
import resourcesRouter from './resources';
import healthRouter from "./health";
import devEmailRouter from "./dev-email";
import authRouter from "./auth";
import meRouter from "./me";
import accountRouter from "./account";
import adminRouter from "./admin";
import testAccountsRouter from './test-accounts';
import onboardingRouter from "./onboarding";
import volunteerRouter from "./volunteer";
import adminRosterRouter from "./admin-roster";
import adminWorkflowRouter from "./admin-volunteer-workflow";
import adminScheduleRouter from "./admin-schedule";
import adminCoordinatorRouter from "./admin-coordinator";
import volunteerScheduleRouter from "./volunteer-schedule";
import adminScheduleControlsRouter from './admin-schedule-controls';
import {adminExtrasRouter,volunteerExtrasRouter} from './schedule-extras';
import messagingRouter from './messaging';
import reminderJobsRouter, { jobsTriggerRouter } from './jobs';
import { csrfGuard } from "../auth/session";
import { apiAccessPolicy } from "../auth/access-policy";
import { validateWriteBoundary } from '../middlewares/request-hardening';
import { apiRouteCatalog, mountApiRouter } from '../auth/route-catalog';

const router: IRouter = Router();
function mount(prefix: string, child: IRouter) {
  mountApiRouter(router, prefix, child);
}

/** Inspect actual Express 5 layers, not a second manually maintained route list. */
export function registeredApiRoutes() {
  return apiRouteCatalog(router);
}

router.use(apiAccessPolicy);
router.use(validateWriteBoundary);
mount('', jobsTriggerRouter);
mount('', healthRouter);
mount('/auth', authRouter);

router.use(csrfGuard);
if (process.env.NODE_ENV === 'development') mount('', devEmailRouter);
mount('', resourcesRouter);
mount('', notificationsRouter);
mount('', reminderJobsRouter);
mount('', messagingRouter);
mount('', meRouter);
mount('', accountRouter);
mount('', onboardingRouter);
mount('/volunteer', volunteerRouter);
mount('/volunteer', volunteerScheduleRouter);
mount('/volunteer', volunteerExtrasRouter);
mount('/admin', adminRouter);
mount('/admin', testAccountsRouter);
mount('/admin', adminRosterRouter);
mount('/admin', adminWorkflowRouter);
mount('/admin', adminScheduleRouter);
mount('/admin', adminCoordinatorRouter);
mount('/admin', adminScheduleControlsRouter);
mount('/admin', adminExtrasRouter);

export default router;
