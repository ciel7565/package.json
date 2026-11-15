<?php
/**
 * Tfm\AdminSettings — the admin site's ⚙️ 설정 and 🔐 내 계정 tabs and the default-password banner (CONTRACT §17.2).
 *
 *   view(Ctx $c, array $get, string $token): string      ⚙️ 설정: every operator setting of the registry (Tfm\Settings),
 *                                                         one card and one form per group — typed inputs with their
 *                                                         ranges, the present and the default value, "기본값" per value.
 *                                                         Secrets (토스, 기상청, Anthropic keys) are never shown or edited:
 *                                                         a read-only line says whether each is set.
 *   accountView(Ctx $c, string $token): string           🔐 내 계정: the administrator's own account — change the password
 *                                                         (present one + the new one twice), change the login id
 *   banner(Ctx $c, string $token): string                the red banner of EVERY admin page while this administrator still
 *                                                         uses the default password, with the change form in it
 *   action(string $action, Ctx $c, array $post): array   settings_save · settings_reset · account_password · account_login
 *                                                         → ['msg' => flash text, 'back' => query of the 303]
 *
 * It lives in lib/ (never web-readable) and is loaded by the admin entry on first use. The entry has already checked the
 * lock for every POST that reaches action(): same origin, the CSRF token, the admin role and the elevation. The
 * `case '…':` labels stay in the entry (tests/admin-lock.mjs reads the list of actions from that file).
 *
 * Rules of this file: every value that reaches the page goes through e(); no script, no inline style, no event handler
 * (the admin CSP is `default-src 'none'; style-src 'self'`); a state change is always a POST; Tfm\Settings validates
 * and audits every value (setting_changed / setting_reset), Tfm\Users audits the password change (password_changed).
 * A password never enters a flash message, an audit detail or a log line.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class AdminSettings
{
    public const ACTIONS = ['settings_save', 'settings_reset', 'account_password', 'account_login'];

    private static function e($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
    private static function s(array $a, string $k): string { return isset($a[$k]) && is_string($a[$k]) ? $a[$k] : ''; }
    /** a setting key as an element id ("limits.jars_free" → "s-limits-jars_free") */
    private static function id(string $key): string { return 's-' . str_replace('.', '-', $key); }
    private static function hidden(string $token, string $action, string $tab, array $more = []): string
    {
        $h = '<input type="hidden" name="_csrf" value="' . self::e($token) . '"><input type="hidden" name="action" value="' . self::e($action) . '"><input type="hidden" name="tab" value="' . self::e($tab) . '">';
        foreach ($more as $k => $v) $h .= '<input type="hidden" name="' . self::e($k) . '" value="' . self::e($v) . '">';
        return $h;
    }

    /** a value in the operator's words: 켜기 / 끄기, the label of a choice, "2,900" */
    public static function show(array $def, $value): string
    {
        switch ($def['type']) {
            case 'bool': return $value ? '켜기' : '끄기';
            case 'int': return number_format((int) $value);
            case 'float': return rtrim(rtrim(number_format((float) $value, 4, '.', ''), '0'), '.');
            case 'enum': return isset($def['range'][$value]) ? (string) $def['range'][$value] : (string) $value;
            case 'list':
                $out = [];
                foreach ((array) $value as $v) $out[] = isset($def['range'][$v]) ? (string) $def['range'][$v] : (string) $v;
                return $out ? implode(' · ', $out) : '(없음)';
            default: return (string) $value === '' ? '(비어 있음)' : (string) $value;
        }
    }

    /** "100 ~ 1,000,000" for a number, '' for the other types */
    private static function rangeText(array $def): string
    {
        if ($def['type'] === 'int') return number_format((int) $def['range'][0]) . ' ~ ' . number_format((int) $def['range'][1]);
        if ($def['type'] === 'float') return self::show($def, $def['range'][0]) . ' ~ ' . self::show($def, $def['range'][1]);
        if ($def['type'] === 'str') return (int) $def['range'] . '자까지';
        return '';
    }

    /** the input of one setting (its name is v[<key>]; a list also sends has[<key>] so "nothing ticked" is a value) */
    private static function input(string $key, array $def, $value): string
    {
        $id = self::id($key);
        $name = 'v[' . $key . ']';
        switch ($def['type']) {
            case 'bool':
                return '<select id="' . self::e($id) . '" name="' . self::e($name) . '"><option value="1"' . ($value ? ' selected' : '') . '>켜기</option><option value="0"' . ($value ? '' : ' selected') . '>끄기</option></select>';
            case 'int':
                return '<input id="' . self::e($id) . '" type="number" name="' . self::e($name) . '" value="' . self::e((int) $value) . '" min="' . self::e((int) $def['range'][0]) . '" max="' . self::e((int) $def['range'][1]) . '" step="1" inputmode="numeric" required>';
            case 'float':
                return '<input id="' . self::e($id) . '" type="number" name="' . self::e($name) . '" value="' . self::e(self::show($def, $value)) . '" min="' . self::e(self::show($def, $def['range'][0])) . '" max="' . self::e(self::show($def, $def['range'][1])) . '" step="0.01" inputmode="decimal" required>';
            case 'enum':
                $h = '<select id="' . self::e($id) . '" name="' . self::e($name) . '">';
                foreach ($def['range'] as $k => $label) $h .= '<option value="' . self::e($k) . '"' . ((string) $k === (string) $value ? ' selected' : '') . '>' . self::e($label) . '</option>';
                return $h . '</select>';
            case 'list':
                $h = '<input type="hidden" name="has[' . self::e($key) . ']" value="1"><span class="setchecks" id="' . self::e($id) . '">';
                $picked = array_map('strval', (array) $value);
                foreach ($def['range'] as $k => $label) {
                    $h .= '<label class="check"><input type="checkbox" name="' . self::e($name) . '[]" value="' . self::e($k) . '"' . (in_array((string) $k, $picked, true) ? ' checked' : '') . '> ' . self::e($label) . '</label>';
                }
                return $h . '</span>';
            default:
                return '<input id="' . self::e($id) . '" type="text" name="' . self::e($name) . '" value="' . self::e((string) $value) . '" maxlength="' . self::e((int) $def['range']) . '">';
        }
    }

    /** what the registry cannot hold: the state of the secrets and where the rest of a group lives (read-only lines) */
    private static function notes(string $group): string
    {
        $line = function (string $label, string $value, string $cls = ''): string {
            return '<p class="setnote"><span class="dim">' . self::e($label) . '</span> <span class="badge' . ($cls !== '' ? ' ' . self::e($cls) : '') . '">' . self::e($value) . '</span></p>';
        };
        $h = '';
        if ($group === 'sub') {
            $mode = Toss::mode();
            $h .= $line('토스페이먼츠 키', Toss::liveKeys() ? '실제 결제 키가 들어 있어요' : (Toss::keysConfigured() ? '테스트 키가 들어 있어요' : '없음'), Toss::keysConfigured() ? 'ok' : 'warn')
                . $line('결제 모드', $mode === 'mock' ? '모의 결제 (시험용)' : ($mode === 'live' ? '결제 받는 중' : '결제 설정 필요'), $mode === 'live' ? 'ok' : 'warn')
                . '<p class="dim small">키는 여기서 보이지도 바뀌지도 않아요. 서버 컴퓨터의 <code>config/config.local.php</code> (toss.client_key · toss.secret_key)에만 넣어요. 결제 내역은 <a href="./?tab=sub">⚡ 구독·결제</a> 탭에 있어요.</p>';
        } elseif ($group === 'env') {
            $kma = trim((string) Config::get('env.kma_key', '')) !== '';
            $h .= $line('기상청 날씨 키', $kma ? '들어 있어요' : '없음 (정선 기후 모델로 날씨를 만들어요)', $kma ? 'ok' : '')
                . '<p class="dim small">기상청 키도 <code>config/config.local.php</code> 의 env.kma_key 에만 넣어요.</p>';
        } elseif ($group === 'lecture') {
            $h .= '<p class="dim small">강의 영상 · 슬라이드 · 파일은 <a href="./?tab=lecture">🎓 강의 자료</a> 탭에서 올리고 고쳐요.</p>';
        } elseif ($group === 'room') {
            $h .= '<p class="dim small">내 방은 관리자, 분양 계약이 살아 있는 계정, 그리고 운영자가 직접 준 계정이 쓸 수 있어요. 누구에게 줄지는 <a href="./?tab=allot">🏺 분양 관리</a> 와 <a href="./?tab=users">👥 사용자</a> 탭에서 정해요.</p>';
        } elseif ($group === 'admin') {
            $mode = class_exists('Tfm\\AdminTotp') ? AdminTotp::mode() : 'optional';
            $names = ['off' => '꺼짐', 'optional' => '선택 (등록 권장)', 'required' => '필수'];
            $def = Users::defaultPasswordCount();
            $h .= $line('지금 2단계 인증', isset($names[$mode]) ? $names[$mode] : $mode, $mode === 'required' ? 'ok' : 'warn')
                . $line('기본 비밀번호를 쓰는 관리자', $def > 0 ? $def . '명 — 지금 바꿔야 해요' : '없음', $def > 0 ? 'fail' : 'ok')
                . '<p class="dim small">내 비밀번호와 로그인 아이디는 <a href="./?tab=account">🔐 내 계정</a>, 휴대폰 인증 앱은 <a href="./?tab=twofa">🔐 2단계 인증</a> 탭에서 바꿔요.</p>';
        } elseif ($group === 'etc') {
            $ai = trim((string) Config::get('anthropic.api_key', '')) !== '';
            $h .= $line('AI 도우미 키', $ai ? '들어 있어요' : '없음 (AI 기능 꺼짐)', $ai ? 'ok' : '');
        }
        return $h;
    }

    // ------------------------------------------------------------------ ⚙️ 설정
    public static function view(Ctx $c, array $get, string $token): string
    {
        $h = '<section class="card"><h3>⚙️ 설정</h3><p class="dim">체험관의 숫자와 기본값을 여기서 바꿔요. <b>저장</b>을 누르면 바로 적용돼요 (파일을 고치거나 다시 설치할 필요가 없어요). '
            . '방문자의 화면에는 1분 안에 반영돼요. 값마다 있는 <b>기본값</b> 버튼은 처음 값으로 되돌려요. 모든 변경은 📜 감사 로그에 남아요.</p><p class="row setjump">';
        foreach (Settings::GROUPS as $g => $t) $h .= '<a class="btn ghost sm" href="#set-' . self::e($g) . '"><span aria-hidden="true">' . $t[0] . '</span> ' . self::e($t[1]) . '</a>';
        $h .= '<a class="btn ghost sm" href="./?tab=allot&amp;sec=auto"><span aria-hidden="true">🏺</span> 분양 설정 →</a></p></section>';
        foreach (Settings::GROUPS as $g => $t) {
            $rows = Settings::rows($g);
            $notes = self::notes($g);
            $h .= '<section class="card setgroup" id="set-' . self::e($g) . '"><h3><span aria-hidden="true">' . $t[0] . '</span> ' . self::e($t[1]) . '</h3>';
            if (!$rows) {
                $h .= ($notes !== '' ? $notes : '') . '<p class="dim small">이 묶음에는 아직 바꿀 값이 없어요.</p></section>';
                continue;
            }
            // the reset buttons of the rows belong to this small form (a form cannot sit inside another form)
            $h .= '<form method="post" action="./" id="rs-' . self::e($g) . '" class="inline">' . self::hidden($token, 'settings_reset', 'settings', ['group' => $g]) . '</form>'
                . '<form method="post" action="./" class="setform">' . self::hidden($token, 'settings_save', 'settings', ['group' => $g]);
            foreach ($rows as $key => $def) {
                $value = Settings::get($key);
                $stored = Settings::has($key);
                $default = Settings::defaultOf($key);
                $range = self::rangeText($def);
                $h .= '<div class="setrow"><div class="setname"><label for="' . self::e(self::id($key)) . '">' . self::e($def['label']) . '</label>'
                    . ($def['public'] ? ' <span class="badge" title="방문자의 화면에도 전해지는 값이에요">화면에 전달</span>' : '')
                    . ($stored ? ' <span class="badge gold">바꿈</span>' : '')
                    . ($def['hint'] !== '' ? '<p class="dim small">' . self::e($def['hint']) . '</p>' : '') . '</div>'
                    . '<div class="setval">' . self::input($key, $def, $value)
                    . '<p class="dim small">' . ($range !== '' ? self::e($range) . ' · ' : '') . '기본값 ' . self::e(self::show($def, $default)) . '</p>'
                    . ($stored ? '<button type="submit" form="rs-' . self::e($g) . '" name="key" value="' . self::e($key) . '" class="btn ghost sm">기본값으로</button>' : '')
                    . '</div></div>';
            }
            $h .= '<div class="row"><button class="btn primary" type="submit">💾 ' . self::e($t[1]) . ' 저장</button></div></form>' . $notes . '</section>';
        }
        $h .= '<section class="card" id="set-allot"><h3><span aria-hidden="true">🏺</span> 분양</h3><p class="dim small">분양(항아리 · 밭 · 창고)의 가격, 기간, 알림, 약관 글은 그 탭에서 바꿔요.</p>'
            . '<p class="row"><a class="btn" href="./?tab=allot&amp;sec=auto">🏺 분양 관리 → ⚙️ 자동화 열기</a></p></section>';
        return $h;
    }

    // ------------------------------------------------------------------ 🔐 내 계정
    private static function passwordFields(bool $askCurrent): string
    {
        return ($askCurrent ? '<label>지금 쓰는 비밀번호<input type="password" name="current" autocomplete="current-password" required maxlength="128"></label>' : '')
            . '<label>새 비밀번호 (8자 이상, 영어 글자와 숫자를 함께)<input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="64"></label>'
            . '<label>새 비밀번호 한 번 더<input type="password" name="password_confirm" autocomplete="new-password" required minlength="8" maxlength="64"></label>';
    }

    public static function accountView(Ctx $c, string $token): string
    {
        $u = (array) $c->user;
        $default = !empty($u['pw_default']);
        $lid = isset($u['login_id']) ? (string) $u['login_id'] : '';
        $changed = (int) (isset($u['password_changed_at']) ? $u['password_changed_at'] : 0);
        $h = '<section class="card"><h3>🔐 내 계정</h3><div class="table-wrap"><table><tbody>'
            . '<tr><th scope="row">닉네임</th><td>' . self::e($u['nickname']) . '</td></tr>'
            . '<tr><th scope="row">로그인 아이디</th><td>' . ($lid !== '' ? '<code>' . self::e($lid) . '</code>' : '<span class="dim">없음 (이메일이나 닉네임으로 로그인)</span>') . '</td></tr>'
            . '<tr><th scope="row">이메일</th><td>' . self::e($u['email']) . '</td></tr>'
            . '<tr><th scope="row">비밀번호</th><td>' . ($default ? '<span class="badge fail">기본 비밀번호 사용 중 — 지금 바꿔야 해요</span>' : '<span class="badge ok">내가 정한 비밀번호</span>')
            . ($changed > 0 && !$default ? ' <span class="dim small">마지막으로 바꾼 날 ' . self::e(date('Y-m-d H:i', intdiv($changed, 1000))) . '</span>' : '') . '</td></tr>'
            . '</tbody></table></div></section>';
        $h .= '<div class="grid2"><section class="card"><h3>🔑 비밀번호 바꾸기</h3>'
            . '<p class="dim small">바꾸면 이 계정으로 로그인해 있던 <b>다른 기기는 모두 로그아웃</b>돼요 (지금 이 화면은 그대로예요). 흔한 비밀번호나 아이디가 들어간 비밀번호는 쓸 수 없어요.</p>'
            . '<form method="post" action="./" class="stack">' . self::hidden($token, 'account_password', 'account') . self::passwordFields(!$default)
            . '<button class="btn primary" type="submit">🔐 비밀번호 바꾸기</button></form></section>'
            . '<section class="card"><h3>🪪 로그인 아이디 바꾸기</h3>'
            . '<p class="dim small">로그인할 때 이메일 대신 쓰는 짧은 이름이에요 (영어 소문자 · 숫자 · 밑줄 3~20자). <code>admin</code> 은 누구나 짐작하는 이름이라, 나만 아는 이름으로 바꾸면 더 안전해요.</p>'
            . '<form method="post" action="./" class="stack">' . self::hidden($token, 'account_login', 'account')
            . '<label>새 로그인 아이디<input name="login_id" value="' . self::e($lid) . '" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" autocomplete="username" spellcheck="false"></label>'
            . '<label>지금 쓰는 비밀번호<input type="password" name="current" autocomplete="current-password" required maxlength="128"></label>'
            . '<button class="btn" type="submit">아이디 바꾸기</button></form></section></div>';
        return $h . '<section class="card"><h3>📱 한 겹 더 잠그기</h3><p class="dim small">비밀번호를 바꾼 다음 <a href="./?tab=twofa">🔐 2단계 인증</a> 탭에서 휴대폰 인증 앱을 등록하면, 비밀번호가 새어 나가도 그 휴대폰 없이는 아무도 들어올 수 없어요.</p></section>';
    }

    /** the red banner of every admin page while this administrator still uses the default password */
    public static function banner(Ctx $c, string $token): string
    {
        if (empty($c->user['pw_default'])) return '';
        return '<section class="banner danger" role="alert"><h3>🚨 기본 비밀번호를 쓰고 있어요 — 지금 바꿔 주세요</h3>'
            . '<p>이 관리자 계정의 비밀번호는 설치할 때의 기본값(<code>' . self::e(Users::DEFAULT_ADMIN_PASSWORD) . '</code>)이에요. 누구나 아는 비밀번호라서 <b>아무나 관리자로 들어올 수 있어요.</b> 아래 두 칸에 새 비밀번호를 넣고 버튼을 누르면 이 경고가 사라져요.</p>'
            . '<form method="post" action="./" class="bannerform">' . self::hidden($token, 'account_password', 'account', ['from' => 'banner']) . self::passwordFields(false)
            . '<button class="btn primary" type="submit">🔐 새 비밀번호로 바꾸기</button></form></section>';
    }

    // ------------------------------------------------------------------ actions
    public static function action(string $action, Ctx $c, array $post): array
    {
        $uid = $c->uid();
        switch ($action) {
            case 'settings_save': return ['msg' => self::save($post, $uid), 'back' => []];
            case 'settings_reset': {
                $key = self::s($post, 'key');
                $defs = Settings::defs();
                if (!isset($defs[$key])) throw new ApiException(400, 'INVALID_SETTING', '되돌릴 설정을 고르지 못했어요. 목록에서 다시 눌러 주세요.');
                $was = Settings::clear($key, $uid);
                return ['msg' => $was ? '↩️ “' . $defs[$key]['label'] . '” 을(를) 기본값(' . self::show($defs[$key], Settings::get($key)) . ')으로 되돌렸어요.' : '이미 기본값이에요.', 'back' => []];
            }
            case 'account_password': return ['msg' => self::changePassword($c, $post), 'back' => []];
            case 'account_login': return ['msg' => self::changeLogin($c, $post), 'back' => []];
        }
        throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.');
    }

    /** settings_save: every value of one group is cleaned first; only when all are fine the changed ones are stored */
    private static function save(array $post, int $uid): string
    {
        $group = self::s($post, 'group');
        $rows = isset(Settings::GROUPS[$group]) ? Settings::rows($group) : [];
        if (!$rows) throw new ApiException(400, 'INVALID_SETTING', '저장할 설정 묶음을 찾지 못했어요. 화면을 새로 고친 뒤 다시 해 주세요.');
        $v = isset($post['v']) && is_array($post['v']) ? $post['v'] : [];
        $has = isset($post['has']) && is_array($post['has']) ? $post['has'] : [];
        $changes = [];
        $now = [];
        foreach ($rows as $key => $def) {
            $now[$key] = Settings::get($key);
            if ($def['type'] === 'list') {
                if (!isset($has[$key])) continue;
                $raw = isset($v[$key]) && is_array($v[$key]) ? array_values($v[$key]) : [];
            } else {
                if (!array_key_exists($key, $v)) continue;
                $raw = $v[$key];
                if (!is_string($raw)) throw new ApiException(400, 'INVALID_SETTING', '“' . $def['label'] . '” 값이 올바르지 않아요.');
            }
            try {
                $clean = Settings::cleanValue($key, $raw);
            } catch (ApiException $e) {
                $range = self::rangeText($def);
                throw new ApiException(400, 'INVALID_SETTING', '“' . $def['label'] . '” 값이 올바르지 않아요' . ($range !== '' ? ' (' . $range . ')' : '') . '. 아무것도 저장하지 않았어요.');
            }
            if ($clean !== $now[$key]) $changes[$key] = $clean;
        }
        // values that belong together
        $after = $changes + $now;
        if ($group === 'sub' && isset($after['limits.jars_free'], $after['limits.jars_paid']) && $after['limits.jars_free'] > $after['limits.jars_paid']) {
            throw new ApiException(400, 'INVALID_SETTING', '무료 계정의 항아리 수는 구독 계정의 항아리 수보다 많을 수 없어요. 아무것도 저장하지 않았어요.');
        }
        if ($group === 'room' && isset($after['limits.room_items_free'], $after['limits.room_items_paid']) && $after['limits.room_items_free'] > $after['limits.room_items_paid']) {
            throw new ApiException(400, 'INVALID_SETTING', '무료 계정의 방 물건 수는 구독 계정의 수보다 많을 수 없어요. 아무것도 저장하지 않았어요.');
        }
        if (!$changes) return '바뀐 값이 없어요.';
        $names = [];
        foreach ($changes as $key => $val) {
            Settings::set($key, $val, $uid > 0 ? $uid : null);
            $names[] = $rows[$key]['label'] . ' → ' . self::show($rows[$key], $val);
        }
        $more = count($names) > 3 ? ' 외 ' . (count($names) - 3) . '개' : '';
        return '⚙️ ' . Settings::GROUPS[$group][1] . ' 설정 ' . count($names) . '개를 바꿨어요: ' . mb_substr(implode(' · ', array_slice($names, 0, 3)), 0, 240) . $more;
    }

    /**
     * account_password: the administrator's own password. The present password is asked for (shared login throttle)
     * unless the account still has the default one — that password is public, asking for it would prove nothing, and
     * the administrator has just signed in to get here. The new one must pass the normal policy; every other session of
     * the account ends, this one continues (Session::refresh keeps the elevation: it lives in the session's data).
     */
    private static function changePassword(Ctx $c, array $post): string
    {
        $u = (array) $c->user;
        $new = self::s($post, 'password');
        if ($new === '' || strlen($new) > 512) throw new ApiException(400, 'PASSWORD_REQUIRED', '새 비밀번호를 넣어 주세요.');
        if (!hash_equals($new, self::s($post, 'password_confirm'))) throw new ApiException(400, 'PASSWORD_MISMATCH', '새 비밀번호 두 칸이 서로 달라요. 다시 넣어 주세요.');
        if (empty($u['pw_default'])) Users::confirmPassword($u, self::s($post, 'current'));
        $fresh = Users::changePassword($u, $new, 'admin site', $c->uid());
        Session::refresh($fresh);
        Auth::forget();
        $c->user = $fresh;
        return '🔐 비밀번호를 바꿨어요. 이 계정으로 로그인해 있던 다른 기기는 모두 로그아웃됐어요. 새 비밀번호를 안전한 곳에 적어 두세요.';
    }

    /** account_login: a new login id for the administrator's own account (present password required) */
    private static function changeLogin(Ctx $c, array $post): string
    {
        $u = (array) $c->user;
        $uid = $c->uid();
        $id = mb_strtolower(trim(self::s($post, 'login_id')));
        if ($e = Users::validLoginId($id)) throw new ApiException(400, 'INVALID_LOGIN_ID', $e);
        $old = isset($u['login_id']) ? (string) $u['login_id'] : '';
        if ($id === $old) return '바뀐 내용이 없어요.';
        Users::confirmPassword($u, self::s($post, 'current'));
        $taken = Users::byLoginId($id);
        $nick = Users::byNickname($id);
        if (($taken && (int) $taken['id'] !== $uid) || ($nick && (int) $nick['id'] !== $uid)) throw new ApiException(409, 'LOGIN_ID_TAKEN', '그 이름은 이미 다른 계정이 쓰고 있어요. 다른 이름을 골라 주세요.');
        try {
            Users::update($uid, ['login_id' => $id]);
        } catch (\PDOException $e) {
            if (strncmp((string) $e->getCode(), '23', 2) === 0) throw new ApiException(409, 'LOGIN_ID_TAKEN', '그 이름은 이미 다른 계정이 쓰고 있어요. 다른 이름을 골라 주세요.');
            throw $e;
        }
        Audit::log('login_id_changed', $uid, ['from' => $old, 'to' => $id], 'warn', $uid);
        Auth::forget();
        $c->user = Users::byId($uid);
        return '🪪 로그인 아이디를 ' . $id . ' (으)로 바꿨어요. 다음부터 이 이름으로 로그인하세요.';
    }
}
