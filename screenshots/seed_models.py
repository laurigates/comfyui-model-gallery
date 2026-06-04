"""Seed placeholder model files so the gallery grid isn't empty.

The picker grid lists real files via folder_paths.get_filename_list — a
fresh ComfyUI clone has empty model dirs, so without this the grid renders
its "(no models)" empty state. The /model_gallery/list endpoint only
enumerates names (it never reads file contents), so zero-byte placeholders
with believable names + a couple of subfolders are enough to populate the
grid and exercise the subfolder filter chips.

Run at Docker build time, before ComfyUI starts, so the first
get_filename_list scan caches these names.
"""

from __future__ import annotations

import os

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
MODELS_DIR = os.path.join(COMFY_DIR, "models")

# category -> list of relative names (forward-slash subfolders allowed).
# Names are illustrative only; nothing is loaded. The spread across root +
# subfolders makes the "All / (root) / <subfolder>" chips meaningful.
SEED: dict[str, list[str]] = {
    "checkpoints": [
        "sd_xl_base_1.0.safetensors",
        "sd_xl_refiner_1.0.safetensors",
        "v1-5-pruned-emaonly.safetensors",
        "flux/flux1-dev.safetensors",
        "flux/flux1-schnell.safetensors",
        "sd35/sd3.5_large.safetensors",
        "sd35/sd3.5_medium.safetensors",
    ],
    "loras": [
        "detail_tweaker_xl.safetensors",
        "add_detail.safetensors",
        "flux/realism_lora.safetensors",
        "flux/anti_blur.safetensors",
        "style/ghibli_style.safetensors",
        "style/film_grain.safetensors",
    ],
}


def main() -> None:
    for category, names in SEED.items():
        root = os.path.join(MODELS_DIR, category)
        for name in names:
            path = os.path.join(root, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Zero-byte placeholder — folder_paths.get_filename_list only needs
            # the name + extension, never the contents.
            with open(path, "wb"):
                pass
            print(f"seeded {category}/{name}")


if __name__ == "__main__":
    main()
