<?php
/**
 * Journal photo uploads.
 *   is_uploaded_file → size ≤ 5 MB → finfo MIME whitelist (png/jpeg/webp) → getimagesize (type must agree,
 *   dimension/pixel limits) → reject script/markup polyglots → re-encode with GD (strips metadata and any
 *   appended payload) → random file name with a forced extension in uploads/journal/YYYY/MM/.
 * uploads/.htaccess disables script execution and forces nosniff for whatever ends up there.
 * PHP 7.2 syntax only (GD images are resources on PHP < 8, GdImage objects on 8+).
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Upload
{
    private const TYPES = [
        'image/png'  => ['ext' => 'png', 'it' => IMAGETYPE_PNG],
        'image/jpeg' => ['ext' => 'jpg', 'it' => IMAGETYPE_JPEG],
        'image/webp' => ['ext' => 'webp', 'it' => IMAGETYPE_WEBP],
    ];
    /**
     * Markers that must never appear in an image we serve (PHP / HTML / SVG polyglots). Each pattern is long
     * enough (or anchored on a following delimiter) that random compressed image data practically never matches.
     */
    private const POLYGLOT = '/<\?php|<script[\s>\/]|<html[\s>]|<iframe[\s>\/]|<svg[\s>\/]|<!doctype\s|<body[\s>]|<object[\s>]|<embed[\s>]|__halt_compiler|<\?xml-stylesheet/i';

    private static function reject(string $code, string $msg, array $audit = [])
    {
        if ($audit) {
            $cu = Auth::current();
            Audit::log('upload_rejected', $cu ? (int) $cu['id'] : null, $audit + ['code' => $code], 'warn');
            // CONTRACT §15.7 #5: a rejected upload is a security event. A deliberately hostile file (a script / markup
            // polyglot) is attack-like (warn → counts toward the automatic block); a benign wrong type / oversize photo
            // is logged at 'info' so a child picking the wrong file a few times never locks the classroom out.
            $dangerous = in_array($code, ['UPLOAD_REJECTED', 'UPLOAD_INVALID'], true);
            if (class_exists('Tfm\SecEvent')) SecEvent::log('upload_rejected', $dangerous ? 'warn' : 'info', $audit + ['code' => $code], $cu ? (int) $cu['id'] : null);
        }
        throw new ApiException(400, $code, $msg);
    }

    /** @return array{url:string, width:int, height:int, size:int, mime:string, id:int} */
    public static function journalPhoto(array $user, string $field = 'photo'): array
    {
        // the journal uses the configured defaults; the one-line call for a later report photo (≤ 1 MB, ≤ 1280 px) is
        //   Upload::image($user, 'photo', ['maxBytes' => 1048576, 'maxDimension' => 1280, 'subdir' => 'reports', 'dailyLimit' => 10, 'totalLimit' => 200]);
        return self::image($user, $field, ['subdir' => 'journal']);
    }

    /**
     * The reusable photo-upload core (CONTRACT §15.7 #14). $opt: maxBytes, maxDimension, subdir, dailyLimit, totalLimit
     * (each falls back to the config 'uploads' block), types (allowed MIME types, a subset of png / jpeg / webp — by the
     * bytes, never the client's name or Content-Type; default all three), record (default true: the photo counts toward the
     * journal quotas and gets a journal_uploads row; false = the caller keeps its own record and quota, e.g. a report photo
     * of api/farm/report-photo.php, id 0). Pipeline: is_uploaded_file → size cap → per-user quota → finfo MIME
     * whitelist (png/jpeg/webp) → getimagesize (type agrees, dimension / pixel / memory caps) → reject script/markup
     * polyglots → GD re-encode (strips EXIF/GPS and anything appended) → random name + forced extension under
     * uploads/<subdir>/YYYY/MM/. F8: GD is required — without it there is no safe way to strip metadata or a trailing
     * payload, so the upload is refused with a clear message rather than storing the original bytes.
     * @return array{url:string, width:int, height:int, size:int, mime:string, id:int}
     */
    public static function image(array $user, string $field, array $opt): array
    {
        $cfg = (array) Config::get('uploads', []);
        $max = (int) (isset($opt['maxBytes']) ? $opt['maxBytes'] : (isset($cfg['max_bytes']) ? $cfg['max_bytes'] : 5242880));
        $maxDim = (int) (isset($opt['maxDimension']) ? $opt['maxDimension'] : (isset($cfg['max_dimension']) ? $cfg['max_dimension'] : 1600));
        $subdir = (string) preg_replace('/[^a-z0-9_]/', '', strtolower((string) (isset($opt['subdir']) ? $opt['subdir'] : 'journal')));
        if ($subdir === '') $subdir = 'journal';
        $types = isset($opt['types']) && is_array($opt['types']) ? array_values(array_intersect(array_keys(self::TYPES), $opt['types'])) : array_keys(self::TYPES);
        if (!$types) $types = array_keys(self::TYPES);
        $record = !array_key_exists('record', $opt) || $opt['record'] !== false;
        $dailyLimit = (int) (isset($opt['dailyLimit']) ? $opt['dailyLimit'] : (isset($cfg['per_user_daily']) ? $cfg['per_user_daily'] : 40));
        $totalLimit = (int) (isset($opt['totalLimit']) ? $opt['totalLimit'] : (isset($cfg['per_user_total']) ? $cfg['per_user_total'] : 400));
        $mb = $max >= 1048576 ? rtrim(rtrim(number_format($max / 1048576, 1), '0'), '.') . 'MB' : ceil($max / 1024) . 'KB';
        $tooLarge = "사진은 {$mb} 이하만 올릴 수 있어요.";

        $f = isset($_FILES[$field]) ? $_FILES[$field] : null;
        if (!is_array($f) || (isset($f['error']) && is_array($f['error']))) self::reject('UPLOAD_MISSING', '사진 파일을 찾을 수 없어요.');
        $err = (int) (isset($f['error']) ? $f['error'] : UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) self::reject('UPLOAD_TOO_LARGE', $tooLarge);
        if ($err !== UPLOAD_ERR_OK) self::reject('UPLOAD_FAILED', '사진을 올리지 못했어요. 다시 시도해 주세요.');
        $tmp = (string) (isset($f['tmp_name']) ? $f['tmp_name'] : '');
        if ($tmp === '' || !is_uploaded_file($tmp)) self::reject('UPLOAD_FAILED', '사진을 올리지 못했어요. 다시 시도해 주세요.', ['why' => 'not uploaded file']);
        $size = (int) filesize($tmp);
        if ($size <= 0) self::reject('UPLOAD_EMPTY', '빈 파일이에요.');
        if ($size > $max) self::reject('UPLOAD_TOO_LARGE', $tooLarge);

        // GD is mandatory: without it a re-encode (the only safe metadata / trailing-payload strip) is impossible — refuse
        // up front rather than reach the end and store the original bytes (F8).
        if (!extension_loaded('gd') || !function_exists('imagecreatefromstring')) {
            self::reject('UPLOAD_UNSUPPORTED', '서버에 이미지 처리 기능(GD)이 없어 사진을 안전하게 저장할 수 없어요. 운영자에게 GD 확장 설치를 요청해 주세요.');
        }
        // real type from the bytes (never trust the client's name or Content-Type)
        if (!class_exists('finfo')) self::reject('UPLOAD_UNSUPPORTED', '서버에서 사진 형식을 확인할 수 없어요. (fileinfo 확장 필요)');

        // quotas (journal photos; a caller with its own record keeps its own quota)
        $now = Clock::ms();
        if ($record) {
            $today = (int) Db::value('SELECT COUNT(*) FROM journal_uploads WHERE user_id = ? AND created_at >= ?', [(int) $user['id'], $now - 86400000]);
            if ($today >= $dailyLimit) throw new ApiException(429, 'UPLOAD_QUOTA', '오늘 올릴 수 있는 사진 수를 넘었어요. 내일 다시 시도해 주세요.');
            $total = (int) Db::value('SELECT COUNT(*) FROM journal_uploads WHERE user_id = ?', [(int) $user['id']]);
            if ($total >= $totalLimit) throw new ApiException(429, 'UPLOAD_QUOTA', '저장할 수 있는 사진 수를 넘었어요.');
        }

        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($tmp);
        $names = ['image/png' => 'PNG', 'image/jpeg' => 'JPEG', 'image/webp' => 'WEBP'];
        if (!isset(self::TYPES[$mime]) || !in_array($mime, $types, true)) {
            self::reject('UPLOAD_TYPE', implode('·', array_map(function ($t) use ($names) { return $names[$t]; }, $types)) . ' 사진만 올릴 수 있어요.', ['mime' => mb_substr($mime, 0, 40)]);
        }
        $info = @getimagesize($tmp);
        if (!$info || (isset($info[2]) ? $info[2] : 0) !== self::TYPES[$mime]['it']) self::reject('UPLOAD_INVALID', '올바른 사진 파일이 아니에요.', ['mime' => $mime, 'why' => 'getimagesize']);
        $w = (int) $info[0];
        $h = (int) $info[1];
        if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000 || $w * $h > (int) (isset($cfg['max_pixels']) ? $cfg['max_pixels'] : 40000000)) {
            self::reject('UPLOAD_DIMENSIONS', '사진 해상도가 너무 커요.', ['w' => $w, 'h' => $h]);
        }
        // decoding needs ~5 bytes per pixel in GD: refuse what would exhaust memory_limit (fatal error otherwise)
        $limit = self::iniBytes((string) ini_get('memory_limit'));
        if ($limit > 0 && memory_get_usage(true) + $w * $h * 5 + 8 * 1048576 > $limit) {
            self::reject('UPLOAD_DIMENSIONS', '사진 해상도가 너무 커요. 더 작은 사진을 골라 주세요.', ['w' => $w, 'h' => $h, 'why' => 'memory']);
        }
        $bytes = (string) file_get_contents($tmp);
        if (preg_match(self::POLYGLOT, $bytes, $hit)) {
            self::reject('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['why' => 'polyglot', 'marker' => strtolower(substr($hit[0], 0, 16))]);
        }

        // re-encode (drops EXIF/GPS metadata, comments and anything appended after the image data)
        $out = self::reencode($bytes, $mime, $w, $h, ['max_dimension' => $maxDim] + $cfg);
        if ($out === null) self::reject('UPLOAD_INVALID', '사진을 읽지 못했어요. 다른 사진을 골라 주세요.', ['why' => 'decode']);

        $ext = self::TYPES[$out['mime']]['ext'];
        $sub = $subdir . '/' . date('Y') . '/' . date('m');
        $dir = Config::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $sub);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) throw new \RuntimeException('upload dir not writable');
        $name = bin2hex(random_bytes(16)) . '.' . $ext;
        $path = $dir . DIRECTORY_SEPARATOR . $name;
        if (file_put_contents($path, $out['bytes'], LOCK_EX) === false) throw new \RuntimeException('upload write failed');
        @chmod($path, 0644);
        $url = 'uploads/' . $sub . '/' . $name;
        $id = !$record ? 0 : Db::insert('journal_uploads', [
            'user_id' => (int) $user['id'], 'path' => $url, 'mime' => $out['mime'], 'size_bytes' => strlen($out['bytes']),
            'width' => $out['w'], 'height' => $out['h'], 'sha256' => hash('sha256', $out['bytes']), 'created_at' => $now,
        ]);
        Log::info('UPLOAD', 'photo stored', ['uid' => (int) $user['id'], 'bytes' => strlen($out['bytes']), 'mime' => $out['mime'], 'subdir' => $subdir]);
        return ['id' => $id, 'url' => $url, 'width' => $out['w'], 'height' => $out['h'], 'size' => strlen($out['bytes']), 'mime' => $out['mime']];
    }

    /**
     * Remove a photo stored by image() that could not be attached (e.g. a report that got its photo from another upload at
     * the same moment). Only a path image() produces (uploads/<subdir>/YYYY/MM/<32 hex>.<ext>) is ever touched.
     */
    public static function discard(string $url): bool
    {
        if (!preg_match('#^uploads/([a-z0-9_]{1,40})/(\d{4})/(\d{2})/([a-f0-9]{32}\.(?:jpg|png|webp))$#', $url, $m)) return false;
        $path = Config::uploadDir() . DIRECTORY_SEPARATOR . $m[1] . DIRECTORY_SEPARATOR . $m[2] . DIRECTORY_SEPARATOR . $m[3] . DIRECTORY_SEPARATOR . $m[4];
        return is_file($path) && @unlink($path);
    }

    private static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || $v === '-1') return 0; // unlimited
        $n = (int) $v;
        switch (strtolower(Str::sub($v, -1))) {
            case 'g': return $n * 1073741824;
            case 'm': return $n * 1048576;
            case 'k': return $n * 1024;
            default: return $n;
        }
    }

    /** decode → (downscale) → encode again in the same family; null when GD cannot decode it */
    private static function reencode(string $bytes, string $mime, int $w, int $h, array $cfg): ?array
    {
        $img = @imagecreatefromstring($bytes);
        if (!$img) return null;
        try {
            $maxDim = max(64, (int) (isset($cfg['max_dimension']) ? $cfg['max_dimension'] : 1600));
            $scale = min(1.0, $maxDim / max($w, $h));
            if ($scale < 1.0) {
                $nw = max(1, (int) round($w * $scale));
                $nh = max(1, (int) round($h * $scale));
                $dst = imagecreatetruecolor($nw, $nh);
                imagealphablending($dst, false);
                imagesavealpha($dst, true);
                imagefill($dst, 0, 0, (int) imagecolorallocatealpha($dst, 0, 0, 0, 127));
                imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
                self::freeImage($img);
                $img = $dst;
                $w = $nw;
                $h = $nh;
            }
            ob_start();
            $okWrite = false;
            $outMime = $mime;
            if ($mime === 'image/jpeg') {
                $okWrite = imagejpeg($img, null, max(40, min(95, (int) (isset($cfg['jpeg_quality']) ? $cfg['jpeg_quality'] : 85))));
            } elseif ($mime === 'image/webp' && function_exists('imagewebp')) {
                imagesavealpha($img, true);
                $okWrite = imagewebp($img, null, 85);
            } else {
                imagesavealpha($img, true);
                $okWrite = imagepng($img, null, 6);
                $outMime = 'image/png';
            }
            $data = (string) ob_get_clean();
            if (!$okWrite || $data === '') return null;
            return ['bytes' => $data, 'mime' => $outMime, 'w' => $w, 'h' => $h];
        } finally {
            self::freeImage($img);
        }
    }

    /**
     * GD images are resources on PHP 7 (imagedestroy frees them right away — photos are big) and GdImage objects on PHP 8,
     * where imagedestroy() does nothing and is deprecated since 8.5 (the API error handler would turn the notice into an
     * exception): there the object goes when the last reference does.
     */
    private static function freeImage(&$img): void
    {
        if (PHP_VERSION_ID < 80000 && is_resource($img)) imagedestroy($img);
        $img = null;
    }

    // =================================================================================================================
    // [lecture] Administrator files for the 강의실 (CONTRACT §17.3): pdf · pptx · pictures of an image deck.
    //
    // An upload is DATA, never code:
    //   · only an administrator's request reaches this (the admin entry has checked the origin, the CSRF token, the role
    //     and the elevation before it calls lectureFile()); every refusal is audited and a security event
    //   · the type is decided by the CONTENT — the %PDF header and trailer; a zip that really is a presentation
    //     ([Content_Types].xml naming a presentation, ppt/presentation.xml, slides); a picture GD can decode — never by the
    //     name or the Content-Type the browser sent (neither is stored)
    //   · pictures are decoded and encoded again (metadata and anything appended are gone); pdf and pptx are stored as
    //     they came, under data/lectures/<YYYY>/<MM>/<32 random hex>.bin — a private folder, a neutral extension: the
    //     web server never serves or runs them, PHP never includes them; only Tfm\Lecture::stream sends them, with a fixed
    //     type, nosniff and a sandbox policy
    //   · the zip is read with fixed bounds from its central directory (no extraction; at most three small entries are
    //     inflated, each to a capped length): entry count, declared sizes, compression ratio, names that try to leave the
    //     archive (../, absolute, drive letters, backslashes, NUL), duplicate names, encrypted entries, ZIP64, bytes
    //     before the first or after the last record, a local header that disagrees with the directory, macro projects
    //     and executables inside are all refusals. Archives inside the archive are never opened.
    // Nothing here changes journalPhoto() / image() above (the players' photos).
    // =================================================================================================================
    public const DOC_PDF = 'application/pdf';
    public const DOC_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    /** entries / unpacked bytes / ratio a presentation zip may declare (config lecture.zip_* can lower them) */
    private const ZIP_MAX_ENTRIES = 3000;
    private const ZIP_MAX_UNPACKED = 314572800;     // 300 MB over all entries
    private const ZIP_MAX_ENTRY = 104857600;        // 100 MB for one entry
    private const ZIP_MAX_RATIO = 200;              // unpacked / packed of an entry of 1 MB and more
    private const ZIP_MAX_SLIDES = 500;
    /** file names that have no business inside a presentation */
    private const ZIP_BAD_NAME = '/\.(?:exe|dll|com|scr|pif|bat|cmd|msi|msp|hta|lnk|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|jar|php\d?|phtml|phar|sh|py|pl|cgi|asp|aspx|jsp|htaccess)$/i';

    /** refuse an administrator file: audit row + security event ('warn' for a hostile file, 'info' for a plain mistake) */
    private static function refuse(string $code, string $msg, array $why, bool $hostile = false)
    {
        try {
            $cu = Auth::current();
            $uid = $cu ? (int) $cu['id'] : null;
            Audit::log('upload_rejected', $uid, $why + ['code' => $code, 'what' => 'lecture'], 'warn', $uid);
            if (class_exists('Tfm\SecEvent')) SecEvent::log('upload_rejected', $hostile ? 'warn' : 'info', $why + ['code' => $code, 'what' => 'lecture'], $uid);
        } catch (\Throwable $e) { /* logging only */ }
        throw new ApiException(400, $code, $msg);
    }

    private static function mbText(int $bytes): string
    {
        return $bytes >= 1048576 ? rtrim(rtrim(number_format($bytes / 1048576, 1), '0'), '.') . 'MB' : ceil($bytes / 1024) . 'KB';
    }

    /**
     * The files of one form field as a flat list — a single <input type="file" name="f"> or name="f[]" multiple:
     * [['tmp' => path, 'size' => bytes, 'error' => UPLOAD_ERR_*], …] (slots the browser left empty are skipped).
     * More than $maxFiles files → 400. The client's file name and Content-Type are deliberately not returned.
     */
    public static function incoming(string $field, int $maxFiles = 25): array
    {
        $f = isset($_FILES[$field]) ? $_FILES[$field] : null;
        if (!is_array($f) || !isset($f['tmp_name'], $f['error'])) return [];
        $tmp = is_array($f['tmp_name']) ? array_values($f['tmp_name']) : [$f['tmp_name']];
        $err = is_array($f['error']) ? array_values($f['error']) : [$f['error']];
        $size = isset($f['size']) ? (is_array($f['size']) ? array_values($f['size']) : [$f['size']]) : [];
        $out = [];
        foreach ($tmp as $i => $t) {
            $e = isset($err[$i]) && is_int($err[$i]) ? $err[$i] : UPLOAD_ERR_NO_FILE;
            if ($e === UPLOAD_ERR_NO_FILE) continue;
            if (is_array($t)) self::refuse('UPLOAD_INVALID', '파일을 알아보지 못했어요.', ['why' => 'nested field'], true);
            $out[] = ['tmp' => is_string($t) ? $t : '', 'size' => isset($size[$i]) ? (int) $size[$i] : 0, 'error' => $e];
            if (count($out) > $maxFiles) self::refuse('UPLOAD_TOO_MANY', "한 번에 {$maxFiles}개까지 올릴 수 있어요. 나누어서 올려 주세요.", ['why' => 'too many files']);
        }
        return $out;
    }

    /**
     * Check and store ONE administrator file of a lecture. $file = one entry of incoming(); $kind = 'pdf' | 'pptx' |
     * 'image'. $opt: maxBytes (the cap for this kind), maxDimension (pictures), trusted (tests / the command line: the
     * path was made by the caller, not by an HTTP upload — it is copied instead of moved).
     * @return array{path:string, mime:string, bytes:int, w:int, h:int, sha256:string}  path is relative to data/lectures
     */
    public static function lectureFile(array $admin, array $file, string $kind, array $opt = []): array
    {
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        if (!in_array($kind, ['pdf', 'pptx', 'image'], true)) throw new ApiException(400, 'INVALID_INPUT', '파일 종류가 올바르지 않아요.');
        $max = (int) (isset($opt['maxBytes']) ? $opt['maxBytes'] : ($kind === 'pdf' ? 31457280 : ($kind === 'pptx' ? 52428800 : 5242880)));
        $tooLarge = '파일이 너무 커요. ' . self::mbText($max) . ' 이하만 올릴 수 있어요.';
        $err = (int) (isset($file['error']) ? $file['error'] : UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) self::refuse('UPLOAD_TOO_LARGE', $tooLarge, ['kind' => $kind, 'why' => 'server limit']);
        if ($err === UPLOAD_ERR_NO_FILE) throw new ApiException(400, 'UPLOAD_MISSING', '올릴 파일을 골라 주세요.');
        if ($err !== UPLOAD_ERR_OK) self::refuse('UPLOAD_FAILED', '파일을 올리지 못했어요. 다시 해 주세요.', ['kind' => $kind, 'why' => 'upload error ' . $err]);
        $tmp = (string) (isset($file['tmp']) ? $file['tmp'] : '');
        $trusted = !empty($opt['trusted']);
        if ($tmp === '' || !is_file($tmp) || (!$trusted && !is_uploaded_file($tmp))) self::refuse('UPLOAD_FAILED', '파일을 올리지 못했어요. 다시 해 주세요.', ['kind' => $kind, 'why' => 'not an uploaded file'], true);
        $info = self::inspect($tmp, $kind, ['maxBytes' => $max] + $opt);
        $rel = Lecture::newPath();
        $abs = Lecture::dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
        if (isset($info['data'])) {
            if (file_put_contents($abs, $info['data'], LOCK_EX) === false) throw new \RuntimeException('lecture file write failed');
        } elseif ($trusted ? !@copy($tmp, $abs) : !@move_uploaded_file($tmp, $abs)) {
            throw new \RuntimeException('lecture file move failed');
        }
        @chmod($abs, 0640);
        $bytes = (int) filesize($abs);
        $sha = (string) hash_file('sha256', $abs);
        Log::info('UPLOAD', 'lecture file stored', ['uid' => (int) $admin['id'], 'kind' => $kind, 'bytes' => $bytes]);
        return ['path' => $rel, 'mime' => (string) $info['mime'], 'bytes' => $bytes, 'w' => (int) $info['w'], 'h' => (int) $info['h'], 'sha256' => $sha];
    }

    /**
     * The content check of a lecture file, without HTTP and without storing anything (lectureFile and the unit tests
     * call it): returns ['mime', 'w', 'h'] (+ 'data' = the re-encoded bytes of a picture; for a pptx w = its slide
     * count) or throws ApiException 400 with one of UPLOAD_EMPTY · UPLOAD_TOO_LARGE · UPLOAD_TYPE · UPLOAD_INVALID ·
     * UPLOAD_REJECTED · UPLOAD_DIMENSIONS · UPLOAD_UNSUPPORTED.
     */
    public static function inspect(string $path, string $kind, array $opt = []): array
    {
        $size = @filesize($path);
        if (!is_int($size) || $size <= 0) self::refuse('UPLOAD_EMPTY', '빈 파일이에요.', ['kind' => $kind]);
        $max = (int) (isset($opt['maxBytes']) ? $opt['maxBytes'] : 52428800);
        if ($size > $max) self::refuse('UPLOAD_TOO_LARGE', '파일이 너무 커요. ' . self::mbText($max) . ' 이하만 올릴 수 있어요.', ['kind' => $kind, 'bytes' => $size]);
        if ($kind === 'pdf') return self::inspectPdf($path, $size);
        if ($kind === 'pptx') return self::inspectPptx($path, $size);
        if ($kind === 'image') return self::inspectImage($path, $opt);
        throw new ApiException(400, 'INVALID_INPUT', '파일 종류가 올바르지 않아요.');
    }

    /** a pdf: the header at byte 0, the trailer near the end, no markup / script head, no PHP anywhere, no auto-run script */
    private static function inspectPdf(string $path, int $size): array
    {
        $fh = @fopen($path, 'rb');
        if (!$fh) throw new \RuntimeException('cannot read upload');
        try {
            $head = (string) fread($fh, 4096);
            if (!preg_match('/^%PDF-[12]\.\d/', $head)) self::refuse('UPLOAD_TYPE', 'PDF 파일이 아니에요. 문서를 "PDF로 저장"한 파일을 골라 주세요.', ['kind' => 'pdf', 'why' => 'header']);
            if (preg_match(self::POLYGLOT, $head, $hit)) self::refuse('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['kind' => 'pdf', 'why' => 'polyglot head', 'marker' => strtolower(substr($hit[0], 0, 16))], true);
            fseek($fh, max(0, $size - 4096));
            if (strpos((string) fread($fh, 4096), '%%EOF') === false) self::refuse('UPLOAD_INVALID', 'PDF 파일이 끝까지 올라오지 않았거나 손상되었어요. 다시 저장해서 올려 주세요.', ['kind' => 'pdf', 'why' => 'no trailer']);
            // the whole file in pieces (1 MB with an overlap, so a marker across two pieces is found): server-side script
            // markers must not be anywhere; a script the viewer would start by itself is refused in clear text
            fseek($fh, 0);
            $keep = '';
            $auto = false;
            while (!feof($fh)) {
                $piece = fread($fh, 1048576);
                if ($piece === false || $piece === '') break;
                $buf = $keep . $piece;
                if (preg_match('/<\?php|__halt_compiler/i', $buf, $hit)) self::refuse('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['kind' => 'pdf', 'why' => 'script marker', 'marker' => strtolower(substr($hit[0], 0, 16))], true);
                if (!$auto) {
                    // a PDF name may spell any character as #xx (/J#61vaScript): compare the decoded spelling
                    $plain = strpos($buf, '#') === false ? $buf : (string) preg_replace_callback('/#([0-9A-Fa-f]{2})/', function (array $m): string { return chr((int) hexdec($m[1])); }, $buf);
                    if (preg_match('#/(?:JavaScript|Launch)\b#', $plain)) $auto = true;   // 10 / 7 characters: never a chance match in packed data
                }
                $keep = substr($buf, -32);
            }
            if ($auto) self::refuse('UPLOAD_REJECTED', 'PDF 안에 스스로 실행되는 스크립트가 들어 있어 올릴 수 없어요. 인쇄용 PDF로 다시 저장해서 올려 주세요.', ['kind' => 'pdf', 'why' => 'active content'], true);
        } finally {
            fclose($fh);
        }
        if (class_exists('finfo')) {
            $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($path);
            if ($mime !== 'application/pdf') self::refuse('UPLOAD_TYPE', 'PDF 파일이 아니에요. 문서를 "PDF로 저장"한 파일을 골라 주세요.', ['kind' => 'pdf', 'mime' => mb_substr($mime, 0, 40)]);
        }
        return ['mime' => self::DOC_PDF, 'w' => 0, 'h' => 0];
    }

    /** a presentation: a bounded zip whose parts say it is a .pptx (or .ppsx) without macros */
    private static function inspectPptx(string $path, int $size): array
    {
        $zip = self::zipIndex($path);
        $names = $zip['entries'];
        $slides = 0;
        foreach ($names as $name => $e) {
            if (preg_match('#^ppt/slides/slide\d{1,5}\.xml$#', $name)) $slides++;
            if (preg_match('#(?:^|/)vbaProject\.bin$#i', $name)) self::refuse('UPLOAD_REJECTED', '매크로가 들어 있는 파일은 올릴 수 없어요. 파워포인트에서 "PowerPoint 프레젠테이션(.pptx)"으로 다시 저장해 주세요.', ['kind' => 'pptx', 'why' => 'macro project'], true);
            if (preg_match(self::ZIP_BAD_NAME, $name)) self::refuse('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['kind' => 'pptx', 'why' => 'executable inside'], true);
        }
        if (!isset($names['[Content_Types].xml'], $names['ppt/presentation.xml'])) {
            self::refuse('UPLOAD_TYPE', '파워포인트(.pptx) 파일이 아니에요. 옛 형식(.ppt)은 파워포인트에서 .pptx 로 다시 저장해 주세요.', ['kind' => 'pptx', 'why' => 'not a presentation']);
        }
        if ($slides < 1) self::refuse('UPLOAD_INVALID', '슬라이드가 한 장도 없는 파일이에요. 슬라이드를 넣고 다시 저장해서 올려 주세요.', ['kind' => 'pptx', 'why' => 'no slides']);
        if ($slides > self::ZIP_MAX_SLIDES) self::refuse('UPLOAD_INVALID', '슬라이드가 너무 많아요. (최대 ' . self::ZIP_MAX_SLIDES . '장)', ['kind' => 'pptx', 'slides' => $slides]);
        $types = self::zipRead($path, $names['[Content_Types].xml'], 1048576);
        if ($types === null) self::refuse('UPLOAD_INVALID', '파워포인트 파일을 읽지 못했어요. 다시 저장해서 올려 주세요.', ['kind' => 'pptx', 'why' => 'content types unreadable']);
        if (preg_match('/<!DOCTYPE|<!ENTITY/i', $types)) self::refuse('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['kind' => 'pptx', 'why' => 'dtd'], true);
        if (stripos($types, 'macroEnabled') !== false) self::refuse('UPLOAD_REJECTED', '매크로가 들어 있는 파일은 올릴 수 없어요. 파워포인트에서 "PowerPoint 프레젠테이션(.pptx)"으로 다시 저장해 주세요.', ['kind' => 'pptx', 'why' => 'macro type'], true);
        if (strpos($types, 'presentationml.presentation.main+xml') === false && strpos($types, 'presentationml.slideshow.main+xml') === false) {
            self::refuse('UPLOAD_TYPE', '파워포인트(.pptx) 파일이 아니에요. 옛 형식(.ppt)은 파워포인트에서 .pptx 로 다시 저장해 주세요.', ['kind' => 'pptx', 'why' => 'content type']);
        }
        return ['mime' => self::DOC_PPTX, 'w' => $slides, 'h' => 0];
    }

    /** a picture of an image deck: the journal photo's checks, then decoded and encoded again */
    private static function inspectImage(string $path, array $opt): array
    {
        $cfg = (array) Config::get('uploads', []);
        if (!extension_loaded('gd') || !function_exists('imagecreatefromstring')) self::refuse('UPLOAD_UNSUPPORTED', '서버에 이미지 처리 기능(GD)이 없어 그림을 안전하게 저장할 수 없어요. 운영자에게 GD 확장 설치를 요청해 주세요.', ['kind' => 'image']);
        if (!class_exists('finfo')) self::refuse('UPLOAD_UNSUPPORTED', '서버에서 그림 형식을 확인할 수 없어요. (fileinfo 확장 필요)', ['kind' => 'image']);
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($path);
        if (!isset(self::TYPES[$mime])) self::refuse('UPLOAD_TYPE', 'JPG · PNG · WEBP 그림만 올릴 수 있어요.', ['kind' => 'image', 'mime' => mb_substr($mime, 0, 40)]);
        $info = @getimagesize($path);
        if (!$info || (isset($info[2]) ? $info[2] : 0) !== self::TYPES[$mime]['it']) self::refuse('UPLOAD_INVALID', '올바른 그림 파일이 아니에요.', ['kind' => 'image', 'mime' => $mime, 'why' => 'getimagesize'], true);
        $w = (int) $info[0];
        $h = (int) $info[1];
        if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000 || $w * $h > (int) (isset($cfg['max_pixels']) ? $cfg['max_pixels'] : 40000000)) self::refuse('UPLOAD_DIMENSIONS', '그림 해상도가 너무 커요.', ['kind' => 'image', 'w' => $w, 'h' => $h]);
        $limit = self::iniBytes((string) ini_get('memory_limit'));
        if ($limit > 0 && memory_get_usage(true) + $w * $h * 5 + 8 * 1048576 > $limit) self::refuse('UPLOAD_DIMENSIONS', '그림 해상도가 너무 커요. 더 작은 그림을 골라 주세요.', ['kind' => 'image', 'w' => $w, 'h' => $h, 'why' => 'memory']);
        $bytes = (string) file_get_contents($path);
        if (preg_match(self::POLYGLOT, $bytes, $hit)) self::refuse('UPLOAD_REJECTED', '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.', ['kind' => 'image', 'why' => 'polyglot', 'marker' => strtolower(substr($hit[0], 0, 16))], true);
        $out = self::reencode($bytes, $mime, $w, $h, ['max_dimension' => (int) (isset($opt['maxDimension']) ? $opt['maxDimension'] : 1920)] + $cfg);
        if ($out === null) self::refuse('UPLOAD_INVALID', '그림을 읽지 못했어요. 다른 그림을 골라 주세요.', ['kind' => 'image', 'why' => 'decode']);
        return ['mime' => $out['mime'], 'w' => $out['w'], 'h' => $out['h'], 'data' => $out['bytes']];
    }

    /** is this entry name safe: relative, forward slashes, no parent step, no drive, no control character */
    public static function zipNameOk(string $name): bool
    {
        if ($name === '' || strlen($name) > 260 || !mb_check_encoding($name, 'UTF-8')) return false;
        if (preg_match('/[\x00-\x1f\x7f\\\\:*?"<>|]/', $name)) return false;      // control, backslash, drive / stream colon, shell wildcards
        if ($name[0] === '/' || strpos($name, '//') !== false) return false;
        foreach (explode('/', rtrim($name, '/')) as $seg) if ($seg === '' || $seg === '.' || $seg === '..' || trim($seg, '. ') === '') return false;
        return true;
    }

    /**
     * The table of contents of a zip, read from its central directory with fixed bounds. Nothing is extracted and
     * nothing is inflated here. Returns ['entries' => [name => ['method', 'csize', 'usize', 'offset']], 'usize' => total]
     * — or refuses (ApiException 400 UPLOAD_TYPE / UPLOAD_INVALID / UPLOAD_REJECTED).
     */
    public static function zipIndex(string $path): array
    {
        $maxEntries = max(1, min(self::ZIP_MAX_ENTRIES, (int) Config::get('lecture.zip_max_entries', self::ZIP_MAX_ENTRIES)));
        $maxUnpacked = max(1048576, min(self::ZIP_MAX_UNPACKED, (int) Config::get('lecture.zip_max_unpacked', self::ZIP_MAX_UNPACKED)));
        $bad = function (string $why, bool $hostile = true) {
            self::refuse($hostile ? 'UPLOAD_REJECTED' : 'UPLOAD_INVALID', $hostile ? '안전하지 않은 내용이 들어 있는 파일이라 올릴 수 없어요.' : '파워포인트 파일을 읽지 못했어요. 다시 저장해서 올려 주세요.', ['kind' => 'pptx', 'why' => $why], $hostile);
        };
        $size = (int) @filesize($path);
        $fh = @fopen($path, 'rb');
        if (!$fh) throw new \RuntimeException('cannot read upload');
        try {
            if ($size < 22 || fread($fh, 4) !== "PK\x03\x04") self::refuse('UPLOAD_TYPE', '파워포인트(.pptx) 파일이 아니에요. 옛 형식(.ppt)은 파워포인트에서 .pptx 로 다시 저장해 주세요.', ['kind' => 'pptx', 'why' => 'not a zip']);
            // the end record: the LAST "PK\5\6" whose comment ends exactly at the end of the file (nothing appended)
            $tailLen = (int) min($size, 65557);
            fseek($fh, $size - $tailLen);
            $tail = (string) fread($fh, $tailLen);
            $p = strrpos($tail, "PK\x05\x06");
            if ($p === false || $p + 22 > $tailLen) $bad('no end record', false);
            $eocd = unpack('vdisk/vcdisk/vhere/vtotal/Vcdsize/Vcdoff/vclen', substr($tail, $p + 4, 18));
            if ($p + 22 + $eocd['clen'] !== $tailLen) $bad('bytes after the archive');
            if ($eocd['disk'] !== 0 || $eocd['cdisk'] !== 0 || $eocd['here'] !== $eocd['total']) $bad('multi-disk archive');
            if ($eocd['total'] === 0xFFFF || $eocd['cdsize'] === 0xFFFFFFFF || $eocd['cdoff'] === 0xFFFFFFFF) $bad('zip64');
            if ($eocd['total'] < 1) $bad('empty archive', false);
            if ($eocd['total'] > $maxEntries) $bad('too many entries (' . $eocd['total'] . ')');
            $eocdAbs = $size - $tailLen + $p;
            if ($eocd['cdsize'] > 8388608 || $eocd['cdoff'] + $eocd['cdsize'] > $eocdAbs || $eocd['cdsize'] < 46 * $eocd['total']) $bad('directory out of bounds');
            fseek($fh, $eocd['cdoff']);
            $cd = (string) fread($fh, $eocd['cdsize']);
            if (strlen($cd) !== $eocd['cdsize']) $bad('directory unreadable', false);
            $entries = [];
            $seen = [];
            $total = 0;
            $at = 0;
            for ($i = 0; $i < $eocd['total']; $i++) {
                if ($at + 46 > strlen($cd) || substr($cd, $at, 4) !== "PK\x01\x02") $bad('directory entry ' . $i);
                $h = unpack('vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen/vclen/vdisk/viattr/Veattr/Voffset', substr($cd, $at + 8, 38));
                $name = substr($cd, $at + 46, $h['nlen']);
                $at += 46 + $h['nlen'] + $h['xlen'] + $h['clen'];
                if (strlen($name) !== $h['nlen'] || $at > strlen($cd)) $bad('directory entry ' . $i);
                if (!self::zipNameOk($name)) $bad('entry name leaves the archive');
                if ($h['flags'] & 0x0001 || $h['flags'] & 0x0040 || $h['flags'] & 0x2000) $bad('encrypted entry');
                if ($h['method'] !== 0 && $h['method'] !== 8) $bad('compression method ' . $h['method']);
                if ($h['csize'] === 0xFFFFFFFF || $h['usize'] === 0xFFFFFFFF || $h['offset'] === 0xFFFFFFFF || $h['disk'] !== 0) $bad('zip64');
                if ($h['method'] === 0 && $h['csize'] !== $h['usize']) $bad('stored entry sizes disagree');
                if ($h['usize'] > self::ZIP_MAX_ENTRY) $bad('entry too large');
                if ($h['usize'] >= 1048576 && $h['usize'] > $h['csize'] * self::ZIP_MAX_RATIO) $bad('compression ratio');
                $total += $h['usize'];
                if ($total > $maxUnpacked) $bad('unpacked size');
                $key = strtolower($name);
                if (isset($seen[$key])) $bad('duplicate entry name');
                $seen[$key] = true;
                if ($h['offset'] + 30 + $h['nlen'] + $h['csize'] > $eocd['cdoff']) $bad('entry out of bounds');
                // the local header must say the same name (two readers of this file must never see different contents)
                fseek($fh, $h['offset']);
                $lh = (string) fread($fh, 30);
                if (strlen($lh) !== 30 || substr($lh, 0, 4) !== "PK\x03\x04") $bad('local header ' . $i);
                $l = unpack('vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen', substr($lh, 6, 24));
                if ($l['nlen'] !== $h['nlen'] || $l['method'] !== $h['method'] || (string) fread($fh, $l['nlen']) !== $name) $bad('local header disagrees');
                if ($l['flags'] & 0x0001) $bad('encrypted entry');
                $entries[$name] = ['method' => $h['method'], 'csize' => $h['csize'], 'usize' => $h['usize'], 'offset' => $h['offset']];
            }
            return ['entries' => $entries, 'usize' => $total];
        } finally {
            fclose($fh);
        }
    }

    /** one small entry of a checked zip as text: at most $max bytes after inflating; null when it is larger or broken */
    public static function zipRead(string $path, array $entry, int $max = 1048576): ?string
    {
        if ($entry['usize'] > $max || $entry['csize'] > $max) return null;
        $fh = @fopen($path, 'rb');
        if (!$fh) return null;
        try {
            fseek($fh, $entry['offset']);
            $lh = (string) fread($fh, 30);
            if (strlen($lh) !== 30 || substr($lh, 0, 4) !== "PK\x03\x04") return null;
            $l = unpack('vnlen/vxlen', substr($lh, 26, 4));
            fseek($fh, $entry['offset'] + 30 + $l['nlen'] + $l['xlen']);
            $raw = $entry['csize'] > 0 ? (string) fread($fh, $entry['csize']) : '';
            if (strlen($raw) !== $entry['csize']) return null;
            if ($entry['method'] === 0) return $raw;
            if (!function_exists('gzinflate')) return null;
            $out = @gzinflate($raw, $max);
            return is_string($out) ? $out : null;
        } finally {
            fclose($fh);
        }
    }
}
