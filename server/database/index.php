<?php
// private directory guard (for servers that ignore .htaccess, e.g. php -S / nginx without rules)
if (function_exists('header_remove')) header_remove('X-Powered-By'); // no PHP version banner on a direct hit (CONTRACT §15.7 #11)
http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');
exit;
