<?php
/**
 * GET api/env/now.php → {t, tz: 'Asia/Seoul', weather: CLEAR|CLOUDY|RAIN|FOG|SNOW, temp, humidity, wind, rain1h,
 *                        source: 'kma'|'model', sunrise, sunset, season, seasonName, term, next: {t, weather, temp},
 *                        cfg: {clock, nightBrightness, basis}}
 * Korea in real time (CONTRACT §17.5): the weather of 정선 for every visitor — the 기상청 초단기실황 / 초단기예보 when the
 * operator set a key (env.kma_key in config.local.php), else the climatology model (the same numbers the app computes in
 * file mode). The answer never waits for the agency: Tfm\Env answers from the shared cache and refreshes it after the
 * answer went out, at most once every 10 minutes for the whole site. cfg = the operator's public env settings
 * (clock default, night brightness, the basis of the real-time beds). No login, no query parameters, no personal data.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Env;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'env_now'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close(); // read-only: release the session lock
    return Env::now($c->now);
});
