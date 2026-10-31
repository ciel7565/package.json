#!/usr/bin/env sh
# =============================================================================
# 전통발효체험관 메타버스 — PHP 7.2 compatibility lint for server/** (CONTRACT §14.5)
#
#   tools/php-compat.sh            lint server/ against PHPCompatibility, testVersion 7.2- → exit 0 only with 0 errors
#   tools/php-compat.sh --warnings also print warnings (default: errors only)
#
# phpcs + phpcompatibility/php-compatibility are installed with composer into a scratch directory OUTSIDE the repo
# (vendor/ never ships): $TFM_COMPAT_DIR, default $TMPDIR/tfm-php-compat. The first run installs them (packagist).
# =============================================================================
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${TFM_COMPAT_DIR:-${TMPDIR:-/tmp}/tfm-php-compat}"
PHPCS="$DIR/vendor/bin/phpcs"
STD="$DIR/vendor/phpcompatibility/php-compatibility/PHPCompatibility"
if [ ! -x "$PHPCS" ] || [ ! -d "$STD" ]; then
  echo "▶ installing phpcs + PHPCompatibility into $DIR (composer, packagist)"
  mkdir -p "$DIR"
  (cd "$DIR" && composer require --dev --no-interaction --no-progress --quiet squizlabs/php_codesniffer:^3.13 phpcompatibility/php-compatibility:^9.3)
fi
WARN="-n"
for a in "$@"; do [ "$a" = "--warnings" ] && WARN=""; done
# The lint runs on the current PHP (8.3 in the sandbox); PHPCompatibility reports what would break on PHP < 7.3.
# Every .php under server/ is checked (api, lib, cli, config, install.php, admin.php).
set +e
"$PHPCS" $WARN --standard="$STD" --runtime-set testVersion 7.2- --extensions=php --report=full --report-width=160 -p "$ROOT/server/"
CODE=$?
set -e
if [ $CODE -eq 0 ]; then
  echo "✔ php-compat: 0 errors against PHP 7.2 (server/)"
else
  echo "✖ php-compat: phpcs exit $CODE — fix the errors above (PHP 7.2 syntax only under server/)"
fi
exit $CODE
