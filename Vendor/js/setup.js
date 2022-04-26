$(document).ready(function () {
    LoadTeamsToSetupView();
});

$(document).on("click", "[data-trigger=upload-logo]", function () {
   $(this).parent().find("input").trigger("click");
});

$(document).on("click", ".chroma-replacer", function () {
   $(this).parent().find("input").trigger("click");
});

$(document).on("click", "#TeamsList input[type=number]", function () {
   $(this).focus().select();
});

$(document).on("click", ".custom-radio-wrap button", function () {
    $(document).find(".custom-radio-wrap button").removeClass("btn-primary").addClass("btn-default");
    $(this).removeClass("btn-default").addClass("btn-primary");
    $(this).parent().find("input").trigger("click");
});

$(document).on("input", ".custom-color-selector input[type=color]", function () {
    let me = $(this);
   $(this).parent().find(".chroma-replacer").css({
       backgroundColor: me.val()
   });
});

$(document).on("click", "[data-trigger=confirm-squad-remove]", function () {
    let squad = $($("#TeamsList").children()[parseInt($(this).attr("data-key"))]);
    squad.addClass("animate__animated animate__bounceOut");
    $(document).find(".modal").modal("hide");
    setTimeout(function () {
        squad.remove();
    }, 300);
    ShowAlert("success", '<span data-translate="info_squad_removed_success"></span>');
});

$(document).on("click", "[data-trigger=remove-squad]", function () {
    let html = '<p data-translate="warning_remove_squad"></p>';
    html += '<div class="d-flex justify-content-end mt-3">';
    html += '   <button class="btn btn-warning" data-trigger="confirm-squad-remove" data-key="' + $(this).attr("data-key") + '"><i class="fas fa-check"></i> <span data-translate="btn_confirm"></span></button>';
    html += '</div>';
   ShowModal("md", html)
});

$(document).on("change", "[upload-input]", function () {
    let me = $(this);
    if (me[0].files[0]) {
        let reader = new FileReader();
        reader.onload = function(e) {
            let output = me.parent().find("[data-trigger=upload-logo]");
            output.hide().addClass("animate__animated animate__bounceIn").attr("src", reader.result).show();
        };
        reader.readAsDataURL(me[0].files[0]);
    }
});

function ResetCompetition(){
    let html = '<p data-translate="warning_reset_competition"></p>';
    html += '<div class="d-flex justify-content-end mt-3">';
    html += '   <button class="btn btn-warning" data-trigger="confirm-competition-reset"><i class="fas fa-check"></i> <span data-translate="btn_confirm"></span></button>';
    html += '</div>';
    ShowModal("md", html)
}

$(document).on("click", "[data-trigger=confirm-competition-reset]", function () {
    new ajaxRequest({
        params: {
            method: "SaveTournamentData",
            teams: ""
        }}).ready(function (a) {
        if(a.state)
        {
            LoadTeamsToSetupView();
            ShowAlert("success", '<span data-translate="info_reset_success"></span>');
        }
        else
            ShowAlert("danger", '<span data-translate="info_reset_failed"></span>');
        $(document).find(".modal").modal("hide");
    });
});

function ResetScores(){
    let html = '<p data-translate="warning_reset_scores"></p>';
    html += '<div class="d-flex justify-content-end mt-3">';
    html += '   <button class="btn btn-warning" data-trigger="confirm-scores-reset"><i class="fas fa-check"></i> <span data-translate="btn_confirm"></span></button>';
    html += '</div>';
    ShowModal("md", html)
}

$(document).on("click", "[data-trigger=confirm-scores-reset]", function () {
    $("#TeamsList").find("input[type=number]").val(0);
    $(document).find(".modal").modal("hide");
    ShowAlert("success", '<span data-translate="info_score_reset_success"></span>');
});

let menu_timeout;
function ToggleSettingsMenu(me) {
    clearTimeout(menu_timeout);
    let menu = $("#SideMenu");
    if($(me).hasClass("toggled")){
        menu.removeClass("animate__slideInLeft").addClass("animate__slideOutLeft");
        menu_timeout = setTimeout(function () {
            menu.hide();
        }, 900);
        $(me).removeClass("btn-primary").addClass("btn-warning").removeClass("toggled");
    } else {
        menu.removeClass("animate__slideOutLeft").addClass("animate__slideInLeft");
        menu.show();
        $(me).removeClass("btn-warning").addClass("btn-primary").addClass("toggled");
    }
}

function LoadTeamsToSetupView(){
    new ajaxRequest({
        params: {
            method: "LoadTournamentData"
        }}).ready(function (a) {
        let tournament = JSON.parse(a.result),
            list = $("#TeamsList");

        list.html("");
        if (a.result.length > 0){
            $(document).find("input[name=competition_name]").val(tournament.competition_name);
            $(document).find("input[name=input_teams_page]").val(tournament.input_teams_page);
            $(document).find("input[name=input_tablebg_logo]").val(tournament.input_tablebg_logo).trigger("input");
            $(document).find("input[name=input_tablebg_main]").val(tournament.input_tablebg_main).trigger("input");
            $(document).find("input[name=input_table_text_color]").val(tournament.input_table_text_color).trigger("input");
            $(document).find("input[name=input_tablebg_secondary]").val(tournament.input_tablebg_secondary).trigger("input");
            $(document).find("input[name=competition_day]").val(tournament.competition_day).trigger("input");
            $(document).find("input[name=competition_match]").val(tournament.competition_match).trigger("input");
            $(document).find("select[name=input_table_map]").val(tournament.input_table_map).trigger("input");
            $(document).find(".input_tablebg_wallpaper").attr("src", tournament.input_tablebg_wallpaper);
            $(document).find("select[name=input_table_animation_in]").val(tournament.input_table_animation_in);

            if(parseInt(tournament.show_chicken_dinner) === 1 && $(document).find("input[name=show_chicken_dinner]").length > 0)
                $(document).find("input[name=show_chicken_dinner]").prop("checked", true);
            else
                $(document).find("input[name=show_chicken_dinner]").prop("checked", false);

            if(parseInt(tournament.show_matches_played) === 1 && $(document).find("input[name=show_matches_played]").length > 0)
                $(document).find("input[name=show_matches_played]").prop("checked", true);
            else
                $(document).find("input[name=show_matches_played]").prop("checked", false);

            $.each(tournament.teams, function (key, val) {
                let root = $('<tr></tr>');
                root.append($('<td class="w-10"><div class="squad-logo-wrapper"><input type="file" accept="image/*" class="d-none" upload-input="true"><img src="' + val.squad_logo + '" class="squad_logo sm" alt="" data-trigger="upload-logo" /></div></td>'));
                root.append($('<td class="w-30"><input type="text" class="squad_name text-strong w-100" aria-label="" value="' + val.squad_name + '" placeholder="___________________"></td>'));
                root.append($('<td class="w-10"><input type="number" class="matches_played text-strong text-center" value="' + val.matches_played + '" aria-label=""></td>'));
                root.append($('<td class="w-10"><input type="number" class="chicken_dinner text-strong text-center" value="' + val.chicken_dinner + '" aria-label=""></td>'));
                root.append($('<td class="w-10"><input type="number" class="place_points text-strong text-center" value="' + val.place_points + '" aria-label=""></td>'));
                root.append($('<td class="w-10"><input type="number" class="total_kills text-strong text-center" value="' + val.total_kills + '" aria-label=""></td>'));
                root.append($('<td class="w-10"><input type="number" class="total_points text-strong text-center" value="' + val.total_points + '" aria-label=""></td>'));
                root.append($('<td class="w-10 text-right"><button class="btn btn-link" data-trigger="remove-squad" data-key="' + key + '"><i class="fas fa-times text-danger fa-2x"></i></button></td>'));

                list.append(root);
            })
        }
    });
}

function SaveTournamentData(){
    let competition = {
        language: GetCurrentLanguage(),
        competition_name: $(document).find("input[name=competition_name]").val(),
        input_tablebg_logo: $(document).find("input[name=input_tablebg_logo]").val(),
        input_tablebg_main: $(document).find("input[name=input_tablebg_main]").val(),
        input_table_text_color: $(document).find("input[name=input_table_text_color]").val(),
        input_tablebg_secondary: $(document).find("input[name=input_tablebg_secondary]").val(),
        competition_day: $(document).find("input[name=competition_day]").val(),
        competition_match: $(document).find("input[name=competition_match]").val(),
        show_matches_played: $(document).find("input[name=show_matches_played]").prop("checked") ? 1 : 0,
        show_chicken_dinner: $(document).find("input[name=show_chicken_dinner]").prop("checked") ? 1 : 0,
        input_table_map: $(document).find("select[name=input_table_map]").val(),
        input_teams_page: $(document).find("input[name=input_teams_page]").val(),
        input_tablebg_wallpaper: $(document).find(".input_tablebg_wallpaper").attr("src"),
        input_table_animation_in: $(document).find("select[name=input_table_animation_in]").val(),
        teams: []
    };

    $.each($("#TeamsList").children(), function (key, val) {
        let team = $(this);
        let obj = {
            squad_logo: team.find(".squad_logo").attr("src"),
            squad_name: team.find(".squad_name").val(),
            matches_played: team.find(".matches_played").val(),
            chicken_dinner: team.find(".chicken_dinner").val(),
            place_points: team.find(".place_points").val(),
            total_kills: team.find(".total_kills ").val(),
            total_points: team.find(".total_points").val()
        };
        competition.teams.push(obj);
    });

    new ajaxRequest({
        params: {
            method: "SaveTournamentData",
            teams: competition
        }}).ready(function (a) {
        if(a.state)
            ShowAlert("success", '<span data-translate="info_changes_saved_success"></span>');
        else
            ShowAlert("danger", '<span data-translate="info_changes_saved_failed"></span>');
    });
}

function AppendNewTeam() {
    let root = $('<tr></tr>');
    root.append($('<td class="w-10"><div class="squad-logo-wrapper"><input type="file" accept="image/*" class="d-none" upload-input="true"><img src="Vendor/img/upload-logo.png" class="squad_logo sm" alt="" data-trigger="upload-logo" /></div></td>'));
    root.append($('<td class="w-30"><input type="text" class="squad_name text-strong w-100" aria-label="" placeholder="___________________"></td>'));
    root.append($('<td class="w-10"><input type="number" class="matches_played text-strong text-center" value="0" aria-label=""></td>'));
    root.append($('<td class="w-10"><input type="number" class="chicken_dinner text-strong text-center" value="0" aria-label=""></td>'));
    root.append($('<td class="w-10"><input type="number" class="place_points text-strong text-center" value="0" aria-label=""></td>'));
    root.append($('<td class="w-10"><input type="number" class="total_kills text-strong text-center" value="0" aria-label=""></td>'));
    root.append($('<td class="w-10"><input type="number" class="total_points  text-strong text-center" value="0" aria-label=""></td>'));
    root.append($('<td class="w-10 text-right"><button class="btn btn-link" data-trigger="remove-squad"><i class="fas fa-times text-danger fa-2x"></i></button></td>'));

    $("#TeamsList").append(root);
}

function ShowUploadForm () {
    let html = '';
    html += '<div class="form-group">';
    html += '   <label class="text-strong" data-translate="info_select_json_file"></label>';
    html += '   <input class="form-control" type="file" name="json-upload" aria-label="" accept=".json"/>';
    html += '</div>';
    html += '<div class="data-brieff"></div>';
    html += '<div class="modal-error"></div>';
    html += '<div class="d-flex justify-content-end mt-3">';
    html += '   <button class="btn btn-warning" data-trigger="confirm-upload-data"><i class="fas fa-upload"></i> <span data-translate="btn_upload"></span></button>';
    html += '</div>';
    ShowModal("md", html)
}

let tempJSON = null;
$(document).on("change", "input[name=json-upload]", function () {
    let me = $(this);
    if (me[0].files[0]) {
        let reader = new FileReader();
        reader.onload = function(e) {
           let competition;
           try{
               competition = JSON.parse(reader.result);
               if(!competition.competition_name
                   || !competition.input_tablebg_logo
                   || !competition.input_tablebg_main
                   || !competition.input_table_text_color
                   || !competition.input_tablebg_secondary
                   || !competition.input_tablebg_wallpaper
                   || !competition.input_table_animation_in
                   || !competition.input_teams_page
                   || !competition.teams)
               ShowAlert("danger", '<span data-translate="error_invalid_file_structure"></span>', ".modal-error");
               else
               {
                   tempJSON = competition;
                   let brieff = $(document).find(".data-brieff");
                   brieff.append('<p data-translate="upload_status_brieff"></p>');
                   brieff.append('<p class="d-flex justify-content-between"><span data-translate="upload_status"></span><span data-translate="upload_status_success" class="text-strong text-success"></span></p>');
                   brieff.append('<p class="d-flex justify-content-between"><span data-translate="input_competition_name"></span><span class="text-strong">' + competition.competition_name + '</span></p>');
                   brieff.append('<p class="d-flex justify-content-between"><span data-translate="total_teams"></span><span class="text-strong">' + competition.teams.length + '</span></p>');
                   Translate();
               }
           } catch (e) {
               ShowAlert("danger", '<span data-translate="error_invalid_configuration_file"></span>', ".modal-error")
           }
        };
        reader.readAsText(me[0].files[0]);
    }
});

$(document).on("click", "[data-trigger=confirm-upload-data]", function () {
    new ajaxRequest({
        params: {
            method: "SaveTournamentData",
            teams: tempJSON
        }}).ready(function () {
        $(document).find(".modal").modal("hide");
        LoadTeamsToSetupView();
        ShowAlert("success", '<span data-translate="info_upload_data_success"></span>')
    });
});

function ShowDownloadForm () {
    let html = '';
    html += '<div class="form-group">';
    html += '   <label class="text-strong" data-translate="info_give_it_a_name"></label>';
    html += '   <input class="form-control" type="text" name="json-name" aria-label=""/>';
    html += '</div>';
    html += '<div class="d-flex justify-content-end mt-3">';
    html += '   <button class="btn btn-warning" data-trigger="confirm-download-data"><i class="fas fa-upload"></i> <span data-translate="btn_download"></span></button>';
    html += '</div>';
    ShowModal("md", html)
}

$(document).on("click", "[data-trigger=confirm-download-data]", function () {
    new ajaxRequest({
        params: {
            method: "LoadTournamentData"
        }}).ready(function (a) {
        DownloadConfiguration(a.result, $(document).find("input[name=json-name]").val() + ".json", 'application/json');
        $(document).find(".modal").modal("hide");
    });
});

function DownloadConfiguration(content, fileName, contentType) {
    let a = document.createElement("a"),
        file = new Blob([content], {type: contentType});
    a.href = URL.createObjectURL(file);
    a.download = fileName.trim().replace(/\s\s+/g, ' ').replace(/ /g, "_");
    a.click();
}