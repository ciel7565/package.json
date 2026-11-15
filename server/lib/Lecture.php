<?php
/**
 * Tfm\Lecture — lectures of the 강의실 (CONTRACT §17.3): what the operator registers in the admin tab 🎓 강의 자료 and
 * what the app's panel 🎓 강의실 and the screens in the rooms show.
 *
 *   kinds     youtube (src = the 11-character video id) · slides (src = an embeddable https address on an allow-listed
 *             host) · pdf · images · pptx (uploaded files, rows of lecture_files) · link (any other https address — a
 *             button for grown-ups, never framed)
 *   place     '' (the list only) · a place id (PL_…) · '*' (every room)
 *   audience  all · member (a logged-in account) · paid (a live plan) · allot (a live allotment contract); an
 *             administrator sees everything. The rule is applied HERE for the list and for every file.
 *
 *   youtubeId($text) · slidesUrl($text) · linkUrl($text) · classify($text)   address parsing (strict: an address is
 *             taken apart with parse_url, checked piece by piece and built again from the checked pieces — nothing the
 *             operator typed reaches a page as it was typed; the server never fetches any of these addresses)
 *   all() · get($id) · create() · update() · setEnabled() · move() · delete()                    the admin tab
 *   setDocument() · addImage() · removeFile() · moveFile()                                        uploaded files
 *   publicList($user) → {v, lectures: [{id, title, kind, yt?, url?, files?: [{n, type, w, h, bytes}], place, autoplay,
 *             sort, office?}], opt: {autoOpen}}                                                    api/lecture/list.php
 *   fileFor($id, $n, $user) → the lecture_files row (404 for anything the caller may not see)     api/lecture/file.php
 *   stream($file, $lectureId)   the file with fixed headers: the stored type (never sniffed), nosniff, a sandbox CSP,
 *             inline for pdf / images and attachment for pptx, Cache-Control: private, ETag, one byte range
 *
 * Files live under data/lectures/<YYYY>/<MM>/<32 hex>.bin — private (data/ is never web-readable), random names, a
 * neutral extension: nothing of an upload is ever executed, included or served by the web server itself.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Lecture
{
    public const KINDS = ['youtube', 'slides', 'pdf', 'images', 'pptx', 'link'];
    /** kinds that carry uploaded files */
    public const FILE_KINDS = ['pdf', 'images', 'pptx'];
    public const AUDIENCES = ['all', 'member', 'paid', 'allot'];
    public const KIND_KO = [
        'youtube' => ['▶️', '유튜브 영상'], 'slides' => ['🖥️', '온라인 슬라이드'], 'pdf' => ['📄', 'PDF 문서'],
        'images' => ['🖼️', '그림 슬라이드'], 'pptx' => ['📊', '파워포인트(PPTX)'], 'link' => ['🔗', '바깥 링크(어른용)'],
    ];
    public const AUDIENCE_KO = ['all' => '누구나', 'member' => '로그인한 회원', 'paid' => '구독 회원', 'allot' => '분양 회원'];
    /** rooms the admin tab offers by name (any other id of the form PL_… is accepted too: new rooms need no change here) */
    public const PLACES = [
        'PL_DAECHEONG' => '대청마루 강의실', 'PL_ANBANG' => '안방', 'PL_SARANG' => '사랑방', 'PL_BUEOK' => '부엌', 'PL_BALHYO' => '발효실',
        'PL_GOTGAN' => '곳간', 'PL_HALL' => '본관 대강당', 'PL_EDU' => '교육관', 'PL_STORAGE' => '저장고', 'PL_SHOP' => '가게',
        'PL_OFFICE' => '본관 로비', 'PL_WORKSHOP' => '옹기 공방', 'PL_CAFE' => '찻집', 'PL_MYROOM' => '내 방', 'PL_ALLOT' => '만장대 단지',
    ];
    public const TITLE_MAX = 80;
    public const SRC_MAX = 500;
    /** the hosts a `slides` address may be on. Fixed in code (the page's CSP frame-src names exactly these); the operator
     *  setting lecture.slide_hosts can only take hosts away. */
    public const SLIDE_HOSTS = ['docs.google.com', 'view.officeapps.live.com'];
    public const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
    public const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    /** stored type → the extension of the download name (the only types a file is ever sent as) */
    public const TYPES = ['application/pdf' => 'pdf', self::MIME_PPTX => 'pptx', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    private const CACHE_LIST = 'lecture:list';
    private const NOT_FOUND = '강의 자료를 찾을 수 없어요.';

    // ------------------------------------------------------------------ settings
    /** an operator setting `lecture.<key>` (settings table), else the config value, else $default */
    public static function opt(string $key, $default)
    {
        try {
            return class_exists('Tfm\Settings') ? Settings::get('lecture.' . $key, $default) : Config::get('lecture.' . $key, $default);
        } catch (\Throwable $e) {
            return $default;
        }
    }

    private static function intOpt(string $key, int $default, int $min, int $max): int
    {
        $v = self::opt($key, $default);
        $n = is_int($v) || is_float($v) || (is_string($v) && is_numeric($v)) ? (int) $v : $default;
        return max($min, min($max, $n));
    }

    /** the limits of uploads and of the list (bytes / counts), each clamped to a sane range */
    public static function limits(): array
    {
        return [
            'pdf' => self::intOpt('pdf_max_bytes', 30 * 1048576, 1048576, 200 * 1048576),
            'pptx' => self::intOpt('pptx_max_bytes', 50 * 1048576, 1048576, 200 * 1048576),
            'image' => self::intOpt('image_max_bytes', 5 * 1048576, 262144, 20 * 1048576),
            'images' => self::intOpt('images_max', 80, 1, 200),
            'dimension' => self::intOpt('image_max_dimension', 1920, 320, 4096),
            'lectures' => self::intOpt('max_lectures', 300, 1, 2000),
        ];
    }

    /** the allow-listed slide hosts that are switched on (always a subset of SLIDE_HOSTS) */
    public static function slideHosts(): array
    {
        $v = self::opt('slide_hosts', self::SLIDE_HOSTS);
        if (!is_array($v)) return self::SLIDE_HOSTS;
        return array_values(array_intersect(self::SLIDE_HOSTS, array_map('strval', $v)));
    }

    /** the settings the admin tab changes: key → [type, min, max] (stored in the settings table as lecture.<key>) */
    public const SETTINGS = [
        'auto_open' => ['bool'], 'office_viewer' => ['bool'],
        'pdf_max_bytes' => ['mb', 1, 200], 'pptx_max_bytes' => ['mb', 1, 200], 'image_max_bytes' => ['mb', 1, 20],
        'images_max' => ['int', 1, 200], 'slide_hosts' => ['hosts'],
    ];

    /**
     * Store one lecture setting (validated here; audited). The values live in the settings table next to the other
     * operator settings, so Settings::get() and the ⚙️ 설정 tab read the same rows.
     */
    public static function setOption(array $admin, string $key, $value): void
    {
        if (!isset(self::SETTINGS[$key])) throw new ApiException(400, 'INVALID_SETTING', '바꿀 수 없는 설정이에요.');
        $rule = self::SETTINGS[$key];
        if ($rule[0] === 'bool') {
            $value = $value === true || $value === 1 || $value === '1' || $value === 'on';
        } elseif ($rule[0] === 'mb' || $rule[0] === 'int') {
            if (!(is_int($value) || (is_string($value) && preg_match('/^\d{1,4}$/', $value)))) throw new ApiException(400, 'INVALID_SETTING', '숫자로 적어 주세요.');
            $n = (int) $value;
            if ($n < $rule[1] || $n > $rule[2]) throw new ApiException(400, 'INVALID_SETTING', "{$rule[1]}~{$rule[2]} 사이의 숫자로 적어 주세요.");
            $value = $rule[0] === 'mb' ? $n * 1048576 : $n;
        } else {
            $value = array_values(array_intersect(self::SLIDE_HOSTS, is_array($value) ? array_map('strval', $value) : []));
        }
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) throw new ApiException(400, 'INVALID_SETTING', '설정 값을 저장하지 못했어요.');
        $aid = isset($admin['id']) ? (int) $admin['id'] : 0;
        Db::upsert('settings', ['k' => 'lecture.' . $key, 'v' => $json, 'updated_at' => Clock::ms(), 'updated_by' => $aid ?: null], ['k']);
        if (class_exists('Tfm\Settings')) Settings::reset();
        self::bump();
        Audit::log('setting_changed', $aid ?: null, ['key' => 'lecture.' . $key, 'value' => $value], 'warn', $aid ?: null);
    }

    // ------------------------------------------------------------------ addresses
    /** the first checks every typed address gets: a short single line of visible characters without a backslash */
    private static function tidy(string $in): ?string
    {
        $s = trim($in);
        if ($s === '' || strlen($s) > self::SRC_MAX * 4 || !mb_check_encoding($s, 'UTF-8') || mb_strlen($s) > self::SRC_MAX) return null;
        if (preg_match('/[\x00-\x20\x7f\\\\"<>`]/', $s)) return null;   // control characters, spaces, backslash, quotes, angle brackets
        return $s;
    }

    /** scheme, host, path, query of an http(s) address — null for userinfo, a port, a strange host or anything else */
    private static function parts(string $s, bool $allowPort = false): ?array
    {
        $u = @parse_url($s);
        if (!is_array($u) || !isset($u['scheme'], $u['host'])) return null;
        $scheme = strtolower((string) $u['scheme']);
        if ($scheme !== 'https' && $scheme !== 'http') return null;
        if (isset($u['user']) || isset($u['pass'])) return null;        // https://youtube.com@evil.example/…
        if (isset($u['port']) && !$allowPort) return null;
        $host = strtolower((string) $u['host']);
        // a DNS name of letters, digits, dots and hyphens (IDN only in its xn-- form); no IP literal brackets, no %
        if (strlen($host) > 253 || !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $host)) return null;
        return [
            'scheme' => $scheme, 'host' => $host, 'port' => isset($u['port']) ? (int) $u['port'] : 0,
            'path' => isset($u['path']) ? (string) $u['path'] : '/', 'query' => isset($u['query']) ? (string) $u['query'] : '',
            'fragment' => isset($u['fragment']) ? (string) $u['fragment'] : '',
        ];
    }

    /** one query value as a plain string (a repeated or array-shaped key is refused) */
    private static function queryValue(string $query, string $key): ?string
    {
        if ($query === '') return null;
        $found = null;
        foreach (explode('&', $query) as $pair) {
            if ($pair === '') continue;
            $eq = strpos($pair, '=');
            $k = rawurldecode(str_replace('+', ' ', $eq === false ? $pair : substr($pair, 0, $eq)));
            if ($k === $key . '[]' || strpos($k, $key . '[') === 0) return null;
            if ($k !== $key) continue;
            if ($found !== null) return null;                            // v=…&v=…
            $found = rawurldecode(str_replace('+', ' ', $eq === false ? '' : substr($pair, $eq + 1)));
        }
        return $found;
    }

    /**
     * The 11-character id of a YouTube video from any usual address form — watch?v=, youtu.be/, /embed/, /shorts/,
     * /live/, /v/, the m. / music. hosts, youtube-nocookie.com/embed/, with or without https:// — or the bare id.
     * null for everything else (another host, a look-alike host, userinfo, a port, a wrong length, hostile characters).
     */
    public static function youtubeId(string $in): ?string
    {
        $s = self::tidy($in);
        if ($s === null) return null;
        if (preg_match('/^[A-Za-z0-9_-]{11}$/', $s)) return $s;
        if (strpos($s, '//') === 0) $s = 'https:' . $s;
        elseif (!preg_match('#^[A-Za-z][A-Za-z0-9+.-]*:#', $s) && preg_match('#^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/#i', $s)) $s = 'https://' . $s;
        $u = self::parts($s);
        if ($u === null || !in_array($u['host'], self::YT_HOSTS, true)) return null;
        $path = $u['path'];
        $id = null;
        if ($u['host'] === 'youtu.be' || $u['host'] === 'www.youtu.be') {
            if (preg_match('#^/([^/?\#]+)/?$#', $path, $m)) $id = $m[1];
        } elseif (preg_match('#^/(?:embed|shorts|live|v)/([^/?\#]+)/?$#', $path, $m)) {
            $id = $m[1];
        } elseif (preg_match('#^/watch/?$#', $path)) {
            $id = self::queryValue($u['query'], 'v');
        }
        return is_string($id) && preg_match('/^[A-Za-z0-9_-]{11}$/', $id) ? $id : null;
    }

    /**
     * An embeddable slide address on an allow-listed host, built again from its checked pieces:
     *   docs.google.com/presentation/d/e/<published id>/pub|embed   → …/d/e/<id>/embed?start=false&loop=false&delayms=60000
     *   docs.google.com/presentation/d/<file id>/edit|preview|…     → …/d/<id>/preview
     *   view.officeapps.live.com/op/view.aspx|embed.aspx?src=<https address of a file> → …/op/embed.aspx?src=<encoded>
     * null for another host, http, a port, userinfo or a path that is not one of these forms.
     */
    public static function slidesUrl(string $in): ?string
    {
        $s = self::tidy($in);
        if ($s === null) return null;
        $u = self::parts($s);
        if ($u === null || $u['scheme'] !== 'https' || !in_array($u['host'], self::slideHosts(), true)) return null;
        if ($u['host'] === 'docs.google.com') {
            if (preg_match('#^/presentation/d/e/([A-Za-z0-9_-]{20,200})/(?:pub|embed|pubembed)/?$#', $u['path'], $m)) {
                return 'https://docs.google.com/presentation/d/e/' . $m[1] . '/embed?start=false&loop=false&delayms=60000';
            }
            if (preg_match('#^/presentation/d/([A-Za-z0-9_-]{20,200})(?:/(?:edit|preview|embed|pub|present|view|htmlpresent)?)?/?$#', $u['path'], $m) && $m[1] !== 'e') {
                return 'https://docs.google.com/presentation/d/' . $m[1] . '/preview';
            }
            return null;
        }
        if ($u['host'] === 'view.officeapps.live.com') {
            if (!preg_match('#^/op/(?:view|embed)\.aspx$#i', $u['path'])) return null;
            $src = self::queryValue($u['query'], 'src');
            $inner = is_string($src) ? self::linkUrl(str_replace(' ', '%20', $src)) : null;
            return $inner === null ? null : 'https://view.officeapps.live.com/op/embed.aspx?src=' . rawurlencode($inner);
        }
        return null;
    }

    /** any other https address (a button for grown-ups), built again from its pieces; null when it is not one */
    public static function linkUrl(string $in): ?string
    {
        $s = self::tidy($in);
        if ($s === null) return null;
        $u = self::parts($s, true);
        if ($u === null || $u['scheme'] !== 'https') return null;
        if ($u['port'] !== 0 && ($u['port'] < 1 || $u['port'] > 65535)) return null;
        // path / query / fragment: bytes outside the unreserved + reserved ASCII set are percent-encoded
        $enc = function (string $p): string {
            return (string) preg_replace_callback('/[^A-Za-z0-9\-._~:\/?\#\[\]@!$&\'()*+,;=%]/', function ($m) { return rawurlencode($m[0]); }, $p);
        };
        $out = 'https://' . $u['host'] . ($u['port'] !== 0 && $u['port'] !== 443 ? ':' . $u['port'] : '') . $enc($u['path'] === '' ? '/' : $u['path']);
        if ($u['query'] !== '') $out .= '?' . $enc($u['query']);
        if ($u['fragment'] !== '') $out .= '#' . $enc($u['fragment']);
        return strlen($out) <= self::SRC_MAX ? $out : null;
    }

    /** what a typed address is: ['kind' => 'youtube' | 'slides' | 'link', 'src' => the checked value] or null */
    public static function classify(string $in): ?array
    {
        $yt = self::youtubeId($in);
        if ($yt !== null) return ['kind' => 'youtube', 'src' => $yt];
        // an address on a video host that is not a video (a channel, a playlist) is not quietly kept as a link
        $s = self::tidy($in);
        $u = $s === null ? null : self::parts(preg_match('#^[A-Za-z][A-Za-z0-9+.-]*:#', $s) ? $s : 'https://' . ltrim($s, '/'));
        if ($u !== null && in_array($u['host'], self::YT_HOSTS, true)) return null;
        $sl = self::slidesUrl($in);
        if ($sl !== null) return ['kind' => 'slides', 'src' => $sl];
        if ($u !== null && in_array($u['host'], self::SLIDE_HOSTS, true)) return null;   // an allow-listed host, but not an embeddable form
        $ln = self::linkUrl($in);
        return $ln !== null ? ['kind' => 'link', 'src' => $ln] : null;
    }

    public static function validPlace(string $p): bool
    {
        return $p === '' || $p === '*' || preg_match('/^PL_[A-Z0-9_]{2,24}$/', $p) === 1;
    }

    /** the title as stored: cleaned text of 1…TITLE_MAX characters */
    public static function cleanTitle($t): string
    {
        if (!is_string($t)) throw new ApiException(400, 'INVALID_INPUT', '강의 제목을 적어 주세요.');
        if (strlen($t) > self::TITLE_MAX * 8) throw new ApiException(400, 'INVALID_INPUT', '강의 제목이 너무 길어요. (최대 ' . self::TITLE_MAX . '자)');
        $c = Users::cleanText($t, self::TITLE_MAX + 1);
        if ($c === '') throw new ApiException(400, 'INVALID_INPUT', '강의 제목을 적어 주세요.');
        if (mb_strlen($c) > self::TITLE_MAX) throw new ApiException(400, 'INVALID_INPUT', '강의 제목이 너무 길어요. (최대 ' . self::TITLE_MAX . '자)');
        return $c;
    }

    // ------------------------------------------------------------------ storage
    /** data/lectures (created on first use with the deny rules of a private folder) */
    public static function dir(): string
    {
        $d = Config::dataDir() . DIRECTORY_SEPARATOR . 'lectures';
        Config::ensureDir($d, true);
        return $d;
    }

    /** a fresh random relative path "YYYY/MM/<32 hex>.bin" (its folder exists afterwards) */
    public static function newPath(): string
    {
        $sub = date('Y') . '/' . date('m');
        $dir = self::dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $sub);
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) throw new \RuntimeException('lecture dir not writable');
        return $sub . '/' . bin2hex(random_bytes(16)) . '.bin';
    }

    /** the absolute path of a stored relative path — only the form newPath() makes, only a file that is there */
    public static function absPath(string $rel): ?string
    {
        if (!preg_match('#^(\d{4})/(\d{2})/([a-f0-9]{32}\.bin)$#', $rel, $m)) return null;
        $abs = self::dir() . DIRECTORY_SEPARATOR . $m[1] . DIRECTORY_SEPARATOR . $m[2] . DIRECTORY_SEPARATOR . $m[3];
        return is_file($abs) ? $abs : null;
    }

    private static function unlinkRel(string $rel): void
    {
        $abs = self::absPath($rel);
        if ($abs !== null) @unlink($abs);
    }

    /** bytes of every stored lecture file together (the admin tab shows it; uploads stop at lecture.storage_max_bytes) */
    public static function storageUsed(): int
    {
        return (int) Db::value('SELECT COALESCE(SUM(bytes), 0) FROM lecture_files');
    }

    /** bytes that may still be stored (0 = full) */
    public static function storageLeft(): int
    {
        return max(0, self::intOpt('storage_max_bytes', 2147483647, 10485760, 107374182400) - self::storageUsed());
    }

    /** forget the cached list (every change calls it) */
    public static function bump(): void
    {
        try { if (class_exists('Tfm\Cache')) Cache::del(self::CACHE_LIST); } catch (\Throwable $e) { /* expires in a minute */ }
    }

    // ------------------------------------------------------------------ reading
    private static function row(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'title' => (string) $r['title'], 'kind' => (string) $r['kind'], 'src' => (string) $r['src'],
            'place' => (string) $r['place'], 'autoplay' => (int) $r['autoplay'] === 1, 'audience' => (string) $r['audience'],
            'sort' => (int) $r['sort'], 'enabled' => (int) $r['enabled'] === 1, 'createdAt' => (int) $r['created_at'], 'updatedAt' => (int) $r['updated_at'],
            'files' => [],
        ];
    }

    private static function fileRow(array $f): array
    {
        return ['n' => (int) $f['n'], 'mime' => (string) $f['mime'], 'bytes' => (int) $f['bytes'], 'w' => (int) $f['w'], 'h' => (int) $f['h'], 'path' => (string) $f['path'], 'sha256' => (string) $f['sha256']];
    }

    /** every lecture with its files, in list order (the admin tab) */
    public static function all(bool $enabledOnly = false): array
    {
        $rows = $enabledOnly
            ? Db::all('SELECT * FROM lectures WHERE enabled = 1 ORDER BY sort, id LIMIT 2000')
            : Db::all('SELECT * FROM lectures ORDER BY sort, id LIMIT 2000');
        $out = [];
        foreach ($rows as $r) $out[(int) $r['id']] = self::row($r);
        if ($out) {
            foreach (Db::all('SELECT lecture_id, n, mime, bytes, w, h, path, sha256 FROM lecture_files ORDER BY lecture_id, n LIMIT 100000') as $f) {
                $lid = (int) $f['lecture_id'];
                if (isset($out[$lid])) $out[$lid]['files'][] = self::fileRow($f);
            }
        }
        return array_values($out);
    }

    public static function get(int $id): ?array
    {
        $r = Db::one('SELECT * FROM lectures WHERE id = ?', [$id]);
        if (!$r) return null;
        $l = self::row($r);
        foreach (Db::all('SELECT lecture_id, n, mime, bytes, w, h, path, sha256 FROM lecture_files WHERE lecture_id = ? ORDER BY n', [$id]) as $f) $l['files'][] = self::fileRow($f);
        return $l;
    }

    private static function need(int $id): array
    {
        $l = $id > 0 ? self::get($id) : null;
        if ($l === null) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        return $l;
    }

    // ------------------------------------------------------------------ writing (the admin tab; every change is audited)
    private static function aid(array $admin): int
    {
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        return (int) $admin['id'];
    }

    /** the fields every form carries: place, audience, autoplay, enabled (checked; defaults for what is absent) */
    private static function common(array $in, array $base = []): array
    {
        $place = isset($in['place']) ? $in['place'] : (isset($base['place']) ? $base['place'] : '');
        if (!is_string($place) || !self::validPlace($place)) throw new ApiException(400, 'INVALID_INPUT', '강의를 보여 줄 장소가 올바르지 않아요.');
        $aud = isset($in['audience']) ? $in['audience'] : (isset($base['audience']) ? $base['audience'] : 'all');
        if (!is_string($aud) || !in_array($aud, self::AUDIENCES, true)) throw new ApiException(400, 'INVALID_INPUT', '볼 수 있는 사람 항목이 올바르지 않아요.');
        $flag = function ($k, $d) use ($in, $base) {
            if (array_key_exists($k, $in)) return $in[$k] === true || $in[$k] === 1 || $in[$k] === '1' || $in[$k] === 'on' ? 1 : 0;
            return isset($base[$k]) ? ($base[$k] ? 1 : 0) : $d;
        };
        return ['place' => $place, 'audience' => $aud, 'autoplay' => $flag('autoplay', 0), 'enabled' => $flag('enabled', 1)];
    }

    /**
     * A new lecture. $in: title, place, audience, autoplay, enabled and — for the address kinds — `address` (the kind
     * is what the address is: a video, an allow-listed slide address or a plain link); for the file kinds `kind`
     * (pdf | images | pptx; the files are attached afterwards with setDocument / addImage). Returns the lecture.
     */
    public static function create(array $admin, array $in): array
    {
        $aid = self::aid($admin);
        $title = self::cleanTitle(isset($in['title']) ? $in['title'] : null);
        $c = self::common($in);
        if (isset($in['kind']) && in_array($in['kind'], self::FILE_KINDS, true)) {
            $kind = (string) $in['kind'];
            $src = '';
        } else {
            $what = isset($in['address']) && is_string($in['address']) ? self::classify($in['address']) : null;
            if ($what === null) throw new ApiException(400, 'LECTURE_ADDRESS', '주소를 알아보지 못했어요. 유튜브 영상 주소, 구글 슬라이드 "웹에 게시" 주소, 또는 https:// 로 시작하는 주소를 넣어 주세요.');
            $kind = $what['kind'];
            $src = $what['src'];
        }
        if ((int) Db::value('SELECT COUNT(*) FROM lectures') >= self::limits()['lectures']) throw new ApiException(400, 'LECTURE_LIMIT', '강의가 너무 많아요. 쓰지 않는 강의를 지운 뒤 다시 해 주세요.');
        $now = Clock::ms();
        $sort = (int) Db::value('SELECT COALESCE(MAX(sort), 0) FROM lectures') + 10;
        $id = Db::insert('lectures', ['title' => $title, 'kind' => $kind, 'src' => $src, 'place' => $c['place'], 'autoplay' => $c['autoplay'], 'audience' => $c['audience'],
            'sort' => $sort, 'enabled' => $c['enabled'], 'created_at' => $now, 'updated_at' => $now]);
        self::bump();
        Audit::log('lecture_created', null, ['id' => $id, 'kind' => $kind, 'place' => $c['place'], 'audience' => $c['audience']], 'info', $aid);
        return self::need($id);
    }

    /** change title / place / audience / autoplay / enabled and — for an address kind — the address (which may change the kind among the address kinds) */
    public static function update(array $admin, int $id, array $in): array
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        $set = self::common($in, $l);
        if (array_key_exists('title', $in)) $set['title'] = self::cleanTitle($in['title']);
        if (array_key_exists('address', $in) && !in_array($l['kind'], self::FILE_KINDS, true)) {
            $what = is_string($in['address']) ? self::classify($in['address']) : null;
            if ($what === null) throw new ApiException(400, 'LECTURE_ADDRESS', '주소를 알아보지 못했어요. 유튜브 영상 주소, 구글 슬라이드 "웹에 게시" 주소, 또는 https:// 로 시작하는 주소를 넣어 주세요.');
            $set['kind'] = $what['kind'];
            $set['src'] = $what['src'];
        }
        // one fixed statement: what the form did not send keeps its value
        Db::exec('UPDATE lectures SET title = ?, kind = ?, src = ?, place = ?, audience = ?, autoplay = ?, enabled = ?, updated_at = ? WHERE id = ?', [
            isset($set['title']) ? $set['title'] : $l['title'], isset($set['kind']) ? $set['kind'] : $l['kind'], isset($set['src']) ? $set['src'] : $l['src'],
            $set['place'], $set['audience'], $set['autoplay'], $set['enabled'], Clock::ms(), $id,
        ]);
        self::bump();
        Audit::log('lecture_updated', null, ['id' => $id, 'kind' => isset($set['kind']) ? $set['kind'] : $l['kind'], 'place' => $set['place'], 'audience' => $set['audience']], 'info', $aid);
        return self::need($id);
    }

    public static function setEnabled(array $admin, int $id, bool $on): array
    {
        $aid = self::aid($admin);
        self::need($id);
        Db::exec('UPDATE lectures SET enabled = ?, updated_at = ? WHERE id = ?', [$on ? 1 : 0, Clock::ms(), $id]);
        self::bump();
        Audit::log('lecture_switched', null, ['id' => $id, 'on' => $on], 'info', $aid);
        return self::need($id);
    }

    /** one step up (-1) or down (+1) in the list: the sort numbers are renumbered 10, 20, 30 … with the two swapped */
    public static function move(array $admin, int $id, int $dir): void
    {
        $aid = self::aid($admin);
        self::need($id);
        $ids = array_map(function ($r) { return (int) $r['id']; }, Db::all('SELECT id FROM lectures ORDER BY sort, id LIMIT 2000'));
        $i = array_search($id, $ids, true);
        $j = $i + ($dir < 0 ? -1 : 1);
        if ($i === false || $j < 0 || $j >= count($ids)) return;
        $t = $ids[$i];
        $ids[$i] = $ids[$j];
        $ids[$j] = $t;
        $now = Clock::ms();
        Db::tx(function () use ($ids, $now) {
            foreach ($ids as $k => $lid) Db::exec('UPDATE lectures SET sort = ?, updated_at = ? WHERE id = ? AND sort <> ?', [($k + 1) * 10, $now, $lid, ($k + 1) * 10]);
        });
        self::bump();
        Audit::log('lecture_moved', null, ['id' => $id, 'dir' => $dir < 0 ? 'up' : 'down'], 'info', $aid);
    }

    public static function delete(array $admin, int $id): void
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        Db::tx(function () use ($id) {
            Db::exec('DELETE FROM lecture_files WHERE lecture_id = ?', [$id]);
            Db::exec('DELETE FROM lectures WHERE id = ?', [$id]);
        });
        foreach ($l['files'] as $f) self::unlinkRel($f['path']);
        self::bump();
        Audit::log('lecture_deleted', null, ['id' => $id, 'kind' => $l['kind'], 'files' => count($l['files'])], 'warn', $aid);
    }

    /** $stored = what Upload::lectureFile returned: ['path', 'mime', 'bytes', 'w', 'h', 'sha256'] — only the known shapes pass */
    private static function storedRow(array $s): array
    {
        $path = isset($s['path']) ? (string) $s['path'] : '';
        $mime = isset($s['mime']) ? (string) $s['mime'] : '';
        $sha = isset($s['sha256']) ? (string) $s['sha256'] : '';
        if (self::absPath($path) === null || !isset(self::TYPES[$mime]) || !preg_match('/^[a-f0-9]{64}$/', $sha)) throw new \RuntimeException('lecture file record refused');
        return ['mime' => $mime, 'bytes' => max(0, (int) (isset($s['bytes']) ? $s['bytes'] : 0)), 'w' => max(0, (int) (isset($s['w']) ? $s['w'] : 0)), 'h' => max(0, (int) (isset($s['h']) ? $s['h'] : 0)), 'path' => $path, 'sha256' => $sha];
    }

    /** the one file of a pdf / pptx lecture: attach it, or replace the one that is there (the old file is removed) */
    public static function setDocument(array $admin, int $id, array $stored): array
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        $row = self::storedRow($stored);
        $want = $l['kind'] === 'pdf' ? 'application/pdf' : ($l['kind'] === 'pptx' ? self::MIME_PPTX : '');
        if ($want === '' || $row['mime'] !== $want) throw new ApiException(400, 'INVALID_INPUT', '이 강의에는 그 종류의 파일을 넣을 수 없어요.');
        Db::tx(function () use ($id, $row) {
            Db::exec('DELETE FROM lecture_files WHERE lecture_id = ?', [$id]);
            Db::insert('lecture_files', ['lecture_id' => $id, 'n' => 0] + $row);
            Db::exec('UPDATE lectures SET updated_at = ? WHERE id = ?', [Clock::ms(), $id]);
        });
        foreach ($l['files'] as $f) if ($f['path'] !== $row['path']) self::unlinkRel($f['path']);
        self::bump();
        Audit::log('lecture_file', null, ['id' => $id, 'kind' => $l['kind'], 'bytes' => $row['bytes'], 'replaced' => count($l['files']) > 0], 'info', $aid);
        return self::need($id);
    }

    /** one more picture at the end of an image deck (≤ lecture.images_max) */
    public static function addImage(array $admin, int $id, array $stored): array
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        $row = self::storedRow($stored);
        if ($l['kind'] !== 'images' || strpos($row['mime'], 'image/') !== 0) throw new ApiException(400, 'INVALID_INPUT', '이 강의에는 그 종류의 파일을 넣을 수 없어요.');
        if (count($l['files']) >= self::limits()['images']) throw new ApiException(400, 'LECTURE_LIMIT', '그림은 강의 하나에 ' . self::limits()['images'] . '장까지 넣을 수 있어요.');
        $n = (int) Db::value('SELECT COALESCE(MAX(n), -1) FROM lecture_files WHERE lecture_id = ?', [$id]) + 1;
        Db::insert('lecture_files', ['lecture_id' => $id, 'n' => $n] + $row);
        Db::exec('UPDATE lectures SET updated_at = ? WHERE id = ?', [Clock::ms(), $id]);
        self::bump();
        Audit::log('lecture_file', null, ['id' => $id, 'kind' => 'images', 'n' => $n, 'bytes' => $row['bytes']], 'info', $aid);
        return self::need($id);
    }

    /** remove one file; the others are renumbered 0 … n−1 in their order */
    public static function removeFile(array $admin, int $id, int $n): array
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        $gone = null;
        foreach ($l['files'] as $f) if ($f['n'] === $n) $gone = $f;
        if ($gone === null) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        Db::tx(function () use ($id, $n) {
            Db::exec('DELETE FROM lecture_files WHERE lecture_id = ? AND n = ?', [$id, $n]);
            self::renumber($id);
            Db::exec('UPDATE lectures SET updated_at = ? WHERE id = ?', [Clock::ms(), $id]);
        });
        self::unlinkRel($gone['path']);
        self::bump();
        Audit::log('lecture_file_removed', null, ['id' => $id, 'n' => $n], 'info', $aid);
        return self::need($id);
    }

    /** one picture a step earlier (-1) or later (+1) */
    public static function moveFile(array $admin, int $id, int $n, int $dir): array
    {
        $aid = self::aid($admin);
        $l = self::need($id);
        $order = array_map(function ($f) { return $f['n']; }, $l['files']);
        $i = array_search($n, $order, true);
        $j = $i + ($dir < 0 ? -1 : 1);
        if ($i === false) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        if ($j < 0 || $j >= count($order)) return $l;
        $a = $order[$i];
        $b = $order[$j];
        Db::tx(function () use ($id, $a, $b) {
            // the pair (lecture_id, n) is unique: go through a number nobody has
            Db::exec('UPDATE lecture_files SET n = ? WHERE lecture_id = ? AND n = ?', [-1, $id, $a]);
            Db::exec('UPDATE lecture_files SET n = ? WHERE lecture_id = ? AND n = ?', [$a, $id, $b]);
            Db::exec('UPDATE lecture_files SET n = ? WHERE lecture_id = ? AND n = ?', [$b, $id, -1]);
            Db::exec('UPDATE lectures SET updated_at = ? WHERE id = ?', [Clock::ms(), $id]);
        });
        self::bump();
        Audit::log('lecture_file_moved', null, ['id' => $id, 'n' => $n, 'dir' => $dir < 0 ? 'up' : 'down'], 'info', $aid);
        return self::need($id);
    }

    private static function renumber(int $id): void
    {
        $k = 0;
        foreach (Db::all('SELECT id, n FROM lecture_files WHERE lecture_id = ? ORDER BY n', [$id]) as $f) {
            if ((int) $f['n'] !== $k) Db::exec('UPDATE lecture_files SET n = ? WHERE id = ?', [$k, (int) $f['id']]);
            $k++;
        }
    }

    // ------------------------------------------------------------------ who may see what
    /**
     * What the caller is: ['admin', 'member', 'paid', 'allot'] booleans. paid / allot cost a query each, so they are
     * looked up only when a lecture asks (lazy) and remembered for a minute per account.
     */
    public static function flags(?array $user): array
    {
        $uid = $user && isset($user['id']) ? (int) $user['id'] : 0;
        return ['uid' => $uid, 'member' => $uid > 0, 'admin' => $uid > 0 && (isset($user['role']) ? $user['role'] : '') === 'admin', 'user' => $user, 'paid' => null, 'allot' => null];
    }

    private static function lazy(array &$fl, string $what): bool
    {
        if ($fl[$what] !== null) return (bool) $fl[$what];
        $uid = (int) $fl['uid'];
        if ($uid <= 0) return $fl[$what] = false;
        $key = 'lecture:aud:' . $uid;
        $c = null;
        try { $c = class_exists('Tfm\Cache') ? Cache::get($key) : null; } catch (\Throwable $e) { $c = null; }
        if (!is_array($c)) $c = [];
        if (!array_key_exists($what, $c)) {
            $c[$what] = $what === 'paid' ? self::isPaid($uid, $fl['user']) : self::hasContract($uid);
            try { if (class_exists('Tfm\Cache')) Cache::set($key, $c, 60); } catch (\Throwable $e) { /* asked again next time */ }
        }
        return $fl[$what] = (bool) $c[$what];
    }

    private static function isPaid(int $uid, $user): bool
    {
        try {
            if (class_exists('Tfm\Entitle') && is_array($user)) {
                $ent = Entitle::forUser($user);
                if (is_array($ent) && array_key_exists('paid', $ent)) return !empty($ent['paid']);
            }
            return class_exists('Tfm\Subscription') && Subscription::tierFor($uid) > 1;
        } catch (\Throwable $e) {
            return false;
        }
    }

    private static function hasContract(int $uid): bool
    {
        try {
            return (int) Db::value("SELECT COUNT(*) FROM allot_contracts WHERE user_id = ? AND status IN ('active', 'overdue')", [$uid]) > 0;
        } catch (\Throwable $e) {
            return false; // a database without the allotment tables
        }
    }

    /** may the caller see a lecture of this audience */
    public static function allowed(string $audience, array &$fl): bool
    {
        if ($fl['admin'] || $audience === 'all') return true;
        if (!$fl['member']) return false;
        if ($audience === 'member') return true;
        if ($audience === 'paid') return self::lazy($fl, 'paid');
        if ($audience === 'allot') return self::lazy($fl, 'allot');
        return false;
    }

    /** the enabled lectures with their files (shared cache, one minute; dropped by every change) */
    private static function enabledList(): array
    {
        try {
            if (class_exists('Tfm\Cache')) {
                $c = Cache::get(self::CACHE_LIST);
                if (is_array($c)) return $c;
            }
        } catch (\Throwable $e) { /* read the database */ }
        $list = self::all(true);
        try { if (class_exists('Tfm\Cache')) Cache::set(self::CACHE_LIST, $list, 60); } catch (\Throwable $e) { /* next request reads again */ }
        return $list;
    }

    /** api/lecture/list.php: what THIS caller may see */
    public static function publicList(?array $user): array
    {
        $fl = self::flags($user);
        $hosts = self::slideHosts();
        // only an allow-listed host that is switched on is ever framed — the Office viewer is one of them
        $office = self::opt('office_viewer', false) === true && in_array('view.officeapps.live.com', $hosts, true) && Http::isHttps() && !Http::isLocalhost();
        $out = [];
        foreach (self::enabledList() as $l) {
            if (!self::allowed($l['audience'], $fl)) continue;
            $o = ['id' => $l['id'], 'title' => $l['title'], 'kind' => $l['kind'], 'place' => $l['place'], 'autoplay' => $l['autoplay'], 'sort' => $l['sort']];
            if ($l['kind'] === 'youtube') {
                $o['yt'] = $l['src'];
            } elseif ($l['kind'] === 'slides') {
                // a host the operator switched off after this lecture was added: not offered (it comes back with the host)
                if (!in_array(strtolower((string) parse_url($l['src'], PHP_URL_HOST)), $hosts, true)) continue;
                $o['url'] = $l['src'];
            } elseif ($l['kind'] === 'link') {
                $o['url'] = $l['src'];
            } else {
                $files = [];
                foreach ($l['files'] as $f) $files[] = ['n' => $f['n'], 'type' => $f['mime'], 'w' => $f['w'], 'h' => $f['h'], 'bytes' => $f['bytes']];
                if (!$files) continue;   // a file lecture without its file is not shown
                $o['files'] = $files;
                // the Office viewer fetches the file from outside without a login: only a lecture everybody may see
                if ($l['kind'] === 'pptx' && $office && $l['audience'] === 'all') $o['office'] = true;
            }
            $out[] = $o;
        }
        $auto = self::opt('auto_open', true) !== false;
        $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        // the option is part of the version: a caller that holds this list still learns that auto-open was switched
        return ['v' => (int) sprintf('%u', crc32((is_string($json) ? $json : '') . ($auto ? '|a1' : '|a0'))), 'lectures' => $out, 'opt' => ['autoOpen' => $auto]];
    }

    /**
     * api/lecture/file.php: the file row of lecture $id, number $n, for this caller. Everything that is not there, not
     * switched on, or not for this caller's audience is the same 404 (an id never tells whether a lecture exists).
     */
    public static function fileFor(int $id, int $n, ?array $user): array
    {
        $fl = self::flags($user);
        foreach (self::enabledList() as $l) {
            if ($l['id'] !== $id) continue;
            if (!self::allowed($l['audience'], $fl)) break;
            foreach ($l['files'] as $f) if ($f['n'] === $n) return $f;
            break;
        }
        throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
    }

    // ------------------------------------------------------------------ sending a file
    /**
     * Send one stored file and end the request. The type is the stored one (a fixed list), never taken from the bytes
     * or a name; X-Content-Type-Options: nosniff; the CSP makes whatever a browser renders from it a sandboxed, inert
     * document (no script, no form, no plug-in); a pdf may be framed by this site only; a pptx is always a download.
     * One byte range (bytes=a-b | a- | -n) is served with 206; several ranges or another unit get the whole file.
     */
    public static function stream(array $f, int $lectureId, bool $noStore = false): void
    {
        $mime = isset($f['mime']) ? (string) $f['mime'] : '';
        $abs = self::absPath(isset($f['path']) ? (string) $f['path'] : '');
        if ($abs === null || !isset(self::TYPES[$mime])) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        $size = @filesize($abs);
        if (!is_int($size) || $size <= 0) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        $ext = self::TYPES[$mime];
        $sha = isset($f['sha256']) ? (string) $f['sha256'] : '';
        $etag = '"' . (preg_match('/^[a-f0-9]{64}$/', $sha) ? substr($sha, 0, 32) : dechex($size)) . '"';
        $method = Http::method();
        $start = 0;
        $end = $size - 1;
        $status = 200;
        $inm = isset($_SERVER['HTTP_IF_NONE_MATCH']) && is_string($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
        $range = isset($_SERVER['HTTP_RANGE']) && is_string($_SERVER['HTTP_RANGE']) ? trim($_SERVER['HTTP_RANGE']) : '';
        $ifRange = isset($_SERVER['HTTP_IF_RANGE']) && is_string($_SERVER['HTTP_IF_RANGE']) ? trim($_SERVER['HTTP_IF_RANGE']) : '';
        if (!$noStore && $inm !== '' && $inm === $etag) {
            $status = 304;
        } elseif ($range !== '' && ($ifRange === '' || $ifRange === $etag) && preg_match('/^bytes=(\d{0,15})-(\d{0,15})$/', $range, $m) && ($m[1] !== '' || $m[2] !== '')) {
            if ($m[1] === '') {
                $last = (int) $m[2];
                if ($last <= 0) $status = 416; else { $start = max(0, $size - $last); $status = 206; }
            } else {
                $start = (int) $m[1];
                if ($m[2] !== '') $end = min($size - 1, (int) $m[2]);
                $status = ($start >= $size || $start > $end) ? 416 : 206;
            }
        }
        while (ob_get_level() > 0) @ob_end_clean();
        Http::securityHeaders('api');
        header_remove('Pragma');
        $name = 'lecture-' . $lectureId . (strpos($mime, 'image/') === 0 ? '-' . ((int) (isset($f['n']) ? $f['n'] : 0) + 1) : '') . '.' . $ext;
        header('Content-Type: ' . $mime);
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: ' . ($ext === 'pptx' ? 'attachment' : 'inline') . '; filename="' . $name . '"');
        // $noStore: the admin site's preview (its pages are never kept); the app's copies are private and revalidated by ETag
        header($noStore ? 'Cache-Control: no-store, max-age=0' : 'Cache-Control: private, max-age=60');
        header('ETag: ' . $etag);
        header('Accept-Ranges: bytes');
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        if ($ext === 'pdf') {
            // shown by the browser's own viewer inside a frame of this site and nowhere else
            header("Content-Security-Policy: " . self::PDF_CSP);
            header('X-Frame-Options: SAMEORIGIN');
        } else {
            header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox");
            header('X-Frame-Options: DENY');
        }
        Session::close();
        if ($status === 304) { http_response_code(304); exit; }
        if ($status === 416) { http_response_code(416); header('Content-Range: bytes */' . $size); header('Content-Length: 0'); exit; }
        $len = $end - $start + 1;
        http_response_code($status);
        if ($status === 206) header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
        header('Content-Length: ' . $len);
        if ($method === 'HEAD') exit;
        @set_time_limit(300);
        $fh = @fopen($abs, 'rb');
        if (!$fh) exit;
        if ($start > 0) fseek($fh, $start);
        $left = $len;
        while ($left > 0 && !feof($fh)) {
            $chunk = fread($fh, (int) min(65536, $left));
            if ($chunk === false || $chunk === '') break;
            $left -= strlen($chunk);
            echo $chunk;
            @flush();
            if (connection_aborted()) break;
        }
        fclose($fh);
        exit;
    }

    /**
     * The policy a pdf answer carries. `sandbox` makes the answer an inert document in every browser that would render
     * it as a page; the browser's pdf viewer is told by object-src / frame-ancestors that only this site may show it.
     */
    public const PDF_CSP = "default-src 'none'; object-src 'self'; frame-ancestors 'self'; sandbox";
}
