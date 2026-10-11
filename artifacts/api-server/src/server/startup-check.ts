import { assertProductionConfig } from './production-config';
import { quickLoginConfigurationWarning } from '../auth/quick-login-lock';
import { logger } from '../lib/logger';
assertProductionConfig();
const quickLoginWarning = quickLoginConfigurationWarning();
if (quickLoginWarning) logger.warn({ code: 'QUICK_LOGIN_DISABLED' }, quickLoginWarning);
