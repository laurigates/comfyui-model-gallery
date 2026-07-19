# syntax=docker/dockerfile:1.25
#
# Single-stage build for the README screenshot generator.
#
# Base image: the official Playwright image, which already has Node 22,
# Chromium, and every Chromium runtime dep installed. On top of that we
# install Python + clone ComfyUI + install CPU-only torch and ComfyUI's
# requirements.
#
# The entrypoint starts ComfyUI on :8188, waits for /system_stats to
# return 200, then runs the Playwright driver which writes /out/picker.png
# (the model gallery modal). The grid lists real files, so the build seeds
# placeholder model files into models/ first (see seed_models.py).

# Pin to a real ComfyUI release. Bumping is a deliberate act — the modal
# screenshot is sensitive to the frontend bundle that ships with this
# release. v0.22.0 ships comfyui-frontend-package==1.43.18, which clears
# the pack's >=1.40 floor (widget.onPointerDown hook).
ARG COMFYUI_REF=v0.22.0

# Pinning the Playwright image version pins the Chromium revision too,
# which is the single largest source of cross-host font-rendering drift.
# Keep this in sync with the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

ARG COMFYUI_REF

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    EXPECTED_OUTPUTS="picker.png"

# Ubuntu Noble ships Python 3.12. We need pip + venv tooling and git
# for the ComfyUI clone. curl is already present from the base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

WORKDIR /opt
RUN git clone --depth 1 --branch "${COMFYUI_REF}" \
    https://github.com/comfyanonymous/ComfyUI.git /opt/ComfyUI

WORKDIR /opt/ComfyUI

# CPU-only torch keeps the image lean and avoids CUDA driver dependencies.
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
        torch torchvision torchaudio \
    && pip install -r requirements.txt

# Seed placeholder model files so the gallery grid is populated. The /list
# endpoint enumerates names only (never reads contents), so zero-byte files
# with believable names + subfolders are enough. Done here so the layer is
# cached and re-runs don't regenerate them.
COPY screenshots/seed_models.py /opt/screenshots/seed_models.py
RUN python /opt/screenshots/seed_models.py

WORKDIR /opt/screenshots
COPY screenshots/package.json /opt/screenshots/package.json
# Chromium is pre-installed in the Playwright base image, so we only
# need the npm dependency for the driver script itself.
RUN npm install --omit=dev

# The pack lives under custom_nodes/ with the canonical directory name.
# This name is the served URL prefix (/extensions/comfyui-model-gallery/),
# so don't rename it.
COPY . /opt/ComfyUI/custom_nodes/comfyui-model-gallery

COPY screenshots/capture.mjs /opt/screenshots/capture.mjs
COPY screenshots/workflow.json /opt/screenshots/workflow.json
COPY screenshots/entrypoint.sh /opt/screenshots/entrypoint.sh
RUN chmod +x /opt/screenshots/entrypoint.sh

WORKDIR /opt/ComfyUI

VOLUME ["/out"]

ENTRYPOINT ["/opt/screenshots/entrypoint.sh"]
