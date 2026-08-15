"use strict";

const MAX_TRAIL_POINTS = 100;
const MAX_PROCESSING_WIDTH = 640;
const TARGET_FPS = 30;
const TARGET_FRAME_TIME = 1000 / TARGET_FPS;
const MOTION_START_SPEED = 70;
const MOTION_STOP_SPEED = 35;
const LOST_DETECTION_MS = 250;
const VELOCITY_SMOOTHING = 0.34;
const ACCELERATION_SMOOTHING = 0.24;
const MAX_REASONABLE_SPEED_FACTOR = 14;

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
  speedCurrent: document.querySelector("#speed-current"),
  speedMax: document.querySelector("#speed-max"),
  speedAverage: document.querySelector("#speed-average"),
  velocityX: document.querySelector("#velocity-x"),
  velocityY: document.querySelector("#velocity-y"),
  acceleration: document.querySelector("#acceleration"),
  distanceTotal: document.querySelector("#distance-total"),
  movingTime: document.querySelector("#moving-time"),
  motionState: document.querySelector("#motion-state"),
  motionTrend: document.querySelector("#motion-trend"),
  speedGaugeFill: document.querySelector("#speed-gauge-fill"),
  speedGaugeScale: document.querySelector("#speed-gauge-scale"),
  trailCount: document.querySelector("#trail-count"),
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
  motion: createMotionState(),
};

function createMotionState() {
  return {
    lastSample: null,
    lastSeenAt: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    previousSpeed: 0,
    acceleration: 0,
    maxSpeed: 0,
    distance: 0,
    movingTime: 0,
    moving: false,
    detected: false,
  };
}

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

async function getCameraStream() {
  const baseVideoConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
  };

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...baseVideoConstraints,
        facingMode: { exact: "environment" },
      },
    });
  } catch (error) {
    if (error?.name !== "OverconstrainedError" && error?.name !== "NotFoundError") {
      throw error;
    }

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...baseVideoConstraints,
        facingMode: { ideal: "environment" },
      },
    });
  }
}

function waitForVideoMetadata() {
  if (elements.video.videoWidth > 0 && elements.video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      elements.video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      elements.video.removeEventListener("error", handleError);
    };

    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Falha ao carregar o vídeo da câmera"));
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite aguardando metadados da câmera"));
    }, 4000);

    elements.video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    elements.video.addEventListener("error", handleError, { once: true });
  });
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
    const stream = await getCameraStream();

    state.stream = stream;
    elements.video.srcObject = stream;
    await waitForVideoMetadata();
    await elements.video.play();

    configureProcessingSize();
    allocateMats();
    resetTracking();

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
    console.error("Falha ao iniciar câmera:", error);
    stopStreamTracks();
    elements.cameraButton.disabled = false;
    setStatus(cameraErrorMessage(error), "error");
  }
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "Permissão da câmera negada";
  if (error?.name === "NotFoundError") return "Nenhuma câmera encontrada";
  if (error?.name === "NotReadableError") return "A câmera já está em uso";
  if (error?.name === "SecurityError") return "A câmera exige uma conexão HTTPS";
  return "Não foi possível iniciar a câmera";
}

function configureProcessingSize() {
  const sourceWidth = elements.video.videoWidth;
  const sourceHeight = elements.video.videoHeight;
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

    if (detection) {
      updateMotion(detection, now);
      addTrailPoint(detection, now);
    } else {
      handleMissingDetection(now);
    }

    drawOverlay(detection);
    updateTelemetry();
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
        const previousPoint = state.motion.lastSample;

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
          bestCandidate = {
            x: centerX,
            y: centerY,
            radius,
            circularity,
          };
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

function updateMotion(detection, now) {
  const motion = state.motion;
  motion.detected = true;
  motion.lastSeenAt = now;

  if (!motion.lastSample) {
    motion.lastSample = { x: detection.x, y: detection.y, time: now };
    return;
  }

  const dt = (now - motion.lastSample.time) / 1000;
  if (dt <= 0 || dt > 0.35) {
    motion.lastSample = { x: detection.x, y: detection.y, time: now };
    return;
  }

  const dx = detection.x - motion.lastSample.x;
  const dy = detection.y - motion.lastSample.y;
  const frameDistance = Math.hypot(dx, dy);
  const rawSpeed = frameDistance / dt;
  const maxReasonableSpeed = Math.min(processingCanvas.width, processingCanvas.height) * MAX_REASONABLE_SPEED_FACTOR;

  if (rawSpeed > maxReasonableSpeed) {
    motion.lastSample = { x: detection.x, y: detection.y, time: now };
    return;
  }

  const jitterDeadZone = Math.max(0.8, detection.radius * 0.06);
  const rawVx = frameDistance < jitterDeadZone ? 0 : dx / dt;
  const rawVy = frameDistance < jitterDeadZone ? 0 : dy / dt;

  motion.previousSpeed = motion.speed;
  motion.vx = smooth(motion.vx, rawVx, VELOCITY_SMOOTHING);
  motion.vy = smooth(motion.vy, rawVy, VELOCITY_SMOOTHING);
  motion.speed = Math.hypot(motion.vx, motion.vy);

  const rawAcceleration = (motion.speed - motion.previousSpeed) / dt;
  motion.acceleration = smooth(
    motion.acceleration,
    rawAcceleration,
    ACCELERATION_SMOOTHING,
  );

  if (!motion.moving && motion.speed >= MOTION_START_SPEED) {
    motion.moving = true;
  } else if (motion.moving && motion.speed <= MOTION_STOP_SPEED) {
    motion.moving = false;
  }

  if (motion.moving) {
    motion.distance += frameDistance;
    motion.movingTime += dt;
    motion.maxSpeed = Math.max(motion.maxSpeed, motion.speed);
  }

  motion.lastSample = { x: detection.x, y: detection.y, time: now };
}

function handleMissingDetection(now) {
  const motion = state.motion;

  if (motion.lastSeenAt && now - motion.lastSeenAt < LOST_DETECTION_MS) {
    return;
  }

  motion.detected = false;
  motion.moving = false;
  motion.lastSample = null;
  motion.vx = 0;
  motion.vy = 0;
  motion.speed = 0;
  motion.previousSpeed = 0;
  motion.acceleration = 0;
}

function smooth(previous, current, alpha) {
  return previous + alpha * (current - previous);
}

function addTrailPoint(detection, now) {
  state.trail.push({ x: detection.x, y: detection.y, time: now });

  if (state.trail.length > MAX_TRAIL_POINTS) {
    state.trail.shift();
  }
}

function drawOverlay(detection = null) {
  const { width, height } = elements.overlay;
  overlayContext.clearRect(0, 0, width, height);

  drawTrail(width);

  if (!detection) return;

  drawBallMarker(detection, width);
  drawVelocityVector(detection);
  drawMovingHud(detection, width, height);
}

function drawTrail(width) {
  if (state.trail.length <= 1) return;

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

function drawBallMarker(detection, width) {
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

function drawVelocityVector(detection) {
  const { vx, vy, speed, moving } = state.motion;
  if (!moving || speed < MOTION_STOP_SPEED) return;

  const magnitude = Math.hypot(vx, vy);
  if (!magnitude) return;

  const ux = vx / magnitude;
  const uy = vy / magnitude;
  const vectorLength = Math.min(120, Math.max(detection.radius * 2.4, speed * 0.045));
  const startOffset = detection.radius * 1.45;
  const startX = detection.x + ux * startOffset;
  const startY = detection.y + uy * startOffset;
  const endX = startX + ux * vectorLength;
  const endY = startY + uy * vectorLength;
  const headLength = Math.min(13, Math.max(7, vectorLength * 0.18));
  const angle = Math.atan2(uy, ux);

  overlayContext.save();
  overlayContext.strokeStyle = "rgba(255, 233, 128, 0.95)";
  overlayContext.fillStyle = "rgba(255, 233, 128, 0.95)";
  overlayContext.lineWidth = 2.4;
  overlayContext.lineCap = "round";

  overlayContext.beginPath();
  overlayContext.moveTo(startX, startY);
  overlayContext.lineTo(endX, endY);
  overlayContext.stroke();

  overlayContext.beginPath();
  overlayContext.moveTo(endX, endY);
  overlayContext.lineTo(
    endX - headLength * Math.cos(angle - Math.PI / 6),
    endY - headLength * Math.sin(angle - Math.PI / 6),
  );
  overlayContext.lineTo(
    endX - headLength * Math.cos(angle + Math.PI / 6),
    endY - headLength * Math.sin(angle + Math.PI / 6),
  );
  overlayContext.closePath();
  overlayContext.fill();
  overlayContext.restore();
}

function drawMovingHud(detection, width, height) {
  const motion = state.motion;
  const speedLabel = motion.moving ? `${Math.round(motion.speed)} px/s` : "PARADA";
  const fontSize = Math.max(12, Math.min(17, width / 38));
  const horizontalPadding = 9;
  const hudHeight = fontSize + 12;

  overlayContext.save();
  overlayContext.font = `700 ${fontSize}px system-ui, sans-serif`;
  const textWidth = overlayContext.measureText(speedLabel).width;
  const hudWidth = textWidth + horizontalPadding * 2;

  let x = detection.x - hudWidth / 2;
  let y = detection.y - detection.radius * 1.8 - hudHeight - 7;

  x = Math.max(5, Math.min(width - hudWidth - 5, x));
  if (y < 5) y = detection.y + detection.radius * 1.8 + 7;
  y = Math.max(5, Math.min(height - hudHeight - 5, y));

  overlayContext.fillStyle = "rgba(2, 7, 4, 0.82)";
  roundedRect(overlayContext, x, y, hudWidth, hudHeight, 8);
  overlayContext.fill();
  overlayContext.strokeStyle = motion.moving
    ? "rgba(255, 233, 128, 0.72)"
    : "rgba(124, 255, 174, 0.55)";
  overlayContext.lineWidth = 1;
  overlayContext.stroke();

  overlayContext.fillStyle = motion.moving ? "#ffe980" : "#7cffae";
  overlayContext.textAlign = "center";
  overlayContext.textBaseline = "middle";
  overlayContext.fillText(speedLabel, x + hudWidth / 2, y + hudHeight / 2 + 0.5);
  overlayContext.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function updateTelemetry() {
  const motion = state.motion;
  const averageSpeed = motion.movingTime > 0 ? motion.distance / motion.movingTime : 0;
  const gaugeScale = Math.max(500, Math.ceil(Math.max(motion.maxSpeed, motion.speed, 1) / 500) * 500);
  const gaugePercent = Math.min(100, (motion.speed / gaugeScale) * 100);

  elements.speedCurrent.textContent = String(Math.round(motion.speed));
  elements.speedMax.textContent = `${Math.round(motion.maxSpeed)} px/s`;
  elements.speedAverage.textContent = `${Math.round(averageSpeed)} px/s`;
  elements.velocityX.textContent = `${formatSigned(motion.vx)} px/s`;
  elements.velocityY.textContent = `${formatSigned(motion.vy)} px/s`;
  elements.acceleration.textContent = `${formatSigned(motion.acceleration)} px/s²`;
  elements.distanceTotal.textContent = `${Math.round(motion.distance)} px`;
  elements.movingTime.textContent = `${motion.movingTime.toFixed(2)} s`;
  elements.trailCount.textContent = `${state.trail.length}/${MAX_TRAIL_POINTS}`;
  elements.speedGaugeFill.style.width = `${gaugePercent}%`;
  elements.speedGaugeScale.textContent = `${gaugeScale} px/s`;

  if (!motion.detected) {
    elements.motionState.textContent = "SEM DETECÇÃO";
    elements.motionState.dataset.mode = "lost";
    elements.motionTrend.textContent = "Aguardando bola branca";
    return;
  }

  if (!motion.moving) {
    elements.motionState.textContent = "PARADA";
    elements.motionState.dataset.mode = "stopped";
    elements.motionTrend.textContent = "Bola estabilizada";
    return;
  }

  elements.motionState.textContent = "MOVIMENTO";
  elements.motionState.dataset.mode = "moving";

  if (motion.acceleration > 120) {
    elements.motionTrend.textContent = "↑ ACELERANDO";
  } else if (motion.acceleration < -120) {
    elements.motionTrend.textContent = "↓ DESACELERANDO";
  } else {
    elements.motionTrend.textContent = "→ VELOCIDADE ESTÁVEL";
  }
}

function formatSigned(value) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1) return "0";
  return rounded > 0 ? `+${rounded}` : String(rounded);
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

function resetTracking() {
  state.trail.length = 0;
  state.motion = createMotionState();
  drawOverlay();
  updateTelemetry();
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
  resetTracking();
  elements.emptyState.classList.remove("hidden");
  elements.cameraButtonLabel.textContent = "Iniciar câmera";
  elements.cameraButton.disabled = !state.cvReady;
  elements.clearButton.disabled = true;
  elements.fpsValue.textContent = "0";

  if (state.cvReady) {
    setStatus("Pronto para iniciar", "ready");
  }
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

function tryOpenCvReady() {
  if (typeof cv === "undefined") return;

  if (typeof cv.then === "function") {
    cv.then((readyCv) => {
      if (readyCv?.Mat) window.cv = readyCv;
      markOpenCvReady();
    }).catch(markOpenCvError);
    return;
  }

  markOpenCvReady();
}

bindThresholdControls();
elements.cameraButton.addEventListener("click", toggleCamera);
elements.clearButton.addEventListener("click", resetTracking);
window.addEventListener("opencv-ready", tryOpenCvReady, { once: true });
window.addEventListener("opencv-error", markOpenCvError, { once: true });
window.addEventListener("pagehide", stopCamera);

updateTelemetry();
tryOpenCvReady();
