import {PRODUCT} from './config.js';
import {getLicenseKey, setLicenseKey, setLicenseState, LICENSE_API_URL} from './entitlements.js';

document.querySelectorAll('[data-brand]').forEach(element => {
  element.textContent = PRODUCT.brand;
});

const form = document.querySelector('#activation-form');
const input = document.querySelector('#license-key');
const status = document.querySelector('#activation-status');
input.value = getLicenseKey();
form.onsubmit = async event => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) return;
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Checking licence…';
  try {
    const response = await fetch(`${LICENSE_API_URL}/license/validate`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({license_key: key}),
    });
    const data = await response.json();
    if (!response.ok || !data.valid) throw new Error(data.error || 'That licence key could not be validated.');
    setLicenseKey(key);
    setLicenseState(data);
    status.textContent = `${data.label || data.tier} activated on this browser.`;
    setTimeout(() => {window.location.href = 'app.html';}, 900);
  } catch (error) {
    setLicenseKey('');
    setLicenseState(null);
    status.textContent = `${error.message} The free tier remains available.`;
    button.disabled = false;
  }
};
