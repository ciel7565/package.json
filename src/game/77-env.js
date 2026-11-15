// =============================================================================
// 77-env.js — Korea in real time (CONTRACT §17.5): the wall clock of Asia/Seoul, the sun and the moon by astronomy for
// 정선 (37.38° N, 128.66° E), the season and the 24 절기, today's weather (the site's own server: api/env/now.php,
// provider 'kma' = 기상청 or 'model' = a climatology of 정선; in file mode the same model is computed here), and the
// Korean crop calendar (sowing / harvest months, real days, the gentle growth factor of the real-time beds).
//
//   G.env (registered as system 'env', order 71 — before the weather system, which follows it)
//     now()               the current snapshot { t, tz, weather, temp, humidity, wind, rain1h, source, sunrise, sunset,
//                         season, next } (server mode: the last answer of api/env/now.php, refreshed every 10 minutes;
//                         file mode: the model, recomputed every minute)
//     source              'kma' | 'model' (where the weather of now() comes from)
//     kst(ms?)            { y, mo, d, h, mi, s, dow, doy, hour (fractional), key (yyyymmdd) } of Asia/Seoul
//     season(ms?)         { id: 'spring'|'summer'|'autumn'|'winter', name: '봄'…, term: '입동', termIdx 0..23 }
//     sun(ms?)            { elev, az } in degrees (az from north, clockwise; elevation with refraction)
//     moon(ms?)           { elev, az, illum 0..1, waxing, name: '초승달'… }
//     sunTimes(ms?)       { rise, set, noon } in ms of that KST day
//     clockMode()         'kst' | 'fast' | 'fixed' — what the weather system's clock does (see 51-weather.js)
//     setClockMode(m)     per device (localStorage); the site default is the operator setting env.clock_default
//     nightBrightness()   the operator setting env.night_brightness (0.6 … 1.6, default 1.25)
//     cal(cropId)         { sow: [months], harvest: [months], days } | null — the Korean crop calendar (G.data.cropCalendar)
//     cropFactor(cropId, ms, weather?) → 0.5 … 1.05   the gentle growth factor of a planting made at ms (season × weather)
//     cropHint(cropId, ms?) → '지금은 배추 심기 좋은 때예요' | '배추는 8월에 심으면 좋아요. 지금 심어도 천천히 자라요.'
//     inSeason(cropId, ms?) → bool
//     dateText(ms) → '11월 20일쯤'
//     refresh()           ask the server again now (server mode)
//     core                the pure rules (no DOM, no G): astronomy, the KMA grid, the model, the calendar — the same
//                         numbers as server/lib/Env.php (tests/env-client.mjs runs this file in Node and compares)
//   Events: env:changed { snap, prev } whenever the weather / temperature of now() changes.
//   Automation (§17.0): under navigator.webdriver the weather system keeps its fixed test clock unless ?clock=kst; this
//   system still runs (its numbers are pure) and asks the server only in server mode.
// =============================================================================
(function () {
  // ---------------------------------------------------------------- the pure core (also loaded by Node tests)
  const core = (function () {
    const LAT = 37.38, LON = 128.66;          // 정선읍
    const KST_MS = 9 * 3600000;
    const DAY_MS = 86400000;
    const RAD = Math.PI / 180, DEG = 180 / Math.PI;
    const IDS = ['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'SNOW'];

    /** KST calendar parts of a timestamp (ms) */
    function kst(ms) {
      const t = Math.floor(Number(ms)) + KST_MS;
      const d = new Date(t);
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dd = d.getUTCDate();
      const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
      const jan1 = Date.UTC(y, 0, 1);
      const doy = Math.floor((Date.UTC(y, mo - 1, dd) - jan1) / DAY_MS) + 1;
      return { y, mo, d: dd, h, mi, s, dow: d.getUTCDay(), doy, hour: h + mi / 60 + s / 3600, key: y * 10000 + mo * 100 + dd };
    }
    /** ms of 00:00 KST of the day of ms */
    function kstMidnight(ms) { return Math.floor((Math.floor(Number(ms)) + KST_MS) / DAY_MS) * DAY_MS - KST_MS; }
    function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

    // ---- astronomy (NOAA solar position; low-precision moon) -----------------------------------------------------
    function julian(ms) { return ms / DAY_MS + 2440587.5; }
    function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
    /** solar coordinates for a timestamp: declination (deg), equation of time (min), apparent longitude (deg) */
    function solar(ms) {
      const T = (julian(ms) - 2451545) / 36525;
      const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
      const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
      const Mr = M * RAD;
      const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
      const trueLong = L0 + C;
      const omega = 125.04 - 1934.136 * T;
      const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
      const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
      const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
      const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
      const yv = Math.tan((eps / 2) * RAD) ** 2;
      const L0r = L0 * RAD;
      const eot = 4 * DEG * (yv * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * yv * Math.sin(Mr) * Math.cos(2 * L0r)
        - 0.5 * yv * yv * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
      return { decl, eot, lambda: norm360(lambda), eps };
    }
    /** sun elevation (deg, refraction corrected) and azimuth (deg from north, clockwise) at 정선 */
    function sunPos(ms, lat = LAT, lon = LON) {
      const s = solar(ms);
      const utcMin = ((ms % DAY_MS) + DAY_MS) % DAY_MS / 60000;
      let tst = (utcMin + s.eot + 4 * lon) % 1440; if (tst < 0) tst += 1440;
      let ha = tst / 4 - 180; if (ha < -180) ha += 360;
      const latR = lat * RAD, dR = s.decl * RAD, haR = ha * RAD;
      let cz = Math.sin(latR) * Math.sin(dR) + Math.cos(latR) * Math.cos(dR) * Math.cos(haR);
      cz = Math.max(-1, Math.min(1, cz));
      const zen = Math.acos(cz) * DEG;
      const elev0 = 90 - zen;
      let az;
      const den = Math.cos(latR) * Math.sin(zen * RAD);
      if (Math.abs(den) > 1e-6) {
        let ca = (Math.sin(latR) * cz - Math.sin(dR)) / den;
        ca = Math.max(-1, Math.min(1, ca));
        az = ha > 0 ? norm360(Math.acos(ca) * DEG + 180) : norm360(540 - Math.acos(ca) * DEG);
      } else az = lat > 0 ? 180 : 0;
      // atmospheric refraction (NOAA)
      let ref = 0;
      if (elev0 <= 85) {
        const te = Math.tan(elev0 * RAD);
        if (elev0 > 5) ref = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / te ** 5;
        else if (elev0 > -0.575) ref = 1735 + elev0 * (-518.2 + elev0 * (103.4 + elev0 * (-12.79 + elev0 * 0.711)));
        else ref = -20.774 / te;
        ref /= 3600;
      }
      return { elev: elev0 + ref, az };
    }
    /** sunrise / sunset / solar noon (ms) of the KST day of ms (two refinements of the NOAA hour-angle method) */
    function sunTimes(ms, lat = LAT, lon = LON) {
      const mid = kstMidnight(ms);
      const at = (guessMs, rising) => {
        let t = guessMs;
        for (let i = 0; i < 3; i++) {
          const s = solar(t);
          const latR = lat * RAD, dR = s.decl * RAD;
          const x = Math.cos(90.833 * RAD) / (Math.cos(latR) * Math.cos(dR)) - Math.tan(latR) * Math.tan(dR);
          if (x > 1 || x < -1) return null;
          const ha = Math.acos(x) * DEG;
          const utcMin = 720 - 4 * (lon + (rising ? ha : -ha)) - s.eot;
          // the UTC day that holds this KST day's event: KST midnight is 15:00 UTC of the day before
          const dayUtc = Math.floor((mid + 12 * 3600000) / DAY_MS) * DAY_MS;
          t = dayUtc + utcMin * 60000;
          if (t < mid) t += DAY_MS; else if (t >= mid + DAY_MS) t -= DAY_MS;
        }
        return Math.round(t);
      };
      const noonGuess = mid + 12.5 * 3600000;
      const s = solar(noonGuess);
      const dayUtc = Math.floor((mid + 12 * 3600000) / DAY_MS) * DAY_MS;
      let noon = dayUtc + (720 - 4 * lon - s.eot) * 60000;
      if (noon < mid) noon += DAY_MS;
      return { rise: at(mid + 6 * 3600000, true), set: at(mid + 18 * 3600000, false), noon: Math.round(noon) };
    }
    /** moon: low-precision position (Schlyter, main perturbations) → elevation / azimuth at 정선, illumination */
    function moon(ms, lat = LAT, lon = LON) {
      const d = julian(ms) - 2451543.5;
      const N = 125.1228 - 0.0529538083 * d, i = 5.1454, w = 318.0634 + 0.1643573223 * d;
      const a = 60.2666, e = 0.0549, M = norm360(115.3654 + 13.0649929509 * d);
      const Mr = M * RAD;
      let E = M + DEG * e * Math.sin(Mr) * (1 + e * Math.cos(Mr));
      for (let k = 0; k < 3; k++) E = E - (E - DEG * e * Math.sin(E * RAD) - M) / (1 - e * Math.cos(E * RAD));
      const Er = E * RAD;
      const xv = a * (Math.cos(Er) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(Er);
      const v = Math.atan2(yv, xv) * DEG, r = Math.sqrt(xv * xv + yv * yv);
      const Nr = N * RAD, ir = i * RAD, vw = (v + w) * RAD;
      const xh = r * (Math.cos(Nr) * Math.cos(vw) - Math.sin(Nr) * Math.sin(vw) * Math.cos(ir));
      const yh = r * (Math.sin(Nr) * Math.cos(vw) + Math.cos(Nr) * Math.sin(vw) * Math.cos(ir));
      const zh = r * Math.sin(vw) * Math.sin(ir);
      let lonE = norm360(Math.atan2(yh, xh) * DEG);
      let latE = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * DEG;
      // perturbations
      const Ms = norm360(356.047 + 0.9856002585 * d), ws = 282.9404 + 4.70935e-5 * d;
      const Ls = norm360(Ms + ws), Lm = norm360(M + w + N), D = norm360(Lm - Ls), F = norm360(Lm - N);
      const sr = (x) => Math.sin(x * RAD);
      lonE += -1.274 * sr(M - 2 * D) + 0.658 * sr(2 * D) - 0.186 * sr(Ms) - 0.059 * sr(2 * M - 2 * D) - 0.057 * sr(M - 2 * D + Ms)
        + 0.053 * sr(M + 2 * D) + 0.046 * sr(2 * D - Ms) + 0.041 * sr(M - Ms) - 0.035 * sr(D) - 0.031 * sr(M + Ms) - 0.015 * sr(2 * F - 2 * D) + 0.011 * sr(M - 4 * D);
      latE += -0.173 * sr(F - 2 * D) - 0.055 * sr(M - F - 2 * D) - 0.046 * sr(M + F - 2 * D) + 0.033 * sr(F + 2 * D) + 0.017 * sr(2 * M + F);
      lonE = norm360(lonE);
      // ecliptic → equatorial
      const ecl = (23.4393 - 3.563e-7 * d) * RAD;
      const lr = lonE * RAD, br = latE * RAD;
      const xe = Math.cos(lr) * Math.cos(br);
      const ye = Math.sin(lr) * Math.cos(br) * Math.cos(ecl) - Math.sin(br) * Math.sin(ecl);
      const ze = Math.sin(lr) * Math.cos(br) * Math.sin(ecl) + Math.sin(br) * Math.cos(ecl);
      const ra = Math.atan2(ye, xe) * DEG, dec = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye)) * DEG;
      // local sidereal time → hour angle → horizon
      const T = (julian(ms) - 2451545) / 36525;
      const gmst = norm360(280.46061837 + 360.98564736629 * (julian(ms) - 2451545) + T * T * 0.000387933);
      const ha = norm360(gmst + lon - ra);
      const latR = lat * RAD, decR = dec * RAD, haR = ha * RAD;
      const sinAlt = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
      let alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
      alt -= 0.95 * Math.cos(alt * RAD);                       // topocentric parallax (≈ 57′)
      const az = norm360(Math.atan2(Math.sin(haR), Math.cos(haR) * Math.sin(latR) - Math.tan(decR) * Math.cos(latR)) * DEG + 180);
      // phase from the elongation of the moon from the sun
      const sl = solar(ms).lambda;
      const elong = Math.acos(Math.max(-1, Math.min(1, Math.cos((lonE - sl) * RAD) * Math.cos(latE * RAD)))) * DEG;
      const illum = (1 - Math.cos(elong * RAD)) / 2;
      const waxing = norm360(lonE - sl) < 180;
      return { elev: alt, az, illum, waxing, name: moonName(illum, waxing), elong };
    }
    function moonName(illum, waxing) {
      if (illum < 0.03) return '그믐달·초승달 사이 (삭)';
      if (illum > 0.97) return '보름달';
      if (illum < 0.4) return waxing ? '초승달' : '그믐달';
      if (illum < 0.62) return waxing ? '상현달' : '하현달';
      return waxing ? '상현달 지나 차오르는 달' : '하현달 앞 기우는 달';
    }

    // ---- season and the 24 절기 ------------------------------------------------------------------------------
    const TERMS = ['춘분', '청명', '곡우', '입하', '소만', '망종', '하지', '소서', '대서', '입추', '처서', '백로',
      '추분', '한로', '상강', '입동', '소설', '대설', '동지', '소한', '대한', '입춘', '우수', '경칩'];
    const SEASONS = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
    function season(ms) {
      const k = kst(ms);
      const id = k.mo >= 3 && k.mo <= 5 ? 'spring' : k.mo >= 6 && k.mo <= 8 ? 'summer' : k.mo >= 9 && k.mo <= 11 ? 'autumn' : 'winter';
      const termIdx = Math.floor(solar(ms).lambda / 15) % 24;
      return { id, name: SEASONS[id], term: TERMS[termIdx], termIdx, month: k.mo };
    }

    // ---- 기상청 grid (DFS Lambert conformal conic, 5 km) ------------------------------------------------------
    function kmaGrid(lat, lon) {
      const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
      const re = RE / GRID, slat1 = SLAT1 * RAD, slat2 = SLAT2 * RAD, olon = OLON * RAD, olat = OLAT * RAD;
      let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
      sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
      let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
      sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
      let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
      ro = (re * sf) / Math.pow(ro, sn);
      let ra = Math.tan(Math.PI * 0.25 + lat * RAD * 0.5);
      ra = (re * sf) / Math.pow(ra, sn);
      let theta = lon * RAD - olon;
      if (theta > Math.PI) theta -= 2 * Math.PI;
      if (theta < -Math.PI) theta += 2 * Math.PI;
      theta *= sn;
      return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
    }

    // ---- the weather model of 정선 (deterministic per KST day; identical in server/lib/Env.php) -------------------
    // Only + − × ÷, comparisons and 32-bit integer mixing: the PHP port gives bit-identical numbers.
    const NORM = {
      max: [2, 5, 11, 19, 24, 27, 29, 29, 25, 19, 11, 4],
      min: [-11, -8, -3, 3, 9, 15, 20, 20, 14, 6, -1, -8],
      wet: [4, 4, 7, 8, 9, 10, 15, 14, 9, 6, 7, 5],           // days with rain or snow per month
      hum: [62, 60, 58, 55, 62, 72, 80, 80, 76, 70, 66, 64],
      fog: [0.08, 0.08, 0.1, 0.12, 0.14, 0.18, 0.2, 0.22, 0.32, 0.36, 0.3, 0.12],
    };
    function imul(a, b) { return Math.imul(a | 0, b | 0) >>> 0; }
    function mix32(h) {
      h = h >>> 0;
      h = (h ^ (h >>> 16)) >>> 0; h = imul(h, 0x7feb352d);
      h = (h ^ (h >>> 15)) >>> 0; h = imul(h, 0x846ca68b);
      h = (h ^ (h >>> 16)) >>> 0;
      return h;
    }
    /** a number 0 ≤ r < 1 fixed for (day key, slot) */
    function r01(day, k) { return mix32((imul(day, 0x27d4eb2d) ^ imul(k + 1, 0x165667b1)) >>> 0) / 4294967296; }
    function wetRaw(day, mo, dim) { return r01(day, 1) < NORM.wet[mo - 1] / dim; }
    /** the plan of one KST day: wet spell window, cloudiness, fog morning, temperature range */
    function dayPlan(ms) {
      const k = kst(ms), mo = k.mo, day = k.key;
      const dim = daysInMonth(k.y, mo);
      const kp = kst(kstMidnight(ms) - 1000);
      const prevWet = wetRaw(kp.key, kp.mo, daysInMonth(kp.y, kp.mo));
      const wet = wetRaw(day, mo, dim) || (prevWet && r01(day, 2) < 0.3);
      const start = Math.floor(r01(day, 3) * 24);
      const len = 3 + Math.floor(r01(day, 4) * 10);
      // month normals blended towards the neighbour month by the day of the month (no jumps on the 1st)
      const f = (k.d - 15.5) / dim;
      const mo2 = f >= 0 ? (mo % 12) + 1 : ((mo + 10) % 12) + 1;
      const g = f >= 0 ? f : -f;
      const tmaxN = NORM.max[mo - 1] + (NORM.max[mo2 - 1] - NORM.max[mo - 1]) * g;
      const tminN = NORM.min[mo - 1] + (NORM.min[mo2 - 1] - NORM.min[mo - 1]) * g;
      const tmax = tmaxN + (r01(day, 9) - 0.5) * 6 - (wet ? 2.5 : 0);
      const tmin = tminN + (r01(day, 10) - 0.5) * 5 + (wet ? 1.5 : 0);
      const cloud = r01(day, 6);
      const fogP = NORM.fog[mo - 1] + (prevWet ? 0.25 : 0);
      const fog = !wet && r01(day, 7) < fogP;
      const fogEnd = 7.5 + r01(day, 8) * 2.5;
      return { day, mo, wet, start, len, tmax, tmin, cloud, fog, fogEnd, hum: NORM.hum[mo - 1], windB: 1.2 + r01(day, 11) * 2.2, rainB: 0.5 + r01(day, 12) * 4 };
    }
    /** smooth 0..1 between a and b with only + − × ÷ */
    function sstep(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
    /** the diurnal temperature: coldest at 06:00, warmest at 15:00 */
    function diurnal(h) {
      if (h >= 6 && h <= 15) return sstep(6, 15, h);
      const x = h > 15 ? h - 15 : h + 9;                   // hours since 15:00 (0 .. 15)
      return 1 - sstep(0, 15, x);
    }
    function round1(v) { return Math.round(v * 10) / 10; }
    /** the model's weather at ms: { weather, temp, humidity, wind, rain1h } */
    function modelAt(ms) {
      const p = dayPlan(ms), k = kst(ms), h = k.h + k.mi / 60;
      const inWet = p.wet && h >= p.start && h < p.start + p.len;
      const nearWet = p.wet && h >= p.start - 3 && h < p.start + p.len + 3;
      const temp = p.tmin + (p.tmax - p.tmin) * diurnal(h);
      let wx;
      if (inWet) wx = temp <= 1 ? 'SNOW' : 'RAIN';
      else if (p.fog && h >= 4 && h < p.fogEnd) wx = 'FOG';
      else if (nearWet) wx = 'CLOUDY';
      else if (p.cloud < 0.45) wx = 'CLEAR';
      else if (p.cloud < 0.8) wx = h >= 12 && h < 18 ? 'CLOUDY' : 'CLEAR';
      else wx = 'CLOUDY';
      let hum = p.hum + (p.tmax - temp) * 2.2 - 6 + (inWet ? 22 : nearWet ? 10 : 0) + (wx === 'CLOUDY' ? 6 : 0);
      if (wx === 'FOG') hum = 98;
      hum = Math.round(hum < 20 ? 20 : hum > 100 ? 100 : hum);
      const wind = round1(p.windB + (h >= 12 && h < 18 ? 0.8 : 0) + (inWet ? 1.0 : 0) + (wx === 'FOG' ? -0.8 : 0));
      const rain1h = inWet ? round1(wx === 'SNOW' ? p.rainB * 0.4 : p.rainB) : 0;
      return { weather: wx, temp: round1(temp), humidity: hum, wind: wind < 0.2 ? 0.2 : wind, rain1h };
    }
    /** the whole now() snapshot of the model (what api/env/now.php answers with provider 'model') */
    function modelSnap(ms) {
      const t = Math.floor(Number(ms));
      const m = modelAt(t), st = sunTimes(t), se = season(t);
      const nx = modelAt(t + 3600000);
      return { t, tz: 'Asia/Seoul', weather: m.weather, temp: m.temp, humidity: m.humidity, wind: m.wind, rain1h: m.rain1h, source: 'model',
        sunrise: st.rise, sunset: st.set, season: se.id, seasonName: se.name, term: se.term, next: { t: t + 3600000, weather: nx.weather, temp: nx.temp } };
    }

    // ---- the Korean crop calendar ------------------------------------------------------------------------------
    const SEASON_K = { sow: 1.0, near: 0.85, grow: 0.7, winter: 0.55 };
    const WEATHER_K = { CLEAR: 1.05, CLOUDY: 1.0, RAIN: 1.0, FOG: 0.97, SNOW: 0.92 };
    /** the season part of the factor for a planting month (1..12) */
    function seasonK(cal, mo) {
      if (!cal || !Array.isArray(cal.sow) || !cal.sow.length) return 1;
      if (cal.sow.indexOf(mo) >= 0) return SEASON_K.sow;
      const prev = mo === 1 ? 12 : mo - 1, next = mo === 12 ? 1 : mo + 1;
      if (cal.sow.indexOf(prev) >= 0 || cal.sow.indexOf(next) >= 0) return SEASON_K.near;
      return mo >= 4 && mo <= 10 ? SEASON_K.grow : SEASON_K.winter;
    }
    /** gentle growth factor of a planting at ms: season × weather, 0.5 … 1.05 (rounded to 1/1000) */
    function cropFactor(cal, ms, weather) {
      if (!cal) return 1;
      const w = IDS.indexOf(weather) >= 0 ? WEATHER_K[weather] : 1;
      let f = seasonK(cal, kst(ms).mo) * w;
      f = f < 0.5 ? 0.5 : f > 1.05 ? 1.05 : f;
      return Math.round(f * 1000) / 1000;
    }
    /** real-time bed duration (ms): calendar basis = days × 86 400 000 ÷ (tier × scale × factor); short = phase-7 minutes */
    function bedMs(o) {
      const tier = Math.max(1, Math.min(4, Math.round(Number(o.tier) || 1)));
      let scale = Number(o.scale); if (!(scale >= 0.1)) scale = 1; if (scale > 3600) scale = 3600;
      if (o.basis === 'calendar' && o.cal && o.cal.days > 0) {
        const f = cropFactor(o.cal, o.t, o.weather);
        return Math.max(1, Math.round((o.cal.days * DAY_MS) / (tier * scale * f)));
      }
      const min = Number(o.minutes) || 0;
      return min > 0 ? Math.max(1, Math.round((min * 60000) / (tier * scale))) : 0;
    }

    return { LAT, LON, IDS, NORM, TERMS, kst, kstMidnight, daysInMonth, solar, sunPos, sunTimes, moon, season, kmaGrid,
      imul, mix32, r01, dayPlan, modelAt, modelSnap, diurnal, seasonK, cropFactor, bedMs, WEATHER_K, SEASON_K };
  })();

  if (typeof module === 'object' && module && module.exports) { module.exports = core; return; }
  if (typeof G === 'undefined') return;

  // ---------------------------------------------------------------- the system
  const LS_KEY = 'tfm.v1.env';
  const POLL_MS = 10 * 60000, MODEL_MS = 60000;
  const MODES = ['kst', 'fast', 'fixed'];
  const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const savePrefs = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } };
  // the query and the automation flag are read once (the clock is asked every frame)
  const QS = (() => { try { const u = new URLSearchParams(location.search); return { clock: u.get('clock'), nightlift: u.get('nightlift'), rtbasis: u.get('rtbasis') }; } catch (e) { return {}; } })();
  const qs = (k) => (QS[k] == null ? null : QS[k]);
  const AUTOMATED = (() => { try { return !!navigator.webdriver; } catch (e) { return false; } })();
  const automated = () => AUTOMATED;
  const serverMode = () => G.net?.mode === 'server';
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const site = (key, d) => { try { const v = G.site?.get?.(key, undefined); return v === undefined || v === null ? d : v; } catch (e) { return d; } };

  /** a server answer → a clean snapshot (unknown fields dropped, numbers bounded); null when unusable */
  function cleanSnap(d) {
    if (!d || typeof d !== 'object') return null;
    const wx = String(d.weather || '').toUpperCase();
    if (!core.IDS.includes(wx)) return null;
    const t = num(Number(d.t), G.time.now());
    const nx = d.next && typeof d.next === 'object' && core.IDS.includes(String(d.next.weather || '').toUpperCase())
      ? { t: num(Number(d.next.t), t + 3600000), weather: String(d.next.weather).toUpperCase(), temp: num(Number(d.next.temp), null) } : null;
    const se = core.season(t);
    return {
      t, tz: 'Asia/Seoul', weather: wx,
      temp: Math.max(-40, Math.min(45, num(Number(d.temp), 15))), humidity: Math.max(0, Math.min(100, Math.round(num(Number(d.humidity), 60)))),
      wind: Math.max(0, Math.min(60, num(Number(d.wind), 1))), rain1h: Math.max(0, Math.min(300, num(Number(d.rain1h), 0))),
      source: d.source === 'kma' ? 'kma' : 'model',
      sunrise: num(Number(d.sunrise), 0), sunset: num(Number(d.sunset), 0),
      season: ['spring', 'summer', 'autumn', 'winter'].includes(d.season) ? d.season : se.id, seasonName: se.name, term: se.term, next: nx,
    };
  }

  const ENV = {
    name: 'env', order: 71, label: '한국 시간과 날씨',
    core,
    _snap: null, _prefs: null, _pollT: 0, _modelT: 0, _busy: false, _cfg: null, _lastOkAt: 0,
    get source() { return this._snap ? this._snap.source : 'model'; },

    init() {
      this._prefs = loadPrefs();
      this._snap = core.modelSnap(G.time.now());
      this._modelT = MODEL_MS;
      G.bus.on('net:mode', () => this.refresh());
      G.log.info('ENV', `KST ${this.timeText()} · ${this._snap.seasonName} (${this._snap.term}) · clock ${this.clockMode()} · weather ${this._snap.weather} (${this._snap.source})`);
    },
    onStateLoaded() { if (serverMode()) this.refresh(); },
    update(dt) {
      if (serverMode()) {
        this._pollT -= dt;
        if (this._pollT <= 0) { this._pollT = POLL_MS / 1000; this.refresh(); }
      }
      this._modelT -= dt * 1000;
      if (this._modelT <= 0) {
        this._modelT = MODEL_MS;
        // file mode (or a server that has not answered for 30 minutes): the model of this minute
        if (!serverMode() || G.time.now() - this._lastOkAt > 30 * 60000) this._set(core.modelSnap(G.time.now()));
      }
    },

    // ------------------------------------------------------------ public API
    now() { return this._snap || (this._snap = core.modelSnap(G.time.now())); },
    kst(ms) { return core.kst(ms == null ? G.time.now() : ms); },
    season(ms) { return core.season(ms == null ? G.time.now() : ms); },
    sun(ms) { return core.sunPos(ms == null ? G.time.now() : ms); },
    moon(ms) { return core.moon(ms == null ? G.time.now() : ms); },
    sunTimes(ms) { return core.sunTimes(ms == null ? G.time.now() : ms); },
    timeText(ms) { const k = this.kst(ms); return `${String(k.h).padStart(2, '0')}:${String(k.mi).padStart(2, '0')}`; },
    dateText(ms) { const k = this.kst(ms); return `${k.mo}월 ${k.d}일쯤`; },
    /** 'kst' | 'fast' | 'fixed' — 고정 (lockTime) › the device's choice › the query (?clock=) › automation default › operator default */
    clockMode() {
      if (G.settings?.lockTime) return 'fixed';
      const p = this._prefs || {};
      if (p.clock === 'kst' || p.clock === 'fast') return p.clock;
      const q = qs('clock');
      if (MODES.includes(q)) return q;
      if (automated()) return 'fast';
      const d = this._cfg?.clock || site('env.clock_default', 'kst');
      return d === 'fast' ? 'fast' : d === 'fixed' ? 'fixed' : 'kst';
    },
    setClockMode(m) {
      if (!MODES.includes(m)) return false;
      const p = this._prefs || (this._prefs = {});
      if (m === 'fixed') { G.setSetting?.('lockTime', true); }
      else { p.clock = m; savePrefs(p); if (G.settings?.lockTime) G.setSetting?.('lockTime', false); }
      G.bus.emit('env:clock', { mode: this.clockMode() });
      return true;
    },
    /** the operator's night brightness (0.6 … 1.6), ?nightlift= for comparisons */
    nightBrightness() {
      const q = Number(qs('nightlift'));
      if (q >= 0.6 && q <= 1.6) return q;
      const v = Number(this._cfg?.nightBrightness ?? site('env.night_brightness', 1.25));
      return v >= 0.6 && v <= 1.6 ? v : 1.25;
    },
    /** the duration basis of the real-time beds: 'calendar' (real days) | 'short' (phase-7 minutes) */
    basis() {
      const q = qs('rtbasis');
      if (q === 'calendar' || q === 'short') return q;
      const v = this._srvBasis || this._cfg?.basis;
      if (v === 'calendar' || v === 'short') return v;
      if (automated() && qs('clock') !== 'kst') return 'short';
      return 'calendar';
    },
    cal(cropId) {
      const c = G.data.cropCalendar?.[cropId];
      return c && Array.isArray(c.sow) && Number(c.days) > 0 ? c : null;
    },
    inSeason(cropId, ms) { const c = this.cal(cropId); return !!c && c.sow.includes(this.kst(ms).mo); },
    /** the real weather (never the device's 체험 날씨) at the time of a planting: the snapshot when it is recent, else the model */
    weatherAt(ms) {
      const s = this._snap;
      if (s && Math.abs(ms - s.t) < 30 * 60000) return s.weather;
      return core.modelAt(ms).weather;
    },
    cropFactor(cropId, ms, weather) { return core.cropFactor(this.cal(cropId), ms, weather || this.weatherAt(ms)); },
    cropHint(cropId, ms) {
      const c = this.cal(cropId), crop = G.data.crops?.[cropId];
      if (!c || !crop) return '';
      const name = crop.name || '';
      const mo = this.kst(ms).mo;
      if (c.sow.includes(mo)) return `지금은 ${name} 심기 좋은 때예요`;
      const months = c.sow.map((m) => `${m}월`).join('·');
      return `${name}${josa(name, '은/는')} ${months}에 심으면 좋아요. 지금 심어도 자라요, 조금 천천히요.`;
    },
    harvestMonthsText(cropId) { const c = this.cal(cropId); return c ? c.harvest.map((m) => `${m}월`).join('·') : ''; },
    /** ask the server now (server mode); the answer may also carry the operator's env settings (cfg) */
    async refresh() {
      if (!serverMode() || this._busy) return false;
      this._busy = true;
      try {
        const d = await G.net.request('env/now.php', { timeout: 8000, quiet: true });
        const s = cleanSnap(d);
        if (d && d.cfg && typeof d.cfg === 'object') {
          const c = d.cfg;
          this._cfg = {
            clock: MODES.includes(c.clock) ? c.clock : null,
            nightBrightness: Number(c.nightBrightness) >= 0.6 && Number(c.nightBrightness) <= 1.6 ? Number(c.nightBrightness) : null,
            basis: c.basis === 'calendar' || c.basis === 'short' ? c.basis : null,
          };
        }
        if (s) { this._lastOkAt = G.time.now(); this._set(s); }
        return !!s;
      } catch (e) {
        G.log.warn('ENV', 'api/env/now.php did not answer — the model of 정선 stays', e?.code || e?.message || e);
        return false;
      } finally { this._busy = false; }
    },
    /** 42-realfarm: the basis the server measures with (data.rt.basis of a save answer) */
    setServerBasis(b) { if (b === 'calendar' || b === 'short') this._srvBasis = b; },

    _set(s) {
      const prev = this._snap;
      this._snap = s;
      if (!prev || prev.weather !== s.weather || Math.abs(prev.temp - s.temp) >= 0.5 || prev.source !== s.source || prev.humidity !== s.humidity) {
        G.bus.emit('env:changed', { snap: s, prev });
      }
    },
  };
  function josa(word, pair) {
    const w = String(word ?? ''), [a, b] = pair.split('/');
    const c = w.trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(c >= 0 && c <= 11171)) return b;
    return c % 28 ? a : b;
  }

  G.env = ENV;
  G.register(ENV);
})();
