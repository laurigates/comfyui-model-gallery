# Changelog

## [0.1.12](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.11...comfyui-model-gallery-v0.1.12) (2026-07-02)


### Features

* register a model-combo field provider with comfy-modal-kit ([#38](https://github.com/laurigates/comfyui-model-gallery/issues/38)) ([19553e6](https://github.com/laurigates/comfyui-model-gallery/commit/19553e6853b6877c92e6a9a78f415a95591420ac))

## [0.1.11](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.10...comfyui-model-gallery-v0.1.11) (2026-06-28)


### Miscellaneous

* sync uv.lock and auto-bump it via release-please ([#34](https://github.com/laurigates/comfyui-model-gallery/issues/34)) ([a6c5b0b](https://github.com/laurigates/comfyui-model-gallery/commit/a6c5b0bab5bfa7bf00f5b78d67472a2d882b9e30))

## [0.1.10](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.9...comfyui-model-gallery-v0.1.10) (2026-06-27)


### Bug Fixes

* **build:** make web/data copy idempotent ([#32](https://github.com/laurigates/comfyui-model-gallery/issues/32)) ([cfba554](https://github.com/laurigates/comfyui-model-gallery/commit/cfba554731e21f386367c3151a5f60f60bdccb36))

## [0.1.9](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.8...comfyui-model-gallery-v0.1.9) (2026-06-26)


### Bug Fixes

* **dist:** commit web/dist so git-based updates carry the built frontend ([#30](https://github.com/laurigates/comfyui-model-gallery/issues/30)) ([aa96f58](https://github.com/laurigates/comfyui-model-gallery/commit/aa96f58fe5bc1ebc019c53b94233bda0b13b7e39))

## [0.1.8](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.7...comfyui-model-gallery-v0.1.8) (2026-06-20)


### Bug Fixes

* pin comfyui-frontend-package to 3-part version (&gt;=1.40.0) ([#25](https://github.com/laurigates/comfyui-model-gallery/issues/25)) ([b2f1bc6](https://github.com/laurigates/comfyui-model-gallery/commit/b2f1bc6eb5ffe51d0beb0e20bb96618d2f3b26de))


### Miscellaneous

* **deps:** remove Dependabot config, consolidate on Renovate ([#24](https://github.com/laurigates/comfyui-model-gallery/issues/24)) ([01ce505](https://github.com/laurigates/comfyui-model-gallery/commit/01ce505969c9024f86fd8b16c98747c8239fe11c))

## [0.1.7](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.6...comfyui-model-gallery-v0.1.7) (2026-06-09)


### Bug Fixes

* **registry:** ship runtime-only files in the Comfy Registry tarball ([#21](https://github.com/laurigates/comfyui-model-gallery/issues/21)) ([6067bbb](https://github.com/laurigates/comfyui-model-gallery/commit/6067bbbaeb1c9df19d630bd06e6d5ef1b4f9963f))

## [0.1.6](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.5...comfyui-model-gallery-v0.1.6) (2026-06-08)


### Bug Fixes

* ship web/dist in registry tarball (pin publish-node-action skip_checkout) ([#19](https://github.com/laurigates/comfyui-model-gallery/issues/19)) ([221e964](https://github.com/laurigates/comfyui-model-gallery/commit/221e964abf1d178a4d40cfb88d8cd3c10f261f21))

## [0.1.5](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.4...comfyui-model-gallery-v0.1.5) (2026-06-08)


### Bug Fixes

* add Comfy Registry icon/banner and publish on release event ([#16](https://github.com/laurigates/comfyui-model-gallery/issues/16)) ([28ae5d1](https://github.com/laurigates/comfyui-model-gallery/commit/28ae5d12b261fb3e4a83231e12180001c6db85a6))

## [0.1.4](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.3...comfyui-model-gallery-v0.1.4) (2026-06-07)


### Bug Fixes

* **ci:** set skip_checkout so the built web/dist reaches the registry ([#13](https://github.com/laurigates/comfyui-model-gallery/issues/13)) ([0dd0db6](https://github.com/laurigates/comfyui-model-gallery/commit/0dd0db657a4ea315aa82b5271609a26cb9909096))


### Miscellaneous

* **deps:** Bump gitleaks/gitleaks-action from 2 to 3 ([#11](https://github.com/laurigates/comfyui-model-gallery/issues/11)) ([f57db09](https://github.com/laurigates/comfyui-model-gallery/commit/f57db094eb731bc54c06c7e6f475403271d11a79))

## [0.1.3](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.2...comfyui-model-gallery-v0.1.3) (2026-06-06)


### Features

* **build:** migrate to TypeScript + bun build ([#9](https://github.com/laurigates/comfyui-model-gallery/issues/9)) ([9291f02](https://github.com/laurigates/comfyui-model-gallery/commit/9291f02b2377cb6c3f34a14a25f6ea3f3b864122))

## [0.1.2](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.1...comfyui-model-gallery-v0.1.2) (2026-06-06)


### Features

* implement v0.1 model gallery picker (modal over native model combos + /list endpoint) ([5aa4fa2](https://github.com/laurigates/comfyui-model-gallery/commit/5aa4fa2154d66c10af814c7f34bd1e2eadc89c4b))
* model corpus + embedded-metadata reads for the picker ([#4](https://github.com/laurigates/comfyui-model-gallery/issues/4)) ([a5c613e](https://github.com/laurigates/comfyui-model-gallery/commit/a5c613e4bcce8dcba5373067b0e0260502a0e800))


### Documentation

* **release:** note tag-ruleset bypass requirement for release-please app ([#5](https://github.com/laurigates/comfyui-model-gallery/issues/5)) ([0c36513](https://github.com/laurigates/comfyui-model-gallery/commit/0c365130ebb4c0cadcace31d75d31f62565358ad))
* **screenshots:** add containerized README screenshot pipeline ([#3](https://github.com/laurigates/comfyui-model-gallery/issues/3)) ([87f4887](https://github.com/laurigates/comfyui-model-gallery/commit/87f4887c677bfc0f0550f179854d2230b4875c2b))


### Miscellaneous

* **deps:** Bump googleapis/release-please-action from 4 to 5 ([#1](https://github.com/laurigates/comfyui-model-gallery/issues/1)) ([4811f13](https://github.com/laurigates/comfyui-model-gallery/commit/4811f13f317c9546d0de10a683bcbc2c58d33dbc))
* release main ([#2](https://github.com/laurigates/comfyui-model-gallery/issues/2)) ([cda68b5](https://github.com/laurigates/comfyui-model-gallery/commit/cda68b5061caa280cc79de332f53c7ed8d97b16d))
* scaffold comfyui-model-gallery with CI, tooling, and implementation plan ([353130b](https://github.com/laurigates/comfyui-model-gallery/commit/353130b110b122349a0c9b95871d47a101078885))

## [0.1.1](https://github.com/laurigates/comfyui-model-gallery/compare/comfyui-model-gallery-v0.1.0...comfyui-model-gallery-v0.1.1) (2026-05-30)


### Features

* implement v0.1 model gallery picker (modal over native model combos + /list endpoint) ([5aa4fa2](https://github.com/laurigates/comfyui-model-gallery/commit/5aa4fa2154d66c10af814c7f34bd1e2eadc89c4b))


### Miscellaneous

* scaffold comfyui-model-gallery with CI, tooling, and implementation plan ([353130b](https://github.com/laurigates/comfyui-model-gallery/commit/353130b110b122349a0c9b95871d47a101078885))
