<?php
/**
 * Tfm\AdminLecture — the admin site's 🎓 강의 자료 tab (CONTRACT §17.3): add a lecture by address or by file upload, edit,
 * replace the file, reorder, switch on / off, assign to a room, auto-open, delete, preview, settings. No JavaScript.
 *
 *   view(Ctx $c, array $get, string $token): string     the tab (?edit=<id> shows one lecture's edit card on top)
 *   back(array $post): array                             where a form came from → the 303 goes back there
 *   action(string $action, Ctx $c, array $post): array   one `lecture_*` action → ['msg' => flash text, 'back' => query]
 *   serve(array $admin, string $spec): void              GET ./?lecfile=<lecture id>.<n> — a stored file for the
 *                                                        preview, streamed by Tfm\Lecture::stream (no-store)
 *
 * It lives in lib/ (never web-readable) and is loaded by the admin entry on demand. The entry has already checked the
 * lock for every POST that reaches action(): same origin, the CSRF token, the admin role and the elevation. The
 * `case 'lecture_…':` labels stay in the entry (tests/admin-lock.mjs reads the list of actions from that file).
 * UPLOAD_ACTIONS are the ONLY actions of the whole admin site that may carry a file (the entry's gate lets a multipart
 * body through for exactly these names); the files are checked and stored by Tfm\Upload::lectureFile.
 *
 * Rules of this file: every value that reaches the page goes through e(); no script, no inline style, no event
 * handler (the CSP of the admin site is `default-src 'none'; style-src 'self'; img-src 'self'`): pictures come through
 * this entry (./?lecfile=…), a video is NOT framed here — the tab shows its number and two links (YouTube, and the
 * app's own player through ../?lecture=<id>). A client file name or type never reaches the page or the database.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class AdminLecture
{
    /** the actions that may receive files (multipart) */
    public const UPLOAD_ACTIONS = ['lecture_add_file', 'lecture_replace', 'lecture_images'];
    /** files one form may carry (pictures; a pdf / pptx is always one) */
    public const FILES_PER_POST = 25;

    /** @var string the CSRF token of the page being drawn */
    private static $token = '';

    private static function e($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
    private static function s(array $a, string $k): string { return isset($a[$k]) && is_string($a[$k]) ? $a[$k] : ''; }
    private static function id(array $a, string $k): int
    {
        $v = self::s($a, $k);
        return $v !== '' && strlen($v) <= 12 && ctype_digit($v) ? (int) $v : 0;
    }
    private static function href(array $q = []): string
    {
        return './?' . http_build_query(['tab' => 'lecture'] + array_filter($q, function ($v) { return $v !== '' && $v !== null && $v !== 0; }));
    }
    private static function open(string $action, array $fields = [], string $cls = 'stack', bool $files = false, string $id = ''): string
    {
        $h = '<form method="post" action="./" class="' . self::e($cls) . '"' . ($files ? ' enctype="multipart/form-data"' : '') . ($id !== '' ? ' id="' . self::e($id) . '"' : '') . '>'
            . '<input type="hidden" name="_csrf" value="' . self::e(self::$token) . '"><input type="hidden" name="action" value="' . self::e($action) . '"><input type="hidden" name="tab" value="lecture">';
        foreach ($fields as $k => $v) if ($v !== '' && $v !== null && $v !== 0) $h .= '<input type="hidden" name="' . self::e($k) . '" value="' . self::e($v) . '">';
        return $h;
    }
    private static function select(string $name, array $options, string $current): string
    {
        $h = '<select name="' . self::e($name) . '">';
        foreach ($options as $v => $text) $h .= '<option value="' . self::e($v) . '"' . ((string) $v === $current ? ' selected' : '') . '>' . self::e($text) . '</option>';
        return $h . '</select>';
    }
    private static function badge(string $text, string $cls = ''): string { return '<span class="badge' . ($cls !== '' ? ' ' . self::e($cls) : '') . '">' . self::e($text) . '</span>'; }
    private static function check(string $name, string $label, bool $on): string
    {
        return '<label class="check"><input type="checkbox" name="' . self::e($name) . '" value="1"' . ($on ? ' checked' : '') . '> ' . self::e($label) . '</label>';
    }
    public static function size(int $bytes): string
    {
        if ($bytes >= 1048576) return rtrim(rtrim(number_format($bytes / 1048576, 1), '0'), '.') . 'MB';
        return $bytes >= 1024 ? (int) ceil($bytes / 1024) . 'KB' : $bytes . 'B';
    }
    private static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || $v === '-1') return 0;
        $n = (int) $v;
        switch (strtolower(substr($v, -1))) {
            case 'g': return $n * 1073741824;
            case 'm': return $n * 1048576;
            case 'k': return $n * 1024;
            default: return $n;
        }
    }

    /** what PHP itself lets a request carry: ['file' => upload_max_filesize, 'post' => post_max_size, 'count' => max_file_uploads] (0 = no limit) */
    public static function phpLimits(): array
    {
        return ['file' => self::iniBytes((string) ini_get('upload_max_filesize')), 'post' => self::iniBytes((string) ini_get('post_max_size')), 'count' => max(1, (int) ini_get('max_file_uploads'))];
    }

    /** the largest file of a kind this server takes right now: the lecture limit, lowered to what PHP accepts */
    public static function effectiveMax(string $kind): int
    {
        $lim = Lecture::limits();
        $max = $kind === 'pdf' ? $lim['pdf'] : ($kind === 'pptx' ? $lim['pptx'] : $lim['image']);
        $php = self::phpLimits();
        foreach ([$php['file'], $php['post'] > 0 ? $php['post'] - 65536 : 0] as $cap) if ($cap > 0 && $cap < $max) $max = $cap;
        return max(1, $max);
    }

    private static function placeOptions(string $current = ''): array
    {
        $o = ['' => '강의 목록에만 (방 화면에는 안 나와요)', '*' => '모든 방의 화면'];
        foreach (Lecture::PLACES as $id => $name) $o[$id] = $name;
        if ($current !== '' && !isset($o[$current]) && Lecture::validPlace($current)) $o[$current] = $current;
        return $o;
    }
    private static function placeName(string $p): string
    {
        if ($p === '') return '목록에만';
        if ($p === '*') return '모든 방';
        return isset(Lecture::PLACES[$p]) ? Lecture::PLACES[$p] : $p;
    }
    private static function kindBadge(string $k): string
    {
        $m = isset(Lecture::KIND_KO[$k]) ? Lecture::KIND_KO[$k] : ['', $k];
        return self::badge(trim($m[0] . ' ' . $m[1]));
    }

    // ------------------------------------------------------------------ the tab
    public static function view(Ctx $c, array $get, string $token): string
    {
        self::$token = $token;
        $all = Lecture::all();
        $edit = self::id($get, 'edit');
        $editing = null;
        foreach ($all as $l) if ($l['id'] === $edit) $editing = $l;
        $h = self::intro($all);
        if ($editing !== null) $h .= self::editCard($editing);
        $h .= '<div class="grid2">' . self::addLinkCard() . self::addFileCard() . '</div>';
        $h .= self::listCard($all, $editing !== null ? $editing['id'] : 0);
        $h .= self::settingsCard();
        return $h;
    }

    private static function intro(array $all): string
    {
        $on = 0;
        $files = 0;
        $bytes = 0;
        foreach ($all as $l) {
            if ($l['enabled']) $on++;
            foreach ($l['files'] as $f) { $files++; $bytes += $f['bytes']; }
        }
        $lim = Lecture::limits();
        $php = self::phpLimits();
        $h = '<section class="card"><h2>🎓 강의 자료</h2>'
            . '<p class="dim">체험관의 <b>🎓 강의실</b> 창과 방 안의 강의 화면에 나오는 영상 · 슬라이드 · 문서를 여기서 넣고 고쳐요. 바꾼 내용은 1분 안에 체험관에 나타나요.</p>'
            . '<div class="tiles"><div class="tile"><span class="ico" aria-hidden="true">🎓</span><b>' . count($all) . '</b><small>등록한 강의</small></div>'
            . '<div class="tile"><span class="ico" aria-hidden="true">✅</span><b>' . $on . '</b><small>켜져 있는 강의</small></div>'
            . '<div class="tile"><span class="ico" aria-hidden="true">📎</span><b>' . $files . '</b><small>올린 파일 (' . self::e(self::size($bytes)) . ')</small></div></div>'
            . '<ol class="steps"><li><b>유튜브 영상</b>: 영상 주소를 "주소로 추가"에 붙여 넣어요. 영상은 체험관 안에서만 재생되고, 유튜브로 나가는 단추는 나오지 않아요.</li>'
            . '<li><b>PPT 강의</b>: 파워포인트 파일(.pptx)을 그대로 올리거나, "PDF로 저장" 또는 "그림으로 저장(JPG · PNG)"한 파일을 올려요. 그림이나 PDF가 원본 모양 그대로 보여서 가장 좋아요.</li>'
            . '<li><b>방에 걸기</b>: "보여 줄 곳"에서 방을 고르면 그 방의 강의 화면에 걸려요. "들어가면 자동으로 열기"를 켜면 입장할 때 강의가 바로 열려요.</li></ol>';
        $warn = [];
        if ($php['file'] > 0 && $php['file'] < $lim['pptx']) $warn[] = '파일 하나 ' . self::size($php['file']);
        if ($php['post'] > 0 && $php['post'] < $lim['pptx']) $warn[] = '한 번에 ' . self::size($php['post']);
        $h .= '<p class="small dim">지금 올릴 수 있는 크기 — PDF ' . self::e(self::size(self::effectiveMax('pdf'))) . ' · PPTX ' . self::e(self::size(self::effectiveMax('pptx'))) . ' · 그림 한 장 ' . self::e(self::size(self::effectiveMax('image')))
            . ' (한 번에 ' . min(self::FILES_PER_POST, $php['count']) . '장, 강의 하나에 ' . (int) $lim['images'] . '장까지) · 남은 저장 공간 ' . self::e(self::size(Lecture::storageLeft())) . '</p>';
        if ($warn) {
            $h .= '<p class="notice">⚠️ 이 서버의 PHP 설정이 강의 파일 한도보다 작아요 (' . self::e(implode(' · ', $warn)) . '). 큰 파일을 올리려면 관리자 폴더의 <code>.htaccess</code> 가 적용되는지(Apache 의 AllowOverride All), 또는 php.ini 의 <code>upload_max_filesize</code> · <code>post_max_size</code> 값을 확인해 주세요.</p>';
        }
        return $h . '</section>';
    }

    /** the fields every lecture form shares */
    private static function commonFields(?array $l): string
    {
        $place = $l ? $l['place'] : '';
        return '<div class="fgrid"><label>보여 줄 곳' . self::select('place', self::placeOptions($place), $place) . '</label>'
            . '<label>볼 수 있는 사람' . self::select('audience', Lecture::AUDIENCE_KO, $l ? $l['audience'] : 'all') . '</label></div>'
            . self::check('autoplay', '그 방에 들어가면 자동으로 열기', $l ? $l['autoplay'] : false)
            . self::check('enabled', '켜기 (체험관에 보여 주기)', $l ? $l['enabled'] : true);
    }

    private static function addLinkCard(): string
    {
        return '<section class="card"><h3>🔗 주소로 추가</h3><p class="dim small">유튜브 영상 주소, 구글 슬라이드의 "웹에 게시" 주소, 또는 https:// 로 시작하는 다른 주소를 넣어요. 다른 주소는 어른 확인 뒤에 새 창으로 여는 단추로만 보여요.</p>'
            . self::open('lecture_add_link')
            . '<label>강의 제목<input type="text" name="title" maxlength="' . Lecture::TITLE_MAX . '" required placeholder="예: 된장은 어떻게 만들어질까요?"></label>'
            . '<label>주소<input type="text" name="address" maxlength="' . Lecture::SRC_MAX . '" required inputmode="url" autocomplete="off" placeholder="https://youtu.be/…"></label>'
            . self::commonFields(null)
            . '<div class="row"><button type="submit" class="btn primary">➕ 강의 추가</button></div></form></section>';
    }

    private static function addFileCard(): string
    {
        $lim = Lecture::limits();
        return '<section class="card"><h3>📎 파일로 추가</h3><p class="dim small">PDF 한 개(' . self::e(self::size(self::effectiveMax('pdf'))) . ' 까지), 파워포인트 .pptx 한 개(' . self::e(self::size(self::effectiveMax('pptx'))) . ' 까지), 또는 그림 여러 장(JPG · PNG · WEBP, 한 장 ' . self::e(self::size(self::effectiveMax('image'))) . ' 까지 · 파일 이름 순서대로 슬라이드가 돼요).</p>'
            . self::open('lecture_add_file', [], 'stack', true)
            . '<label>강의 제목<input type="text" name="title" maxlength="' . Lecture::TITLE_MAX . '" required placeholder="예: 김장 문화 이야기"></label>'
            . '<div class="fgrid"><label>파일 종류' . self::select('kind', ['pdf' => '📄 PDF 문서', 'pptx' => '📊 파워포인트(.pptx)', 'images' => '🖼️ 그림 슬라이드 (여러 장)'], 'pdf') . '</label>'
            . '<label>파일 고르기<input type="file" name="files[]" multiple required accept=".pdf,.pptx,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></label></div>'
            . self::commonFields(null)
            . '<div class="row"><button type="submit" class="btn primary">⬆️ 올리고 강의 추가</button></div></form>'
            . '<p class="small dim">올린 파일은 종류를 내용으로 다시 확인하고(이름은 믿지 않아요), 그림은 새로 저장하며, 매크로나 실행 파일이 들어 있으면 받지 않아요. 한 강의에 그림은 ' . (int) $lim['images'] . '장까지예요.</p></section>';
    }

    private static function srcText(array $l): string
    {
        if ($l['kind'] === 'youtube') return 'youtu.be/' . $l['src'];
        if ($l['kind'] === 'slides' || $l['kind'] === 'link') { $host = parse_url($l['src'], PHP_URL_HOST); return is_string($host) ? $host : ''; }
        $bytes = 0;
        foreach ($l['files'] as $f) $bytes += $f['bytes'];
        if (!$l['files']) return '파일 없음';
        if ($l['kind'] === 'images') return count($l['files']) . '장 · ' . self::size($bytes);
        if ($l['kind'] === 'pptx') return ($l['files'][0]['w'] > 0 ? '슬라이드 ' . $l['files'][0]['w'] . '장 · ' : '') . self::size($bytes);
        return self::size($bytes);
    }

    private static function listCard(array $all, int $editing): string
    {
        $h = '<section class="card"><h3>📚 등록한 강의 <span class="dim small">위에 있는 강의가 먼저 나와요</span></h3>';
        if (!$all) return $h . '<p class="empty">🍃 아직 강의가 없어요. 위에서 주소나 파일로 첫 강의를 넣어 보세요.</p></section>';
        $h .= self::open('lecture_row', $editing > 0 ? ['edit' => $editing] : [], 'inline', false, 'lecrow') . '</form>';
        $btn = function (int $id, string $what, string $label, string $cls = 'btn sm ghost') {
            return '<button type="submit" form="lecrow" name="pick" value="' . $id . ':' . self::e($what) . '" class="' . self::e($cls) . '">' . self::e($label) . '</button>';
        };
        $h .= '<div class="tablewrap"><table class="rt"><thead><tr><th>순서</th><th>강의</th><th>종류</th><th>내용</th><th>보여 줄 곳</th><th>볼 수 있는 사람</th><th>상태</th><th></th></tr></thead><tbody>';
        $last = count($all) - 1;
        foreach ($all as $i => $l) {
            $missing = in_array($l['kind'], Lecture::FILE_KINDS, true) && !$l['files'];
            $state = $l['enabled'] ? ($missing ? self::badge('파일 없음', 'warn') : self::badge('켜짐', 'ok')) : self::badge('꺼짐');
            $h .= '<tr' . ($l['enabled'] ? '' : ' class="muted"') . '>'
                . '<td data-th="순서" class="nowrap">' . ($i > 0 ? $btn($l['id'], 'up', '↑') : '') . ($i < $last ? $btn($l['id'], 'down', '↓') : '') . '</td>'
                . '<td data-th="강의"><b>' . self::e($l['title']) . '</b></td>'
                . '<td data-th="종류">' . self::kindBadge($l['kind']) . '</td>'
                . '<td data-th="내용" class="small">' . self::e(self::srcText($l)) . '</td>'
                . '<td data-th="보여 줄 곳">' . self::e(self::placeName($l['place'])) . ($l['autoplay'] ? ' ' . self::badge('자동 열기', 'gold') : '') . '</td>'
                . '<td data-th="볼 수 있는 사람">' . self::e(isset(Lecture::AUDIENCE_KO[$l['audience']]) ? Lecture::AUDIENCE_KO[$l['audience']] : $l['audience']) . '</td>'
                . '<td data-th="상태">' . $state . '</td>'
                . '<td class="acts nowrap">' . $btn($l['id'], $l['enabled'] ? 'off' : 'on', $l['enabled'] ? '끄기' : '켜기') . ' <a class="btn sm" href="' . self::e(self::href(['edit' => $l['id']])) . '">✏️ 고치기 · 미리 보기</a></td></tr>';
        }
        return $h . '</tbody></table></div></section>';
    }

    private static function editCard(array $l): string
    {
        $id = $l['id'];
        $isFile = in_array($l['kind'], Lecture::FILE_KINDS, true);
        $h = '<section class="card"><h3>✏️ 강의 고치기 ' . self::kindBadge($l['kind']) . ' <a class="btn sm ghost" href="' . self::e(self::href()) . '">닫기</a></h3>';
        $h .= '<div class="grid2"><div>' . self::open('lecture_save', ['id' => $id, 'edit' => $id])
            . '<label>강의 제목<input type="text" name="title" maxlength="' . Lecture::TITLE_MAX . '" required value="' . self::e($l['title']) . '"></label>';
        if (!$isFile) {
            $addr = $l['kind'] === 'youtube' ? 'https://youtu.be/' . $l['src'] : $l['src'];
            $h .= '<label>주소<input type="text" name="address" maxlength="' . Lecture::SRC_MAX . '" required inputmode="url" autocomplete="off" value="' . self::e($addr) . '"></label>';
        }
        $h .= self::commonFields($l) . '<div class="row"><button type="submit" class="btn primary">💾 저장</button></div></form></div>';
        $h .= '<div>' . self::preview($l) . '</div></div>';
        if ($l['kind'] === 'pdf' || $l['kind'] === 'pptx') {
            $h .= self::open('lecture_replace', ['id' => $id, 'edit' => $id], 'stack lbl', true)
                . '<label>' . ($l['files'] ? '파일 바꾸기' : '파일 올리기') . ' (' . self::e($l['kind'] === 'pdf' ? 'PDF, ' . self::size(self::effectiveMax('pdf')) : '.pptx, ' . self::size(self::effectiveMax('pptx'))) . ' 까지)'
                . '<input type="file" name="files[]" required accept="' . ($l['kind'] === 'pdf' ? '.pdf,application/pdf' : '.pptx') . '"></label>'
                . '<div class="row"><button type="submit" class="btn">⬆️ ' . ($l['files'] ? '이 파일로 바꾸기' : '올리기') . '</button></div></form>';
        } elseif ($l['kind'] === 'images') {
            $left = Lecture::limits()['images'] - count($l['files']);
            $h .= self::open('lecture_images', ['id' => $id, 'edit' => $id], 'stack lbl', true)
                . '<label>그림 더 올리기 (앞으로 ' . max(0, $left) . '장 더 넣을 수 있어요)<input type="file" name="files[]" multiple required accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"></label>'
                . '<div class="row"><button type="submit" class="btn"' . ($left > 0 ? '' : ' disabled') . '>⬆️ 그림 추가</button></div></form>';
        }
        $h .= self::open('lecture_delete', ['id' => $id], 'stack lbl')
            . '<label class="check"><input type="checkbox" name="sure" value="1" required> 이 강의' . ($isFile ? '와 올린 파일' : '') . '을 지워요 (되돌릴 수 없어요)</label>'
            . '<div class="row"><button type="submit" class="btn danger">🗑️ 강의 지우기</button></div></form>';
        return $h . '</section>';
    }

    /** what the lecture will show — pictures through this entry, a video as its number and links (nothing is framed here) */
    private static function preview(array $l): string
    {
        $id = $l['id'];
        $app = '<p class="small"><a class="btn sm" href="../?lecture=' . $id . '" target="_blank" rel="noopener noreferrer">▶ 체험관에서 미리 보기 (새 창)</a></p>'
            . '<p class="small dim">체험관에 들어간 뒤(로그인 또는 손님) 이 강의가 바로 열려요. 꺼져 있는 강의는 체험관에 나오지 않아요.</p>';
        if ($l['kind'] === 'youtube') {
            return '<h4>미리 보기</h4><dl class="facts"><dt>영상 번호</dt><dd><code>' . self::e($l['src']) . '</code></dd><dt>재생 주소</dt><dd><code>https://www.youtube-nocookie.com/embed/' . self::e($l['src']) . '</code></dd></dl>'
                . '<p class="small"><a class="btn sm ghost" href="https://www.youtube.com/watch?v=' . self::e($l['src']) . '" target="_blank" rel="noopener noreferrer">유튜브에서 열어 확인 ↗</a></p>' . $app
                . '<p class="small dim">영상 주인이 "다른 사이트에서 재생"을 막아 둔 영상은 체험관에서 재생되지 않아요. 그럴 때는 다른 영상을 고르거나 영상 설정을 바꿔 주세요.</p>';
        }
        if ($l['kind'] === 'slides' || $l['kind'] === 'link') {
            return '<h4>미리 보기</h4><dl class="facts"><dt>' . ($l['kind'] === 'slides' ? '화면에 넣는 주소' : '새 창으로 여는 주소') . '</dt><dd><code>' . self::e($l['src']) . '</code></dd></dl>'
                . '<p class="small"><a class="btn sm ghost" href="' . self::e($l['src']) . '" target="_blank" rel="noopener noreferrer">주소 열어 확인 ↗</a></p>' . $app;
        }
        if (!$l['files']) return '<h4>미리 보기</h4><p class="nophoto">아직 파일이 없어요. 아래에서 올려 주세요.</p>';
        if ($l['kind'] === 'pdf' || $l['kind'] === 'pptx') {
            $f = $l['files'][0];
            return '<h4>미리 보기</h4><dl class="facts"><dt>파일</dt><dd>' . self::e(self::size($f['bytes'])) . ($l['kind'] === 'pptx' && $f['w'] > 0 ? ' · 슬라이드 ' . (int) $f['w'] . '장' : '') . '</dd><dt>지문</dt><dd><code>' . self::e(substr($f['sha256'], 0, 16)) . '…</code></dd></dl>'
                . '<p class="small"><a class="btn sm ghost" href="./?lecfile=' . $id . '.0" target="_blank" rel="noopener noreferrer">' . ($l['kind'] === 'pdf' ? '📄 PDF 열어 보기 (새 창)' : '⬇️ 올린 파일 내려받기') . '</a></p>' . $app
                . ($l['kind'] === 'pptx' ? '<p class="small dim">체험관은 글과 그림을 순서대로 보여 주는 "간단 보기"로 보여 줘요. 원본 모양 그대로 보여 주려면 PDF 나 그림으로 저장해서 올려 주세요.</p>' : '');
        }
        // an image deck: every slide with its buttons (one form for all of them)
        $h = '<h4>슬라이드 ' . count($l['files']) . '장</h4>' . self::open('lecture_file', ['id' => $id, 'edit' => $id], 'inline', false, 'lecfile') . '</form><div class="lecgrid">';
        $last = count($l['files']) - 1;
        foreach ($l['files'] as $i => $f) {
            $b = function (string $what, string $label, string $cls = 'btn sm ghost') use ($f) {
                return '<button type="submit" form="lecfile" name="pick" value="' . (int) $f['n'] . ':' . self::e($what) . '" class="' . self::e($cls) . '">' . self::e($label) . '</button>';
            };
            $h .= '<figure class="lecthumb"><img class="photo" src="./?lecfile=' . $id . '.' . (int) $f['n'] . '" alt="슬라이드 ' . ($i + 1) . '" loading="lazy" width="' . (int) $f['w'] . '" height="' . (int) $f['h'] . '">'
                . '<figcaption><span class="small dim">' . ($i + 1) . '</span> ' . ($i > 0 ? $b('up', '←') : '') . ($i < $last ? $b('down', '→') : '') . $b('del', '지우기', 'btn sm danger') . '</figcaption></figure>';
        }
        return $h . '</div>' . $app;
    }

    private static function settingsCard(): string
    {
        $lim = Lecture::limits();
        $hosts = Lecture::slideHosts();
        $h = '<section class="card"><h3>⚙️ 강의실 설정</h3>' . self::open('lecture_settings')
            . self::check('auto_open', '"들어가면 자동으로 열기"를 켠 강의를 방에 들어갈 때 스스로 열어요', Lecture::opt('auto_open', true) !== false)
            . self::check('office_viewer', '파워포인트(.pptx)를 마이크로소프트 온라인 보기 창으로 보여 줘요 (공개 https 사이트 + "누구나" 강의만 · 파일이 그 회사 서버로 전달돼요)', Lecture::opt('office_viewer', false) === true)
            . '<div class="fgrid"><label>PDF 최대 크기(MB)<input type="number" name="pdf_max_bytes" min="1" max="200" required value="' . (int) round($lim['pdf'] / 1048576) . '"></label>'
            . '<label>PPTX 최대 크기(MB)<input type="number" name="pptx_max_bytes" min="1" max="200" required value="' . (int) round($lim['pptx'] / 1048576) . '"></label>'
            . '<label>그림 한 장 최대 크기(MB)<input type="number" name="image_max_bytes" min="1" max="20" required value="' . (int) max(1, round($lim['image'] / 1048576)) . '"></label>'
            . '<label>강의 하나의 그림 수<input type="number" name="images_max" min="1" max="200" required value="' . (int) $lim['images'] . '"></label></div>'
            . '<p class="small dim">온라인 슬라이드로 넣을 수 있는 곳 (체험관이 화면에 넣는 곳은 이 목록과 유튜브뿐이에요):</p>';
        foreach (Lecture::SLIDE_HOSTS as $host) $h .= '<label class="check"><input type="checkbox" name="slide_hosts[]" value="' . self::e($host) . '"' . (in_array($host, $hosts, true) ? ' checked' : '') . '> ' . self::e($host) . '</label>';
        return $h . '<div class="row"><button type="submit" class="btn">💾 설정 저장</button></div></form></section>';
    }

    // ------------------------------------------------------------------ actions
    /** where the form came from: the edit card of a lecture (only a number passes) */
    public static function back(array $post): array
    {
        $e = self::id($post, 'edit');
        return $e > 0 ? ['edit' => $e] : [];
    }

    private static function ok(string $msg, array $back = []): array { return ['msg' => $msg, 'back' => $back]; }

    /** the checked form fields of a lecture (a missing checkbox is "off") */
    private static function fields(array $p, bool $address): array
    {
        $in = ['title' => self::s($p, 'title'), 'place' => self::s($p, 'place'), 'audience' => self::s($p, 'audience') === '' ? 'all' : self::s($p, 'audience'),
            'autoplay' => isset($p['autoplay']) ? '1' : '0', 'enabled' => isset($p['enabled']) ? '1' : '0'];
        if ($address) $in['address'] = self::s($p, 'address');
        return $in;
    }

    private static function pick(array $p, string $rx): array
    {
        if (!preg_match('/^(\d{1,12}):(' . $rx . ')$/', self::s($p, 'pick'), $m)) throw new ApiException(400, 'INVALID_INPUT', '목록에서 단추를 다시 눌러 주세요.');
        return [(int) $m[1], $m[2]];
    }

    /** the uploaded files of this request; an upload action without any file is a plain mistake */
    private static function files(Ctx $c): array
    {
        RateLimit::hit('lecture_upload', 'u:' . $c->uid());
        $files = Upload::incoming('files', self::FILES_PER_POST);
        if (!$files) throw new ApiException(400, 'UPLOAD_MISSING', '올릴 파일을 골라 주세요.');
        return $files;
    }

    private static function room(array $files): void
    {
        $need = 0;
        foreach ($files as $f) $need += max(0, (int) $f['size']);
        if ($need > Lecture::storageLeft()) throw new ApiException(400, 'LECTURE_LIMIT', '강의 파일 저장 공간이 가득 찼어요. 쓰지 않는 강의를 지운 뒤 다시 해 주세요.');
    }

    public static function action(string $action, Ctx $c, array $p): array
    {
        $admin = (array) $c->user;
        switch ($action) {
            case 'lecture_add_link': {
                $l = Lecture::create($admin, self::fields($p, true));
                $k = Lecture::KIND_KO[$l['kind']];
                return self::ok('🎓 강의를 추가했어요 — ' . $k[0] . ' ' . $k[1] . ': ' . $l['title'], ['edit' => $l['id']]);
            }
            case 'lecture_add_file': {
                $kind = self::s($p, 'kind');
                if (!in_array($kind, Lecture::FILE_KINDS, true)) throw new ApiException(400, 'INVALID_INPUT', '파일 종류를 골라 주세요.');
                $files = self::files($c);
                if ($kind !== 'images' && count($files) !== 1) throw new ApiException(400, 'INVALID_INPUT', ($kind === 'pdf' ? 'PDF' : '파워포인트') . ' 파일은 하나만 골라 주세요.');
                self::room($files);
                $in = self::fields($p, false);
                $in['kind'] = $kind;
                $l = Lecture::create($admin, $in);
                try {
                    $r = self::store($admin, $l, $files);
                } catch (\Throwable $e) {
                    try { Lecture::delete($admin, $l['id']); } catch (\Throwable $e2) { /* the list shows it as "파일 없음" */ }
                    throw $e;
                }
                if ($r['stored'] === 0) {
                    try { Lecture::delete($admin, $l['id']); } catch (\Throwable $e2) { /* shown as "파일 없음" */ }
                    throw new ApiException(400, 'UPLOAD_REJECTED', '올린 파일을 받지 못했어요 — ' . implode(' / ', $r['errors']));
                }
                return self::ok('🎓 강의를 추가했어요 — ' . $l['title'] . ' (' . ($kind === 'images' ? '그림 ' . $r['stored'] . '장' : self::size($r['bytes'])) . ')' . ($r['errors'] ? ' · 받지 못한 파일 ' . count($r['errors']) . '개: ' . implode(' / ', $r['errors']) : ''), ['edit' => $l['id']]);
            }
            case 'lecture_save': {
                $id = self::id($p, 'id');
                $before = Lecture::get($id);
                $l = Lecture::update($admin, $id, self::fields($p, $before !== null && !in_array($before['kind'], Lecture::FILE_KINDS, true)));
                return self::ok('💾 저장했어요 — ' . $l['title'], ['edit' => $l['id']]);
            }
            case 'lecture_row': {
                list($id, $what) = self::pick($p, 'up|down|on|off');
                if ($what === 'up' || $what === 'down') { Lecture::move($admin, $id, $what === 'up' ? -1 : 1); return self::ok('↕️ 순서를 바꿨어요.'); }
                $l = Lecture::setEnabled($admin, $id, $what === 'on');
                return self::ok(($what === 'on' ? '✅ 켰어요 — ' : '⏸️ 껐어요 — ') . $l['title']);
            }
            case 'lecture_delete': {
                $id = self::id($p, 'id');
                if (self::s($p, 'sure') !== '1') throw new ApiException(400, 'INVALID_INPUT', '지우려면 "이 강의를 지워요"에 표시해 주세요.');
                $l = Lecture::get($id);
                Lecture::delete($admin, $id);
                return self::ok('🗑️ 강의를 지웠어요' . ($l ? ' — ' . $l['title'] : '') . '.', ['edit' => null]);
            }
            case 'lecture_replace': {
                $id = self::id($p, 'id');
                $l = Lecture::get($id);
                if ($l === null || ($l['kind'] !== 'pdf' && $l['kind'] !== 'pptx')) throw new ApiException(400, 'INVALID_INPUT', '파일을 바꿀 수 있는 강의가 아니에요.');
                $files = self::files($c);
                if (count($files) !== 1) throw new ApiException(400, 'INVALID_INPUT', '파일은 하나만 골라 주세요.');
                self::room($files);
                $r = self::store($admin, $l, $files);
                if ($r['stored'] === 0) throw new ApiException(400, 'UPLOAD_REJECTED', '올린 파일을 받지 못했어요 — ' . implode(' / ', $r['errors']));
                return self::ok('⬆️ 파일을 바꿨어요 — ' . $l['title'] . ' (' . self::size($r['bytes']) . ')', ['edit' => $id]);
            }
            case 'lecture_images': {
                $id = self::id($p, 'id');
                $l = Lecture::get($id);
                if ($l === null || $l['kind'] !== 'images') throw new ApiException(400, 'INVALID_INPUT', '그림을 넣을 수 있는 강의가 아니에요.');
                $files = self::files($c);
                self::room($files);
                $r = self::store($admin, $l, $files);
                if ($r['stored'] === 0) throw new ApiException(400, 'UPLOAD_REJECTED', '올린 그림을 받지 못했어요 — ' . implode(' / ', $r['errors']));
                return self::ok('🖼️ 그림 ' . $r['stored'] . '장을 넣었어요' . ($r['errors'] ? ' · 받지 못한 파일 ' . count($r['errors']) . '개: ' . implode(' / ', $r['errors']) : '') . '.', ['edit' => $id]);
            }
            case 'lecture_file': {
                $id = self::id($p, 'id');
                list($n, $what) = self::pick($p, 'up|down|del');
                if ($what === 'del') { Lecture::removeFile($admin, $id, $n); return self::ok('🗑️ 그림을 뺐어요.', ['edit' => $id]); }
                Lecture::moveFile($admin, $id, $n, $what === 'up' ? -1 : 1);
                return self::ok('↔️ 그림 순서를 바꿨어요.', ['edit' => $id]);
            }
            case 'lecture_settings': {
                Lecture::setOption($admin, 'auto_open', isset($p['auto_open']));
                Lecture::setOption($admin, 'office_viewer', isset($p['office_viewer']));
                foreach (['pdf_max_bytes', 'pptx_max_bytes', 'image_max_bytes', 'images_max'] as $k) Lecture::setOption($admin, $k, self::s($p, $k));
                Lecture::setOption($admin, 'slide_hosts', isset($p['slide_hosts']) && is_array($p['slide_hosts']) ? array_filter($p['slide_hosts'], 'is_string') : []);
                return self::ok('⚙️ 강의실 설정을 저장했어요.');
            }
        }
        throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.');
    }

    /**
     * Check and store the files of one upload for lecture $l: one document (pdf / pptx) or the pictures of a deck.
     * Pictures are taken one by one — a refused picture does not stop the others; its reason is reported.
     * @return array{stored:int, bytes:int, errors:string[]}
     */
    private static function store(array $admin, array $l, array $files): array
    {
        $lim = Lecture::limits();
        $out = ['stored' => 0, 'bytes' => 0, 'errors' => []];
        if ($l['kind'] === 'pdf' || $l['kind'] === 'pptx') {
            $rec = Upload::lectureFile($admin, $files[0], $l['kind'], ['maxBytes' => $lim[$l['kind']]]);
            Lecture::setDocument($admin, $l['id'], $rec);
            return ['stored' => 1, 'bytes' => $rec['bytes'], 'errors' => []];
        }
        $have = count($l['files']);
        foreach ($files as $i => $f) {
            if ($have + $out['stored'] >= $lim['images']) { $out['errors'][] = ($i + 1) . '번째부터: 그림은 강의 하나에 ' . $lim['images'] . '장까지예요'; break; }
            try {
                $rec = Upload::lectureFile($admin, $f, 'image', ['maxBytes' => $lim['image'], 'maxDimension' => $lim['dimension']]);
                Lecture::addImage($admin, $l['id'], $rec);
                $out['stored']++;
                $out['bytes'] += $rec['bytes'];
            } catch (ApiException $e) {
                $out['errors'][] = ($i + 1) . '번째: ' . $e->getMessage();
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ the preview's files
    /** GET ./?lecfile=<id>.<n> for an elevated administrator (the entry checked that): any lecture, also a switched-off one */
    public static function serve(array $admin, string $spec): void
    {
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin' || !preg_match('/^([1-9]\d{0,11})\.(\d{1,3})$/', $spec, $m)) throw new ApiException(404, 'NOT_FOUND', '강의 자료를 찾을 수 없어요.');
        $l = Lecture::get((int) $m[1]);
        if ($l !== null) foreach ($l['files'] as $f) if ($f['n'] === (int) $m[2]) Lecture::stream($f, $l['id'], true);
        throw new ApiException(404, 'NOT_FOUND', '강의 자료를 찾을 수 없어요.');
    }
}
