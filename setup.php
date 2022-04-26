<div id="ErrorBlock"></div>
<nav id="Navigation" class="navbar navbar-expand-lg navbar-dark">
    <a class="navbar-brand" type="button" href="">StreamCD: PubG Room Scoreboard</a>
    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#streamcdPubgScoreboardMenu" aria-controls="streamcdPubgScoreboardMenu" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
    </button>

    <div class="collapse navbar-collapse" id="streamcdPubgScoreboardMenu">
        <ul class="navbar-nav ml-auto">
            <li class="nav-item active">
                <a class="nav-link" href=""><span data-translate="menu_link_homepage"></span></a>
            </li>
            <li class="nav-item">
                <a class="nav-link" href="/scoreboard"><span data-translate="menu_link_launch_scoreboard"></span></a>
            </li>
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle d-flex align-items-center" href="#" id="navbarDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                    <img class="c-language mr-2"/> <span data-translate="menu_link_language"></span>
                </a>
                <div class="dropdown-menu dropdown-menu-right" aria-labelledby="navbarDropdown">
                    <a class="dropdown-item d-flex align-items-center" href="#" set-language="ro"><img src="Vendor/img/flags/ro.gif"/> <span class="ml-3" data-translate="language_name_ro"></span></a>
                    <div class="dropdown-divider"></div>
                    <a class="dropdown-item d-flex align-items-center" href="#" set-language="en"><img src="Vendor/img/flags/gb.gif"/> <span class="ml-3" data-translate="language_name_en"></span></a>
                </div>
            </li>
            <li class="nav-item">
                <a class="nav-link" href="https://ko-fi.com/streamcd" target="_blank"><span class="ml-3" data-translate="donate_coffee"></span> <i class="fas fa-coffee"></i></a>
            </li>
        </ul>
    </div>
</nav>
<div id="SettingsLayout" class="container-fluid py-3">
    <div class="d-flex justify-content-end mb-3 toolbar">
        <button class="btn btn-warning mr-3" onclick="ToggleSettingsMenu(this)"><i class="fas fa-cog"></i> <span data-translate="btn_settings_menu"></span></button>
        <button class="btn btn-warning mr-3" onclick="AppendNewTeam()"><i class="fas fa-plus-circle"></i> <span data-translate="btn_append_new_team"></span></button>
        <button class="btn btn-warning mr-3" onclick="SaveTournamentData()"><i class="fas fa-save"></i> <span data-translate="btn_save_changes"></span></button>
        <button class="btn btn-warning mr-3" onclick="ShowDownloadForm()"><i class="fas fa-download"></i> <span data-translate="btn_download_configuration"></span></button>
        <button class="btn btn-warning mr-3" onclick="ShowUploadForm()"><i class="fas fa-upload"></i> <span data-translate="btn_upload_configuration"></span></button>
        <button class="btn btn-warning mr-3" onclick="ResetScores()"><i class="fas fa-redo"></i> <span data-translate="btn_reset_scores"></span></button>
        <button class="btn btn-warning" onclick="ResetCompetition()"><i class="fas fa-trash"></i> <span data-translate="btn_reset_competition"></span></button>
    </div>
    <div class="d-flex mb-3 setup-bar w-100">
        <div class="form-group w-50 mb-0 mr-3">
            <label class="text-strong" data-translate="input_competition_name"></label>
            <h1 class="mb-0">
                <input class="w-100" type="text" name="competition_name" placeholder="_____________________________">
            </h1>
        </div>
        <div class="form-group w-20 mr-3">
            <label class="text-strong" data-translate="input_table_map"></label>
            <select class="map-selector w-100" name="input_table_map">
                <option value="Erangel">Erangel</option>
                <option value="Miramar">Miramar</option>
                <option value="Vikendi">Vikendi</option>
                <option value="Sanhok">Sanhok</option>
                <option value="Erangel">Erangel</option>
                <option value="Karakin">Karakin</option>
                <option value="Vikendi">Vikendi</option>
                <option value="Sanhok">Sanhok</option>
                <option value="Paramo">Paramo</option>
                <option value="Haven">Haven</option>
                <option value="Taego">Taego</option>
            </select>
        </div>
        <div class="form-group w-15 mb-0 mr-3">
            <label class="text-strong" data-translate="input_competition_day"></label>
            <h1 class="mb-0">
                <input class="w-100" type="text" name="competition_day" placeholder="_____________________________">
            </h1>
        </div>
        <div class="form-group w-15 mb-0">
            <label class="text-strong" data-translate="input_competition_match"></label>
            <h1 class="mb-0">
                <input class="w-100" type="text" name="competition_match" placeholder="_____________________________">
            </h1>
        </div>
    </div>
    <div class="setup-bar side animate__animated" id="SideMenu">
        <div class="form-group mb-5 d-flex flex-column">
            <label class="text-strong" data-translate="input_table_animation_in"></label>
            <select class="animation-selector" data-dir="in" name="input_table_animation_in"></select>
        </div><hr>
        <div class="form-group mb-3 d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_tablebg_wallpaper"></label>
            <div class="upload-wrapper">
                <input type="file" accept="image/*" class="d-none" upload-input="true">
                <img src="Vendor/img/upload-logo.png" class="input_tablebg_wallpaper sm" alt="" data-trigger="upload-logo" />
            </div>
        </div><hr>
        <div class="form-group mb-3 custom-color-selector d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_tablebg_logo"></label>
            <div class="position-relative">
                <input type="color" name="input_tablebg_logo" aria-label="" value="#ffffff">
                <div class="chroma-replacer"></div>
            </div>
        </div><hr>
        <div class="form-group mb-3 custom-color-selector d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_tablebg_main"></label>
            <div class="position-relative">
                <input type="color" name="input_tablebg_main" aria-label="" value="#ffffff">
                <div class="chroma-replacer"></div>
            </div>
        </div><hr>
        <div class="form-group mb-3 custom-color-selector d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_tablebg_secondary"></label>
            <div class="position-relative">
                <input type="color" name="input_tablebg_secondary" aria-label="" value="#ffffff">
                <div class="chroma-replacer"></div>
            </div>
        </div><hr>
        <div class="form-group mb-3 custom-color-selector d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_table_text_color"></label>
            <div class="position-relative">
                <input type="color" name="input_table_text_color" aria-label="" value="#000000">
                <div class="chroma-replacer"></div>
            </div>
        </div><hr>
        <div class="form-group mb-3 d-flex justify-content-between align-items-center">
            <label class="text-strong" data-translate="input_teams_page"></label>
            <div class="position-relative">
                <input type="number" class="form-control not-styled text-right text-strong input-width-50" name="input_teams_page" aria-label="" value="4">
            </div>
        </div>
    </div>
    <div class="table-responsive">
        <table class="table">
            <thead>
            <tr>
                <th class="w-10"><span data-translate="table_head_squad_logo"></span></th>
                <th class="w-30"><span data-translate="table_head_squad_name"></span></th>
                <th class="w-10 text-center">
                    <label class="mb-0">
                        <input type="checkbox" name="show_matches_played" aria-label="" checked />
                        <span data-translate="table_head_matches_played"></span>
                    </label>
                </th>
                <th class="w-10 text-center">
                    <label class="mb-0">
                        <input type="checkbox" name="show_chicken_dinner" aria-label="" checked />
                        <span data-translate="table_head_chicken_dinner"></span>
                    </label>
                </th>
                <th class="w-10 text-center"><span data-translate="table_head_place_points"></span></th>
                <th class="w-10 text-center"><span data-translate="table_head_total_kills"></span></th>
                <th class="w-10 text-center"><span data-translate="table_head_total_points"></span></th>
                <th class="w-10"></th>
            </tr>
            </thead>
            <tbody id="TeamsList">
            </tbody>
        </table>
    </div>
</div>
