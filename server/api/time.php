<?php
/** GET api/time.php — authoritative server clock (ms) for growth / fermentation timers. */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\{Api, Clock, Ctx};

Api::run(['method' => 'GET', 'rate' => 'time'], function (Ctx $c): array {
    $ms = Clock::ms();
    return ['serverTime' => $ms, 'iso' => date('c', intdiv($ms, 1000)), 'timezone' => date_default_timezone_get(), 'day' => Clock::day($ms)];
});
