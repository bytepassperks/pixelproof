import {PRODUCT, TIERS} from './config.js';

const LICENSE_KEY = 'pixelproof-license-key';
const LICENSE_STATE = 'pixelproof-license-state';
const TASK_STATE = 'pixelproof-task-state';

function today() {
  return new Date().toISOString().slice(0, 10);
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
    return value?.date === today() ? Number(value.count || 0) : 0;
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
  if (key) localStorage.setItem(LICENSE_KEY, key.trim());
  else localStorage.removeItem(LICENSE_KEY);
}

export function getLicenseKey() {
  return localStorage.getItem(LICENSE_KEY) || '';
}

export function setLicenseState(value) {
  if (value?.valid && TIERS[value.tier]) localStorage.setItem(LICENSE_STATE, JSON.stringify(value));
  else localStorage.removeItem(LICENSE_STATE);
}

export function recordTask() {
  const value = {date: today(), count: usedToday() + 1};
  localStorage.setItem(TASK_STATE, JSON.stringify(value));
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

export function limitMessage() {
  const state = getEntitlementState();
  if (state.tasksPerDay !== Infinity && state.tasksUsed >= state.tasksPerDay) return `Free tier: ${state.tasksPerDay} tasks per day.`;
  return `Free tier: batches up to ${state.maxFiles} files.`;
}

export const LICENSE_STORAGE_KEY = LICENSE_KEY;
export const LICENSE_API_URL = PRODUCT.workerUrl;
