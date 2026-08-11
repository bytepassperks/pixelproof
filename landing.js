import {PRODUCT} from './config.js';
import {getLicenseKey, getEntitlementState, setLicenseKey, setLicenseState, LICENSE_API_URL} from './entitlements.js';

document.querySelectorAll('[data-brand]').forEach(element => {
  element.textContent = PRODUCT.brand;
});

const status = document.querySelector('#checkout-status');
document.querySelectorAll('[data-checkout]').forEach(button => {
  button.onclick = async () => {
    const tier = button.dataset.checkout;
    if (tier === 'free') {
      window.location.href = 'app.html';
      return;
    }
    button.disabled = true;
    status.textContent = 'Opening secure checkout…';
    try {
      const response = await fetch(`${LICENSE_API_URL}/checkout`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({tier}),
      });
      const data = await response.json();
      if (!response.ok || !data.checkout_url) throw new Error(data.error || 'Checkout is temporarily unavailable.');
      window.location.href = data.checkout_url;
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
});

const key = getLicenseKey();
if (key) {
  fetch(`${LICENSE_API_URL}/license/validate`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({license_key: key}),
  }).then(response => response.json().then(data => ({response, data})))
    .then(({response, data}) => {
      if (response.ok && data.valid) setLicenseState(data);
      else setLicenseKey('');
    })
    .catch(() => setLicenseState(null));
}

const state = getEntitlementState();
if (state.tier !== 'free') {
  status.textContent = `${state.label} is active on this browser.`;
}
