#!/usr/bin/env php
<?php
/**
 * PUBG Scoreboard — standalone server.
 *
 * Serves the control panel, the OBS overlay, the JSON API and a WebSocket
 * endpoint (/ws) from a single port, using nothing but PHP core streams.
 *
 *   php server.php                 local only   -> http://localhost:8080
 *   php server.php --lan           also reachable from phones / other PCs
 *   php server.php --port=9000     another port
 *   php server.php --open          open the control panel in the browser
 *   php server.php --allow-host=scores.example.com   extra host name to answer to (reverse proxy)
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/Engine/Store.php';
require_once __DIR__ . '/Engine/Api.php';
require_once __DIR__ . '/Engine/Pages.php';

use Engine\Api;
use Engine\Pages;
use Engine\Store;

set_time_limit(0);
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');

final class ScoreboardServer
{
    const MAX_CLIENTS = 200;
    const MAX_HEADER = 16384;
    const MAX_BODY = 12582912;      // 12 MB (config imports carry inline images)
    const MAX_WS_MESSAGE = 1048576; // 1 MB
    const MAX_OUT_BUFFER = 33554432;
    const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

    /** @var resource */
    private $server;
    /** @var array<int, array> */
    private $clients = [];
    /** @var Api */
    private $api;
    /** @var Store */
    private $store;
    private $root;
    private $host;
    private $port;
    private $lan;
    private $quiet;
    private $allowedHosts = [];
    private $fingerprint = '';
    private $lastPing = 0;

    public function __construct(array $opt)
    {
        $this->root = __DIR__;
        $this->lan = !empty($opt['lan']);
        $this->host = isset($opt['host']) ? $opt['host'] : ($this->lan ? '0.0.0.0' : '127.0.0.1');
        $this->port = isset($opt['port']) ? (int) $opt['port'] : 8080;
        $this->quiet = !empty($opt['quiet']);
        $this->allowedHosts = array_filter(array_map('trim', explode(',', strtolower(isset($opt['allow-host']) ? (string) $opt['allow-host'] : ''))));
        $this->store = new Store();
        $this->api = new Api($this->store, [
            'mode' => 'standalone',
            'realtime' => true,
            'port' => $this->port,
            'lan' => $this->host !== '127.0.0.1' && $this->host !== 'localhost',
        ]);
    }

    public function url()
    {
        return 'http://localhost' . ($this->port === 80 ? '' : ':' . $this->port) . '/';
    }

    /** @return bool false when the port is taken */
    public function listen()
    {
        // Windows lets a second process bind a port that is already being listened on
        // (PHP sets SO_REUSEADDR), which would leave two servers fighting over the
        // same address. So look before binding: if something answers, the port is taken.
        $probe = @stream_socket_client('tcp://127.0.0.1:' . $this->port, $errno, $errstr, 0.5);
        if ($probe) {
            fclose($probe);
            return false;
        }
        $bind = strpos($this->host, ':') !== false ? '[' . $this->host . ']' : $this->host;
        $server = @stream_socket_server('tcp://' . $bind . ':' . $this->port, $errno, $errstr);
        if (!$server) {
            return false;
        }
        stream_set_blocking($server, false);
        $this->server = $server;
        $this->fingerprint = $this->store->fingerprint();
        return true;
    }

    public function banner()
    {
        $v = Api::version();
        $lines = [
            '',
            '  PUBG SCOREBOARD  v' . $v,
            '  ' . str_repeat('-', 46),
            '  Control panel   ' . $this->url(),
            '  OBS overlay     ' . $this->url() . 'scoreboard',
        ];
        if ($this->host !== '127.0.0.1' && $this->host !== 'localhost') {
            foreach (Api::lanAddresses() as $ip) {
                $lines[] = '  Remote control  http://' . $ip . ':' . $this->port . '/?key=' . $this->api->key();
            }
        } else {
            $lines[] = '  Remote control  off (start with --lan to control from a phone)';
        }
        $lines[] = '  ' . str_repeat('-', 46);
        $lines[] = '  Keep this window open while you stream. Ctrl+C stops the server.';
        $lines[] = '';
        fwrite(STDOUT, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    public function run()
    {
        while (true) {
            $read = [$this->server];
            $write = [];
            foreach ($this->clients as $id => $c) {
                $read[] = $c['sock'];
                if ($c['out'] !== '') {
                    $write[] = $c['sock'];
                }
            }
            $except = null;
            $n = @stream_select($read, $write, $except, 1, 0);
            if ($n === false) {
                usleep(50000);
                continue;
            }
            foreach ($write as $sock) {
                $this->flush((int) $sock);
            }
            foreach ($read as $sock) {
                if ($sock === $this->server) {
                    $this->accept();
                } else {
                    $this->read((int) $sock);
                }
            }
            $this->tick();
        }
    }

    // ------------------------------------------------------------------
    // Connections
    // ------------------------------------------------------------------

    private function accept()
    {
        while ($sock = @stream_socket_accept($this->server, 0, $peer)) {
            if (count($this->clients) >= self::MAX_CLIENTS) {
                fclose($sock);
                continue;
            }
            stream_set_blocking($sock, false);
            $peer = (string) $peer;
            $colon = strrpos($peer, ':');
            $this->clients[(int) $sock] = [
                'sock' => $sock,
                'addr' => trim($colon === false ? $peer : substr($peer, 0, $colon), '[]'),
                'in' => '',
                'out' => '',
                'ws' => false,
                'role' => '',
                'obs' => false,
                'frag' => null,
                'seen' => time(),
                'close' => false,
            ];
        }
    }

    private function read($id)
    {
        if (!isset($this->clients[$id])) {
            return;
        }
        $c = &$this->clients[$id];
        $chunk = @fread($c['sock'], 65536);
        if ($chunk === false || ($chunk === '' && feof($c['sock']))) {
            unset($c);
            $this->drop($id);
            return;
        }
        if ($chunk === '') {
            return;
        }
        $c['seen'] = time();
        $c['in'] .= $chunk;
        $isWs = $c['ws'];
        unset($c);
        if ($isWs) {
            $this->readFrames($id);
        } else {
            $this->readHttp($id);
        }
    }

    private function send($id, $bytes)
    {
        if (!isset($this->clients[$id])) {
            return;
        }
        $this->clients[$id]['out'] .= $bytes;
        if (strlen($this->clients[$id]['out']) > self::MAX_OUT_BUFFER) {
            $this->drop($id); // a client that never reads
            return;
        }
        $this->flush($id);
    }

    private function flush($id)
    {
        if (!isset($this->clients[$id])) {
            return;
        }
        $c = &$this->clients[$id];
        if ($c['out'] !== '') {
            $written = @fwrite($c['sock'], $c['out']);
            if ($written === false) {
                unset($c);
                $this->drop($id);
                return;
            }
            if ($written > 0) {
                $c['out'] = (string) substr($c['out'], $written);
            }
        }
        $done = $c['out'] === '' && $c['close'];
        unset($c);
        if ($done) {
            $this->drop($id);
        }
    }

    private function drop($id)
    {
        if (!isset($this->clients[$id])) {
            return;
        }
        $c = $this->clients[$id];
        unset($this->clients[$id]);
        @fclose($c['sock']);
        if ($c['ws']) {
            $this->log('- ' . ($c['role'] ?: 'client') . ' disconnected (' . $c['addr'] . ')');
            $this->broadcastPresence();
        }
    }

    // ------------------------------------------------------------------
    // HTTP
    // ------------------------------------------------------------------

    private function readHttp($id)
    {
        while (isset($this->clients[$id]) && !$this->clients[$id]['ws'] && !$this->clients[$id]['close']) {
            $buf = $this->clients[$id]['in'];
            $end = strpos($buf, "\r\n\r\n");
            if ($end === false) {
                if (strlen($buf) > self::MAX_HEADER) {
                    $this->respond($id, 431, [], 'Request header too large', false);
                }
                return;
            }
            $lines = explode("\r\n", substr($buf, 0, $end));
            $start = explode(' ', (string) array_shift($lines));
            if (count($start) < 3 || strncmp($start[2], 'HTTP/1.', 7) !== 0) {
                $this->respond($id, 400, [], 'Bad request', false);
                return;
            }
            $headers = [];
            foreach ($lines as $line) {
                $colon = strpos($line, ':');
                if ($colon !== false) {
                    $headers[strtolower(trim(substr($line, 0, $colon)))] = trim(substr($line, $colon + 1));
                }
            }
            if (isset($headers['transfer-encoding'])) {
                $this->respond($id, 411, [], 'Send a Content-Length', false);
                return;
            }
            $length = isset($headers['content-length']) ? (int) $headers['content-length'] : 0;
            if ($length < 0 || $length > self::MAX_BODY) {
                $this->respond($id, 413, ['Content-Type' => 'application/json'], '{"ok":false,"error":"File too large (12 MB max)."}', false);
                return;
            }
            if (strlen($buf) < $end + 4 + $length) {
                return; // body still arriving
            }
            $body = (string) substr($buf, $end + 4, $length);
            $this->clients[$id]['in'] = (string) substr($buf, $end + 4 + $length);

            $keep = $start[2] === 'HTTP/1.1' && (!isset($headers['connection']) || stripos($headers['connection'], 'close') === false);
            try {
                $this->route($id, strtoupper($start[0]), $start[1], $headers, $body, $keep);
            } catch (\Throwable $e) {
                $this->log('! ' . $e->getMessage());
                $this->respond($id, 500, [], 'Server error', false);
            }
        }
    }

    private function route($id, $method, $target, array $headers, $body, $keep)
    {
        $qpos = strpos($target, '?');
        $rawPath = $qpos === false ? $target : substr($target, 0, $qpos);
        $query = [];
        if ($qpos !== false) {
            parse_str(substr($target, $qpos + 1), $query);
        }
        $path = trim(rawurldecode($rawPath), '/');
        if (strpos($path, "\0") !== false || preg_match('~(^|/)\.\.?(/|$)~', $path) || strpos($path, '\\') !== false) {
            $this->respond($id, 400, [], 'Bad path', false);
            return;
        }
        if (!$this->hostAllowed(isset($headers['host']) ? $headers['host'] : '')) {
            $this->respond($id, 403, [], "This address is not allowed. Open the scoreboard by IP address or as http://localhost,\nor start the server with --allow-host=<name>.", false);
            return;
        }
        $addr = $this->clients[$id]['addr'];

        if ($path === 'ws') {
            $this->upgrade($id, $headers, $query);
            return;
        }

        if ($path === 'api' || strncmp($path, 'api/', 4) === 0) {
            $res = $this->api->handle($method, $path, $query, $headers, $body, $addr);
            $this->respond($id, $res['status'], $res['headers'], $res['body'], $keep);
            if ($res['changed']) {
                $this->broadcastState();
            }
            return;
        }

        if ($method !== 'GET' && $method !== 'HEAD') {
            $this->respond($id, 405, ['Allow' => 'GET, HEAD'], 'Method not allowed', $keep);
            return;
        }

        $view = Pages::view($path);
        if ($view !== null) {
            $html = Pages::render($view, '/', ['realtime' => true]);
            $this->respond($id, 200, ['Content-Type' => Pages::MIME['html'], 'Cache-Control' => 'no-cache'], $html, $keep, $method === 'HEAD');
            return;
        }

        if (Pages::isPublicFile($path)) {
            $isUpload = strncmp($path, 'Autoload/uploads/', 17) === 0;
            $rootReal = realpath($isUpload ? $this->store->dir() . '/uploads' : $this->root);
            $file = realpath($isUpload ? $rootReal . '/' . basename($path) : $this->root . '/' . $path);
            if ($file !== false && is_file($file) && strncmp($file, $rootReal . DIRECTORY_SEPARATOR, strlen($rootReal) + 1) === 0) {
                clearstatcache(true, $file);
                $etag = '"' . dechex((int) filemtime($file)) . '-' . dechex((int) filesize($file)) . '"';
                $h = [
                    'Content-Type' => Pages::mime($file),
                    'ETag' => $etag,
                    // Uploads are content-addressed and never change; everything else revalidates.
                    'Cache-Control' => strncmp($path, 'Autoload/uploads/', 17) === 0 ? 'public, max-age=31536000, immutable' : 'no-cache',
                    'X-Content-Type-Options' => 'nosniff',
                ];
                if (isset($headers['if-none-match']) && $headers['if-none-match'] === $etag) {
                    $this->respond($id, 304, $h, '', $keep);
                    return;
                }
                $this->respond($id, 200, $h, (string) file_get_contents($file), $keep, $method === 'HEAD');
                return;
            }
        }

        $this->respond($id, 404, ['Content-Type' => 'text/plain; charset=utf-8'], 'Not found', $keep);
    }

    /**
     * DNS-rebinding guard. A hostile web page can point its own domain at
     * 127.0.0.1 and would then be "same-origin" with this server; the Host
     * header gives it away. IP addresses, localhost and this machine's name are fine.
     */
    private function hostAllowed($host)
    {
        $name = strtolower(trim((string) preg_replace('/:\d+$/', '', trim($host)), '[]'));
        if ($name === '' || $name === 'localhost' || filter_var($name, FILTER_VALIDATE_IP) !== false) {
            return true;
        }
        $machine = strtolower((string) gethostname());
        if ($name === $machine || $name === $machine . '.local' || substr($name, -6) === '.local') {
            return true;
        }
        return in_array($name, $this->allowedHosts, true);
    }

    private function respond($id, $status, array $headers, $body, $keep, $headOnly = false)
    {
        static $reasons = [
            101 => 'Switching Protocols', 200 => 'OK', 204 => 'No Content', 304 => 'Not Modified',
            400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not Found',
            405 => 'Method Not Allowed', 409 => 'Conflict', 411 => 'Length Required', 413 => 'Payload Too Large',
            415 => 'Unsupported Media Type', 422 => 'Unprocessable Entity', 426 => 'Upgrade Required',
            431 => 'Request Header Fields Too Large', 500 => 'Internal Server Error',
        ];
        if (!isset($this->clients[$id])) {
            return;
        }
        $head = 'HTTP/1.1 ' . $status . ' ' . (isset($reasons[$status]) ? $reasons[$status] : 'OK') . "\r\n";
        $headers += ['Content-Type' => 'text/plain; charset=utf-8'];
        if ($status === 304 || $status === 204) {
            unset($headers['Content-Type']);
            $body = '';
        }
        if ($status !== 304) {
            $headers['Content-Length'] = strlen($body);
        }
        $headers['Connection'] = $keep ? 'keep-alive' : 'close';
        foreach ($headers as $name => $value) {
            $head .= $name . ': ' . str_replace(["\r", "\n"], '', (string) $value) . "\r\n";
        }
        if (!$keep) {
            $this->clients[$id]['close'] = true;
        }
        $this->send($id, $head . "\r\n" . ($headOnly ? '' : $body));
    }

    // ------------------------------------------------------------------
    // WebSocket
    // ------------------------------------------------------------------

    private function upgrade($id, array $headers, array $query)
    {
        $isUpgrade = isset($headers['upgrade']) && strtolower($headers['upgrade']) === 'websocket' && isset($headers['sec-websocket-key']);
        if (!$isUpgrade) {
            $this->respond($id, 426, ['Upgrade' => 'websocket'], 'This endpoint speaks WebSocket.', false);
            return;
        }
        // Browsers always send Origin; refuse pages from other sites.
        if (isset($headers['origin'], $headers['host'])) {
            $origin = parse_url($headers['origin']);
            $originHost = isset($origin['host']) ? $origin['host'] . (isset($origin['port']) ? ':' . $origin['port'] : '') : '';
            if (strcasecmp($originHost, $headers['host']) !== 0) {
                $this->respond($id, 403, [], 'Cross-origin WebSocket refused.', false);
                return;
            }
        }
        $accept = base64_encode(sha1($headers['sec-websocket-key'] . self::WS_GUID, true));
        $this->clients[$id]['ws'] = true;
        $this->clients[$id]['key'] = isset($query['key']) && is_string($query['key']) ? $query['key'] : '';
        $this->send($id, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {$accept}\r\n\r\n");

        $state = $this->store->load();
        $this->sendJson($id, ['type' => 'hello', 'version' => Api::version(), 'rev' => $state['rev'], 'state' => $state]);
        // Frames may already be waiting behind the handshake.
        if (isset($this->clients[$id]) && $this->clients[$id]['in'] !== '') {
            $this->readFrames($id);
        }
    }

    private static function frame($payload, $opcode = 1)
    {
        $len = strlen($payload);
        $head = chr(0x80 | $opcode);
        if ($len < 126) {
            $head .= chr($len);
        } elseif ($len < 65536) {
            $head .= chr(126) . pack('n', $len);
        } else {
            $head .= chr(127) . pack('NN', 0, $len);
        }
        return $head . $payload;
    }

    private function sendJson($id, array $message)
    {
        $this->send($id, self::frame((string) json_encode($message, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)));
    }

    private function closeWs($id, $code)
    {
        if (isset($this->clients[$id])) {
            $this->clients[$id]['close'] = true;
            $this->send($id, self::frame(pack('n', $code), 8));
        }
    }

    private function readFrames($id)
    {
        while (isset($this->clients[$id]) && !$this->clients[$id]['close']) {
            $buf = $this->clients[$id]['in'];
            $have = strlen($buf);
            if ($have < 2) {
                return;
            }
            $b0 = ord($buf[0]);
            $b1 = ord($buf[1]);
            $fin = ($b0 & 0x80) !== 0;
            $opcode = $b0 & 0x0F;
            $masked = ($b1 & 0x80) !== 0;
            $len = $b1 & 0x7F;
            $offset = 2;
            if ($len === 126) {
                if ($have < 4) {
                    return;
                }
                $len = unpack('n', substr($buf, 2, 2))[1];
                $offset = 4;
            } elseif ($len === 127) {
                if ($have < 10) {
                    return;
                }
                $parts = unpack('N2', substr($buf, 2, 8));
                if ($parts[1] !== 0) {
                    $this->closeWs($id, 1009);
                    return;
                }
                $len = $parts[2];
                $offset = 10;
            }
            // Clients must mask; reserved bits must be clear (no extensions negotiated).
            if (!$masked || ($b0 & 0x70) !== 0) {
                $this->closeWs($id, 1002);
                return;
            }
            if ($len > self::MAX_WS_MESSAGE) {
                $this->closeWs($id, 1009);
                return;
            }
            if ($have < $offset + 4 + $len) {
                return;
            }
            $mask = substr($buf, $offset, 4);
            $payload = (string) substr($buf, $offset + 4, $len);
            $this->clients[$id]['in'] = (string) substr($buf, $offset + 4 + $len);
            if ($len > 0) {
                $payload ^= substr(str_repeat($mask, (int) ceil($len / 4)), 0, $len);
            }

            switch ($opcode) {
                case 0x8: // close
                    $this->closeWs($id, 1000);
                    return;
                case 0x9: // ping
                    $this->send($id, self::frame($payload, 0xA));
                    break;
                case 0xA: // pong
                    break;
                case 0x0: // continuation
                case 0x1: // text
                case 0x2: // binary (treated like text)
                    $frag = $this->clients[$id]['frag'];
                    if ($opcode === 0x0 && $frag === null) {
                        $this->closeWs($id, 1002);
                        return;
                    }
                    $message = ($frag === null ? '' : $frag) . $payload;
                    if (strlen($message) > self::MAX_WS_MESSAGE) {
                        $this->closeWs($id, 1009);
                        return;
                    }
                    if (!$fin) {
                        $this->clients[$id]['frag'] = $message;
                        break;
                    }
                    $this->clients[$id]['frag'] = null;
                    $this->onMessage($id, $message);
                    break;
                default:
                    $this->closeWs($id, 1002);
                    return;
            }
        }
    }

    private function onMessage($id, $text)
    {
        $msg = json_decode($text, true);
        if (!is_array($msg) || !isset($msg['type'])) {
            return;
        }
        switch ($msg['type']) {
            case 'ping':
                $this->sendJson($id, ['type' => 'pong']);
                break;

            case 'identify':
                $role = isset($msg['role']) && in_array($msg['role'], ['overlay', 'control'], true) ? $msg['role'] : 'client';
                $this->clients[$id]['role'] = $role;
                $this->clients[$id]['obs'] = !empty($msg['obs']);
                $this->log('+ ' . $role . ($this->clients[$id]['obs'] ? ' (OBS)' : '') . ' connected (' . $this->clients[$id]['addr'] . ')');
                $this->broadcastPresence();
                break;

            case 'action':
                $reply = ['type' => 'result', 'id' => isset($msg['id']) ? $msg['id'] : null];
                try {
                    $key = isset($msg['key']) && is_string($msg['key']) ? $msg['key'] : $this->clients[$id]['key'];
                    $this->api->authorize($this->clients[$id]['addr'], $key);
                    $payload = isset($msg['payload']) && is_array($msg['payload']) ? $msg['payload'] : [];
                    list($state, $result) = $this->api->action(isset($msg['action']) ? (string) $msg['action'] : '', $payload);
                    $this->sendJson($id, $reply + ['ok' => true, 'rev' => $state['rev'], 'result' => $result]);
                    $this->broadcastState($state);
                } catch (\Throwable $e) {
                    $this->sendJson($id, $reply + ['ok' => false, 'error' => $e->getMessage()]);
                }
                break;
        }
    }

    private function broadcast($frame)
    {
        foreach (array_keys($this->clients) as $id) {
            if (isset($this->clients[$id]) && $this->clients[$id]['ws'] && !$this->clients[$id]['close']) {
                $this->send($id, $frame);
            }
        }
    }

    private function broadcastState($state = null)
    {
        if ($state === null) {
            $state = $this->store->load();
        }
        $this->fingerprint = $this->store->fingerprint();
        $this->broadcast(self::frame((string) json_encode(['type' => 'state', 'rev' => $state['rev'], 'state' => $state], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)));
    }

    private function broadcastPresence()
    {
        $p = ['type' => 'presence', 'overlays' => 0, 'obs' => 0, 'controls' => 0];
        foreach ($this->clients as $c) {
            if (!$c['ws'] || $c['close']) {
                continue;
            }
            if ($c['role'] === 'overlay') {
                $p['overlays']++;
                $p['obs'] += $c['obs'] ? 1 : 0;
            } elseif ($c['role'] === 'control') {
                $p['controls']++;
            }
        }
        $this->broadcast(self::frame((string) json_encode($p)));
    }

    // ------------------------------------------------------------------
    // Housekeeping (runs about once a second)
    // ------------------------------------------------------------------

    private function tick()
    {
        // The data file changed behind our back (Apache, a text editor, a restore).
        $fp = $this->store->fingerprint();
        if ($fp !== $this->fingerprint) {
            $this->broadcastState();
        }

        $now = time();
        if ($now - $this->lastPing >= 20) {
            $this->lastPing = $now;
            $ping = self::frame('', 0x9);
            foreach (array_keys($this->clients) as $id) {
                if (!isset($this->clients[$id])) {
                    continue;
                }
                $c = $this->clients[$id];
                $idle = $now - $c['seen'];
                if ($c['ws']) {
                    if ($idle > 75) {
                        $this->drop($id);
                    } else {
                        $this->send($id, $ping);
                    }
                } elseif ($idle > 30) {
                    $this->drop($id);
                }
            }
        }
    }

    private function log($line)
    {
        if (!$this->quiet) {
            fwrite(STDOUT, '  [' . date('H:i:s') . '] ' . $line . PHP_EOL);
        }
    }
}

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------

$opt = getopt('', ['host:', 'port:', 'allow-host:', 'lan', 'open', 'quiet', 'help']);
if (isset($opt['help'])) {
    fwrite(STDOUT, "Usage: php server.php [--port=8080] [--lan] [--host=ADDRESS] [--allow-host=NAME[,NAME]] [--open] [--quiet]\n");
    exit(0);
}
if (getenv('SCOREBOARD_PORT') && !isset($opt['port'])) {
    $opt['port'] = getenv('SCOREBOARD_PORT');
}
if (isset($opt['port']) && (!preg_match('/^[0-9]{1,5}$/', (string) $opt['port']) || $opt['port'] < 1 || $opt['port'] > 65535)) {
    fwrite(STDERR, "Invalid --port.\n");
    exit(2);
}

$openBrowser = function ($url) {
    if (stripos(PHP_OS, 'WIN') === 0) {
        @pclose(@popen('start "" "' . $url . '"', 'r'));
    } elseif (stripos(PHP_OS, 'Darwin') === 0) {
        @exec('open ' . escapeshellarg($url) . ' > /dev/null 2>&1 &');
    } else {
        @exec('xdg-open ' . escapeshellarg($url) . ' > /dev/null 2>&1 &');
    }
};

$app = new ScoreboardServer([
    'host' => isset($opt['host']) ? $opt['host'] : null,
    'port' => isset($opt['port']) ? $opt['port'] : null,
    'lan' => isset($opt['lan']),
    'quiet' => isset($opt['quiet']),
    'allow-host' => isset($opt['allow-host']) ? $opt['allow-host'] : null,
]);

if (!$app->listen()) {
    // Most likely the scoreboard is already running: just bring it to the front.
    // 127.0.0.1 rather than localhost: PHP may try ::1 first and give up.
    $probe = @file_get_contents(str_replace('localhost', '127.0.0.1', $app->url()) . 'api/info', false, stream_context_create(['http' => ['timeout' => 2]]));
    $info = $probe ? json_decode($probe, true) : null;
    if (is_array($info) && isset($info['version'])) {
        fwrite(STDOUT, "\n  PUBG Scoreboard is already running at " . $app->url() . "\n\n");
        if (isset($opt['open'])) {
            $openBrowser($app->url());
        }
        exit(0);
    }
    fwrite(STDERR, "\n  Could not start: the port is used by another program.\n  Try another one:  php server.php --port=8090\n\n");
    exit(1);
}

$app->banner();
if (isset($opt['open'])) {
    $openBrowser($app->url());
}
$app->run();
