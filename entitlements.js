import {PRODUCT, TIERS} from './config.js';

const LICENSE_KEY = 'pixelproof-license-key';
const LICENSE_STATE = 'pixelproof-license-state';
const TASK_STATE = 'pixelproof-task-state';

function today() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function readLicense() {
  try {
    const value = JSON.parse(localStorage.getItem(LICENSE_STATE) || 'null');
    return value?.tier && value.valid ? value : null;
  } catch {
    return null;
  }
}

function activeTier() {
  const license = readLicense();
  return license?.tier && TIERS[license.tier] ? license.tier : 'free';
}

function usedToday() {
  try {
    const value = JSON.parse(localStorage.getItem(TASK_STATE) || 'null');
    const count = Number(value?.count);
    return value?.date === today() && Number.isFinite(count) && Number.isInteger(count) && count >= 0
      ? count
      : 0;
  } catch {
    return 0;
  }
}

export function getEntitlementState() {
  const tier = activeTier();
  const definition = TIERS[tier];
  return {tier, ...definition, tasksUsed: usedToday()};
}

export function setLicenseKey(key) {
  try {
    if (key) localStorage.setItem(LICENSE_KEY, key.trim());
    else localStorage.removeItem(LICENSE_KEY);
  } catch {}
}

export function getLicenseKey() {
  return localStorage.getItem(LICENSE_KEY) || '';
}

export function setLicenseState(value) {
  try {
    if (value?.valid && TIERS[value.tier]) localStorage.setItem(LICENSE_STATE, JSON.stringify(value));
    else localStorage.removeItem(LICENSE_STATE);
  } catch {}
}

export function recordTask() {
  const value = {date: today(), count: usedToday() + 1};
  try {
    localStorage.setItem(TASK_STATE, JSON.stringify(value));
  } catch {}
  return value.count;
}

export function canUseTool(toolId, context = {}) {
  if (!toolId) return false;
  const state = getEntitlementState();
  if (context.fileCount && context.fileCount > state.maxFiles) return false;
  if (toolId === 'background-removal' && !state.backgroundRemoval) return false;
  if (context.task && state.tasksPerDay !== Infinity && state.tasksUsed >= state.tasksPerDay) return false;
  return true;
}

export function limitMessage(toolId = '', context = {}) {
  const state = getEntitlementState();
  if (toolId === 'background-removal' && !state.backgroundRemoval) {
    return 'Background removal is included with Solo and Studio. Upgrade to unlock it.';
  }
  if (context.fileCount && context.fileCount > state.maxFiles) {
    return `${state.label} tier: batches up to ${state.maxFiles} files.`;
  }
  if (state.tasksPerDay !== Infinity && state.tasksUsed >= state.tasksPerDay) return `Free tier: ${state.tasksPerDay} tasks per day.`;
  return `${state.label} tier: batches up to ${state.maxFiles} files.`;
}

export const LICENSE_STORAGE_KEY = LICENSE_KEY;
export const LICENSE_API_URL = PRODUCT.workerUrl;
