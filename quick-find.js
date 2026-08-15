"use strict";

(() => {
  const SAMPLE_RADIUS_RATIO = 0.035;
  const SAMPLE_RADIUS_MIN = 12;
  const SAMPLE_RADIUS_MAX = 28;
  const SAMPLE_STEP = 2;
  const TOP_SAMPLE_RATIO = 0.22;
  const FEEDBACK_MS = 1400;

  const findButton = document.querySelector("#find-ball-button");
  const findButtonLabel = document.querySelector("#find-ball-button-label");
  const findHint = document.querySelector("#quick-find-hint");
  const findHintTitle = document.querySelector("#quick-find-title");
  const findHintDetail = document.querySelector("#quick-find-detail");
  const marker = document.querySelector("#quick-find-marker");

  if (!findButton || !findHint || !marker) return;

  let finding = false;
  let feedbackTimer = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
    return sorted[index];
  }

  function rgbToHsv(rByte, gByte, bByte) {
    const r = rByte / 255;
    const g = gByte / 255;
    const b = bByte / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta > 0) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
    }

    if (hue < 0) hue += 360;

    return {
      h: Math.round(hue / 2),
      s: Math.round(max === 0 ? 0 : (delta / max) * 255),
      v: Math.round(max * 255),
    };
  }

  function setThresholdRange(channel, min, max) {
    const minInput = document.querySelector(`#${channel}-min`);
    const maxInput = document.querySelector(`#${channel}-max`);
    const output = document.querySelector(`#${channel}-output`);

    minInput.value = String(min);
    maxInput.value = String(max);
    state.thresholds[`${channel}Min`] = min;
    state.thresholds[`${channel}Max`] = max;
    state.thresholdsDirty = true;
    output.value = `${min} — ${max}`;
    output.setAttribute("aria-label", `${channel.toUpperCase()}: ${output.value}`);
  }

  function analyzeWhiteRegion(centerX, centerY) {
    processingContext.drawImage(
      elements.video,
      0,
      0,
      processingCanvas.width,
      processingCanvas.height,
    );

    const radius = clamp(
      Math.round(processingCanvas.width * SAMPLE_RADIUS_RATIO),
      SAMPLE_RADIUS_MIN,
      SAMPLE_RADIUS_MAX,
    );
    const x0 = clamp(Math.round(centerX) - radius, 0, processingCanvas.width - 1);
    const y0 = clamp(Math.round(centerY) - radius, 0, processingCanvas.height - 1);
    const x1 = clamp(Math.round(centerX) + radius, 0, processingCanvas.width - 1);
    const y1 = clamp(Math.round(centerY) + radius, 0, processingCanvas.height - 1);
    const width = Math.max(1, x1 - x0 + 1);
    const height = Math.max(1, y1 - y0 + 1);
    const imageData = processingContext.getImageData(x0, y0, width, height);
    const samples = [];
    const maxDistance = Math.max(1, Math.hypot(width / 2, height / 2));

    for (let y = 0; y < height; y += SAMPLE_STEP) {
      for (let x = 0; x < width; x += SAMPLE_STEP) {
        const offset = (y * width + x) * 4;
        const hsv = rgbToHsv(
          imageData.data[offset],
          imageData.data[offset + 1],
          imageData.data[offset + 2],
        );
        const distance = Math.hypot(x - width / 2, y - height / 2) / maxDistance;
        const whiteness = hsv.v - hsv.s * 0.72 - distance * 22;
        samples.push({ ...hsv, whiteness });
      }
    }

    if (samples.length < 20) return null;

    samples.sort((a, b) => b.whiteness - a.whiteness);
    const keepCount = clamp(
      Math.round(samples.length * TOP_SAMPLE_RATIO),
      30,
      samples.length,
    );
    const selected = samples.slice(0, keepCount);
    const sValues = selected.map((sample) => sample.s);
    const vValues = selected.map((sample) => sample.v);
    const medianV = percentile(vValues, 0.5);

    if (medianV < 85) return null;

    return {
      hMin: 0,
      hMax: 179,
      sMin: 0,
      sMax: Math.round(clamp(percentile(sValues, 0.9) + 28, 45, 155)),
      vMin: Math.round(clamp(percentile(vValues, 0.12) - 32, 95, 235)),
      vMax: 255,
    };
  }

  function showMarker(clientX, clientY, mode = "success") {
    const rect = elements.stage.getBoundingClientRect();
    const left = clamp(clientX - rect.left, 0, rect.width);
    const top = clamp(clientY - rect.top, 0, rect.height);
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
    marker.dataset.mode = mode;
    marker.classList.remove("visible");
    void marker.offsetWidth;
    marker.classList.add("visible");
  }

  function setHint(title, detail, mode = "finding") {
    clearTimeout(feedbackTimer);
    findHintTitle.textContent = title;
    findHintDetail.textContent = detail;
    findHint.dataset.mode = mode;
    findHint.classList.add("visible");
  }

  function hideHintSoon() {
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      findHint.classList.remove("visible");
      marker.classList.remove("visible");
    }, FEEDBACK_MS);
  }

  function enterFindMode() {
    if (!state.running) return;
    finding = true;
    elements.stage.classList.add("finding-ball");
    findButton.classList.add("is-active");
    findButtonLabel.textContent = "Cancelar";
    setHint("Toque na bola branca", "Toque próximo ao centro da bola", "finding");
    setStatus("Modo rápido: toque na bola branca", "active");
  }

  function exitFindMode() {
    finding = false;
    elements.stage.classList.remove("finding-ball");
    findButton.classList.remove("is-active");
    findButtonLabel.textContent = "Encontrar bola";
  }

  function cancelFindMode() {
    exitFindMode();
    findHint.classList.remove("visible");
    marker.classList.remove("visible");
    if (state.running) setStatus("Rastreando bola branca", "active");
  }

  function applyQuickCalibration(event) {
    if (!finding || !state.running) return;

    event.preventDefault();
    const rect = elements.stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * processingCanvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * processingCanvas.height;
    const thresholds = analyzeWhiteRegion(x, y);

    if (!thresholds) {
      showMarker(event.clientX, event.clientY, "error");
      setHint("Não consegui ajustar", "Toque no centro mais claro da bola", "error");
      setStatus("Tente tocar novamente no centro da bola", "error");
      return;
    }

    setThresholdRange("h", thresholds.hMin, thresholds.hMax);
    setThresholdRange("s", thresholds.sMin, thresholds.sMax);
    setThresholdRange("v", thresholds.vMin, thresholds.vMax);
    resetTracking();
    exitFindMode();
    showMarker(event.clientX, event.clientY, "success");
    setHint(
      "Bola ajustada",
      `S 0–${thresholds.sMax} · V ${thresholds.vMin}–255`,
      "success",
    );
    setStatus("Bola ajustada · rastreando", "active");
    hideHintSoon();
  }

  function syncFindButton() {
    findButton.disabled = !state.running;
    if (!state.running && finding) cancelFindMode();
  }

  findButton.addEventListener("click", () => {
    if (finding) cancelFindMode();
    else enterFindMode();
  });

  elements.stage.addEventListener("pointerup", applyQuickCalibration);

  const cameraStateObserver = new MutationObserver(() => {
    window.setTimeout(syncFindButton, 0);
  });
  cameraStateObserver.observe(elements.cameraButtonLabel, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(feedbackTimer);
    cameraStateObserver.disconnect();
  });

  syncFindButton();
})();
