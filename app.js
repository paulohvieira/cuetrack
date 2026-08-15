"use strict";

const MAX_TRAIL_POINTS = 100;
const MAX_PROCESSING_WIDTH = 640;
// A pequena margem evita descartar frames de câmeras de 30 FPS por variação no timestamp.
const TARGET_FRAME_TIME = 1000 / 31;

const elements = {
  video: document.querySelector("#camera"),
  overlay: document.querySelector("#overlay"),
  stage: document.querySelector("#camera-stage"),
  emptyState: document.querySelector("#empty-state"),
  cameraButton: document.querySelector("#camera-button"),
  cameraButtonLabel: document.querySelector("#camera-button-label"),
  clearButton: document.querySelector("#clear-button"),
  fpsValue: document.querySelector("#fps-value"),
  statusText: document.querySelector("#status-text"),
  statusDot: document.querySelector("#status-dot"),
};

const overlayContext = elements.overlay.getContext("2d");
const processingCanvas = document.createElement("canvas");
const processingContext = processingCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});

const state = {
  cvReady: false,
  running: false,
  stream: null,
  scheduledFrame: null,
  usingVideoFrameCallback: false,
  lastProcessedAt: 0,
  fpsStartedAt: 0,
  framesSinceFpsUpdate: 0,
  trail: [],
  mats: null,
  thresholdsDirty: true,
  thresholds: {
    hMin: 0,
    hMax: 179,
    sMin: 0,
    sMax: 80,
    vMin: 180,
    vMax: 255,
  },
};

function setStatus(message, mode = "") {
  elements.statusText.textContent = message;
  elements.statusDot.className = `status-dot ${mode}`.trim();
}

function markOpenCvReady() {
  if (state.cvReady || typeof cv === "undefined" || !cv.Mat) return;

  state.cvReady = true;
  elements.cameraButton.disabled = false;
  setStatus("Pronto para iniciar", "ready");
}

function markOpenCvError() {
  setStatus("Não foi possível carregar o OpenCV", "error");
  elements.cameraButton.disabled = true;
}

function bindThresholdControls() {
  for (const channel of ["h", "s", "v"]) {
    const minInput = document.querySelector(`#${channel}-min`);
    const maxInput = document.querySelector(`#${channel}-max`);
    const output = document.querySelector(`#${channel}-output`);

    const update = (changedInput) => {
      if (Number(minInput.value) > Number(maxInput.value)) {
        if (changedInput === minInput) maxInput.value = minInput.value;
        else minInput.value = maxInput.value;
      }

      const capitalized = channel.toUpperCase();
      state.thresholds[`${channel}Min`] = Number(minInput.value);
      state.thresholds[`${channel}Max`] = Number(maxInput.value);
      state.thresholdsDirty = true;
      output.value = `${minInput.value} — ${maxInput.value}`;
      output.setAttribute("aria-label", `${capitalized}: ${output.value}`);
    };

    minInput.addEventListener("input", () => update(minInput));
    maxInput.addEventListener("input", () => update(maxInput));
  }
}

async function startCamera() {
  if (!state.cvReady || state.running) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Este navegador não oferece acesso à câmera", "error");
    return;
  }

  elements.cameraButton.disabled = true;
  setStatus("Solicitando câmera traseira…");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });

    state.stream = stream;
    elements.video.srcObject = stream;
    await elements.video.play();

    configureProcessingSize();
    allocateMats();

    state.running = true;
    state.lastProcessedAt = 0;
    state.fpsStartedAt = performance.now();
    state.framesSinceFpsUpdate = 0;
    elements.emptyState.classList.add("hidden");
    elements.cameraButton.disabled = false;
    elements.cameraButtonLabel.textContent = "Parar câmera";
    elements.clearButton.disabled = false;
    setStatus("Rastreando bola branca", "active");
    scheduleNextFrame();
  } catch (error) {
    stopStreamTracks();
    elements.cameraButton.disabled = false;
    setStatus(cameraErrorMessage(error), "error");
  }
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "Permissão da câmera negada";
  if (error?.name === "NotFoundError") return "Nenhuma câmera encontrada";
  if (error?.name === "NotReadableError") return "A câmera já está em uso";
  return "Não foi possível iniciar a câmera";
}

function configureProcessingSize() {
  const sourceWidth = elements.video.videoWidth || 1280;
  const sourceHeight = elements.video.videoHeight || 720;
  const scale = Math.min(1, MAX_PROCESSING_WIDTH / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  processingCanvas.width = width;
  processingCanvas.height = height;
  elements.overlay.width = width;
  elements.overlay.height = height;
  elements.stage.style.aspectRatio = `${sourceWidth} / ${sourceHeight}`;
}

function allocateMats() {
  releaseMats();

  const rows = processingCanvas.height;
  const cols = processingCanvas.width;
  state.mats = {
    rgb: new cv.Mat(rows, cols, cv.CV_8UC3),
    hsv: new cv.Mat(rows, cols, cv.CV_8UC3),
    mask: new cv.Mat(rows, cols, cv.CV_8UC1),
    low: new cv.Mat(rows, cols, cv.CV_8UC3),
    high: new cv.Mat(rows, cols, cv.CV_8UC3),
    kernel: cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)),
  };
  state.thresholdsDirty = true;
}

function updateThresholdMats() {
  if (!state.thresholdsDirty || !state.mats) return;

  const { hMin, hMax, sMin, sMax, vMin, vMax } = state.thresholds;
  state.mats.low.setTo(new cv.Scalar(hMin, sMin, vMin));
  state.mats.high.setTo(new cv.Scalar(hMax, sMax, vMax));
  state.thresholdsDirty = false;
}

function scheduleNextFrame() {
  if (!state.running) return;

  if (typeof elements.video.requestVideoFrameCallback === "function") {
    state.usingVideoFrameCallback = true;
    state.scheduledFrame = elements.video.requestVideoFrameCallback(processFrame);
  } else {
    state.usingVideoFrameCallback = false;
    state.scheduledFrame = requestAnimationFrame(processFrame);
  }
}

function processFrame(now) {
  if (!state.running) return;

  if (now - state.lastProcessedAt < TARGET_FRAME_TIME) {
    scheduleNextFrame();
    return;
  }

  state.lastProcessedAt = now;

  try {
    processingContext.drawImage(
      elements.video,
      0,
      0,
      processingCanvas.width,
      processingCanvas.height,
    );

    const source = cv.imread(processingCanvas);
    let detection = null;

    try {
      cv.cvtColor(source, state.mats.rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(state.mats.rgb, state.mats.hsv, cv.COLOR_RGB2HSV);
      updateThresholdMats();
      cv.inRange(state.mats.hsv, state.mats.low, state.mats.high, state.mats.mask);
      cv.morphologyEx(
        state.mats.mask,
        state.mats.mask,
        cv.MORPH_OPEN,
        state.mats.kernel,
      );
      cv.morphologyEx(
        state.mats.mask,
        state.mats.mask,
        cv.MORPH_CLOSE,
        state.mats.kernel,
      );
      detection = findBestCandidate(state.mats.mask);
    } finally {
      source.delete();
    }

    if (detection) addTrailPoint(detection);
    drawOverlay(detection);
    updateFps(now);
  } catch (error) {
    console.error("Falha ao processar frame:", error);
    stopCamera();
    setStatus("Erro ao processar a imagem", "error");
    return;
  }

  scheduleNextFrame();
}

function findBestCandidate(mask) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let bestCandidate = null;
  let bestScore = -Infinity;

  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = mask.rows * mask.cols;
    const minArea = Math.max(24, imageArea * 0.00007);
    const maxArea = imageArea * 0.04;
    const maxDiameter = Math.min(mask.rows, mask.cols) * 0.28;

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);

      try {
        const area = cv.contourArea(contour);
        if (area < minArea || area > maxArea) continue;

        const bounds = cv.boundingRect(contour);
        if (
          bounds.width < 6 ||
          bounds.height < 6 ||
          bounds.width > maxDiameter ||
          bounds.height > maxDiameter
        ) {
          continue;
        }

        const aspectRatio = bounds.width / bounds.height;
        if (aspectRatio < 0.68 || aspectRatio > 1.47) continue;

        const perimeter = cv.arcLength(contour, true);
        if (perimeter <= 0) continue;

        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
        if (circularity < 0.62) continue;

        const moments = cv.moments(contour, false);
        if (!moments.m00) continue;

        const centerX = moments.m10 / moments.m00;
        const centerY = moments.m01 / moments.m00;
        const radius = (bounds.width + bounds.height) / 4;
        const areaFill = area / (bounds.width * bounds.height);
        const previousPoint = state.trail.at(-1);
        const continuityBonus = previousPoint
          ? Math.max(
              0,
              1 -
                Math.hypot(centerX - previousPoint.x, centerY - previousPoint.y) /
                  (Math.min(mask.rows, mask.cols) * 0.35),
            )
          : 0;
        const score = circularity * 4 + areaFill + continuityBonus * 0.7;

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = { x: centerX, y: centerY, radius };
        }
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }

  return bestCandidate;
}

function addTrailPoint(detection) {
  state.trail.push({ x: detection.x, y: detection.y });
  if (state.trail.length > MAX_TRAIL_POINTS) state.trail.shift();
}

function drawOverlay(detection = null) {
  const { width, height } = elements.overlay;
  overlayContext.clearRect(0, 0, width, height);

  if (state.trail.length > 1) {
    overlayContext.save();
    overlayContext.lineCap = "round";
    overlayContext.lineJoin = "round";
    overlayContext.lineWidth = Math.max(2, width / 320);

    for (let index = 1; index < state.trail.length; index += 1) {
      const alpha = 0.12 + (index / state.trail.length) * 0.63;
      overlayContext.strokeStyle = `rgba(124, 255, 174, ${alpha})`;
      overlayContext.beginPath();
      overlayContext.moveTo(state.trail[index - 1].x, state.trail[index - 1].y);
      overlayContext.lineTo(state.trail[index].x, state.trail[index].y);
      overlayContext.stroke();
    }
    overlayContext.restore();
  }

  if (!detection) return;

  overlayContext.save();
  overlayContext.strokeStyle = "#7cffae";
  overlayContext.fillStyle = "#7cffae";
  overlayContext.lineWidth = Math.max(2, width / 240);
  overlayContext.shadowColor = "rgba(66, 227, 141, 0.7)";
  overlayContext.shadowBlur = 10;
  overlayContext.beginPath();
  overlayContext.arc(detection.x, detection.y, detection.radius * 1.18, 0, Math.PI * 2);
  overlayContext.stroke();
  overlayContext.beginPath();
  overlayContext.arc(detection.x, detection.y, Math.max(2.4, width / 180), 0, Math.PI * 2);
  overlayContext.fill();
  overlayContext.restore();
}

function updateFps(now) {
  state.framesSinceFpsUpdate += 1;
  const elapsed = now - state.fpsStartedAt;

  if (elapsed >= 600) {
    const fps = Math.round((state.framesSinceFpsUpdate * 1000) / elapsed);
    elements.fpsValue.textContent = String(fps);
    state.framesSinceFpsUpdate = 0;
    state.fpsStartedAt = now;
  }
}

function clearTrail() {
  state.trail.length = 0;
  drawOverlay();
}

function stopStreamTracks() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.video.srcObject = null;
}

function stopCamera() {
  state.running = false;

  if (state.scheduledFrame !== null) {
    if (state.usingVideoFrameCallback && elements.video.cancelVideoFrameCallback) {
      elements.video.cancelVideoFrameCallback(state.scheduledFrame);
    } else {
      cancelAnimationFrame(state.scheduledFrame);
    }
  }

  state.scheduledFrame = null;
  stopStreamTracks();
  releaseMats();
  clearTrail();
  elements.emptyState.classList.remove("hidden");
  elements.cameraButtonLabel.textContent = "Iniciar câmera";
  elements.clearButton.disabled = true;
  elements.fpsValue.textContent = "0";

  if (state.cvReady) setStatus("Pronto para iniciar", "ready");
}

function releaseMats() {
  if (!state.mats) return;
  Object.values(state.mats).forEach((mat) => mat?.delete());
  state.mats = null;
}

function toggleCamera() {
  if (state.running) stopCamera();
  else startCamera();
}

bindThresholdControls();
elements.cameraButton.addEventListener("click", toggleCamera);
elements.clearButton.addEventListener("click", clearTrail);
window.addEventListener("opencv-ready", markOpenCvReady, { once: true });
window.addEventListener("opencv-error", markOpenCvError, { once: true });
window.addEventListener("pagehide", stopCamera);

if (typeof cv !== "undefined" && cv.Mat) markOpenCvReady();
else if (window.__opencvLoadFailed) markOpenCvError();
