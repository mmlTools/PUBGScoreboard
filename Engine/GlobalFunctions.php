<?php namespace Engine;

class GlobalFunctions{
    public static function GetUriSegment($segment = null){
        $current_url = $actual_link = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]";
        $url = parse_url($current_url);
        $segments = explode("/", $url["path"]);
        return is_null($segment) ? $segments : (isset($segments[$segment]) ? $segments[$segment] : null);
    }
}
