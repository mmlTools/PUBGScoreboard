<?php
require_once __DIR__ . "/Engine/GlobalFunctions.php";
use Engine\GlobalFunctions;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=Edge">
    <link rel="shortcut icon" href="favicon.ico">
    <link rel="icon" sizes="256x256" href="Vendordor/favicon/favicon-1.png">
    <link rel="icon" sizes="128x128" href="Vendordor/favicon/favicon-2.png">
    <link rel="icon" sizes="64x64" href="Vendordor/favicon/favicon-3.png">
    <link rel="icon" sizes="48x48" href="Vendordor/favicon/favicon-4.png">
    <link rel="icon" sizes="32x32" href="Vendordor/favicon/favicon-5.png">
    <link rel="icon" sizes="16x16" href="Vendordor/favicon/favicon-6.png">
    <link rel="apple-touch-icon" sizes="57x57" href="Vendordor/favicon/apple-touch-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="Vendordor/favicon/apple-touch-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="Vendordor/favicon/apple-touch-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="Vendordor/favicon/apple-touch-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="Vendordor/favicon/apple-touch-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="Vendordor/favicon/apple-touch-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="Vendordor/favicon/apple-touch-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="Vendordor/favicon/apple-touch-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="Vendordor/favicon/apple-touch-icon-180x180.png">
    <title>StreamCD: PubG Room Scoreboard</title>
    <meta name="description" content="StreamCD: PubG Room Scoreboard">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="Vendordor/css/bootstrap.min.css">
    <link rel="stylesheet" href="Vendordor/css/all.min.css">
    <link rel="stylesheet" href="Vendordor/css/odometer-theme-default.css">
    <link rel="stylesheet" href="Vendordor/css/animate.min.css">
    <link rel="stylesheet" href="Vendor/css/scoreboard.css">
</head>
<body>
<?php include GlobalFunctions::GetUriSegment(1) ? GlobalFunctions::GetUriSegment(1).".php" : "setup.php"; ?>
</body>
<script src="Vendordor/js/jquery-3.6.0.min.js"></script>
<script src="Vendordor/js/bootstrap.bundle.min.js"></script>
<script src="Vendordor/js/wow.min.js"></script>
<script src="Vendordor/js/odometer.min.js"></script>
<script src="Vendordor/js/main.js"></script>
<script src="Vendor/js/<?= GlobalFunctions::GetUriSegment(1) ? GlobalFunctions::GetUriSegment(1) : "setup" ?>.js"></script>
</html>