<?php
/**
 * Operator settings kept in the database (table `settings`, schema v6) — values an admin changes from the admin site
 * without editing files: the real-time farm time scale (`farm.rt_scale`), the kid AI helper switch (`ai.kid_helper`),
 * and since phase 9 (CONTRACT §17.2) every number of the site: prices, tiers on sale, limits, defaults of the app.
 * A missing row falls back to the config file value at the same dotted path, then to the registry's default, so
 * config.php stays the documented default. Values are JSON-encoded. Never store secrets here (keys live in
 * config.local.php / the environment): the admin tab only shows whether a secret is set.
 *
 * THE REGISTRY (CONTRACT §17.2 "Operator settings") — one row per setting an administrator may change in ⚙️ 설정:
 *
 *   Settings::define(key, type, default, range, group, label, public = false, hint = '')
 *     key     dotted, lower case ('limits.jars_free')
 *     type    'bool' | 'int' | 'float' | 'enum' | 'list' | 'str'
 *     range   int / float: [min, max] · enum / list: ['value' => 'label', …] · str: the maximum length · bool: null
 *     group   one of Settings::GROUPS (the sections of the tab)
 *     public  true: the value goes to every visitor's page as `site` (api/ping.php, api/auth/me.php → G.site.get(key));
 *             false: only the server and the admin tab see it. NEVER public: anything a child must not see (prices).
 *
 *   ADD-ONLY for every lane: put your rows into Settings::builtin() inside your own `// [lane]` block — one line per row.
 *   Reading: Settings::get('your.key') on the server (stored value → config value → the registry default),
 *   G.site.get('your.key', fallback) in the page (public rows only; event site:changed).
 *
 * Rows that are not in the registry (allot.*, internal markers) are still read by get() exactly as stored; set()
 * refuses every key that is not registered.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Settings
{
    /** @var array|null request-local cache of every row */
    private static $cache = null;
    /** @var array|null the registry: key => ['type', 'default', 'range', 'group', 'label', 'public', 'hint'] */
    private static $defs = null;

    /** the sections of ⚙️ 설정, in order: id => [icon, title] */
    public const GROUPS = [
        'sub'      => ['⚡', '구독·혜택'],
        'controls' => ['🎮', '조작'],
        'env'      => ['🌤️', '환경'],
        'sound'    => ['🎵', '소리'],
        'lecture'  => ['🎓', '강의'],
        'room'     => ['🏠', '방 꾸미기'],
        'notice'   => ['📢', '공지'],
        'admin'    => ['🔐', '관리자 보안'],
        'support'  => ['📮', '신고·문의'], // [support] CONTRACT §18.1
        'healing'  => ['🌿', '힐링관'], // [healing] CONTRACT §19.6
        'etc'      => ['🧩', '기타'],
    ];
    private const TYPES = ['bool', 'int', 'float', 'enum', 'list', 'str'];

    public static function reset(): void { self::$cache = null; self::forgetShared(); }

    /** [scale-server] drop the copy in the shared cache (a row was written): the next read asks the database */
    private static function forgetShared(): void
    {
        try { if (class_exists('Tfm\\Cache', false)) Cache::del('cfg:settings'); } catch (\Throwable $e) { /* expires in seconds */ }
    }

    // ------------------------------------------------------------------ the registry
    /**
     * Register one setting (see the file header). Called from builtin(); a second definition of the same key is
     * ignored (the first one wins), a malformed one is a programming error.
     */
    public static function define(string $key, string $type, $default, $range, string $group, string $label, bool $public = false, string $hint = ''): void
    {
        if (self::$defs === null) self::$defs = [];
        if (isset(self::$defs[$key])) return;
        if (!preg_match('/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}\z/', $key) || !in_array($type, self::TYPES, true) || !isset(self::GROUPS[$group])) {
            throw new \InvalidArgumentException('bad setting definition: ' . $key);
        }
        if (($type === 'int' || $type === 'float') && (!is_array($range) || count($range) !== 2)) throw new \InvalidArgumentException('a number needs [min, max]: ' . $key);
        if (($type === 'enum' || $type === 'list') && (!is_array($range) || !$range)) throw new \InvalidArgumentException('enum / list needs its values: ' . $key);
        if ($type === 'enum' || $type === 'list') {
            // a plain list of words is accepted too: the value is its own label
            $words = true;
            foreach ($range as $k => $v) if (!is_int($k) || !is_string($v)) $words = false;
            if ($words && array_keys($range) === range(0, count($range) - 1)) { $m = []; foreach ($range as $v) $m[(string) $v] = (string) $v; $range = $m; }
        }
        self::$defs[$key] = ['type' => $type, 'default' => $default, 'range' => $range, 'group' => $group, 'label' => $label, 'public' => $public, 'hint' => $hint];
    }

    /** every registered setting: key => definition */
    public static function defs(): array
    {
        if (self::$defs === null) { self::$defs = []; self::builtin(); }
        return self::$defs;
    }

    public static function isDefined(string $key): bool { $d = self::defs(); return isset($d[$key]); }

    /**
     * The rows of the registry. ADD-ONLY: every lane keeps its own block, one line per row, never reorders another
     * lane's lines. Defaults that also live in config.php (the 토스 prices) are read from there.
     */
    private static function builtin(): void
    {
        // ---------------------------------------------------------------- [entitle] 구독·혜택 (CONTRACT §17.2)
        $tiers = (array) Config::get('toss.tiers', []);
        $price = function (int $t, int $d) use ($tiers): int { return isset($tiers[$t]['price']) ? max(100, (int) $tiers[$t]['price']) : $d; };
        self::define('sub.tiers_on', 'list', [2, 3], [2 => '⚡ 2배', 3 => '⚡⚡ 3배', 4 => '⚡⚡⚡ 4배'], 'sub', '판매하는 단계', true, '체크한 단계만 구독 화면에 보이고 살 수 있어요. 이미 산 사람은 기간이 끝날 때까지 그대로 써요. 관리자는 체크한 단계 중 가장 높은 단계를 무료로 써요.');
        self::define('sub.price_2', 'int', $price(2, 2900), [100, 1000000], 'sub', '2배 단계 가격 (원)', false, '한 번 결제(이용 기간)의 금액이에요. 바꾸면 그다음 주문부터 적용돼요.');
        self::define('sub.price_3', 'int', $price(3, 4900), [100, 1000000], 'sub', '3배 단계 가격 (원)');
        self::define('sub.price_4', 'int', $price(4, 6900), [100, 1000000], 'sub', '4배 단계 가격 (원)');
        self::define('sub.period_days', 'int', max(1, (int) Config::get('toss.period_days', 30)), [1, 366], 'sub', '한 번 결제의 이용 기간 (일)');
        self::define('sub.grace_days', 'int', max(0, (int) Config::get('toss.grace_days', 3)), [0, 30], 'sub', '자동 갱신 실패 뒤 기다려 주는 기간 (일)');
        self::define('sub.move_2', 'int', 2, [1, 3], 'sub', '2배 단계 — 이동 속도 배수', false, '이동은 3배까지만 안전하게 맞춰져 있어요.');
        self::define('sub.grow_2', 'int', 2, [1, 4], 'sub', '2배 단계 — 작물·발효 속도 배수');
        self::define('sub.move_3', 'int', 3, [1, 3], 'sub', '3배 단계 — 이동 속도 배수');
        self::define('sub.grow_3', 'int', 3, [1, 4], 'sub', '3배 단계 — 작물·발효 속도 배수');
        self::define('sub.move_4', 'int', 3, [1, 3], 'sub', '4배 단계 — 이동 속도 배수');
        self::define('sub.grow_4', 'int', 4, [1, 4], 'sub', '4배 단계 — 작물·발효 속도 배수');
        self::define('limits.jars_free', 'int', 3, [1, 12], 'sub', '무료 계정의 항아리 수', true, '구독하지 않은 계정이 쓸 수 있는 내 항아리 수예요.');
        self::define('limits.jars_paid', 'int', 12, [1, 12], 'sub', '구독 계정·관리자의 항아리 수', true, '구독이 끝나면 이 수를 넘는 항아리는 잠기기만 하고 내용물은 그대로 남아요.');
        self::define('limits.room_items_free', 'int', 80, [0, 300], 'room', '무료 계정이 방에 놓을 수 있는 물건 수', true);
        self::define('limits.room_items_paid', 'int', 160, [0, 300], 'room', '구독 계정·관리자가 방에 놓을 수 있는 물건 수', true);
        // ---------------------------------------------------------------- [entitle] 공지 · 관리자 보안 · 기타 (older keys keep their meaning)
        self::define('security.notice', 'str', '', 200, 'notice', '체험관 공지 한 줄', true, '모든 방문자의 화면에 한 번 보여 주는 짧은 알림이에요 (200자까지). 비워 두면 보이지 않아요. 전화번호·주소 같은 개인정보는 자동으로 가려져요.');
        self::define('admin.twofa_required', 'bool', strtolower(trim((string) Config::get('security.admin_2fa', 'optional'))) === 'required', null, 'admin', '관리자 2단계 인증을 꼭 쓰게 하기', false, '켜면 모든 관리자가 다음 로그인 때 휴대폰 인증 앱을 등록해야 해요. 기본 비밀번호를 바꾼 뒤에 켜는 것을 권해요.');
        self::define('farm.rt_scale', 'float', 1.0, [0.1, 3600], 'env', '실시간 텃밭 시간 배율', false, '1 = 진짜 시간, 60 = 60배 빠르게(시연). 이제부터 심는 작물에 적용돼요.');
        self::define('ai.kid_helper', 'bool', false, null, 'etc', '어린이 AI 질문 도우미', true, '🤖 AI 도우미 탭에서도 켜고 끌 수 있어요.'); // [ai] public: the page shows the 옹이 선생님 menu item only when this is on (73-ai.js)
        // ---------------------------------------------------------------- [entitle → controls] the keys CONTRACT §17.1 names (the controls lane reads them)
        $look = ['lock' => '마우스를 움직이면 돌기 (잠금)', 'walk' => '걸을 때만 돌기', 'drag' => '누르고 끌어서 돌기 (예전 방식)'];
        self::define('controls.mouse_look_normal', 'enum', 'lock', $look, 'controls', '보통 모드의 마우스 회전 기본값', true);
        self::define('controls.mouse_look_easy', 'enum', 'lock', $look, 'controls', '쉬운 모드의 마우스 회전 기본값', true);   // [gfx] CONTRACT §18.0: fixed to the character in both modes (was 'walk'); Ctrl frees the pointer
        // ---------------------------------------------------------------- [env] CONTRACT §17.5 — read through Tfm\Env, which accepts only the listed words
        self::define('env.clock_default', 'enum', 'kst', ['kst' => '실시간 (한국 시각)', 'fast' => '빠른 체험 시간', 'fixed' => '고정'], 'env', '시계 기본값', true, '방문자가 직접 고르지 않았을 때의 시계예요.');
        self::define('env.weather_source', 'enum', 'auto', ['auto' => '자동 (기상청 키가 있으면 기상청 실황)', 'model' => '언제나 정선 기후 모델'], 'env', '날씨 자료');
        self::define('env.night_brightness', 'float', 1.25, [0.6, 1.6], 'env', '밤 밝기', true, '1 = 예전 밝기. 숫자가 클수록 밤의 밭과 길이 밝아요.');
        self::define('farm.rt_basis', 'enum', 'calendar', ['calendar' => '작물 달력의 진짜 날짜', 'short' => '짧은 분 단위 (예전 방식)'], 'env', '실시간 텃밭의 기준', true);
        // ---------------------------------------------------------------- other lanes add their rows below, each in its own block
        // ---------------------------------------------------------------- [lecture] 강의 (CONTRACT §17.3) — read through Tfm\Lecture::opt(); the size limits are megabytes in the 🎓 강의 자료 tab
        self::define('lecture.auto_open', 'bool', Config::get('lecture.auto_open', true) !== false, null, 'lecture', '방에 들어가면 강의를 저절로 열기', false, '강의마다 켜 둔 "자동으로 열기"가 동작할지 정해요. 끄면 방에 들어가도 ▶ 강의 보기 카드만 보여요.');
        self::define('lecture.office_viewer', 'bool', Config::get('lecture.office_viewer', false) === true, null, 'lecture', 'PPT를 오피스 온라인 뷰어로 보여 주기', false, '켜면 누구나 볼 수 있는 PPT 강의를 마이크로소프트의 뷰어 창으로 보여 줘요. 그 회사 서버가 우리 파일을 가져가 읽으므로 https 주소로 공개된 사이트에서만 동작해요. 끄면 체험관의 간단 보기로 보여 줘요.');
        self::define('lecture.slide_hosts', 'list', ['docs.google.com', 'view.officeapps.live.com'], ['docs.google.com' => '구글 슬라이드 (docs.google.com)', 'view.officeapps.live.com' => '오피스 온라인 뷰어 (view.officeapps.live.com)'], 'lecture', '화면 안에 띄워도 되는 슬라이드 사이트', false, '체크를 빼면 그 사이트의 슬라이드 강의는 목록에서 빠지고 새로 추가할 수도 없어요. 다른 사이트는 언제나 새 창 링크로만 열려요.');
        self::define('lecture.images_max', 'int', 80, [1, 200], 'lecture', '강의 하나에 올릴 수 있는 그림 수');
        // ---------------------------------------------------------------- [/lecture]
        // ---------------------------------------------------------------- [support] 신고·문의 (CONTRACT §18.1) — read through Tfm\Support::opt(); the 📮 신고·문의 tab has the same rows on its own card
        self::define('support.enabled', 'bool', true, null, 'support', '신고·문의 받기', true, '끄면 체험관의 📮 문의·신고 버튼이 "지금은 받지 않아요"라고 알려 줘요. 이미 받은 문의와 답은 그대로 남아요.');
        self::define('support.shots', 'bool', true, null, 'support', '화면 사진 받기', true, '켜면 문의와 함께 그 순간의 화면 사진(1.5MB 이하)을 받아요. 끄면 글과 고른 분류만 받아요.');
        self::define('support.per_hour', 'int', 5, [1, 100], 'support', '한 계정이 한 시간에 보낼 수 있는 수');
        self::define('support.per_day', 'int', 20, [1, 500], 'support', '한 계정이 하루에 보낼 수 있는 수');
        self::define('support.max_open', 'int', 30, [1, 200], 'support', '한 계정이 답을 기다리며 둘 수 있는 문의 수', false, '닫은 문의는 세지 않아요.');
        self::define('support.keep_days', 'int', 180, [7, 3650], 'support', '보관 기간 (일)', false, '이 기간 동안 아무 변화가 없는 문의는 사진과 함께 저절로 지워져요. 닫은 문의부터 지워요.');
        self::define('support.shot_kb', 'int', 1536, [100, 1536], 'support', '화면 사진 최대 크기 (KB)');
        // ---------------------------------------------------------------- [/support]
        // ---------------------------------------------------------------- [fishing] 낚시 (CONTRACT §18.3) — public: 35-fishing.js reads them through G.site.get(); SaveValidator keeps its own hard ceiling
        self::define('fishing.enabled', 'bool', true, null, 'etc', '강가 낚시 열기', true, '끄면 강가의 🎣 낚시터가 쉬어요. 어류 도감과 이미 가방에 든 물고기는 그대로 있어요.');
        self::define('fishing.keep_per_day', 'int', 6, [0, 20], 'etc', '하루에 데려갈 수 있는 물고기 수', true, '한 사람이 하루(한국 날짜)에 가방에 담을 수 있는 수예요. 0이면 모두 놓아주기만 해요. 법으로 지키는 물고기는 이 숫자와 상관없이 언제나 놓아줘요.');
        self::define('fishing.trap_minutes', 'int', 10, [1, 240], 'etc', '어항에 물고기가 드는 데 걸리는 시간 (분)', true, '어항을 놓고 이만큼 진짜 시간이 지나야 살펴볼 수 있어요.');
        // ---------------------------------------------------------------- [/fishing]
        // ---------------------------------------------------------------- [healing] 힐링관 (CONTRACT §19.6) — public: 39-healing.js reads them through G.site.get(); SaveValidator reads healing.time_scale
        self::define('healing.enabled', 'bool', true, null, 'healing', '힐링관 열기', true, '끄면 힐링관 안내데스크가 "오늘은 쉬어요"라고 알려 줘요. 이미 받은 도장과 리포트는 그대로 남아요.');
        self::define('healing.time_scale', 'int', 1, [1, 120], 'healing', '시간 배속 (1 = 진짜 시간)', true, '1이면 60분 코스가 진짜 60분 걸려요. 시험해 볼 때만 크게 하세요(예: 60이면 60분 코스가 1분). 이미 시작한 코스는 그대로 가요.');
        self::define('healing.overlap', 'bool', false, null, 'healing', '여러 코스 함께 하기', true, '켜면 한 코스가 도는 동안 다른 관의 코스도 시작할 수 있어요. 끄면(기본) 한 번에 한 코스예요.');
        self::define('healing.room10', 'enum', 'gate', ['gentle' => '언제나 부드러운 마음 돌아보기', 'gate' => '쉬운 모드는 부드럽게, 어른 확인 뒤 전체 (기본)', 'off' => '제10관 닫기'], 'healing', '제10관 임종체험', true, '쉬운 모드(어린이)에서는 관과 죽음 이야기가 없는 "마음 돌아보기"가 나와요.');
        self::define('healing.rooms', 'list', ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'], ['R1' => '제1관 기본 검사관', 'R2' => '제2관 쑥뜸관', 'R3' => '제3관 좌훈관', 'R4' => '제4관 맨발걷기·헬스장', 'R5' => '제5관 족욕관', 'R6' => '제6관 발마사지관', 'R7' => '제7관 얼굴마사지관', 'R8' => '제8관 바디마사지관', 'R9' => '제9관 스트레스 해소관', 'R10' => '제10관 임종체험관'], 'healing', '여는 관', true, '고르지 않은 관은 문이 닫혀 있고, 리포트에도 필요하지 않아요.');
        // ---------------------------------------------------------------- [/healing]
        // ---------------------------------------------------------------- [ai] 🤖 AI 도우미 (CONTRACT §15.6 / §16.10) — read through Tfm\Claude::capUser() / capTotal(); the switch is ai.kid_helper above
        self::define('ai.daily_user', 'int', max(0, min(200, (int) Config::get('anthropic.daily_user', 20))), [0, 200], 'etc', '옹이 선생님 — 한 계정의 하루 질문 수', false, '아이 한 명이 하루(서버 날짜)에 물어볼 수 있는 수예요. 0이면 아무도 물어볼 수 없어요.');
        self::define('ai.daily_total', 'int', max(0, min(100000, (int) Config::get('anthropic.daily_total', 2000))), [0, 100000], 'etc', 'AI 도우미 — 서버 전체 하루 질문 수 (비용 상한)', false, '아이 · 관리자 · 서버 명령의 질문을 모두 합친 하루 상한이에요. 이 수를 넘으면 그날은 더 보내지 않아요.');
        // ---------------------------------------------------------------- [/ai]
    }

    /** the definitions of one group, in registry order */
    public static function rows(string $group): array
    {
        $out = [];
        foreach (self::defs() as $k => $d) if ($d['group'] === $group) $out[$k] = $d;
        return $out;
    }

    /** the registry default of a key (config value at the same path first) — what "기본값으로" restores */
    public static function defaultOf(string $key)
    {
        $d = self::defs();
        if (!isset($d[$key])) return Config::get($key);
        $c = Config::get($key);
        if ($c !== null) { try { return self::cleanDef($d[$key], $c); } catch (\Throwable $e) { /* a broken config value: the registry default */ } }
        return $d[$key]['default'];
    }

    /** key => value of every public setting (the `site` object of api/ping.php and api/auth/me.php) */
    public static function publicValues(): array
    {
        $out = [];
        foreach (self::defs() as $k => $d) {
            if (!$d['public']) continue;
            $v = self::get($k);
            // text an operator typed reaches children's screens: personal data is masked like chat (CONTRACT §15.7)
            if ($d['type'] === 'str' && is_string($v) && $v !== '' && class_exists('Tfm\\ChatFilter')) $v = ChatFilter::maskPII($v);
            $out[$k] = $v;
        }
        return $out;
    }

    /** a short stamp of the public values: the page asks for `site` again when it changes (player/save.php sends it) */
    public static function publicStamp(): string
    {
        return substr(sha1((string) json_encode(self::publicValues())), 0, 12);
    }

    // ------------------------------------------------------------------ reading
    private static function load(): array
    {
        if (self::$cache !== null) return self::$cache;
        // [scale-server] CONTRACT §16.9: the rows are kept in the shared cache for cache.settings_ttl seconds (30), so a
        // request that only needs a setting (ping: the farm time scale) asks the database nothing. set() and reset()
        // drop the copy at once; on a second web server with a memory cache a change shows after those seconds.
        $ttl = 0;
        try {
            $ttl = class_exists('Tfm\\Cache') ? (int) Config::get('cache.settings_ttl', 30) : 0;
            if ($ttl > 0) { $c = Cache::get('cfg:settings'); if (is_array($c)) return self::$cache = $c; }
        } catch (\Throwable $e) { $ttl = 0; }
        $out = [];
        try {
            foreach (Db::all('SELECT k, v FROM settings') as $r) {
                $out[(string) $r['k']] = Json::tryDecode((string) $r['v'], true);
            }
            if ($ttl > 0) { try { Cache::set('cfg:settings', $out, $ttl); } catch (\Throwable $e) { /* read again next time */ } }
        } catch (\Throwable $e) {
            $out = []; // a database that has not been upgraded to v6 yet: the config defaults apply
        }
        return self::$cache = $out;
    }

    /**
     * The stored value, else the config value at the same dotted path, else the registry default, else $default.
     * A stored value of a registered key is cleaned again on the way out (a row edited by hand can never hand the
     * application a value outside its range): a broken one counts as missing.
     */
    public static function get(string $key, $default = null)
    {
        $all = self::load();
        $defs = self::defs();
        $def = isset($defs[$key]) ? $defs[$key] : null;
        if (array_key_exists($key, $all) && $all[$key] !== null) {
            if ($def === null) return $all[$key];
            try { return self::cleanDef($def, $all[$key]); } catch (\Throwable $e) { /* fall through to the defaults */ }
        }
        $c = Config::get($key);
        if ($c !== null) {
            if ($def === null) return $c;
            try { return self::cleanDef($def, $c); } catch (\Throwable $e) { /* the registry default */ }
        }
        if ($def !== null) return $def['default'];
        return $default;
    }

    public static function has(string $key): bool
    {
        return array_key_exists($key, self::load());
    }

    // ------------------------------------------------------------------ writing
    /** validate + store one setting; throws ApiException 400 INVALID_SETTING for an unknown key or a bad value */
    public static function set(string $key, $value, ?int $actorId = null): void
    {
        $defs = self::defs();
        if (!isset($defs[$key])) throw new ApiException(400, 'INVALID_SETTING', '바꿀 수 없는 설정이에요.');
        $value = self::cleanDef($defs[$key], $value);
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) throw new ApiException(400, 'INVALID_SETTING', '설정 값을 저장하지 못했어요.');
        Db::upsert('settings', ['k' => $key, 'v' => $json, 'updated_at' => Clock::ms(), 'updated_by' => $actorId ?: null], ['k']);
        self::$cache = null;
        self::forgetShared(); // [scale-server]
        Audit::log('setting_changed', $actorId, ['key' => $key, 'value' => $value], 'warn', $actorId);
    }

    /** [entitle] back to the default: the stored row of a registered key is removed (audited); false when there was none */
    public static function clear(string $key, ?int $actorId = null): bool
    {
        if (!self::isDefined($key)) throw new ApiException(400, 'INVALID_SETTING', '바꿀 수 없는 설정이에요.');
        $n = Db::exec('DELETE FROM settings WHERE k = ?', [$key]);
        self::$cache = null;
        self::forgetShared();
        if ($n > 0) Audit::log('setting_reset', $actorId, ['key' => $key], 'warn', $actorId);
        return $n > 0;
    }

    /** [entitle] clean a raw value (a form field, a JSON value) for a registered key without storing it */
    public static function cleanValue(string $key, $value)
    {
        $defs = self::defs();
        if (!isset($defs[$key])) throw new ApiException(400, 'INVALID_SETTING', '바꿀 수 없는 설정이에요.');
        return self::cleanDef($defs[$key], $value);
    }

    /** @return mixed the cleaned value; throws ApiException 400 INVALID_SETTING */
    private static function cleanDef(array $d, $value)
    {
        $type = (string) $d['type'];
        $range = $d['range'];
        if ($type === 'bool') {
            if (is_bool($value)) return $value;
            if (is_int($value) && ($value === 0 || $value === 1)) return $value === 1;
            if (is_string($value)) {
                $s = strtolower(trim($value));
                if (in_array($s, ['1', 'true', 'on', 'yes'], true)) return true;
                if (in_array($s, ['0', 'false', 'off', 'no', ''], true)) return false;
            }
        } elseif ($type === 'int') {
            if (is_string($value)) $value = trim($value);
            if (is_int($value) || (is_string($value) && preg_match('/^-?\d{1,12}\z/', $value)) || (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) < 1e12)) {
                $n = (int) $value;
                if ($n >= (int) $range[0] && $n <= (int) $range[1]) return $n;
            }
        } elseif ($type === 'float') {
            if (is_string($value)) $value = trim($value);
            if (is_int($value) || is_float($value) || (is_string($value) && strlen($value) <= 24 && is_numeric($value))) {
                $f = (float) $value;
                if (is_finite($f) && $f >= (float) $range[0] && $f <= (float) $range[1]) return round($f, 4);
            }
        } elseif ($type === 'enum') {
            if (is_string($value) || is_int($value)) {
                foreach ($range as $k => $label) if ((string) $k === trim((string) $value)) return is_int($d['default']) ? (int) $k : (string) $k;
            }
        } elseif ($type === 'list') {
            if (is_string($value)) $value = trim($value) === '' ? [] : explode(',', $value);
            if (is_array($value) && count($value) <= 64) {
                $ints = true;
                foreach ($range as $k => $label) if (!is_int($k)) $ints = false;
                $picked = [];
                foreach ($value as $v) {
                    if (!is_string($v) && !is_int($v)) throw new ApiException(400, 'INVALID_SETTING', '설정 값이 올바르지 않아요.');
                    $hit = false;
                    foreach ($range as $k => $label) if ((string) $k === trim((string) $v)) { $picked[(string) $k] = true; $hit = true; }
                    if (!$hit) throw new ApiException(400, 'INVALID_SETTING', '설정 값이 올바르지 않아요.');
                }
                // the order of the registry, each value once
                $sorted = [];
                foreach ($range as $k => $label) if (isset($picked[(string) $k])) $sorted[] = $ints ? (int) $k : (string) $k;
                return $sorted;
            }
        } elseif ($type === 'str') {
            if (is_string($value)) {
                $max = is_int($range) && $range > 0 ? $range : 200;
                if (strlen($value) > $max * 4 + 16) throw new ApiException(400, 'INVALID_SETTING', '글이 너무 길어요.');
                $s = Users::cleanText($value, $max);
                if ($s !== '' && class_exists('Tfm\\ChatFilter') && ChatFilter::containsBadWord($s)) throw new ApiException(400, 'INVALID_SETTING', '바르고 고운 말로 적어 주세요.');
                return $s;
            }
        }
        throw new ApiException(400, 'INVALID_SETTING', '설정 값이 올바르지 않아요.');
    }
}
