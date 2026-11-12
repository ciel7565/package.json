<?php
/**
 * TFM-ADMIN-STUB — the address of the phase-6 admin page. Since phase 7 the admin site lives in its own folder, whose
 * name is free (CONTRACT §15.4); this file only answers "404 Not Found" exactly like a missing file: no hint, no cookie,
 * no other page. Every visit is logged as a honeypot event (a real visitor has no reason to ask for it).
 * Keep this file in the release: copying a release over an older installation then replaces the old page with it.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

Tfm\AdminGate::oldAddress();
