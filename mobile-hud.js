"use strict";

(function enhanceMobileBallHud() {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function canvasScale() {
    const rect = elements.overlay.getBoundingClientRect();
    if (!rect.width) return 1;
    return elements.overlay.width / rect.width;
  }

  function cssPx(value) {
    return value * canvasScale();
  }

  function trendLabel() {
    const { moving, acceleration } = state.motion;
    if (!moving) return "PARADA";
    if (acceleration > 120) return "↑ ACELERANDO";
    if (acceleration < -120) return "↓ DESACELERANDO";
    return "→ ESTÁVEL";
  }

  window.drawVelocityVector = function drawVelocityVectorMobile(detection) {
    const { vx, vy, speed, moving } = state.motion;
    if (!moving || speed < MOTION_STOP_SPEED) return;

    const magnitude = Math.hypot(vx, vy);
    if (!magnitude) return;

    const ux = vx / magnitude;
    const uy = vy / magnitude;
    const scale = canvasScale();
    const vectorLength = cssPx(clamp(48 + speed * 0.028, 52, 112));
    const startOffset = Math.max(detection.radius * 1.5, cssPx(13));
    const startX = detection.x + ux * startOffset;
    const startY = detection.y + uy * startOffset;
    const endX = startX + ux * vectorLength;
    const endY = startY + uy * vectorLength;
    const headLength = 10 * scale;
    const angle = Math.atan2(uy, ux);

    overlayContext.save();
    overlayContext.strokeStyle = "rgba(255, 233, 128, 0.98)";
    overlayContext.fillStyle = "rgba(255, 233, 128, 0.98)";
    overlayContext.lineWidth = 3.2 * scale;
    overlayContext.lineCap = "round";
    overlayContext.shadowColor = "rgba(0, 0, 0, 0.65)";
    overlayContext.shadowBlur = 4 * scale;

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
  };

  window.drawMovingHud = function drawMovingHudMobile(detection, width, height) {
    const motion = state.motion;
    const scale = canvasScale();
    const speedLabel = `${Math.round(motion.speed)} px/s`;
    const detailLabel = motion.moving
      ? `MAX ${Math.round(motion.maxSpeed)}  ·  ${trendLabel()}`
      : "BOLA PARADA";

    const mainFont = 16 * scale;
    const detailFont = 10.5 * scale;
    const padX = 11 * scale;
    const padY = 8 * scale;
    const lineGap = 3 * scale;
    const hudHeight = padY * 2 + mainFont + detailFont + lineGap;
    const edge = 7 * scale;
    const gap = Math.max(detection.radius * 1.65, 13 * scale);

    overlayContext.save();
    overlayContext.font = `800 ${mainFont}px system-ui, sans-serif`;
    const mainWidth = overlayContext.measureText(speedLabel).width;
    overlayContext.font = `700 ${detailFont}px system-ui, sans-serif`;
    const detailWidth = overlayContext.measureText(detailLabel).width;
    const hudWidth = clamp(Math.max(mainWidth, detailWidth) + padX * 2, 118 * scale, 190 * scale);

    let x = detection.x + gap;
    let y = detection.y - hudHeight / 2;
    let side = "right";

    if (x + hudWidth > width - edge) {
      x = detection.x - gap - hudWidth;
      side = "left";
    }

    if (x < edge) {
      x = clamp(detection.x - hudWidth / 2, edge, width - hudWidth - edge);
      y = detection.y - detection.radius - hudHeight - 12 * scale;
      side = "top";
    }

    if (y < edge) {
      y = detection.y + detection.radius + 12 * scale;
    }
    y = clamp(y, edge, height - hudHeight - edge);

    const connectorY = clamp(detection.y, y + 10 * scale, y + hudHeight - 10 * scale);
    overlayContext.strokeStyle = motion.moving
      ? "rgba(255, 233, 128, 0.78)"
      : "rgba(124, 255, 174, 0.65)";
    overlayContext.lineWidth = 1.8 * scale;
    overlayContext.shadowColor = "rgba(0, 0, 0, 0.75)";
    overlayContext.shadowBlur = 5 * scale;

    if (side === "right") {
      overlayContext.beginPath();
      overlayContext.moveTo(detection.x + detection.radius * 1.25, detection.y);
      overlayContext.lineTo(x, connectorY);
      overlayContext.stroke();
    } else if (side === "left") {
      overlayContext.beginPath();
      overlayContext.moveTo(detection.x - detection.radius * 1.25, detection.y);
      overlayContext.lineTo(x + hudWidth, connectorY);
      overlayContext.stroke();
    }

    overlayContext.fillStyle = "rgba(2, 7, 4, 0.92)";
    roundedRect(overlayContext, x, y, hudWidth, hudHeight, 11 * scale);
    overlayContext.fill();

    overlayContext.strokeStyle = motion.moving
      ? "rgba(255, 233, 128, 0.92)"
      : "rgba(124, 255, 174, 0.8)";
    overlayContext.lineWidth = 1.4 * scale;
    overlayContext.stroke();

    overlayContext.textAlign = "left";
    overlayContext.textBaseline = "top";
    overlayContext.shadowBlur = 0;
    overlayContext.font = `800 ${mainFont}px system-ui, sans-serif`;
    overlayContext.fillStyle = motion.moving ? "#ffe980" : "#7cffae";
    overlayContext.fillText(speedLabel, x + padX, y + padY);

    overlayContext.font = `700 ${detailFont}px system-ui, sans-serif`;
    overlayContext.fillStyle = "rgba(235, 247, 239, 0.88)";
    overlayContext.fillText(
      detailLabel,
      x + padX,
      y + padY + mainFont + lineGap,
      hudWidth - padX * 2,
    );

    overlayContext.restore();
  };
})();
