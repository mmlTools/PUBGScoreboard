<?php

namespace Engine;

/**
 * Tournament state storage.
 *
 * One JSON document (Autoload/tournament_data.json) holds the whole tournament.
 * Every write goes through mutate(), which takes an exclusive lock, so the
 * standalone server and Apache/php -S can safely share the same data folder.
 */
final class Store
{
    const VERSION = 2;
    const MAX_TEAMS = 128;
    const MAX_HISTORY = 25;
    const MAX_UPLOAD_BYTES = 8388608; // 8 MB

    const VIEWS = ['leaderboard', 'compact', 'podium', 'winner'];
    const ANIMATIONS = ['tactical', 'airdrop', 'flip', 'punch', 'fade'];
    const BACKGROUNDS = ['transparent', 'wallpaper'];
    const LANGUAGES = ['en', 'ro'];

    /** @var string */
    private $dir;
    /** @var string */
    private $file;

    public function __construct($dir = null)
    {
        if ($dir === null) {
            // SCOREBOARD_DATA lets tests and containers keep data outside the app folder.
            $env = getenv('SCOREBOARD_DATA');
            $dir = is_string($env) && $env !== '' ? $env : dirname(__DIR__) . '/Autoload';
        }
        $this->dir = rtrim($dir, '/\\');
        $this->file = $this->dir . '/tournament_data.json';
        foreach ([$this->dir, $this->dir . '/uploads', $this->dir . '/backups'] as $path) {
            if (!is_dir($path)) {
                @mkdir($path, 0775, true);
            }
        }
    }

    public function dir()
    {
        return $this->dir;
    }

    public function file()
    {
        return $this->file;
    }

    /** Cheap change detector used by the standalone server to spot external writes. */
    public function fingerprint()
    {
        clearstatcache(true, $this->file);
        return is_file($this->file) ? filemtime($this->file) . ':' . filesize($this->file) : 'none';
    }

    // ------------------------------------------------------------------
    // Defaults
    // ------------------------------------------------------------------

    public static function defaults()
    {
        return [
            'version' => self::VERSION,
            'rev' => 0,
            'language' => 'en',
            'tournament' => [
                'name' => 'Tournament title',
                'map' => 'Erangel',
                'day' => '1',
                'match' => '1',
                'logo' => '',
            ],
            'scoring' => [
                'killPoints' => 1,
                'placement' => [10, 6, 5, 4, 3, 2, 1, 1],
                'autoTotal' => true,
            ],
            'theme' => [
                'accent' => '#f2a900',
                'surface' => '#12151a',
                'text' => '#ffffff',
                'wallpaper' => '',
                'background' => 'transparent',
                'animation' => 'tactical',
                'teamsPerPage' => 8,
                'showMatches' => true,
                'showWwcd' => true,
                'compactSide' => 'left',
            ],
            'teams' => [],
            'overlay' => [
                'visible' => true,
                'view' => 'leaderboard',
                'page' => 0,
                'autoRotate' => false,
                'rotateSeconds' => 12,
                'winnerId' => '',
                'replay' => 0,
            ],
            'history' => [],
        ];
    }

    public static function newTeam(array $team = [])
    {
        return self::normalizeTeam($team + ['id' => self::newId('t')], [], true);
    }

    public static function newId($prefix)
    {
        return $prefix . bin2hex(random_bytes(5));
    }

    // ------------------------------------------------------------------
    // Load / save
    // ------------------------------------------------------------------

    /** Read the current state (always normalized, never throws on bad data). */
    public function load()
    {
        $raw = is_file($this->file) ? @file_get_contents($this->file) : false;
        $data = ($raw === false || trim($raw) === '') ? null : json_decode($raw, true);
        return $this->normalize(is_array($data) ? $data : []);
    }

    /**
     * Atomically read-modify-write the state.
     * $fn receives the state by reference and may return a result value.
     *
     * @return array{0: array, 1: mixed} [state, result]
     */
    public function mutate(callable $fn)
    {
        $lock = @fopen($this->dir . '/.lock', 'c');
        if ($lock) {
            flock($lock, LOCK_EX);
        }
        try {
            $state = $this->load();
            $before = $state['rev'];
            $result = $fn($state);
            $state = $this->normalize($state);
            $state['rev'] = $before + 1;
            $this->write($this->file, $state);
            return [$state, $result];
        } finally {
            if ($lock) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }
    }

    private function write($file, array $data)
    {
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new \RuntimeException('Could not encode state: ' . json_last_error_msg());
        }
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, $json) === false) {
            throw new \RuntimeException('The data folder is not writable: ' . dirname($file));
        }
        // rename() is atomic on POSIX; on Windows it can fail while a reader has
        // the target open, so retry briefly before falling back to a plain write.
        for ($i = 0; $i < 5; $i++) {
            if (@rename($tmp, $file)) {
                return;
            }
            usleep(20000);
        }
        $ok = @file_put_contents($file, $json, LOCK_EX);
        @unlink($tmp);
        if ($ok === false) {
            throw new \RuntimeException('Could not write ' . basename($file));
        }
    }

    // ------------------------------------------------------------------
    // Undo history (snapshots taken before destructive actions)
    // ------------------------------------------------------------------

    /** Call inside mutate() *before* changing the state. */
    public function snapshot(array &$state, $label)
    {
        $id = self::newId('h');
        $copy = $state;
        $copy['history'] = [];
        $this->write($this->dir . '/backups/' . $id . '.json', $copy);
        $state['history'][] = ['id' => $id, 'label' => (string) $label, 'at' => time()];
        while (count($state['history']) > self::MAX_HISTORY) {
            $old = array_shift($state['history']);
            @unlink($this->dir . '/backups/' . $old['id'] . '.json');
        }
    }

    /** Call inside mutate(). Returns the label that was undone, or null. */
    public function undo(array &$state)
    {
        while ($entry = array_pop($state['history'])) {
            $file = $this->dir . '/backups/' . $entry['id'] . '.json';
            $data = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
            @unlink($file);
            if (is_array($data)) {
                $history = $state['history'];
                $overlay = $state['overlay'];
                $state = $data;
                $state['history'] = $history;
                // What is on air right now should not jump because of an undo.
                $state['overlay'] = $overlay;
                return $entry['label'];
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Images
    // ------------------------------------------------------------------

    /** Store an uploaded image and return its public (relative) URL. */
    public function saveImage($bytes)
    {
        $len = strlen($bytes);
        if ($len === 0 || $len > self::MAX_UPLOAD_BYTES) {
            throw new \InvalidArgumentException('Image is empty or larger than 8 MB.');
        }
        $ext = self::imageExtension($bytes);
        if ($ext === null) {
            throw new \InvalidArgumentException('Unsupported image. Use PNG, JPG, WEBP or GIF.');
        }
        $name = substr(sha1($bytes), 0, 24) . '.' . $ext;
        $path = $this->dir . '/uploads/' . $name;
        if (!is_file($path) && @file_put_contents($path, $bytes) === false) {
            throw new \RuntimeException('The uploads folder is not writable.');
        }
        return 'Autoload/uploads/' . $name;
    }

    public static function imageExtension($bytes)
    {
        if (strncmp($bytes, "\x89PNG\r\n\x1a\n", 8) === 0) {
            return 'png';
        }
        if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0) {
            return 'jpg';
        }
        if (strncmp($bytes, 'GIF87a', 6) === 0 || strncmp($bytes, 'GIF89a', 6) === 0) {
            return 'gif';
        }
        if (strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') {
            return 'webp';
        }
        return null;
    }

    /**
     * Accepts whatever a client or an imported file calls an image and returns
     * a safe reference: an uploaded file, an http(s) URL, or ''.
     * Embedded data: URLs are written to the uploads folder.
     */
    private function normalizeImage($value)
    {
        if (!is_string($value) || $value === '') {
            return '';
        }
        $value = str_replace('\\', '/', trim($value));
        if (preg_match('~^Autoload/uploads/[a-f0-9]{16,64}\.(png|jpg|gif|webp)$~', $value)) {
            return is_file($this->dir . '/uploads/' . basename($value)) ? $value : '';
        }
        if (strncmp($value, 'data:image/', 11) === 0) {
            $comma = strpos($value, ',');
            if ($comma === false || strpos(substr($value, 0, $comma), ';base64') === false) {
                return '';
            }
            $bytes = base64_decode(substr($value, $comma + 1), true);
            if ($bytes === false) {
                return '';
            }
            try {
                return $this->saveImage($bytes);
            } catch (\Exception $e) {
                return '';
            }
        }
        if (preg_match('~^https?://[^\s"\'<>]{4,2000}$~i', $value)) {
            return $value;
        }
        return '';
    }

    /** Export: the state with uploaded images inlined, so one file is portable. */
    public function export()
    {
        $state = $this->load();
        unset($state['history'], $state['rev']);
        $inline = function ($ref) {
            if (strncmp($ref, 'Autoload/uploads/', 17) !== 0) {
                return $ref;
            }
            $path = $this->dir . '/uploads/' . basename($ref);
            $bytes = is_file($path) ? @file_get_contents($path) : false;
            if ($bytes === false) {
                return '';
            }
            $ext = pathinfo($path, PATHINFO_EXTENSION);
            $mime = $ext === 'jpg' ? 'image/jpeg' : 'image/' . $ext;
            return 'data:' . $mime . ';base64,' . base64_encode($bytes);
        };
        $state['tournament']['logo'] = $inline($state['tournament']['logo']);
        $state['theme']['wallpaper'] = $inline($state['theme']['wallpaper']);
        foreach ($state['teams'] as $i => $team) {
            $state['teams'][$i]['logo'] = $inline($team['logo']);
        }
        $state['exportedAt'] = gmdate('c');
        return $state;
    }

    // ------------------------------------------------------------------
    // Normalization (also migrates v1 files written by the old jQuery app)
    // ------------------------------------------------------------------

    public function normalize(array $in)
    {
        if (self::isLegacy($in)) {
            $in = self::migrateLegacy($in);
        }
        $d = self::defaults();
        $out = $d;

        $out['rev'] = self::int(isset($in['rev']) ? $in['rev'] : 0, 0, PHP_INT_MAX, 0);
        $out['language'] = self::choice(isset($in['language']) ? $in['language'] : null, self::LANGUAGES, 'en');

        $t = isset($in['tournament']) && is_array($in['tournament']) ? $in['tournament'] : [];
        $out['tournament'] = [
            'name' => self::str(isset($t['name']) ? $t['name'] : $d['tournament']['name'], 80),
            'map' => self::str(isset($t['map']) ? $t['map'] : $d['tournament']['map'], 30),
            'day' => self::str(isset($t['day']) ? $t['day'] : '', 12),
            'match' => self::str(isset($t['match']) ? $t['match'] : '', 12),
            'logo' => $this->normalizeImage(isset($t['logo']) ? $t['logo'] : ''),
        ];

        $s = isset($in['scoring']) && is_array($in['scoring']) ? $in['scoring'] : [];
        $placement = [];
        if (isset($s['placement']) && is_array($s['placement'])) {
            foreach (array_slice(array_values($s['placement']), 0, 64) as $p) {
                $placement[] = self::int($p, 0, 999, 0);
            }
        }
        $out['scoring'] = [
            'killPoints' => self::int(isset($s['killPoints']) ? $s['killPoints'] : 1, 0, 99, 1),
            'placement' => $placement ? $placement : $d['scoring']['placement'],
            'autoTotal' => self::bool(isset($s['autoTotal']) ? $s['autoTotal'] : true),
        ];

        $th = isset($in['theme']) && is_array($in['theme']) ? $in['theme'] : [];
        $dt = $d['theme'];
        $out['theme'] = [
            'accent' => self::color(isset($th['accent']) ? $th['accent'] : null, $dt['accent']),
            'surface' => self::color(isset($th['surface']) ? $th['surface'] : null, $dt['surface']),
            'text' => self::color(isset($th['text']) ? $th['text'] : null, $dt['text']),
            'wallpaper' => $this->normalizeImage(isset($th['wallpaper']) ? $th['wallpaper'] : ''),
            'background' => self::choice(isset($th['background']) ? $th['background'] : null, self::BACKGROUNDS, $dt['background']),
            'animation' => self::choice(isset($th['animation']) ? $th['animation'] : null, self::ANIMATIONS, $dt['animation']),
            'teamsPerPage' => self::int(isset($th['teamsPerPage']) ? $th['teamsPerPage'] : null, 1, 20, $dt['teamsPerPage']),
            'showMatches' => self::bool(isset($th['showMatches']) ? $th['showMatches'] : true),
            'showWwcd' => self::bool(isset($th['showWwcd']) ? $th['showWwcd'] : true),
            'compactSide' => self::choice(isset($th['compactSide']) ? $th['compactSide'] : null, ['left', 'right'], 'left'),
        ];

        $out['teams'] = [];
        $seen = [];
        if (isset($in['teams']) && is_array($in['teams'])) {
            foreach (array_slice(array_values($in['teams']), 0, self::MAX_TEAMS) as $team) {
                if (!is_array($team)) {
                    continue;
                }
                $team = $this->normalizeTeamImages(self::normalizeTeam($team, $out['scoring'], false));
                if (isset($seen[$team['id']])) {
                    $team['id'] = self::newId('t');
                }
                $seen[$team['id']] = true;
                $out['teams'][] = $team;
            }
        }

        $o = isset($in['overlay']) && is_array($in['overlay']) ? $in['overlay'] : [];
        $do = $d['overlay'];
        $pages = self::pageCount(count($out['teams']), $out['theme']['teamsPerPage']);
        $winner = self::str(isset($o['winnerId']) ? $o['winnerId'] : '', 20);
        $out['overlay'] = [
            'visible' => self::bool(isset($o['visible']) ? $o['visible'] : true),
            'view' => self::choice(isset($o['view']) ? $o['view'] : null, self::VIEWS, $do['view']),
            'page' => self::int(isset($o['page']) ? $o['page'] : 0, 0, $pages - 1, 0),
            'autoRotate' => self::bool(isset($o['autoRotate']) ? $o['autoRotate'] : false),
            'rotateSeconds' => self::int(isset($o['rotateSeconds']) ? $o['rotateSeconds'] : null, 3, 120, $do['rotateSeconds']),
            'winnerId' => isset($seen[$winner]) ? $winner : '',
            // Bumped by the "replay animation" button; overlays restart their entrance when it changes.
            'replay' => self::int(isset($o['replay']) ? $o['replay'] : 0, 0, PHP_INT_MAX, 0),
        ];

        $out['history'] = [];
        if (isset($in['history']) && is_array($in['history'])) {
            foreach (array_slice(array_values($in['history']), -self::MAX_HISTORY) as $h) {
                if (is_array($h) && isset($h['id']) && preg_match('/^h[a-f0-9]{10}$/', (string) $h['id'])) {
                    $out['history'][] = [
                        'id' => $h['id'],
                        'label' => self::str(isset($h['label']) ? $h['label'] : '', 40),
                        'at' => self::int(isset($h['at']) ? $h['at'] : 0, 0, PHP_INT_MAX, 0),
                    ];
                }
            }
        }

        return $out;
    }

    public static function pageCount($teams, $perPage)
    {
        return max(1, (int) ceil($teams / max(1, $perPage)));
    }

    private function normalizeTeamImages(array $team)
    {
        $team['logo'] = $this->normalizeImage($team['logo']);
        return $team;
    }

    /**
     * @param array $scoring when autoTotal is on, points are derived from it
     * @param bool  $fresh   true for brand-new teams (skips total recalculation)
     */
    public static function normalizeTeam(array $t, array $scoring, $fresh)
    {
        $id = isset($t['id']) && is_string($t['id']) && preg_match('/^t[a-f0-9]{10}$/', $t['id']) ? $t['id'] : self::newId('t');
        $team = [
            'id' => $id,
            'name' => self::str(isset($t['name']) ? $t['name'] : '', 40),
            'tag' => self::str(isset($t['tag']) ? $t['tag'] : '', 6),
            'logo' => isset($t['logo']) && is_string($t['logo']) ? $t['logo'] : '',
            'matches' => self::int(isset($t['matches']) ? $t['matches'] : 0, 0, 9999, 0),
            'wwcd' => self::int(isset($t['wwcd']) ? $t['wwcd'] : 0, 0, 9999, 0),
            'placePoints' => self::int(isset($t['placePoints']) ? $t['placePoints'] : 0, -9999, 99999, 0),
            'kills' => self::int(isset($t['kills']) ? $t['kills'] : 0, 0, 99999, 0),
            'points' => self::int(isset($t['points']) ? $t['points'] : 0, -9999, 999999, 0),
        ];
        if (!$fresh && !empty($scoring['autoTotal'])) {
            $team['points'] = $team['placePoints'] + $team['kills'] * (int) $scoring['killPoints'];
        }
        return $team;
    }

    private static function isLegacy(array $in)
    {
        return !isset($in['version']) && (isset($in['competition_name']) || isset($in['input_teams_page']));
    }

    private static function migrateLegacy(array $in)
    {
        $get = function ($key, $default = '') use ($in) {
            return isset($in[$key]) && is_scalar($in[$key]) ? $in[$key] : $default;
        };
        $teams = [];
        $sumsMatch = true;
        if (isset($in['teams']) && is_array($in['teams'])) {
            foreach ($in['teams'] as $t) {
                if (!is_array($t)) {
                    continue;
                }
                $team = [
                    'name' => isset($t['squad_name']) ? $t['squad_name'] : '',
                    'logo' => isset($t['squad_logo']) ? $t['squad_logo'] : '',
                    'matches' => isset($t['matches_played']) ? $t['matches_played'] : 0,
                    'wwcd' => isset($t['chicken_dinner']) ? $t['chicken_dinner'] : 0,
                    'placePoints' => isset($t['place_points']) ? $t['place_points'] : 0,
                    'kills' => isset($t['total_kills']) ? $t['total_kills'] : 0,
                    'points' => isset($t['total_points']) ? $t['total_points'] : 0,
                ];
                if ((int) $team['points'] !== (int) $team['placePoints'] + (int) $team['kills']) {
                    $sumsMatch = false;
                }
                $teams[] = $team;
            }
        }
        $wallpaper = $get('input_tablebg_wallpaper');
        return [
            'version' => self::VERSION,
            'language' => $get('language', 'en'),
            'tournament' => [
                'name' => $get('competition_name', 'Tournament title'),
                'map' => $get('input_table_map', 'Erangel'),
                'day' => $get('competition_day'),
                'match' => $get('competition_match'),
            ],
            // Keep hand-entered totals exactly as they were if they don't add up.
            'scoring' => ['autoTotal' => $sumsMatch],
            'theme' => [
                'accent' => $get('input_tablebg_main', '#f2a900'),
                'wallpaper' => $wallpaper,
                'background' => strncmp((string) $wallpaper, 'data:image/', 11) === 0 ? 'wallpaper' : 'transparent',
                'teamsPerPage' => $get('input_teams_page', 8),
                'showMatches' => $get('show_matches_played', 1),
                'showWwcd' => $get('show_chicken_dinner', 1),
            ],
            'teams' => $teams,
        ];
    }

    // ------------------------------------------------------------------
    // Scalar helpers
    // ------------------------------------------------------------------

    public static function str($value, $max)
    {
        if (!is_scalar($value)) {
            return '';
        }
        $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string) $value);
        if ($value === null) {
            return ''; // invalid UTF-8
        }
        $value = trim($value);
        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, $max, 'UTF-8');
        }
        return preg_match('/^.{0,' . (int) $max . '}/us', $value, $m) ? $m[0] : '';
    }

    public static function int($value, $min, $max, $default)
    {
        if (is_bool($value) || !is_numeric($value)) {
            return $default;
        }
        $value = (int) round((float) $value);
        return max($min, min($max, $value));
    }

    public static function bool($value)
    {
        if (is_string($value)) {
            return !in_array(strtolower($value), ['', '0', 'false', 'off', 'no'], true);
        }
        return (bool) $value;
    }

    public static function color($value, $default)
    {
        return is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? strtolower($value) : $default;
    }

    public static function choice($value, array $allowed, $default)
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : $default;
    }
}
