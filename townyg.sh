#!/bin/sh
# dev launcher: run from a checkout without installing
cd "$(dirname "$0")" && exec .venv/bin/python -m townyg "$@"
