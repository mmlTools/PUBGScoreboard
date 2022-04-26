<?php
/*$https_req = false;
if ((empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === "off") && $https_req) {
    $location = 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    header('HTTP/1.1 301 Moved Permanently');
    header('Location: ' . $location);
    exit;
}*/
error_reporting(E_ALL);
include "Engine/GlobalFunctions.php";

use Engine\GlobalFunctions;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=Edge">
    <link rel="shortcut icon" href="favicon.ico">
    <link rel="icon" sizes="256x256" href="Vendor/favicon/favicon-1.png">
    <link rel="icon" sizes="128x128" href="Vendor/favicon/favicon-2.png">
    <link rel="icon" sizes="64x64" href="Vendor/favicon/favicon-3.png">
    <link rel="icon" sizes="48x48" href="Vendor/favicon/favicon-4.png">
    <link rel="icon" sizes="32x32" href="Vendor/favicon/favicon-5.png">
    <link rel="icon" sizes="16x16" href="Vendor/favicon/favicon-6.png">
    <link rel="apple-touch-icon" sizes="57x57" href="Vendor/favicon/apple-touch-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="Vendor/favicon/apple-touch-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="Vendor/favicon/apple-touch-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="Vendor/favicon/apple-touch-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="Vendor/favicon/apple-touch-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="Vendor/favicon/apple-touch-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="Vendor/favicon/apple-touch-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="Vendor/favicon/apple-touch-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="Vendor/favicon/apple-touch-icon-180x180.png">
    <title>StreamCD: PubG Room Scoreboard</title>
    <meta name="description" content="StreamCD: PubG Room Scoreboard">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="Vendor/css/bootstrap.min.css">
    <link rel="stylesheet" href="Vendor/css/all.min.css">
    <link rel="stylesheet" href="Vendor/css/odometer-theme-default.css">
    <link rel="stylesheet" href="Vendor/css/animate.min.css">
    <link rel="stylesheet" href="Vendor/css/scoreboard.css">
</head>
<body>
<?php include GlobalFunctions::GetUriSegment(1).".php"; ?>
</body>
<script src="Vendor/js/jquery-3.6.0.min.js"></script>
<script src="Vendor/js/bootstrap.bundle.min.js"></script>
<script src="Vendor/js/wow.min.js"></script>
<script src="Vendor/js/odometer.min.js"></script>
<script src="Vendor/js/main.js"></script>
<script src="Vendor/js/<?= GlobalFunctions::GetUriSegment(1) ?>.js"></script>
</html>