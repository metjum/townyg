#!/bin/sh
# Usage: packaging/release.sh 0.2.0
# Bumps the version, tags + publishes a GitHub release, then updates the Homebrew tap formula (url + sha256).
set -e
V="$1"; [ -n "$V" ] || { echo "usage: $0 X.Y.Z"; exit 1; }
cd "$(dirname "$0")/.."
git diff --quiet && git diff --cached --quiet || { echo "commit your changes first"; exit 1; }
sed -i '' -E "s/^VERSION = \".*\"/VERSION = \"$V\"/" townyg/cli.py
sed -i '' -E "s/__version__ = \".*\"/__version__ = \"$V\"/" townyg/__init__.py
sed -i '' -E "s/^version = \".*\"/version = \"$V\"/" pyproject.toml
git commit -qam "Release v$V" && git tag "v$V" && git push -q origin main "v$V"
gh release create "v$V" --generate-notes --title "townyg $V"
SHA=$(curl -sL "https://github.com/metjum/townyg/archive/refs/tags/v$V.tar.gz" | shasum -a 256 | cut -d' ' -f1)
TAP=$(mktemp -d); gh repo clone metjum/homebrew-townyg "$TAP" -- -q
F="$TAP/Formula/townyg.rb"
sed -i '' -E "s#(url \").*(\")#\1https://github.com/metjum/townyg/archive/refs/tags/v$V.tar.gz\2#; s/sha256 \".*\"/sha256 \"$SHA\"/" "$F"
cp "$F" packaging/homebrew-townyg/Formula/townyg.rb
(cd "$TAP" && git commit -qam "townyg $V" && git push -q)
git commit -qam "Update formula to $V" && git push -q
echo "Released $V. Users: brew upgrade townyg (or: townyg update)"
