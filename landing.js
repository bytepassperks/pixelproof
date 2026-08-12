import {PRODUCT} from './config.js';
import {getLicenseKey, getEntitlementState, setLicenseKey, setLicenseState, LICENSE_API_URL} from './entitlements.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'}).catch(() => {});

document.querySelectorAll('[data-brand]').forEach(element => {
  element.textContent = PRODUCT.brand;
});
const privacyAnswer = document.querySelector('#faq details p');
if (privacyAnswer) {
  privacyAnswer.textContent = 'Image bytes stay in your browser. PixelProof has no image upload endpoint. The app downloads its own code and, on first background-removal use, model files. Checkout and licence validation carry no image data.';
}

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

const compareStage = document.querySelector('#proof-compare-stage');
const compareSlider = document.querySelector('#proof-compare-slider');
const compareOutput = document.querySelector('#proof-compare-output');
const compareDivider = document.querySelector('.proof-compare-divider');
const compareHandle = document.querySelector('.proof-compare-handle');
if (compareStage && compareSlider && compareOutput && compareDivider && compareHandle) {
  let dragging = false;
  const updateComparison = (value) => {
    const position = Math.max(0, Math.min(100, Number(value) || 0));
    compareSlider.value = String(position);
    compareOutput.style.clipPath = `inset(0 0 0 ${position}%)`;
    compareDivider.style.left = `${position}%`;
    compareHandle.style.left = `${position}%`;
  };
  const valueFromPoint = (event) => {
    const rect = compareStage.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * 100;
  };
  const startDrag = (event) => {
    dragging = true;
    if (Number.isFinite(event.pointerId)) compareStage.setPointerCapture?.(event.pointerId);
    updateComparison(valueFromPoint(event));
  };
  const moveDrag = (event) => {
    if (dragging) updateComparison(valueFromPoint(event));
  };
  const endDrag = () => { dragging = false; };
  compareSlider.addEventListener('input', (event) => updateComparison(event.target.value));
  compareStage.addEventListener('pointerdown', startDrag);
  compareStage.addEventListener('pointermove', moveDrag);
  compareStage.addEventListener('pointerup', endDrag);
  compareStage.addEventListener('pointercancel', endDrag);
  compareStage.addEventListener('mousedown', startDrag);
  compareStage.addEventListener('mousemove', moveDrag);
  compareStage.addEventListener('mouseup', endDrag);
  compareStage.addEventListener('click', (event) => updateComparison(valueFromPoint(event)));
  compareStage.addEventListener('dragstart', (event) => event.preventDefault());
  compareStage.addEventListener('selectstart', (event) => event.preventDefault());
  compareStage.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    dragging = true;
    updateComparison(valueFromPoint(touch));
  }, {passive: true});
  compareStage.addEventListener('touchmove', (event) => {
    if (!dragging) return;
    const touch = event.touches[0];
    if (touch) updateComparison(valueFromPoint(touch));
  }, {passive: true});
  compareStage.addEventListener('touchend', () => { dragging = false; }, {passive: true});
  updateComparison(compareSlider.value);
}
