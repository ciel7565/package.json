<?php
/**
 * POST api/sync.php — one call instead of three (CONTRACT §16.9): my presence goes up; the players around me, new chat
 * lines, moderation, the online count and the time of the next call come back.
 *   {p:[x, y, z, rotY, speed, anim, zoneId, emote, emoteAt], h?, c?, r?, ap?, q?, w?, f?, ns?, qt?}
 *   → {t?, te?, ch, n, sv, on, cn, pl:[[id, x, y, z, rotY, speed, anim, zone, emote, emoteAt, age, tag]], st?, who?, ap?, m?, c, rt?, mu, nt?}
 * The exact wire format, the token (header X-Sync-Token) and the error answers (401, 429 + Retry-After, 503 QUEUE /
 * BUSY) are documented at the top of lib/Sync.php. A call with a good token touches no session file and no database.
 * Light entry point: only the libraries this call names are compiled (lib/light.php).
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../lib/bootstrap.php';

Tfm\Sync::serve();
