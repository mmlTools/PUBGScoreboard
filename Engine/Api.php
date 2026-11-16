<?php

namespace Engine;

class ApiError extends \Exception
{
    /** @var int */
    public $status;

    public function __construct($message, $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/**
 * The JSON API. Transport-agnostic: index.php (Apache / php -S) and server.php
 * (standalone HTTP + WebSocket server) both call handle() / action().
 */
final class Api
{
    /** @var Store */
    private $store;
    /** @var array */
    private $ctx;

    /**
     * @param array $ctx ['mode' => 'standalone'|'php', 'realtime' => bool, 'port' => int|null, 'lan' => bool]
     */
    public function __construct(Store $store, array $ctx = [])
    {
        $this->store = $store;
        $this->ctx = $ctx + ['mode' => 'php', 'realtime' => false, 'port' => null, 'lan' => true];
    }

    public function store()
    {
        return $this->store;
    }

    // ------------------------------------------------------------------
    // HTTP entry point
    // ------------------------------------------------------------------

    /**
     * @param string $method  HTTP method
     * @param string $path    path below the app base, e.g. "api/state"
     * @param array  $query   parsed query string
     * @param array  $headers lower-cased header names
     * @param string $body    raw request body
     * @param string $remote  client IP
     * @return array ['status' => int, 'headers' => array, 'body' => string, 'changed' => bool]
     */
    public function handle($method, $path, array $query, array $headers, $body, $remote)
    {
        $changed = false;
        try {
            $key = isset($headers['x-scoreboard-key']) ? $headers['x-scoreboard-key'] : (isset($query['key']) ? $query['key'] : '');
            $parts = explode('/', trim($path, '/'));
            $route = isset($parts[1]) ? $parts[1] : '';

            // Browsers label requests made by other websites; never let those change anything.
            $mutating = $method === 'POST' || $route === 'cmd';
            if ($mutating && isset($headers['sec-fetch-site']) && $headers['sec-fetch-site'] === 'cross-site') {
                throw new ApiError('Cross-site requests are not allowed.', 403);
            }

            if ($method === 'OPTIONS') {
                // No CORS headers on purpose: other websites must not drive the scoreboard.
                return self::response(204, '');
            }

            if ($route === 'state' && $method === 'GET') {
                $state = $this->store->load();
                if (isset($query['rev']) && (string) $query['rev'] === (string) $state['rev']) {
                    return self::json(['ok' => true, 'rev' => $state['rev'], 'unchanged' => true]);
                }
                return self::json(['ok' => true, 'rev' => $state['rev'], 'state' => $state]);
            }

            if ($route === 'info' && $method === 'GET') {
                return self::json(['ok' => true] + $this->info($remote, $key));
            }

            if ($route === 'export' && $method === 'GET') {
                $data = $this->store->export();
                $name = preg_replace('/[^A-Za-z0-9_-]+/', '_', $data['tournament']['name']);
                $name = trim((string) $name, '_');
                return self::response(200, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), [
                    'Content-Type' => 'application/json; charset=utf-8',
                    'Content-Disposition' => 'attachment; filename="' . ($name === '' ? 'tournament' : $name) . '.json"',
                    'Cache-Control' => 'no-store',
                ]);
            }

            // Simple GET commands for Stream Deck "open URL" buttons, bots and scripts.
            if ($route === 'cmd' && ($method === 'GET' || $method === 'POST')) {
                $this->authorize($remote, $key);
                $name = isset($parts[2]) ? $parts[2] : '';
                $arg = isset($parts[3]) ? $parts[3] : '';
                $map = [
                    'show' => ['overlay.show', []],
                    'hide' => ['overlay.hide', []],
                    'toggle' => ['overlay.toggle', []],
                    'next' => ['overlay.next', []],
                    'prev' => ['overlay.prev', []],
                    'view' => ['overlay.update', ['view' => $arg, 'visible' => true]],
                ];
                if (!isset($map[$name])) {
                    throw new ApiError('Unknown command. Use show, hide, toggle, next, prev or view/<name>.', 404);
                }
                if ($name === 'view' && !in_array($arg, Store::VIEWS, true)) {
                    throw new ApiError('Unknown view. Use ' . implode(', ', Store::VIEWS) . '.', 404);
                }
                list($state) = $this->action($map[$name][0], $map[$name][1]);
                $changed = true;
                return self::json(['ok' => true, 'rev' => $state['rev'], 'overlay' => $state['overlay']], 200, true);
            }

            if ($method !== 'POST') {
                throw new ApiError('Not found.', 404);
            }
            $this->authorize($remote, $key);
            $type = isset($headers['content-type']) ? strtolower($headers['content-type']) : '';

            if ($route === 'upload') {
                if (strncmp($type, 'image/', 6) !== 0 && strncmp($type, 'application/octet-stream', 24) !== 0) {
                    throw new ApiError('Send the image as the raw request body.', 415);
                }
                try {
                    $url = $this->store->saveImage($body);
                } catch (\InvalidArgumentException $e) {
                    throw new ApiError($e->getMessage(), 422);
                }
                return self::json(['ok' => true, 'url' => $url]);
            }

            if ($route === 'action') {
                // Requiring JSON forces a CORS preflight, which blocks cross-site form posts.
                if (strncmp($type, 'application/json', 16) !== 0) {
                    throw new ApiError('Content-Type must be application/json.', 415);
                }
                $data = json_decode($body, true);
                if (!is_array($data) || !isset($data['action']) || !is_string($data['action'])) {
                    throw new ApiError('Expected {"action": "...", "payload": {...}}.');
                }
                $payload = isset($data['payload']) && is_array($data['payload']) ? $data['payload'] : [];
                list($state, $result) = $this->action($data['action'], $payload);
                $changed = true;
                return self::json(['ok' => true, 'rev' => $state['rev'], 'state' => $state, 'result' => $result], 200, true);
            }

            throw new ApiError('Not found.', 404);
        } catch (ApiError $e) {
            return self::json(['ok' => false, 'error' => $e->getMessage()], $e->status, $changed);
        } catch (\Throwable $e) {
            return self::json(['ok' => false, 'error' => $e->getMessage()], 500, $changed);
        }
    }

    public static function json(array $data, $status = 200, $changed = false)
    {
        $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $res = self::response($status, $body === false ? '{"ok":false,"error":"encoding failed"}' : $body, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
        ]);
        $res['changed'] = $changed;
        return $res;
    }

    public static function response($status, $body, array $headers = [])
    {
        return ['status' => $status, 'headers' => $headers, 'body' => $body, 'changed' => false];
    }

    // ------------------------------------------------------------------
    // Access control
    // ------------------------------------------------------------------

    public static function isLocal($remote)
    {
        $remote = (string) $remote;
        if (strncmp($remote, '::ffff:', 7) === 0) {
            $remote = substr($remote, 7);
        }
        return $remote === '::1' || strncmp($remote, '127.', 4) === 0;
    }

    /** Anything that changes state from another device needs the access key. */
    public function authorize($remote, $key)
    {
        if (self::isLocal($remote)) {
            return;
        }
        if (!is_string($key) || $key === '' || !hash_equals($this->key(), $key)) {
            throw new ApiError('Remote control needs the access key. Open the remote link shown in the control panel on this device.', 401);
        }
    }

    /** The remote-control key, generated on first use and kept out of web reach in a .php file. */
    public function key()
    {
        static $cache = [];
        $file = $this->store->dir() . '/server.php';
        if (isset($cache[$file])) {
            return $cache[$file];
        }
        $config = is_file($file) ? @include $file : null;
        if (!is_array($config) || empty($config['key']) || !is_string($config['key'])) {
            $config = ['key' => bin2hex(random_bytes(8))];
            @file_put_contents($file, "<?php\n// Remote-control access key. Delete this file to generate a new one.\nreturn " . var_export($config, true) . ";\n");
        }
        return $cache[$file] = $config['key'];
    }

    private function info($remote, $key)
    {
        $local = self::isLocal($remote);
        $authorized = $local || (is_string($key) && $key !== '' && hash_equals($this->key(), $key));
        $info = [
            'version' => self::version(),
            'mode' => $this->ctx['mode'],
            'realtime' => (bool) $this->ctx['realtime'],
            'local' => $local,
            'authorized' => $authorized,
            'lan' => (bool) $this->ctx['lan'],
        ];
        if ($local) {
            // Only the machine running the scoreboard gets to see the key.
            $info['key'] = $this->key();
            $info['addresses'] = $this->ctx['lan'] ? self::lanAddresses() : [];
            $info['port'] = $this->ctx['port'];
        }
        return $info;
    }

    public static function version()
    {
        static $version = null;
        if ($version === null) {
            $about = json_decode((string) @file_get_contents(dirname(__DIR__) . '/about.json'), true);
            $version = is_array($about) && isset($about['_VERSION']) ? ltrim((string) $about['_VERSION'], 'v') : '0.0.0';
        }
        return $version;
    }

    public static function lanAddresses()
    {
        $found = [];
        $list = @gethostbynamel((string) gethostname());
        foreach (is_array($list) ? $list : [] as $ip) {
            $found[$ip] = true;
        }
        // Connecting a UDP socket sends nothing; it only reveals the outbound interface.
        $sock = @stream_socket_client('udp://192.0.2.1:9', $errno, $errstr, 1);
        if ($sock) {
            $name = (string) stream_socket_get_name($sock, false);
            fclose($sock);
            $ip = substr($name, 0, (int) strrpos($name, ':'));
            if ($ip !== '') {
                $found = [$ip => true] + $found;
            }
        }
        $out = [];
        foreach (array_keys($found) as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) && strncmp($ip, '127.', 4) !== 0 && strncmp($ip, '169.254.', 8) !== 0) {
                $out[] = $ip;
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // Actions (shared by HTTP and WebSocket)
    // ------------------------------------------------------------------

    /**
     * @return array{0: array, 1: mixed} [new state, action result]
     */
    public function action($name, array $p)
    {
        $store = $this->store;
        switch ($name) {
            case 'tournament.update':
                return $store->mutate(function (&$s) use ($p) {
                    $s['tournament'] = self::patch($s['tournament'], $p, ['name', 'map', 'day', 'match', 'logo']);
                });

            case 'language.set':
                return $store->mutate(function (&$s) use ($p) {
                    $s['language'] = isset($p['language']) ? $p['language'] : $s['language'];
                });

            case 'theme.update':
                return $store->mutate(function (&$s) use ($p) {
                    $s['theme'] = self::patch($s['theme'], $p, array_keys(Store::defaults()['theme']));
                });

            case 'scoring.update':
                return $store->mutate(function (&$s) use ($p) {
                    $s['scoring'] = self::patch($s['scoring'], $p, ['killPoints', 'placement', 'autoTotal']);
                });

            case 'team.add':
                return $store->mutate(function (&$s) use ($p) {
                    if (count($s['teams']) >= Store::MAX_TEAMS) {
                        throw new ApiError('Team limit reached (' . Store::MAX_TEAMS . ').', 422);
                    }
                    $team = Store::newTeam(self::patch([], $p, ['name', 'tag', 'logo']));
                    $s['teams'][] = $team;
                    return ['id' => $team['id']];
                });

            case 'team.update':
                return $store->mutate(function (&$s) use ($p) {
                    $i = self::teamIndex($s, $p);
                    $patch = isset($p['patch']) && is_array($p['patch']) ? $p['patch'] : [];
                    $fields = ['name', 'tag', 'logo', 'matches', 'wwcd', 'placePoints', 'kills'];
                    if (!$s['scoring']['autoTotal']) {
                        $fields[] = 'points';
                    }
                    $s['teams'][$i] = self::patch($s['teams'][$i], $patch, $fields);
                });

            case 'team.remove':
                return $store->mutate(function (&$s) use ($p, $store) {
                    $i = self::teamIndex($s, $p);
                    $store->snapshot($s, 'team.remove');
                    array_splice($s['teams'], $i, 1);
                });

            case 'scores.reset':
                return $store->mutate(function (&$s) use ($store) {
                    $store->snapshot($s, 'scores.reset');
                    foreach ($s['teams'] as $i => $team) {
                        $s['teams'][$i] = ['matches' => 0, 'wwcd' => 0, 'placePoints' => 0, 'kills' => 0, 'points' => 0] + $team;
                    }
                    $s['overlay']['winnerId'] = '';
                    $s['overlay']['page'] = 0;
                });

            case 'tournament.reset':
                return $store->mutate(function (&$s) use ($store) {
                    $store->snapshot($s, 'tournament.reset');
                    $fresh = Store::defaults();
                    $fresh['language'] = $s['language'];
                    $fresh['history'] = $s['history'];
                    $s = $fresh;
                });

            case 'match.record':
                return $store->mutate(function (&$s) use ($p, $store) {
                    return self::recordMatch($s, $p, $store);
                });

            case 'state.undo':
                return $store->mutate(function (&$s) use ($store) {
                    $label = $store->undo($s);
                    if ($label === null) {
                        throw new ApiError('Nothing to undo.', 409);
                    }
                    return ['undone' => $label];
                });

            case 'state.import':
                return $store->mutate(function (&$s) use ($p, $store) {
                    $data = isset($p['data']) && is_array($p['data']) ? $p['data'] : null;
                    $known = $data !== null && (isset($data['tournament']) || isset($data['competition_name']) || isset($data['teams']));
                    if (!$known) {
                        throw new ApiError('This is not a scoreboard configuration file.', 422);
                    }
                    $store->snapshot($s, 'state.import');
                    unset($data['history'], $data['rev'], $data['overlay']);
                    $data['history'] = $s['history'];
                    $data['overlay'] = $s['overlay'];
                    $data['overlay']['page'] = 0;
                    $data['overlay']['winnerId'] = '';
                    $s = $data; // mutate() normalizes (and migrates v1 files)
                });

            case 'overlay.update':
                return $store->mutate(function (&$s) use ($p) {
                    $s['overlay'] = self::patch($s['overlay'], $p, ['visible', 'view', 'page', 'autoRotate', 'rotateSeconds', 'winnerId']);
                });

            case 'overlay.show':
            case 'overlay.hide':
            case 'overlay.toggle':
                return $store->mutate(function (&$s) use ($name) {
                    $s['overlay']['visible'] = $name === 'overlay.toggle' ? !$s['overlay']['visible'] : $name === 'overlay.show';
                });

            case 'overlay.next':
            case 'overlay.prev':
                return $store->mutate(function (&$s) use ($name) {
                    $pages = Store::pageCount(count($s['teams']), $s['theme']['teamsPerPage']);
                    $step = $name === 'overlay.next' ? 1 : -1;
                    $s['overlay']['page'] = (($s['overlay']['page'] + $step) % $pages + $pages) % $pages;
                    $s['overlay']['autoRotate'] = false;
                });

            case 'overlay.replay':
                return $store->mutate(function (&$s) {
                    $s['overlay']['replay'] = ($s['overlay']['replay'] + 1) % 1000000;
                    $s['overlay']['visible'] = true;
                });

            case 'overlay.winner':
                return $store->mutate(function (&$s) use ($p) {
                    $i = self::teamIndex($s, $p);
                    $s['overlay']['winnerId'] = $s['teams'][$i]['id'];
                    $s['overlay']['view'] = 'winner';
                    $s['overlay']['visible'] = true;
                });
        }
        throw new ApiError('Unknown action: ' . Store::str($name, 40), 404);
    }

    private static function recordMatch(array &$s, array $p, Store $store)
    {
        $results = isset($p['results']) && is_array($p['results']) ? $p['results'] : [];
        $byId = [];
        foreach ($s['teams'] as $i => $team) {
            $byId[$team['id']] = $i;
        }
        $rows = [];
        foreach ($results as $r) {
            if (!is_array($r) || !isset($r['id']) || !isset($byId[$r['id']])) {
                continue;
            }
            $place = Store::int(isset($r['place']) ? $r['place'] : 0, 0, 999, 0);
            if ($place < 1) {
                continue; // team did not play this match
            }
            $rows[$r['id']] = ['place' => $place, 'kills' => Store::int(isset($r['kills']) ? $r['kills'] : 0, 0, 999, 0)];
        }
        if (!$rows) {
            throw new ApiError('Enter a placement for at least one team.', 422);
        }

        $store->snapshot($s, 'match.record');
        $winner = '';
        foreach ($rows as $id => $r) {
            $team = &$s['teams'][$byId[$id]];
            $placePts = isset($s['scoring']['placement'][$r['place'] - 1]) ? $s['scoring']['placement'][$r['place'] - 1] : 0;
            $team['matches']++;
            $team['kills'] += $r['kills'];
            $team['placePoints'] += $placePts;
            $team['points'] += $placePts + $r['kills'] * $s['scoring']['killPoints'];
            if ($r['place'] === 1) {
                $team['wwcd']++;
                $winner = $id;
            }
            unset($team);
        }
        if ($winner !== '') {
            $s['overlay']['winnerId'] = $winner;
        }
        if (!empty($p['advance']) && preg_match('/^\d+$/', $s['tournament']['match'])) {
            $s['tournament']['match'] = (string) ((int) $s['tournament']['match'] + 1);
        }
        return ['teams' => count($rows), 'winnerId' => $winner];
    }

    private static function teamIndex(array $s, array $p)
    {
        $id = isset($p['id']) ? $p['id'] : null;
        foreach ($s['teams'] as $i => $team) {
            if ($team['id'] === $id) {
                return $i;
            }
        }
        throw new ApiError('That team no longer exists.', 404);
    }

    /** Copy only whitelisted keys; Store::normalize() validates the values afterwards. */
    private static function patch(array $target, array $patch, array $allowed)
    {
        foreach ($allowed as $key) {
            if (array_key_exists($key, $patch)) {
                $target[$key] = $patch[$key];
            }
        }
        return $target;
    }
}
