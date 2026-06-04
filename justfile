# comfyui-model-gallery — task runner. Run `just` (or `just --list`) for recipes.

set positional-arguments

# Show available recipes.
default:
    @just --list

##########
# Quality
##########

# Lint Python + JS/JSON (no changes).
[group: "quality"]
lint:
    uv run ruff check .
    npx @biomejs/biome check .

# Auto-format Python + JS/JSON.
[group: "quality"]
format:
    uv run ruff format .
    uv run ruff check --fix .
    npx @biomejs/biome check --write .

# Run the full test suite (pytest + Vitest) — the local CI gate.
[group: "quality"]
test:
    uv run pytest -v
    npm test

# Lint + test in one shot.
[group: "quality"]
check: lint test

##########
# Documentation artifacts
##########

# Regenerate docs/picker.png via the containerized screenshot generator.
[group: "docs"]
screenshots:
    docker build -f screenshots/Dockerfile -t comfyui-model-gallery-screenshots .
    docker run --rm -v "$(pwd)/docs:/out" comfyui-model-gallery-screenshots
