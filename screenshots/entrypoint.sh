#!/usr/bin/env bash
#
# Launch ComfyUI headless, wait for it to be ready, then run the
# Playwright capture script. Exits non-zero if any expected screenshot is
# missing afterwards so a failed run surfaces in the build output.
#
# EXPECTED_OUTPUTS is a space-separated list of filenames (relative to
# OUT_DIR) the capture must produce. Set it via ENV in the Dockerfile.

set -euo pipefail

PORT="${COMFYUI_PORT:-8188}"
OUT_DIR="${OUT_DIR:-/out}"
COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"
CAPTURE="${CAPTURE_SCRIPT:-/opt/screenshots/capture.mjs}"
EXPECTED_OUTPUTS="${EXPECTED_OUTPUTS:-picker.png}"
READY_URL="http://127.0.0.1:${PORT}/system_stats"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

mkdir -p "${OUT_DIR}"

cd "${COMFY_DIR}"
python main.py \
    --cpu \
    --listen 0.0.0.0 \
    --port "${PORT}" \
    --disable-auto-launch \
    >/tmp/comfyui.log 2>&1 &
COMFY_PID=$!

cleanup() {
    if kill -0 "${COMFY_PID}" 2>/dev/null; then
        kill "${COMFY_PID}" 2>/dev/null || true
        wait "${COMFY_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "Waiting for ComfyUI to come up on ${READY_URL} (timeout: ${READY_TIMEOUT}s)…"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
until curl -fs "${READY_URL}" >/dev/null 2>&1; do
    if ! kill -0 "${COMFY_PID}" 2>/dev/null; then
        echo "ComfyUI exited before becoming ready. Log tail:" >&2
        tail -n 200 /tmp/comfyui.log >&2 || true
        exit 1
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
        echo "ComfyUI did not become ready within ${READY_TIMEOUT}s. Log tail:" >&2
        tail -n 200 /tmp/comfyui.log >&2 || true
        exit 1
    fi
    sleep 1
done
echo "ComfyUI is ready."

node "${CAPTURE}"
status=$?

# Word-splitting on EXPECTED_OUTPUTS is intentional — it's a space-separated list.
# shellcheck disable=SC2086
for f in ${EXPECTED_OUTPUTS}; do
    if [ ! -s "${OUT_DIR}/${f}" ]; then
        echo "Missing or empty ${OUT_DIR}/${f} after capture." >&2
        exit 1
    fi
done

echo "Captured: ${EXPECTED_OUTPUTS} (in ${OUT_DIR})."
exit "${status}"
