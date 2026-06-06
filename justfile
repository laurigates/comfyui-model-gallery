# comfyui-model-gallery — task runner. Run `just` (or `just --list`) for recipes.

set positional-arguments

# Show available recipes.
default:
    @just --list

##########
# Quality
##########

# Lint Python + TS/JSON (no changes).
[group: "quality"]
lint:
    uv run ruff check .
    bunx biome check .

# Auto-format Python + TS/JSON.
[group: "quality"]
format:
    uv run ruff format .
    uv run ruff check --fix .
    bunx biome check --write .

# Typecheck the TypeScript source (tsc --noEmit).
[group: "quality"]
typecheck:
    bun run typecheck

# Compile src/ -> web/dist/ via bun build (+ copy corpus).
[group: "quality"]
build:
    bun run build

# Dead-code / unused-dependency check.
[group: "quality"]
knip:
    bun run knip

# Run the full test suite (pytest + Vitest) — part of the local CI gate.
[group: "quality"]
test:
    uv run pytest -v
    bun run test

# Lint + typecheck + build + knip + test in one shot — the local CI gate.
[group: "quality"]
check: lint typecheck build knip test

##########
# Documentation artifacts
##########

# Regenerate docs/picker.png via the containerized screenshot generator.
[group: "docs"]
screenshots:
    docker build -f screenshots/Dockerfile -t comfyui-model-gallery-screenshots .
    docker run --rm -v "$(pwd)/docs:/out" comfyui-model-gallery-screenshots
