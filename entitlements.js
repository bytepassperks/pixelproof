import {PRODUCT, TIERS} from './config.js';

const LICENSE_KEY = 'pixelproof-license-key';
const LICENSE_STATE = 'pixelproof-license-state';
const TASK_STATE = 'pixelproof-task-state';
const LICENSE_CHECKED_AT = 'pixelproof-license-checked-at';
const REVALIDATION_INTERVAL = 24 * 60 * 60 * 1000;

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
  return license?.tier && Object.prototype.hasOwnProperty.call(TIERS, license.tier) &&
    TIERS[license.tier] && typeof TIERS[license.tier] === "object"
    ? license.tier
    : 'free';
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
  try {
    return localStorage.getItem(LICENSE_KEY) || '';
  } catch {
    return '';
  }
}

export function setLicenseState(value) {
  try {
    if (value?.valid && Object.prototype.hasOwnProperty.call(TIERS, value.tier) &&
        TIERS[value.tier] && typeof TIERS[value.tier] === "object")
      localStorage.setItem(LICENSE_STATE, JSON.stringify(value));
    else localStorage.removeItem(LICENSE_STATE);
  } catch {}
}

export async function revalidateLicense() {
  const key = getLicenseKey();
  const state = readLicense();
  if (!state) return {status: 'none'};
  if (!key) {
    setLicenseState(null);
    return {status: 'invalid'};
  }
  if (navigator.onLine === false) return {status: 'offline'};
  let checkedAt = 0;
  try {
    checkedAt = Number(localStorage.getItem(LICENSE_CHECKED_AT) || 0);
  } catch {}
  if (Date.now() - checkedAt < REVALIDATION_INTERVAL) return {status: 'cached'};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${LICENSE_API_URL}/license/validate`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({license_key: key}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    let data = {};
    try { data = await response.json(); } catch {}
    try { localStorage.setItem(LICENSE_CHECKED_AT, String(Date.now())); } catch {}
    if (!response.ok || !data.valid) {
      setLicenseKey('');
      setLicenseState(null);
      return {status: 'invalid'};
    }
    setLicenseState(data);
    return {status: 'valid'};
  } catch {
    return {status: 'offline'};
  }
}

export function recordTask() {
  let count = usedToday() + 1;
  try {
    const latest = JSON.parse(localStorage.getItem(TASK_STATE) || 'null');
    const latestCount = Number(latest?.count);
    if (latest?.date === today() && Number.isInteger(latestCount) && latestCount >= 0)
      count = latestCount + 1;
  } catch {}
  const value = {date: today(), count};
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
