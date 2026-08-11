import {TIERS} from './config.js';
export function canUseTool(toolId, context = {}) {
  if (!toolId) return false;
  if (context.fileCount && context.fileCount > TIERS.limits.maxFiles) return false;
  return TIERS.current === 'unlimited' || Boolean(context.entitlements?.includes(toolId));
}
