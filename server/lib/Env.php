<?php
/**
 * Tfm\Env — Korea in real time (CONTRACT §17.5): the wall clock of Asia/Seoul, the sun and the moon by astronomy for
 * 정선 (37.38° N, 128.66° E), the season and the 24 절기, today's weather and the Korean crop calendar.
 *
 *   Env::now(?ms)                 the answer of api/env/now.php: {t, tz, weather, temp, humidity, wind, rain1h, source,
 *                                 sunrise, sunset, season, seasonName, term, next, cfg}. Never waits for the network:
 *                                 a 기상청 value older than 10 minutes is answered as it is and refreshed after the
 *                                 answer went out (Api::after); with no value yet the model answers.
 *   Env::provider()               'kma' (a key is set and env.weather_source is not 'model') | 'model'
 *   Env::refreshKma(?ms)          one fetch from the 기상청 (two calls, 3 s each), stored in the shared cache for
 *                                 10 minutes; a failure backs off for 2 minutes and keeps the last good value (≤ 3 h)
 *   Env::weatherFor(ms)           the real weather at a moment for the farm (cache or model — NEVER the network)
 *   Env::modelAt(ms) / modelSnap(ms)   the climatology of 정선 with a day seed — bit for bit the same as the client's
 *                                 (src/game/77-env.js core; tests/env-client.mjs compares a year of hours)
 *   Env::kst / sunPos / sunTimes / moon / season / kmaGrid   the pure helpers
 *   Env::cal(cropId) / cropFactor(cal, ms, weather) / bedMs(opts) / basis()   the crop calendar and the real-time beds
 *
 * Provider 'kma' — 기상청 단기예보 조회서비스 (data.go.kr, VilageFcstInfoService_2.0): getUltraSrtNcst (초단기실황:
 * T1H, REH, WSD, RN1, PTY) + getUltraSrtFcst (초단기예보: SKY, PTY, T1H of the next hours) for the grid cell of the site
 * (Lambert conformal conic of the agency). The key (env.kma_key) lives only in config.local.php / the environment
 * (TFM_KMA_KEY); it is never logged, never cached, never sent to a browser. The base address is the config value
 * env.kma_base (https only; http only for a stub on 127.0.0.1 / localhost). Outbound calls come from here only.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Env
{
    public const LAT = 37.38;
    public const LON = 128.66;
    public const IDS = ['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'SNOW'];
    private const KST_MS = 32400000;
    private const DAY_MS = 86400000;
    private const CACHE_KEY = 'env:kma:v1';
    private const FAIL_KEY = 'env:kma:fail';
    private const FRESH_S = 600;          // a 기상청 value is fresh for 10 minutes
    private const KEEP_S = 10800;         // and usable (stale) for 3 hours
    private const BACKOFF_S = 120;        // after a failure, wait 2 minutes before the next try
    private const TIMEOUT_S = 3;
    public const DEFAULT_BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

    private const NORM_MAX = [2, 5, 11, 19, 24, 27, 29, 29, 25, 19, 11, 4];
    private const NORM_MIN = [-11, -8, -3, 3, 9, 15, 20, 20, 14, 6, -1, -8];
    private const NORM_WET = [4, 4, 7, 8, 9, 10, 15, 14, 9, 6, 7, 5];
    private const NORM_HUM = [62, 60, 58, 55, 62, 72, 80, 80, 76, 70, 66, 64];
    private const NORM_FOG = [0.08, 0.08, 0.1, 0.12, 0.14, 0.18, 0.2, 0.22, 0.32, 0.36, 0.3, 0.12];
    private const TERMS = ['춘분', '청명', '곡우', '입하', '소만', '망종', '하지', '소서', '대서', '입추', '처서', '백로',
        '추분', '한로', '상강', '입동', '소설', '대설', '동지', '소한', '대한', '입춘', '우수', '경칩'];
    private const SEASON_NAMES = ['spring' => '봄', 'summer' => '여름', 'autumn' => '가을', 'winter' => '겨울'];
    private const WEATHER_K = ['CLEAR' => 1.05, 'CLOUDY' => 1.0, 'RAIN' => 1.0, 'FOG' => 0.97, 'SNOW' => 0.92];

    /** @var callable|null tests: function (string $url): array [status, body, errno] instead of curl */
    public static $transport = null;
    /** @var int the number of outbound calls this request made (tests) */
    public static $calls = 0;
    /** @var array|null tests: the crop calendar to use instead of game-data.json's (id → {sow, harvest, days}) */
    public static $calendar = null;

    // ------------------------------------------------------------------ small helpers (the client's rounding)
    /** Math.round of JavaScript: half rounds up (towards +∞) */
    private static function jround(float $v): float { return floor($v + 0.5); }
    private static function round1(float $v): float { return floor($v * 10 + 0.5) / 10; }
    private static function norm360(float $x): float { $x = fmod($x, 360.0); return $x < 0 ? $x + 360.0 : $x; }

    // ------------------------------------------------------------------ KST calendar
    /** @return array{y:int,mo:int,d:int,h:int,mi:int,s:int,dow:int,doy:int,hour:float,key:int} */
    public static function kst(int $ms): array
    {
        $t = (int) floor(($ms + self::KST_MS) / 1000);
        $p = explode(' ', gmdate('Y n j G i s w z', $t));
        $y = (int) $p[0]; $mo = (int) $p[1]; $d = (int) $p[2]; $h = (int) $p[3]; $mi = (int) $p[4]; $s = (int) $p[5];
        return ['y' => $y, 'mo' => $mo, 'd' => $d, 'h' => $h, 'mi' => $mi, 's' => $s, 'dow' => (int) $p[6], 'doy' => (int) $p[7] + 1,
            'hour' => $h + $mi / 60 + $s / 3600, 'key' => $y * 10000 + $mo * 100 + $d];
    }
    /** ms of 00:00 KST of the day of $ms */
    public static function kstMidnight(int $ms): int { return (int) (floor(($ms + self::KST_MS) / self::DAY_MS) * self::DAY_MS) - self::KST_MS; }
    public static function daysInMonth(int $y, int $mo): int { return (int) gmdate('t', gmmktime(0, 0, 0, $mo, 1, $y)); }

    // ------------------------------------------------------------------ astronomy (NOAA solar position; low-precision moon)
    private static function julian(float $ms): float { return $ms / self::DAY_MS + 2440587.5; }

    /** @return array{decl:float, eot:float, lambda:float, eps:float} */
    public static function solar(float $ms): array
    {
        $R = M_PI / 180; $D = 180 / M_PI;
        $T = (self::julian($ms) - 2451545) / 36525;
        $L0 = self::norm360(280.46646 + $T * (36000.76983 + $T * 0.0003032));
        $M = 357.52911 + $T * (35999.05029 - 0.0001537 * $T);
        $e = 0.016708634 - $T * (0.000042037 + 0.0000001267 * $T);
        $Mr = $M * $R;
        $C = sin($Mr) * (1.914602 - $T * (0.004817 + 0.000014 * $T)) + sin(2 * $Mr) * (0.019993 - 0.000101 * $T) + sin(3 * $Mr) * 0.000289;
        $omega = 125.04 - 1934.136 * $T;
        $lambda = $L0 + $C - 0.00569 - 0.00478 * sin($omega * $R);
        $eps0 = 23 + (26 + (21.448 - $T * (46.815 + $T * (0.00059 - $T * 0.001813))) / 60) / 60;
        $eps = $eps0 + 0.00256 * cos($omega * $R);
        $decl = asin(sin($eps * $R) * sin($lambda * $R)) * $D;
        $yv = pow(tan(($eps / 2) * $R), 2);
        $L0r = $L0 * $R;
        $eot = 4 * $D * ($yv * sin(2 * $L0r) - 2 * $e * sin($Mr) + 4 * $e * $yv * sin($Mr) * cos(2 * $L0r)
            - 0.5 * $yv * $yv * sin(4 * $L0r) - 1.25 * $e * $e * sin(2 * $Mr));
        return ['decl' => $decl, 'eot' => $eot, 'lambda' => self::norm360($lambda), 'eps' => $eps];
    }

    /** sun elevation (deg, refraction corrected) and azimuth (deg from north, clockwise) */
    public static function sunPos(int $ms, float $lat = self::LAT, float $lon = self::LON): array
    {
        $R = M_PI / 180; $D = 180 / M_PI;
        $s = self::solar($ms);
        $utcMin = fmod(fmod((float) $ms, (float) self::DAY_MS) + self::DAY_MS, (float) self::DAY_MS) / 60000;
        $tst = fmod($utcMin + $s['eot'] + 4 * $lon, 1440.0); if ($tst < 0) $tst += 1440;
        $ha = $tst / 4 - 180; if ($ha < -180) $ha += 360;
        $latR = $lat * $R; $dR = $s['decl'] * $R; $haR = $ha * $R;
        $cz = max(-1.0, min(1.0, sin($latR) * sin($dR) + cos($latR) * cos($dR) * cos($haR)));
        $zen = acos($cz) * $D;
        $elev0 = 90 - $zen;
        $den = cos($latR) * sin($zen * $R);
        if (abs($den) > 1e-6) {
            $ca = max(-1.0, min(1.0, (sin($latR) * $cz - sin($dR)) / $den));
            $az = $ha > 0 ? self::norm360(acos($ca) * $D + 180) : self::norm360(540 - acos($ca) * $D);
        } else $az = $lat > 0 ? 180.0 : 0.0;
        $ref = 0.0;
        if ($elev0 <= 85) {
            $te = tan($elev0 * $R);
            if ($elev0 > 5) $ref = 58.1 / $te - 0.07 / ($te * $te * $te) + 0.000086 / pow($te, 5);
            elseif ($elev0 > -0.575) $ref = 1735 + $elev0 * (-518.2 + $elev0 * (103.4 + $elev0 * (-12.79 + $elev0 * 0.711)));
            else $ref = -20.774 / $te;
            $ref /= 3600;
        }
        return ['elev' => $elev0 + $ref, 'az' => $az];
    }

    /** sunrise / sunset / solar noon (ms) of the KST day of $ms; rise / set null on a day without them */
    public static function sunTimes(int $ms, float $lat = self::LAT, float $lon = self::LON): array
    {
        $R = M_PI / 180; $D = 180 / M_PI;
        $mid = self::kstMidnight($ms);
        $dayUtc = (int) (floor(($mid + 12 * 3600000) / self::DAY_MS) * self::DAY_MS);
        $at = function (float $guess, bool $rising) use ($mid, $dayUtc, $lat, $lon, $R, $D) {
            $t = $guess;
            for ($i = 0; $i < 3; $i++) {
                $s = self::solar($t);
                $latR = $lat * $R; $dR = $s['decl'] * $R;
                $x = cos(90.833 * $R) / (cos($latR) * cos($dR)) - tan($latR) * tan($dR);
                if ($x > 1 || $x < -1) return null;
                $ha = acos($x) * $D;
                $utcMin = 720 - 4 * ($lon + ($rising ? $ha : -$ha)) - $s['eot'];
                $t = $dayUtc + $utcMin * 60000;
                if ($t < $mid) $t += self::DAY_MS; elseif ($t >= $mid + self::DAY_MS) $t -= self::DAY_MS;
            }
            return (int) self::jround($t);
        };
        $s = self::solar($mid + 12.5 * 3600000);
        $noon = $dayUtc + (720 - 4 * $lon - $s['eot']) * 60000;
        if ($noon < $mid) $noon += self::DAY_MS;
        return ['rise' => $at($mid + 6 * 3600000, true), 'set' => $at($mid + 18 * 3600000, false), 'noon' => (int) self::jround($noon)];
    }

    /** the moon at 정선: elevation / azimuth (deg), illumination 0..1, waxing */
    public static function moon(int $ms, float $lat = self::LAT, float $lon = self::LON): array
    {
        $R = M_PI / 180; $Dg = 180 / M_PI;
        $d = self::julian($ms) - 2451543.5;
        $N = 125.1228 - 0.0529538083 * $d; $i = 5.1454; $w = 318.0634 + 0.1643573223 * $d;
        $a = 60.2666; $e = 0.0549; $M = self::norm360(115.3654 + 13.0649929509 * $d);
        $Mr = $M * $R;
        $E = $M + $Dg * $e * sin($Mr) * (1 + $e * cos($Mr));
        for ($k = 0; $k < 3; $k++) $E = $E - ($E - $Dg * $e * sin($E * $R) - $M) / (1 - $e * cos($E * $R));
        $Er = $E * $R;
        $xv = $a * (cos($Er) - $e); $yv = $a * sqrt(1 - $e * $e) * sin($Er);
        $v = atan2($yv, $xv) * $Dg; $r = sqrt($xv * $xv + $yv * $yv);
        $Nr = $N * $R; $ir = $i * $R; $vw = ($v + $w) * $R;
        $xh = $r * (cos($Nr) * cos($vw) - sin($Nr) * sin($vw) * cos($ir));
        $yh = $r * (sin($Nr) * cos($vw) + cos($Nr) * sin($vw) * cos($ir));
        $zh = $r * sin($vw) * sin($ir);
        $lonE = self::norm360(atan2($yh, $xh) * $Dg);
        $latE = atan2($zh, sqrt($xh * $xh + $yh * $yh)) * $Dg;
        $Ms = self::norm360(356.047 + 0.9856002585 * $d); $ws = 282.9404 + 4.70935e-5 * $d;
        $Ls = self::norm360($Ms + $ws); $Lm = self::norm360($M + $w + $N); $Dm = self::norm360($Lm - $Ls); $F = self::norm360($Lm - $N);
        $sr = function ($x) use ($R) { return sin($x * $R); };
        $lonE += -1.274 * $sr($M - 2 * $Dm) + 0.658 * $sr(2 * $Dm) - 0.186 * $sr($Ms) - 0.059 * $sr(2 * $M - 2 * $Dm) - 0.057 * $sr($M - 2 * $Dm + $Ms)
            + 0.053 * $sr($M + 2 * $Dm) + 0.046 * $sr(2 * $Dm - $Ms) + 0.041 * $sr($M - $Ms) - 0.035 * $sr($Dm) - 0.031 * $sr($M + $Ms) - 0.015 * $sr(2 * $F - 2 * $Dm) + 0.011 * $sr($M - 4 * $Dm);
        $latE += -0.173 * $sr($F - 2 * $Dm) - 0.055 * $sr($M - $F - 2 * $Dm) - 0.046 * $sr($M + $F - 2 * $Dm) + 0.033 * $sr($F + 2 * $Dm) + 0.017 * $sr(2 * $M + $F);
        $lonE = self::norm360($lonE);
        $ecl = (23.4393 - 3.563e-7 * $d) * $R;
        $lr = $lonE * $R; $br = $latE * $R;
        $xe = cos($lr) * cos($br);
        $ye = sin($lr) * cos($br) * cos($ecl) - sin($br) * sin($ecl);
        $ze = sin($lr) * cos($br) * sin($ecl) + sin($br) * cos($ecl);
        $ra = atan2($ye, $xe) * $Dg; $dec = atan2($ze, sqrt($xe * $xe + $ye * $ye)) * $Dg;
        $jd = self::julian($ms);
        $T = ($jd - 2451545) / 36525;
        $gmst = self::norm360(280.46061837 + 360.98564736629 * ($jd - 2451545) + $T * $T * 0.000387933);
        $ha = self::norm360($gmst + $lon - $ra);
        $latR = $lat * $R; $decR = $dec * $R; $haR = $ha * $R;
        $alt = asin(max(-1.0, min(1.0, sin($latR) * sin($decR) + cos($latR) * cos($decR) * cos($haR)))) * $Dg;
        $alt -= 0.95 * cos($alt * $R);
        $az = self::norm360(atan2(sin($haR), cos($haR) * sin($latR) - tan($decR) * cos($latR)) * $Dg + 180);
        $sl = self::solar($ms)['lambda'];
        $elong = acos(max(-1.0, min(1.0, cos(($lonE - $sl) * $R) * cos($latE * $R)))) * $Dg;
        return ['elev' => $alt, 'az' => $az, 'illum' => (1 - cos($elong * $R)) / 2, 'waxing' => self::norm360($lonE - $sl) < 180, 'elong' => $elong];
    }

    /** @return array{id:string, name:string, term:string, termIdx:int, month:int} */
    public static function season(int $ms): array
    {
        $mo = self::kst($ms)['mo'];
        $id = $mo >= 3 && $mo <= 5 ? 'spring' : ($mo >= 6 && $mo <= 8 ? 'summer' : ($mo >= 9 && $mo <= 11 ? 'autumn' : 'winter'));
        $ti = ((int) floor(self::solar($ms)['lambda'] / 15)) % 24;
        return ['id' => $id, 'name' => self::SEASON_NAMES[$id], 'term' => self::TERMS[$ti], 'termIdx' => $ti, 'month' => $mo];
    }

    // ------------------------------------------------------------------ 기상청 grid (DFS Lambert conformal conic, 5 km)
    /** @return array{nx:int, ny:int} */
    public static function kmaGrid(float $lat, float $lon): array
    {
        $R = M_PI / 180;
        $re = 6371.00877 / 5.0; $slat1 = 30.0 * $R; $slat2 = 60.0 * $R; $olon = 126.0 * $R; $olat = 38.0 * $R;
        $sn = tan(M_PI * 0.25 + $slat2 * 0.5) / tan(M_PI * 0.25 + $slat1 * 0.5);
        $sn = log(cos($slat1) / cos($slat2)) / log($sn);
        $sf = tan(M_PI * 0.25 + $slat1 * 0.5);
        $sf = pow($sf, $sn) * cos($slat1) / $sn;
        $ro = tan(M_PI * 0.25 + $olat * 0.5);
        $ro = $re * $sf / pow($ro, $sn);
        $ra = tan(M_PI * 0.25 + $lat * $R * 0.5);
        $ra = $re * $sf / pow($ra, $sn);
        $theta = $lon * $R - $olon;
        if ($theta > M_PI) $theta -= 2 * M_PI;
        if ($theta < -M_PI) $theta += 2 * M_PI;
        $theta *= $sn;
        return ['nx' => (int) floor($ra * sin($theta) + 43 + 0.5), 'ny' => (int) floor($ro - $ra * cos($theta) + 136 + 0.5)];
    }

    // ------------------------------------------------------------------ the weather model of 정선 (= 77-env.js core)
    /** Math.imul(a, b) >>> 0 */
    public static function imul(int $a, int $b): int
    {
        $a &= 0xFFFFFFFF; $b &= 0xFFFFFFFF;
        return (($a & 0xFFFF) * $b + (((($a >> 16) * $b) & 0xFFFF) << 16)) & 0xFFFFFFFF;
    }
    public static function mix32(int $h): int
    {
        $h &= 0xFFFFFFFF;
        $h = ($h ^ ($h >> 16)); $h = self::imul($h, 0x7feb352d);
        $h = ($h ^ ($h >> 15)); $h = self::imul($h, 0x846ca68b);
        $h = ($h ^ ($h >> 16));
        return $h & 0xFFFFFFFF;
    }
    public static function r01(int $day, int $k): float { return self::mix32(self::imul($day, 0x27d4eb2d) ^ self::imul($k + 1, 0x165667b1)) / 4294967296; }
    private static function wetRaw(int $day, int $mo, int $dim): bool { return self::r01($day, 1) < self::NORM_WET[$mo - 1] / $dim; }

    public static function dayPlan(int $ms): array
    {
        $k = self::kst($ms); $mo = $k['mo']; $day = $k['key'];
        $dim = self::daysInMonth($k['y'], $mo);
        $kp = self::kst(self::kstMidnight($ms) - 1000);
        $prevWet = self::wetRaw($kp['key'], $kp['mo'], self::daysInMonth($kp['y'], $kp['mo']));
        $wet = self::wetRaw($day, $mo, $dim) || ($prevWet && self::r01($day, 2) < 0.3);
        $start = (int) floor(self::r01($day, 3) * 24);
        $len = 3 + (int) floor(self::r01($day, 4) * 10);
        $f = ($k['d'] - 15.5) / $dim;
        $mo2 = $f >= 0 ? ($mo % 12) + 1 : (($mo + 10) % 12) + 1;
        $g = $f >= 0 ? $f : -$f;
        $tmaxN = self::NORM_MAX[$mo - 1] + (self::NORM_MAX[$mo2 - 1] - self::NORM_MAX[$mo - 1]) * $g;
        $tminN = self::NORM_MIN[$mo - 1] + (self::NORM_MIN[$mo2 - 1] - self::NORM_MIN[$mo - 1]) * $g;
        $tmax = $tmaxN + (self::r01($day, 9) - 0.5) * 6 - ($wet ? 2.5 : 0);
        $tmin = $tminN + (self::r01($day, 10) - 0.5) * 5 + ($wet ? 1.5 : 0);
        $fogP = self::NORM_FOG[$mo - 1] + ($prevWet ? 0.25 : 0);
        return ['day' => $day, 'mo' => $mo, 'wet' => $wet, 'start' => $start, 'len' => $len, 'tmax' => $tmax, 'tmin' => $tmin,
            'cloud' => self::r01($day, 6), 'fog' => !$wet && self::r01($day, 7) < $fogP, 'fogEnd' => 7.5 + self::r01($day, 8) * 2.5,
            'hum' => self::NORM_HUM[$mo - 1], 'windB' => 1.2 + self::r01($day, 11) * 2.2, 'rainB' => 0.5 + self::r01($day, 12) * 4];
    }
    private static function sstep(float $a, float $b, float $x): float { $t = ($x - $a) / ($b - $a); $t = $t < 0 ? 0.0 : ($t > 1 ? 1.0 : $t); return $t * $t * (3 - 2 * $t); }
    public static function diurnal(float $h): float
    {
        if ($h >= 6 && $h <= 15) return self::sstep(6, 15, $h);
        $x = $h > 15 ? $h - 15 : $h + 9;
        return 1 - self::sstep(0, 15, $x);
    }
    /** @return array{weather:string, temp:float, humidity:int, wind:float, rain1h:float} */
    public static function modelAt(int $ms): array
    {
        $p = self::dayPlan($ms); $k = self::kst($ms); $h = $k['h'] + $k['mi'] / 60;
        $inWet = $p['wet'] && $h >= $p['start'] && $h < $p['start'] + $p['len'];
        $nearWet = $p['wet'] && $h >= $p['start'] - 3 && $h < $p['start'] + $p['len'] + 3;
        $temp = $p['tmin'] + ($p['tmax'] - $p['tmin']) * self::diurnal($h);
        if ($inWet) $wx = $temp <= 1 ? 'SNOW' : 'RAIN';
        elseif ($p['fog'] && $h >= 4 && $h < $p['fogEnd']) $wx = 'FOG';
        elseif ($nearWet) $wx = 'CLOUDY';
        elseif ($p['cloud'] < 0.45) $wx = 'CLEAR';
        elseif ($p['cloud'] < 0.8) $wx = ($h >= 12 && $h < 18) ? 'CLOUDY' : 'CLEAR';
        else $wx = 'CLOUDY';
        $hum = $p['hum'] + ($p['tmax'] - $temp) * 2.2 - 6 + ($inWet ? 22 : ($nearWet ? 10 : 0)) + ($wx === 'CLOUDY' ? 6 : 0);
        if ($wx === 'FOG') $hum = 98;
        $hum = (int) self::jround($hum < 20 ? 20.0 : ($hum > 100 ? 100.0 : (float) $hum));
        $wind = self::round1($p['windB'] + (($h >= 12 && $h < 18) ? 0.8 : 0) + ($inWet ? 1.0 : 0) + ($wx === 'FOG' ? -0.8 : 0));
        $rain = $inWet ? self::round1($wx === 'SNOW' ? $p['rainB'] * 0.4 : $p['rainB']) : 0.0;
        return ['weather' => $wx, 'temp' => self::round1($temp), 'humidity' => $hum, 'wind' => $wind < 0.2 ? 0.2 : $wind, 'rain1h' => $rain];
    }
    public static function modelSnap(int $ms): array
    {
        $m = self::modelAt($ms); $st = self::sunTimes($ms); $se = self::season($ms); $nx = self::modelAt($ms + 3600000);
        return ['t' => $ms, 'tz' => 'Asia/Seoul', 'weather' => $m['weather'], 'temp' => $m['temp'], 'humidity' => $m['humidity'], 'wind' => $m['wind'],
            'rain1h' => $m['rain1h'], 'source' => 'model', 'sunrise' => $st['rise'], 'sunset' => $st['set'], 'season' => $se['id'],
            'seasonName' => $se['name'], 'term' => $se['term'], 'next' => ['t' => $ms + 3600000, 'weather' => $nx['weather'], 'temp' => $nx['temp']]];
    }

    // ------------------------------------------------------------------ settings
    private static function setting(string $key, $default)
    {
        try { return class_exists('Tfm\Settings') ? Settings::get($key, $default) : Config::get($key, $default); }
        catch (\Throwable $e) { return Config::get($key, $default); }
    }
    /** 'calendar' (real days of the crop calendar) | 'short' (the phase-7 minutes) */
    public static function basis(): string { $v = self::setting('farm.rt_basis', 'calendar'); return $v === 'short' ? 'short' : 'calendar'; }
    public static function clockDefault(): string { $v = self::setting('env.clock_default', 'kst'); return in_array($v, ['kst', 'fast', 'fixed'], true) ? (string) $v : 'kst'; }
    public static function nightBrightness(): float
    {
        $v = self::setting('env.night_brightness', 1.25);
        $f = is_numeric($v) ? (float) $v : 1.25;
        return is_finite($f) && $f >= 0.6 && $f <= 1.6 ? round($f, 3) : 1.25;
    }
    private static function key(): string
    {
        $k = Config::get('env.kma_key', '');
        return is_string($k) ? trim($k) : '';
    }
    /** 'kma' when a key is set and the operator did not choose the model; else 'model' */
    public static function provider(): string
    {
        $src = self::setting('env.weather_source', 'auto');
        if ($src === 'model') return 'model';
        return self::key() !== '' ? 'kma' : 'model';
    }
    /** the configured base address, or '' when it is not acceptable (https; http only to this machine for a stub) */
    public static function base(): string
    {
        $b = Config::get('env.kma_base', self::DEFAULT_BASE);
        if (!is_string($b)) return '';
        $b = rtrim(trim($b), '/');
        $u = parse_url($b);
        if (!is_array($u) || !isset($u['scheme'], $u['host'])) return '';
        if ($u['scheme'] === 'https') return $b;
        if ($u['scheme'] === 'http' && in_array(strtolower($u['host']), ['127.0.0.1', 'localhost'], true)) return $b;
        return '';
    }

    // ------------------------------------------------------------------ the public answer
    public static function now(?int $ms = null): array
    {
        $ms = $ms === null ? Clock::ms() : $ms;
        $snap = null;
        if (self::provider() === 'kma') {
            $c = Cache::get(self::CACHE_KEY);
            $ok = is_array($c) && isset($c['at'], $c['snap']) && is_array($c['snap']);
            $age = $ok ? (int) floor(($ms - (int) $c['at']) / 1000) : PHP_INT_MAX;
            if ($ok && $age <= self::KEEP_S) $snap = self::rebase($c['snap'], $ms);
            if ($age > self::FRESH_S && !self::backingOff($ms)) {
                // the visitor never waits for the agency: the refresh runs after this answer went out
                if (class_exists('Tfm\Api') && method_exists('Tfm\Api', 'after') && PHP_SAPI !== 'cli') Api::after(function () { Env::refreshKma(); });
                elseif (PHP_SAPI === 'cli' && $snap === null && self::refreshKma($ms)) {
                    // the command line (tests, cli tools) has no "after the answer": it fetches now, and only uses a new value
                    $c = Cache::get(self::CACHE_KEY);
                    if (is_array($c) && isset($c['at'], $c['snap']) && is_array($c['snap']) && (int) $c['at'] === $ms) $snap = self::rebase($c['snap'], $ms);
                }
            }
        }
        if ($snap === null) $snap = self::modelSnap($ms);
        $snap['cfg'] = ['clock' => self::clockDefault(), 'nightBrightness' => self::nightBrightness(), 'basis' => self::basis()];
        return $snap;
    }
    /** a cached 기상청 snapshot with this moment's time, sun and season */
    private static function rebase(array $s, int $ms): array
    {
        $st = self::sunTimes($ms); $se = self::season($ms);
        $s['t'] = $ms; $s['sunrise'] = $st['rise']; $s['sunset'] = $st['set']; $s['season'] = $se['id']; $s['seasonName'] = $se['name']; $s['term'] = $se['term'];
        return $s;
    }
    private static function backingOff(int $ms): bool { $f = Cache::get(self::FAIL_KEY); return is_int($f) && $f > $ms; }

    /** the real weather at $ms for the farm's growth factor: a fresh-enough 기상청 value, else the model. No network. */
    public static function weatherFor(int $ms): string
    {
        if (self::provider() === 'kma') {
            $c = Cache::get(self::CACHE_KEY);
            if (is_array($c) && isset($c['at'], $c['snap']['weather']) && abs($ms - (int) $c['at']) <= 30 * 60000 && in_array($c['snap']['weather'], self::IDS, true)) return (string) $c['snap']['weather'];
        }
        return self::modelAt($ms)['weather'];
    }

    // ------------------------------------------------------------------ provider 'kma'
    /** base_date / base_time of the latest published 초단기실황 (HH00, out at about HH:40) and 초단기예보 (HH30, about HH:45) */
    public static function baseTimes(int $ms): array
    {
        $n = $ms - 40 * 60000; $k = self::kst($n);
        $f = $ms - 45 * 60000; $kf = self::kst($f);
        return [
            'ncst' => [sprintf('%04d%02d%02d', $k['y'], $k['mo'], $k['d']), sprintf('%02d00', $k['h'])],
            'fcst' => [sprintf('%04d%02d%02d', $kf['y'], $kf['mo'], $kf['d']), sprintf('%02d30', $kf['h'])],
        ];
    }

    /** one refresh from the agency; true when a new value is stored. Holds a lock so only one request fetches. */
    public static function refreshKma(?int $ms = null): bool
    {
        $ms = $ms === null ? Clock::ms() : $ms;
        if (self::provider() !== 'kma') return false;
        if (!Cache::lock('env:kma', 15, 0)) return false;
        try {
            $snap = self::fetchKma($ms);
            if ($snap === null) {
                Cache::set(self::FAIL_KEY, $ms + self::BACKOFF_S * 1000, self::BACKOFF_S);
                return false;
            }
            Cache::set(self::CACHE_KEY, ['at' => $ms, 'snap' => $snap], self::KEEP_S);
            Cache::del(self::FAIL_KEY);
            return true;
        } finally { Cache::unlock('env:kma'); }
    }

    /** fetch + parse both services; null on any failure (logged without the key or the address) */
    public static function fetchKma(int $ms): ?array
    {
        $base = self::base();
        if ($base === '') { Log::warn('ENV', 'env.kma_base is not an https address — the model of 정선 is used'); return null; }
        $g = self::kmaGrid(self::LAT, self::LON);
        $bt = self::baseTimes($ms);
        try {
            $ncst = self::items(self::get($base . '/getUltraSrtNcst', $bt['ncst'], $g), 'getUltraSrtNcst');
            $obs = [];
            foreach ($ncst as $it) {
                if (!is_array($it) || !isset($it['category'], $it['obsrValue'])) continue;
                $obs[(string) $it['category']] = (string) $it['obsrValue'];
            }
            if (!isset($obs['T1H'], $obs['PTY'])) throw new \RuntimeException('getUltraSrtNcst: T1H / PTY missing');
            $fc = [];
            try {
                foreach (self::items(self::get($base . '/getUltraSrtFcst', $bt['fcst'], $g), 'getUltraSrtFcst') as $it) {
                    if (!is_array($it) || !isset($it['category'], $it['fcstDate'], $it['fcstTime'], $it['fcstValue'])) continue;
                    $fc[(string) $it['fcstDate'] . (string) $it['fcstTime']][(string) $it['category']] = (string) $it['fcstValue'];
                }
                ksort($fc);
            } catch (\Throwable $e) {
                Log::warn('ENV', 'getUltraSrtFcst failed — the current observation is used alone', ['why' => self::why($e)]);
                $fc = [];
            }
            return self::snapFrom($obs, $fc, $ms);
        } catch (\Throwable $e) {
            Log::warn('ENV', '기상청 data not usable — the model of 정선 is used', ['why' => self::why($e)]);
            return null;
        }
    }
    /** a short reason that can never contain the key or the address */
    private static function why(\Throwable $e): string
    {
        $m = $e->getMessage();
        $k = self::key();
        if ($k !== '') $m = str_replace([$k, rawurlencode($k)], '[key]', $m);
        return mb_substr(preg_replace('~https?://\S+~', '[url]', $m), 0, 160);
    }

    /** GET with the query of the agency; [status, body] */
    private static function get(string $url, array $base, array $g): string
    {
        $k = self::key();
        // data.go.kr hands out an "encoding" key (already %-escaped) and a "decoding" key: both work
        $key = strpos($k, '%') !== false ? $k : rawurlencode($k);
        $q = 'serviceKey=' . $key . '&pageNo=1&numOfRows=60&dataType=JSON&base_date=' . $base[0] . '&base_time=' . $base[1] . '&nx=' . $g['nx'] . '&ny=' . $g['ny'];
        self::$calls++;
        if (self::$transport !== null) { $r = call_user_func(self::$transport, $url . '?' . $q); }
        else $r = self::curl($url . '?' . $q);
        list($status, $body, $errno) = [(int) $r[0], (string) $r[1], isset($r[2]) ? (int) $r[2] : 0];
        if ($errno !== 0) throw new \RuntimeException('transport error ' . $errno . ($errno === 28 ? ' (timeout)' : ''));
        if ($status !== 200) throw new \RuntimeException('HTTP ' . $status);
        return $body;
    }
    private static function curl(string $url): array
    {
        if (!function_exists('curl_init')) return [0, '', 2];
        $ch = curl_init();
        if ($ch === false) return [0, '', 2];
        curl_setopt_array($ch, [
            CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => false, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => self::TIMEOUT_S, CURLOPT_TIMEOUT => self::TIMEOUT_S, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_MAXFILESIZE => 262144,
            CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_USERAGENT => 'tfm-metaverse/' . (defined('TFM_VERSION') ? TFM_VERSION : '1'),
        ]);
        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (PHP_VERSION_ID < 80000) curl_close($ch);
        return [$status, is_string($raw) ? $raw : '', $raw === false && $errno === 0 ? 1 : $errno];
    }

    /** the items of an answer of the agency; throws on its error shapes (XML gateway errors, resultCode ≠ 00, damage) */
    public static function items(string $body, string $what): array
    {
        $b = ltrim($body);
        if ($b === '') throw new \RuntimeException($what . ': empty answer');
        if ($b[0] === '<') {
            // the API gateway answers errors (unknown key, call limit, …) in XML even when JSON was asked for
            $code = preg_match('~<returnReasonCode>\s*(\d+)\s*</returnReasonCode>~', $b, $m) ? $m[1] : '?';
            $msg = preg_match('~<returnAuthMsg>\s*([A-Z_]{1,80})\s*</returnAuthMsg>~', $b, $m2) ? $m2[1] : (preg_match('~<resultMsg>\s*([A-Z_]{1,80})\s*</resultMsg>~', $b, $m3) ? $m3[1] : 'XML');
            throw new \RuntimeException($what . ': gateway error ' . $code . ' ' . $msg);
        }
        $j = json_decode($b, true);
        if (!is_array($j) || !isset($j['response']['header']['resultCode'])) throw new \RuntimeException($what . ': not the agency JSON');
        $rc = (string) $j['response']['header']['resultCode'];
        if ($rc !== '00') {
            $rm = isset($j['response']['header']['resultMsg']) && is_string($j['response']['header']['resultMsg']) ? preg_replace('~[^A-Z_ ]~', '', $j['response']['header']['resultMsg']) : '';
            throw new \RuntimeException($what . ': resultCode ' . preg_replace('~\D~', '', $rc) . ' ' . mb_substr((string) $rm, 0, 60));
        }
        $it = isset($j['response']['body']['items']['item']) ? $j['response']['body']['items']['item'] : null;
        if (!is_array($it) || !$it) throw new \RuntimeException($what . ': no items');
        return array_values($it);
    }

    /** a number of the agency, null for its "missing" values (±900 and beyond) and for anything not numeric */
    private static function numv($v): ?float
    {
        if (!is_string($v) && !is_numeric($v)) return null;
        $s = trim((string) $v);
        if (!is_numeric($s)) return null;
        $f = (float) $s;
        return is_finite($f) && abs($f) < 900 ? $f : null;
    }
    /** RN1 of the forecast: '강수없음', '1mm 미만', '1.0mm', '30.0~50.0mm', '50.0mm 이상' → mm */
    private static function rainv(string $v): float
    {
        if (strpos($v, '없음') !== false) return 0.0;
        if (strpos($v, '미만') !== false) return 0.5;
        return preg_match('~(\d+(?:\.\d+)?)~', $v, $m) ? min(300.0, (float) $m[1]) : 0.0;
    }
    /** map PTY / SKY / humidity / wind / hour to one of the five weathers */
    public static function weatherOf(?int $pty, ?int $sky, float $t, ?float $reh, ?float $wsd, float $hour): string
    {
        if ($pty === 3 || $pty === 7) return 'SNOW';
        if ($pty === 2 || $pty === 6) return $t <= 0.5 ? 'SNOW' : 'RAIN';
        if ($pty === 1 || $pty === 5) return $t <= -1.5 ? 'SNOW' : 'RAIN';
        if ($reh !== null && $reh >= 95 && ($wsd === null || $wsd < 2.0) && $hour >= 3 && $hour < 11) return 'FOG';
        if ($sky === 1) return 'CLEAR';
        if ($sky === 3 || $sky === 4) return 'CLOUDY';
        return $reh !== null && $reh >= 85 ? 'CLOUDY' : 'CLEAR';
    }
    /** the snapshot of the 기상청 answers: $obs = category → value; $fc = 'yyyymmddHHMM' → category → value (sorted) */
    public static function snapFrom(array $obs, array $fc, int $ms): array
    {
        $k = self::kst($ms);
        $t = self::numv(isset($obs['T1H']) ? $obs['T1H'] : null);
        if ($t === null || $t < -40 || $t > 45) throw new \RuntimeException('T1H out of range');
        $pty = self::numv(isset($obs['PTY']) ? $obs['PTY'] : null);
        $reh = self::numv(isset($obs['REH']) ? $obs['REH'] : null);
        $wsd = self::numv(isset($obs['WSD']) ? $obs['WSD'] : null);
        $rn1 = self::numv(isset($obs['RN1']) ? $obs['RN1'] : null);
        $nowKey = sprintf('%04d%02d%02d%02d00', $k['y'], $k['mo'], $k['d'], $k['h']);
        $sky = null; $next = null;
        foreach ($fc as $when => $c) {
            $when = (string) $when;
            if ($sky === null && $when >= $nowKey && isset($c['SKY'])) { $v = self::numv($c['SKY']); $sky = $v === null ? null : (int) $v; }
            if ($next === null && $when > $nowKey && isset($c['PTY'])) {
                $nt = isset($c['T1H']) ? self::numv($c['T1H']) : null;
                $ns = isset($c['SKY']) ? self::numv($c['SKY']) : null;
                $np = self::numv($c['PTY']);
                $hh = (int) substr($when, 8, 2);
                $tm = gmmktime((int) substr($when, 8, 2), (int) substr($when, 10, 2), 0, (int) substr($when, 4, 2), (int) substr($when, 6, 2), (int) substr($when, 0, 4));
                $next = ['t' => ($tm * 1000) - self::KST_MS, 'weather' => self::weatherOf($np === null ? null : (int) $np, $ns === null ? null : (int) $ns, $nt === null ? $t : $nt, null, null, (float) $hh),
                    'temp' => $nt === null ? null : self::round1($nt)];
            }
        }
        $wx = self::weatherOf($pty === null ? null : (int) $pty, $sky, $t, $reh, $wsd, (float) $k['hour']);
        $st = self::sunTimes($ms); $se = self::season($ms);
        $rain = $rn1 !== null ? max(0.0, min(300.0, $rn1)) : (isset($obs['RN1']) ? self::rainv((string) $obs['RN1']) : 0.0);
        return ['t' => $ms, 'tz' => 'Asia/Seoul', 'weather' => $wx, 'temp' => self::round1($t),
            'humidity' => $reh === null ? self::modelAt($ms)['humidity'] : (int) max(0, min(100, self::jround($reh))),
            'wind' => $wsd === null ? 1.0 : self::round1(max(0.0, min(60.0, $wsd))), 'rain1h' => self::round1($rain), 'source' => 'kma',
            'sunrise' => $st['rise'], 'sunset' => $st['set'], 'season' => $se['id'], 'seasonName' => $se['name'], 'term' => $se['term'],
            'next' => $next !== null ? $next : ['t' => $ms + 3600000, 'weather' => $wx, 'temp' => self::round1($t)]];
    }

    // ------------------------------------------------------------------ the crop calendar and the real-time beds
    /** {sow: int[], harvest: int[], days: int} of a crop from the exported calendar (game-data.json cropCalendar), else null */
    public static function cal(string $cropId): ?array
    {
        static $all = null, $src = null;
        if ($all === null || $src !== self::$calendar) {
            $all = [];
            $src = self::$calendar;
            $d = self::$calendar === null && class_exists('Tfm\GameData') ? GameData::all() : [];
            $raw = self::$calendar !== null ? self::$calendar : (isset($d['cropCalendar']) && is_array($d['cropCalendar']) ? $d['cropCalendar'] : []);
            foreach ($raw as $id => $c) {
                if (!is_string($id) || !is_array($c) || !isset($c['days']) || !is_numeric($c['days']) || (float) $c['days'] <= 0) continue;
                $m = function ($a) { $o = []; foreach ((array) $a as $x) if (is_int($x) && $x >= 1 && $x <= 12) $o[] = $x; return $o; };
                $all[$id] = ['sow' => $m(isset($c['sow']) ? $c['sow'] : []), 'harvest' => $m(isset($c['harvest']) ? $c['harvest'] : []), 'days' => (float) $c['days']];
            }
        }
        return isset($all[$cropId]) ? $all[$cropId] : null;
    }
    public static function seasonK(?array $cal, int $mo): float
    {
        if ($cal === null || !$cal['sow']) return 1.0;
        if (in_array($mo, $cal['sow'], true)) return 1.0;
        $prev = $mo === 1 ? 12 : $mo - 1; $next = $mo === 12 ? 1 : $mo + 1;
        if (in_array($prev, $cal['sow'], true) || in_array($next, $cal['sow'], true)) return 0.85;
        return $mo >= 4 && $mo <= 10 ? 0.7 : 0.55;
    }
    /** the gentle growth factor of a planting at $ms (season × weather, 0.5 … 1.05, to 1/1000) */
    public static function cropFactor(?array $cal, int $ms, string $weather): float
    {
        if ($cal === null) return 1.0;
        $w = array_key_exists($weather, self::WEATHER_K) ? self::WEATHER_K[$weather] : 1.0;
        $f = self::seasonK($cal, self::kst($ms)['mo']) * $w;
        $f = $f < 0.5 ? 0.5 : ($f > 1.05 ? 1.05 : $f);
        return self::jround($f * 1000) / 1000;
    }
    /**
     * Real-time bed duration (ms) — the same rule as the client (77-env.js core.bedMs):
     * calendar: days × 86 400 000 ÷ (tier × scale × factor) · short: minutes × 60 000 ÷ (tier × scale).
     * @param array $o {basis, cal, minutes, tier, scale, t, weather}
     */
    public static function bedMs(array $o): int
    {
        $tier = max(1, min(4, (int) self::jround((float) (isset($o['tier']) ? $o['tier'] : 1))));
        $scale = isset($o['scale']) && is_numeric($o['scale']) ? (float) $o['scale'] : 1.0;
        if (!($scale >= 0.1)) $scale = 1.0;
        if ($scale > 3600) $scale = 3600.0;
        $cal = isset($o['cal']) && is_array($o['cal']) ? $o['cal'] : null;
        if ((isset($o['basis']) ? $o['basis'] : '') === 'calendar' && $cal !== null && $cal['days'] > 0) {
            $f = self::cropFactor($cal, (int) $o['t'], (string) (isset($o['weather']) ? $o['weather'] : 'CLOUDY'));
            return max(1, (int) self::jround(($cal['days'] * self::DAY_MS) / ($tier * $scale * $f)));
        }
        $min = isset($o['minutes']) && is_numeric($o['minutes']) ? (float) $o['minutes'] : 0.0;
        return $min > 0 ? max(1, (int) self::jround(($min * 60000) / ($tier * $scale))) : 0;
    }
}
