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
}
