<?php

namespace Engine;

/** Renders the two HTML views and knows which URL maps to which view. */
final class Pages
{
    /** URL path (below the app base) => view file in /Views */
    const ROUTES = [
        '' => 'control',
        'control' => 'control',
        'setup' => 'control',       // v1 URL
        'scoreboard' => 'overlay',  // v1 URL, still the canonical overlay address
        'overlay' => 'overlay',
    ];

    /** Static files the standalone server is allowed to hand out. */
    const PUBLIC_PREFIXES = ['Vendor/', 'Autoload/uploads/'];
    const PUBLIC_FILES = ['favicon.ico', 'Autoload/translations.json'];

    const MIME = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'ico' => 'image/x-icon',
        'woff2' => 'font/woff2',
        'woff' => 'font/woff',
        'ttf' => 'font/ttf',
        'txt' => 'text/plain; charset=utf-8',
    ];

    public static function view($path)
    {
        $path = trim($path, '/');
        return isset(self::ROUTES[$path]) ? self::ROUTES[$path] : null;
    }

    /**
     * @param string $view   'control' or 'overlay'
     * @param string $base   URL base of the app, always ending in "/"
     * @param array  $config extra values for window.SCOREBOARD_CONFIG
     */
    public static function render($view, $base, array $config = [])
    {
        $html = (string) file_get_contents(dirname(__DIR__) . '/Views/' . $view . '.html');
        $version = Api::version();
        $config = ['base' => $base, 'version' => $version] + $config + ['realtime' => false];
        return strtr($html, [
            '{{BASE}}' => htmlspecialchars($base, ENT_QUOTES, 'UTF-8'),
            '{{VERSION}}' => htmlspecialchars($version, ENT_QUOTES, 'UTF-8'),
            '{{CONFIG}}' => json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES),
        ]);
    }

    public static function isPublicFile($path)
    {
        if (in_array($path, self::PUBLIC_FILES, true)) {
            return true;
        }
        foreach (self::PUBLIC_PREFIXES as $prefix) {
            if (strncmp($path, $prefix, strlen($prefix)) === 0) {
                return true;
            }
        }
        return false;
    }

    public static function mime($path)
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        return isset(self::MIME[$ext]) ? self::MIME[$ext] : 'application/octet-stream';
    }
}
