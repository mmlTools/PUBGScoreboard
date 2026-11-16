<?php
/**
 * Backend tests — plain PHP, no framework:   php tests/api.php
 * Exercises storage, migration, scoring, undo and access control without a server.
 */

require_once __DIR__ . '/../Engine/Store.php';
require_once __DIR__ . '/../Engine/Api.php';

use Engine\Api;
use Engine\Store;

$failures = 0;
function check($name, $ok, $detail = '')
{
    global $failures;
    echo ($ok ? '  ok   ' : '  FAIL ') . $name . ($ok || $detail === '' ? '' : '  -> ' . $detail) . PHP_EOL;
    if (!$ok) {
        $failures++;
    }
}

function tempDir()
{
    $dir = sys_get_temp_dir() . '/sbtest-' . bin2hex(random_bytes(6));
    mkdir($dir, 0777, true);
    return $dir;
}

function removeDir($dir)
{
    foreach (array_diff((array) scandir($dir), ['.', '..']) as $entry) {
        $path = $dir . '/' . $entry;
        is_dir($path) ? removeDir($path) : unlink($path);
    }
    rmdir($dir);
}

$LOCAL = '127.0.0.1';
$REMOTE = '192.168.1.50';
$JSON = ['content-type' => 'application/json'];

function post(Api $api, $action, array $payload = [], $remote = '127.0.0.1', array $headers = ['content-type' => 'application/json'])
{
    $res = $api->handle('POST', 'api/action', [], $headers, json_encode(['action' => $action, 'payload' => $payload]), $remote);
    return [$res['status'], json_decode($res['body'], true)];
}

// ---------------------------------------------------------------- defaults
$dir = tempDir();
$store = new Store($dir);
$api = new Api($store, ['mode' => 'standalone', 'realtime' => true, 'port' => 8080, 'lan' => true]);

$state = $store->load();
check('fresh install yields defaults', $state['version'] === 2 && $state['teams'] === [] && $state['overlay']['view'] === 'leaderboard');
check('nothing is written until the first change', !is_file($store->file()));

// ------------------------------------------------------------------- teams
list($status, $body) = post($api, 'team.add', ['name' => '  Alpha  <script>  ', 'tag' => 'toolongtag']);
$alpha = $body['result']['id'];
check('team.add returns an id', $status === 200 && preg_match('/^t[a-f0-9]{10}$/', $alpha) === 1);
check('names are trimmed, tags capped at 6 chars', $body['state']['teams'][0]['name'] === 'Alpha  <script>' && $body['state']['teams'][0]['tag'] === 'toolon');
check('revision increases with every change', $body['rev'] === 1);

list(, $body) = post($api, 'team.add', ['name' => 'Bravo']);
$bravo = $body['result']['id'];
list(, $body) = post($api, 'team.add', ['name' => 'Charlie']);
$charlie = $body['result']['id'];

list(, $body) = post($api, 'team.update', ['id' => $alpha, 'patch' => ['kills' => 7, 'placePoints' => 10, 'points' => 999, 'id' => 'hack', 'matches' => -4]]);
$team = $body['state']['teams'][0];
check('auto total = place + kills x killPoints (typed total ignored)', $team['points'] === 17);
check('ids cannot be patched, negatives are clamped', $team['id'] === $alpha && $team['matches'] === 0);

post($api, 'scoring.update', ['killPoints' => 2]);
check('changing kill points recalculates totals', $store->load()['teams'][0]['points'] === 24);
post($api, 'scoring.update', ['killPoints' => 1, 'autoTotal' => false]);
list(, $body) = post($api, 'team.update', ['id' => $alpha, 'patch' => ['points' => 50]]);
check('manual totals are kept when auto total is off', $body['state']['teams'][0]['points'] === 50);
post($api, 'scoring.update', ['autoTotal' => true]);

list($status) = post($api, 'team.update', ['id' => 'tffffffffff', 'patch' => ['kills' => 1]]);
check('unknown team -> 404', $status === 404);
list($status) = post($api, 'nope.nope');
check('unknown action -> 404', $status === 404);

// ------------------------------------------------------------ match + undo
list($status, $body) = post($api, 'match.record', ['results' => []]);
check('empty match is rejected', $status === 422);
check('a rejected match leaves no undo entry', $store->load()['history'] === []);

post($api, 'tournament.update', ['match' => '3']);
list($status, $body) = post($api, 'match.record', ['advance' => true, 'results' => [
    ['id' => $alpha, 'place' => 2, 'kills' => 4],
    ['id' => $bravo, 'place' => 1, 'kills' => 9],
    ['id' => $charlie, 'place' => 0, 'kills' => 3], // did not play
    ['id' => 'tffffffffff', 'place' => 3, 'kills' => 1],
]]);
$s = $body['state'];
check('match.record: winner gets 10 + kills, a chicken dinner and a match', $s['teams'][1]['points'] === 19 && $s['teams'][1]['wwcd'] === 1 && $s['teams'][1]['matches'] === 1);
check('match.record: 2nd place gets 6 + kills on top of its score', $s['teams'][0]['points'] === 17 + 10 && $s['teams'][0]['kills'] === 11);
check('match.record: teams without a placement are untouched', $s['teams'][2]['matches'] === 0 && $s['teams'][2]['kills'] === 0);
check('match.record: match number advances and the winner is remembered', $s['tournament']['match'] === '4' && $s['overlay']['winnerId'] === $bravo);
check('match.record: counts only known teams', $body['result']['teams'] === 2);
check('match.record leaves an undo snapshot', count($s['history']) === 1 && count(glob($dir . '/backups/*.json')) === 1);

post($api, 'overlay.update', ['view' => 'winner']);
list($status, $body) = post($api, 'state.undo');
$s = $body['state'];
check('undo restores scores and the match number', $s['teams'][1]['points'] === 0 && $s['tournament']['match'] === '3');
check('undo does not change what is on air', $s['overlay']['view'] === 'winner');
check('undo consumes the snapshot', $s['history'] === [] && glob($dir . '/backups/*.json') === []);
list($status) = post($api, 'state.undo');
check('nothing left to undo -> 409', $status === 409);

post($api, 'team.remove', ['id' => $charlie]);
check('team.remove deletes the team', count($store->load()['teams']) === 2);
post($api, 'state.undo');
check('...and undo brings it back in place', $store->load()['teams'][2]['id'] === $charlie);

// ----------------------------------------------------------------- overlay
post($api, 'theme.update', ['teamsPerPage' => 1]);
post($api, 'overlay.update', ['page' => 0, 'view' => 'leaderboard']);
post($api, 'overlay.next');
post($api, 'overlay.next');
check('overlay.next pages forward', $store->load()['overlay']['page'] === 2);
post($api, 'overlay.next');
check('...and wraps around', $store->load()['overlay']['page'] === 0);
post($api, 'overlay.prev');
check('overlay.prev wraps backwards', $store->load()['overlay']['page'] === 2);
post($api, 'theme.update', ['teamsPerPage' => 8]);
check('page is clamped when pages disappear', $store->load()['overlay']['page'] === 0);

post($api, 'overlay.update', ['view' => 'bogus', 'rotateSeconds' => 1, 'visible' => false]);
$o = $store->load()['overlay'];
check('invalid overlay values fall back to safe ones', $o['view'] === 'leaderboard' && $o['rotateSeconds'] === 3 && $o['visible'] === false);
post($api, 'overlay.winner', ['id' => $alpha]);
$o = $store->load()['overlay'];
check('overlay.winner shows the winner view for that team', $o['view'] === 'winner' && $o['winnerId'] === $alpha && $o['visible'] === true);

$res = $api->handle('GET', 'api/cmd/hide', [], [], '', $LOCAL);
check('GET /api/cmd/hide hides the overlay', $res['status'] === 200 && $store->load()['overlay']['visible'] === false && $res['changed'] === true);
$res = $api->handle('GET', 'api/cmd/view/podium', [], [], '', $LOCAL);
check('GET /api/cmd/view/podium switches view and shows it', $store->load()['overlay']['view'] === 'podium' && $store->load()['overlay']['visible'] === true);
$res = $api->handle('GET', 'api/cmd/view/nope', [], [], '', $LOCAL);
check('unknown command view -> 404', $res['status'] === 404);

post($api, 'theme.update', ['accent' => 'javascript:alert(1)', 'surface' => '#ABCDEF']);
$theme = $store->load()['theme'];
check('colours are validated', $theme['accent'] === '#f2a900' && $theme['surface'] === '#abcdef');

// ------------------------------------------------------------------ images
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
$res = $api->handle('POST', 'api/upload', [], ['content-type' => 'image/png'], $png, $LOCAL);
$upload = json_decode($res['body'], true);
check('PNG upload is stored by content hash', $res['status'] === 200 && preg_match('~^Autoload/uploads/[a-f0-9]{24}\.png$~', $upload['url']) === 1 && is_file($dir . '/uploads/' . basename($upload['url'])));
$res = $api->handle('POST', 'api/upload', [], ['content-type' => 'image/png'], '<?php echo 1; ?>', $LOCAL);
check('a non-image upload is rejected', $res['status'] === 422 && count(glob($dir . '/uploads/*')) === 1);
$res = $api->handle('POST', 'api/upload', [], ['content-type' => 'image/svg+xml'], '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', $LOCAL);
check('SVG (scriptable) is rejected', $res['status'] === 422);

post($api, 'team.update', ['id' => $alpha, 'patch' => ['logo' => $upload['url']]]);
check('uploaded logo reference is accepted', $store->load()['teams'][0]['logo'] === $upload['url']);
post($api, 'team.update', ['id' => $bravo, 'patch' => ['logo' => '../../server.php']]);
check('path-traversal logo reference is dropped', $store->load()['teams'][1]['logo'] === '');
post($api, 'team.update', ['id' => $bravo, 'patch' => ['logo' => 'javascript:alert(1)']]);
check('javascript: logo reference is dropped', $store->load()['teams'][1]['logo'] === '');

$res = $api->handle('GET', 'api/export', [], [], '', $LOCAL);
$export = json_decode($res['body'], true);
check('export inlines uploaded images', strncmp($export['teams'][0]['logo'], 'data:image/png;base64,', 22) === 0 && !isset($export['history']));

// ------------------------------------------------------------------ import
$dir2 = tempDir();
$store2 = new Store($dir2);
$api2 = new Api($store2);
list($status, $body) = post($api2, 'state.import', ['data' => $export]);
check('import round-trips the tournament', $status === 200 && count($body['state']['teams']) === 3 && $body['state']['teams'][0]['name'] === 'Alpha  <script>');
check('import re-creates image files from inline data', is_file($dir2 . '/uploads/' . basename($body['state']['teams'][0]['logo'])));
list($status) = post($api2, 'state.import', ['data' => ['hello' => 'world']]);
check('import rejects unrelated JSON', $status === 422);

// v1 file written by the original jQuery app (everything is a string)
$legacy = [
    'language' => 'ro',
    'competition_name' => 'Old Cup',
    'input_tablebg_main' => '#ffc107',
    'input_table_text_color' => '#303030',
    'competition_day' => '2',
    'competition_match' => '7',
    'show_matches_played' => '1',
    'show_chicken_dinner' => '0',
    'input_table_map' => 'Miramar',
    'input_teams_page' => '6',
    'input_tablebg_wallpaper' => 'Vendor/img/upload-logo.png',
    'input_table_animation_in' => 'jackInTheBox',
    'teams' => [
        ['squad_logo' => 'data:image/png;base64,' . base64_encode($png), 'squad_name' => 'Legacy One', 'matches_played' => '3', 'chicken_dinner' => '1', 'place_points' => '20', 'total_kills' => '15', 'total_points' => '35'],
        ['squad_logo' => 'Vendor/img/upload-logo.png', 'squad_name' => 'Legacy Two', 'matches_played' => '3', 'chicken_dinner' => '0', 'place_points' => '8', 'total_kills' => '4', 'total_points' => '12'],
    ],
];
file_put_contents($store2->file(), json_encode($legacy));
$s = $store2->load();
check('v1 file: tournament fields migrate', $s['tournament'] === ['name' => 'Old Cup', 'map' => 'Miramar', 'day' => '2', 'match' => '7', 'logo' => ''] && $s['language'] === 'ro');
check('v1 file: settings migrate', $s['theme']['teamsPerPage'] === 6 && $s['theme']['showWwcd'] === false && $s['theme']['showMatches'] === true && $s['theme']['accent'] === '#ffc107');
check('v1 file: teams and numbers migrate', count($s['teams']) === 2 && $s['teams'][0]['points'] === 35 && $s['teams'][0]['wwcd'] === 1 && $s['teams'][1]['kills'] === 4);
check('v1 file: embedded logo becomes a file, placeholder becomes empty', strncmp($s['teams'][0]['logo'], 'Autoload/uploads/', 17) === 0 && $s['teams'][1]['logo'] === '');
check('v1 file: consistent totals keep auto-total on', $s['scoring']['autoTotal'] === true);

$legacy['teams'][1]['total_points'] = '40'; // hand-edited total that does not add up
file_put_contents($store2->file(), json_encode($legacy));
$s = $store2->load();
check('v1 file: hand-entered totals are preserved (auto-total off)', $s['scoring']['autoTotal'] === false && $s['teams'][1]['points'] === 40);

file_put_contents($store2->file(), '""'); // what v1 "Reset competition" left behind
check('v1 reset file ("") loads as defaults', $store2->load()['teams'] === []);
file_put_contents($store2->file(), '{ this is not json');
check('corrupt file loads as defaults instead of crashing', $store2->load()['version'] === 2);

// ---------------------------------------------------------- access control
list($status) = post($api, 'overlay.hide', [], $REMOTE);
check('remote change without key -> 401', $status === 401);
list($status) = post($api, 'overlay.hide', [], $REMOTE, $JSON + ['x-scoreboard-key' => 'wrong']);
check('remote change with wrong key -> 401', $status === 401);
list($status) = post($api, 'overlay.hide', [], $REMOTE, $JSON + ['x-scoreboard-key' => $api->key()]);
check('remote change with the key -> 200', $status === 200);
$res = $api->handle('GET', 'api/cmd/show', ['key' => $api->key()], [], '', $REMOTE);
check('remote GET command accepts ?key=', $res['status'] === 200);
$res = $api->handle('GET', 'api/cmd/show', [], [], '', $REMOTE);
check('remote GET command without key -> 401', $res['status'] === 401);
$res = $api->handle('GET', 'api/state', [], [], '', $REMOTE);
check('reading the state needs no key (it is on stream anyway)', $res['status'] === 200);
$res = $api->handle('POST', 'api/upload', [], ['content-type' => 'image/png'], $png, $REMOTE);
check('remote upload without key -> 401', $res['status'] === 401);

$info = json_decode($api->handle('GET', 'api/info', [], [], '', $REMOTE)['body'], true);
check('the key is never sent to remote devices', !isset($info['key']) && $info['local'] === false && $info['authorized'] === false);
$info = json_decode($api->handle('GET', 'api/info', [], [], '', $LOCAL)['body'], true);
check('the local machine can read the key', isset($info['key']) && $info['key'] === $api->key());
check('IPv4-mapped and IPv6 loopback count as local', Api::isLocal('::ffff:127.0.0.1') && Api::isLocal('::1') && !Api::isLocal('::ffff:10.0.0.2'));

list($status) = post($api, 'overlay.hide', [], $LOCAL, ['content-type' => 'application/x-www-form-urlencoded']);
check('form-encoded posts are refused (CSRF guard)', $status === 415);
list($status) = post($api, 'overlay.hide', [], $LOCAL, $JSON + ['sec-fetch-site' => 'cross-site']);
check('cross-site browser requests are refused', $status === 403);
$res = $api->handle('GET', 'api/cmd/hide', [], ['sec-fetch-site' => 'cross-site'], '', $LOCAL);
check('cross-site GET commands are refused', $res['status'] === 403);
$res = $api->handle('GET', 'api/state', ['rev' => (string) $store->load()['rev']], [], '', $LOCAL);
check('polling with the current rev returns "unchanged"', json_decode($res['body'], true) === ['ok' => true, 'rev' => $store->load()['rev'], 'unchanged' => true]);

// ------------------------------------------------------------------- reset
post($api, 'scores.reset');
$s = $store->load();
check('scores.reset zeroes scores, keeps teams and logos', count($s['teams']) === 3 && $s['teams'][0]['points'] === 0 && $s['teams'][0]['logo'] === $upload['url']);
post($api, 'tournament.reset');
check('tournament.reset clears the teams', $store->load()['teams'] === []);
post($api, 'state.undo');
post($api, 'state.undo');
check('two undos bring the scores back', $store->load()['teams'][0]['points'] > 0);

for ($i = 0; $i < 30; $i++) {
    post($api, 'scores.reset');
}
check('history is capped (old snapshots are deleted)', count($store->load()['history']) === Store::MAX_HISTORY && count(glob($dir . '/backups/*.json')) === Store::MAX_HISTORY);

removeDir($dir);
removeDir($dir2);

echo PHP_EOL . ($failures ? $failures . ' check(s) failed' : 'all checks passed') . ' (PHP ' . PHP_VERSION . ')' . PHP_EOL;
exit($failures ? 1 : 0);
