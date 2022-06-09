let c_competition,
    teams = [],
    page_index = 1,
    total_pages = 1,
    teams_per_page = 0;

$(document).ready(function () {
    let wow = new WOW(
        {
            boxClass: 'wow',
            animateClass: 'animate__animated',
            offset: 0,
            mobile: true,
            live: true
        }
    );
    wow.init();
    new ajaxRequest({
        params: {
            method: "LoadTournamentData"
        }}).ready(function (a) {
        let tournament = JSON.parse(a.result),
            language = !tournament.language ? "en" : tournament.language;

        if(!tournament.teams)
            tournament.teams = [];

        localStorage.setItem('language', JSON.stringify(language));
        c_competition = tournament;
        teams_per_page = isNaN(parseInt(tournament.input_teams_page)) ? 4 : parseInt(tournament.input_teams_page);

        let i = 0, n = tournament.teams.length;
        tournament.teams.sort(function(a, b) {
            return b.total_points - a.total_points;
        });
        while (i < n) {
            teams.push(tournament.teams.slice(i, i += teams_per_page));
        }
        total_pages = teams.length;
        LoadLayout();

    })
});

$(document).on("keydown", function(e) {
    let list = $("#TeamsList");
    switch (e.which) {
        case 37:
            if (page_index <= 1)
                page_index = 1;
            else
            {
                list.addClass("animate__animated animate__slideOutLeft");
                page_index--;
                setTimeout(function () {
                    list.removeClass("animate__animated animate__slideOutRight");
                    list.removeClass("animate__animated animate__slideOutLeft");
                    LoadTeamsToSetupView();
                }, 300);
            }
            break;
        case 39:
            if (page_index >= total_pages)
                page_index = total_pages;
            else
            {
                page_index++;
                list.addClass("animate__animated animate__slideOutRight");
                setTimeout(function () {
                    list.removeClass("animate__animated animate__slideOutRight");
                    list.removeClass("animate__animated animate__slideOutLeft");
                    LoadTeamsToSetupView();
                }, 300);
            }
            break;
    }

});

function LoadLayout(){
    $(document).find(".competition_name").html(c_competition.competition_name);
    $(document).find(".competition_map").html(c_competition.input_table_map);
    $(document).find(".competition_day").html('<span data-translate="competition_day"></span>: ' + c_competition.competition_day);
    $(document).find(".competition_match").html('<span data-translate="competition_match"></span>: ' + c_competition.competition_match);

    if(c_competition.input_tablebg_wallpaper === "Vendor/img/upload-logo.png")
    $(document).find("body").css({background: "#fff"});
    else
    $(document).find("body").css({
        background: "url(" + c_competition.input_tablebg_wallpaper + ") no-repeat",
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundAttachment: "fixed",
        color: c_competition.input_table_text_color
    });
    Translate();
    LoadTeamsToSetupView();
}

function LoadTeamsToSetupView(){
    let page = page_index - 1;
    let competition = teams[page];

    console.log(teams);

    $("#TeamsList").html("");
    $.each(competition, function (key, val) {
        let root = $('<tr class="animate__animated animate__slideInLeft"></tr>');
        let t = [];
        let place = page === 0 ? (page_index + key) : (page_index * teams_per_page - teams_per_page + key + 1);

        t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-5 text-strong text-center input_tablebg_secondary">' + place + '</td>'));
        t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-40 text-strong p-0 input_tablebg_main"><div class="d-flex align-items-center"><div class="input_tablebg_logo squad-logo-wrapper p-3 mr-3 d-flex justify-content-center align-items-center"><img src="' + val.squad_logo + '" class="squad_logo" alt="" /></div> <h3 class="squad_name mb-0">' + val.squad_name + '</h3></div> </td>'));

        if(parseInt(c_competition.show_matches_played) === 1)
            t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-10 text-strong text-center input_tablebg_secondary"><span class="odometer" data-odometer="' + val.matches_played + '">0</span></td>'));
        else
            $(document).find(".trigger_head_matches_played").hide();

        if(parseInt(c_competition.show_chicken_dinner) === 1)
            t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-15 text-strong text-center input_tablebg_main"><div class="d-flex align-items-center justify-content-center"><img class="img_chicken_dinner mr-2" src="Vendor/img/chicken_dinner.png" alt="" /> x<span class="odometer" data-odometer="' + val.chicken_dinner + '">0</span></div></td>'));
        else
            $(document).find(".trigger_head_chicken_dinner").hide();

        t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-10 text-strong text-center input_tablebg_secondary"><span class="odometer" data-odometer="' + val.place_points + '">0</span></td>'));
        t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-10 text-strong text-center input_tablebg_main"><span class="odometer" data-odometer="' + val.total_kills + '">0</span></td>'));
        t.push($('<td data-wow-duration="1s" class="wow animate__' + c_competition.input_table_animation_in + ' w-10 text-strong text-center input_tablebg_secondary"><span class="odometer" data-odometer="' + val.total_points + '">0</span></td>'));

        $.each(t, function () {
            $(this).hide();
            root.append($(this));
        });

        $("#TeamsList").append(root);
        $.each(t, function () {
            $(this).show();
        });
    });

    $.each($(document).find(".odometer"), function () {
        let me = $(this);
        let od = new Odometer({
            el: me[0],
            value: 0,
            format: '',
            duration: 3000,
            theme: 'default'
        });

        if(parseInt(me.attr("data-odometer")) > 0)
            od.update(parseInt(me.attr("data-odometer")))
    });

    $(document).find(".input_tablebg_main").css({
        background: c_competition.input_tablebg_main
    });
    $(document).find(".input_tablebg_secondary").css({
        background: c_competition.input_tablebg_secondary
    });
    $(document).find(".input_tablebg_logo").css({
        background: c_competition.input_tablebg_logo
    });
}