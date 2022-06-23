<?php namespace Engine;

class GlobalFunctions{
    /**
     * @param null $segment
     * @return array|null
     */
    public static function GetUriSegment($segment = null){
        $current_url = $actual_link = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]";
        $url = parse_url($current_url);
        $segments = explode("/", $url["path"]);
        return is_null($segment) ? $segments : (isset($segments[$segment]) ? $segments[$segment] : null);
    }

    /**
     * @param $extension
     * @return string
     */
    public static function GetPath($extension){
       return GlobalFunctions::GetUriSegment(1) ?
           (file_exists(GlobalFunctions::GetUriSegment(1).$extension) ? GlobalFunctions::GetUriSegment(1).$extension : "setup$extension") :
           "setup$extension";
    }
}
