import {PRODUCT} from './config.js';
import {getEntitlementState, getLicenseKey, setLicenseKey, setLicenseState, LICENSE_API_URL} from './entitlements.js';

document.querySelectorAll('[data-brand]').forEach(element => {
  element.textContent = PRODUCT.brand;
});

const form = document.querySelector('#activation-form');
const input = document.querySelector('#license-key');
const status = document.querySelector('#activation-status');
input.value = getLicenseKey();
const currentEntitlement = getEntitlementState();
if (input.value && currentEntitlement.tier !== "free")
  status.textContent = `${currentEntitlement.label} is active on this browser.`;
form.onsubmit = async event => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) {
    status.textContent = 'Enter the licence key from your receipt.';
    input.focus();
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Checking licence…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${LICENSE_API_URL}/license/validate`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({license_key: key}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Licence service returned an invalid response.");
    }
    if (!response.ok || !data.valid) throw new Error(data.error || 'That licence key could not be validated.');
    setLicenseKey(key);
    setLicenseState(data);
    try { localStorage.setItem('pixelproof-license-checked-at', String(Date.now())); } catch {}
    status.textContent = `${data.label || data.tier} activated on this browser.`;
    setTimeout(() => {window.location.href = 'app.html';}, 900);
  } catch (error) {
    clearTimeout(timer);
    setLicenseKey('');
    setLicenseState(null);
    const message = error.name === 'AbortError'
      ? 'Licence validation timed out.'
      : error instanceof TypeError
        ? 'Licence service could not be reached.'
        : error.message;
    status.textContent = `${message} The free tier remains available.`;
    button.disabled = false;
  }
};
