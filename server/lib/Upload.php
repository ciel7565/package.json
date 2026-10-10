<?php
/**
 * Journal photo uploads.
 *   is_uploaded_file → size ≤ 5 MB → finfo MIME whitelist (png/jpeg/webp) → getimagesize (type must agree,
 *   dimension/pixel limits) → reject script/markup polyglots → re-encode with GD (strips metadata and any
 *   appended payload) → random file name with a forced extension in uploads/journal/YYYY/MM/.
 * uploads/.htaccess disables script execution and forces nosniff for whatever ends up there.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

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

    private static function reject(string $code, string $msg, array $audit = []): never
    {
        if ($audit) Audit::log('upload_rejected', Auth::current()['id'] ?? null, $audit + ['code' => $code], 'warn');
        throw new ApiException(400, $code, $msg);
    }

    /** @return array{url:string, width:int, height:int, size:int, mime:string, id:int} */
    public static function journalPhoto(array $user, string $field = 'photo'): array
    {
        $cfg = (array) Config::get('uploads', []);
        $max = (int) ($cfg['max_bytes'] ?? 5242880);
        $f = $_FILES[$field] ?? null;
        if (!is_array($f) || is_array($f['error'] ?? null)) self::reject('UPLOAD_MISSING', '사진 파일을 찾을 수 없어요.');
        $err = (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) self::reject('UPLOAD_TOO_LARGE', '사진은 5MB 이하만 올릴 수 있어요.');
        if ($err !== UPLOAD_ERR_OK) self::reject('UPLOAD_FAILED', '사진을 올리지 못했어요. 다시 시도해 주세요.');
        $tmp = (string) ($f['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) self::reject('UPLOAD_FAILED', '사진을 올리지 못했어요. 다시 시도해 주세요.', ['why' => 'not uploaded file']);
        $size = (int) filesize($tmp);
        if ($size <= 0) self::reject('UPLOAD_EMPTY', '빈 파일이에요.');
        if ($size > $max) self::reject('UPLOAD_TOO_LARGE', '사진은 5MB 이하만 올릴 수 있어요.');

        // quotas
        $now = Clock::ms();
        $today = (int) Db::value('SELECT COUNT(*) FROM journal_uploads WHERE user_id = ? AND created_at >= ?', [(int) $user['id'], $now - 86400000]);
        if ($today >= (int) ($cfg['per_user_daily'] ?? 40)) throw new ApiException(429, 'UPLOAD_QUOTA', '오늘 올릴 수 있는 사진 수를 넘었어요. 내일 다시 시도해 주세요.');
        $total = (int) Db::value('SELECT COUNT(*) FROM journal_uploads WHERE user_id = ?', [(int) $user['id']]);
        if ($total >= (int) ($cfg['per_user_total'] ?? 400)) throw new ApiException(429, 'UPLOAD_QUOTA', '저장할 수 있는 사진 수를 넘었어요.');

        // real type from the bytes (never trust the client's name or Content-Type)
        if (!class_exists(\finfo::class)) self::reject('UPLOAD_UNSUPPORTED', '서버에서 사진 형식을 확인할 수 없어요. (fileinfo 확장 필요)');
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!isset(self::TYPES[$mime])) self::reject('UPLOAD_TYPE', 'PNG·JPEG·WEBP 사진만 올릴 수 있어요.', ['mime' => mb_substr($mime, 0, 40)]);
        $info = @getimagesize($tmp);
        if (!$info || ($info[2] ?? 0) !== self::TYPES[$mime]['it']) self::reject('UPLOAD_INVALID', '올바른 사진 파일이 아니에요.', ['mime' => $mime, 'why' => 'getimagesize']);
        [$w, $h] = [(int) $info[0], (int) $info[1]];
        if ($w < 1 || $h < 1 || $w > 12000 || $h > 12000 || $w * $h > (int) ($cfg['max_pixels'] ?? 40000000)) {
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
        $out = null;
        $gd = extension_loaded('gd') && function_exists('imagecreatefromstring');
        if ($gd) {
            $out = self::reencode($bytes, $mime, $w, $h, $cfg);
            if ($out === null) self::reject('UPLOAD_INVALID', '사진을 읽지 못했어요. 다른 사진을 골라 주세요.', ['why' => 'decode']);
        } elseif (!empty($cfg['require_gd'])) {
            self::reject('UPLOAD_UNSUPPORTED', '서버에 이미지 처리 기능(GD)이 없어 업로드할 수 없어요.');
        } else {
            $out = ['bytes' => $bytes, 'mime' => $mime, 'w' => $w, 'h' => $h];
            Log::warn('UPLOAD', 'GD missing: storing original bytes (validated, not re-encoded)');
        }

        $ext = self::TYPES[$out['mime']]['ext'];
        $sub = 'journal/' . date('Y') . '/' . date('m');
        $dir = Config::uploadDir() . '/' . $sub;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) throw new \RuntimeException('upload dir not writable');
        $name = bin2hex(random_bytes(16)) . '.' . $ext;
        $path = $dir . '/' . $name;
        if (file_put_contents($path, $out['bytes'], LOCK_EX) === false) throw new \RuntimeException('upload write failed');
        @chmod($path, 0644);
        $url = 'uploads/' . $sub . '/' . $name;
        $id = Db::insert('journal_uploads', [
            'user_id' => (int) $user['id'], 'path' => $url, 'mime' => $out['mime'], 'size_bytes' => strlen($out['bytes']),
            'width' => $out['w'], 'height' => $out['h'], 'sha256' => hash('sha256', $out['bytes']), 'created_at' => $now,
        ]);
        Log::info('UPLOAD', 'journal photo stored', ['uid' => (int) $user['id'], 'bytes' => strlen($out['bytes']), 'mime' => $out['mime']]);
        return ['id' => $id, 'url' => $url, 'width' => $out['w'], 'height' => $out['h'], 'size' => strlen($out['bytes']), 'mime' => $out['mime']];
    }

    private static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || $v === '-1') return 0; // unlimited
        $n = (int) $v;
        return match (strtolower(substr($v, -1))) { 'g' => $n * 1073741824, 'm' => $n * 1048576, 'k' => $n * 1024, default => $n };
    }

    /** decode → (downscale) → encode again in the same family; null when GD cannot decode it */
    private static function reencode(string $bytes, string $mime, int $w, int $h, array $cfg): ?array
    {
        $img = @imagecreatefromstring($bytes);
        if (!$img) return null;
        try {
            $maxDim = max(64, (int) ($cfg['max_dimension'] ?? 1600));
            $scale = min(1.0, $maxDim / max($w, $h));
            if ($scale < 1.0) {
                $nw = max(1, (int) round($w * $scale));
                $nh = max(1, (int) round($h * $scale));
                $dst = imagecreatetruecolor($nw, $nh);
                imagealphablending($dst, false);
                imagesavealpha($dst, true);
                imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
                imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
                imagedestroy($img);
                $img = $dst;
                [$w, $h] = [$nw, $nh];
            }
            ob_start();
            $okWrite = false;
            $outMime = $mime;
            if ($mime === 'image/jpeg') {
                $okWrite = imagejpeg($img, null, max(40, min(95, (int) ($cfg['jpeg_quality'] ?? 85))));
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
            if ($img instanceof \GdImage) imagedestroy($img);
        }
    }
}
