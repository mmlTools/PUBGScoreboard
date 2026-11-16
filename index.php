<?php
/**
 * Front controller for Apache (see .htaccess) and `php -S`.
 *
 * This path has no WebSocket; the pages fall back to fast HTTP polling.
 * For instant updates run the standalone server instead: `php server.php`.
 */

require_once __DIR__ . '/Engine/Store.php';
require_once __DIR__ . '/Engine/Api.php';
require_once __DIR__ . '/Engine/Pages.php';

use Engine\Api;
use Engine\Pages;
use Engine\Store;

// URL prefix of the app: "/" at a domain root, "/PUBGScoreboard/" in an htdocs subfolder.
// (As a `php -S` router script, SCRIPT_NAME is the requested file instead — that setup always runs at "/".)
$script = str_replace('\\', '/', isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/index.php');
// dirname('/index.php') is "\" on Windows, hence the second replace.
$base = basename($script) === 'index.php' ? rtrim(str_replace('\\', '/', dirname($script)), '/') . '/' : '/';
$uri = (string) parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
$path = rawurldecode($uri);
if (strncmp($path, $base, strlen($base)) === 0) {
    $path = substr($path, strlen($base));
}
$path = trim((string) preg_replace('~^index\.php/?~', '', ltrim($path, '/')), '/');

// `php -S host:port index.php`: let the built-in server deliver real files.
if (PHP_SAPI === 'cli-server' && $path !== '' && is_file(__DIR__ . '/' . $path) && Pages::isPublicFile($path)) {
    return false;
}

if ($path === 'api' || strncmp($path, 'api/', 4) === 0) {
    $headers = [];
    foreach ($_SERVER as $name => $value) {
        if (strncmp($name, 'HTTP_', 5) === 0) {
            $headers[strtolower(str_replace('_', '-', substr($name, 5)))] = $value;
        }
    }
    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers['content-type'] = $_SERVER['CONTENT_TYPE'];
    }
    $api = new Api(new Store(), ['mode' => 'php', 'realtime' => false, 'port' => isset($_SERVER['SERVER_PORT']) ? (int) $_SERVER['SERVER_PORT'] : null]);
    $res = $api->handle(
        isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET',
        $path,
        $_GET,
        $headers,
        (string) file_get_contents('php://input'),
        isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : ''
    );
    http_response_code($res['status']);
    foreach ($res['headers'] as $name => $value) {
        header($name . ': ' . $value);
    }
    echo $res['body'];
    return;
}

$view = Pages::view($path);
if ($view === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found. The control panel lives at {$base} and the overlay at {$base}scoreboard";
    return;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo Pages::render($view, $base, ['realtime' => false]);
