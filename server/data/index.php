<?php
// private directory guard (for servers that ignore .htaccess, e.g. php -S / nginx without rules)
http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('X-Content-Type-Options: nosniff');
exit;
