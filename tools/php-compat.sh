#!/usr/bin/env sh
# =============================================================================
# 전통발효체험관 메타버스 — PHP 7.2 compatibility lint for server/** (CONTRACT §14.5)
#
#   tools/php-compat.sh            lint server/ against PHPCompatibility, testVersion 7.2- → exit 0 only with 0 errors
#   tools/php-compat.sh --warnings also print warnings (default: errors only)
#
# phpcs + phpcompatibility/php-compatibility are installed with composer into a scratch directory OUTSIDE the repo
# (vendor/ never ships): $TFM_COMPAT_DIR, default $TMPDIR/tfm-php-compat10. The first run installs them (packagist).
#
# PHPCompatibility 10 (10.0.0-alpha2) on purpose: 9.3.5, the last 9.x, predates PHP 8 and — run on a PHP 8 CLI —
# misses the constructs CONTRACT §14.5 bans (arrow functions, typed properties, match, ?->, named arguments, union /
# mixed types, constructor promotion, numeric separators, catch without a variable, enum, str_contains() …). 10.x
# reports every one of them (checked against a probe file with all of them: 21 errors, 9.3.5 found 4).
# --warnings also lists deprecations of later PHP versions that the code already guards by PHP_VERSION_ID (session.sid_length
# ≥ 8.4 in Session.php, curl_close / imagedestroy ≥ 8.0 in Toss.php / Upload.php) — reported, never a failure.
# tests/server-unit.php is developer tooling for PHP 8 and is NOT linted or shipped: it proves nothing about PHP 7.2.
# =============================================================================
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${TFM_COMPAT_DIR:-${TMPDIR:-/tmp}/tfm-php-compat10}"
PHPCS="$DIR/vendor/bin/phpcs"
STD="$DIR/vendor/phpcompatibility/php-compatibility/PHPCompatibility"
MARK="$STD/Sniffs/Classes/NewConstructorPropertyPromotionSniff.php" # only in PHPCompatibility 10+ (9.x lacks the PHP 8 sniffs)
if [ ! -x "$PHPCS" ] || [ ! -f "$MARK" ]; then
  echo "▶ installing phpcs + PHPCompatibility 10.0.0-alpha2 into $DIR (composer, packagist)"
  mkdir -p "$DIR"
  # an alpha release: allow it explicitly, keep every dependency on its stable version
  [ -f "$DIR/composer.json" ] || printf '{"minimum-stability":"dev","prefer-stable":true,"config":{"allow-plugins":{"dealerdirect/phpcodesniffer-composer-installer":true}}}\n' > "$DIR/composer.json"
  (cd "$DIR" && composer require --dev --no-interaction --no-progress --quiet "phpcompatibility/php-compatibility:10.0.0-alpha2")
fi
WARN="-n"
for a in "$@"; do [ "$a" = "--warnings" ] && WARN=""; done
# The lint runs on the current PHP (8.3 in the sandbox); PHPCompatibility reports what would break on PHP < 7.3.
# Every .php under server/ is checked (api, lib, cli, config, install.php, admin.php).
set +e
# warnings (deprecations of later PHP versions; the code guards them by PHP_VERSION_ID) never fail the run
"$PHPCS" $WARN --standard="$STD" --runtime-set testVersion 7.2- --runtime-set ignore_warnings_on_exit 1 --extensions=php --report=full --report-width=160 -p "$ROOT/server/"
CODE=$?
set -e
if [ $CODE -eq 0 ]; then
  echo "✔ php-compat: 0 errors against PHP 7.2 (server/, PHPCompatibility 10)"
else
  echo "✖ php-compat: phpcs exit $CODE — fix the errors above (PHP 7.2 syntax only under server/)"
fi
exit $CODE
