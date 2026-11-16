#!/usr/bin/env bash
# Builds the release packages from the committed tree (HEAD) into ./dist
#
#   .github/scripts/package.sh                    PUBGScoreboard-<version>.zip
#   .github/scripts/package.sh --php-dir <dir>    ...plus the Windows portable package,
#                                                 bundling php.exe + php*.dll from <dir>
#
# Only needs git: `git archive` writes the zips, applies the export-ignore rules
# from .gitattributes and gives the .bat launchers their CRLF line endings.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

php_dir=""
while [ $# -gt 0 ]; do
    case "$1" in
        --php-dir) php_dir="${2:?--php-dir needs a folder}"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

# Single source of truth for the version: about.json ("_VERSION": "v2.0.0")
version="$(sed -n 's/.*"_VERSION"[^"]*"v\{0,1\}\([0-9][0-9.]*\)".*/\1/p' about.json)"
if [ -z "$version" ]; then
    echo "Could not read _VERSION from about.json" >&2
    exit 1
fi

name="PUBGScoreboard-$version"
rm -rf dist
mkdir -p dist

# 1) Universal package: run with your own PHP 7.4+ (php server.php) or drop into Apache/XAMPP.
git archive --format=zip -9 --prefix=PUBGScoreboard/ -o "dist/$name.zip" HEAD
echo "built dist/$name.zip"

# 2) Windows portable package: unzip, double-click Start.bat. Nothing to install.
if [ -n "$php_dir" ]; then
    [ -f "$php_dir/php.exe" ] || { echo "No php.exe in $php_dir" >&2; exit 1; }

    runtime=()
    # The CLI binary and its core DLL are all the server needs: no php.ini, no extensions.
    for file in "$php_dir"/php.exe "$php_dir"/php[0-9]*.dll "$php_dir"/license.txt "$php_dir"/readme-redist-bins.txt; do
        case "$file" in *phpdbg*|*embed*) continue ;; esac
        [ -f "$file" ] && runtime+=("--add-file=$file")
    done

    # --add-file places each file under the --prefix given just before it.
    git archive --format=zip -9 \
        --prefix=PUBGScoreboard/runtime/php/ "${runtime[@]}" \
        --prefix=PUBGScoreboard/ \
        -o "dist/$name-windows-portable.zip" HEAD
    echo "built dist/$name-windows-portable.zip"
fi

(cd dist && sha256sum -- *.zip > SHA256SUMS.txt)
echo
cat dist/SHA256SUMS.txt
