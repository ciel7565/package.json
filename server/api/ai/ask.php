<?php
/**
 * POST api/ai/ask.php {presetId} | {question} → { ok, answer, why, left, presetId }
 * One question to 옹이 선생님 (CONTRACT §15.6 / §16.10, owner: claude). Login + CSRF (header) + rate limit ai_ask.
 *   presetId  one of the ids api/ai/status.php lists — the question text is resolved on the server, so in easy mode no
 *             typed text of a child ever leaves the app;
 *   question  typed text (normal mode), at most anthropic.question_max (200) characters. Bad words → not sent; personal
 *             data (phone, e-mail, address …) masked by ChatFilter::maskPII BEFORE it leaves the server.
 * Exactly one of the two; unknown fields → 400. The answer is masked again, stripped of links and markup and cut at
 * anthropic.answer_max (600) characters; it is plain text (the page puts it into the DOM with textContent).
 * Switched off, capped (per account ai.daily_user / per server ai.daily_total), refused, empty or unreachable: 200 with
 * ok false, a short `why` and one calm sentence in `answer` — the page shows it with a way back (never a dead end).
 * Nothing the visitor typed is stored: the usage row (ai_usage) holds who, when, the scope, the token counts and the
 * stop reason only.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Claude;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'ai_ask'], function (Ctx $c): array {
    $in = $c->json(4096);
    V::keys($in, ['presetId', 'question']);
    $hasP = V::has($in, 'presetId');
    $hasQ = V::has($in, 'question');
    if ($hasP === $hasQ) V::fail($hasP ? 'question' : 'presetId', '준비된 질문(presetId)이나 직접 쓴 질문(question) 하나만 보내 주세요.');
    $ask = [];
    if ($hasP) $ask['presetId'] = (string) V::enum($in['presetId'], 'presetId', Claude::presetIds());
    else $ask['question'] = V::str($in['question'], 'question', Claude::questionMax(), 1);
    Session::close(); // the call can take seconds: never hold the session file meanwhile
    return Claude::kidAsk($c->uid(), $ask);
});
